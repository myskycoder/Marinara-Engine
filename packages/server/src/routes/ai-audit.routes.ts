// ──────────────────────────────────────────────
// Routes: AI Request Audit Log (Admin)
// ──────────────────────────────────────────────
// Read/manage the persisted log of every outgoing AI request (LLM, embedding,
// image, TTS). All endpoints require privileged access (Basic Auth +
// ADMIN_SECRET) so audit data is never exposed to ordinary clients.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  isNull,
  like,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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

const exportFiltersSchema = z
  .object({
    source: z.string().optional(),
    kind: z.string().optional(),
    provider: z.string().optional(),
    agentConfigId: z.string().optional(),
    chatId: z.string().optional(),
    status: z.string().optional(),
    q: z.string().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
  })
  .optional();

const exportSchema = z.object({
  mode: z.enum(["last_turn", "last_turns", "last_logs"]),
  turnCount: z.coerce.number().int().min(1).max(100).default(5),
  logCount: z.coerce.number().int().min(1).max(5000).default(100),
  windowSeconds: z.coerce.number().int().min(10).max(3600).default(300),
  filters: exportFiltersSchema,
});

type AuditExportFilters = z.infer<typeof exportFiltersSchema>;

/** ISO timestamp of `iso` shifted by `offsetMs` milliseconds. */
function shiftIso(iso: string, offsetMs: number): string {
  return new Date(new Date(iso).getTime() + offsetMs).toISOString();
}

/** Filename-safe ISO stamp (no colons/dots). */
function fileStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

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
   * POST /api/admin/ai-audit/export
   * Bulk JSON export. Modes:
   *  - `last_logs`   — N most recent audit rows (with full payloads).
   *  - `last_turn`   — all rows belonging to the latest "turn" (anchored by
   *                    the most recent `source='main_generate'` row, expanded
   *                    by ±`windowSeconds` inside the same `chatId`, clipped
   *                    by neighbouring anchors so adjacent turns don't bleed).
   *  - `last_turns`  — same shape, but for the last `turnCount` anchors.
   * All modes respect the panel filters (kind/provider/status/q/etc.).
   * For turn modes, `source` is forced to `main_generate` for anchor
   * selection, and `since/until/source` are ignored when fetching the body
   * of each turn (we still want associated agent rows to come through).
   */
  app.post("/export", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: FEATURE })) return;
    const input = exportSchema.parse(req.body ?? {});
    const filters: AuditExportFilters = input.filters ?? {};

    const stamp = fileStamp();
    const exportedAt = new Date().toISOString();

    if (input.mode === "last_logs") {
      const conditions: SQL[] = [];
      if (filters.source) conditions.push(eq(aiRequestLogs.source, filters.source));
      if (filters.kind) conditions.push(eq(aiRequestLogs.kind, filters.kind));
      if (filters.provider) conditions.push(eq(aiRequestLogs.provider, filters.provider));
      if (filters.agentConfigId) conditions.push(eq(aiRequestLogs.agentConfigId, filters.agentConfigId));
      if (filters.chatId) conditions.push(eq(aiRequestLogs.chatId, filters.chatId));
      if (filters.status) conditions.push(eq(aiRequestLogs.status, filters.status));
      if (filters.since) conditions.push(gte(aiRequestLogs.createdAt, filters.since));
      if (filters.until) conditions.push(lte(aiRequestLogs.createdAt, filters.until));
      if (filters.q) conditions.push(like(aiRequestLogs.model, `%${filters.q}%`));

      const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;
      const baseSelect = db.select().from(aiRequestLogs);
      const builder = whereExpr ? baseSelect.where(whereExpr) : baseSelect;
      const rows = await builder.orderBy(desc(aiRequestLogs.createdAt)).limit(input.logCount);

      const filename = `ai-audit-last-${input.logCount}-logs-${stamp}.json`;
      reply
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`);
      return {
        exportedAt,
        mode: input.mode,
        params: { logCount: input.logCount },
        filters,
        rows,
      };
    }

    // ── Turn-based export ──────────────────────────────────────────────
    // 1. Anchor lookup. Source is pinned to "main_generate"; other filters
    //    are applied to narrow which anchors qualify.
    const anchorLimit = input.mode === "last_turn" ? 1 : input.turnCount;
    const anchorConditions: SQL[] = [eq(aiRequestLogs.source, "main_generate")];
    if (filters.kind) anchorConditions.push(eq(aiRequestLogs.kind, filters.kind));
    if (filters.provider) anchorConditions.push(eq(aiRequestLogs.provider, filters.provider));
    if (filters.agentConfigId) anchorConditions.push(eq(aiRequestLogs.agentConfigId, filters.agentConfigId));
    if (filters.chatId) anchorConditions.push(eq(aiRequestLogs.chatId, filters.chatId));
    if (filters.status) anchorConditions.push(eq(aiRequestLogs.status, filters.status));
    if (filters.since) anchorConditions.push(gte(aiRequestLogs.createdAt, filters.since));
    if (filters.until) anchorConditions.push(lte(aiRequestLogs.createdAt, filters.until));
    if (filters.q) anchorConditions.push(like(aiRequestLogs.model, `%${filters.q}%`));

    const anchors = await db
      .select({
        id: aiRequestLogs.id,
        createdAt: aiRequestLogs.createdAt,
        chatId: aiRequestLogs.chatId,
        messageId: aiRequestLogs.messageId,
      })
      .from(aiRequestLogs)
      .where(and(...anchorConditions))
      .orderBy(desc(aiRequestLogs.createdAt))
      .limit(anchorLimit);

    if (anchors.length === 0) {
      const filename = `ai-audit-${input.mode === "last_turn" ? "last-turn" : `last-${input.turnCount}-turns`}-${stamp}.json`;
      reply
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`);
      return {
        exportedAt,
        mode: input.mode,
        params: { turnCount: anchorLimit, windowSeconds: input.windowSeconds },
        filters,
        turnAnchors: [],
        rows: [],
      };
    }

    // 2. For each anchor compute its time window inside its chat,
    //    clipped by adjacent main_generate anchors in the same chat.
    const windowMs = input.windowSeconds * 1000;
    const turnAnchors: Array<{
      auditId: string;
      chatId: string | null;
      messageId: string | null;
      createdAt: string;
      rangeStart: string;
      rangeEnd: string;
    }> = [];
    const windowConditions: SQL[] = [];

    for (const anchor of anchors) {
      let rangeStart = shiftIso(anchor.createdAt, -windowMs);
      let rangeEnd = shiftIso(anchor.createdAt, windowMs);

      if (anchor.chatId) {
        const prev = await db
          .select({ createdAt: aiRequestLogs.createdAt })
          .from(aiRequestLogs)
          .where(
            and(
              eq(aiRequestLogs.source, "main_generate"),
              eq(aiRequestLogs.chatId, anchor.chatId),
              lt(aiRequestLogs.createdAt, anchor.createdAt),
            ),
          )
          .orderBy(desc(aiRequestLogs.createdAt))
          .limit(1);
        if (prev[0]) {
          const candidate = shiftIso(prev[0].createdAt, 1);
          if (candidate > rangeStart) rangeStart = candidate;
        }

        const next = await db
          .select({ createdAt: aiRequestLogs.createdAt })
          .from(aiRequestLogs)
          .where(
            and(
              eq(aiRequestLogs.source, "main_generate"),
              eq(aiRequestLogs.chatId, anchor.chatId),
              gt(aiRequestLogs.createdAt, anchor.createdAt),
            ),
          )
          .orderBy(asc(aiRequestLogs.createdAt))
          .limit(1);
        if (next[0]) {
          const candidate = shiftIso(next[0].createdAt, -1);
          if (candidate < rangeEnd) rangeEnd = candidate;
        }
      }

      turnAnchors.push({
        auditId: anchor.id,
        chatId: anchor.chatId,
        messageId: anchor.messageId,
        createdAt: anchor.createdAt,
        rangeStart,
        rangeEnd,
      });

      const chatCondition = anchor.chatId
        ? eq(aiRequestLogs.chatId, anchor.chatId)
        : isNull(aiRequestLogs.chatId);
      const windowExpr = and(
        chatCondition,
        gte(aiRequestLogs.createdAt, rangeStart),
        lte(aiRequestLogs.createdAt, rangeEnd),
      );
      if (windowExpr) windowConditions.push(windowExpr);
    }

    // 3. Final body fetch — union of windows + non-temporal body filters.
    //    (kind/provider/status/q/agentConfigId remain; since/until/source are
    //    intentionally dropped so agent rows inside the windows survive.)
    const unionExpr =
      windowConditions.length === 1 ? windowConditions[0]! : or(...windowConditions)!;
    const bodyConditions: SQL[] = [unionExpr];
    if (filters.kind) bodyConditions.push(eq(aiRequestLogs.kind, filters.kind));
    if (filters.provider) bodyConditions.push(eq(aiRequestLogs.provider, filters.provider));
    if (filters.status) bodyConditions.push(eq(aiRequestLogs.status, filters.status));
    if (filters.agentConfigId) bodyConditions.push(eq(aiRequestLogs.agentConfigId, filters.agentConfigId));
    if (filters.q) bodyConditions.push(like(aiRequestLogs.model, `%${filters.q}%`));

    const rows = await db
      .select()
      .from(aiRequestLogs)
      .where(and(...bodyConditions))
      .orderBy(desc(aiRequestLogs.createdAt));

    const filename = `ai-audit-${
      input.mode === "last_turn" ? "last-turn" : `last-${input.turnCount}-turns`
    }-${stamp}.json`;
    reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`);
    return {
      exportedAt,
      mode: input.mode,
      params: {
        turnCount: anchorLimit,
        windowSeconds: input.windowSeconds,
      },
      filters,
      turnAnchors,
      rows,
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
