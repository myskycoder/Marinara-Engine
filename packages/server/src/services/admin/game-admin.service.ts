// ──────────────────────────────────────────────
// Service: Game Session Admin (inspect + export)
// ──────────────────────────────────────────────
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { eq, desc, inArray } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import {
  agentMemory,
  agentRuns,
  chatImages,
  gameStateSnapshots,
  messageSwipes,
} from "../../db/schema/index.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import { assertInsideDir } from "../../utils/security.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createCheckpointService } from "../game/checkpoint.service.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import {
  chatBackgroundPlatesDir,
} from "../game/game-asset-generation.js";
import { GAME_ASSETS_DIR } from "../game/asset-manifest.service.js";
import type {
  ExportEnvelope,
  GameCampaignExportPayload,
  GameSessionExportFile,
  GameSessionExportPayload,
  GameSessionExportReferences,
  GameNpc,
} from "@marinara-engine/shared";

const NPC_AVATAR_DIR = join(DATA_DIR, "avatars", "npc");
const SPRITES_ROOT = join(DATA_DIR, "sprites");
const GALLERY_DIR = join(DATA_DIR, "gallery");
const SESSION_EXPORT_ENTRY_LIMIT_BYTES = 64 * 1024 * 1024;
const SESSION_EXPORT_TOTAL_LIMIT_BYTES = 256 * 1024 * 1024;

type MetadataPatch = Record<string, unknown>;

export interface GameCampaignListItem {
  gameId: string;
  lineageRootGameId: string;
  name: string;
  sessionCount: number;
  forkBranchCount: number;
  lastUpdatedAt: string;
  lastSessionStatus: string | null;
  lastSessionNumber: number | null;
}

export interface GameSessionListItem {
  chatId: string;
  name: string;
  gameId: string | null;
  gameSessionNumber: number | null;
  gameSessionStatus: string | null;
  forkLabel: string | null;
  forkedFromChatId: string | null;
  forkedFromMessageId: string | null;
  messageCount: number;
  snapshotCount: number;
  checkpointCount: number;
  agentRunCount: number;
  assetFileCount: number;
  assetBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface GameSessionInspector {
  chat: Record<string, unknown>;
  overview: {
    gameId: string | null;
    gameSessionNumber: number | null;
    gameSessionStatus: string | null;
    gameGmMode: string | null;
    gameGmCharacterId: string | null;
    connectionId: string | null;
    personaId: string | null;
    partyCharacterIds: string[];
    forkLineageRootGameId: string | null;
    forkedFromGameId: string | null;
    forkedFromChatId: string | null;
    forkedFromMessageId: string | null;
    forkLabel: string | null;
    gameSetupConfig: Record<string, unknown> | null;
    counts: {
      messages: number;
      snapshots: number;
      checkpoints: number;
      agentRuns: number;
      assets: number;
    };
  };
  metadata: MetadataPatch;
  highlights: {
    gameWorldOverview: string | null;
    gameStoryArc: string | null;
    gamePlotTwists: string[];
    gameNpcs: GameNpc[];
    gameMap: unknown;
    gameMaps: unknown[];
    locationCatalog: Record<string, unknown>;
    gameJournal: unknown;
    gameInventory: unknown[];
    gamePlayerNotes: string | null;
    gameBlueprint: unknown;
    gameWidgetState: unknown[];
    gameMorale: number | null;
    gamePartyArcs: unknown[];
    gameCharacterCards: unknown[];
    activeLorebookIds: string[];
  };
}

function parseMeta(raw: unknown): MetadataPatch {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as MetadataPatch) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as MetadataPatch) : {};
}

function parseCharacterIds(raw: unknown): string[] {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

function readGameId(meta: MetadataPatch, groupId: string | null | undefined): string | null {
  const fromMeta = typeof meta.gameId === "string" && meta.gameId.trim() ? meta.gameId.trim() : null;
  if (fromMeta) return fromMeta;
  return typeof groupId === "string" && groupId.trim() ? groupId.trim() : null;
}

function readLineageRoot(meta: MetadataPatch, gameId: string | null): string {
  const root =
    typeof meta.forkLineageRootGameId === "string" && meta.forkLineageRootGameId.trim()
      ? meta.forkLineageRootGameId.trim()
      : gameId;
  return root ?? "unknown";
}

function normalizeChatRow(chat: Record<string, unknown>) {
  const meta = parseMeta(chat.metadata);
  return {
    ...chat,
    metadata: meta,
    characterIds: parseCharacterIds(chat.characterIds),
  };
}

function collectSpriteIds(meta: MetadataPatch): string[] {
  const npcs = Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as GameNpc[]) : [];
  const ids = new Set<string>();
  for (const npc of npcs) {
    if (typeof npc.spriteId === "string" && npc.spriteId.trim()) ids.add(npc.spriteId.trim());
    for (const gen of npc.spriteGenerations ?? []) {
      if (typeof gen.spriteId === "string" && gen.spriteId.trim()) ids.add(gen.spriteId.trim());
    }
  }
  return Array.from(ids);
}

function safeRelPath(baseDir: string, filePath: string): string | null {
  try {
    const resolved = assertInsideDir(baseDir, filePath);
    return relative(DATA_DIR, resolved).split(/[\\/]/g).join("/");
  } catch {
    return null;
  }
}

function walkFiles(dir: string, onFile: (absPath: string, relFromDataDir: string) => void) {
  if (!existsSync(dir)) return;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = safeRelPath(DATA_DIR, full);
      if (rel) onFile(full, rel);
    }
  }
}

function collectSessionAssetManifest(chatId: string, meta: MetadataPatch): {
  files: Array<{ path: string; size: number; absPath: string }>;
  totalBytes: number;
} {
  const files: Array<{ path: string; size: number; absPath: string }> = [];
  let totalBytes = 0;

  const addFile = (absPath: string) => {
    if (!existsSync(absPath)) return;
    const rel = safeRelPath(DATA_DIR, absPath);
    if (!rel) return;
    const size = statSync(absPath).size;
    files.push({ path: rel, size, absPath });
    totalBytes += size;
  };

  walkFiles(chatBackgroundPlatesDir(chatId), (abs, rel) => addFile(abs));
  walkFiles(join(NPC_AVATAR_DIR, chatId), (abs) => addFile(abs));
  walkFiles(join(GALLERY_DIR, chatId), (abs) => addFile(abs));

  for (const spriteId of collectSpriteIds(meta)) {
    walkFiles(join(SPRITES_ROOT, spriteId), (abs) => addFile(abs));
  }

  return { files, totalBytes };
}

function readSessionExportFiles(
  manifest: Array<{ path: string; size: number; absPath: string }>,
  inlineFileData: boolean,
): GameSessionExportFile[] {
  const out: GameSessionExportFile[] = [];
  let total = 0;
  for (const file of manifest) {
    if (file.size > SESSION_EXPORT_ENTRY_LIMIT_BYTES) continue;
    total += file.size;
    if (total > SESSION_EXPORT_TOTAL_LIMIT_BYTES) break;
    const entry: GameSessionExportFile = { path: file.path, size: file.size };
    if (inlineFileData) {
      entry.data = readFileSync(file.absPath).toString("base64");
    }
    out.push(entry);
  }
  return out;
}

async function resolveReferences(
  db: DB,
  chat: Record<string, unknown>,
  meta: MetadataPatch,
): Promise<GameSessionExportReferences> {
  const chars = createCharactersStorage(db);
  const lbs = createLorebooksStorage(db);
  const conns = createConnectionsStorage(db);

  const characterIds = Array.from(
    new Set([
      ...parseCharacterIds(chat.characterIds),
      ...(Array.isArray(meta.gamePartyCharacterIds)
        ? (meta.gamePartyCharacterIds as unknown[]).filter((id): id is string => typeof id === "string")
        : []),
      ...(typeof meta.gameGmCharacterId === "string" ? [meta.gameGmCharacterId] : []),
    ]),
  );

  const lorebookIds = Array.from(
    new Set([
      ...(Array.isArray(meta.activeLorebookIds)
        ? (meta.activeLorebookIds as unknown[]).filter((id): id is string => typeof id === "string")
        : []),
      ...(typeof meta.gameLorebookKeeperLorebookId === "string" ? [meta.gameLorebookKeeperLorebookId] : []),
    ]),
  );

  const connectionIds = Array.from(
    new Set(
      [
        chat.connectionId,
        meta.gameImageConnectionId,
        meta.gameSceneConnectionId,
        meta.gameCharacterConnectionId,
        (meta.gameSetupConfig as Record<string, unknown> | null)?.imageConnectionId,
        (meta.gameSetupConfig as Record<string, unknown> | null)?.sceneConnectionId,
      ].filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  );

  const personaId = typeof chat.personaId === "string" ? chat.personaId : null;
  const missing: string[] = [];
  const resolvedCharacters: Array<{ id: string; name: string }> = [];
  for (const id of characterIds) {
    const row = await chars.getById(id);
    if (!row) {
      missing.push(`character:${id}`);
      continue;
    }
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    resolvedCharacters.push({ id, name: (data?.name as string) ?? id });
  }

  let resolvedPersona: { id: string; name: string } | null = null;
  if (personaId) {
    const row = await chars.getPersona(personaId);
    if (!row) missing.push(`persona:${personaId}`);
    else resolvedPersona = { id: personaId, name: row.name ?? personaId };
  }

  const resolvedLorebooks: Array<{ id: string; name: string }> = [];
  for (const id of lorebookIds) {
    const row = await lbs.getById(id);
    if (!row) missing.push(`lorebook:${id}`);
    else resolvedLorebooks.push({ id, name: row.name ?? id });
  }

  const resolvedConnections: Array<{ id: string; name: string }> = [];
  for (const id of connectionIds) {
    const row = await conns.getById(id);
    if (!row) missing.push(`connection:${id}`);
    else resolvedConnections.push({ id, name: row.name ?? id });
  }

  return {
    characterIds,
    personaId,
    lorebookIds,
    connectionIds,
    resolved: {
      characters: resolvedCharacters,
      persona: resolvedPersona,
      lorebooks: resolvedLorebooks,
      connections: resolvedConnections,
    },
    missing,
  };
}

async function countRowsForChat(db: DB, chatId: string) {
  const [snapshots, runs, images] = await Promise.all([
    db.select({ id: gameStateSnapshots.id }).from(gameStateSnapshots).where(eq(gameStateSnapshots.chatId, chatId)),
    db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.chatId, chatId)),
    db.select({ id: chatImages.id }).from(chatImages).where(eq(chatImages.chatId, chatId)),
  ]);
  return {
    snapshotCount: snapshots.length,
    agentRunCount: runs.length,
    chatImageCount: images.length,
  };
}

export function createGameAdminService(db: DB) {
  const chats = createChatsStorage(db);
  const checkpoints = createCheckpointService(db);

  return {
    async listCampaigns(): Promise<GameCampaignListItem[]> {
      const allChats = await chats.list();
      const gameChats = allChats.filter((c) => (c.mode as string) === "game");
      const byLineage = new Map<string, Array<Record<string, unknown>>>();

      for (const chat of gameChats) {
        const meta = parseMeta(chat.metadata);
        const gameId = readGameId(meta, chat.groupId as string | null);
        if (!gameId) continue;
        const lineage = readLineageRoot(meta, gameId);
        const bucket = byLineage.get(lineage) ?? [];
        bucket.push(chat as Record<string, unknown>);
        byLineage.set(lineage, bucket);
      }

      const campaigns: GameCampaignListItem[] = [];
      for (const [lineageRootGameId, sessions] of byLineage) {
        const normalized = sessions.map((s) => {
          const meta = parseMeta(s.metadata);
          return {
            chat: s,
            meta,
            gameId: readGameId(meta, s.groupId as string | null),
            sessionNumber:
              typeof meta.gameSessionNumber === "number" && Number.isFinite(meta.gameSessionNumber)
                ? meta.gameSessionNumber
                : 0,
            updatedAt: String(s.updatedAt ?? ""),
          };
        });

        normalized.sort((a, b) => {
          if (b.sessionNumber !== a.sessionNumber) return b.sessionNumber - a.sessionNumber;
          return b.updatedAt.localeCompare(a.updatedAt);
        });

        const latest = normalized[0];
        const sessionOne =
          normalized.find((s) => s.sessionNumber === 1) ??
          normalized.reduce((best, cur) => (cur.sessionNumber < best.sessionNumber ? cur : best), normalized[0]);

        const uniqueGameIds = new Set(normalized.map((s) => s.gameId).filter(Boolean));
        campaigns.push({
          gameId: latest?.gameId ?? lineageRootGameId,
          lineageRootGameId,
          name: String(sessionOne?.chat.name ?? latest?.chat.name ?? "Game"),
          sessionCount: normalized.length,
          forkBranchCount: Math.max(0, uniqueGameIds.size - 1),
          lastUpdatedAt: latest?.updatedAt ?? "",
          lastSessionStatus:
            typeof latest?.meta.gameSessionStatus === "string" ? latest.meta.gameSessionStatus : null,
          lastSessionNumber: latest?.sessionNumber ?? null,
        });
      }

      campaigns.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
      return campaigns;
    },

    async listCampaignSessions(gameId: string): Promise<GameSessionListItem[]> {
      const sessions = await chats.listByGroup(gameId);
      const gameSessions = sessions.filter((c) => (c.mode as string) === "game");
      const items: GameSessionListItem[] = [];

      for (const chat of gameSessions) {
        const meta = parseMeta(chat.metadata);
        const chatId = String(chat.id);
        const [messageCount, checkpointRows, rowCounts] = await Promise.all([
          chats.countMessages(chatId),
          checkpoints.listForChat(chatId),
          countRowsForChat(db, chatId),
        ]);
        const assets = collectSessionAssetManifest(chatId, meta);

        items.push({
          chatId,
          name: String(chat.name ?? ""),
          gameId: readGameId(meta, chat.groupId as string | null),
          gameSessionNumber:
            typeof meta.gameSessionNumber === "number" && Number.isFinite(meta.gameSessionNumber)
              ? meta.gameSessionNumber
              : null,
          gameSessionStatus: typeof meta.gameSessionStatus === "string" ? meta.gameSessionStatus : null,
          forkLabel: typeof meta.forkLabel === "string" ? meta.forkLabel : null,
          forkedFromChatId: typeof meta.forkedFromChatId === "string" ? meta.forkedFromChatId : null,
          forkedFromMessageId: typeof meta.forkedFromMessageId === "string" ? meta.forkedFromMessageId : null,
          messageCount,
          snapshotCount: rowCounts.snapshotCount,
          checkpointCount: checkpointRows.length,
          agentRunCount: rowCounts.agentRunCount,
          assetFileCount: assets.files.length,
          assetBytes: assets.totalBytes,
          createdAt: String(chat.createdAt ?? ""),
          updatedAt: String(chat.updatedAt ?? ""),
        });
      }

      items.sort((a, b) => (a.gameSessionNumber ?? 0) - (b.gameSessionNumber ?? 0));
      return items;
    },

    async getSessionInspector(chatId: string): Promise<GameSessionInspector | null> {
      const chat = await chats.getById(chatId);
      if (!chat || (chat.mode as string) !== "game") return null;
      const normalized = normalizeChatRow(chat as Record<string, unknown>);
      const meta = normalized.metadata;
      const [messageCount, checkpointRows, rowCounts] = await Promise.all([
        chats.countMessages(chatId),
        checkpoints.listForChat(chatId),
        countRowsForChat(db, chatId),
      ]);
      const assets = collectSessionAssetManifest(chatId, meta);

      return {
        chat: normalized,
        overview: {
          gameId: readGameId(meta, normalized.groupId as string | null),
          gameSessionNumber:
            typeof meta.gameSessionNumber === "number" && Number.isFinite(meta.gameSessionNumber)
              ? meta.gameSessionNumber
              : null,
          gameSessionStatus: typeof meta.gameSessionStatus === "string" ? meta.gameSessionStatus : null,
          gameGmMode: typeof meta.gameGmMode === "string" ? meta.gameGmMode : null,
          gameGmCharacterId: typeof meta.gameGmCharacterId === "string" ? meta.gameGmCharacterId : null,
          connectionId: typeof normalized.connectionId === "string" ? normalized.connectionId : null,
          personaId: typeof normalized.personaId === "string" ? normalized.personaId : null,
          partyCharacterIds: Array.isArray(meta.gamePartyCharacterIds)
            ? (meta.gamePartyCharacterIds as string[])
            : normalized.characterIds,
          forkLineageRootGameId:
            typeof meta.forkLineageRootGameId === "string" ? meta.forkLineageRootGameId : null,
          forkedFromGameId: typeof meta.forkedFromGameId === "string" ? meta.forkedFromGameId : null,
          forkedFromChatId: typeof meta.forkedFromChatId === "string" ? meta.forkedFromChatId : null,
          forkedFromMessageId: typeof meta.forkedFromMessageId === "string" ? meta.forkedFromMessageId : null,
          forkLabel: typeof meta.forkLabel === "string" ? meta.forkLabel : null,
          gameSetupConfig:
            meta.gameSetupConfig && typeof meta.gameSetupConfig === "object"
              ? (meta.gameSetupConfig as Record<string, unknown>)
              : null,
          counts: {
            messages: messageCount,
            snapshots: rowCounts.snapshotCount,
            checkpoints: checkpointRows.length,
            agentRuns: rowCounts.agentRunCount,
            assets: assets.files.length,
          },
        },
        metadata: meta,
        highlights: {
          gameWorldOverview: typeof meta.gameWorldOverview === "string" ? meta.gameWorldOverview : null,
          gameStoryArc: typeof meta.gameStoryArc === "string" ? meta.gameStoryArc : null,
          gamePlotTwists: Array.isArray(meta.gamePlotTwists) ? (meta.gamePlotTwists as string[]) : [],
          gameNpcs: Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as GameNpc[]) : [],
          gameMap: meta.gameMap ?? null,
          gameMaps: Array.isArray(meta.gameMaps) ? meta.gameMaps : [],
          locationCatalog:
            meta.locationCatalog && typeof meta.locationCatalog === "object"
              ? (meta.locationCatalog as Record<string, unknown>)
              : {},
          gameJournal: meta.gameJournal ?? null,
          gameInventory: Array.isArray(meta.gameInventory) ? meta.gameInventory : [],
          gamePlayerNotes: typeof meta.gamePlayerNotes === "string" ? meta.gamePlayerNotes : null,
          gameBlueprint: meta.gameBlueprint ?? null,
          gameWidgetState: Array.isArray(meta.gameWidgetState) ? meta.gameWidgetState : [],
          gameMorale: typeof meta.gameMorale === "number" ? meta.gameMorale : null,
          gamePartyArcs: Array.isArray(meta.gamePartyArcs) ? meta.gamePartyArcs : [],
          gameCharacterCards: Array.isArray(meta.gameCharacterCards) ? meta.gameCharacterCards : [],
          activeLorebookIds: Array.isArray(meta.activeLorebookIds) ? (meta.activeLorebookIds as string[]) : [],
        },
      };
    },

    async listSessionMessages(chatId: string, limit: number, offset: number) {
      const all = await chats.listMessages(chatId);
      const total = all.length;
      const slice = all.slice(offset, offset + limit);
      const messageIds = slice.map((m) => m.id);
      const swipes =
        messageIds.length > 0
          ? await db.select().from(messageSwipes).where(inArray(messageSwipes.messageId, messageIds))
          : [];
      return { rows: slice, swipes, total, limit, offset };
    },

    async listSessionSnapshots(chatId: string) {
      return db
        .select()
        .from(gameStateSnapshots)
        .where(eq(gameStateSnapshots.chatId, chatId))
        .orderBy(desc(gameStateSnapshots.createdAt));
    },

    async listSessionCheckpoints(chatId: string) {
      return checkpoints.listForChat(chatId);
    },

    async listSessionAgentRuns(chatId: string) {
      const [runs, memory] = await Promise.all([
        db.select().from(agentRuns).where(eq(agentRuns.chatId, chatId)).orderBy(desc(agentRuns.createdAt)),
        db.select().from(agentMemory).where(eq(agentMemory.chatId, chatId)),
      ]);
      return { runs, memory };
    },

    async listSessionAssets(chatId: string) {
      const chat = await chats.getById(chatId);
      if (!chat) return { files: [], totalBytes: 0 };
      const meta = parseMeta(chat.metadata);
      const manifest = collectSessionAssetManifest(chatId, meta);
      const images = await db.select().from(chatImages).where(eq(chatImages.chatId, chatId));
      return {
        files: manifest.files.map(({ path, size }) => ({ path, size, scope: "disk" as const })),
        chatImages: images,
        totalBytes: manifest.totalBytes,
        spriteIds: collectSpriteIds(meta),
        backgroundDir: relative(DATA_DIR, chatBackgroundPlatesDir(chatId)).split(/[\\/]/g).join("/"),
        npcAvatarDir: relative(DATA_DIR, join(NPC_AVATAR_DIR, chatId)).split(/[\\/]/g).join("/"),
        galleryDir: relative(DATA_DIR, join(GALLERY_DIR, chatId)).split(/[\\/]/g).join("/"),
        gameAssetsRoot: relative(DATA_DIR, GAME_ASSETS_DIR).split(/[\\/]/g).join("/"),
      };
    },

    async getSessionReferences(chatId: string) {
      const chat = await chats.getById(chatId);
      if (!chat) return null;
      const meta = parseMeta(chat.metadata);
      return resolveReferences(db, chat as Record<string, unknown>, meta);
    },

    async buildSessionExportPayload(chatId: string, inlineFileData = true): Promise<GameSessionExportPayload | null> {
      const chat = await chats.getById(chatId);
      if (!chat || (chat.mode as string) !== "game") return null;
      const normalized = normalizeChatRow(chat as Record<string, unknown>);
      const meta = parseMeta(chat.metadata);

      const [messages, snapshotRows, checkpointRows, agentData, images, references] = await Promise.all([
        chats.listMessages(chatId),
        db.select().from(gameStateSnapshots).where(eq(gameStateSnapshots.chatId, chatId)),
        checkpoints.listForChat(chatId),
        this.listSessionAgentRuns(chatId),
        db.select().from(chatImages).where(eq(chatImages.chatId, chatId)),
        resolveReferences(db, chat as Record<string, unknown>, meta),
      ]);

      const messageIds = messages.map((m) => m.id);
      const swipes =
        messageIds.length > 0
          ? await db.select().from(messageSwipes).where(inArray(messageSwipes.messageId, messageIds))
          : [];

      const assetManifest = collectSessionAssetManifest(chatId, meta);
      const files = readSessionExportFiles(assetManifest.files, inlineFileData);

      return {
        chat: normalized,
        messages: messages as Array<Record<string, unknown>>,
        swipes: swipes as Array<Record<string, unknown>>,
        gameStateSnapshots: snapshotRows as Array<Record<string, unknown>>,
        checkpoints: checkpointRows as Array<Record<string, unknown>>,
        agentRuns: agentData.runs as Array<Record<string, unknown>>,
        agentMemory: agentData.memory as Array<Record<string, unknown>>,
        chatImages: images as Array<Record<string, unknown>>,
        files,
        references,
      };
    },

    async buildSessionExportEnvelope(chatId: string, inlineFileData = true): Promise<ExportEnvelope<GameSessionExportPayload> | null> {
      const data = await this.buildSessionExportPayload(chatId, inlineFileData);
      if (!data) return null;
      return {
        type: "marinara_game_session",
        version: 1,
        exportedAt: new Date().toISOString(),
        data,
      };
    },

    async buildCampaignExportEnvelope(
      gameId: string,
      inlineFileData = true,
    ): Promise<ExportEnvelope<GameCampaignExportPayload> | null> {
      const sessions = await this.listCampaignSessions(gameId);
      if (sessions.length === 0) return null;
      const payloads: GameSessionExportPayload[] = [];
      for (const session of sessions) {
        const payload = await this.buildSessionExportPayload(session.chatId, inlineFileData);
        if (payload) payloads.push(payload);
      }
      return {
        type: "marinara_game_campaign",
        version: 1,
        exportedAt: new Date().toISOString(),
        data: { gameId, sessions: payloads },
      };
    },

    async patchSessionMetadata(chatId: string, metadata: MetadataPatch) {
      const chat = await chats.getById(chatId);
      if (!chat || (chat.mode as string) !== "game") return null;
      const current = parseMeta(chat.metadata);
      await chats.updateMetadata(chatId, metadata);

      const latestSnapshots = await db
        .select()
        .from(gameStateSnapshots)
        .where(eq(gameStateSnapshots.chatId, chatId))
        .orderBy(desc(gameStateSnapshots.createdAt))
        .limit(1);
      const latest = latestSnapshots[0];
      if (latest) {
        await checkpoints.create({
          chatId,
          snapshotId: latest.id,
          messageId: latest.messageId,
          label: "Admin metadata edit",
          triggerType: "manual",
          location: latest.location,
          gameState: typeof current.gameActiveState === "string" ? current.gameActiveState : null,
          weather: latest.weather,
          timeOfDay: latest.time,
        });
      }

      return metadata;
    },

    collectSessionAssetFilesForZip(chatId: string) {
      const chat = chats.getById(chatId).then((row) => {
        if (!row) return [] as Array<{ entryName: string; absPath: string }>;
        const meta = parseMeta(row.metadata);
        const manifest = collectSessionAssetManifest(chatId, meta);
        return manifest.files.map((f) => ({ entryName: `assets/${f.path}`, absPath: f.absPath }));
      });
      return chat;
    },
  };
}
