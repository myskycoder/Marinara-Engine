// ──────────────────────────────────────────────
// Routes: Game Session Admin (privileged)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import AdmZip from "adm-zip";
import { existsSync, readFileSync } from "fs";
import { z } from "zod";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";
import { createGameAdminService } from "../services/admin/game-admin.service.js";

const FEATURE = "Game session admin";

const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const exportQuerySchema = z.object({
  inlineFileData: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
});

const metadataPatchSchema = z.object({
  metadata: z.record(z.string(), z.unknown()),
});

function requireAdmin(req: Parameters<typeof requirePrivilegedAccess>[0], reply: Parameters<typeof requirePrivilegedAccess>[1]) {
  return requirePrivilegedAccess(req, reply, { feature: FEATURE });
}

async function buildSessionZip(
  service: ReturnType<typeof createGameAdminService>,
  chatId: string,
  inlineFileData: boolean,
) {
  const envelope = await service.buildSessionExportEnvelope(chatId, inlineFileData);
  if (!envelope) return null;

  const zip = new AdmZip();
  zip.addFile("envelope.json", Buffer.from(JSON.stringify(envelope, null, 2), "utf8"));

  const assetFiles = await service.collectSessionAssetFilesForZip(chatId);
  for (const file of assetFiles) {
    if (!existsSync(file.absPath)) continue;
    zip.addFile(file.entryName, readFileSync(file.absPath));
  }

  return { zip, envelope, chatName: String((envelope.data.chat as { name?: string }).name ?? chatId) };
}

async function buildCampaignZip(
  service: ReturnType<typeof createGameAdminService>,
  gameId: string,
  inlineFileData: boolean,
) {
  const envelope = await service.buildCampaignExportEnvelope(gameId, inlineFileData);
  if (!envelope) return null;

  const zip = new AdmZip();
  zip.addFile("envelope.json", Buffer.from(JSON.stringify(envelope, null, 2), "utf8"));

  for (const session of envelope.data.sessions) {
    const chatId = String((session.chat as { id?: string }).id ?? "");
    if (!chatId) continue;
    const assetFiles = await service.collectSessionAssetFilesForZip(chatId);
    for (const file of assetFiles) {
      if (!existsSync(file.absPath)) continue;
      const entryName = `sessions/${chatId}/${file.entryName}`;
      zip.addFile(entryName, readFileSync(file.absPath));
    }
  }

  return { zip, envelope };
}

export async function adminGameRoutes(app: FastifyInstance) {
  const service = () => createGameAdminService(app.db);

  app.get("/campaigns", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { campaigns: await service().listCampaigns() };
  });

  app.get<{ Params: { gameId: string } }>("/campaigns/:gameId/sessions", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const sessions = await service().listCampaignSessions(req.params.gameId);
    if (sessions.length === 0) return reply.status(404).send({ error: "No game sessions found for this campaign" });
    return { gameId: req.params.gameId, sessions };
  });

  app.get<{ Params: { chatId: string } }>("/sessions/:chatId", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const inspector = await service().getSessionInspector(req.params.chatId);
    if (!inspector) return reply.status(404).send({ error: "Game session not found" });
    return inspector;
  });

  app.get<{ Params: { chatId: string }; Querystring: { limit?: string; offset?: string } }>(
    "/sessions/:chatId/messages",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const query = messagesQuerySchema.parse(req.query ?? {});
      const chat = await service().getSessionInspector(req.params.chatId);
      if (!chat) return reply.status(404).send({ error: "Game session not found" });
      return service().listSessionMessages(req.params.chatId, query.limit, query.offset);
    },
  );

  app.get<{ Params: { chatId: string } }>("/sessions/:chatId/snapshots", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const chat = await service().getSessionInspector(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Game session not found" });
    const rows = await service().listSessionSnapshots(req.params.chatId);
    return { rows, total: rows.length };
  });

  app.get<{ Params: { chatId: string } }>("/sessions/:chatId/checkpoints", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const chat = await service().getSessionInspector(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Game session not found" });
    const rows = await service().listSessionCheckpoints(req.params.chatId);
    return { rows, total: rows.length };
  });

  app.get<{ Params: { chatId: string } }>("/sessions/:chatId/agent-runs", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const chat = await service().getSessionInspector(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Game session not found" });
    return service().listSessionAgentRuns(req.params.chatId);
  });

  app.get<{ Params: { chatId: string } }>("/sessions/:chatId/assets", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const chat = await service().getSessionInspector(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Game session not found" });
    return service().listSessionAssets(req.params.chatId);
  });

  app.get<{ Params: { chatId: string } }>("/sessions/:chatId/references", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const refs = await service().getSessionReferences(req.params.chatId);
    if (!refs) return reply.status(404).send({ error: "Game session not found" });
    return refs;
  });

  app.get<{ Params: { chatId: string }; Querystring: { inlineFileData?: string } }>(
    "/sessions/:chatId/export",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const query = exportQuerySchema.parse(req.query ?? {});
      const built = await buildSessionZip(service(), req.params.chatId, query.inlineFileData);
      if (!built) return reply.status(404).send({ error: "Game session not found" });

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeName = built.chatName.replace(/[^\w.-]+/g, "_").slice(0, 60) || "session";
      return reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="game-session-${safeName}-${stamp}.zip"`)
        .send(built.zip.toBuffer());
    },
  );

  app.get<{ Params: { gameId: string }; Querystring: { inlineFileData?: string } }>(
    "/campaigns/:gameId/export",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const query = exportQuerySchema.parse(req.query ?? {});
      const built = await buildCampaignZip(service(), req.params.gameId, query.inlineFileData);
      if (!built) return reply.status(404).send({ error: "Campaign not found" });

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      return reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="game-campaign-${req.params.gameId.slice(0, 8)}-${stamp}.zip"`)
        .send(built.zip.toBuffer());
    },
  );

  app.patch<{ Params: { chatId: string } }>("/sessions/:chatId/metadata", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = metadataPatchSchema.parse(req.body ?? {});
    const next = await service().patchSessionMetadata(req.params.chatId, body.metadata);
    if (!next) return reply.status(404).send({ error: "Game session not found" });
    return { metadata: next };
  });
}
