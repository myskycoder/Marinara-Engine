import type { GameMap, GameNpc, PresentCharacter } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import type { createConnectionsStorage } from "../storage/connections.storage.js";
import {
  deleteNpcAvatar,
  generateNpcPortrait,
  getInFlightNpcPortrait,
  readNpcAvatarBase64,
} from "./game-asset-generation.js";
import { deleteNpcSpriteFolder, generateNpcSprites } from "./npc-sprite-generation.service.js";
import { addNpcEntry, createJournal, type Journal } from "./journal.service.js";
import { isSameNpcName, npcNameKey, sha1HexLegacy, slugifyForFs } from "./npc-name-server.js";

type ConnectionsStorage = ReturnType<typeof createConnectionsStorage>;

export interface NpcMaterializerSettings {
  autoMaterializeNpcs?: boolean;
  autoGenerateNpcAvatars?: boolean;
  autoGenerateNpcSprites?: boolean;
  npcSpriteExpressions?: string[];
  imageConnectionId?: string | null;
}

export interface MaterializeGameNpcsInput {
  db: DB;
  connections: ConnectionsStorage;
  chatId: string;
  presentCharacters: PresentCharacter[];
  existingCharacterNames: string[];
  partyCharacterNames?: string[];
  personaName?: string | null;
  gameMap?: GameMap | null;
  currentLocation?: string | null;
  artStylePrompt?: string | null;
  settings: NpcMaterializerSettings;
}

export interface MaterializeGameNpcsResult {
  created: GameNpc[];
  skipped: number;
}

const GENERIC_NAME_KEYS = new Set([
  "guard",
  "shopkeeper",
  "merchant",
  "vendor",
  "innkeeper",
  "bartender",
  "waiter",
  "waitress",
  "soldier",
  "villager",
  "stranger",
  "man",
  "woman",
  "person",
  "customer",
  "worker",
]);

function parseMetadata(raw: unknown): Record<string, unknown> {
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

function ensureUniqueNpcId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) return baseId;
  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
}

function isGenericName(name: string): boolean {
  return GENERIC_NAME_KEYS.has(npcNameKey(name));
}

function describePresentCharacter(char: PresentCharacter): string {
  return [char.appearance, char.outfit, char.thoughts].filter((value): value is string => !!value?.trim()).join(" ");
}

function buildNpcDescription(char: PresentCharacter, location: string): string {
  const parts = [
    char.appearance?.trim() ? `Appearance: ${char.appearance.trim()}` : "",
    char.outfit?.trim() ? `Outfit: ${char.outfit.trim()}` : "",
    char.mood?.trim() ? `Initial mood: ${char.mood.trim()}` : "",
    char.thoughts?.trim() ? `Thoughts: ${char.thoughts.trim()}` : "",
  ].filter(Boolean);
  if (parts.length > 0) return parts.join("\n");
  return [`Scene role: ${char.name.trim()}`, location ? `First seen at: ${location}` : ""].filter(Boolean).join("\n");
}

function buildFirstMeetingNote(char: PresentCharacter, location: string): string {
  const details = [
    location ? `met at ${location}` : "met in the current scene",
    char.mood?.trim() ? `mood: ${char.mood.trim()}` : "",
    char.outfit?.trim() ? `outfit: ${char.outfit.trim()}` : "",
  ].filter(Boolean);
  return `First encounter (${details.join("; ")}).`;
}

function getCurrentMapLocation(map?: GameMap | null): string {
  if (!map) return "";
  if (map.type === "grid" && typeof map.partyPosition === "object") {
    const cell = map.cells?.find((candidate) => {
      if (typeof map.partyPosition !== "object") return false;
      return candidate.x === map.partyPosition.x && candidate.y === map.partyPosition.y;
    });
    return cell?.label?.trim() || "";
  }
  if (map.type === "node" && typeof map.partyPosition === "string") {
    const node = map.nodes?.find((candidate) => candidate.id === map.partyPosition);
    return node?.label?.trim() || "";
  }
  return "";
}

type MaterializeDecision =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "empty-name"
        | "protected-name"
        | "existing-character"
        | "already-materialized"
        | "generic-too-thin"
        | "generic-duplicate";
      detail?: string;
    };

function shouldMaterializeCharacter(args: {
  char: PresentCharacter;
  existingNpcs: GameNpc[];
  existingCharacterNames: string[];
  protectedNames: string[];
}): MaterializeDecision {
  const name = args.char.name?.trim();
  if (!name) return { ok: false, reason: "empty-name" };

  const protectedHit = args.protectedNames.find((protectedName) => isSameNpcName(name, protectedName));
  if (protectedHit) return { ok: false, reason: "protected-name", detail: protectedHit };

  const characterHit = args.existingCharacterNames.find((characterName) => isSameNpcName(name, characterName));
  if (characterHit) return { ok: false, reason: "existing-character", detail: characterHit };

  const npcHit = args.existingNpcs.find((npc) => isSameNpcName(name, npc.name));
  if (npcHit) return { ok: false, reason: "already-materialized", detail: npcHit.name };

  const descriptor = describePresentCharacter(args.char);
  if (isGenericName(name)) {
    if (descriptor.trim().length < 12) return { ok: false, reason: "generic-too-thin" };
    const matchingGeneric = args.existingNpcs.find(
      (npc) => isGenericName(npc.name) || isSameNpcName(name, npc.name),
    );
    if (matchingGeneric) return { ok: false, reason: "generic-duplicate", detail: matchingGeneric.name };
  }

  return { ok: true };
}

function makeGameNpc(char: PresentCharacter, location: string, existingIds: Set<string>): GameNpc {
  const id = ensureUniqueNpcId(slugifyForFs(char.name, { prefix: "npc", hashHex: sha1HexLegacy }), existingIds);
  existingIds.add(id);
  return {
    id,
    name: char.name.trim(),
    emoji: char.emoji?.trim() || "👤",
    description: buildNpcDescription(char, location),
    location,
    reputation: 0,
    met: true,
    notes: [buildFirstMeetingNote(char, location)],
    avatarUrl: char.avatarPath ?? null,
  };
}

function ensureNpcAssetDescription(npc: GameNpc): GameNpc {
  if (npc.description?.trim()) return npc;
  return {
    ...npc,
    description: [`Scene role: ${npc.name}`, npc.location ? `Known location: ${npc.location}` : ""]
      .filter(Boolean)
      .join("\n"),
  };
}

function isPresentNpc(npc: GameNpc, presentCharacters: PresentCharacter[]): boolean {
  return presentCharacters.some((char) => isSameNpcName(char.name, npc.name));
}

function resolveImageConnectionId(settings: NpcMaterializerSettings, meta: Record<string, unknown>): string | null {
  const settingsId = settings.imageConnectionId?.trim();
  if (settingsId) return settingsId;
  const metaId = typeof meta.gameImageConnectionId === "string" ? meta.gameImageConnectionId.trim() : "";
  return metaId || null;
}

async function patchNpcAvatarUrl(db: DB, chatId: string, npcId: string, avatarUrl: string): Promise<void> {
  const chats = createChatsStorage(db);
  let stored = false;
  await chats.updateMetadataWithMerge(chatId, (meta) => {
    const npcs = Array.isArray(meta.gameNpcs) ? ([...(meta.gameNpcs as GameNpc[])] as GameNpc[]) : [];
    let changed = false;
    const nextNpcs = npcs.map((npc) => {
      if (npc.id !== npcId || npc.avatarUrl) return npc;
      changed = true;
      return { ...npc, avatarUrl };
    });
    if (!changed) return null;
    stored = true;
    return { ...meta, gameNpcs: nextNpcs };
  });
  if (stored) {
    logger.info("[npc-materializer] Stored avatarUrl for npc id=%s in chat %s → %s", npcId, chatId, avatarUrl);
  } else {
    logger.debug(
      "[npc-materializer] patchNpcAvatarUrl: no matching npc id=%s in chat %s (or avatarUrl already set)",
      npcId,
      chatId,
    );
  }
}

async function patchNpcSpriteStatus(
  db: DB,
  chatId: string,
  npcId: string,
  spriteId: string,
  spriteStatus: NonNullable<GameNpc["spriteStatus"]>,
): Promise<void> {
  const chats = createChatsStorage(db);
  await chats.updateMetadataWithMerge(chatId, (meta) => {
    const npcs = Array.isArray(meta.gameNpcs) ? ([...(meta.gameNpcs as GameNpc[])] as GameNpc[]) : [];
    let changed = false;
    const nextNpcs = npcs.map((npc) => {
      if (npc.id !== npcId) return npc;
      changed = true;
      return {
        ...npc,
        spriteId: npc.spriteId || spriteId,
        spriteStatus,
      };
    });
    if (!changed) return null;
    return { ...meta, gameNpcs: nextNpcs };
  });
}

/**
 * Unified per-NPC asset pipeline: avatar → sprite, sequentially per NPC.
 *
 * Replaces the old fire-and-forget `startNpcAvatarGeneration` +
 * `startNpcSpriteGeneration` pair. Running them concurrently caused two
 * problems:
 *   1. Sprite generation almost always lost the race against avatar
 *      generation, ending up with `ref=none` and producing full-body
 *      figures that didn't match the dialogue portrait.
 *   2. Both tasks did their own `connections.getWithKey(...)` lookup,
 *      doubling DB hits per turn.
 *
 * The unified pipeline does one connection lookup, then for each NPC:
 *   - generates the portrait (if avatars enabled) → patches metadata
 *   - generates the VN sprite (if sprites enabled) using the freshly
 *     created portrait as the visual reference (read from disk)
 *
 * NPCs are still processed in series — image generation is bandwidth-bound
 * and image providers usually rate-limit per key, so parallelism here would
 * just shift congestion onto the API. Different chats/turns remain
 * independent because each turn fires its own pipeline.
 */
function startNpcAssetPipeline(args: {
  db: DB;
  connections: ConnectionsStorage;
  chatId: string;
  createdNpcs: GameNpc[];
  imageConnectionId: string;
  generateAvatars: boolean;
  generateSprites: boolean;
  spriteExpressions: string[];
  artStylePrompt?: string | null;
}): void {
  const npcsNeedingAvatars = args.generateAvatars
    ? args.createdNpcs.filter((npc) => !npc.avatarUrl && npc.id)
    : [];
  const npcsNeedingSprites = args.generateSprites
    ? args.createdNpcs.filter((npc) => npc.spriteId && npc.spriteStatus === "pending")
    : [];
  if (npcsNeedingAvatars.length === 0 && npcsNeedingSprites.length === 0) return;

  if (npcsNeedingAvatars.length > 0) {
    logger.info(
      "[npc-materializer] Avatar generation queued for %d NPC(s) in chat %s: %s",
      npcsNeedingAvatars.length,
      args.chatId,
      npcsNeedingAvatars.map((n) => `${n.name}(${n.id})`).join(", "),
    );
  }
  if (npcsNeedingSprites.length > 0) {
    logger.info(
      "[npc-materializer] Sprite generation queued for %d NPC(s) in chat %s: %s (expressions=[%s])",
      npcsNeedingSprites.length,
      args.chatId,
      npcsNeedingSprites.map((n) => `${n.name}(${n.id})`).join(", "),
      args.spriteExpressions.join(", ") || "<default>",
    );
  }

  // Build the union set so each NPC visits the pipeline once.
  const npcsToProcess: GameNpc[] = [];
  const seen = new Set<string>();
  for (const npc of [...npcsNeedingAvatars, ...npcsNeedingSprites]) {
    if (seen.has(npc.id)) continue;
    seen.add(npc.id);
    npcsToProcess.push(npc);
  }

  void (async () => {
    try {
      const connection = await args.connections.getWithKey(args.imageConnectionId);
      if (!connection) {
        logger.warn("[npc-materializer] Image connection %s not found for NPC assets", args.imageConnectionId);
        return;
      }

      for (const npc of npcsToProcess) {
        // ── Phase 1: Avatar (so the sprite below can use it as a reference) ──
        const wantAvatar = args.generateAvatars && !npc.avatarUrl && npc.id;
        if (wantAvatar) {
          try {
            const avatarUrl = await generateNpcPortrait({
              chatId: args.chatId,
              npcId: npc.id,
              npcName: npc.name,
              appearance: npc.description,
              artStyle: args.artStylePrompt || undefined,
              imgSource: connection.imageGenerationSource,
              imgModel: connection.model || "",
              imgBaseUrl: connection.baseUrl || "https://image.pollinations.ai",
              imgApiKey: connection.apiKey || "",
              imgService: connection.imageService || connection.imageGenerationSource,
              imgComfyWorkflow: connection.comfyuiWorkflow || undefined,
            });
            if (avatarUrl) {
              await patchNpcAvatarUrl(args.db, args.chatId, npc.id, avatarUrl);
            }
          } catch (err) {
            logger.error(err, "[npc-materializer] Avatar generation failed for '%s' (id=%s)", npc.name, npc.id);
          }
        }

        // ── Phase 2: Sprite ──
        if (!args.generateSprites || !npc.spriteId || npc.spriteStatus !== "pending") {
          continue;
        }
        const spriteId = npc.spriteId;

        // The portrait we just generated lives at `npcAvatarFilePath`. If a
        // concurrent caller (e.g. the legacy `/game/generate-assets` route)
        // owns the in-flight portrait promise, await it so we don't read a
        // half-written file. `generateNpcPortrait` itself coalesces, so this
        // wait is cheap and doesn't double-spend on the API.
        const portraitInFlight = getInFlightNpcPortrait(args.chatId, npc.id);
        if (portraitInFlight) {
          try {
            await portraitInFlight;
          } catch {
            // Failure already logged inside generateNpcPortrait — fall through
            // to text-only sprite generation below.
          }
        }

        // Image providers (e.g. Gemini via OpenRouter) require base64 bytes
        // in `inline_data.data`, NOT a public URL. Reading from disk gives us
        // the bytes; missing-file → undefined → text-only generation.
        const referenceBase64 = readNpcAvatarBase64(args.chatId, npc.id);
        logger.debug(
          "[npc-materializer] Generating sprites for '%s' (id=%s, sprite=%s, ref=%s)",
          npc.name,
          npc.id,
          spriteId,
          referenceBase64 ? "avatar-bytes" : "no-avatar",
        );

        try {
          const ok = await generateNpcSprites({
            chatId: args.chatId,
            npc,
            spriteId,
            expressions: args.spriteExpressions,
            artStyle: args.artStylePrompt || undefined,
            imgSource: connection.imageGenerationSource,
            imgModel: connection.model || "",
            imgBaseUrl: connection.baseUrl || "https://image.pollinations.ai",
            imgApiKey: connection.apiKey || "",
            imgService: connection.imageService || connection.imageGenerationSource,
            imgComfyWorkflow: connection.comfyuiWorkflow || undefined,
            referenceImage: referenceBase64,
          });
          await patchNpcSpriteStatus(args.db, args.chatId, npc.id, spriteId, ok ? "ready" : "failed");
          if (ok) {
            logger.info("[npc-materializer] Sprite generation succeeded for '%s' (id=%s)", npc.name, npc.id);
          } else {
            logger.warn("[npc-materializer] Sprite generation failed for '%s' (id=%s)", npc.name, npc.id);
          }
        } catch (err) {
          logger.error(err, "[npc-materializer] Sprite generation threw for '%s' (id=%s)", npc.name, npc.id);
          await patchNpcSpriteStatus(args.db, args.chatId, npc.id, spriteId, "failed");
        }
      }
    } catch (err) {
      logger.error(err, "[npc-materializer] NPC asset pipeline failed");
    }
  })();
}

/**
 * User-triggered manual regeneration for a single NPC's assets.
 *
 * Differs from the automatic pipeline (`startNpcAssetPipeline`) in two ways:
 *   1. We deliberately delete the existing avatar file and/or sprite folder
 *      first — both `generateNpcPortrait` and `generateNpcSprites` short-circuit
 *      when their output already exists on disk, so without deletion this
 *      endpoint would be a no-op for any NPC that already has assets.
 *   2. We reset metadata fields (`avatarUrl = undefined`, `spriteStatus =
 *      "pending"`) up-front, which both makes the `assetCandidates` filter
 *      pick up this NPC again AND signals the client to show a loading state
 *      via the existing `useNpcAssetWatcher` polling.
 *
 * Returns `{ ok, npcId, regenerated }` so the route handler can report what
 * was actually scheduled. Image generation itself is fire-and-forget; the
 * client picks up new assets via React Query invalidation + the watcher.
 */
export interface RegenerateNpcAssetsInput {
  db: DB;
  connections: ConnectionsStorage;
  chatId: string;
  npcId: string;
  /** What to regenerate. Defaults to both. */
  regenerateAvatar?: boolean;
  regenerateSprite?: boolean;
  /** Sprite expressions for re-generation. Falls back to chat's setting then default. */
  spriteExpressions?: string[];
  /** Art style prompt; falls back to chat's gameSetupConfig.artStylePrompt. */
  artStylePrompt?: string | null;
}

export interface RegenerateNpcAssetsResult {
  ok: boolean;
  npcId: string;
  npcName: string | null;
  regenerated: { avatar: boolean; sprite: boolean };
  reason?: "npc-not-found" | "no-image-connection" | "nothing-to-do";
}

export async function regenerateNpcAssets(
  input: RegenerateNpcAssetsInput,
): Promise<RegenerateNpcAssetsResult> {
  const wantAvatar = input.regenerateAvatar !== false;
  const wantSprite = input.regenerateSprite !== false;
  if (!wantAvatar && !wantSprite) {
    return { ok: false, npcId: input.npcId, npcName: null, regenerated: { avatar: false, sprite: false }, reason: "nothing-to-do" };
  }

  const chats = createChatsStorage(input.db);

  // Atomic read-modify-write: another writer (auto pipeline, scene-wrap,
  // concurrent regenerate) may have updated the same NPC entry between
  // our read and write. Holder is a property-typed object so TS keeps the
  // declared union types after the merge callback executes.
  const holder: {
    npc: GameNpc | null;
    imageConnectionId: string | null;
    next: GameNpc | null;
    meta: Record<string, unknown> | null;
  } = { npc: null, imageConnectionId: null, next: null, meta: null };
  await chats.updateMetadataWithMerge(input.chatId, (meta) => {
    const npcs = Array.isArray(meta.gameNpcs) ? ([...(meta.gameNpcs as GameNpc[])] as GameNpc[]) : [];
    const found = npcs.find((candidate) => candidate.id === input.npcId);
    if (!found) return null;
    const imageConnectionId = (meta.gameImageConnectionId as string | null | undefined) || null;
    holder.npc = found;
    holder.imageConnectionId = imageConnectionId;
    holder.meta = meta;
    if (!imageConnectionId) return null;

    const next: GameNpc = { ...found };
    if (wantAvatar) {
      next.avatarUrl = undefined;
    }
    if (wantSprite) {
      next.spriteId = found.spriteId || `game-npc-${input.chatId}-${found.id}`;
      next.spriteStatus = "pending";
    }
    holder.next = next;
    const nextNpcs = npcs.map((n) => (n.id === found.id ? next : n));
    return { ...meta, gameNpcs: nextNpcs };
  });

  if (!holder.npc) {
    logger.warn("[npc-materializer] regenerate: npc %s not found in chat %s", input.npcId, input.chatId);
    return { ok: false, npcId: input.npcId, npcName: null, regenerated: { avatar: false, sprite: false }, reason: "npc-not-found" };
  }
  if (!holder.imageConnectionId || !holder.next || !holder.meta) {
    logger.warn(
      "[npc-materializer] regenerate: no image connection configured for chat %s — cannot regenerate assets",
      input.chatId,
    );
    return {
      ok: false,
      npcId: input.npcId,
      npcName: holder.npc.name,
      regenerated: { avatar: false, sprite: false },
      reason: "no-image-connection",
    };
  }
  const npc = holder.npc;
  const imageConnectionId = holder.imageConnectionId;
  const next = holder.next;
  const meta = holder.meta;

  // Now nuke the on-disk artifacts so the generators won't short-circuit.
  if (wantAvatar) {
    deleteNpcAvatar(input.chatId, npc.id);
  }
  if (wantSprite && next.spriteId) {
    deleteNpcSpriteFolder(next.spriteId);
  }

  logger.info(
    "[npc-materializer] Regenerating assets for '%s' (id=%s, chat=%s) — avatar=%s, sprite=%s",
    npc.name,
    npc.id,
    input.chatId,
    wantAvatar ? "yes" : "no",
    wantSprite ? "yes" : "no",
  );

  // Resolve art style prompt fallback chain: caller → chat setup → none.
  const setupCfg = (meta.gameSetupConfig as Record<string, unknown> | null | undefined) ?? null;
  const fallbackArtStyle = (setupCfg?.artStylePrompt as string | undefined) ?? null;
  const artStyle = input.artStylePrompt ?? fallbackArtStyle;

  // Sprite expressions fallback: caller → chat setting → DEFAULT_SPRITE_EXPRESSIONS.
  const fallbackExpressions = Array.isArray(meta.npcSpriteExpressions)
    ? (meta.npcSpriteExpressions as string[])
    : [];

  startNpcAssetPipeline({
    db: input.db,
    connections: input.connections,
    chatId: input.chatId,
    createdNpcs: [next],
    imageConnectionId,
    generateAvatars: wantAvatar,
    generateSprites: wantSprite,
    spriteExpressions: input.spriteExpressions ?? fallbackExpressions,
    artStylePrompt: artStyle,
  });

  return {
    ok: true,
    npcId: input.npcId,
    npcName: npc.name,
    regenerated: { avatar: wantAvatar, sprite: wantSprite },
  };
}

export async function materializeGameNpcs(input: MaterializeGameNpcsInput): Promise<MaterializeGameNpcsResult> {
  const presentNames = input.presentCharacters.map((char) => char.name?.trim() || "<empty>");
  if (!input.settings.autoMaterializeNpcs) {
    logger.debug(
      "[npc-materializer] autoMaterializeNpcs=false → not creating gameNpcs (chat=%s, presentCharacters=%d: %s). Enable Character Tracker → 'Materialize new tracked NPCs' to turn this on.",
      input.chatId,
      input.presentCharacters.length,
      presentNames.join(", ") || "—",
    );
    return { created: [], skipped: input.presentCharacters.length };
  }

  const chats = createChatsStorage(input.db);

  // Atomic RMW: existing NPCs may grow between our snapshot and the write
  // (concurrent turn finishing, manual regenerate). We do candidate selection
  // inside the merge callback against the freshest metadata. Property-typed
  // holder keeps TS narrowing stable across the callback boundary.
  const resultHolder: {
    value: {
      created: GameNpc[];
      skipped: number;
      nextNpcs: GameNpc[];
      imageConnectionId: string | null;
    } | null;
  } = { value: null };

  const updated = await chats.updateMetadataWithMerge(input.chatId, (meta) => {
    const existingNpcs = Array.isArray(meta.gameNpcs) ? ([...(meta.gameNpcs as GameNpc[])] as GameNpc[]) : [];
    const imageConnectionId = resolveImageConnectionId(input.settings, meta);
    const location = input.currentLocation?.trim() || getCurrentMapLocation(input.gameMap) || "";
    const protectedNames = [input.personaName, ...(input.partyCharacterNames ?? [])]
      .filter((name): name is string => !!name?.trim())
      .map((name) => name.trim());
    const existingIds = new Set(existingNpcs.map((npc) => npc.id).filter(Boolean));

    logger.debug(
      "[npc-materializer] chat=%s presentCharacters=%d (%s); existingNpcs=%d; existingCharacters=%d; persona=%s; imageConn=%s; flags={avatars:%s, sprites:%s}",
      input.chatId,
      input.presentCharacters.length,
      presentNames.join(", ") || "—",
      existingNpcs.length,
      input.existingCharacterNames.length,
      input.personaName ?? "—",
      imageConnectionId ?? "—",
      input.settings.autoGenerateNpcAvatars ? "on" : "off",
      input.settings.autoGenerateNpcSprites ? "on" : "off",
    );

    const created: GameNpc[] = [];
    let skipped = 0;
    for (const char of input.presentCharacters) {
      const decision = shouldMaterializeCharacter({
        char,
        existingNpcs: [...existingNpcs, ...created],
        existingCharacterNames: input.existingCharacterNames,
        protectedNames,
      });
      if (!decision.ok) {
        skipped += 1;
        logger.debug(
          "[npc-materializer] Skipping '%s' — %s%s",
          char.name?.trim() || "<unnamed>",
          decision.reason,
          decision.detail ? ` (matched: ${decision.detail})` : "",
        );
        continue;
      }
      const npc = makeGameNpc(char, location, existingIds);
      if (input.settings.autoGenerateNpcSprites && imageConnectionId) {
        npc.spriteId = `game-npc-${input.chatId}-${npc.id}`;
        npc.spriteStatus = "pending";
      }
      created.push(npc);
      logger.info("[npc-materializer] Materializing new NPC '%s' (id=%s) in chat %s", npc.name, npc.id, input.chatId);
    }

    const existingJournal = (meta.gameJournal as Journal | undefined) ?? createJournal();
    const nextJournal = created.reduce((journal, npc) => {
      const mood = input.presentCharacters.find((char) => isSameNpcName(char.name, npc.name))?.mood?.trim();
      const interaction = mood ? `Encountered (${mood})` : "Encountered";
      return addNpcEntry(journal, npc, interaction);
    }, existingJournal);

    const nextNpcs = [...existingNpcs, ...created].map((npc) => {
      if (!isPresentNpc(npc, input.presentCharacters)) return npc;
      let next = ensureNpcAssetDescription(npc);
      if (
        input.settings.autoGenerateNpcSprites &&
        imageConnectionId &&
        !next.spriteId &&
        next.spriteStatus !== "ready" &&
        next.spriteStatus !== "pending"
      ) {
        next = {
          ...next,
          spriteId: `game-npc-${input.chatId}-${next.id}`,
          spriteStatus: "pending",
        };
      }
      return next;
    });
    const hasNpcChanges =
      created.length > 0 ||
      JSON.stringify(nextNpcs.map((npc) => [npc.id, npc.description, npc.spriteId, npc.spriteStatus])) !==
        JSON.stringify([...existingNpcs, ...created].map((npc) => [npc.id, npc.description, npc.spriteId, npc.spriteStatus]));

    resultHolder.value = { created, skipped, nextNpcs, imageConnectionId };

    if (!hasNpcChanges) return null;
    return {
      ...meta,
      gameNpcs: nextNpcs,
      ...(created.length > 0 ? { gameJournal: nextJournal } : {}),
    };
  });

  if (!updated || !resultHolder.value) {
    logger.warn("[npc-materializer] Chat %s not found while materializing NPCs", input.chatId);
    return { created: [], skipped: input.presentCharacters.length };
  }

  const { created, skipped, nextNpcs, imageConnectionId } = resultHolder.value;
  const createdIds = new Set(created.map((npc) => npc.id));

  logger.debug(
    "[npc-materializer] chat=%s done: created=%d, skipped=%d, totalNpcs=%d",
    input.chatId,
    created.length,
    skipped,
    nextNpcs.length,
  );

  const assetCandidates = nextNpcs.filter(
    (npc) => isPresentNpc(npc, input.presentCharacters) && (createdIds.has(npc.id) || !npc.avatarUrl || npc.spriteStatus !== "ready"),
  );

  if (imageConnectionId && (input.settings.autoGenerateNpcAvatars || input.settings.autoGenerateNpcSprites)) {
    startNpcAssetPipeline({
      db: input.db,
      connections: input.connections,
      chatId: input.chatId,
      createdNpcs: assetCandidates,
      imageConnectionId,
      generateAvatars: !!input.settings.autoGenerateNpcAvatars,
      generateSprites: !!input.settings.autoGenerateNpcSprites,
      spriteExpressions: input.settings.npcSpriteExpressions ?? [],
      artStylePrompt: input.artStylePrompt,
    });
  }

  return { created, skipped };
}
