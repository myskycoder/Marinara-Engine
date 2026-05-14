// ──────────────────────────────────────────────
// Routes: AI Request Audit Log (Admin)
// ──────────────────────────────────────────────
// Read/manage the persisted log of every outgoing AI request (LLM, embedding,
// image, TTS). All endpoints require privileged access (Basic Auth +
// ADMIN_SECRET) so audit data is never exposed to ordinary clients.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql, like } from "drizzle-orm";
import { aiRequestLogs } from "../db/schema/index.js";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";
import {
  AI_AUDIT_DEFAULT_SETTINGS,
  invalidateAiAuditSettingsCache,
  readAiAuditSettings,
  writeAiAuditSettings,
} from "../services/ai-audit/audit-settings.js";
import { pruneAiRequestLogs } from "../services/ai-audit/audit-cleanup.js";

const FEATURE = "AI request audit log";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  source: z.string().optional(),
  kind: z.string().optional(),
  provider: z.string().optional(),
  agentConfigId: z.string().optional(),
  chatId: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
});

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  maxEntries: z.number().int().min(0).max(1_000_000).optional(),
  maxRecordSize: z.number().int().min(0).max(50 * 1024 * 1024).optional(),
  retentionDays: z.number().int().min(0).max(3650).optional(),
  logRequestBody: z.boolean().optional(),
  logResponseBody: z.boolean().optional(),
});

export async function aiAuditRoutes(app: FastifyInstance) {
  const db = app.db;

  /**
   * GET /api/admin/ai-audit
   * Paginated list (newest first). Excludes the heavy request/response
   * payloads — clients fetch full details via /:id.
   */
  app.get("/", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: FEATURE })) return;
    const query = listQuerySchema.parse(req.query);

    const conditions = [];
    if (query.source) conditions.push(eq(aiRequestLogs.source, query.source));
    if (query.kind) conditions.push(eq(aiRequestLogs.kind, query.kind));
    if (query.provider) conditions.push(eq(aiRequestLogs.provider, query.provider));
    if (query.agentConfigId) conditions.push(eq(aiRequestLogs.agentConfigId, query.agentConfigId));
    if (query.chatId) conditions.push(eq(aiRequestLogs.chatId, query.chatId));
    if (query.status) conditions.push(eq(aiRequestLogs.status, query.status));
    if (query.since) conditions.push(gte(aiRequestLogs.createdAt, query.since));
    if (query.until) conditions.push(lte(aiRequestLogs.createdAt, query.until));
    if (query.q) conditions.push(like(aiRequestLogs.model, `%${query.q}%`));
    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const baseSelect = db
      .select({
        id: aiRequestLogs.id,
        createdAt: aiRequestLogs.createdAt,
        source: aiRequestLogs.source,
        kind: aiRequestLogs.kind,
        provider: aiRequestLogs.provider,
        model: aiRequestLogs.model,
        agentConfigId: aiRequestLogs.agentConfigId,
        agentName: aiRequestLogs.agentName,
        chatId: aiRequestLogs.chatId,
        messageId: aiRequestLogs.messageId,
        status: aiRequestLogs.status,
        errorMessage: aiRequestLogs.errorMessage,
        durationMs: aiRequestLogs.durationMs,
        promptTokens: aiRequestLogs.promptTokens,
        completionTokens: aiRequestLogs.completionTokens,
        totalTokens: aiRequestLogs.totalTokens,
        cachedPromptTokens: aiRequestLogs.cachedPromptTokens,
        requestTruncated: aiRequestLogs.requestTruncated,
        responseTruncated: aiRequestLogs.responseTruncated,
      })
      .from(aiRequestLogs);

    const rowsBuilder = whereExpr ? baseSelect.where(whereExpr) : baseSelect;
    const rows = await rowsBuilder
      .orderBy(desc(aiRequestLogs.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    const countSelect = db.select({ c: sql<number>`count(*)` }).from(aiRequestLogs);
    const countBuilder = whereExpr ? countSelect.where(whereExpr) : countSelect;
    const totalRow = await countBuilder;
    const total = Number(totalRow[0]?.c ?? 0);

    return { rows, total, limit: query.limit, offset: query.offset };
  });

  /**
   * GET /api/admin/ai-audit/distinct
   * Returns distinct values for the dropdown filters (source, kind, provider).
   */
  app.get("/distinct", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: FEATURE })) return;
    const sources = await db
      .selectDistinct({ value: aiRequestLogs.source })
      .from(aiRequestLogs);
    const kinds = await db
      .selectDistinct({ value: aiRequestLogs.kind })
      .from(aiRequestLogs);
    const providers = await db
      .selectDistinct({ value: aiRequestLogs.provider })
      .from(aiRequestLogs);
    const statuses = await db
      .selectDistinct({ value: aiRequestLogs.status })
      .from(aiRequestLogs);
    return {
      sources: sources.map((r) => r.value).filter(Boolean),
      kinds: kinds.map((r) => r.value).filter(Boolean),
      providers: providers.map((r) => r.value).filter(Boolean),
      statuses: statuses.map((r) => r.value).filter(Boolean),
    };
  });

  /**
   * GET /api/admin/ai-audit/settings
   */
  app.get("/settings", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: FEATURE })) return;
    const settings = await readAiAuditSettings();
    return { settings, defaults: AI_AUDIT_DEFAULT_SETTINGS };
  });

  /**
   * PUT /api/admin/ai-audit/settings
   */
  app.put("/settings", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: FEATURE })) return;
    const input = settingsSchema.parse(req.body);
    const updated = await writeAiAuditSettings(input);
    return { settings: updated };
  });

  /**
   * GET /api/admin/ai-audit/:id
   * Full record including request_payload and response_payload.
   */
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: FEATURE })) return;
    const rows = await db.select().from(aiRequestLogs).where(eq(aiRequestLogs.id, req.params.id));
    const row = rows[0];
    if (!row) return reply.status(404).send({ error: "Audit entry not found" });
    return { entry: row };
  });

  /**
   * DELETE /api/admin/ai-audit
   * Clear all audit entries.
   */
  app.delete("/", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: FEATURE })) return;
    await db.delete(aiRequestLogs);
    invalidateAiAuditSettingsCache();
    return { cleared: true };
  });

  /**
   * DELETE /api/admin/ai-audit/:id
   * Remove a single audit entry.
   */
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: FEATURE })) return;
    await db.delete(aiRequestLogs).where(eq(aiRequestLogs.id, req.params.id));
    return { deleted: req.params.id };
  });

  /**
   * POST /api/admin/ai-audit/prune
   * Manually trigger retention/count-based pruning.
   */
  app.post("/prune", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: FEATURE })) return;
    const result = await pruneAiRequestLogs();
    return result;
  });
}
