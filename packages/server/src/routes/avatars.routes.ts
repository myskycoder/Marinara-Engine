// ──────────────────────────────────────────────
// Routes: Avatar file serving
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, extname } from "path";
import type { GameNpc } from "@marinara-engine/shared";
import { DATA_DIR } from "../utils/data-dir.js";
import { logger } from "../lib/logger.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { npcAvatarFilename, npcAvatarUrl } from "../services/game/game-asset-generation.js";
import { isSameNpcName, sha1HexLegacy, slugifyForFs } from "../services/game/npc-name-server.js";

const AVATAR_DIR = join(DATA_DIR, "avatars");
const NPC_AVATAR_DIR = join(AVATAR_DIR, "npc");

function parseChatMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

function findGameNpcByName(npcs: GameNpc[], name: string): GameNpc | null {
  if (!name?.trim()) return null;
  return npcs.find((npc) => isSameNpcName(npc.name ?? "", name)) ?? null;
}

function ensureDir() {
  if (!existsSync(AVATAR_DIR)) {
    mkdirSync(AVATAR_DIR, { recursive: true });
  }
}

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

function isValidFilename(name: string): boolean {
  return !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

export async function avatarsRoutes(app: FastifyInstance) {
  /** Serve an avatar image file. */
  app.get("/file/:filename", async (req, reply) => {
    ensureDir();
    const { filename } = req.params as { filename: string };

    if (!isValidFilename(filename)) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = join(AVATAR_DIR, filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = extname(filename).toLowerCase();
    const { createReadStream } = await import("fs");
    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", MIME_MAP[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(stream);
  });

  /** Serve an NPC avatar image by chatId and filename. */
  app.get("/npc/:chatId/:filename", async (req, reply) => {
    const { chatId, filename } = req.params as { chatId: string; filename: string };

    if (!isValidFilename(chatId) || !isValidFilename(filename)) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = join(NPC_AVATAR_DIR, chatId, filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = extname(filename).toLowerCase();
    const { createReadStream } = await import("fs");
    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", MIME_MAP[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=604800")
      .send(stream);
  });

  /**
   * Upload an NPC avatar (base64 data URL).
   *
   * Filename strategy (in order of precedence):
   *   1. Caller provides `id` → save as `<id>.png` (preferred for Game-mode NPCs).
   *   2. Caller provides `name` only → look it up in `chat.metadata.gameNpcs`
   *      and use the matched `npc.id`. If the chat is in Game mode the
   *      materializer guarantees an entry exists. Also patches gameNpcs[].avatarUrl
   *      so the URL becomes the canonical source of truth on subsequent reads.
   *   3. No game-NPC match → fall back to a robust `slugifyName(name)` (NFKD
   *      + SHA-1 hash for non-Latin scripts). Used by Roleplay-mode HUD which
   *      has no `gameNpcs` table.
   */
  app.post("/npc/:chatId", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const body = req.body as { id?: string; name?: string; avatar?: string };
    const { id: providedId, name, avatar } = body;

    if (!isValidFilename(chatId)) {
      return reply.status(400).send({ error: "Invalid chatId" });
    }
    if (!avatar) {
      return reply.status(400).send({ error: "Missing avatar" });
    }
    if (!providedId && !name) {
      return reply.status(400).send({ error: "Provide either `id` or `name`" });
    }

    const match = avatar.match(/^data:image\/\w+;base64,(.+)$/);
    if (!match) {
      return reply.status(400).send({ error: "Invalid avatar format — expected base64 data URL" });
    }

    let resolvedId: string | null = providedId?.trim() || null;
    let matchedNpc: GameNpc | null = null;

    if (!resolvedId && name) {
      try {
        const chats = createChatsStorage(app.db);
        const chat = await chats.getById(chatId);
        if (chat) {
          const meta = parseChatMetadata(chat.metadata);
          const npcs = Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as GameNpc[]) : [];
          matchedNpc = findGameNpcByName(npcs, name);
          if (matchedNpc) resolvedId = matchedNpc.id;
        }
      } catch (err) {
        logger.warn(err, "[avatars] Failed to resolve gameNpc id for chat=%s name=%s", chatId, name);
      }
    }

    if (!resolvedId) {
      if (!name) {
        return reply.status(400).send({ error: "Cannot resolve NPC id without `name`" });
      }
      // Legacy s-<sha1> prefix kept for backwards compatibility with files
      // already on disk for non-Latin names.
      resolvedId = slugifyForFs(name, { prefix: "s", hashHex: sha1HexLegacy });
    }

    if (!isValidFilename(resolvedId)) {
      return reply.status(400).send({ error: "Resolved NPC id contains unsafe characters" });
    }

    const npcDir = join(NPC_AVATAR_DIR, chatId);
    if (!existsSync(npcDir)) mkdirSync(npcDir, { recursive: true });

    const filePath = join(npcDir, npcAvatarFilename(resolvedId));
    writeFileSync(filePath, Buffer.from(match[1]!, "base64"));
    const avatarPath = npcAvatarUrl(chatId, resolvedId);

    if (matchedNpc) {
      try {
        const chats = createChatsStorage(app.db);
        await chats.updateMetadataWithMerge(chatId, (meta) => {
          const npcs = Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as GameNpc[]) : [];
          let changed = false;
          const nextNpcs = npcs.map((npc) => {
            if (npc.id !== resolvedId) return npc;
            changed = true;
            return { ...npc, avatarUrl: avatarPath };
          });
          if (!changed) return null;
          return { ...meta, gameNpcs: nextNpcs };
        });
      } catch (err) {
        logger.warn(err, "[avatars] Failed to patch gameNpcs avatarUrl for chat=%s id=%s", chatId, resolvedId);
      }
    }

    return reply.send({ avatarPath });
  });
}
