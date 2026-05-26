// ──────────────────────────────────────────────
// Routes: Game Mode
// ──────────────────────────────────────────────
import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { extname, join } from "path";
import { z } from "zod";
import { logger, logDebugOverride } from "../lib/logger.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createGalleryStorage } from "../services/storage/gallery.storage.js";
import { createGameStateStorage } from "../services/storage/game-state.storage.js";
import { createLorebooksStorage } from "../services/storage/lorebooks.storage.js";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { enterAiAuditContext } from "../services/ai-audit/audit-context.js";
import { extractLeadingThinkingBlocks } from "../services/llm/inline-thinking.js";
import { fitMessagesToContext, type ChatMessage, type ChatOptions } from "../services/llm/base-provider.js";
import { isDiceNotation, rollDice } from "../services/game/dice.service.js";
import { parseGameJsonish } from "../services/game/jsonish.js";
import { validateTransition } from "../services/game/state-machine.service.js";
import {
  buildSetupPrompt,
  buildGmSystemPrompt,
  buildSessionConclusionPrompt,
  buildCampaignProgressionPrompt,
  buildPartyRecruitCardPrompt,
  type GmPromptContext,
} from "../services/game/gm-prompts.js";
import { buildPartySystemPrompt } from "../services/game/party-prompts.js";
import {
  buildPromptMacroContext,
  getCharacterDescriptionWithExtensions,
  resolveMacrosWithVariableSnapshot,
} from "../services/prompt/index.js";
import { listPartySprites, readPreferredFullBodySpriteBase64 } from "../services/game/sprite.service.js";
import {
  buildSceneAnalyzerSystemPrompt,
  buildSceneAnalyzerUserPrompt,
  type SceneAnalyzerContext,
} from "../services/sidecar/scene-analyzer.js";
import {
  normalizeSceneLocationId,
  postProcessSceneResult,
  type PostProcessContext,
} from "../services/sidecar/scene-postprocess.js";
import { buildRecapPrompt } from "../services/game/session.service.js";
import { buildMapGenerationPrompt } from "../services/game/map.service.js";
import {
  ensureGameMapId,
  getGameMapId,
  getGameMapsFromMeta,
  syncGameMapMetaPartyPosition,
  withActiveGameMapMeta,
} from "../services/game/map-position.service.js";
import { resolveCombatRound, type CombatantStats } from "../services/game/combat.service.js";
import { getElementPreset, listElementPresets } from "../services/game/element-reactions.service.js";
import { generateCombatLoot, generateLootTable } from "../services/game/loot.service.js";
import {
  advanceTime,
  formatGameTime,
  createInitialTime,
  setTimeOfDay,
  type GameTime,
  type TimeOfDay,
} from "../services/game/time.service.js";
import { generateWeather, inferBiome, shouldWeatherChange } from "../services/game/weather.service.js";
import { rollEncounter, rollEnemyCount } from "../services/game/encounter.service.js";
import { processReputationActions } from "../services/game/reputation.service.js";
import { sanitizeGameNpcAvatarUrls } from "../services/game/npc-avatar-utils.js";
import { createCheckpointService, type CheckpointTrigger } from "../services/game/checkpoint.service.js";
import { copyBranchMessagesAndSnapshots } from "../services/chats/branch-chat-copy.service.js";
import { remapBackgroundChatTagsInMetadata } from "../services/game/game-fork-metadata.service.js";
import { copyGameCheckpointsForFork } from "../services/game/copy-checkpoints-for-fork.service.js";
import { resolveSkillCheck } from "../services/game/skill-check.service.js";
import {
  lookupPlayerModifiers,
  validateOrResolveSkillCheckTags,
} from "../services/game/skill-check-validator.js";
import { applyAllSegmentEdits, stripGmCommandTags } from "../services/game/segment-edits.js";
import { processLorebooks } from "../services/lorebook/index.js";
import { GAME_LOREBOOK_KEEPER_SOURCE_ID } from "../services/lorebook/game-lorebook-scope.js";
import {
  applyMoraleEvent,
  getMoraleTier,
  formatMoraleContext,
  type MoraleEvent,
} from "../services/game/morale.service.js";
import {
  createJournal,
  addLocationEntry,
  addCombatEntry,
  addEventEntry,
  addNoteEntry,
  addInventoryEntry,
  addNpcEntry,
  upsertQuest,
  buildStructuredRecap,
  type Journal,
} from "../services/game/journal.service.js";
import { dedupeSessionSummaryLists } from "../services/game/session-summary-normalization.js";
import {
  generationParametersSchema,
  resolveMacros,
  scoreMusic,
  scoreAmbient,
  GAME_MODE_DEFAULT_AGENT_IDS,
  stripGameInlineTagsForContext,
} from "@marinara-engine/shared";
import { mergeCustomParameters } from "./generate/generate-route-utils.js";
import { postToDiscordWebhook } from "../services/discord-webhook.js";
import { isDebugAgentsEnabled } from "../config/runtime-config.js";
import type {
  GameActiveState,
  GameSetupConfig,
  GameMap,
  GameNpc,
  GenerationParameters,
  PresentCharacter,
  SceneIllustrationRequest,
  QuestProgress,
  SessionSummary,
  PartyArc,
  LocationCatalogEntry,
  LocationCatalogVariant,
  Season,
  PendingBackgroundGeneration,
  HudWidget,
} from "@marinara-engine/shared";
import type { IllustrationCooldownInput } from "@marinara-engine/shared";
import {
  canRequestAutoCgIllustration,
  isIllustrationCooldownSatisfied,
  normalizeGameCgFrequency,
  isGameCgAutoEnabled,
} from "@marinara-engine/shared";
import { getAssetManifest, GAME_ASSETS_DIR } from "../services/game/asset-manifest.service.js";
import {
  GENERATED_GAME_BACKGROUND_EXTS,
  generateNpcPortrait,
  generateBackground,
  generateSceneIllustration,
  findCachedBackground,
  buildBackgroundCacheKey,
  backgroundTagForChat,
  readAvatarBase64,
  readBackgroundBase64,
  type BackgroundConditions,
  buildBackgroundImagePrompt,
  buildNpcPortraitImagePrompt,
  buildSceneIllustrationImagePrompt,
} from "../services/game/game-asset-generation.js";
import { buildIllustrationContinuity, excerptNarrationForIllustration } from "../services/game/scene-illustration-context.js";
import { rewriteIllustrationPrompt } from "../services/game/image-prompt-writer.js";
import { recordIllustrationSkip, type IllustrationSkipReason } from "../services/game/illustration-audit.js";
import {
  regenerateNpcAssets,
  scheduleNpcFullBodyEmotionSet,
  setActiveNpcSpriteGeneration,
} from "../services/game/npc-materializer.service.js";
import { npcNameKey, sha1HexLegacy, slugifyForFs } from "../services/game/npc-name-server.js";
import { saveImageToDisk } from "../services/image/image-generation.js";
import { resolveConnectionImageDefaults } from "../services/image/image-generation-defaults.js";
import {
  loadImageGenerationUserSettings,
  type ImageGenerationSize,
} from "../services/image/image-generation-settings.js";
import { createPromptOverridesStorage } from "../services/storage/prompt-overrides.storage.js";
import {
  buildGameSpotifySceneQuery,
  getGameSpotifyCandidates,
  getGameSpotifyErrorStatus,
  playGameSpotifyTrack,
} from "../services/spotify/game-spotify-music.service.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const AVATAR_NAME_TITLE_WORDS = new Set([
  "a",
  "an",
  "the",
  "il",
  "lo",
  "la",
  "le",
  "l",
  "el",
  "sir",
  "lady",
  "lord",
  "professor",
]);

function normalizeAvatarLookupName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function avatarLookupAliases(value: string): string[] {
  const normalized = normalizeAvatarLookupName(value);
  const words = normalized.split(/\s+/).filter(Boolean);
  const withoutLeadingTitle =
    words.length > 1 && AVATAR_NAME_TITLE_WORDS.has(words[0]!) ? words.slice(1).join(" ") : normalized;
  return Array.from(
    new Set([
      value.trim().toLowerCase(),
      normalized,
      withoutLeadingTitle,
      ...words.filter((word) => word.length >= 3 && !AVATAR_NAME_TITLE_WORDS.has(word)),
    ]),
  ).filter(Boolean);
}

export function addNameLookupEntry(map: Map<string, string>, name: unknown, value: unknown): void {
  if (typeof name !== "string" || typeof value !== "string") return;
  const trimmedValue = value.trim();
  if (!trimmedValue) return;
  for (const alias of avatarLookupAliases(name)) {
    map.set(alias, trimmedValue);
  }
}

function generatedStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      generatedStringValue(record.name) ??
      generatedStringValue(record.label) ??
      generatedStringValue(record.id) ??
      generatedStringValue(record.type)
    );
  }
  return undefined;
}

const generatedRequiredStringSchema = z.preprocess((value) => generatedStringValue(value) ?? value, z.string());
const generatedOptionalStringSchema = z.preprocess((value) => generatedStringValue(value), z.string().optional());

/**
 * Fuzzy-match an NPC name against the character-avatar/description map.
 * Title aliases make "Il Dottore" resolve to a saved "Dottore" card and
 * "Il Capitano" resolve to "Capitano" before any image generation is attempted.
 */
export function findCharAvatarFuzzy(npcName: string, charAvatarByName: Map<string, string>): string | undefined {
  const npcAliases = avatarLookupAliases(npcName);

  // 1. Exact
  for (const alias of npcAliases) {
    const exact = charAvatarByName.get(alias);
    if (exact) return exact;
  }

  // 2. Any character alias that overlaps the NPC aliases.
  for (const [charName, avatar] of charAvatarByName) {
    const charAliases = avatarLookupAliases(charName);
    for (const npcAlias of npcAliases) {
      for (const charAlias of charAliases) {
        if (npcAlias === charAlias) return avatar;
        if (charAlias.length >= 3 && npcAlias.includes(charAlias)) return avatar;
        if (npcAlias.length >= 3 && charAlias.includes(npcAlias)) return avatar;
      }
    }
  }

  return undefined;
}

function currentGameSessionNumber(meta: Record<string, unknown>): number | null {
  return typeof meta.gameSessionNumber === "number" && Number.isFinite(meta.gameSessionNumber)
    ? meta.gameSessionNumber
    : null;
}

function illustrationCooldownInputFromMeta(
  meta: Record<string, unknown>,
  turnNumber: number,
): IllustrationCooldownInput {
  return {
    preset: normalizeGameCgFrequency(meta.gameCgFrequency),
    turnNumber,
    lastIllustrationTurn: typeof meta.gameLastIllustrationTurn === "number" ? meta.gameLastIllustrationTurn : 0,
    sessionNumber: currentGameSessionNumber(meta),
    lastIllustrationSession:
      typeof meta.gameLastIllustrationSessionNumber === "number" &&
      Number.isFinite(meta.gameLastIllustrationSessionNumber)
        ? meta.gameLastIllustrationSessionNumber
        : null,
  };
}

function isIllustrationAllowed(meta: Record<string, unknown>, turnNumber: number): boolean {
  return isIllustrationCooldownSatisfied(illustrationCooldownInputFromMeta(meta, turnNumber));
}

function canAutoCgIllustrationForChat(
  meta: Record<string, unknown>,
  turnNumber: number,
  enableGen: boolean,
  imgConnId: string | null | undefined,
): boolean {
  return canRequestAutoCgIllustration({
    ...illustrationCooldownInputFromMeta(meta, turnNumber),
    imageGenEnabled: enableGen,
    hasImageConnection: !!imgConnId,
  });
}

function extractCharacterAppearanceText(characterData: Record<string, unknown>): string {
  const extensions =
    characterData.extensions && typeof characterData.extensions === "object"
      ? (characterData.extensions as Record<string, unknown>)
      : null;
  const appearance =
    typeof extensions?.appearance === "string" && extensions.appearance.trim()
      ? extensions.appearance.trim()
      : typeof characterData.appearance === "string" && characterData.appearance.trim()
        ? characterData.appearance.trim()
        : "";
  const description = typeof characterData.description === "string" ? characterData.description.trim() : "";
  return [appearance, description].filter(Boolean).join("; ").slice(0, 500);
}

function collectIllustrationCharacterAssets(opts: {
  illustration: SceneIllustrationRequest;
  characterNames: string[];
  trackedNpcs: Array<Record<string, unknown>>;
  gameNpcs: GameNpc[];
  charReferenceByName: Map<string, string>;
  charAvatarByName: Map<string, string>;
  charDescriptionByName: Map<string, string>;
  backgroundTag?: string | null;
}): {
  referenceImages: string[];
  /**
   * Image-asset pipeline appearance fallback: only includes characters who do
   * NOT have an attached reference image (avatar/sprite). Kept for the
   * existing `generateSceneIllustration` flow which already gets the
   * reference images directly.
   */
  characterDescriptions: string[];
  /**
   * Broader name list for the image-prompt-writer agent: union of (sidecar
   * draft + character-tracker present + NPC card metadata). Useful when the
   * sidecar's draft only listed a subset of who is actually on-screen.
   */
  characterNamesForRewriter: string[];
  /**
   * Full appearance descriptions for the image-prompt-writer — collected for
   * EVERY known character in the broad name list, regardless of whether they
   * also have a reference image. The rewriter is text-only and needs the
   * description to emit correct booru tags (hair, eyes, build, etc.).
   */
  characterDescriptionsForRewriter: string[];
} {
  const dedupeNames = (names: string[], limit: number): string[] => {
    const seenKeys = new Set<string>();
    const out: string[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const key = npcNameKey(trimmed);
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push(trimmed);
      if (out.length >= limit) break;
    }
    return out;
  };

  const npcAvatarByName = new Map<string, string>();
  const npcDescriptionByName = new Map<string, string>();
  // `gameNpcs` (persisted metadata) is authoritative; `trackedNpcs` is often a snapshot and can lag after regen.
  for (const npc of opts.gameNpcs) {
    if (npc.name && npc.avatarUrl) npcAvatarByName.set(npc.name.toLowerCase(), npc.avatarUrl);
    if (npc.name && npc.description) npcDescriptionByName.set(npc.name.toLowerCase(), npc.description);
  }
  for (const npc of opts.trackedNpcs) {
    const name = typeof npc.name === "string" ? npc.name : null;
    const avatarUrl = typeof npc.avatarUrl === "string" ? npc.avatarUrl : null;
    const description = typeof npc.description === "string" ? npc.description.trim() : "";
    const key = name?.toLowerCase();
    if (name && key && avatarUrl && !npcAvatarByName.has(key)) npcAvatarByName.set(key, avatarUrl);
    if (name && key && description && !npcDescriptionByName.has(key)) npcDescriptionByName.set(key, description);
  }

  // Existing logic: image-asset pipeline references + appearance fallback.
  // Sidecar's `illustration.characters` wins when non-empty.
  const requestedNames = (opts.illustration.characters?.length ? opts.illustration.characters : opts.characterNames)
    .map((name) => name.trim())
    .filter(Boolean);
  const uniqueNames = dedupeNames(requestedNames, 6);

  const references: string[] = [];
  const characterDescriptions: string[] = [];
  const seen = new Set<string>();
  const described = new Set<string>();
  for (const name of uniqueNames) {
    const preferredReference = findCharAvatarFuzzy(name, opts.charReferenceByName);
    if (preferredReference && !seen.has(preferredReference) && references.length < 4) {
      seen.add(preferredReference);
      references.push(preferredReference);
      continue;
    }

    const avatarPath = findCharAvatarFuzzy(name, opts.charAvatarByName) ?? findCharAvatarFuzzy(name, npcAvatarByName);
    const base64 = avatarPath && !seen.has(avatarPath) ? readAvatarBase64(avatarPath) : undefined;
    if (avatarPath && base64 && references.length < 4) {
      seen.add(avatarPath);
      references.push(base64);
      continue;
    }

    const description =
      findCharAvatarFuzzy(name, opts.charDescriptionByName) ?? findCharAvatarFuzzy(name, npcDescriptionByName);
    const normalizedName = npcNameKey(name);
    if (description && !described.has(normalizedName)) {
      described.add(normalizedName);
      characterDescriptions.push(`${name}: ${description}`.slice(0, 300));
    }
  }

  const rewriterNames = [
    ...(opts.illustration.characters ?? []),
    ...opts.characterNames,
    ...opts.gameNpcs.map((npc) => npc.name).filter((n): n is string => !!n),
  ];
  const broadUniqueNames = dedupeNames(rewriterNames, 8);

  const characterDescriptionsForRewriter: string[] = [];
  const describedForRewriter = new Set<string>();
  for (const name of broadUniqueNames) {
    const description =
      findCharAvatarFuzzy(name, opts.charDescriptionByName) ?? findCharAvatarFuzzy(name, npcDescriptionByName);
    const normalizedName = npcNameKey(name);
    if (description && !describedForRewriter.has(normalizedName)) {
      describedForRewriter.add(normalizedName);
      characterDescriptionsForRewriter.push(`${name}: ${description}`.slice(0, 300));
    }
  }

  const backgroundBase64 = readBackgroundBase64(opts.backgroundTag);
  if (backgroundBase64 && references.length > 0) {
    references.splice(1, 0, backgroundBase64);
  }

  return {
    referenceImages: references,
    characterDescriptions: characterDescriptions.slice(0, 5),
    characterNamesForRewriter: broadUniqueNames,
    characterDescriptionsForRewriter: characterDescriptionsForRewriter.slice(0, 8),
  };
}

/**
 * Build a compact `<scene_npcs>` text block from the character-tracker's live
 * state, so the image-prompt-writer can translate mood/outfit/thoughts into
 * the right pose/expression/clothing tags.
 *
 * Output shape (one bullet per known character, missing fields skipped):
 *   - Rin: mood=sleepy/dazed; appearance=teen girl, short black hair, brown eyes, slim build; outfit=school sportswear, knee-high socks; thoughts=...
 *   - Kaede: mood=excited; appearance=...; outfit=...
 *
 * Returns null when there's nothing usable to emit (empty tracker, no
 * appearance/outfit data, no NPC cards). Caller passes the result verbatim.
 */
function buildScenePresenceBlock(
  presentCharacters: PresentCharacter[] | null | undefined,
  gameNpcs: GameNpc[] | null | undefined,
  focusNames: string[],
  options: { maxNpcs?: number; maxLineChars?: number; totalCharCap?: number; allowExtraTrackerEntries?: boolean } = {},
): string | null {
  const maxNpcs = options.maxNpcs ?? 6;
  const maxLineChars = options.maxLineChars ?? 360;
  const totalCharCap = options.totalCharCap ?? 1800;
  const allowExtraTrackerEntries = options.allowExtraTrackerEntries ?? true;

  const focusLowercase = new Set(focusNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  // Build a map of npcCard fallback data keyed by lowercase name.
  const npcCardByName = new Map<string, GameNpc>();
  for (const npc of gameNpcs ?? []) {
    if (npc?.name) npcCardByName.set(npc.name.toLowerCase(), npc);
  }

  // Order: characters explicitly in the focus list FIRST (sidecar+tracker+cards
  // union), then any extra tracker entries we have data for.
  const seenLower = new Set<string>();
  const orderedNames: string[] = [];
  for (const name of focusNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seenLower.has(lower)) continue;
    if (lower === "player" || lower === "{{user}}" || lower === "user") continue;
    seenLower.add(lower);
    orderedNames.push(trimmed);
  }
  if (allowExtraTrackerEntries) {
    for (const tracker of presentCharacters ?? []) {
      const trimmed = tracker?.name?.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (seenLower.has(lower)) continue;
      if (lower === "player" || lower === "{{user}}" || lower === "user") continue;
      seenLower.add(lower);
      orderedNames.push(trimmed);
    }
  }

  if (!orderedNames.length) return null;

  // Index tracker rows for quick lookup.
  const trackerByName = new Map<string, PresentCharacter>();
  for (const tracker of presentCharacters ?? []) {
    if (tracker?.name) trackerByName.set(tracker.name.toLowerCase(), tracker);
  }

  const stripWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
  const clamp = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;

  const lines: string[] = [];
  for (const name of orderedNames) {
    if (lines.length >= maxNpcs) break;
    const lower = name.toLowerCase();
    const tracker = trackerByName.get(lower);
    const card = npcCardByName.get(lower);
    const inFocus = focusLowercase.has(lower);

    const fields: string[] = [];
    const mood = stripWhitespace(tracker?.mood ?? "");
    if (mood) fields.push(`mood=${clamp(mood, 80)}`);
    const appearance = stripWhitespace(tracker?.appearance ?? card?.description ?? "");
    if (appearance) fields.push(`appearance=${clamp(appearance, 200)}`);
    const outfit = stripWhitespace(tracker?.outfit ?? "");
    if (outfit) fields.push(`outfit=${clamp(outfit, 160)}`);
    const thoughts = stripWhitespace(tracker?.thoughts ?? "");
    if (thoughts) fields.push(`thoughts=${clamp(thoughts, 160)}`);

    // Skip characters we have no data for AND are not in the explicit focus
    // list — they'd be just dead names with no visual cue.
    if (!fields.length && !inFocus) continue;
    if (!fields.length) continue;

    const line = `- ${name}: ${fields.join("; ")}`;
    lines.push(clamp(line, maxLineChars));
  }

  if (!lines.length) return null;

  let block = lines.join("\n");
  if (block.length > totalCharCap) {
    block = `${block.slice(0, totalCharCap - 1)}…`;
  }
  return block;
}

function isIllustrationBgTag(tag: unknown): boolean {
  return typeof tag === "string" && tag.startsWith("backgrounds:illustrations:");
}

/** Prefer the scene's establishing (non-CG) plate for re-showing after the illustration segment. */
function pickRoomPlateAfterIllustration(sceneResult: Record<string, unknown>): string | null {
  const top = sceneResult.background;
  if (typeof top === "string" && top.trim() && top !== "black" && top !== "none" && !isIllustrationBgTag(top)) {
    return top;
  }
  const effects = Array.isArray(sceneResult.segmentEffects)
    ? ([...(sceneResult.segmentEffects as Record<string, unknown>[])].sort(
        (a, b) => Number(a.segment) - Number(b.segment),
      ) as Record<string, unknown>[])
    : [];
  for (const fx of effects) {
    const bg = fx.background;
    if (typeof bg === "string" && bg.trim() && bg !== "black" && bg !== "none" && !isIllustrationBgTag(bg)) {
      return bg;
    }
  }
  return null;
}

/**
 * Attach a generated VN illustration to `segmentEffects` at segment S (default 0).
 * Never overwrites top-level `background` with the illustration tag — that caused
 * the client to flash CG then immediately re-apply the room plate from `segmentEffects`.
 * Optionally inserts `{ segment: S+1, background: <room> }` so narration advance restores the plate.
 */
function applyGeneratedIllustration(
  sceneResult: Record<string, unknown>,
  generatedTag: string,
  segment: number | undefined,
): void {
  sceneResult.generatedIllustration = { tag: generatedTag, ...(segment !== undefined ? { segment } : {}) };
  const roomTag = pickRoomPlateAfterIllustration(sceneResult);
  const S =
    typeof segment === "number" && Number.isFinite(segment) && segment >= 0 ? Math.floor(segment) : 0;

  const effects = Array.isArray(sceneResult.segmentEffects)
    ? (sceneResult.segmentEffects as Record<string, unknown>[])
    : [];
  sceneResult.segmentEffects = effects;

  let target = effects.find((effect) => effect.segment === S);
  if (!target) {
    target = { segment: S };
    effects.push(target);
  }
  target.background = generatedTag;

  if (roomTag) {
    const nextSeg = S + 1;
    const hasNextBg = effects.some(
      (e) =>
        e.segment === nextSeg &&
        typeof e.background === "string" &&
        (e.background as string).trim() !== "" &&
        e.background !== "black" &&
        e.background !== "none",
    );
    if (!hasNextBg) {
      effects.push({ segment: nextSeg, background: roomTag });
    }
  }
}

function generatedBackgroundSlug(value: string): string {
  let slug = value
    .trim()
    .toLowerCase()
    .replace(/:/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefixPattern = /^(?:backgrounds|fantasy|modern|scifi|user|generated|illustrations|q-[a-z0-9]{6,})-+/;
  while (prefixPattern.test(slug)) {
    slug = slug.replace(prefixPattern, "");
  }
  return slug || "scene";
}

const BACKGROUND_FALLBACK_IGNORED_WORDS = new Set(["background", "backgrounds", "generated", "user"]);
const BACKGROUND_FALLBACK_HINT = /default|start|town|village|forest|field|room|interior|corridor|hall|night|day/i;

function backgroundTagScore(requested: string, candidate: string): number {
  const words = requested
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !BACKGROUND_FALLBACK_IGNORED_WORDS.has(word));
  const parts = candidate
    .toLowerCase()
    .split(/[:_-]+/)
    .filter((part) => part.length > 1);

  let score = 0;
  for (const word of words) {
    for (const part of parts) {
      if (part.includes(word) || word.includes(part)) {
        score += word.length;
        break;
      }
    }
  }
  return score;
}

function pickFallbackBackgroundTag(
  requested: string | undefined | null,
  manifest: Record<string, { path: string }>,
): string | null {
  const tags = Object.keys(manifest).filter(
    (tag) => tag.startsWith("backgrounds:") && !tag.startsWith("backgrounds:illustrations:"),
  );
  if (tags.length === 0) return null;

  const cleaned = requested?.trim() ?? "";
  if (cleaned) {
    let bestTag: string | null = null;
    let bestScore = 0;
    for (const tag of tags) {
      const score = backgroundTagScore(cleaned, tag);
      if (score > bestScore) {
        bestScore = score;
        bestTag = tag;
      }
    }
    if (bestTag && bestScore > 0) return bestTag;
  }

  return tags.find((tag) => BACKGROUND_FALLBACK_HINT.test(tag)) ?? tags[0]!;
}

function gameImagePromptReviewId(kind: "background" | "illustration" | "portrait", key: string): string {
  return `${kind}:${generatedBackgroundSlug(key)}`;
}

async function addGeneratedIllustrationToGallery(opts: {
  app: FastifyInstance;
  chatId: string;
  tag: string;
  illustration: SceneIllustrationRequest;
  model: string;
}): Promise<void> {
  const prefix = "backgrounds:illustrations:";
  if (!opts.tag.startsWith(prefix)) return;

  const slug = opts.tag.slice(prefix.length);
  if (!/^[a-z0-9-]+$/.test(slug)) return;

  const assetPath = GENERATED_GAME_BACKGROUND_EXTS.map((ext) =>
    join(GAME_ASSETS_DIR, "backgrounds", "illustrations", `${slug}.${ext}`),
  ).find((candidate) => existsSync(candidate));
  if (!assetPath) return;

  try {
    const ext = extname(assetPath).toLowerCase().replace(/^\./, "") || "png";
    const filePath = saveImageToDisk(opts.chatId, readFileSync(assetPath).toString("base64"), ext);
    const gallery = createGalleryStorage(opts.app.db);
    const prompt = [opts.illustration.reason, opts.illustration.prompt].filter(Boolean).join("\n\n");
    await gallery.create({
      chatId: opts.chatId,
      filePath,
      prompt,
      provider: "game_scene_illustration",
      model: opts.model || "unknown",
      width: 1024,
      height: 576,
    });
  } catch (err) {
    opts.app.log.warn({ err, chatId: opts.chatId, tag: opts.tag }, "Failed to add game illustration to gallery");
  }
}

// ──────────────────────────────────────────────
// Background cache helpers (per-chat locationCatalog)
// ──────────────────────────────────────────────

/** Cast unknown season-like values to the canonical `Season` literal or null. */
function coerceSeason(value: unknown): Season | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase().trim();
  if (v === "spring" || v === "summer" || v === "autumn" || v === "winter") return v;
  if (v === "fall") return "autumn";
  return null;
}

/** Stringified conditions key for catalog lookups (`null` → `"none"`). */
function buildConditionsKey(conditions: BackgroundConditions): string {
  return `${conditions.weather ?? "none"}__${conditions.timeOfDay ?? "none"}__${conditions.season ?? "none"}`;
}

/**
 * Append a freshly-generated variant to the per-chat locationCatalog. Returns
 * a new metadata patch object (caller should merge it into the latest meta
 * via `updateMetadataWithMerge`).
 */
function upsertLocationCatalogVariant(
  meta: Record<string, unknown>,
  locationId: string,
  conditions: BackgroundConditions,
  tag: string,
  prompt: string,
  description?: string,
): Record<string, LocationCatalogEntry> {
  const existing = (meta.locationCatalog as Record<string, LocationCatalogEntry> | undefined) ?? {};
  const conditionsKey = buildConditionsKey(conditions);
  const prevEntry = existing[locationId];
  const existingVariants = prevEntry?.variants ?? [];
  const filtered = existingVariants.filter((v) => v.conditionsKey !== conditionsKey);
  const newVariant: LocationCatalogVariant = {
    conditionsKey,
    weather: conditions.weather,
    timeOfDay: conditions.timeOfDay,
    season: conditions.season as Season | null,
    tag,
    prompt,
    generatedAt: new Date().toISOString(),
  };
  const nextEntry: LocationCatalogEntry = {
    locationId,
    description: description ?? prevEntry?.description,
    variants: [...filtered, newVariant],
  };
  return { ...existing, [locationId]: nextEntry };
}

/**
 * Find a catalog variant whose asset tag matches the current scene background,
 * so the stored scene `prompt` can be reused for forced regeneration.
 */
function findCatalogBackgroundRegeneratePayload(
  meta: Record<string, unknown>,
  sceneBackgroundTag: string | null | undefined,
): { locationId: string; backgroundPrompt: string; conditions: BackgroundConditions } | null {
  if (!sceneBackgroundTag || sceneBackgroundTag === "black" || sceneBackgroundTag === "none") {
    return null;
  }
  const catalog = (meta.locationCatalog as Record<string, LocationCatalogEntry> | undefined) ?? {};
  const preferredLoc = normalizeSceneLocationId(meta.currentLocationId);

  type Hit = { locationId: string; backgroundPrompt: string; conditions: BackgroundConditions };
  const hits: Hit[] = [];
  for (const [mapKey, entry] of Object.entries(catalog)) {
    const variants = entry?.variants ?? [];
    if (!variants.length) continue;
    const locId = entry.locationId || mapKey;
    for (const v of variants) {
      if (v.tag === sceneBackgroundTag && typeof v.prompt === "string" && v.prompt.trim()) {
        hits.push({
          locationId: locId,
          backgroundPrompt: v.prompt.trim(),
          conditions: {
            weather: v.weather ?? null,
            timeOfDay: v.timeOfDay ?? null,
            season: v.season ?? null,
          },
        });
      }
    }
  }
  if (!hits.length) return null;
  if (preferredLoc && hits.length > 1) {
    const pick = hits.find((h) => normalizeSceneLocationId(h.locationId) === preferredLoc);
    if (pick) return pick;
  }
  return hits[0] ?? null;
}

/** Normalize plain-text output from the background-brief LLM. */
function normalizeBackgroundBriefFromLlm(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:\w*)?\r?\n?/, "").replace(/\r?\n?```\s*$/u, "");
  }
  t = t.trim();
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    t = t.slice(1, -1).trim();
  }
  return t.replace(/\s+/g, " ").trim().slice(0, 2000);
}

/** Bump when a new background image was written (not a disk cache hit). */
function bumpGameBackgroundAssetRevisionMerge(latestMeta: Record<string, unknown>): Record<string, unknown> {
  const prev = latestMeta.gameBackgroundAssetRevision;
  const n = typeof prev === "number" && Number.isFinite(prev) ? prev + 1 : 1;
  return { gameBackgroundAssetRevision: n };
}

// ──────────────────────────────────────────────
// Validation Schemas
// ──────────────────────────────────────────────

const gameSetupConfigSchema = z.object({
  genre: z.string().min(1).max(200),
  setting: z.string().min(1),
  tone: z.string().min(1).max(200),
  difficulty: z.string().min(1).max(100),
  playerGoals: z.string().max(2000).default(""),
  gmMode: z.enum(["standalone", "character"]),
  rating: z.enum(["sfw", "nsfw"]).default("sfw"),
  gmCharacterId: z.string().nullable().optional(),
  partyCharacterIds: z.array(z.string()),
  personaId: z.string().nullable().optional(),
  sceneConnectionId: z.string().optional(),
  enableSpriteGeneration: z.boolean().optional(),
  gameCgFrequency: z.enum(["off", "rare", "balanced", "frequent", "cinematic"]).optional(),
  imageConnectionId: z.string().optional(),
  artStylePrompt: z.string().max(500).optional(),
  activeLorebookIds: z.array(z.string()).optional(),
  enableCustomWidgets: z.boolean().optional(),
  enableSpotifyDj: z.boolean().optional(),
  spotifySourceType: z.enum(["liked", "playlist", "artist", "any"]).optional(),
  spotifyPlaylistId: z.string().nullable().optional(),
  spotifyPlaylistName: z.string().nullable().optional(),
  spotifyArtist: z.string().nullable().optional(),
  enableLorebookKeeper: z.boolean().optional(),
  language: z.string().min(1).max(100).optional(),
  generationParameters: generationParametersSchema.partial().optional(),
});

const createGameSchema = z.object({
  name: z.string().min(1).max(200),
  setupConfig: gameSetupConfigSchema,
  connectionId: z.string().optional(),
  characterConnectionId: z.string().optional(),
  promptPresetId: z.string().optional(),
  chatId: z.string().optional(),
});

const setupSchema = z.object({
  chatId: z.string().min(1),
  connectionId: z.string().optional(),
  preferences: z.string().max(5000).default(""),
  streaming: z.boolean().optional().default(true),
  debugMode: z.boolean().optional().default(false),
});

const gameStartSchema = z.object({
  chatId: z.string().min(1),
  connectionId: z.string().optional(),
});

const startSessionSchema = z.object({
  gameId: z.string().min(1),
  connectionId: z.string().optional(),
});

const concludeSessionSchema = z.object({
  chatId: z.string().min(1),
  connectionId: z.string().optional(),
  nextSessionRequest: z.string().max(5000).optional().default(""),
  streaming: z.boolean().optional().default(true),
});

const regenerateSessionConclusionSchema = concludeSessionSchema.extend({
  sessionNumber: z.number().int().min(1),
});

const updateCampaignProgressionSchema = concludeSessionSchema.extend({
  sessionNumber: z.number().int().min(1),
});

const regenerateSessionLorebookSchema = z.object({
  chatId: z.string().min(1),
  connectionId: z.string().optional(),
  sessionNumber: z.number().int().min(1).optional(),
  streaming: z.boolean().optional().default(true),
});

const jsonRepairApplySchema = z.object({
  chatId: z.string().min(1),
  rawJson: z.string().min(1),
  connectionId: z.string().optional(),
  sessionNumber: z.number().int().min(1).optional(),
  nextSessionRequest: z.string().max(5000).optional().default(""),
});

const recruitPartyMemberSchema = z.object({
  chatId: z.string().min(1),
  characterName: z.string().min(1).max(200),
  connectionId: z.string().optional(),
});

const removePartyMemberSchema = z.object({
  chatId: z.string().min(1),
  characterName: z.string().min(1).max(200),
});

const diceRollSchema = z.object({
  chatId: z.string().min(1),
  notation: z.string().min(1).max(50).refine(isDiceNotation, "Invalid dice notation"),
  context: z.string().max(500).optional(),
});

const stateTransitionSchema = z.object({
  chatId: z.string().min(1),
  newState: z.enum(["exploration", "dialogue", "combat", "travel_rest"]),
});

const mapGenerateSchema = z.object({
  chatId: z.string().min(1),
  locationType: z.string().min(1).max(200),
  context: z.string().max(1000).default(""),
  connectionId: z.string().optional(),
});

const mapMoveSchema = z.object({
  chatId: z.string().min(1),
  position: z.union([z.object({ x: z.number().int(), y: z.number().int() }), z.string().min(1).max(200)]),
  mapId: z.string().min(1).max(200).optional().nullable(),
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Parse chat.metadata which may be a JSON string from the DB. */
function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (err) {
      logger.warn(err, "[game.routes] Failed to parse chat metadata, returning empty object");
      return {};
    }
  }
  return (raw as Record<string, unknown>) ?? {};
}

function isTimeOfDayLabel(action: string): action is TimeOfDay {
  return ["dawn", "morning", "afternoon", "evening", "night", "midnight"].includes(action);
}

function normalizeCharacterLookupName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CHARACTER_NAME_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "il",
  "la",
  "le",
  "el",
  "los",
  "las",
  "de",
  "del",
  "della",
  "da",
  "di",
  "du",
  "der",
  "van",
  "von",
]);

function getCharacterNameTokens(value: string): string[] {
  const normalized = normalizeCharacterLookupName(value);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => token.length > 2 || /\d/.test(token))
    .filter((token) => !CHARACTER_NAME_STOP_WORDS.has(token));
}

function characterNamesLikelyMatch(leftName: string, rightName: string): boolean {
  const leftNormalized = normalizeCharacterLookupName(leftName);
  const rightNormalized = normalizeCharacterLookupName(rightName);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;
  if (leftNormalized.length >= 3 && ` ${rightNormalized} `.includes(` ${leftNormalized} `)) return true;
  if (rightNormalized.length >= 3 && ` ${leftNormalized} `.includes(` ${rightNormalized} `)) return true;

  const leftTokens = getCharacterNameTokens(leftName);
  const rightTokens = getCharacterNameTokens(rightName);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const smaller = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const larger = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
  return smaller.every((token) => larger.includes(token));
}

function findExistingGameCharacterCardIndex(
  currentCards: Array<Record<string, unknown>>,
  characterName: string,
): number {
  const exactIndex = currentCards.findIndex(
    (card) => typeof card.name === "string" && card.name.toLowerCase() === characterName.toLowerCase(),
  );
  if (exactIndex >= 0) return exactIndex;

  const normalizedName = normalizeCharacterLookupName(characterName);
  const normalizedIndex = currentCards.findIndex(
    (card) => typeof card.name === "string" && normalizeCharacterLookupName(card.name) === normalizedName,
  );
  if (normalizedIndex >= 0) return normalizedIndex;

  const likelyMatches = currentCards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => typeof card.name === "string" && characterNamesLikelyMatch(card.name, characterName));
  return likelyMatches.length === 1 ? likelyMatches[0]!.index : -1;
}

function buildPartyNpcId(name: string): string {
  const slug = normalizeCharacterLookupName(name).replace(/\s+/g, "-");
  const encodedSlug = encodeURIComponent(name.trim().toLowerCase())
    .replace(/%/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `npc:${slug || encodedSlug || "unknown"}`;
}

function isPartyNpcId(id: string): boolean {
  return id.startsWith("npc:");
}

function getStoredPartyCharacterIds(
  meta: Record<string, unknown>,
  setupConfig: GameSetupConfig,
  chatCharacterIds: string[],
): string[] {
  if (Array.isArray(meta.gamePartyCharacterIds)) {
    return Array.from(
      new Set(
        (meta.gamePartyCharacterIds as unknown[]).filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        ),
      ),
    );
  }
  return Array.from(new Set([...(setupConfig.partyCharacterIds ?? []), ...chatCharacterIds]));
}

function reconcileGamePartyCharacterIds(
  meta: Record<string, unknown>,
  setupConfig: GameSetupConfig,
  chatCharacterIds: string[],
): string[] {
  const storedPartyIds = getStoredPartyCharacterIds(meta, setupConfig, chatCharacterIds);
  const npcPartyIds = storedPartyIds.filter(isPartyNpcId);
  const libraryPartyIds =
    chatCharacterIds.length > 0 ? chatCharacterIds : storedPartyIds.filter((id) => !isPartyNpcId(id));
  return Array.from(new Set([...libraryPartyIds, ...npcPartyIds]));
}

function syncSetupConfigPartyIds(setupConfig: GameSetupConfig, partyCharacterIds: string[]): GameSetupConfig {
  return {
    ...setupConfig,
    partyCharacterIds,
  };
}

function findGameNpcByName(npcs: GameNpc[], requestedName: string): GameNpc | null {
  const requestedLookup = normalizeCharacterLookupName(requestedName);
  let matches = npcs.filter((npc) => npc.name.toLowerCase() === requestedName.toLowerCase());
  if (matches.length === 0) {
    matches = npcs.filter((npc) => normalizeCharacterLookupName(npc.name) === requestedLookup);
  }
  if (matches.length === 0 && requestedLookup.length >= 3) {
    matches = npcs.filter((npc) => {
      const lookup = normalizeCharacterLookupName(npc.name);
      return lookup.includes(requestedLookup) || (lookup.length >= 3 && requestedLookup.includes(lookup));
    });
  }
  return matches.length === 1 ? matches[0]! : null;
}

function buildNpcPartyCard(npc: Pick<GameNpc, "name" | "description" | "location" | "notes">): Record<string, unknown> {
  return buildFallbackGameCharacterCard(
    {
      description: npc.description || `${npc.name} joins the party.`,
      backstory: npc.notes?.length ? npc.notes.join("\n") : "",
      appearance: npc.location ? `Last known location: ${npc.location}` : "",
    },
    npc.name,
  );
}

function buildRecruitCharacterSourceCard(characterData: Record<string, any>): string {
  const lines = [`Name: ${String(characterData.name || "Unknown")}`];
  if (typeof characterData.personality === "string" && characterData.personality.trim()) {
    lines.push(`Personality: ${characterData.personality.trim()}`);
  }
  if (typeof characterData.description === "string" && characterData.description.trim()) {
    lines.push(`Description: ${characterData.description.trim()}`);
  }
  const backstory =
    typeof characterData.extensions?.backstory === "string" && characterData.extensions.backstory.trim()
      ? characterData.extensions.backstory.trim()
      : typeof characterData.backstory === "string" && characterData.backstory.trim()
        ? characterData.backstory.trim()
        : "";
  const appearance =
    typeof characterData.extensions?.appearance === "string" && characterData.extensions.appearance.trim()
      ? characterData.extensions.appearance.trim()
      : typeof characterData.appearance === "string" && characterData.appearance.trim()
        ? characterData.appearance.trim()
        : "";
  if (backstory) lines.push(`Backstory: ${backstory}`);
  if (appearance) lines.push(`Appearance: ${appearance}`);
  return lines.join("\n");
}

function buildNpcRecruitCharacterSourceCard(npc: Pick<GameNpc, "name" | "description" | "location" | "notes">): string {
  return buildRecruitCharacterSourceCard({
    name: npc.name,
    description: npc.description || `${npc.name} joins the party.`,
    backstory: npc.notes?.length ? npc.notes.join("\n") : "",
    appearance: npc.location ? `Last known location: ${npc.location}` : "",
  });
}

function extractRecruitCharacterRpgStats(characterData: Record<string, any>) {
  const rpgStats = characterData.extensions?.rpgStats;
  if (!rpgStats?.enabled || !Array.isArray(rpgStats.attributes) || !rpgStats.hp) return undefined;

  return {
    attributes: rpgStats.attributes
      .map((attribute: Record<string, unknown>) => ({
        name: typeof attribute.name === "string" ? attribute.name.trim() : "",
        value: Number(attribute.value) || 0,
      }))
      .filter((attribute: { name: string; value: number }) => attribute.name),
    hp: {
      value: Math.max(0, Number(rpgStats.hp.max) || 0),
      max: Math.max(1, Number(rpgStats.hp.max) || 1),
    },
  };
}

function normalizeGeneratedGameCharacterCard(raw: Record<string, unknown>, fallbackName: string) {
  const normalizeStringArray = (value: unknown) =>
    Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];

  const extraEntries =
    raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra)
      ? Object.fromEntries(
          Object.entries(raw.extra as Record<string, unknown>)
            .map(([key, value]) => [key.trim(), String(value).trim()] as const)
            .filter(([key, value]) => key && value),
        )
      : {};

  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallbackName,
    shortDescription: typeof raw.shortDescription === "string" ? raw.shortDescription.trim() : "",
    class: typeof raw.class === "string" ? raw.class.trim() : "",
    abilities: normalizeStringArray(raw.abilities),
    strengths: normalizeStringArray(raw.strengths),
    weaknesses: normalizeStringArray(raw.weaknesses),
    extra: extraEntries,
  };
}

function applyGeneratedGameCharacterCards(
  currentCards: Array<Record<string, unknown>>,
  rawCards: unknown,
): { cards: Array<Record<string, unknown>>; updatedCount: number } {
  if (currentCards.length === 0 || !Array.isArray(rawCards)) {
    return { cards: currentCards, updatedCount: 0 };
  }

  const generatedCardsByName = new Map<string, Record<string, unknown>>();
  for (const card of rawCards) {
    if (!card || typeof card !== "object" || Array.isArray(card)) continue;
    const name = (card as Record<string, unknown>).name;
    if (typeof name !== "string" || !name.trim()) continue;
    generatedCardsByName.set(name.trim().toLowerCase(), card as Record<string, unknown>);
  }

  if (generatedCardsByName.size === 0) {
    return { cards: currentCards, updatedCount: 0 };
  }

  let updatedCount = 0;
  const cards = currentCards.map((existingCard) => {
    const existingName = typeof existingCard.name === "string" ? existingCard.name.trim() : "";
    if (!existingName) return existingCard;

    const generatedCard = generatedCardsByName.get(existingName.toLowerCase());
    if (!generatedCard) return existingCard;

    updatedCount += 1;
    const normalizedCard = normalizeGeneratedGameCharacterCard(generatedCard, existingName);
    return existingCard.rpgStats
      ? {
          ...normalizedCard,
          rpgStats: existingCard.rpgStats,
        }
      : normalizedCard;
  });

  return { cards, updatedCount };
}

function buildFallbackGameCharacterCard(characterData: Record<string, any>, characterName: string) {
  const description =
    typeof characterData.description === "string" && characterData.description.trim()
      ? characterData.description.trim()
      : typeof characterData.personality === "string" && characterData.personality.trim()
        ? characterData.personality.trim()
        : `${characterName} joins the party.`;
  const appearance =
    typeof characterData.extensions?.appearance === "string" && characterData.extensions.appearance.trim()
      ? characterData.extensions.appearance.trim()
      : typeof characterData.appearance === "string" && characterData.appearance.trim()
        ? characterData.appearance.trim()
        : "";
  const backstory =
    typeof characterData.extensions?.backstory === "string" && characterData.extensions.backstory.trim()
      ? characterData.extensions.backstory.trim()
      : typeof characterData.backstory === "string" && characterData.backstory.trim()
        ? characterData.backstory.trim()
        : "";

  return {
    name: characterName,
    shortDescription: description,
    class: "Companion",
    abilities: [],
    strengths: [],
    weaknesses: [],
    extra: Object.fromEntries(
      [
        ["appearance", appearance],
        ["backstory", backstory],
      ].filter((entry): entry is [string, string] => Boolean(entry[1])),
    ),
  };
}

function getDiscordWebhookUrl(meta: Record<string, unknown>): string {
  return typeof meta.discordWebhookUrl === "string" ? meta.discordWebhookUrl.trim() : "";
}

function mirrorGameMessageToDiscord(meta: Record<string, unknown>, content: string, username: string): void {
  const webhookUrl = getDiscordWebhookUrl(meta);
  if (!webhookUrl || !content.trim()) return;
  postToDiscordWebhook(webhookUrl, { content, username });
}

function normalizeSessionText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

type StoredChatRecord = Awaited<ReturnType<ReturnType<typeof createChatsStorage>["getById"]>>;

function normalizeSessionTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSessionText(item)).filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function normalizeSessionStatsSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeMoraleValue(value: unknown, fallback = 50): number {
  const raw = typeof value === "string" && value.trim() ? Number(value.trim()) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function extractMoraleFromSessionSummary(summary: SessionSummary, fallback: number): number {
  const stats = summary.statsSnapshot;
  const party =
    stats.party && typeof stats.party === "object" && !Array.isArray(stats.party)
      ? (stats.party as Record<string, unknown>)
      : null;
  return normalizeMoraleValue(
    stats.partyMorale ?? stats.morale ?? stats.partyMoraleValue ?? party?.morale ?? party?.partyMorale,
    fallback,
  );
}

function syncMoraleWidgetValue(rawWidgets: unknown, morale: number): unknown {
  if (!Array.isArray(rawWidgets)) return rawWidgets;

  return rawWidgets.map((widget) => {
    if (!widget || typeof widget !== "object" || Array.isArray(widget)) return widget;
    const source = widget as HudWidget;
    const label = `${source.id ?? ""} ${source.label ?? ""}`.toLowerCase();
    if (!label.includes("morale")) return widget;
    if (!["progress_bar", "gauge", "relationship_meter"].includes(source.type)) return widget;
    return {
      ...source,
      config: {
        ...source.config,
        value: morale,
        max: typeof source.config?.max === "number" ? source.config.max : 100,
      },
    };
  });
}

function buildMoraleMetadataUpdates(meta: Record<string, unknown>, morale: number): Record<string, unknown> {
  const updates: Record<string, unknown> = { gameMorale: morale };
  const nextWidgetState = syncMoraleWidgetValue(meta.gameWidgetState, morale);
  if (nextWidgetState !== meta.gameWidgetState) updates.gameWidgetState = nextWidgetState;

  const blueprint = meta.gameBlueprint;
  if (blueprint && typeof blueprint === "object" && !Array.isArray(blueprint)) {
    const source = blueprint as Record<string, unknown>;
    const nextHudWidgets = syncMoraleWidgetValue(source.hudWidgets, morale);
    if (nextHudWidgets !== source.hudWidgets) {
      updates.gameBlueprint = { ...source, hudWidgets: nextHudWidgets };
    }
  }

  return updates;
}

function deriveResumePointFallback(summary: string): string {
  const paragraphs = summary
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return paragraphs[paragraphs.length - 1] ?? summary;
}

function normalizeStoredSessionSummaries(raw: unknown): SessionSummary[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((item, index) => {
    const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const summary = normalizeSessionText(source.summary, `Session ${index + 1} concluded.`);
    const dedupedFacts = dedupeSessionSummaryLists({
      keyDiscoveries: normalizeSessionTextList(source.keyDiscoveries),
      legacyRevelations: normalizeSessionTextList(source.revelations),
      characterMoments: normalizeSessionTextList(source.characterMoments),
      littleDetails: normalizeSessionTextList(source.littleDetails),
      npcUpdates: normalizeSessionTextList(source.npcUpdates),
    });
    return {
      sessionNumber: index + 1,
      summary,
      resumePoint: normalizeSessionText(source.resumePoint, deriveResumePointFallback(summary)),
      partyDynamics: normalizeSessionText(source.partyDynamics),
      partyState: normalizeSessionText(source.partyState),
      keyDiscoveries: dedupedFacts.keyDiscoveries,
      characterMoments: dedupedFacts.characterMoments,
      littleDetails: dedupedFacts.littleDetails,
      statsSnapshot: normalizeSessionStatsSnapshot(source.statsSnapshot),
      npcUpdates: dedupedFacts.npcUpdates,
      nextSessionRequest: normalizeSessionText(source.nextSessionRequest) || null,
      timestamp: normalizeSessionText(source.timestamp, new Date().toISOString()),
    };
  });
}

function normalizeSessionSummaryPayload(
  payload: Record<string, unknown>,
  sessionNumber: number,
  fallback: string,
): SessionSummary {
  const summary = normalizeSessionText(payload.summary, fallback);
  const dedupedFacts = dedupeSessionSummaryLists({
    keyDiscoveries: normalizeSessionTextList(payload.keyDiscoveries),
    legacyRevelations: normalizeSessionTextList(payload.revelations),
    characterMoments: normalizeSessionTextList(payload.characterMoments),
    littleDetails: normalizeSessionTextList(payload.littleDetails),
    npcUpdates: normalizeSessionTextList(payload.npcUpdates),
  });
  return {
    sessionNumber,
    summary,
    resumePoint: normalizeSessionText(payload.resumePoint, deriveResumePointFallback(summary)),
    partyDynamics: normalizeSessionText(payload.partyDynamics),
    partyState: normalizeSessionText(payload.partyState),
    keyDiscoveries: dedupedFacts.keyDiscoveries,
    characterMoments: dedupedFacts.characterMoments,
    littleDetails: dedupedFacts.littleDetails,
    statsSnapshot: normalizeSessionStatsSnapshot(payload.statsSnapshot),
    npcUpdates: dedupedFacts.npcUpdates,
    nextSessionRequest: normalizeSessionText(payload.nextSessionRequest) || null,
    timestamp: new Date().toISOString(),
  };
}

function normalizePartyArcPayload(raw: unknown): PartyArc[] {
  if (!Array.isArray(raw)) return [];

  const arcs: PartyArc[] = [];
  for (const item of raw) {
    const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const name = normalizeSessionText(source.name);
    const arc = normalizeSessionText(source.arc);
    const goal = normalizeSessionText(source.goal);
    if (!name || !arc) continue;

    const completed = typeof source.completed === "boolean" ? source.completed : false;
    const resolution = normalizeSessionText(source.resolution);

    const nextArc: PartyArc = {
      name,
      arc,
      goal,
      ...(completed ? { completed } : {}),
      ...(resolution ? { resolution } : {}),
    };
    arcs.push(nextArc);
  }

  return arcs;
}

type CampaignProgressionState = {
  storyArc: string | null;
  plotTwists: string[];
  partyArcs: PartyArc[];
};

function extractCampaignProgressionPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  return parsed.campaignProgression &&
    typeof parsed.campaignProgression === "object" &&
    !Array.isArray(parsed.campaignProgression)
    ? (parsed.campaignProgression as Record<string, unknown>)
    : parsed;
}

function applyCampaignProgressionPayload(
  rawCampaignProgression: Record<string, unknown>,
  current: CampaignProgressionState,
): CampaignProgressionState {
  const nextStoryArc = normalizeSessionText(rawCampaignProgression.storyArc, current.storyArc || "");
  const nextPlotTwists = normalizeSessionTextList(rawCampaignProgression.plotTwists);
  const nextPartyArcs = normalizePartyArcPayload(rawCampaignProgression.partyArcs);

  return {
    storyArc: nextStoryArc || null,
    plotTwists: nextPlotTwists.length > 0 ? nextPlotTwists : current.plotTwists,
    partyArcs: nextPartyArcs.length > 0 ? nextPartyArcs : current.partyArcs,
  };
}

type SessionConclusionApplication = {
  summary: SessionSummary;
  updatedStoryArc: string | null;
  updatedPlotTwists: string[];
  updatedPartyArcs: PartyArc[];
  updatedMorale: number;
  updatedCards: Array<Record<string, unknown>>;
  updatedCardCount: number;
};

function applySessionConclusionPayload(
  parsedConclusion: Record<string, unknown>,
  args: {
    sessionNumber: number;
    nextSessionRequest?: string | null;
    currentStoryArc: string | null;
    currentPlotTwists: string[];
    currentPartyArcs: PartyArc[];
    currentMorale: number;
    currentCards: Array<Record<string, unknown>>;
  },
): SessionConclusionApplication {
  const rawSummary =
    parsedConclusion.summary && typeof parsedConclusion.summary === "object" && !Array.isArray(parsedConclusion.summary)
      ? (parsedConclusion.summary as Record<string, unknown>)
      : typeof parsedConclusion.summary === "string"
        ? ({ summary: parsedConclusion.summary } as Record<string, unknown>)
        : parsedConclusion;
  let summary = normalizeSessionSummaryPayload(rawSummary, args.sessionNumber, "Session concluded.");
  summary = { ...summary, nextSessionRequest: args.nextSessionRequest ?? null };

  const updatedMorale = extractMoraleFromSessionSummary(summary, args.currentMorale);
  summary = { ...summary, statsSnapshot: { ...summary.statsSnapshot, partyMorale: updatedMorale } };

  const updatedCampaignProgression = applyCampaignProgressionPayload(
    extractCampaignProgressionPayload(parsedConclusion),
    {
      storyArc: args.currentStoryArc,
      plotTwists: args.currentPlotTwists,
      partyArcs: args.currentPartyArcs,
    },
  );
  const appliedCards = applyGeneratedGameCharacterCards(args.currentCards, parsedConclusion.characterCards);

  return {
    summary,
    updatedStoryArc: updatedCampaignProgression.storyArc,
    updatedPlotTwists: updatedCampaignProgression.plotTwists,
    updatedPartyArcs: updatedCampaignProgression.partyArcs,
    updatedMorale,
    updatedCards: appliedCards.cards,
    updatedCardCount: appliedCards.updatedCount,
  };
}

type ChatInventoryItem = { name: string; quantity: number };

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeGameInventoryItems(raw: unknown): ChatInventoryItem[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const parsedQuantity =
      typeof source.quantity === "number" ? source.quantity : Number.parseInt(String(source.quantity ?? ""), 10);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? Math.floor(parsedQuantity) : 1;
    return name ? [{ name, quantity }] : [];
  });
}

function inventoryFromPlayerStats(playerStats: Record<string, unknown> | null): ChatInventoryItem[] {
  if (!playerStats) return [];
  return normalizeGameInventoryItems(playerStats.inventory);
}

function mergeGameInventoryItems(...sources: ChatInventoryItem[][]): ChatInventoryItem[] {
  const merged = new Map<string, ChatInventoryItem>();
  for (const source of sources) {
    for (const item of source) {
      const key = item.name.toLowerCase();
      if (!merged.has(key)) {
        merged.set(key, { ...item });
      }
    }
  }
  return [...merged.values()];
}

async function resolveConnection(
  connections: ReturnType<typeof createConnectionsStorage>,
  connId: string | null | undefined,
  chatConnectionId: string | null,
) {
  let id = connId ?? chatConnectionId;
  if (id === "random") {
    const pool = await connections.listRandomPool();
    if (!pool.length) throw new Error("No connections marked for the random pool");
    id = pool[Math.floor(Math.random() * pool.length)].id;
  }
  if (!id) throw new Error("No API connection configured");
  const conn = await connections.getWithKey(id);
  if (!conn) throw new Error("API connection not found");

  let baseUrl = conn.baseUrl;
  if (!baseUrl) {
    const { PROVIDERS } = await import("@marinara-engine/shared");
    const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    baseUrl = providerDef?.defaultBaseUrl ?? "";
  }
  // Claude (Subscription) uses the local Claude Agent SDK and has no HTTP
  // endpoint — return a sentinel so the gate passes. The provider ignores it.
  if (!baseUrl && conn.provider === "claude_subscription") baseUrl = "claude-agent-sdk://local";
  if (!baseUrl && conn.provider === "openai_chatgpt") baseUrl = "openai-chatgpt://codex-auth";
  if (!baseUrl) throw new Error("No base URL configured for this connection");

  return { conn, baseUrl, defaultGenerationParameters: parseStoredGenerationParameters(conn.defaultParameters) };
}

type StoredGenerationParameters = Partial<GenerationParameters>;

function parseStoredGenerationParameters(raw: unknown): StoredGenerationParameters | null {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  const result = generationParametersSchema.partial().safeParse(parsed);
  return result.success ? result.data : null;
}

function mergeStoredGenerationParameters(...sources: Array<unknown>): StoredGenerationParameters | null {
  const merged: StoredGenerationParameters = {};
  for (const source of sources) {
    const parsed = parseStoredGenerationParameters(source);
    if (parsed) {
      const { customParameters, ...rest } = parsed;
      Object.assign(merged, rest);
      if (customParameters) {
        merged.customParameters = mergeCustomParameters(merged.customParameters, customParameters);
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

function resolveStoredGameGenerationParameters(
  meta: Record<string, unknown> | null | undefined,
  connectionDefaults: StoredGenerationParameters | null | undefined,
) {
  const setupConfig = (meta?.gameSetupConfig as Record<string, unknown> | null | undefined) ?? null;
  return mergeStoredGenerationParameters(connectionDefaults, setupConfig?.generationParameters, meta?.chatParameters);
}

function resolveGameReasoningEffort(
  model: string,
  reasoningEffort: GenerationParameters["reasoningEffort"] | ChatOptions["reasoningEffort"] | null | undefined,
): ChatOptions["reasoningEffort"] | undefined {
  if (!reasoningEffort) return undefined;
  const modelLower = model.toLowerCase();
  if (
    modelLower.startsWith("grok-4.3") ||
    modelLower.startsWith("grok-4-1-fast") ||
    modelLower.startsWith("x-ai/grok-")
  ) {
    return undefined;
  }
  if (reasoningEffort === "xhigh") return reasoningEffort;
  if (reasoningEffort !== "maximum") return reasoningEffort;

  const supportsXhigh =
    modelLower.startsWith("gpt-5.5") ||
    modelLower.startsWith("gpt-5.4") ||
    modelLower === "grok-4.20-multi-agent" ||
    /claude-opus-4-(?:[7-9]|\d{2,})/.test(modelLower);
  return supportsXhigh ? "xhigh" : "high";
}

/** Build model-aware generation options for game calls. */
function gameGenOptions(
  model: string,
  overrides: Partial<ChatOptions> = {},
  parameters: StoredGenerationParameters | null = null,
): ChatOptions {
  const m = model.toLowerCase();
  // Opus 4.7+ and GPT-5.4/5.5 accept the strongest reasoning tier ("xhigh").
  // Opus 4.7+ also forbids sampling parameters entirely; the Anthropic
  // provider strips them on the wire, but we omit them here so the
  // logged options match what is actually sent.
  const isOpus47Plus = /claude-opus-4-(?:[7-9]|\d{2,})/.test(m);
  const isGrokAutoReasoning = m.startsWith("grok-4.3") || m.startsWith("grok-4-1-fast") || m.startsWith("x-ai/grok-");
  const supportsXhigh =
    m.startsWith("gpt-5.5") || m.startsWith("gpt-5.4") || m === "grok-4.20-multi-agent" || isOpus47Plus;
  const base: ChatOptions = {
    model,
    maxTokens: 8192,
    verbosity: "high",
  };
  if (!isGrokAutoReasoning) {
    base.reasoningEffort = supportsXhigh ? "xhigh" : "high";
    // Required for providers that actually attach thinking config to the request body.
    base.enableThinking = true;
  }
  if (!isOpus47Plus) {
    base.temperature = 1;
    base.topP = 1;
  }

  if (parameters) {
    if (typeof parameters.temperature === "number" && !isOpus47Plus) base.temperature = parameters.temperature;
    if (typeof parameters.maxTokens === "number") base.maxTokens = parameters.maxTokens;
    if (typeof parameters.maxContext === "number") base.maxContext = parameters.maxContext;
    if (typeof parameters.topP === "number" && !isOpus47Plus) base.topP = parameters.topP;
    if (typeof parameters.topK === "number") base.topK = parameters.topK;
    if (typeof parameters.frequencyPenalty === "number") base.frequencyPenalty = parameters.frequencyPenalty;
    if (typeof parameters.presencePenalty === "number") base.presencePenalty = parameters.presencePenalty;
    if (parameters.customParameters) {
      base.customParameters = mergeCustomParameters(base.customParameters, parameters.customParameters);
    }
    if (parameters.reasoningEffort !== undefined) {
      const resolvedReasoningEffort = resolveGameReasoningEffort(model, parameters.reasoningEffort);
      if (resolvedReasoningEffort) {
        base.reasoningEffort = resolvedReasoningEffort;
        base.enableThinking = true;
      } else {
        delete base.reasoningEffort;
        base.enableThinking = false;
      }
    }
    if (parameters.verbosity !== undefined) {
      if (parameters.verbosity) {
        base.verbosity = parameters.verbosity;
      } else {
        delete base.verbosity;
      }
    }
  }

  const mergedCustomParameters = mergeCustomParameters(base.customParameters, overrides.customParameters);
  const merged: ChatOptions = { ...base, ...overrides };
  if (Object.keys(mergedCustomParameters).length > 0) {
    merged.customParameters = mergedCustomParameters;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, "reasoningEffort")) {
    const resolvedReasoningEffort = resolveGameReasoningEffort(model, overrides.reasoningEffort ?? null);
    if (resolvedReasoningEffort) {
      merged.reasoningEffort = resolvedReasoningEffort;
      if (!Object.prototype.hasOwnProperty.call(overrides, "enableThinking")) {
        merged.enableThinking = true;
      }
    } else {
      delete merged.reasoningEffort;
      if (!Object.prototype.hasOwnProperty.call(overrides, "enableThinking")) {
        merged.enableThinking = false;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(overrides, "verbosity") && overrides.verbosity === undefined) {
    delete merged.verbosity;
  }
  return merged;
}

const SESSION_SUMMARY_CHARS_PER_TOKEN = 4;
const SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS = 256;
const SESSION_CONCLUSION_MIN_OUTPUT_TOKENS = 8192;
const CAMPAIGN_PROGRESSION_MIN_OUTPUT_TOKENS = SESSION_CONCLUSION_MIN_OUTPUT_TOKENS;
const GAME_LOREBOOK_KEEPER_MIN_OUTPUT_TOKENS = 16_384;
const GAME_LOREBOOK_KEEPER_MAX_ENTRIES = 32;
const SESSION_SUMMARY_TRUNCATION_MARKER = "\n\n[Middle of session transcript truncated to fit context window]\n\n";

type GameTranscriptMessage = { id: string; role: string; content: string | null | undefined };

function truncateSessionTranscriptMiddle(content: string, targetTokens: number): string {
  const targetChars = Math.max(
    SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS,
    Math.floor(targetTokens * SESSION_SUMMARY_CHARS_PER_TOKEN),
  );
  const chars = Array.from(content);
  if (chars.length <= targetChars) return content;

  if (targetChars <= SESSION_SUMMARY_TRUNCATION_MARKER.length + SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS) {
    return chars.slice(0, targetChars).join("");
  }

  const availableChars = targetChars - SESSION_SUMMARY_TRUNCATION_MARKER.length;
  const headChars = Math.ceil(availableChars * 0.65);
  const tailChars = Math.floor(availableChars * 0.35);
  return chars.slice(0, headChars).join("") + SESSION_SUMMARY_TRUNCATION_MARKER + chars.slice(-tailChars).join("");
}

function buildSessionConclusionMessages(args: {
  sessionNumber: number;
  language?: string | null;
  journalRecap: string;
  transcriptText: string;
  transcriptMessageCount: number;
  transcriptTruncated: boolean;
  latestState: unknown;
  currentStoryArc: string | null;
  currentPlotTwists: string[];
  currentPartyArcs: PartyArc[];
  currentMorale: number;
  currentCards: Array<Record<string, unknown>>;
  nextSessionRequest?: string | null;
}): ChatMessage[] {
  const transcriptLabel = args.transcriptTruncated
    ? `Session transcript (${args.transcriptMessageCount} messages, middle truncated to fit the selected context window):`
    : `Session transcript (${args.transcriptMessageCount} messages):`;

  const userLines = [
    `Session ${args.sessionNumber} journal recap (covers the full session):`,
    args.journalRecap,
    "",
    transcriptLabel,
    args.transcriptText,
  ];

  if (args.latestState) {
    userLines.push("", "Current game state:", JSON.stringify(args.latestState, null, 2));
  }

  const nextSessionRequest = args.nextSessionRequest?.trim();
  if (nextSessionRequest) {
    userLines.push(
      "",
      "The player requested this to happen during the next session:",
      nextSessionRequest,
      "Use this as steering guidance for the updated story arc, unresolved hooks, and resume point. Honor it when it fits the campaign continuity; do not force contradictions.",
    );
  }

  userLines.push(
    "",
    "Current story arc:",
    args.currentStoryArc ?? "",
    "",
    "Current plot twists:",
    JSON.stringify(args.currentPlotTwists, null, 2),
    "",
    "Current party arcs:",
    JSON.stringify(args.currentPartyArcs, null, 2),
    "",
    "Current party morale:",
    `${args.currentMorale}/100 (${getMoraleTier(args.currentMorale)})`,
    "",
    "Current character cards:",
    JSON.stringify(args.currentCards, null, 2),
    "",
    "Update the full end-of-session continuity state in one pass.",
    args.transcriptTruncated
      ? "The transcript only trims the middle to fit the selected context window; the journal recap still covers the full session."
      : "The journal recap and transcript together cover the full session.",
  );

  return [
    {
      role: "system",
      content: buildSessionConclusionPrompt({
        language: args.language ?? null,
        includeCharacterCards: args.currentCards.length > 0,
      }),
    },
    { role: "user", content: userLines.join("\n") },
  ];
}

function fitSessionConclusionMessages(args: {
  sessionNumber: number;
  language?: string | null;
  journalRecap: string;
  transcriptText: string;
  transcriptMessageCount: number;
  latestState: unknown;
  currentStoryArc: string | null;
  currentPlotTwists: string[];
  currentPartyArcs: PartyArc[];
  currentMorale: number;
  currentCards: Array<Record<string, unknown>>;
  nextSessionRequest?: string | null;
  maxContext: number;
  maxTokens?: number;
}): { messages: ChatMessage[]; transcriptTruncated: boolean } {
  let transcriptText = args.transcriptText;
  let transcriptTruncated = false;
  let conclusionMessages = buildSessionConclusionMessages({
    sessionNumber: args.sessionNumber,
    language: args.language,
    journalRecap: args.journalRecap,
    transcriptText,
    transcriptMessageCount: args.transcriptMessageCount,
    transcriptTruncated,
    latestState: args.latestState,
    currentStoryArc: args.currentStoryArc,
    currentPlotTwists: args.currentPlotTwists,
    currentPartyArcs: args.currentPartyArcs,
    currentMorale: args.currentMorale,
    currentCards: args.currentCards,
    nextSessionRequest: args.nextSessionRequest,
  });
  let fit = fitMessagesToContext(conclusionMessages, { maxContext: args.maxContext, maxTokens: args.maxTokens });
  let guard = 0;

  while (fit.trimmed && guard < 8 && Array.from(transcriptText).length > SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS) {
    guard += 1;
    transcriptTruncated = true;

    const currentTranscriptTokens = Math.ceil(Array.from(transcriptText).length / SESSION_SUMMARY_CHARS_PER_TOKEN);
    const overflowTokens = Math.max(1, fit.estimatedTokensBefore - (fit.inputBudget ?? fit.estimatedTokensBefore - 1));
    const targetTranscriptTokens = Math.max(
      Math.ceil(SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS / SESSION_SUMMARY_CHARS_PER_TOKEN),
      currentTranscriptTokens - overflowTokens - 32,
    );
    const nextTranscriptText = truncateSessionTranscriptMiddle(transcriptText, targetTranscriptTokens);
    if (nextTranscriptText === transcriptText) break;

    transcriptText = nextTranscriptText;
    conclusionMessages = buildSessionConclusionMessages({
      sessionNumber: args.sessionNumber,
      language: args.language,
      journalRecap: args.journalRecap,
      transcriptText,
      transcriptMessageCount: args.transcriptMessageCount,
      transcriptTruncated,
      latestState: args.latestState,
      currentStoryArc: args.currentStoryArc,
      currentPlotTwists: args.currentPlotTwists,
      currentPartyArcs: args.currentPartyArcs,
      currentMorale: args.currentMorale,
      currentCards: args.currentCards,
      nextSessionRequest: args.nextSessionRequest,
    });
    fit = fitMessagesToContext(conclusionMessages, { maxContext: args.maxContext, maxTokens: args.maxTokens });
  }

  return {
    messages: fit.trimmed ? fit.messages : conclusionMessages,
    transcriptTruncated,
  };
}

function parseJSON(raw: string): unknown {
  return parseGameJsonish(raw);
}

type GameLorebookKeeperEntry = {
  entryName: string;
  content: string;
  keys: string[];
  tag: string;
  description: string;
};

type GameLorebookKeeperBook = {
  id: string;
  name?: string | null;
  chatId?: string | null;
  sourceAgentId?: string | null;
};

type GameLorebookKeeperRunResult =
  | { status: "success"; lorebookId: string; entryCount: number }
  | { status: "failed"; lorebookId: string | null; error: string }
  | { status: "skipped"; reason: string };

function parseChatCharacterIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function normalizeKeeperStringList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0)),
  ).slice(0, limit);
}

function truncateKeeperName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  return trimmed.length <= 190 ? trimmed : `${trimmed.slice(0, 187).trim()}...`;
}

function inferKeeperKeys(entryName: string, tag: string): string[] {
  const cleaned = entryName
    .replace(/session\s+\d+/gi, " ")
    .replace(/[^a-zA-Z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned
    .split(" ")
    .map((word) => word.trim())
    .filter(
      (word) => word.length >= 3 && !["lore", "world", "party", "player", "locations"].includes(word.toLowerCase()),
    );
  return Array.from(new Set([...words.slice(0, 5), tag].filter(Boolean))).slice(0, 6);
}

function normalizeGameLorebookKeeperEntries(raw: unknown): GameLorebookKeeperEntry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const container = raw as { entries?: unknown; updates?: unknown };
  const rawEntries = Array.isArray(container.entries)
    ? container.entries
    : Array.isArray(container.updates)
      ? container.updates
      : [];

  return rawEntries
    .flatMap((entry): GameLorebookKeeperEntry[] => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const source = entry as Record<string, unknown>;
      const rawName =
        typeof source.entryName === "string" ? source.entryName : typeof source.name === "string" ? source.name : "";
      const content = typeof source.content === "string" ? source.content.trim() : "";
      if (!rawName.trim() || !content) return [];

      const tag =
        typeof source.tag === "string" && source.tag.trim()
          ? source.tag.trim().replace(/\s+/g, "_").toLowerCase()
          : "game_lore";
      const entryName = truncateKeeperName(rawName);
      const keys = normalizeKeeperStringList(source.keys, 10);
      const description =
        typeof source.description === "string" && source.description.trim()
          ? source.description.trim()
          : `Game Lorebook Keeper entry tagged ${tag}.`;

      return [
        {
          entryName,
          content,
          keys: keys.length > 0 ? keys : inferKeeperKeys(entryName, tag),
          tag,
          description,
        },
      ];
    })
    .slice(0, GAME_LOREBOOK_KEEPER_MAX_ENTRIES);
}

function uniqueKeeperEntryName(name: string, usedNames: Set<string>): string {
  const base = truncateKeeperName(name);
  const normalizedBase = base.toLowerCase();
  if (!usedNames.has(normalizedBase)) {
    usedNames.add(normalizedBase);
    return base;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = truncateKeeperName(`${base} (${suffix})`);
    const normalized = candidate.toLowerCase();
    if (!usedNames.has(normalized)) {
      usedNames.add(normalized);
      return candidate;
    }
  }

  const fallback = truncateKeeperName(`${base} (${randomUUID().slice(0, 8)})`);
  usedNames.add(fallback.toLowerCase());
  return fallback;
}

function applyGameSegmentEditsForPrompt(
  messages: GameTranscriptMessage[],
  meta: Record<string, unknown>,
): Array<{ role: string; content: string }> {
  const mappedMessages = messages.map((message) => ({
    role: message.role,
    content: message.content ?? "",
  }));
  applyAllSegmentEdits(mappedMessages, meta, messages);
  return mappedMessages;
}

function isSessionConclusionMessage(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith("**Session ") && trimmed.includes(" Concluded**");
}

function formatGameTranscript(messages: Array<{ role: string; content: string }>): string {
  return messages.map((message) => `[${message.role}] ${message.content}`).join("\n\n");
}

function formatGameLorebookKeeperTranscript(messages: GameTranscriptMessage[], meta: Record<string, unknown>): string {
  const promptMessages = applyGameSegmentEditsForPrompt(messages, meta)
    .filter((message) => message.role !== "system")
    .filter((message) => !isSessionConclusionMessage(message.content));
  return formatGameTranscript(promptMessages);
}

function formatGameLorebookKeeperError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Lorebook Keeper failed.");
}

async function resolveGameLorebookKeeperPartyNames(
  app: FastifyInstance,
  chat: NonNullable<StoredChatRecord>,
  meta: Record<string, unknown>,
  setupConfig: GameSetupConfig | null,
): Promise<string[]> {
  const chatCharacterIds = parseChatCharacterIds(chat.characterIds);
  const partyIds = setupConfig
    ? reconcileGamePartyCharacterIds(meta, setupConfig, chatCharacterIds)
    : Array.from(
        new Set(
          (Array.isArray(meta.gamePartyCharacterIds) ? meta.gamePartyCharacterIds : chatCharacterIds).filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0,
          ),
        ),
      );
  if (partyIds.length === 0) return [];

  const characterRows = await createCharactersStorage(app.db).list();
  const characterNameById = new Map<string, string>();
  for (const row of characterRows as Array<{ id: string; data?: unknown }>) {
    const data = parseStoredJson<Record<string, unknown>>(row.data);
    const name = typeof data?.name === "string" ? data.name.trim() : "";
    if (name) characterNameById.set(row.id, name);
  }

  const npcs = Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as GameNpc[]) : [];
  const cardNames = Array.isArray(meta.gameCharacterCards)
    ? (meta.gameCharacterCards as Array<Record<string, unknown>>)
        .map((card) => (typeof card.name === "string" ? card.name.trim() : ""))
        .filter(Boolean)
    : [];

  return partyIds.flatMap((id, index) => {
    if (!isPartyNpcId(id)) {
      const name = characterNameById.get(id) ?? cardNames[index] ?? "";
      return name ? [name] : [];
    }

    const npc = npcs.find((candidate) => buildPartyNpcId(candidate.name) === id);
    if (npc?.name) return [npc.name];

    const cardName = cardNames.find((name) => buildPartyNpcId(name) === id);
    return cardName ? [cardName] : [];
  });
}

async function resolveGameLorebookKeeperBook(args: {
  lorebooksStore: ReturnType<typeof createLorebooksStorage>;
  chat: NonNullable<StoredChatRecord>;
  meta: Record<string, unknown>;
}): Promise<GameLorebookKeeperBook | null> {
  const preferredId =
    typeof args.meta.gameLorebookKeeperLorebookId === "string" && args.meta.gameLorebookKeeperLorebookId.trim()
      ? args.meta.gameLorebookKeeperLorebookId.trim()
      : null;

  if (preferredId) {
    const preferred = (await args.lorebooksStore.getById(preferredId)) as GameLorebookKeeperBook | null;
    if (
      preferred?.id &&
      (preferred.chatId === args.chat.id || preferred.sourceAgentId === GAME_LOREBOOK_KEEPER_SOURCE_ID)
    ) {
      return preferred;
    }
  }

  const chatBooks = (await args.lorebooksStore.listByChat(args.chat.id)) as unknown as GameLorebookKeeperBook[];
  const existing = chatBooks.find((book) => book.sourceAgentId === GAME_LOREBOOK_KEEPER_SOURCE_ID);
  if (existing) return existing;

  const rawName = `${args.chat.name?.trim() || "Game"} - Lorebook Keeper`;
  const created = (await args.lorebooksStore.create({
    name: truncateKeeperName(rawName),
    description: "Game-scoped lorebook maintained after session conclusion by Game Lorebook Keeper.",
    category: "world",
    chatId: args.chat.id,
    enabled: true,
    generatedBy: "agent",
    sourceAgentId: GAME_LOREBOOK_KEEPER_SOURCE_ID,
    tags: ["game", "lorebook-keeper"],
    scanDepth: 6,
    tokenBudget: 4096,
  })) as GameLorebookKeeperBook | null;

  return created?.id ? created : null;
}

function buildGameLorebookKeeperMessages(args: {
  chatName: string;
  setupConfig: GameSetupConfig | null;
  sessionNumber: number;
  sessionSummary: SessionSummary;
  partyNames: string[];
  existingEntries: Array<{ name?: string | null; tag?: string | null; keys?: string[] | null }>;
  transcriptText: string;
}): ChatMessage[] {
  const existingEntrySummary = args.existingEntries
    .slice(0, 80)
    .map((entry) => {
      const keys = Array.isArray(entry.keys) && entry.keys.length ? ` keys=${entry.keys.join(", ")}` : "";
      const tag = entry.tag ? ` tag=${entry.tag}` : "";
      return `- ${entry.name ?? "Untitled"}${tag}${keys}`;
    })
    .join("\n");

  const systemPrompt = [
    "You are Marinara's Game Lorebook Keeper.",
    "You run only after a Game Mode session has concluded. Preserve durable continuity for this specific game.",
    "Do not write a session recap. Do not invent future plot. Do not create entries for mundane rooms, transient actions, or things the player did not learn.",
    "Create entries only when they will help the GM keep the developing world coherent in future sessions.",
    "When an exact dialogue exchange is important, copy the exact lines into the entry instead of paraphrasing them.",
    "Return strict JSON only. No markdown, no commentary.",
  ].join("\n");

  const userPrompt = [
    `Game: ${args.chatName}`,
    `Session: ${args.sessionNumber}`,
    args.setupConfig
      ? `Setup: ${JSON.stringify({
          genre: args.setupConfig.genre,
          setting: args.setupConfig.setting,
          tone: args.setupConfig.tone,
          difficulty: args.setupConfig.difficulty,
          playerGoals: args.setupConfig.playerGoals,
          language: args.setupConfig.language,
        })}`
      : "Setup: unknown",
    `Party members at session end: ${args.partyNames.length ? args.partyNames.join(", ") : "none"}`,
    "",
    "Existing entries in the game lorebook:",
    existingEntrySummary || "- none yet",
    "",
    "Session conclusion JSON:",
    JSON.stringify(args.sessionSummary, null, 2),
    "",
    "Session transcript:",
    args.transcriptText || "[No transcript available]",
    "",
    "Write JSON in exactly this shape:",
    `{"entries":[{"entryName":"World Lore - Session ${args.sessionNumber}","tag":"world_lore","keys":["specific keyword"],"description":"short editor-facing note","content":"entry text"}]}`,
    "",
    "Entry selection rules:",
    "- World lore: one entry, 0-4 paragraphs, only if important world lore was established or revealed.",
    "- Locations: one entry, 0-4 paragraphs, only for general discovered locations or meaningful location context; do not list every room.",
    "- Party members: one entry per party member present at session end, only if the player learned something important about them or had important exchanges with them. Include up to 3 learned details or exchanges per member.",
    "- Player revelations: one entry total, only if the player's revealed history, nature, goals, powers, secrets, or relationships matter later. Include up to 3 items.",
    "- Omit categories that have nothing important. Return an empty entries array if nothing durable should be saved.",
    "- Entry names must include the session number so this run adds new entries instead of overwriting older session notes.",
    "- Provide 3-8 useful trigger keys per entry.",
  ].join("\n");

  return [
    { role: "system", content: systemPrompt, contextKind: "prompt" },
    { role: "user", content: userPrompt, contextKind: "history" },
  ];
}

async function createGameLorebookKeeperEntries(args: {
  lorebooksStore: ReturnType<typeof createLorebooksStorage>;
  lorebookId: string;
  sessionNumber: number;
  entries: GameLorebookKeeperEntry[];
  replaceExistingSessionEntries?: boolean;
}): Promise<number> {
  const existingEntries = (await args.lorebooksStore.listEntries(args.lorebookId)) as unknown as Array<{
    id: string;
    name?: string | null;
    locked?: unknown;
    dynamicState?: Record<string, unknown> | null;
  }>;

  if (args.replaceExistingSessionEntries) {
    for (const entry of existingEntries) {
      const state = entry.dynamicState && typeof entry.dynamicState === "object" ? entry.dynamicState : {};
      const isKeeperEntry = state.source === GAME_LOREBOOK_KEEPER_SOURCE_ID;
      const isSameSession = state.sessionNumber === args.sessionNumber;
      const isLocked = entry.locked === true || entry.locked === "true";
      if (isKeeperEntry && isSameSession && !isLocked) {
        await args.lorebooksStore.removeEntry(entry.id);
      }
    }
  }

  if (args.entries.length === 0) return 0;

  const refreshedEntries = args.replaceExistingSessionEntries
    ? ((await args.lorebooksStore.listEntries(args.lorebookId)) as Array<{ name?: string | null }>)
    : existingEntries;
  const usedNames = new Set(
    refreshedEntries.map((entry) => entry.name?.trim().toLowerCase()).filter((name): name is string => !!name),
  );

  let createdCount = 0;
  for (const entry of args.entries) {
    const name = uniqueKeeperEntryName(entry.entryName, usedNames);
    await args.lorebooksStore.createEntry({
      lorebookId: args.lorebookId,
      name,
      content: entry.content,
      description: entry.description,
      keys: entry.keys,
      enabled: true,
      constant: true,
      tag: entry.tag,
      role: "system",
      position: 0,
      depth: 4,
      order: 100 + refreshedEntries.length + createdCount,
      generationTriggerFilterMode: "include",
      generationTriggerFilters: ["game"],
      preventRecursion: true,
      dynamicState: {
        source: GAME_LOREBOOK_KEEPER_SOURCE_ID,
        sessionNumber: args.sessionNumber,
      },
    });
    createdCount += 1;
  }

  return createdCount;
}

async function runGameLorebookKeeperAfterConclusion(args: {
  app: FastifyInstance;
  chatId: string;
  connectionId?: string | null;
  sessionNumber: number;
  sessionSummary: SessionSummary;
  replaceExistingSessionEntries?: boolean;
  streaming?: boolean;
}): Promise<GameLorebookKeeperRunResult> {
  const chats = createChatsStorage(args.app.db);
  const chat = await chats.getById(args.chatId);
  if (!chat) return { status: "skipped", reason: "Chat not found" };
  const meta = parseMeta(chat.metadata);
  if (meta.gameLorebookKeeperEnabled !== true) return { status: "skipped", reason: "Lorebook Keeper is disabled" };

  let lorebookId: string | null = null;

  try {
    const lorebooksStore = createLorebooksStorage(args.app.db);
    const setupConfig = (meta.gameSetupConfig as GameSetupConfig | null) ?? null;
    const lorebook = await resolveGameLorebookKeeperBook({ lorebooksStore, chat, meta });
    if (!lorebook?.id) {
      throw new Error("Could not resolve target lorebook.");
    }
    lorebookId = lorebook.id;

    await chats.patchMetadata(args.chatId, (current) => {
      const activeLorebookIds = Array.isArray(current.activeLorebookIds)
        ? current.activeLorebookIds.filter((id): id is string => typeof id === "string")
        : [];
      return {
        gameLorebookKeeperLorebookId: lorebook.id,
        activeLorebookIds: Array.from(new Set([...activeLorebookIds, lorebook.id])),
        gameLorebookKeeperLastRun: {
          sessionNumber: args.sessionNumber,
          status: "running",
          updatedAt: new Date().toISOString(),
          lorebookId: lorebook.id,
        },
      };
    });

    const connections = createConnectionsStorage(args.app.db);
    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      args.connectionId,
      chat.connectionId,
    );
    const generationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const streaming = args.streaming ?? true;
    const options = gameGenOptions(
      conn.model,
      {
        maxTokens: Math.max(GAME_LOREBOOK_KEEPER_MIN_OUTPUT_TOKENS, generationParameters?.maxTokens ?? 0),
        temperature: 0.35,
        stream: streaming,
        ...(streaming ? { onToken: () => {} } : {}),
      },
      generationParameters,
    );

    const messages = await chats.listMessages(args.chatId);
    const partyNames = await resolveGameLorebookKeeperPartyNames(args.app, chat, meta, setupConfig);
    const existingEntries = (await lorebooksStore.listEntries(lorebook.id)) as Array<{
      name?: string | null;
      tag?: string | null;
      keys?: string[] | null;
    }>;
    const keeperMessages = buildGameLorebookKeeperMessages({
      chatName: chat.name || args.chatId,
      setupConfig,
      sessionNumber: args.sessionNumber,
      sessionSummary: args.sessionSummary,
      partyNames,
      existingEntries,
      transcriptText: formatGameLorebookKeeperTranscript(messages, meta),
    });
    const fitted = fitMessagesToContext(keeperMessages, {
      maxContext: conn.maxContext,
      maxTokens: options.maxTokens,
    });

    const result = await provider.chatComplete(fitted.trimmed ? fitted.messages : keeperMessages, options);
    const extraction = extractLeadingThinkingBlocks(result.content ?? "");
    const parsed = parseJSON(extraction.content) as Record<string, unknown>;
    const entries = normalizeGameLorebookKeeperEntries(parsed);
    const createdCount = await createGameLorebookKeeperEntries({
      lorebooksStore,
      lorebookId: lorebook.id,
      sessionNumber: args.sessionNumber,
      entries,
      replaceExistingSessionEntries: args.replaceExistingSessionEntries,
    });

    await chats.patchMetadata(args.chatId, {
      gameLorebookKeeperLastRun: {
        sessionNumber: args.sessionNumber,
        status: "success",
        updatedAt: new Date().toISOString(),
        lorebookId: lorebook.id,
        entryCount: createdCount,
      },
    });

    logger.info(
      "[game/lorebook-keeper] Added %d entries to lorebook %s for chat %s session %d",
      createdCount,
      lorebook.id,
      args.chatId,
      args.sessionNumber,
    );
    return { status: "success", lorebookId: lorebook.id, entryCount: createdCount };
  } catch (err) {
    const error = formatGameLorebookKeeperError(err);
    await chats.patchMetadata(args.chatId, {
      gameLorebookKeeperLastRun: {
        sessionNumber: args.sessionNumber,
        status: "failed",
        updatedAt: new Date().toISOString(),
        lorebookId,
        error,
      },
    });
    logger.warn(err, "[game/lorebook-keeper] Failed to update game lorebook for chat %s", args.chatId);
    return { status: "failed", lorebookId, error };
  }
}

function queueGameLorebookKeeperAfterConclusion(
  args: Parameters<typeof runGameLorebookKeeperAfterConclusion>[0],
): void {
  void runGameLorebookKeeperAfterConclusion(args).catch((err) => {
    logger.warn(err, "[game/lorebook-keeper] Queued run crashed for chat %s", args.chatId);
  });
}

type JsonRepairKind = "game_setup" | "session_conclusion" | "campaign_progression";

type JsonRepairPayload = {
  kind: JsonRepairKind;
  title: string;
  rawJson: string;
  applyEndpoint: string;
  applyBody: Record<string, unknown>;
};

function sendJsonRepairError(
  reply: FastifyReply,
  error: string,
  repair: JsonRepairPayload,
  validationError?: string,
): void {
  reply.code(422).send({
    error,
    ...(validationError ? { validationError } : {}),
    rawResponse: repair.rawJson,
    jsonRepair: repair,
  });
}

function buildJsonRepairPayload(args: {
  kind: JsonRepairKind;
  title: string;
  rawJson: string;
  applyEndpoint: string;
  applyBody: Record<string, unknown>;
}): JsonRepairPayload {
  return {
    kind: args.kind,
    title: args.title,
    rawJson: args.rawJson,
    applyEndpoint: args.applyEndpoint,
    applyBody: args.applyBody,
  };
}

function validateGameSetupPayload(setupData: Record<string, unknown>): string | null {
  const missing: string[] = [];
  if (!setupData.storyArc) missing.push("storyArc");
  if (!setupData.worldOverview) missing.push("worldOverview");
  if (!Array.isArray(setupData.plotTwists) || setupData.plotTwists.length === 0) missing.push("plotTwists");
  if (!Array.isArray(setupData.startingNpcs) || setupData.startingNpcs.length === 0) missing.push("startingNpcs");
  return missing.length > 0
    ? `Setup generation incomplete — missing: ${missing.join(", ")}. Try again or repair the JSON manually.`
    : null;
}

function parseStoredJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return raw as T;
}

function normalizeJournalMatch(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

type SceneAssetNpcCandidate = {
  name: string;
  description: string;
  avatarUrl?: string | null;
};

type SceneAssetNpcAvatarEntry = SceneAssetNpcCandidate & {
  avatarUrl: string;
};

const NARRATION_NPC_SPEECH_VERB_PATTERN =
  "(?:said|says|whispered|whispers|muttered|mutters|replied|replies|called|calls|shouted|shouts|asked|asks|warned|warns|growled|growls|hissed|hisses|exclaimed|exclaims|murmured|murmurs|sighed|sighs|snapped|snaps|barked|barks|declared|declares|continued|continues|added|adds|spoke|speaks|began|begins|remarked|remarks|chuckled|chuckles|laughed|laughs|cried|cries)";

const NARRATION_NPC_REJECT_LABELS = new Set([
  "one",
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "everyone",
  "everybody",
  "no one",
  "nobody",
  "other",
  "another",
  "figure",
  "voice",
  "stranger",
  "man",
  "woman",
  "boy",
  "girl",
]);

const NARRATION_NPC_REJECT_TOKENS = new Set([
  "accidentally",
  "word",
  "words",
  "line",
  "lines",
  "met",
  "not",
  "neutral",
  "acquired",
  "used",
  "lost",
  "removed",
]);

function buildGameNpcId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || randomUUID();
}

function buildNpcAvatarUrl(chatId: string, name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug ? `/api/avatars/npc/${chatId}/${slug}.png` : null;
}

function hasReadableAvatar(avatarUrl: string | null | undefined): avatarUrl is string {
  return !!avatarUrl && !!readAvatarBase64(avatarUrl);
}

function addExistingNpcAvatar(avatarByName: Map<string, string>, name: unknown, avatarUrl: unknown): void {
  if (typeof name !== "string" || typeof avatarUrl !== "string") return;
  const normalizedName = normalizeJournalMatch(name);
  const normalizedAvatarUrl = avatarUrl.trim();
  if (!normalizedName || !normalizedAvatarUrl || !hasReadableAvatar(normalizedAvatarUrl)) return;
  avatarByName.set(normalizedName, normalizedAvatarUrl);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLikelyNarrationNpcName(rawName: string): boolean {
  const name = rawName.trim();
  if (!name || name.length > 48) return false;
  if (!/^\p{Lu}/u.test(name)) return false;
  if (/[<>{}\[\]"“”]/u.test(name)) return false;

  const normalized = normalizeJournalMatch(name);
  if (!normalized || NARRATION_NPC_REJECT_LABELS.has(normalized)) return false;

  const tokens = normalized.split(/\s+/);
  if (tokens.some((token) => NARRATION_NPC_REJECT_TOKENS.has(token))) return false;
  return true;
}

function extractNarrationSnippetForName(narration: string, name: string): string {
  const cleaned = narration
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[^\]]+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return `${name} appears in the current scene.`;

  const nameRe = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
  const sentenceMatches = cleaned.match(/[^.!?\n]+[.!?]?/g) ?? [];
  for (const rawSentence of sentenceMatches) {
    const sentence = rawSentence.trim();
    if (sentence && nameRe.test(sentence)) {
      return sentence.slice(0, 280);
    }
  }

  const matchIndex = cleaned.search(nameRe);
  if (matchIndex === -1) return `${name} appears in the current scene.`;

  const start = Math.max(0, matchIndex - 100);
  const end = Math.min(cleaned.length, matchIndex + 220);
  return cleaned.slice(start, end).trim();
}

function extractNarrationNpcCandidates(narration: string, excludedNames: string[]): SceneAssetNpcCandidate[] {
  const candidates = new Map<string, SceneAssetNpcCandidate>();
  const excluded = new Set(excludedNames.map(normalizeJournalMatch));
  const patterns = [
    /<speaker="([^"]+)">/gi,
    new RegExp(`(?:^|\\n)\\s*([A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?)\\s*:\\s*["“«「]`, "gm"),
    new RegExp(
      `\"[^\"]+\"[,.]?\\s+([A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?)\\s+${NARRATION_NPC_SPEECH_VERB_PATTERN}\\b`,
      "gi",
    ),
    new RegExp(`\\b([A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?)\\b\\s+${NARRATION_NPC_SPEECH_VERB_PATTERN}\\b`, "gi"),
    /\b(?:named|called)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)?)\b/gi,
    /\b([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)?),\s+(?:a|an|the)\b/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(narration)) !== null) {
      const rawName = match[1]?.trim();
      if (!rawName) continue;
      if (!isLikelyNarrationNpcName(rawName)) continue;

      const normalizedName = normalizeJournalMatch(rawName);
      if (!normalizedName || excluded.has(normalizedName)) continue;
      if (candidates.has(normalizedName)) continue;

      candidates.set(normalizedName, {
        name: rawName,
        description: extractNarrationSnippetForName(narration, rawName),
      });
    }
  }

  return [...candidates.values()];
}

function buildSceneAssetNpcCandidates(
  trackedNpcsRaw: Array<Record<string, unknown>>,
  presentCharactersRaw: unknown,
  excludedNames: string[],
  narration: string,
): SceneAssetNpcCandidate[] {
  const excluded = new Set(excludedNames.map(normalizeJournalMatch));
  const candidates = new Map<string, SceneAssetNpcCandidate>();

  const upsertCandidate = (nameRaw: unknown, descriptionRaw: unknown, avatarUrlRaw: unknown) => {
    if (typeof nameRaw !== "string") return;

    const name = nameRaw.trim();
    if (!name) return;

    const normalizedName = normalizeJournalMatch(name);
    if (!normalizedName || excluded.has(normalizedName)) return;

    const description = typeof descriptionRaw === "string" ? descriptionRaw.trim() : "";
    const avatarUrl = typeof avatarUrlRaw === "string" && avatarUrlRaw.trim() ? avatarUrlRaw.trim() : null;
    const existing = candidates.get(normalizedName);

    if (existing) {
      if (!existing.description && description) existing.description = description;
      if (!existing.avatarUrl && avatarUrl) existing.avatarUrl = avatarUrl;
      return;
    }

    candidates.set(normalizedName, {
      name,
      description,
      avatarUrl,
    });
  };

  for (const npc of trackedNpcsRaw) {
    upsertCandidate(npc.name, npc.description, npc.avatarUrl);
  }

  const presentCharacters = parseStoredJson<Array<Record<string, unknown>>>(presentCharactersRaw) ?? [];
  for (const presentCharacter of presentCharacters) {
    upsertCandidate(presentCharacter.name, presentCharacter.appearance, presentCharacter.avatarPath);
  }

  for (const candidate of extractNarrationNpcCandidates(narration, excludedNames)) {
    upsertCandidate(candidate.name, candidate.description, candidate.avatarUrl);
  }

  return [...candidates.values()];
}

function upsertGameNpcAvatarEntries(currentNpcs: GameNpc[], avatarEntries: SceneAssetNpcAvatarEntry[]): GameNpc[] {
  if (avatarEntries.length === 0) return currentNpcs;

  const sanitizedCurrentNpcs = sanitizeGameNpcAvatarUrls(currentNpcs);
  const nextNpcs = [...sanitizedCurrentNpcs];
  let changed = sanitizedCurrentNpcs !== currentNpcs;

  for (const entry of avatarEntries) {
    const normalizedName = normalizeJournalMatch(entry.name);
    if (!normalizedName) continue;

    const existingIndex = nextNpcs.findIndex((npc) => normalizeJournalMatch(npc.name) === normalizedName);
    if (existingIndex !== -1) {
      const existing = nextNpcs[existingIndex]!;
      let nextNpc = existing;

      if (existing.avatarUrl !== entry.avatarUrl) {
        nextNpc = { ...nextNpc, avatarUrl: entry.avatarUrl };
      }
      if (!nextNpc.description && entry.description) {
        nextNpc = { ...nextNpc, description: entry.description, descriptionSource: "narration" };
      }

      if (nextNpc !== existing) {
        nextNpcs[existingIndex] = nextNpc;
        changed = true;
      }
      continue;
    }

    nextNpcs.push({
      id: buildGameNpcId(entry.name),
      name: entry.name,
      emoji: "👤",
      description: entry.description,
      location: "",
      reputation: 0,
      met: false,
      notes: [],
      avatarUrl: entry.avatarUrl,
      descriptionSource: entry.description ? "narration" : undefined,
    });
    changed = true;
  }

  return changed ? nextNpcs : currentNpcs;
}

function locationMatches(candidate: string, aliases: string[]): boolean {
  const candidateKey = normalizeJournalMatch(candidate);
  if (!candidateKey) return false;

  return aliases.some((alias) => {
    const aliasKey = normalizeJournalMatch(alias);
    if (!aliasKey) return false;
    const shortest = Math.min(candidateKey.length, aliasKey.length);
    return (
      candidateKey === aliasKey ||
      (shortest >= 4 && (candidateKey.includes(aliasKey) || aliasKey.includes(candidateKey)))
    );
  });
}

function getCurrentMapLocation(map: GameMap | null): { name: string; description: string; aliases: string[] } | null {
  if (!map) return null;

  if (map.type === "node" && typeof map.partyPosition === "string") {
    const node = map.nodes?.find((entry) => entry.id === map.partyPosition);
    if (!node) {
      return {
        name: map.partyPosition,
        description: "",
        aliases: [map.partyPosition],
      };
    }
    return {
      name: node.label,
      description: node.description ?? "",
      aliases: [node.id, node.label],
    };
  }

  if (map.type === "grid" && typeof map.partyPosition === "object" && "x" in map.partyPosition) {
    const position = map.partyPosition;
    const cell = map.cells?.find((entry) => entry.x === position.x && entry.y === position.y);
    if (!cell) return null;
    return {
      name: cell.label,
      description: cell.description ?? "",
      aliases: [cell.label, `${cell.x},${cell.y}`, `${cell.x}:${cell.y}`],
    };
  }

  return null;
}

function collectDiscoveredMapLocations(map: GameMap | null): Array<{ name: string; description: string }> {
  if (!map) return [];

  if (map.type === "node") {
    return (map.nodes ?? [])
      .filter((node) => node.discovered)
      .map((node) => ({ name: node.label, description: node.description ?? "" }));
  }

  return (map.cells ?? [])
    .filter((cell) => cell.discovered)
    .map((cell) => ({ name: cell.label, description: cell.description ?? "" }));
}

function buildNpcMetInteraction(npc: GameNpc): string {
  const location = npc.location?.trim();
  return location && location.toLowerCase() !== "unknown" ? `Met at ${location}.` : "Met.";
}

function extractActiveQuests(playerStatsRaw: unknown): QuestProgress[] {
  const playerStats = parseStoredJson<Record<string, unknown>>(playerStatsRaw);
  if (!playerStats || !Array.isArray(playerStats.activeQuests)) return [];

  return playerStats.activeQuests.filter(
    (quest): quest is QuestProgress =>
      !!quest && typeof quest === "object" && typeof (quest as QuestProgress).name === "string",
  );
}

function extractPresentCharacterNames(presentCharactersRaw: unknown): string[] {
  const presentCharacters = parseStoredJson<Array<{ name?: string }>>(presentCharactersRaw);
  if (!Array.isArray(presentCharacters)) return [];
  return presentCharacters.map((entry) => entry?.name?.trim()).filter((name): name is string => !!name);
}

function markNpcsMetByNames(meta: Record<string, unknown>, names: string[]): Record<string, unknown> {
  if (names.length === 0) return meta;

  const knownNames = new Set(names.map((name) => normalizeJournalMatch(name)));
  const npcs = (meta.gameNpcs as GameNpc[]) ?? [];
  let changed = false;
  const updatedNpcs = npcs.map((npc) => {
    if (npc.met || !knownNames.has(normalizeJournalMatch(npc.name))) return npc;
    changed = true;
    return { ...npc, met: true };
  });

  return changed ? { ...meta, gameNpcs: updatedNpcs } : meta;
}

function markNpcsMetAtCurrentLocation(meta: Record<string, unknown>): Record<string, unknown> {
  const map = (meta.gameMap as GameMap) ?? null;
  const location = getCurrentMapLocation(map);
  if (!location) return meta;

  const npcs = (meta.gameNpcs as GameNpc[]) ?? [];
  let changed = false;
  const updatedNpcs = npcs.map((npc) => {
    if (npc.met || !locationMatches(npc.location, location.aliases)) return npc;
    changed = true;
    return { ...npc, met: true };
  });

  return changed ? { ...meta, gameNpcs: updatedNpcs } : meta;
}

function reconcileJournal(
  journal: Journal,
  meta: Record<string, unknown>,
  activeQuests: QuestProgress[],
  currentLocation?: string | null,
): Journal {
  let next = journal;

  const discoveredLocationKeys = new Set<string>();
  for (const map of getGameMapsFromMeta(meta)) {
    for (const location of collectDiscoveredMapLocations(map)) {
      const key = normalizeJournalMatch(location.name);
      if (key && discoveredLocationKeys.has(key)) continue;
      if (key) discoveredLocationKeys.add(key);
      next = addLocationEntry(next, location.name, location.description);
    }
  }

  if (discoveredLocationKeys.size === 0) {
    for (const location of collectDiscoveredMapLocations((meta.gameMap as GameMap) ?? null)) {
      next = addLocationEntry(next, location.name, location.description);
    }
  }

  const locationName = currentLocation?.trim();
  if (locationName) {
    next = addLocationEntry(next, locationName, `The party is at ${locationName}.`);
  }

  for (const npc of (meta.gameNpcs as GameNpc[]) ?? []) {
    if (!npc.met) continue;
    const interaction = buildNpcMetInteraction(npc);
    const hasInteraction = next.npcLog.some(
      (entry) => entry.npcName === npc.name && entry.interactions.includes(interaction),
    );
    if (!hasInteraction) {
      next = addNpcEntry(next, npc, interaction);
    }
  }

  for (const quest of activeQuests) {
    const objectiveRows = Array.isArray(quest.objectives)
      ? quest.objectives.filter((objective) => !!objective && typeof objective.text === "string")
      : [];
    const objectives = objectiveRows.map((objective) => `${objective.completed ? "[Done] " : ""}${objective.text}`);
    const currentObjective = objectiveRows.find((objective) => !objective.completed)?.text;
    next = upsertQuest(next, {
      id: quest.questEntryId || quest.name,
      name: quest.name,
      status: quest.completed ? "completed" : "active",
      description: currentObjective ?? (quest.completed ? `${quest.name} completed.` : `${quest.name} is in progress.`),
      objectives,
    });
  }

  return next;
}

// ──────────────────────────────────────────────
// Route Registration
// ──────────────────────────────────────────────

export async function gameRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    const body = (req.body as Record<string, unknown> | undefined) ?? {};
    const params = (req.params as Record<string, unknown> | undefined) ?? {};
    const chatId =
      typeof body.chatId === "string"
        ? body.chatId
        : typeof params.chatId === "string"
          ? params.chatId
          : null;
    enterAiAuditContext({ source: "game", chatId });
  });

  const buildHydratedGameMeta = async (
    chatId: string,
    baseMeta: Record<string, unknown>,
    options: { explicitLocation?: string | null } = {},
  ): Promise<Record<string, unknown>> => {
    const gameStateStore = createGameStateStorage(app.db);
    const latestState = await gameStateStore.getLatest(chatId);

    let hydratedMeta = baseMeta;
    const gameNpcs = Array.isArray(hydratedMeta.gameNpcs) ? (hydratedMeta.gameNpcs as GameNpc[]) : null;
    if (gameNpcs) {
      const sanitizedNpcs = sanitizeGameNpcAvatarUrls(gameNpcs);
      if (sanitizedNpcs !== gameNpcs) hydratedMeta = { ...hydratedMeta, gameNpcs: sanitizedNpcs };
    }
    const presentCharacterNames = extractPresentCharacterNames(latestState?.presentCharacters);
    if (presentCharacterNames.length > 0) {
      hydratedMeta = markNpcsMetByNames(hydratedMeta, presentCharacterNames);
    }

    const activeQuests = extractActiveQuests(latestState?.playerStats);
    // Prefer a caller-supplied explicit location over the most recent snapshot. The snapshot's
    // location field only refreshes after /generate persists a new game state, so callers that
    // have just committed a deliberate move (e.g. /map/move) need to override it — otherwise the
    // sync and journal reconciliation below run against the previous location.
    const snapshotLocation = typeof latestState?.location === "string" ? latestState.location : null;
    const currentLocation = options.explicitLocation ?? snapshotLocation;
    hydratedMeta = syncGameMapMetaPartyPosition(hydratedMeta, currentLocation);
    const currentJournal = (hydratedMeta.gameJournal as Journal) ?? createJournal();
    return {
      ...hydratedMeta,
      gameJournal: reconcileJournal(currentJournal, hydratedMeta, activeQuests, currentLocation),
    };
  };

  type SetupRpgContext = {
    partyRpgStats: Record<
      string,
      { enabled: boolean; attributes: Array<{ name: string; value: number }>; hp: { value: number; max: number } }
    >;
    personaRpgStats: {
      enabled: boolean;
      attributes: Array<{ name: string; value: number }>;
      hp: { value: number; max: number };
    } | null;
    personaName: string | null;
  };

  const loadSetupRpgContext = async (
    chat: NonNullable<StoredChatRecord>,
    setupConfig: GameSetupConfig,
  ): Promise<SetupRpgContext> => {
    const characters = createCharactersStorage(app.db);
    const partyRpgStats: SetupRpgContext["partyRpgStats"] = {};
    for (const pcId of setupConfig.partyCharacterIds) {
      const pc = await characters.getById(pcId);
      if (!pc) continue;
      const data = typeof pc.data === "string" ? JSON.parse(pc.data) : pc.data;
      if (data.extensions?.rpgStats?.enabled) {
        partyRpgStats[data.name] = data.extensions.rpgStats;
      }
    }

    let personaRpgStats: SetupRpgContext["personaRpgStats"] = null;
    let personaName: string | null = null;
    if (chat.personaId || setupConfig.personaId) {
      const persona = await characters.getPersona(chat.personaId || setupConfig.personaId!);
      if (persona) {
        personaName = persona.name;
        try {
          const statsData = persona.personaStats ? JSON.parse(persona.personaStats) : null;
          if (statsData?.rpgStats?.enabled) {
            personaRpgStats = statsData.rpgStats;
          }
        } catch {
          /* skip */
        }
      }
    }

    return { partyRpgStats, personaRpgStats, personaName };
  };

  const applyGameSetupPayload = async (args: {
    chatId: string;
    meta: Record<string, unknown>;
    setupData: Record<string, unknown>;
    rpgContext: SetupRpgContext;
  }) => {
    const { chatId, meta, setupData, rpgContext } = args;
    const updates: Record<string, unknown> = { ...meta, gameSessionStatus: "ready" };
    if (setupData.worldOverview) updates.gameWorldOverview = setupData.worldOverview as string;
    if (setupData.storyArc) updates.gameStoryArc = setupData.storyArc as string;
    if (setupData.plotTwists) updates.gamePlotTwists = setupData.plotTwists as string[];

    // Persist LLM-generated art style into the setup config for consistent image generation.
    if (setupData.artStylePrompt && typeof setupData.artStylePrompt === "string") {
      const cfgCopy = {
        ...(updates.gameSetupConfig as Record<string, unknown>),
        artStylePrompt: setupData.artStylePrompt,
      };
      updates.gameSetupConfig = cfgCopy;
    }
    if (setupData.startingMap) {
      const raw = setupData.startingMap as Record<string, unknown>;
      const regions = (raw.regions as Array<Record<string, unknown>>) ?? [];
      if (regions.length > 0) {
        const nodes = regions.map((r, i) => {
          const angle = (2 * Math.PI * i) / regions.length - Math.PI / 2;
          const radius = 35;
          return {
            id: (r.id as string) || `region_${i + 1}`,
            emoji:
              r.type === "town"
                ? "🏘️"
                : r.type === "wilderness"
                  ? "🌲"
                  : r.type === "dungeon"
                    ? "🏰"
                    : r.type === "building"
                      ? "🏛️"
                      : r.type === "camp"
                        ? "⛺"
                        : "📍",
            label: (r.name as string) || `Region ${i + 1}`,
            x: Math.round(50 + radius * Math.cos(angle)),
            y: Math.round(50 + radius * Math.sin(angle)),
            discovered: (r.discovered as boolean) ?? i === 0,
            description: (r.description as string) || undefined,
          };
        });
        const edgeSet = new Set<string>();
        const edges: Array<{ from: string; to: string }> = [];
        for (const r of regions) {
          const id = (r.id as string) || "";
          const connected = (r.connectedTo as string[]) ?? [];
          for (const target of connected) {
            const key = [id, target].sort().join("→");
            if (!edgeSet.has(key)) {
              edgeSet.add(key);
              edges.push({ from: id, to: target });
            }
          }
        }
        const map: GameMap = {
          type: "node",
          name: (raw.name as string) || "Starting Area",
          description: (raw.description as string) || "",
          nodes,
          edges,
          partyPosition: nodes[0]?.id || "region_1",
        };
        updates.gameMap = map;
      } else {
        updates.gameMap = raw as unknown as GameMap;
      }
    }
    if (updates.gameMap) {
      Object.assign(updates, withActiveGameMapMeta(updates, updates.gameMap as GameMap));
    }
    if (setupData.startingNpcs) {
      const charStore = createCharactersStorage(app.db);
      const allChars = await charStore.list();
      const charAvatarByName = new Map<string, string>();
      for (const ch of allChars) {
        try {
          const parsed = JSON.parse(ch.data) as { name?: string };
          if (parsed.name && ch.avatarPath) {
            addNameLookupEntry(charAvatarByName, parsed.name, ch.avatarPath);
          }
        } catch {
          /* skip unparseable */
        }
      }

      const npcs = (setupData.startingNpcs as Array<Record<string, unknown>>).map((n, i) => {
        const name = (n.name as string) || `NPC ${i + 1}`;
        return {
          id: randomUUID(),
          name,
          emoji: (n.emoji as string) || "🧑",
          description: (n.description as string) || "",
          descriptionSource: n.description ? "model" : undefined,
          gender: typeof n.gender === "string" ? n.gender : null,
          pronouns: typeof n.pronouns === "string" ? n.pronouns : null,
          location: (n.location as string) || "Unknown",
          reputation: (n.reputation as number) || 0,
          met: false,
          notes: [] as string[],
          avatarUrl: charAvatarByName.get(name.toLowerCase()) ?? undefined,
        };
      });
      updates.gameNpcs = npcs;
    }

    if (setupData.partyArcs && Array.isArray(setupData.partyArcs)) {
      const arcs = (setupData.partyArcs as Array<Record<string, unknown>>)
        .map((a) => ({
          name: (a.name as string) || "",
          arc: (a.arc as string) || "",
          goal: (a.goal as string) || "",
        }))
        .filter((a) => a.name && a.arc);
      if (arcs.length > 0) updates.gamePartyArcs = arcs;
    }

    if (setupData.characterCards && Array.isArray(setupData.characterCards)) {
      const cards = (setupData.characterCards as Array<Record<string, unknown>>)
        .map((c) => {
          const name = (c.name as string) || "";
          const normalizedCard = normalizeGeneratedGameCharacterCard(c, name);
          const charStats = rpgContext.partyRpgStats[name] ?? null;
          const isPersona = rpgContext.personaName && name.toLowerCase() === rpgContext.personaName.toLowerCase();
          const rpg = isPersona ? rpgContext.personaRpgStats : charStats;
          return {
            ...normalizedCard,
            rpgStats: rpg
              ? {
                  attributes: rpg.attributes,
                  hp: { value: rpg.hp.max, max: rpg.hp.max },
                }
              : undefined,
          };
        })
        .filter((c) => c.name);
      if (cards.length > 0) updates.gameCharacterCards = cards;
    }

    if (setupData.blueprint) {
      // Coerce LLM output into the campaign-plan ranges rather than rejecting it.
      // The LLM occasionally exceeds the array caps or the pressure-clock step
      // count; without preprocessing, a single out-of-range value would fail
      // safeParse and silently drop the entire blueprint — including hudWidgets,
      // which is what the user actually configured.
      const sliceArray = (max: number) => (val: unknown) => (Array.isArray(val) ? val.slice(0, max) : val);
      const clampInt = (min: number, max: number) => (val: unknown) =>
        typeof val === "number" && Number.isFinite(val) ? Math.max(min, Math.min(max, Math.trunc(val))) : val;
      const campaignPlanSchema = z
        .object({
          openingSituation: z.string().max(240).optional().default(""),
          pressureClocks: z.preprocess(
            sliceArray(2),
            z
              .array(
                z.object({
                  name: z.string().max(80),
                  steps: z.preprocess(clampInt(1, 12), z.number().int().min(1).max(12).default(4)),
                  current: z.preprocess(clampInt(0, 12), z.number().int().min(0).max(12).default(0)),
                  failure: z.string().max(180).default(""),
                }),
              )
              .default([]),
          ),
          factions: z.preprocess(
            sliceArray(2),
            z
              .array(
                z.object({
                  name: z.string().max(80),
                  goal: z.string().max(160),
                  method: z.string().max(160).optional(),
                  secret: z.string().max(180).optional(),
                }),
              )
              .default([]),
          ),
          questSeeds: z.preprocess(sliceArray(3), z.array(z.string().max(180)).default([])),
          encounterPrinciples: z.preprocess(sliceArray(2), z.array(z.string().max(160)).default([])),
        })
        .optional()
        .nullable()
        .transform((plan) => plan ?? undefined);
      const blueprintSchema = z.object({
        campaignPlan: campaignPlanSchema,
        hudWidgets: z
          .array(
            z.object({
              id: z.string(),
              type: z.enum([
                "progress_bar",
                "gauge",
                "relationship_meter",
                "counter",
                "stat_block",
                "list",
                "inventory_grid",
                "timer",
              ]),
              label: z.string(),
              icon: z.string().optional(),
              position: z.enum(["hud_left", "hud_right"]),
              accent: z.string().optional(),
              config: z.record(z.unknown()),
            }),
          )
          .default([]),
        introSequence: z
          .array(
            z.object({
              effect: z.string(),
              duration: z.number().optional(),
              intensity: z.number().min(0).max(1).optional(),
              target: z.enum(["background", "content", "all"]).optional(),
              params: z.record(z.string()).optional(),
            }),
          )
          .default([]),
        visualTheme: z
          .object({
            palette: z.string(),
            uiStyle: z.string(),
            moodDefault: z.string(),
          })
          .optional(),
      });
      const normalizeStatBlocks = (widgets: Array<{ type: string; config: Record<string, unknown> }>) => {
        for (const w of widgets) {
          if (w.type === "stat_block" && w.config.stats) {
            const raw = w.config.stats;
            if (Array.isArray(raw)) {
              w.config.stats = raw.map((s: Record<string, unknown>) => ({
                name: String((s as Record<string, unknown>).name ?? (s as Record<string, unknown>).key ?? ""),
                value: (s as Record<string, unknown>).value ?? 0,
              }));
            } else if (typeof raw === "object" && raw !== null) {
              w.config.stats = Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({
                name: k,
                value: v ?? 0,
              }));
            }
          }
        }
      };
      const parsed = blueprintSchema.safeParse(setupData.blueprint);
      if (parsed.success) {
        normalizeStatBlocks(parsed.data.hudWidgets);
        updates.gameBlueprint = parsed.data;
      } else {
        // Last-ditch recovery: keep the user's HUD widgets even if campaignPlan
        // or other sections of the blueprint are malformed. Without this, a
        // single bad field anywhere drops the whole widget set and Start Game
        // proceeds with no HUD — a confusing failure mode for the user.
        logger.warn(
          { issues: parsed.error.issues },
          "[game/setup] blueprintSchema validation failed; attempting hudWidgets-only recovery",
        );
        const hudOnly = z.object({ hudWidgets: blueprintSchema.shape.hudWidgets }).safeParse({
          hudWidgets: (setupData.blueprint as { hudWidgets?: unknown })?.hudWidgets,
        });
        if (hudOnly.success && hudOnly.data.hudWidgets.length > 0) {
          normalizeStatBlocks(hudOnly.data.hudWidgets);
          updates.gameBlueprint = { hudWidgets: hudOnly.data.hudWidgets };
        }
      }
    }

    const hydratedUpdates = await buildHydratedGameMeta(chatId, updates);
    await createChatsStorage(app.db).updateMetadata(chatId, hydratedUpdates);

    return {
      setup: setupData,
      worldOverview: (setupData.worldOverview as string) || null,
    };
  };

  // ── POST /game/create ──
  app.post("/create", async (req) => {
    logger.info("[game/create] Received request");
    const { name, setupConfig, connectionId, characterConnectionId, promptPresetId, chatId } = createGameSchema.parse(
      req.body,
    );
    const chats = createChatsStorage(app.db);
    let defaultGenerationParameters: StoredGenerationParameters | null = null;
    if (connectionId && connectionId !== "random") {
      const connStorage = createConnectionsStorage(app.db);
      const conn = await connStorage.getById(connectionId);
      defaultGenerationParameters = parseStoredGenerationParameters(conn?.defaultParameters);
    }

    const gameId = randomUUID();

    // Reuse an existing chat if one was already created (e.g. from sidebar)
    let sessionChat: Awaited<ReturnType<typeof chats.getById>>;
    if (chatId) {
      sessionChat = await chats.getById(chatId);
      if (!sessionChat) throw new Error("Chat not found");
      // Update the chat to have game-mode fields
      // Use only the persona explicitly selected in the wizard (null = no persona)
      await chats.update(chatId, {
        name: name || sessionChat.name || "New Game",
        characterIds: setupConfig.partyCharacterIds,
        groupId: gameId,
        connectionId: connectionId || sessionChat.connectionId,
        personaId: setupConfig.personaId ?? null,
      });
      sessionChat = await chats.getById(chatId);
    } else {
      sessionChat = await chats.create({
        name: name || "New Game",
        mode: "game",
        characterIds: setupConfig.partyCharacterIds,
        groupId: gameId,
        personaId: setupConfig.personaId || null,
        promptPresetId: promptPresetId || null,
        connectionId: connectionId || null,
      });
    }
    if (!sessionChat) throw new Error("Failed to create game session chat");

    const sessionMeta = parseMeta(sessionChat.metadata);
    const setupActiveAgentIds = [...(setupConfig.enableSpotifyDj ? ["spotify"] : [])];
    const spotifySourceType = setupConfig.spotifySourceType ?? "liked";
    const gameChatParameters = mergeStoredGenerationParameters(
      defaultGenerationParameters,
      sessionMeta.chatParameters,
      setupConfig.generationParameters,
    );
    await chats.updateMetadata(sessionChat.id, {
      ...sessionMeta,
      gameId,
      forkLineageRootGameId: gameId,
      gameSessionNumber: 1,
      gameSessionStatus: "setup",
      gameCurrentSessionStartedAt: new Date().toISOString(),
      gameActiveState: "exploration",
      gameGmMode: setupConfig.gmMode,
      gameGmCharacterId: setupConfig.gmCharacterId || null,
      gamePartyCharacterIds: setupConfig.partyCharacterIds,
      gamePartyChatId: null,
      gameMap: null,
      gameMaps: [],
      activeGameMapId: null,
      gamePreviousSessionSummaries: [],
      gameStoryArc: null,
      gamePlotTwists: [],
      gameDialogueChatId: null,
      gameCombatChatId: null,
      gameSetupConfig: setupConfig,
      gameCharacterConnectionId: null,
      gameSceneConnectionId: setupConfig.sceneConnectionId || null,
      gameNpcs: [],
      enableAgents: true,
      // Game Mode requires Character Tracker / World State / Persona Stats
      // trackers for HUD injection and NPC materialization. We seed them
      // ONCE on first createGame, then leave the user free to remove any
      // tracker they don't want — `gameModeAutoSeeded` records that the
      // seeding already happened so subsequent code paths (follow-up
      // sessions, settings drawer migration button) don't re-add removed
      // trackers behind the user's back.
      activeAgentIds: Array.from(
        new Set([
          ...((sessionMeta.activeAgentIds as string[] | undefined) ?? []),
          ...setupActiveAgentIds,
          ...GAME_MODE_DEFAULT_AGENT_IDS,
        ]),
      ),
      gameModeAutoSeeded: true,
      enableSpriteGeneration: setupConfig.enableSpriteGeneration || false,
      gameCgFrequency: setupConfig.gameCgFrequency ?? "rare",
      gameImageConnectionId: setupConfig.imageConnectionId || null,
      activeLorebookIds: setupConfig.activeLorebookIds || [],
      enableCustomWidgets: setupConfig.enableCustomWidgets !== false,
      gameUseSpotifyMusic: setupConfig.enableSpotifyDj === true,
      gameSpotifySourceType: spotifySourceType,
      gameSpotifyPlaylistId:
        setupConfig.enableSpotifyDj === true && spotifySourceType === "playlist"
          ? setupConfig.spotifyPlaylistId || null
          : null,
      gameSpotifyPlaylistName:
        setupConfig.enableSpotifyDj === true && spotifySourceType === "playlist"
          ? setupConfig.spotifyPlaylistName || null
          : null,
      gameSpotifyArtist:
        setupConfig.enableSpotifyDj === true && spotifySourceType === "artist"
          ? setupConfig.spotifyArtist || null
          : null,
      gameLorebookKeeperEnabled: setupConfig.enableLorebookKeeper === true,
      ...(gameChatParameters ? { chatParameters: gameChatParameters } : {}),
    });

    const updatedSession = await chats.getById(sessionChat.id);

    return { sessionChat: updatedSession, gameId };
  });

  // ── POST /game/setup ──
  app.post("/setup", async (req, reply) => {
    logger.info("[game/setup] Received request");
    const { chatId, connectionId, preferences, streaming, debugMode } = setupSchema.parse(req.body);
    const requestDebug = debugMode === true;
    const debugLogsEnabled = requestDebug || logger.isLevelEnabled("debug");
    const debugLog = (message: string, ...args: any[]) => {
      logDebugOverride(requestDebug, message, ...args);
    };
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);
    const characters = createCharactersStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    if (!setupConfig) throw new Error("No setup config found");

    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      connectionId,
      chat.connectionId,
    );
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const setupGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);

    let gmCharacterCard: string | null = null;
    if (setupConfig.gmMode === "character" && setupConfig.gmCharacterId) {
      const gmChar = await characters.getById(setupConfig.gmCharacterId);
      if (gmChar) {
        const data = typeof gmChar.data === "string" ? JSON.parse(gmChar.data) : gmChar.data;
        const parts = [`Name: ${data.name}`];
        if (data.personality) parts.push(`Personality: ${data.personality}`);
        const description = getCharacterDescriptionWithExtensions(data);
        if (description) parts.push(`Description: ${description}`);
        const gmBackstory = data.extensions?.backstory || data.backstory;
        const gmAppearance = data.extensions?.appearance || data.appearance;
        if (gmBackstory) parts.push(`Backstory: ${gmBackstory}`);
        if (gmAppearance) parts.push(`Appearance: ${gmAppearance}`);
        gmCharacterCard = parts.join("\n");
      }
    }

    const setupPersonaId = chat.personaId || setupConfig.personaId || null;
    const setupPersona = setupPersonaId ? await characters.getPersona(setupPersonaId) : null;

    // Load persona info so the GM can tailor the experience
    let personaCard: string | null = null;
    const setupPersonaFields = {
      description: setupPersona?.description ?? "",
      personality: setupPersona?.personality ?? "",
      backstory: setupPersona?.backstory ?? "",
      appearance: setupPersona?.appearance ?? "",
      scenario: setupPersona?.scenario ?? "",
    };
    if (setupPersona) {
      const parts = [`Name: ${setupPersona.name}`];
      if (setupPersona.description) parts.push(`Description: ${setupPersona.description}`);
      if (setupPersona.personality) parts.push(`Personality: ${setupPersona.personality}`);
      if (setupPersona.backstory) parts.push(`Backstory: ${setupPersona.backstory}`);
      if (setupPersona.appearance) parts.push(`Appearance: ${setupPersona.appearance}`);
      personaCard = parts.join("\n");
    }

    // Load party character cards for context (full detail)
    const partyCards: string[] = [];
    const partyNames: string[] = [];
    const partyRpgStats: Record<
      string,
      { enabled: boolean; attributes: Array<{ name: string; value: number }>; hp: { value: number; max: number } }
    > = {};
    for (const pcId of setupConfig.partyCharacterIds) {
      const pc = await characters.getById(pcId);
      if (pc) {
        const data = typeof pc.data === "string" ? JSON.parse(pc.data) : pc.data;
        const parts = [data.name];
        if (typeof data.name === "string" && data.name.trim()) {
          partyNames.push(data.name.trim());
        }
        if (data.personality) parts.push(`Personality: ${data.personality}`);
        const description = getCharacterDescriptionWithExtensions(data);
        if (description) parts.push(`Description: ${description}`);
        const pcBackstory = data.extensions?.backstory || data.backstory;
        const pcAppearance = data.extensions?.appearance || data.appearance;
        if (pcBackstory) parts.push(`Backstory: ${pcBackstory}`);
        if (pcAppearance) parts.push(`Appearance: ${pcAppearance}`);
        partyCards.push(`- ${parts.join("\n  ")}`);
        // Collect RPG stats for character cards
        if (data.extensions?.rpgStats?.enabled) {
          partyRpgStats[data.name] = data.extensions.rpgStats;
        }
      }
    }

    // Also collect persona RPG stats
    let personaRpgStats: {
      enabled: boolean;
      attributes: Array<{ name: string; value: number }>;
      hp: { value: number; max: number };
    } | null = null;
    const personaName: string | null = setupPersona?.name ?? null;
    if (setupPersona) {
      try {
        const statsData = setupPersona.personaStats ? JSON.parse(setupPersona.personaStats) : null;
        if (statsData?.rpgStats?.enabled) {
          personaRpgStats = statsData.rpgStats;
        }
      } catch {
        /* skip */
      }
    }

    let setupLorebookContext: string | undefined;
    if ((setupConfig.activeLorebookIds?.length ?? 0) > 0) {
      const setupPromptMacroContext = await buildPromptMacroContext({
        db: app.db,
        characterIds: setupConfig.partyCharacterIds,
        personaName: personaName ?? "User",
        personaDescription: setupPersonaFields.description,
        personaFields: setupPersonaFields,
        variables: {},
        chatId,
      });
      const resolveSetupLorebookMacrosForFinal = (value: string) =>
        resolveMacrosWithVariableSnapshot(value, setupPromptMacroContext);
      const lorebookResult = await processLorebooks(app.db, [], null, {
        characterIds: setupConfig.partyCharacterIds,
        personaId: setupPersonaId,
        activeLorebookIds: setupConfig.activeLorebookIds,
        generationTriggers: ["game_setup", "game"],
        resolveContent: resolveSetupLorebookMacrosForFinal,
      });
      const combinedLore = [
        lorebookResult.worldInfoBefore,
        ...lorebookResult.depthEntries.map((entry) => entry.content),
        lorebookResult.worldInfoAfter,
      ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n");
      if (combinedLore) {
        setupLorebookContext = combinedLore;
        logger.info(
          "[game/setup] Injecting %d constant lorebook entries into world generation",
          lorebookResult.totalEntries,
        );
      }
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSetupPrompt({
          rating: setupConfig.rating ?? "sfw",
          personaCard: personaCard || null,
          playerName: personaName,
          partyCards: partyCards.length > 0 ? partyCards : undefined,
          partyNames,
          gmCharacterCard: gmCharacterCard || null,
          enableCustomWidgets: setupConfig.enableCustomWidgets,
          lorebookContext: setupLorebookContext,
          language: setupConfig.language,
        }),
      },
      {
        role: "user",
        content: [
          `Genre: ${setupConfig.genre}`,
          `Setting: ${setupConfig.setting}`,
          `Tone: ${setupConfig.tone}`,
          `Difficulty: ${setupConfig.difficulty}`,
          `Player goals: ${setupConfig.playerGoals}`,
          preferences?.trim() ? `Additional preferences: ${preferences}` : "",
          ``,
          `REMEMBER: Output ONLY the requested JSON object with the exact keys from the template. No discussion, no markdown, no extra text.`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];

    if (debugLogsEnabled) {
      debugLog("[game/setup] === PROMPT BEING SENT ===");
      for (const msg of messages) {
        debugLog("[game/setup] [%s] (%d chars):\n%s", msg.role, msg.content.length, msg.content);
      }
      debugLog("[game/setup] === END PROMPT ===");
    }

    const setupOptions = gameGenOptions(
      conn.model,
      {
        maxTokens: setupGenerationParameters?.maxTokens ?? 16384,
        stream: streaming,
        ...(streaming
          ? {
              onToken: (() => {
                const setupStartTime = Date.now();
                let sawFirstToken = false;
                return (chunk: string) => {
                  if (!chunk || sawFirstToken) return;
                  sawFirstToken = true;
                  debugLog("[game/setup] First streamed token received after %d ms", Date.now() - setupStartTime);
                };
              })(),
            }
          : {}),
      },
      setupGenerationParameters,
    );
    if (debugLogsEnabled) {
      debugLog(
        "[game/setup] Sending to provider=%s model=%s baseUrl=%s options=%s",
        conn.provider,
        conn.model,
        baseUrl,
        JSON.stringify(setupOptions),
      );
    }

    const result = await provider.chatComplete(messages, setupOptions);
    const setupExtraction = extractLeadingThinkingBlocks(result.content ?? "");
    const responseText = setupExtraction.content;

    if (debugLogsEnabled) {
      debugLog("[game/setup] Response length: %d chars", responseText.length);
      debugLog("[game/setup] Full response:\n%s", responseText);
      if (setupExtraction.thinking) {
        debugLog(
          "[game/setup] Thinking tokens (%d chars):\n%s",
          setupExtraction.thinking.length,
          setupExtraction.thinking,
        );
      }
    }

    let setupData: Record<string, unknown> = {};
    let parseError: string | null = null;
    try {
      setupData = parseJSON(responseText) as Record<string, unknown>;
      logger.info("[game/setup] Parsed JSON keys: %s", Object.keys(setupData));
    } catch (e) {
      logger.error(e, "[game/setup] JSON parse failed");
      parseError = "Model did not return valid JSON. The setup response could not be parsed.";
    }

    if (!parseError) {
      parseError = validateGameSetupPayload(setupData);
      if (parseError) {
        logger.warn("[game/setup] Validation failed: %s", parseError);
      }
    }

    if (parseError) {
      logger.error("[game/setup] Returning 422: %s", parseError);
      sendJsonRepairError(
        reply,
        parseError,
        buildJsonRepairPayload({
          kind: "game_setup",
          title: "Repair Game Setup JSON",
          rawJson: responseText,
          applyEndpoint: "/game/setup/apply-json",
          applyBody: { chatId },
        }),
      );
      return;
    }

    logger.info("[game/setup] Validation passed, transitioning to ready");
    const setupResult = await applyGameSetupPayload({
      chatId,
      meta,
      setupData,
      rpgContext: { partyRpgStats, personaRpgStats, personaName },
    });
    reply.send(setupResult);
  });

  // ── POST /game/setup/apply-json ──
  app.post("/setup/apply-json", async (req, reply) => {
    const { chatId, rawJson } = jsonRepairApplySchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    if (!setupConfig) throw new Error("No setup config found");

    let setupData: Record<string, unknown>;
    try {
      setupData = parseJSON(rawJson) as Record<string, unknown>;
    } catch (err) {
      logger.warn(err, "[game/setup/apply-json] Repaired setup JSON still failed to parse");
      sendJsonRepairError(
        reply,
        "The edited setup JSON is still invalid.",
        buildJsonRepairPayload({
          kind: "game_setup",
          title: "Repair Game Setup JSON",
          rawJson,
          applyEndpoint: "/game/setup/apply-json",
          applyBody: { chatId },
        }),
      );
      return;
    }

    const validationError = validateGameSetupPayload(setupData);
    if (validationError) {
      sendJsonRepairError(
        reply,
        validationError,
        buildJsonRepairPayload({
          kind: "game_setup",
          title: "Repair Game Setup JSON",
          rawJson,
          applyEndpoint: "/game/setup/apply-json",
          applyBody: { chatId },
        }),
        validationError,
      );
      return;
    }

    const setupResult = await applyGameSetupPayload({
      chatId,
      meta,
      setupData,
      rpgContext: await loadSetupRpgContext(chat, setupConfig),
    });
    reply.send(setupResult);
  });

  // ── POST /game/start ── (transitions game from "ready" to "active")
  // The client then requests an invisible startup generation guide through the
  // regular generate pipeline, which builds the full GM system prompt, streams
  // the response, and triggers scene analysis on the client side.
  app.post("/start", async (req) => {
    logger.info("[game/start] Transitioning to active");
    const { chatId } = gameStartSchema.parse(req.body);
    const chats = createChatsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    // Idempotent guard: a late second click that arrives after the first /start
    // has already flipped the status to "active" should not error out — let the
    // client skip its duplicate generation by returning alreadyStarted: true.
    if (meta.gameSessionStatus === "active") {
      return { status: "active", alreadyStarted: true };
    }
    if (meta.gameSessionStatus !== "ready") {
      throw new Error(`Cannot start game: status is "${meta.gameSessionStatus}", expected "ready"`);
    }

    // Stale-meta recovery (#321 / #821): an existing GM turn means the game has
    // already started, even though gameSessionStatus is back at "ready". This
    // happens when a concurrent metadata-write race transiently reverts the
    // status from "active" to "ready" mid-stream (see PR #320 for the original
    // audit and remaining call sites the team hasn't migrated to
    // chats.patchMetadata yet). Without this branch, a second Start Game click
    // during that race window would fire a duplicate /api/generate. Instead:
    // re-flip status back to "active" silently and tell the client we already
    // started so it skips generateInitialGameTurn.
    const existingMessages = await chats.listMessages(chatId);
    const hasGmTurn = existingMessages.some(
      (m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > 0,
    );
    if (hasGmTurn) {
      logger.warn(
        "[game/start] Stale-meta recovery for chatId=%s — GM turn already exists; restoring status to active without re-firing intro",
        chatId,
      );
      await chats.patchMetadata(chatId, { gameSessionStatus: "active" });
      return { status: "active", alreadyStarted: true };
    }

    // Atomic ready→active claim: route the transition through patchMetadata's
    // per-chat queue so two concurrent /start requests can't both observe
    // "ready" + no GM turn and both fire a generate. Only the first call wins
    // the claim; the rest fall through to the alreadyStarted: true branch
    // below.
    let claimedStart = false;
    await chats.patchMetadata(chatId, (current) => {
      if (current.gameSessionStatus !== "ready") return {};
      claimedStart = true;
      return { gameSessionStatus: "active" };
    });

    if (!claimedStart) {
      const latestChat = await chats.getById(chatId);
      const latestStatus = latestChat ? (parseMeta(latestChat.metadata).gameSessionStatus as string) : null;
      if (latestStatus === "active") {
        return { status: "active", alreadyStarted: true };
      }
      throw new Error(`Cannot start game: status is "${latestStatus}", expected "ready"`);
    }

    return { status: "active", alreadyStarted: false };
  });

  const pendingSessionStarts = new Map<
    string,
    Promise<{ sessionChat: StoredChatRecord; sessionNumber: number; recap: string }>
  >();

  // ── POST /game/session/start ──
  app.post("/session/start", async (req) => {
    const { gameId, connectionId } = startSessionSchema.parse(req.body);
    const existingStart = pendingSessionStarts.get(gameId);
    if (existingStart) {
      return existingStart;
    }

    const startSessionRequest = (async () => {
      const chats = createChatsStorage(app.db);
      const connections = createConnectionsStorage(app.db);

      const sessions = await chats.listByGroup(gameId);
      const gameSessions = sessions
        .filter((c) => (c.mode as string) === "game")
        .sort((a, b) => {
          const ma = parseMeta(a.metadata);
          const mb = parseMeta(b.metadata);
          return ((ma.gameSessionNumber as number) || 0) - ((mb.gameSessionNumber as number) || 0);
        });

      const latestSession = gameSessions[gameSessions.length - 1];
      if (!latestSession) throw new Error("No previous session found for this game");

      const prevMeta = parseMeta(latestSession.metadata);
      const baseSessionName = latestSession.name.replace(/ — Session \d+$/, "");
      const latestStatus = (prevMeta.gameSessionStatus as string) || "active";
      const prevSetupConfig = (prevMeta.gameSetupConfig as GameSetupConfig | null) ?? null;
      const latestSessionCharacterIds = parseChatCharacterIds(latestSession.characterIds);
      const carriedPartyIds = prevSetupConfig
        ? reconcileGamePartyCharacterIds(prevMeta, prevSetupConfig, latestSessionCharacterIds)
        : latestSessionCharacterIds;
      const carriedSetupConfig = prevSetupConfig ? syncSetupConfigPartyIds(prevSetupConfig, carriedPartyIds) : null;
      const carriedChatCharacterIds = carriedPartyIds.filter((id) => !isPartyNpcId(id));
      const summaries = normalizeStoredSessionSummaries(prevMeta.gamePreviousSessionSummaries);
      const currentSessionNumber = latestStatus === "concluded" ? Math.max(summaries.length, 1) : summaries.length + 1;
      const expectedLatestSessionName = `${baseSessionName} — Session ${currentSessionNumber}`;

      if (
        currentSessionNumber !== ((prevMeta.gameSessionNumber as number) || 0) ||
        summaries.length !== (((prevMeta.gamePreviousSessionSummaries as SessionSummary[]) || []).length ?? 0)
      ) {
        await chats.updateMetadata(latestSession.id, {
          ...prevMeta,
          gameSessionNumber: currentSessionNumber,
          gamePreviousSessionSummaries: summaries,
          ...(carriedSetupConfig ? { gameSetupConfig: carriedSetupConfig } : {}),
          gamePartyCharacterIds: carriedPartyIds,
        });
      } else if (carriedSetupConfig) {
        await chats.updateMetadata(latestSession.id, {
          ...prevMeta,
          gameSetupConfig: carriedSetupConfig,
          gamePartyCharacterIds: carriedPartyIds,
        });
      }

      if (latestSession.name !== expectedLatestSessionName) {
        await chats.update(latestSession.id, { name: expectedLatestSessionName });
      }

      if (
        JSON.stringify(parseChatCharacterIds(latestSession.characterIds)) !== JSON.stringify(carriedChatCharacterIds)
      ) {
        await chats.update(latestSession.id, { characterIds: carriedChatCharacterIds });
      }

      if (latestStatus === "ready" || latestStatus === "active") {
        const existingChat = await chats.getById(latestSession.id);
        if (!existingChat) throw new Error("Existing session not found");
        return { sessionChat: existingChat, sessionNumber: currentSessionNumber, recap: "" };
      }

      const sessionNumber = summaries.length + 1;
      const latestSessionMessages = await chats.listMessages(latestSession.id);
      let latestSessionEndingBeat: string | null = null;
      for (let i = latestSessionMessages.length - 1; i >= 0; i--) {
        const message = latestSessionMessages[i]!;
        if (typeof message.content !== "string" || !message.content.trim()) continue;
        if (message.role === "assistant") {
          latestSessionEndingBeat = message.content;
          break;
        }
        if (
          latestSessionEndingBeat == null &&
          message.role === "narrator" &&
          !/^\*\*Session \d+ Concluded\*\*/.test(message.content.trim())
        ) {
          latestSessionEndingBeat = message.content;
        }
      }

      const newChat = await chats.create({
        name: `${baseSessionName} — Session ${sessionNumber}`,
        mode: "game",
        characterIds: carriedChatCharacterIds,
        groupId: gameId,
        personaId: latestSession.personaId,
        promptPresetId: latestSession.promptPresetId,
        connectionId: connectionId || latestSession.connectionId,
      });
      if (!newChat) throw new Error("Failed to create new session chat");

      const stateStore = createGameStateStorage(app.db);
      const previousState = await stateStore.getLatest(latestSession.id);
      const previousPresentCharacters = parseJsonField<any[]>(previousState?.presentCharacters, []);
      const previousRecentEvents = parseJsonField<string[]>(previousState?.recentEvents, []);
      const previousPlayerStats = parseJsonField<Record<string, unknown> | null>(previousState?.playerStats, null);
      const previousPersonaStats = parseJsonField<any[] | null>(previousState?.personaStats, null);
      const carriedInventory = mergeGameInventoryItems(
        normalizeGameInventoryItems(prevMeta.gameInventory),
        inventoryFromPlayerStats(previousPlayerStats),
      );
      const {
        gameLastIllustrationTurn: _previousIllustrationTurn,
        gameLastIllustrationSessionNumber: _previousIllustrationSessionNumber,
        gameLastIllustrationTag: _previousIllustrationTag,
        ...carryMeta
      } = prevMeta;

      const newMeta = parseMeta(newChat.metadata);
      // `gameModeAutoSeeded` records that the trio of trackers
      // (character-tracker, world-state, persona-stats) has been seeded at
      // least once for this game. Two distinct cases:
      //
      //   1. Previous session has the flag → user has had the chance to
      //      curate `activeAgentIds`. Carry the list verbatim — if they
      //      removed `world-state` we MUST NOT silently re-add it.
      //   2. Previous session pre-dates the flag (legacy chat) → migrate
      //      once: merge defaults + set the flag, so future follow-ups
      //      respect the user's choices going forward.
      const prevAutoSeeded = prevMeta.gameModeAutoSeeded === true;
      const prevActiveAgentIds = (prevMeta.activeAgentIds as string[] | undefined) ?? [];
      const nextActiveAgentIds = prevAutoSeeded
        ? prevActiveAgentIds
        : Array.from(new Set([...prevActiveAgentIds, ...GAME_MODE_DEFAULT_AGENT_IDS]));

      const lineageRoot =
        (prevMeta.forkLineageRootGameId as string | undefined) || (prevMeta.gameId as string | undefined) || gameId;
      const updatedNewMeta = {
        ...newMeta,
        ...carryMeta,
        gameId,
        forkLineageRootGameId: lineageRoot,
        gameSessionNumber: sessionNumber,
        gameSessionStatus: "ready",
        gameCurrentSessionStartedAt: new Date().toISOString(),
        gameActiveState: "exploration",
        gamePartyChatId: null,
        gamePreviousSessionSummaries: summaries,
        gameDialogueChatId: null,
        gameCombatChatId: null,
        ...(carriedSetupConfig ? { gameSetupConfig: carriedSetupConfig } : {}),
        gamePartyCharacterIds: carriedPartyIds,
        enableAgents: true,
        activeAgentIds: nextActiveAgentIds,
        gameModeAutoSeeded: true,
        ...(carriedInventory.length > 0 ? { gameInventory: carriedInventory } : {}),
      };
      await chats.updateMetadata(newChat.id, updatedNewMeta);

      let recapMessageId = "";
      let recapText = "";
      let recapThinking = "";
      if (summaries.length > 0) {
        try {
          const { conn, baseUrl } = await resolveConnection(connections, connectionId, newChat.connectionId);
          const provider = createLLMProvider(
            conn.provider,
            baseUrl,
            conn.apiKey!,
            conn.maxContext,
            conn.openrouterProvider,
            conn.maxTokensOverride,
          );

          const recapMessages: ChatMessage[] = [
            { role: "system", content: buildRecapPrompt(summaries, latestSessionEndingBeat) },
            { role: "user", content: "Generate the session recap." },
          ];

          const result = await provider.chatComplete(
            recapMessages,
            gameGenOptions(conn.model, {
              temperature: 0.7,
            }),
          );
          const recapExtraction = extractLeadingThinkingBlocks(result.content ?? "");
          recapText = recapExtraction.content;
          recapThinking = recapExtraction.thinking;
          if (recapThinking) {
            logger.debug("[game/session/start] Recap thinking (%d chars):\n%s", recapThinking.length, recapThinking);
          }
        } catch {
          recapText = `Session ${sessionNumber} begins. The adventure continues...`;
          recapThinking = "";
        }

        if (recapText) {
          try {
            const recapMsg = await chats.createMessage({
              chatId: newChat.id,
              role: "narrator",
              characterId: null,
              content: recapText,
            });
            recapMessageId = recapMsg?.id ?? "";
            if (recapMsg?.id && recapThinking) {
              await chats.updateMessageExtra(recapMsg.id, { thinking: recapThinking });
            }
            mirrorGameMessageToDiscord(updatedNewMeta, recapText, "Narrator");
          } catch (err) {
            logger.warn(err, "[game/session/start] Failed to persist recap message");
          }
        }
      }

      let carriedStateSnapshotId = "";
      if (previousState) {
        try {
          carriedStateSnapshotId = await stateStore.create({
            chatId: newChat.id,
            messageId: recapMessageId,
            swipeIndex: 0,
            date: previousState.date,
            time: previousState.time,
            location: previousState.location,
            weather: previousState.weather,
            temperature: previousState.temperature,
            presentCharacters: previousPresentCharacters,
            recentEvents: previousRecentEvents,
            playerStats: previousPlayerStats as any,
            personaStats: previousPersonaStats as any,
            committed: true,
          });
        } catch (err) {
          logger.warn(err, "[game/session/start] Failed to carry forward previous game state");
        }
      }

      // Auto-checkpoint at session start
      try {
        if (carriedStateSnapshotId) {
          const cpSvc = createCheckpointService(app.db);
          await cpSvc.create({
            chatId: newChat.id,
            snapshotId: carriedStateSnapshotId,
            messageId: recapMessageId,
            label: `Session ${sessionNumber} Start`,
            triggerType: "session_start",
            location: previousState?.location,
            gameState: "exploration",
            weather: previousState?.weather,
            timeOfDay: previousState?.time,
          });
        }
      } catch {
        /* non-fatal */
      }

      const updatedChat = await chats.getById(newChat.id);
      if (!updatedChat) throw new Error("Failed to reload new session chat");

      return { sessionChat: updatedChat, sessionNumber, recap: recapText };
    })();

    pendingSessionStarts.set(gameId, startSessionRequest);

    try {
      return await startSessionRequest;
    } finally {
      if (pendingSessionStarts.get(gameId) === startSessionRequest) {
        pendingSessionStarts.delete(gameId);
      }
    }
  });

  // ── POST /game/session/conclude ──
  app.post("/session/conclude", async (req, reply) => {
    const { chatId, connectionId, streaming, nextSessionRequest } = concludeSessionSchema.parse(req.body);
    const trimmedNextSessionRequest = nextSessionRequest.trim();
    logger.info("[game/session/conclude] Starting manual conclude for chat %s", chatId);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    const chatCharacterIds = parseChatCharacterIds(chat.characterIds);
    const syncedPartyIds = setupConfig
      ? reconcileGamePartyCharacterIds(meta, setupConfig, chatCharacterIds)
      : chatCharacterIds;
    const syncedSetupConfig = setupConfig ? syncSetupConfigPartyIds(setupConfig, syncedPartyIds) : null;
    const prevSummaries = normalizeStoredSessionSummaries(meta.gamePreviousSessionSummaries);
    const sessionNumber = prevSummaries.length + 1;

    const messages = await chats.listMessages(chatId);
    const relevantMessages = applyGameSegmentEditsForPrompt(messages, meta).filter(
      (message) => message.role !== "system",
    );
    const transcriptText = formatGameTranscript(relevantMessages);
    const journalRecap = buildStructuredRecap((meta.gameJournal as Journal | null) ?? createJournal(), sessionNumber);

    const gameStates = createGameStateStorage(app.db);
    const latestState = await gameStates.getLatest(chatId);

    const currentStoryArc = (meta.gameStoryArc as string) || null;
    const currentPlotTwists = Array.isArray(meta.gamePlotTwists) ? (meta.gamePlotTwists as string[]) : [];
    const currentPartyArcs = Array.isArray(meta.gamePartyArcs) ? normalizePartyArcPayload(meta.gamePartyArcs) : [];
    const currentMorale = normalizeMoraleValue(meta.gameMorale, 50);
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];

    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      connectionId,
      chat.connectionId,
    );
    const conclusionGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );

    const conclusionOptions = gameGenOptions(
      conn.model,
      {
        maxTokens: Math.max(SESSION_CONCLUSION_MIN_OUTPUT_TOKENS, conclusionGenerationParameters?.maxTokens ?? 0),
        temperature: 0.45,
        stream: streaming,
        ...(streaming ? { onToken: () => {} } : {}),
      },
      conclusionGenerationParameters,
    );
    const { messages: conclusionMessages, transcriptTruncated } = fitSessionConclusionMessages({
      sessionNumber,
      language: setupConfig?.language ?? null,
      journalRecap,
      transcriptText,
      transcriptMessageCount: relevantMessages.length,
      latestState,
      currentStoryArc,
      currentPlotTwists,
      currentPartyArcs,
      currentMorale,
      currentCards,
      nextSessionRequest: trimmedNextSessionRequest || null,
      maxContext: conn.maxContext,
      maxTokens: conclusionOptions.maxTokens,
    });
    if (transcriptTruncated) {
      logger.info(
        "[game/session/conclude] Transcript exceeded context for chat %s; trimmed only the middle of the transcript to fit.",
        chatId,
      );
    }

    const result = await provider.chatComplete(conclusionMessages, conclusionOptions);
    logger.info("[game/session/conclude] Conclusion generation completed for chat %s", chatId);
    const conclusionExtraction = extractLeadingThinkingBlocks(result.content ?? "");
    if (conclusionExtraction.thinking) {
      logger.debug(
        "[game/session/conclude] Thinking tokens (%d chars):\n%s",
        conclusionExtraction.thinking.length,
        conclusionExtraction.thinking,
      );
    }

    let appliedConclusion: SessionConclusionApplication;
    try {
      const parsedConclusion = parseJSON(conclusionExtraction.content) as Record<string, unknown>;
      appliedConclusion = applySessionConclusionPayload(parsedConclusion, {
        sessionNumber,
        nextSessionRequest: trimmedNextSessionRequest || null,
        currentStoryArc,
        currentPlotTwists,
        currentPartyArcs,
        currentMorale,
        currentCards,
      });
      if (appliedConclusion.updatedCardCount > 0) {
        logger.info(
          `[session/conclude] Updated ${appliedConclusion.updatedCardCount} character cards after session ${sessionNumber}`,
        );
      }
    } catch (err) {
      logger.warn(err, "[session/conclude] Combined session conclusion parsing failed");
      sendJsonRepairError(
        reply,
        "The generated session conclusion was not valid JSON.",
        buildJsonRepairPayload({
          kind: "session_conclusion",
          title: `Repair Session ${sessionNumber} Summary JSON`,
          rawJson: conclusionExtraction.content,
          applyEndpoint: "/game/session/conclude/apply-json",
          applyBody: { chatId, connectionId: conn.id, nextSessionRequest: trimmedNextSessionRequest },
        }),
      );
      return;
    }

    await chats.updateMetadata(chatId, {
      ...meta,
      ...(syncedSetupConfig ? { gameSetupConfig: syncedSetupConfig } : {}),
      gamePartyCharacterIds: syncedPartyIds,
      gameSessionNumber: sessionNumber,
      gameSessionStatus: "concluded",
      gameStoryArc: appliedConclusion.updatedStoryArc,
      gamePlotTwists: appliedConclusion.updatedPlotTwists,
      gamePartyArcs: appliedConclusion.updatedPartyArcs,
      gamePreviousSessionSummaries: [...prevSummaries, appliedConclusion.summary],
      gameCharacterCards: appliedConclusion.updatedCards,
      ...buildMoraleMetadataUpdates(meta, appliedConclusion.updatedMorale),
    });

    const sessionSummaryMsg = await chats.createMessage({
      chatId,
      role: "narrator",
      characterId: null,
      content: `**Session ${sessionNumber} Concluded**\n\n${appliedConclusion.summary.summary}\n\n*Party Dynamics:* ${appliedConclusion.summary.partyDynamics}`,
    });
    if (sessionSummaryMsg?.id && conclusionExtraction.thinking) {
      await chats.updateMessageExtra(sessionSummaryMsg.id, { thinking: conclusionExtraction.thinking });
    }
    mirrorGameMessageToDiscord(
      meta,
      `**Session ${sessionNumber} Concluded**\n\n${appliedConclusion.summary.summary}\n\n*Party Dynamics:* ${appliedConclusion.summary.partyDynamics}`,
      "Narrator",
    );

    // Push an OOC influence to the connected conversation if linked
    if (chat.connectedChatId) {
      await chats.createInfluence(
        chatId,
        chat.connectedChatId as string,
        `Game session ${sessionNumber} just concluded. Summary: ${appliedConclusion.summary.summary}${
          appliedConclusion.summary.keyDiscoveries.length
            ? ` Key discoveries: ${appliedConclusion.summary.keyDiscoveries.join(", ")}`
            : ""
        }`,
      );
    }

    // Auto-checkpoint at session end
    try {
      if (latestState) {
        const cpSvc = createCheckpointService(app.db);
        await cpSvc.create({
          chatId,
          snapshotId: latestState.id,
          messageId: latestState.messageId,
          label: `Session ${sessionNumber} End`,
          triggerType: "session_end",
          location: latestState.location,
          gameState: (meta.gameActiveState as string) ?? "exploration",
          weather: latestState.weather,
          timeOfDay: latestState.time,
        });
      }
    } catch {
      /* non-fatal */
    }

    queueGameLorebookKeeperAfterConclusion({
      app,
      chatId,
      connectionId: conn.id,
      sessionNumber,
      sessionSummary: appliedConclusion.summary,
      streaming,
    });

    logger.info("[game/session/conclude] Session %d concluded for chat %s", sessionNumber, chatId);
    return { summary: appliedConclusion.summary };
  });

  // ── POST /game/session/conclude/apply-json ──
  app.post("/session/conclude/apply-json", async (req, reply) => {
    const { chatId, rawJson, connectionId, nextSessionRequest } = jsonRepairApplySchema.parse(req.body);
    const trimmedNextSessionRequest = nextSessionRequest.trim();
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    const chatCharacterIds = parseChatCharacterIds(chat.characterIds);
    const syncedPartyIds = setupConfig
      ? reconcileGamePartyCharacterIds(meta, setupConfig, chatCharacterIds)
      : chatCharacterIds;
    const syncedSetupConfig = setupConfig ? syncSetupConfigPartyIds(setupConfig, syncedPartyIds) : null;
    const prevSummaries = normalizeStoredSessionSummaries(meta.gamePreviousSessionSummaries);
    const sessionNumber = prevSummaries.length + 1;
    const currentStoryArc = (meta.gameStoryArc as string) || null;
    const currentPlotTwists = Array.isArray(meta.gamePlotTwists) ? (meta.gamePlotTwists as string[]) : [];
    const currentPartyArcs = Array.isArray(meta.gamePartyArcs) ? normalizePartyArcPayload(meta.gamePartyArcs) : [];
    const currentMorale = normalizeMoraleValue(meta.gameMorale, 50);
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];

    let appliedConclusion: SessionConclusionApplication;
    try {
      const parsedConclusion = parseJSON(rawJson) as Record<string, unknown>;
      appliedConclusion = applySessionConclusionPayload(parsedConclusion, {
        sessionNumber,
        nextSessionRequest: trimmedNextSessionRequest || null,
        currentStoryArc,
        currentPlotTwists,
        currentPartyArcs,
        currentMorale,
        currentCards,
      });
    } catch (err) {
      logger.warn(err, "[session/conclude/apply-json] Repaired session conclusion JSON still failed to parse");
      sendJsonRepairError(
        reply,
        "The edited session conclusion JSON is still invalid.",
        buildJsonRepairPayload({
          kind: "session_conclusion",
          title: `Repair Session ${sessionNumber} Summary JSON`,
          rawJson,
          applyEndpoint: "/game/session/conclude/apply-json",
          applyBody: { chatId, nextSessionRequest: trimmedNextSessionRequest },
        }),
      );
      return;
    }

    await chats.updateMetadata(chatId, {
      ...meta,
      ...(syncedSetupConfig ? { gameSetupConfig: syncedSetupConfig } : {}),
      gamePartyCharacterIds: syncedPartyIds,
      gameSessionNumber: sessionNumber,
      gameSessionStatus: "concluded",
      gameStoryArc: appliedConclusion.updatedStoryArc,
      gamePlotTwists: appliedConclusion.updatedPlotTwists,
      gamePartyArcs: appliedConclusion.updatedPartyArcs,
      gamePreviousSessionSummaries: [...prevSummaries, appliedConclusion.summary],
      gameCharacterCards: appliedConclusion.updatedCards,
      ...buildMoraleMetadataUpdates(meta, appliedConclusion.updatedMorale),
    });

    const summaryContent = `**Session ${sessionNumber} Concluded**\n\n${appliedConclusion.summary.summary}\n\n*Party Dynamics:* ${appliedConclusion.summary.partyDynamics}`;
    await chats.createMessage({
      chatId,
      role: "narrator",
      characterId: null,
      content: summaryContent,
    });
    mirrorGameMessageToDiscord(meta, summaryContent, "Narrator");

    if (chat.connectedChatId) {
      await chats.createInfluence(
        chatId,
        chat.connectedChatId as string,
        `Game session ${sessionNumber} just concluded. Summary: ${appliedConclusion.summary.summary}${
          appliedConclusion.summary.keyDiscoveries.length
            ? ` Key discoveries: ${appliedConclusion.summary.keyDiscoveries.join(", ")}`
            : ""
        }`,
      );
    }

    try {
      const latestState = await createGameStateStorage(app.db).getLatest(chatId);
      if (latestState) {
        const cpSvc = createCheckpointService(app.db);
        await cpSvc.create({
          chatId,
          snapshotId: latestState.id,
          messageId: latestState.messageId,
          label: `Session ${sessionNumber} End`,
          triggerType: "session_end",
          location: latestState.location,
          gameState: (meta.gameActiveState as string) ?? "exploration",
          weather: latestState.weather,
          timeOfDay: latestState.time,
        });
      }
    } catch {
      /* non-fatal */
    }

    queueGameLorebookKeeperAfterConclusion({
      app,
      chatId,
      connectionId,
      sessionNumber,
      sessionSummary: appliedConclusion.summary,
    });

    return { summary: appliedConclusion.summary };
  });

  // ── POST /game/session/regenerate-lorebook ──
  app.post("/session/regenerate-lorebook", async (req) => {
    const {
      chatId,
      connectionId,
      sessionNumber: requestedSessionNumber,
      streaming,
    } = regenerateSessionLorebookSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");
    if ((chat.mode as string) !== "game") throw new Error("Lorebook Keeper retry is only available in game mode");

    const meta = parseMeta(chat.metadata);
    if (meta.gameLorebookKeeperEnabled !== true) {
      throw new Error("Game Lorebook Keeper is not enabled for this game");
    }

    const summaries = normalizeStoredSessionSummaries(meta.gamePreviousSessionSummaries);
    const sessionNumber = requestedSessionNumber ?? summaries.length;
    const summary = summaries[sessionNumber - 1];
    if (!summary) throw new Error("Session summary not found");

    const result = await runGameLorebookKeeperAfterConclusion({
      app,
      chatId,
      connectionId,
      sessionNumber,
      sessionSummary: summary,
      replaceExistingSessionEntries: true,
      streaming,
    });

    if (result.status === "failed") {
      throw new Error(result.error || "Game Lorebook Keeper failed");
    }
    if (result.status === "skipped") {
      throw new Error(result.reason || "Game Lorebook Keeper did not run");
    }

    return {
      sessionNumber,
      lorebookId: result.lorebookId,
      entryCount: result.entryCount,
    };
  });

  // ── POST /game/session/regenerate-conclusion ──
  app.post("/session/regenerate-conclusion", async (req, reply) => {
    const { chatId, connectionId, sessionNumber, streaming } = regenerateSessionConclusionSchema.parse(req.body);
    logger.info("[game/session/regenerate-conclusion] Regenerating session %s for chat %s", sessionNumber, chatId);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    const prevSummaries = normalizeStoredSessionSummaries(meta.gamePreviousSessionSummaries);
    const targetIndex = sessionNumber - 1;
    if (targetIndex < 0 || targetIndex >= prevSummaries.length) {
      throw new Error("Session summary not found");
    }
    const existingNextSessionRequest = prevSummaries[targetIndex]?.nextSessionRequest?.trim() || null;

    const messages = await chats.listMessages(chatId);
    const conclusionHeader = `**Session ${sessionNumber} Concluded**`;
    const relevantMessages = applyGameSegmentEditsForPrompt(messages, meta).filter(
      (message) => message.role !== "system" && !isSessionConclusionMessage(message.content),
    );
    const transcriptText = formatGameTranscript(relevantMessages);
    const journalRecap = buildStructuredRecap((meta.gameJournal as Journal | null) ?? createJournal(), sessionNumber);

    const gameStates = createGameStateStorage(app.db);
    const latestState = await gameStates.getLatest(chatId);

    const currentStoryArc = (meta.gameStoryArc as string) || null;
    const currentPlotTwists = Array.isArray(meta.gamePlotTwists) ? (meta.gamePlotTwists as string[]) : [];
    const currentPartyArcs = Array.isArray(meta.gamePartyArcs) ? normalizePartyArcPayload(meta.gamePartyArcs) : [];
    const currentMorale = normalizeMoraleValue(meta.gameMorale, 50);
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];

    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      connectionId,
      chat.connectionId,
    );
    const conclusionGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const conclusionOptions = gameGenOptions(
      conn.model,
      {
        maxTokens: Math.max(SESSION_CONCLUSION_MIN_OUTPUT_TOKENS, conclusionGenerationParameters?.maxTokens ?? 0),
        temperature: 0.45,
        stream: streaming,
        ...(streaming ? { onToken: () => {} } : {}),
      },
      conclusionGenerationParameters,
    );
    const { messages: conclusionMessages, transcriptTruncated } = fitSessionConclusionMessages({
      sessionNumber,
      language: setupConfig?.language ?? null,
      journalRecap,
      transcriptText,
      transcriptMessageCount: relevantMessages.length,
      latestState,
      currentStoryArc,
      currentPlotTwists,
      currentPartyArcs,
      currentMorale,
      currentCards,
      nextSessionRequest: existingNextSessionRequest,
      maxContext: conn.maxContext,
      maxTokens: conclusionOptions.maxTokens,
    });
    if (transcriptTruncated) {
      logger.info(
        "[game/session/regenerate-conclusion] Transcript exceeded context for chat %s; trimmed only the middle of the transcript to fit.",
        chatId,
      );
    }

    const result = await provider.chatComplete(conclusionMessages, conclusionOptions);
    const conclusionExtraction = extractLeadingThinkingBlocks(result.content ?? "");
    let appliedConclusion: SessionConclusionApplication;
    try {
      const parsedConclusion = parseJSON(conclusionExtraction.content) as Record<string, unknown>;
      appliedConclusion = applySessionConclusionPayload(parsedConclusion, {
        sessionNumber,
        nextSessionRequest: existingNextSessionRequest,
        currentStoryArc,
        currentPlotTwists,
        currentPartyArcs,
        currentMorale,
        currentCards,
      });
      if (appliedConclusion.updatedCardCount > 0) {
        logger.info(
          "[session/regenerate-conclusion] Updated %d character cards for session %d",
          appliedConclusion.updatedCardCount,
          sessionNumber,
        );
      }
    } catch (err) {
      logger.warn(err, "[session/regenerate-conclusion] Session conclusion parsing failed");
      sendJsonRepairError(
        reply,
        "The regenerated conclusion was not valid JSON.",
        buildJsonRepairPayload({
          kind: "session_conclusion",
          title: `Repair Session ${sessionNumber} Summary JSON`,
          rawJson: conclusionExtraction.content,
          applyEndpoint: "/game/session/regenerate-conclusion/apply-json",
          applyBody: { chatId, sessionNumber },
        }),
      );
      return;
    }

    const nextSummaries = prevSummaries.map((existingSummary, index) =>
      index === targetIndex ? appliedConclusion.summary : existingSummary,
    );
    await chats.updateMetadata(chatId, {
      ...meta,
      gameStoryArc: appliedConclusion.updatedStoryArc,
      gamePlotTwists: appliedConclusion.updatedPlotTwists,
      gamePartyArcs: appliedConclusion.updatedPartyArcs,
      gamePreviousSessionSummaries: nextSummaries,
      gameCharacterCards: appliedConclusion.updatedCards,
      ...buildMoraleMetadataUpdates(meta, appliedConclusion.updatedMorale),
    });

    const nextContent = `**Session ${sessionNumber} Concluded**\n\n${appliedConclusion.summary.summary}\n\n*Party Dynamics:* ${appliedConclusion.summary.partyDynamics}`;
    const existingConclusionMessage = [...messages]
      .reverse()
      .find((message) => message.role === "narrator" && message.content.trim().startsWith(conclusionHeader));
    if (existingConclusionMessage) {
      await chats.updateMessageContent(existingConclusionMessage.id, nextContent);
      if (conclusionExtraction.thinking) {
        await chats.updateMessageExtra(existingConclusionMessage.id, { thinking: conclusionExtraction.thinking });
      }
    }

    return { summary: appliedConclusion.summary };
  });

  // ── POST /game/session/regenerate-conclusion/apply-json ──
  app.post("/session/regenerate-conclusion/apply-json", async (req, reply) => {
    const { chatId, rawJson, sessionNumber } = jsonRepairApplySchema.parse(req.body);
    if (!sessionNumber) throw new Error("Session number is required");
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const prevSummaries = normalizeStoredSessionSummaries(meta.gamePreviousSessionSummaries);
    const targetIndex = sessionNumber - 1;
    if (targetIndex < 0 || targetIndex >= prevSummaries.length) {
      throw new Error("Session summary not found");
    }
    const existingNextSessionRequest = prevSummaries[targetIndex]?.nextSessionRequest?.trim() || null;
    const currentStoryArc = (meta.gameStoryArc as string) || null;
    const currentPlotTwists = Array.isArray(meta.gamePlotTwists) ? (meta.gamePlotTwists as string[]) : [];
    const currentPartyArcs = Array.isArray(meta.gamePartyArcs) ? normalizePartyArcPayload(meta.gamePartyArcs) : [];
    const currentMorale = normalizeMoraleValue(meta.gameMorale, 50);
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];

    let appliedConclusion: SessionConclusionApplication;
    try {
      const parsedConclusion = parseJSON(rawJson) as Record<string, unknown>;
      appliedConclusion = applySessionConclusionPayload(parsedConclusion, {
        sessionNumber,
        nextSessionRequest: existingNextSessionRequest,
        currentStoryArc,
        currentPlotTwists,
        currentPartyArcs,
        currentMorale,
        currentCards,
      });
    } catch (err) {
      logger.warn(err, "[session/regenerate-conclusion/apply-json] Repaired session JSON still failed to parse");
      sendJsonRepairError(
        reply,
        "The edited session summary JSON is still invalid.",
        buildJsonRepairPayload({
          kind: "session_conclusion",
          title: `Repair Session ${sessionNumber} Summary JSON`,
          rawJson,
          applyEndpoint: "/game/session/regenerate-conclusion/apply-json",
          applyBody: { chatId, sessionNumber },
        }),
      );
      return;
    }

    const nextSummaries = prevSummaries.map((existingSummary, index) =>
      index === targetIndex ? appliedConclusion.summary : existingSummary,
    );
    await chats.updateMetadata(chatId, {
      ...meta,
      gameStoryArc: appliedConclusion.updatedStoryArc,
      gamePlotTwists: appliedConclusion.updatedPlotTwists,
      gamePartyArcs: appliedConclusion.updatedPartyArcs,
      gamePreviousSessionSummaries: nextSummaries,
      gameCharacterCards: appliedConclusion.updatedCards,
      ...buildMoraleMetadataUpdates(meta, appliedConclusion.updatedMorale),
    });

    const conclusionHeader = `**Session ${sessionNumber} Concluded**`;
    const nextContent = `**Session ${sessionNumber} Concluded**\n\n${appliedConclusion.summary.summary}\n\n*Party Dynamics:* ${appliedConclusion.summary.partyDynamics}`;
    const messages = await chats.listMessages(chatId);
    const existingConclusionMessage = [...messages]
      .reverse()
      .find((message) => message.role === "narrator" && message.content.trim().startsWith(conclusionHeader));
    if (existingConclusionMessage) {
      await chats.updateMessageContent(existingConclusionMessage.id, nextContent);
    }

    return { summary: appliedConclusion.summary };
  });

  // ── POST /game/session/update-campaign-progression ──
  app.post("/session/update-campaign-progression", async (req, reply) => {
    const { chatId, connectionId, sessionNumber, streaming } = updateCampaignProgressionSchema.parse(req.body);
    logger.info(
      "[game/session/update-campaign-progression] Updating campaign progression from session %s for chat %s",
      sessionNumber,
      chatId,
    );
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const currentChat = await chats.getById(chatId);
    if (!currentChat) throw new Error("Chat not found");
    if ((currentChat.mode as string) !== "game")
      throw new Error("Campaign progression can only be updated in game mode");

    const currentMeta = parseMeta(currentChat.metadata);
    const gameId = (currentMeta.gameId as string) || currentChat.groupId || currentChat.id;
    const sessions = await chats.listByGroup(gameId);
    const gameSessions = sessions
      .filter((session) => (session.mode as string) === "game")
      .sort((a, b) => {
        const aMeta = parseMeta(a.metadata);
        const bMeta = parseMeta(b.metadata);
        return ((aMeta.gameSessionNumber as number) || 0) - ((bMeta.gameSessionNumber as number) || 0);
      });
    const targetSession =
      gameSessions.find(
        (session) => ((parseMeta(session.metadata).gameSessionNumber as number) || 0) === sessionNumber,
      ) ?? (sessionNumber === ((currentMeta.gameSessionNumber as number) || 0) ? currentChat : null);
    if (!targetSession) throw new Error("Session not found");

    const targetMeta = parseMeta(targetSession.metadata);
    const setupConfig =
      (currentMeta.gameSetupConfig as GameSetupConfig | null) ?? (targetMeta.gameSetupConfig as GameSetupConfig | null);
    const targetMessages = await chats.listMessages(targetSession.id);
    const relevantMessages = applyGameSegmentEditsForPrompt(targetMessages, targetMeta).filter(
      (message) => message.role !== "system" && !isSessionConclusionMessage(message.content),
    );
    const transcriptText = formatGameTranscript(relevantMessages);
    if (!transcriptText.trim()) throw new Error("Selected session has no transcript to analyze");

    const gameStates = createGameStateStorage(app.db);
    const latestState = await gameStates.getLatest(targetSession.id);
    const journalRecap = buildStructuredRecap(
      (targetMeta.gameJournal as Journal | null) ?? createJournal(),
      sessionNumber,
    );
    const currentProgression: CampaignProgressionState = {
      storyArc: (currentMeta.gameStoryArc as string) || null,
      plotTwists: Array.isArray(currentMeta.gamePlotTwists) ? (currentMeta.gamePlotTwists as string[]) : [],
      partyArcs: Array.isArray(currentMeta.gamePartyArcs) ? normalizePartyArcPayload(currentMeta.gamePartyArcs) : [],
    };

    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      connectionId,
      currentChat.connectionId,
    );
    const progressionGenerationParameters = resolveStoredGameGenerationParameters(
      currentMeta,
      defaultGenerationParameters,
    );
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const progressionOptions = gameGenOptions(
      conn.model,
      {
        maxTokens: Math.max(CAMPAIGN_PROGRESSION_MIN_OUTPUT_TOKENS, progressionGenerationParameters?.maxTokens ?? 0),
        temperature: 0.35,
        stream: streaming,
        ...(streaming ? { onToken: () => {} } : {}),
      },
      progressionGenerationParameters,
    );
    const userLines = [
      `Session ${sessionNumber} journal recap:`,
      journalRecap,
      "",
      `Session ${sessionNumber} transcript (${relevantMessages.length} messages):`,
      transcriptText,
      "",
      "Current story arc:",
      currentProgression.storyArc ?? "",
      "",
      "Current plot twists:",
      JSON.stringify(currentProgression.plotTwists, null, 2),
      "",
      "Current party arcs:",
      JSON.stringify(currentProgression.partyArcs, null, 2),
    ];
    if (latestState) {
      userLines.push("", "Latest state from the selected session:", JSON.stringify(latestState, null, 2));
    }
    userLines.push(
      "",
      "Update only the campaign progression fields. Treat the completed session as seed material for FUTURE secret GM planning: evolve the story arc, add or sharpen future twists/hooks, and advance party arcs without merely restating the current state. Return full updated values.",
    );

    const progressionMessages: ChatMessage[] = [
      { role: "system", content: buildCampaignProgressionPrompt(setupConfig?.language ?? null) },
      { role: "user", content: userLines.join("\n") },
    ];
    const fit = fitMessagesToContext(progressionMessages, {
      maxContext: conn.maxContext,
      maxTokens: progressionOptions.maxTokens,
    });
    if (fit.trimmed) {
      logger.info(
        "[game/session/update-campaign-progression] Context trimmed while updating session %s for chat %s",
        sessionNumber,
        chatId,
      );
    }

    const result = await provider.chatComplete(fit.trimmed ? fit.messages : progressionMessages, progressionOptions);
    const rawProgressionContent = result.content ?? "";
    const extraction = extractLeadingThinkingBlocks(rawProgressionContent);
    logger.info(
      "[game/session/update-campaign-progression] Response length=%d chars, extracted=%d chars, maxTokens=%d",
      rawProgressionContent.length,
      extraction.content.length,
      progressionOptions.maxTokens ?? 0,
    );
    let updatedProgression: CampaignProgressionState;
    try {
      const parsedProgression = parseJSON(extraction.content) as Record<string, unknown>;
      updatedProgression = applyCampaignProgressionPayload(parsedProgression, currentProgression);
    } catch (err) {
      logger.warn(
        err,
        "[game/session/update-campaign-progression] Campaign progression parsing failed (chars=%d)",
        extraction.content.length,
      );
      if (logger.isLevelEnabled("debug")) {
        logger.debug(
          "[game/session/update-campaign-progression] Invalid JSON tail (debug): %s",
          extraction.content.slice(-200),
        );
      }
      sendJsonRepairError(
        reply,
        "The campaign progression update was not valid JSON.",
        buildJsonRepairPayload({
          kind: "campaign_progression",
          title: `Repair Session ${sessionNumber} Plot JSON`,
          rawJson: extraction.content,
          applyEndpoint: "/game/session/update-campaign-progression/apply-json",
          applyBody: { chatId, sessionNumber },
        }),
      );
      return;
    }

    await chats.updateMetadata(currentChat.id, {
      ...currentMeta,
      gameStoryArc: updatedProgression.storyArc,
      gamePlotTwists: updatedProgression.plotTwists,
      gamePartyArcs: updatedProgression.partyArcs,
    });

    if (targetSession.id !== currentChat.id) {
      await chats.updateMetadata(targetSession.id, {
        ...targetMeta,
        gameStoryArc: updatedProgression.storyArc,
        gamePlotTwists: updatedProgression.plotTwists,
        gamePartyArcs: updatedProgression.partyArcs,
      });
    }

    const sessionChat = await chats.getById(currentChat.id);
    if (!sessionChat) throw new Error("Failed to reload game session");

    return {
      sessionChat,
      gameId,
      campaignProgression: updatedProgression,
    };
  });

  // ── POST /game/session/update-campaign-progression/apply-json ──
  app.post("/session/update-campaign-progression/apply-json", async (req, reply) => {
    const { chatId, rawJson, sessionNumber } = jsonRepairApplySchema.parse(req.body);
    if (!sessionNumber) throw new Error("Session number is required");
    const chats = createChatsStorage(app.db);

    const currentChat = await chats.getById(chatId);
    if (!currentChat) throw new Error("Chat not found");
    if ((currentChat.mode as string) !== "game")
      throw new Error("Campaign progression can only be updated in game mode");

    const currentMeta = parseMeta(currentChat.metadata);
    const gameId = (currentMeta.gameId as string) || currentChat.groupId || currentChat.id;
    const sessions = await chats.listByGroup(gameId);
    const gameSessions = sessions
      .filter((session) => (session.mode as string) === "game")
      .sort((a, b) => {
        const aMeta = parseMeta(a.metadata);
        const bMeta = parseMeta(b.metadata);
        return ((aMeta.gameSessionNumber as number) || 0) - ((bMeta.gameSessionNumber as number) || 0);
      });
    const targetSession =
      gameSessions.find(
        (session) => ((parseMeta(session.metadata).gameSessionNumber as number) || 0) === sessionNumber,
      ) ?? (sessionNumber === ((currentMeta.gameSessionNumber as number) || 0) ? currentChat : null);
    if (!targetSession) throw new Error("Session not found");

    const targetMeta = parseMeta(targetSession.metadata);
    const currentProgression: CampaignProgressionState = {
      storyArc: (currentMeta.gameStoryArc as string) || null,
      plotTwists: Array.isArray(currentMeta.gamePlotTwists) ? (currentMeta.gamePlotTwists as string[]) : [],
      partyArcs: Array.isArray(currentMeta.gamePartyArcs) ? normalizePartyArcPayload(currentMeta.gamePartyArcs) : [],
    };

    let updatedProgression: CampaignProgressionState;
    try {
      const parsedProgression = parseJSON(rawJson) as Record<string, unknown>;
      updatedProgression = applyCampaignProgressionPayload(parsedProgression, currentProgression);
    } catch (err) {
      logger.warn(err, "[game/session/update-campaign-progression/apply-json] Repaired progression JSON failed");
      sendJsonRepairError(
        reply,
        "The edited campaign progression JSON is still invalid.",
        buildJsonRepairPayload({
          kind: "campaign_progression",
          title: `Repair Session ${sessionNumber} Plot JSON`,
          rawJson,
          applyEndpoint: "/game/session/update-campaign-progression/apply-json",
          applyBody: { chatId, sessionNumber },
        }),
      );
      return;
    }

    await chats.updateMetadata(currentChat.id, {
      ...currentMeta,
      gameStoryArc: updatedProgression.storyArc,
      gamePlotTwists: updatedProgression.plotTwists,
      gamePartyArcs: updatedProgression.partyArcs,
    });

    if (targetSession.id !== currentChat.id) {
      await chats.updateMetadata(targetSession.id, {
        ...targetMeta,
        gameStoryArc: updatedProgression.storyArc,
        gamePlotTwists: updatedProgression.plotTwists,
        gamePartyArcs: updatedProgression.partyArcs,
      });
    }

    const sessionChat = await chats.getById(currentChat.id);
    if (!sessionChat) throw new Error("Failed to reload game session");

    return {
      sessionChat,
      gameId,
      campaignProgression: updatedProgression,
    };
  });

  // ── POST /game/party/recruit ──
  // Adds a library character or tracked NPC to the active game party.
  app.post("/party/recruit", async (req) => {
    const input = recruitPartyMemberSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chars = createCharactersStorage(app.db);
    const connections = createConnectionsStorage(app.db);
    const stateStore = createGameStateStorage(app.db);

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");
    if ((chat.mode as string) !== "game") throw new Error("Party recruitment is only available in game mode");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    if (!setupConfig) throw new Error("No game setup config found");

    const requestedName = input.characterName.trim();
    const requestedLookup = normalizeCharacterLookupName(requestedName);
    const allCharacters = await chars.list();
    const parsedCharacters = allCharacters.flatMap((row) => {
      try {
        const data = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, any>;
        const name = typeof data.name === "string" ? data.name.trim() : "";
        if (!name) return [];
        return [{ row, data, name, lookup: normalizeCharacterLookupName(name) }];
      } catch {
        return [];
      }
    });

    let matches = parsedCharacters.filter((candidate) => candidate.name.toLowerCase() === requestedName.toLowerCase());
    if (matches.length === 0) {
      matches = parsedCharacters.filter((candidate) => candidate.lookup === requestedLookup);
    }
    if (matches.length === 0 && requestedLookup.length >= 3) {
      matches = parsedCharacters.filter(
        (candidate) =>
          candidate.lookup.includes(requestedLookup) ||
          (candidate.lookup.length >= 3 && requestedLookup.includes(candidate.lookup)),
      );
    }
    if (matches.length > 1) {
      throw new Error(`Character "${requestedName}" is ambiguous. Use the exact character name.`);
    }

    const gameNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
    const npcRecruit = matches.length === 0 ? findGameNpcByName(gameNpcs, requestedName) : null;
    if (matches.length === 0 && !npcRecruit) {
      throw new Error(`Character or tracked NPC "${requestedName}" was not found`);
    }

    const recruit = matches[0] ?? null;
    const characterById = new Map(parsedCharacters.map((candidate) => [candidate.row.id, candidate.name] as const));
    let chatCharacterIds: string[] = [];
    try {
      chatCharacterIds =
        typeof chat.characterIds === "string"
          ? ((JSON.parse(chat.characterIds) as string[]) ?? [])
          : ((chat.characterIds as string[]) ?? []);
    } catch {
      chatCharacterIds = [];
    }

    const currentPartyIds = getStoredPartyCharacterIds(meta, setupConfig, chatCharacterIds);
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
    const recruitId = recruit ? recruit.row.id : buildPartyNpcId(npcRecruit!.name);
    const recruitName = recruit ? recruit.name : npcRecruit!.name;
    const existingCardIndex = findExistingGameCharacterCardIndex(currentCards, recruitName);
    const alreadyInParty = currentPartyIds.includes(recruitId);
    if (alreadyInParty && existingCardIndex >= 0) {
      return {
        sessionChat: chat,
        added: false,
        characterName: recruitName,
        cardCreated: false,
      };
    }

    const fallbackCard = recruit
      ? buildFallbackGameCharacterCard(recruit.data, recruit.name)
      : buildNpcPartyCard(npcRecruit!);
    const recruitRpgStats = recruit ? extractRecruitCharacterRpgStats(recruit.data) : undefined;
    const recruitSourceCard = recruit
      ? buildRecruitCharacterSourceCard(recruit.data)
      : buildNpcRecruitCharacterSourceCard(npcRecruit!);
    let nextCard: Record<string, unknown> = {
      ...fallbackCard,
      ...(recruitRpgStats ? { rpgStats: recruitRpgStats } : {}),
    };

    if (existingCardIndex >= 0) {
      nextCard = currentCards[existingCardIndex]!;
    }

    if (existingCardIndex < 0) {
      try {
        const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
          connections,
          input.connectionId,
          chat.connectionId,
        );
        const provider = createLLMProvider(
          conn.provider,
          baseUrl,
          conn.apiKey!,
          conn.maxContext,
          conn.openrouterProvider,
        );
        const generationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);
        const latestState = await stateStore.getLatest(input.chatId);
        const recentMessages = applyGameSegmentEditsForPrompt(await chats.listMessages(input.chatId), meta);
        const recentTranscript = recentMessages
          .filter((message) => message.role !== "system")
          .slice(-12)
          .map((message) => {
            const cleaned = stripGmCommandTags(message.content ?? "");
            return cleaned ? `[${message.role}] ${cleaned}` : null;
          })
          .filter((entry): entry is string => Boolean(entry))
          .join("\n\n");
        const currentState = latestState
          ? JSON.stringify(
              {
                date: latestState.date,
                time: latestState.time,
                location: latestState.location,
                weather: latestState.weather,
                presentCharacters: latestState.presentCharacters
                  ? typeof latestState.presentCharacters === "string"
                    ? JSON.parse(latestState.presentCharacters)
                    : latestState.presentCharacters
                  : [],
              },
              null,
              2,
            )
          : null;
        const currentPartyNames = currentPartyIds
          .map((id) => {
            const characterName = characterById.get(id);
            if (characterName) return characterName;
            if (!isPartyNpcId(id)) return null;
            const npc = gameNpcs.find((candidate) => buildPartyNpcId(candidate.name) === id);
            if (npc?.name) return npc.name;
            const card = currentCards.find((candidate) => {
              const cardName = typeof candidate.name === "string" ? candidate.name.trim() : "";
              return cardName && buildPartyNpcId(cardName) === id;
            });
            return typeof card?.name === "string" ? card.name.trim() : null;
          })
          .filter((name): name is string => Boolean(name));
        const prompt = buildPartyRecruitCardPrompt({
          targetCharacterName: recruitName,
          targetCharacterCard: recruitSourceCard,
          currentPartyNames,
          currentPartyCards: currentCards.length > 0 ? JSON.stringify(currentCards, null, 2) : null,
          worldOverview: (meta.gameWorldOverview as string) || null,
          storyArc: (meta.gameStoryArc as string) || null,
          plotTwists: (meta.gamePlotTwists as string[]) || null,
          currentState,
          recentTranscript,
          language: setupConfig.language ?? null,
        });

        const result = await provider.chatComplete(
          [
            { role: "system", content: prompt },
            { role: "user", content: `Create the recruited companion card for ${recruitName} now.` },
          ],
          gameGenOptions(conn.model, { temperature: 0.6, maxTokens: 1200 }, generationParameters),
        );
        const recruitExtraction = extractLeadingThinkingBlocks(result.content ?? "");
        const cardContent = recruitExtraction.content;
        if (recruitExtraction.thinking) {
          logger.debug(
            "[game/party/recruit] Thinking tokens (%d chars):\n%s",
            recruitExtraction.thinking.length,
            recruitExtraction.thinking,
          );
        }
        const parsed = parseJSON(cardContent);
        const rawCard =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object"
              ? (parsed[0] as Record<string, unknown>)
              : null;
        if (rawCard) {
          nextCard = {
            ...normalizeGeneratedGameCharacterCard(rawCard, recruitName),
            ...(recruitRpgStats ? { rpgStats: recruitRpgStats } : {}),
          };
        }
      } catch (error) {
        logger.warn(error, "[game/party/recruit] Failed to generate recruit card, using fallback");
      }
    }

    const updatedPartyIds = alreadyInParty ? currentPartyIds : [...currentPartyIds, recruitId];
    const updatedCards = [...currentCards];
    if (existingCardIndex >= 0) {
      updatedCards[existingCardIndex] = nextCard;
    } else {
      updatedCards.push(nextCard);
    }

    const updatedSetupConfig: GameSetupConfig = {
      ...setupConfig,
      partyCharacterIds: updatedPartyIds,
    };

    const updatedChatCharacterIds = updatedPartyIds.filter((id) => !isPartyNpcId(id));
    await chats.update(chat.id, { characterIds: updatedChatCharacterIds });
    const updatedSession = await chats.updateMetadata(chat.id, {
      ...meta,
      gameSetupConfig: updatedSetupConfig,
      gamePartyCharacterIds: updatedPartyIds,
      gameCharacterCards: updatedCards,
    });
    if (!updatedSession) throw new Error("Failed to update game session");

    return {
      sessionChat: updatedSession,
      added: !alreadyInParty,
      characterName: recruitName,
      cardCreated: existingCardIndex < 0,
    };
  });

  // ── POST /game/party/remove ──
  // Removes a character from this game party only. Library characters are never deleted or mutated here.
  app.post("/party/remove", async (req) => {
    const input = removePartyMemberSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chars = createCharactersStorage(app.db);

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");
    if ((chat.mode as string) !== "game") throw new Error("Party removal is only available in game mode");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    if (!setupConfig) throw new Error("No game setup config found");

    let chatCharacterIds: string[] = [];
    try {
      chatCharacterIds =
        typeof chat.characterIds === "string"
          ? ((JSON.parse(chat.characterIds) as string[]) ?? [])
          : ((chat.characterIds as string[]) ?? []);
    } catch {
      chatCharacterIds = [];
    }

    const currentPartyIds = getStoredPartyCharacterIds(meta, setupConfig, chatCharacterIds);
    if (currentPartyIds.length === 0) {
      throw new Error("There are no party members to remove");
    }

    const allCharacters = await chars.list();
    const charactersById = new Map(
      allCharacters.flatMap((row) => {
        try {
          const data = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, any>;
          const name = typeof data.name === "string" ? data.name.trim() : "";
          return name ? [[row.id, { row, name, lookup: normalizeCharacterLookupName(name) }] as const] : [];
        } catch {
          return [];
        }
      }),
    );

    const requestedName = input.characterName.trim();
    const requestedLookup = normalizeCharacterLookupName(requestedName);
    const gameNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
    const currentParty = currentPartyIds.flatMap((id) => {
      const character = charactersById.get(id);
      return character ? [{ id, ...character }] : [];
    });
    for (const id of currentPartyIds) {
      if (!isPartyNpcId(id)) continue;
      const npc = gameNpcs.find((candidate) => buildPartyNpcId(candidate.name) === id);
      const card = currentCards.find((candidate) => {
        const cardName = typeof candidate.name === "string" ? candidate.name.trim() : "";
        return cardName && buildPartyNpcId(cardName) === id;
      });
      const name = npc?.name ?? (typeof card?.name === "string" ? card.name.trim() : "");
      if (!name) continue;
      currentParty.push({ id, row: null as never, name, lookup: normalizeCharacterLookupName(name) });
    }

    let matches = currentParty.filter((candidate) => candidate.name.toLowerCase() === requestedName.toLowerCase());
    if (matches.length === 0) {
      matches = currentParty.filter((candidate) => candidate.lookup === requestedLookup);
    }
    if (matches.length === 0 && requestedLookup.length >= 3) {
      matches = currentParty.filter(
        (candidate) =>
          candidate.lookup.includes(requestedLookup) ||
          (candidate.lookup.length >= 3 && requestedLookup.includes(candidate.lookup)),
      );
    }
    if (matches.length === 0) {
      throw new Error(`Character "${requestedName}" is not currently in the party`);
    }
    if (matches.length > 1) {
      throw new Error(`Character "${requestedName}" is ambiguous. Use the exact character name.`);
    }

    const removed = matches[0]!;
    const updatedPartyIds = currentPartyIds.filter((id) => id !== removed.id);
    const updatedSetupConfig: GameSetupConfig = {
      ...setupConfig,
      partyCharacterIds: updatedPartyIds,
    };
    const updatedChatCharacterIds = updatedPartyIds.filter((id) => !isPartyNpcId(id));
    await chats.update(chat.id, { characterIds: updatedChatCharacterIds });
    const updatedSession = await chats.updateMetadata(chat.id, {
      ...meta,
      gameSetupConfig: updatedSetupConfig,
      gamePartyCharacterIds: updatedPartyIds,
      gameCharacterCards: currentCards,
    });
    if (!updatedSession) throw new Error("Failed to update game session");

    return {
      sessionChat: updatedSession,
      removed: true,
      characterName: removed.name,
    };
  });

  // ── POST /game/dice/roll ──
  app.post("/dice/roll", async (req) => {
    const { notation } = diceRollSchema.parse(req.body);
    const result = rollDice(notation);
    return { result };
  });

  // ── POST /game/skill-check ──
  // Resolve a d20 skill check using player stats.
  const skillCheckSchema = z.object({
    chatId: z.string().min(1),
    skill: z.string().min(1).max(100),
    dc: z.number().int().min(1).max(40),
    advantage: z.boolean().optional(),
    disadvantage: z.boolean().optional(),
    preRolledD20: z.number().int().min(1).max(20).optional(),
    messageId: z.string().min(1).optional(),
  });

  app.post("/skill-check", async (req) => {
    const input = skillCheckSchema.parse(req.body);

    // When the client passes a messageId, run the full validator against the
    // stored message so the tag is canonicalised in the same place the
    // generate.routes hook would have placed it. Without messageId, just
    // resolve the roll using the player's real modifiers and return it.
    if (input.messageId) {
      const chats = createChatsStorage(app.db);
      const message = await chats.getMessage(input.messageId);
      if (message?.chatId === input.chatId && (message.role === "assistant" || message.role === "narrator")) {
        const { content: nextContent, lastResolved } = await validateOrResolveSkillCheckTags(
          message.content,
          input.chatId,
          app.db,
          {
            matchSkill: input.skill,
            matchDc: input.dc,
            firstMatchOnly: true,
            preRolledD20: input.preRolledD20,
            forceAdvantage: input.advantage,
            forceDisadvantage: input.disadvantage,
            messageId: input.messageId,
          },
        );
        let updatedContent: string | undefined;
        if (nextContent !== message.content) {
          await chats.updateMessageContent(input.messageId, nextContent);
          updatedContent = nextContent;
        }
        if (lastResolved) return { result: lastResolved, updatedContent };
      }
    }

    // Fallback: no messageId (or message not found) — resolve a fresh roll
    // for the client without touching any persisted narration.
    const lookup = await lookupPlayerModifiers(app.db, input.chatId, input.skill);
    const result = resolveSkillCheck({
      skill: input.skill,
      dc: input.dc,
      skillModifier: lookup.skillModifier,
      attributeModifier: lookup.attributeModifier,
      advantage: input.advantage,
      disadvantage: input.disadvantage,
      preRolledD20: input.preRolledD20,
    });
    return { result };
  });

  // ── POST /game/morale ──
  // Apply a morale event and return updated state.
  const moraleSchema = z.object({
    chatId: z.string().min(1),
    event: z.string().min(1).max(50),
  });

  app.post("/morale", async (req) => {
    const input = moraleSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const currentMorale = (meta.gameMorale as number) ?? 50;
    const result = applyMoraleEvent(currentMorale, input.event as MoraleEvent);

    await chats.updateMetadata(input.chatId, { ...meta, ...buildMoraleMetadataUpdates(meta, result.value) });

    return { morale: result };
  });

  // ── POST /game/state/transition ──
  app.post("/state/transition", async (req) => {
    const { chatId, newState } = stateTransitionSchema.parse(req.body);
    const chats = createChatsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const currentState = (meta.gameActiveState as GameActiveState) || "exploration";
    const validatedState = validateTransition(currentState, newState);

    await chats.updateMetadata(chatId, { ...meta, gameActiveState: validatedState });

    // Push OOC influence for combat transitions (exciting events)
    if (validatedState === "combat" && chat.connectedChatId) {
      await chats.createInfluence(
        chatId,
        chat.connectedChatId as string,
        `The game just entered combat! The party is now in a fight.`,
      );
    }

    // Auto-checkpoint on combat transitions
    const enteringCombat = validatedState === "combat";
    const leavingCombat = currentState === "combat" && validatedState !== "combat";
    if (enteringCombat || leavingCombat) {
      try {
        const stateStore = createGameStateStorage(app.db);
        const snap = await stateStore.getLatest(chatId);
        if (snap) {
          const cpSvc = createCheckpointService(app.db);
          await cpSvc.create({
            chatId,
            snapshotId: snap.id,
            messageId: snap.messageId,
            label: validatedState === "combat" ? "Combat Started" : "Combat Ended",
            triggerType: validatedState === "combat" ? "combat_start" : "combat_end",
            location: snap.location,
            gameState: validatedState,
            weather: snap.weather,
            timeOfDay: snap.time,
          });
        }
      } catch {
        /* non-fatal */
      }
    }

    return { previousState: currentState, newState: validatedState };
  });

  // ── POST /game/map/generate ──
  app.post("/map/generate", async (req) => {
    const { chatId, locationType, context, connectionId } = mapGenerateSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const { conn, baseUrl } = await resolveConnection(connections, connectionId, chat.connectionId);
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );

    const messages: ChatMessage[] = [
      { role: "system", content: buildMapGenerationPrompt(locationType, context) },
      { role: "user", content: "Generate the map." },
    ];

    const result = await provider.chatComplete(
      messages,
      gameGenOptions(conn.model, {
        temperature: 0.6,
      }),
    );
    const mapExtraction = extractLeadingThinkingBlocks(result.content ?? "");
    const mapContent = mapExtraction.content;
    if (mapExtraction.thinking) {
      logger.debug(
        "[game/map/generate] Thinking tokens (%d chars):\n%s",
        mapExtraction.thinking.length,
        mapExtraction.thinking,
      );
    }

    let map: GameMap;
    try {
      map = parseJSON(mapContent) as GameMap;
    } catch {
      throw new Error("Failed to parse map from AI response");
    }

    const meta = parseMeta(chat.metadata);
    const existingMaps = getGameMapsFromMeta(meta);
    const mapWithId = ensureGameMapId(map, existingMaps);
    const mapMeta = withActiveGameMapMeta({ ...meta, gameMaps: existingMaps }, mapWithId);
    const hydratedMeta = await buildHydratedGameMeta(chatId, mapMeta);
    await chats.updateMetadata(chatId, hydratedMeta);

    return {
      map: (hydratedMeta.gameMap as GameMap) ?? mapWithId,
      maps: getGameMapsFromMeta(hydratedMeta),
      activeGameMapId: (hydratedMeta.activeGameMapId as string | null) ?? getGameMapId(hydratedMeta.gameMap as GameMap),
    };
  });

  // ── POST /game/map/move ──
  app.post("/map/move", async (req) => {
    const { chatId, position, mapId } = mapMoveSchema.parse(req.body);
    const chats = createChatsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const maps = getGameMapsFromMeta(meta);
    const targetMapId = mapId ?? (meta.activeGameMapId as string | null) ?? getGameMapId(meta.gameMap as GameMap);
    const map =
      maps.find((entry, index) => getGameMapId(entry, index) === targetMapId) ?? (meta.gameMap as GameMap | null);
    if (!map) throw new Error("No map exists for this game");

    const updatedMap = { ...map, partyPosition: position };

    if (map.type === "grid" && typeof position === "object" && "x" in position) {
      const cells = [...(map.cells || [])];
      const cellIdx = cells.findIndex((c) => c.x === position.x && c.y === position.y);
      if (cellIdx !== -1) {
        cells[cellIdx] = { ...cells[cellIdx]!, discovered: true };
        updatedMap.cells = cells;
      }
    } else if (map.type === "node" && typeof position === "string") {
      const nodes = [...(map.nodes || [])];
      const nodeIdx = nodes.findIndex((n) => n.id === position);
      if (nodeIdx !== -1) {
        nodes[nodeIdx] = { ...nodes[nodeIdx]!, discovered: true };
        updatedMap.nodes = nodes;
      }
    }

    // Resolve the destination's label so hydration's location-derived reconciliation
    // (syncGameMapMetaPartyPosition + reconcileJournal) runs against the explicit move
    // instead of the stale snapshot location.
    const explicitLocation =
      typeof position === "string"
        ? (updatedMap.nodes?.find((node) => node.id === position)?.label ?? position)
        : (updatedMap.cells?.find((cell) => cell.x === position.x && cell.y === position.y)?.label ?? null);

    const nextMeta = markNpcsMetAtCurrentLocation(withActiveGameMapMeta(meta, updatedMap));
    const hydratedMeta = await buildHydratedGameMeta(chatId, nextMeta, { explicitLocation });
    // syncGameMapMetaPartyPosition matches by label across all maps, so a label collision
    // could leave hydratedMeta.gameMap pointing at a different map than the one the client
    // clicked within. Anchor finalMap to the hydrated copy of the target map (falling back
    // to updatedMap) and re-apply the exact chosen position so the response stays consistent
    // with the user's click.
    const hydratedMaps = getGameMapsFromMeta(hydratedMeta);
    const hydratedTargetMap =
      hydratedMaps.find((entry, index) => getGameMapId(entry, index) === targetMapId) ?? updatedMap;
    const finalMap: GameMap = { ...hydratedTargetMap, partyPosition: position };
    const finalMeta = withActiveGameMapMeta(hydratedMeta, finalMap);
    await chats.updateMetadata(chatId, finalMeta);

    return {
      map: (finalMeta.gameMap as GameMap) ?? finalMap,
      maps: getGameMapsFromMeta(finalMeta),
      activeGameMapId: (finalMeta.activeGameMapId as string | null) ?? getGameMapId(finalMeta.gameMap as GameMap),
    };
  });

  // ── GET /game/:gameId/sessions ──
  app.get<{ Params: { gameId: string } }>("/:gameId/sessions", async (req) => {
    const chats = createChatsStorage(app.db);
    const sessions = await chats.listByGroup(req.params.gameId);
    return sessions
      .filter((c) => (c.mode as string) === "game")
      .sort((a, b) => {
        const ma = parseMeta(a.metadata);
        const mb = parseMeta(b.metadata);
        return ((ma.gameSessionNumber as number) || 0) - ((mb.gameSessionNumber as number) || 0);
      });
  });

  // ── GET /game/:gameId/related-timelines ──
  // Lists all game-mode chats whose fork lineage root matches this id (same campaign branches).
  app.get<{ Params: { gameId: string } }>("/:gameId/related-timelines", async (req) => {
    const rootGameId = req.params.gameId;
    const chats = createChatsStorage(app.db);
    const rows = await chats.list();
    const timelines: Array<{
      chatId: string;
      name: string;
      gameId: string | undefined;
      forkLabel?: string;
      forkedFromMessageId?: string;
      updatedAt: string;
    }> = [];

    for (const c of rows) {
      if ((c.mode as string) !== "game") continue;
      const m = parseMeta(c.metadata);
      const lineage = (m.forkLineageRootGameId as string | undefined) || (m.gameId as string | undefined);
      const gid = m.gameId as string | undefined;
      if (lineage === rootGameId || gid === rootGameId) {
        timelines.push({
          chatId: c.id,
          name: c.name,
          gameId: gid,
          forkLabel: m.forkLabel as string | undefined,
          forkedFromMessageId: m.forkedFromMessageId as string | undefined,
          updatedAt: c.updatedAt as string,
        });
      }
    }

    timelines.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { timelines };
  });

  // ── POST /game/combat/round ──
  app.post("/combat/round", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      combatants: z.array(
        z.object({
          id: generatedRequiredStringSchema,
          name: generatedRequiredStringSchema,
          hp: z.number(),
          maxHp: z.number(),
          mp: z.number().optional(),
          maxMp: z.number().optional(),
          attack: z.number(),
          defense: z.number(),
          speed: z.number(),
          level: z.number(),
          side: z.enum(["player", "enemy"]).optional(),
          skills: z
            .array(
              z.object({
                id: generatedRequiredStringSchema,
                name: generatedRequiredStringSchema,
                type: z.enum(["attack", "heal", "buff", "debuff"]),
                mpCost: z.number(),
                power: z.number(),
                description: generatedOptionalStringSchema,
                cooldown: z.number().optional(),
                element: generatedOptionalStringSchema,
                statusEffect: generatedOptionalStringSchema,
              }),
            )
            .optional(),
          statusEffects: z
            .array(
              z.object({
                name: generatedRequiredStringSchema,
                modifier: z.number(),
                stat: z.enum(["attack", "defense", "speed", "hp"]),
                turnsLeft: z.number(),
              }),
            )
            .optional(),
          element: generatedOptionalStringSchema,
          elementAura: z
            .object({
              element: generatedRequiredStringSchema,
              gauge: z.number(),
              sourceId: generatedRequiredStringSchema,
            })
            .nullable()
            .optional(),
        }),
      ),
      round: z.number().int().min(1),
      playerAction: z
        .object({
          type: z.enum(["attack", "skill", "defend", "item", "flee"]),
          targetId: z.string().optional(),
          skillId: z.string().optional(),
          itemId: z.string().optional(),
          itemEffect: z
            .object({
              name: generatedRequiredStringSchema,
              target: z.enum(["self", "ally", "enemy", "any"]),
              type: z.enum(["heal", "damage", "buff", "debuff", "status", "utility"]),
              description: generatedRequiredStringSchema,
              power: z.number().optional(),
              element: generatedOptionalStringSchema,
              status: z
                .object({
                  name: generatedRequiredStringSchema,
                  emoji: generatedRequiredStringSchema,
                  duration: z.number(),
                  modifier: z.number().optional(),
                  stat: z.enum(["attack", "defense", "speed", "hp"]).optional(),
                })
                .optional(),
              consumes: z.boolean().optional(),
            })
            .optional(),
        })
        .optional(),
      mechanics: z
        .array(
          z.object({
            name: generatedRequiredStringSchema,
            description: generatedRequiredStringSchema,
            ownerName: generatedOptionalStringSchema,
            trigger: z.enum(["round_interval", "hp_threshold", "on_hit", "on_attack", "passive"]),
            interval: z.number().optional(),
            hpThreshold: z.number().optional(),
            counterplay: generatedOptionalStringSchema,
            effectType: z
              .enum(["damage_all", "damage_one", "buff_self", "debuff_party", "status_party", "status_enemy"])
              .optional(),
            power: z.number().optional(),
            element: generatedOptionalStringSchema,
            status: z
              .object({
                name: generatedRequiredStringSchema,
                emoji: generatedRequiredStringSchema,
                duration: z.number(),
                modifier: z.number().optional(),
                stat: z.enum(["attack", "defense", "speed", "hp"]).optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    });
    const { chatId, combatants, round, playerAction, mechanics } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const difficulty = ((meta.gameSetupConfig as Record<string, unknown>)?.difficulty as string) ?? "normal";
    const elementPreset = ((meta.gameSetupConfig as Record<string, unknown>)?.elementPreset as string) ?? "default";
    const result = resolveCombatRound(
      combatants as (CombatantStats & { side?: "player" | "enemy" })[],
      round,
      difficulty,
      elementPreset,
      playerAction,
      mechanics,
    );

    return { result, combatants };
  });

  // ── GET /game/elements/presets ──
  app.get("/elements/presets", async () => {
    const names = listElementPresets();
    const presets = names.map((name) => {
      const p = getElementPreset(name);
      return { id: name, name: p.name, elements: p.elements };
    });
    return { presets };
  });

  // ── GET /game/elements/preset/:name ──
  app.get("/elements/preset/:name", async (req) => {
    const { name } = req.params as { name: string };
    const preset = getElementPreset(name);
    return {
      id: name,
      name: preset.name,
      elements: preset.elements,
      reactionCount: preset.reactions.length,
      reactions: preset.reactions.map((r) => ({
        trigger: r.trigger,
        appliedWith: r.appliedWith,
        reaction: r.reaction,
        damageMultiplier: r.damageMultiplier,
        description: r.description,
      })),
    };
  });

  // ── POST /game/combat/loot ──
  app.post("/combat/loot", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      enemyCount: z.number().int().min(1).max(20),
    });
    const { chatId, enemyCount } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const difficulty = ((meta.gameSetupConfig as Record<string, unknown>)?.difficulty as string) ?? "normal";
    const drops = generateCombatLoot(enemyCount, difficulty);
    return { drops };
  });

  // ── POST /game/loot/generate ──
  app.post("/loot/generate", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      count: z.number().int().min(1).max(20).default(3),
    });
    const { chatId, count } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const difficulty = ((meta.gameSetupConfig as Record<string, unknown>)?.difficulty as string) ?? "normal";
    const drops = generateLootTable(count, difficulty);
    return { drops };
  });

  // ── POST /game/time/advance ──
  app.post("/time/advance", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      action: z.string().min(1).max(50),
    });
    const { chatId, action } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const currentTime = (meta.gameTime as GameTime) ?? createInitialTime();
    let newTime: GameTime;
    if (isTimeOfDayLabel(action)) {
      newTime = setTimeOfDay(currentTime, action);
    } else {
      newTime = advanceTime(currentTime, action);
    }

    await chats.updateMetadata(chatId, { ...meta, gameTime: newTime });

    // Also update the game state snapshot so WeatherEffects picks it up
    const gameStateStore = createGameStateStorage(app.db);
    await gameStateStore.updateLatest(chatId, {
      time: formatGameTime(newTime),
    });

    return { time: newTime, formatted: formatGameTime(newTime) };
  });

  // ── POST /game/weather/update ──
  app.post("/weather/update", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      action: z.string().min(1).max(50),
      location: z.string().max(500).default(""),
      season: z.enum(["spring", "summer", "autumn", "winter"]).default("summer"),
      type: z.string().max(100).optional(),
    });
    const { chatId, action, location, season, type } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);

    // "set" action from scene analyzer — apply the exact weather type
    if (action === "set" && type) {
      const biome = inferBiome(location);
      const weather = generateWeather(biome, season);
      // Override the randomly generated type with the scene analyzer's value
      weather.type = type as any;
      weather.description = `The weather is ${type}.`;

      await chats.updateMetadata(chatId, { ...meta, gameWeather: weather });
      const gameStateStore = createGameStateStorage(app.db);
      await gameStateStore.updateLatest(chatId, {
        weather: weather.type,
        temperature: `${weather.temperature}°C`,
      });
      return { changed: true, weather };
    }

    if (!shouldWeatherChange(action)) {
      return { changed: false, weather: meta.gameWeather ?? null };
    }

    const biome = inferBiome(location);
    const weather = generateWeather(biome, season);

    await chats.updateMetadata(chatId, { ...meta, gameWeather: weather });

    // Also update the game state snapshot so WeatherEffects picks it up
    const gameStateStore = createGameStateStorage(app.db);
    await gameStateStore.updateLatest(chatId, {
      weather: weather.type,
      temperature: `${weather.temperature}°C`,
    });

    return { changed: true, weather };
  });

  // ── POST /game/encounter/roll ──
  app.post("/encounter/roll", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      action: z.string().min(1).max(50),
      location: z.string().max(500).default(""),
    });
    const { chatId, action, location } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const difficulty = ((meta.gameSetupConfig as Record<string, unknown>)?.difficulty as string) ?? "normal";
    const encounter = rollEncounter(action, difficulty, location);

    let enemyCount = 0;
    if (encounter.triggered && encounter.type === "combat") {
      const partySize = ((meta.gamePartyCharacterIds as string[]) ?? []).length + 1; // +1 for player
      enemyCount = rollEnemyCount(partySize, difficulty);
    }

    return { encounter, enemyCount };
  });

  // ── POST /game/reputation/update ──
  app.post("/reputation/update", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      actions: z.array(
        z.object({
          npcId: z.string(),
          action: z.string().min(1).max(50),
          modifier: z.number().optional(),
        }),
      ),
    });
    const { chatId, actions } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const currentNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
    const { npcs: updatedNpcs, changes, milestones } = processReputationActions(currentNpcs, actions);

    const hydratedMeta = await buildHydratedGameMeta(chatId, { ...meta, gameNpcs: updatedNpcs });
    await chats.updateMetadata(chatId, hydratedMeta);

    return { npcs: (hydratedMeta.gameNpcs as GameNpc[]) ?? updatedNpcs, changes, milestones };
  });

  // ── POST /game/journal/entry ──
  app.post("/journal/entry", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      type: z.enum(["location", "npc", "combat", "quest", "item", "event", "note"]),
      data: z.record(z.unknown()),
    });
    const { chatId, type, data } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    let journal = (meta.gameJournal as Journal) ?? createJournal();

    switch (type) {
      case "location":
        journal = addLocationEntry(journal, data.location as string, data.description as string);
        break;
      case "npc":
        journal = addNpcEntry(journal, data.npc as GameNpc, data.interaction as string);
        break;
      case "combat":
        journal = addCombatEntry(journal, data.description as string, data.outcome as "victory" | "defeat" | "fled");
        break;
      case "quest":
        journal = upsertQuest(journal, data.quest as Parameters<typeof upsertQuest>[1]);
        break;
      case "item":
        journal = addInventoryEntry(
          journal,
          data.item as string,
          data.action as "acquired" | "used" | "lost" | "removed",
          data.quantity as number,
        );
        break;
      case "event":
        journal = addEventEntry(journal, data.title as string, data.content as string);
        break;
      case "note":
        journal = addNoteEntry(journal, data.title as string, data.content as string, {
          readableType: data.readableType === "book" || data.readableType === "note" ? data.readableType : undefined,
          sourceMessageId: typeof data.sourceMessageId === "string" ? data.sourceMessageId : undefined,
          sourceSegmentIndex: typeof data.sourceSegmentIndex === "number" ? data.sourceSegmentIndex : undefined,
        });
        break;
    }

    await chats.updateMetadata(chatId, { ...meta, gameJournal: journal });

    return { journal };
  });

  // ── GET /game/:chatId/journal ──
  app.get<{ Params: { chatId: string } }>("/:chatId/journal", async (req) => {
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(req.params.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const hydratedMeta = await buildHydratedGameMeta(req.params.chatId, meta);
    const originalJournal = (meta.gameJournal as Journal) ?? createJournal();
    const journal = (hydratedMeta.gameJournal as Journal) ?? createJournal();
    if (JSON.stringify(journal) !== JSON.stringify(originalJournal)) {
      await chats.updateMetadata(req.params.chatId, hydratedMeta);
    }
    const sessionNumber = (meta.gameSessionNumber as number) ?? 1;
    const playerNotes = (meta.gamePlayerNotes as string) ?? "";

    return { journal, recap: buildStructuredRecap(journal, sessionNumber), playerNotes };
  });

  // ── PUT /game/:chatId/notes ──
  app.put<{ Params: { chatId: string } }>("/:chatId/notes", async (req) => {
    const { notes } = z.object({ notes: z.string().max(10000) }).parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(req.params.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    await chats.updateMetadata(req.params.chatId, { ...meta, gamePlayerNotes: notes });

    return { ok: true };
  });

  // ── PUT /game/:chatId/widgets ──
  app.put<{ Params: { chatId: string } }>("/:chatId/widgets", async (req) => {
    const { widgets } = z.object({ widgets: z.array(z.record(z.unknown())) }).parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(req.params.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    await chats.updateMetadata(req.params.chatId, { ...meta, gameWidgetState: widgets });

    return { ok: true };
  });

  // ── POST /game/party-turn ──
  // Generates the party's response to the latest GM narration.
  // Uses the character connection (or falls back to GM connection).
  // Returns parsed PartyDialogueLine[] and the raw response text.
  const partyTurnSchema = z.object({
    chatId: z.string().min(1),
    /** The GM narration the party is reacting to. */
    narration: z.string().min(1).max(50000),
    /** Optional player action text that preceded the GM narration. */
    playerAction: z.string().max(5000).optional(),
    /** Override connection (falls back to character connection → GM connection). */
    connectionId: z.string().optional(),
    debugMode: z.boolean().optional().default(false),
  });

  app.post("/party-turn", async (req) => {
    const input = partyTurnSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);
    const chars = createCharactersStorage(app.db);

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    if (!setupConfig) throw new Error("No game setup config found");

    const gameActiveState = (meta.gameActiveState as string) || "exploration";
    let chatCharacterIds: string[] = [];
    try {
      chatCharacterIds =
        typeof chat.characterIds === "string"
          ? ((JSON.parse(chat.characterIds) as string[]) ?? [])
          : ((chat.characterIds as string[]) ?? []);
    } catch {
      chatCharacterIds = [];
    }
    const partyCharIds = getStoredPartyCharacterIds(meta, setupConfig, chatCharacterIds);

    // Resolve connection: explicit override → GM connection
    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      input.connectionId,
      chat.connectionId,
    );
    const gameGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);

    // Build party character cards
    const partyCards: Array<{ name: string; card: string }> = [];
    const partyIdNamePairs: Array<{ id: string; name: string }> = [];
    const gameNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
    const gameCharCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
    const gameCardByName = new Map<string, Record<string, unknown>>();
    for (const gc of gameCharCards) {
      if (typeof gc.name === "string" && gc.name.trim()) {
        gameCardByName.set(gc.name.toLowerCase(), gc);
      }
    }
    for (const charId of partyCharIds) {
      try {
        const charRow = await chars.getById(charId);
        if (!charRow) continue;
        const charData = typeof charRow.data === "string" ? JSON.parse(charRow.data) : charRow.data;
        const description = getCharacterDescriptionWithExtensions(charData);
        const card = [
          `Name: ${charData.name}`,
          charData.personality ? `Personality: ${charData.personality}` : null,
          description ? `Description: ${description}` : null,
          charData.extensions?.backstory || charData.backstory
            ? `Backstory: ${charData.extensions?.backstory || charData.backstory}`
            : null,
          charData.extensions?.appearance || charData.appearance
            ? `Appearance: ${charData.extensions?.appearance || charData.appearance}`
            : null,
        ];

        const gameCard = gameCardByName.get(String(charData.name || "").toLowerCase());
        if (gameCard) {
          if (typeof gameCard.class === "string" && gameCard.class.trim()) {
            card.push(`Class: ${gameCard.class}`);
          }
          if (Array.isArray(gameCard.abilities) && gameCard.abilities.length > 0) {
            card.push(`Abilities: ${gameCard.abilities.join(", ")}`);
          }
          if (Array.isArray(gameCard.strengths) && gameCard.strengths.length > 0) {
            card.push(`Strengths: ${gameCard.strengths.join(", ")}`);
          }
          if (Array.isArray(gameCard.weaknesses) && gameCard.weaknesses.length > 0) {
            card.push(`Weaknesses: ${gameCard.weaknesses.join(", ")}`);
          }
          const extra = gameCard.extra as Record<string, unknown> | undefined;
          if (extra) {
            for (const [key, value] of Object.entries(extra)) {
              if (value === null || value === undefined || value === "") continue;
              card.push(`${key}: ${String(value)}`);
            }
          }
        }

        const resolvedCard = card.filter(Boolean).join("\n");
        partyCards.push({ name: charData.name, card: resolvedCard });
        partyIdNamePairs.push({ id: charId, name: charData.name });
      } catch {
        /* skip unresolvable characters */
      }
    }

    for (const npcId of partyCharIds) {
      if (!isPartyNpcId(npcId)) continue;
      const npc = gameNpcs.find((candidate) => buildPartyNpcId(candidate.name) === npcId);
      if (!npc) continue;
      const card = [
        `Name: ${npc.name}`,
        "Source: Tracked NPC companion, not a character-library card",
        npc.description ? `Description: ${npc.description}` : null,
        npc.location ? `Last Known Location: ${npc.location}` : null,
        npc.notes?.length ? `Notes: ${npc.notes.join("; ")}` : null,
      ];

      const gameCard = gameCardByName.get(npc.name.toLowerCase());
      if (gameCard) {
        if (typeof gameCard.class === "string" && gameCard.class.trim()) {
          card.push(`Class: ${gameCard.class}`);
        }
        if (Array.isArray(gameCard.abilities) && gameCard.abilities.length > 0) {
          card.push(`Abilities: ${gameCard.abilities.join(", ")}`);
        }
        if (Array.isArray(gameCard.strengths) && gameCard.strengths.length > 0) {
          card.push(`Strengths: ${gameCard.strengths.join(", ")}`);
        }
        if (Array.isArray(gameCard.weaknesses) && gameCard.weaknesses.length > 0) {
          card.push(`Weaknesses: ${gameCard.weaknesses.join(", ")}`);
        }
        const extra = gameCard.extra as Record<string, unknown> | undefined;
        if (extra) {
          for (const [key, value] of Object.entries(extra)) {
            if (value === null || value === undefined || value === "") continue;
            card.push(`${key}: ${String(value)}`);
          }
        }
      }

      partyCards.push({ name: npc.name, card: card.filter(Boolean).join("\n") });
      partyIdNamePairs.push({ id: npcId, name: npc.name });
    }

    if (partyCards.length === 0) {
      return { raw: "" };
    }

    // Resolve player name
    let playerName = "Player";
    if (setupConfig.personaId) {
      try {
        const persona = await chars.getPersona(setupConfig.personaId);
        if (persona) {
          playerName = persona.name || "Player";
        }
      } catch {
        /* ignore */
      }
    }
    const partyPromptMacroContext = await buildPromptMacroContext({
      db: app.db,
      characterIds: partyCharIds.filter((id) => !isPartyNpcId(id)),
      personaName: playerName,
      variables: {},
      lastInput: input.playerAction || input.narration,
      chatId: input.chatId,
      model: conn.model,
    });
    const resolvePartyPromptMacros = (value: string) =>
      resolveMacros(value, {
        ...partyPromptMacroContext,
        char: partyCards[0]?.name ?? partyPromptMacroContext.char,
        characters: partyCards.map((card) => card.name),
      });

    let systemPrompt = buildPartySystemPrompt({
      partyCards,
      playerName,
      gameActiveState,
      partyArcs: (meta.gamePartyArcs as PartyArc[]) || undefined,
      characterSprites: listPartySprites(partyIdNamePairs),
    });

    const gameExtraPrompt = resolvePartyPromptMacros(
      ((meta.gameExtraPrompt as string) || "").replace(/<\/?special_instructions>/gi, ""),
    );
    if (gameExtraPrompt) {
      systemPrompt += `\n\n<special_instructions>\n${gameExtraPrompt}\n</special_instructions>`;
    }

    // Build user prompt with context
    const userPrompt = [
      `<gm_narration>`,
      input.narration,
      `</gm_narration>`,
      input.playerAction ? `\n<player_action>\n${input.playerAction}\n</player_action>` : "",
      `\nNow write the party's reactions using the [Name] [type] [expression]: format.`,
    ]
      .filter(Boolean)
      .join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const result = await provider.chatComplete(
      messages,
      gameGenOptions(
        conn.model ?? "",
        {
          maxTokens: 8192,
        },
        gameGenerationParameters,
      ),
    );
    const partyTurnExtraction = extractLeadingThinkingBlocks(result.content || "");
    const raw = partyTurnExtraction.content;
    const requestDebug = input.debugMode === true;
    const debugOverrideEnabled = requestDebug || isDebugAgentsEnabled();
    const debugLogsEnabled = debugOverrideEnabled || logger.isLevelEnabled("debug");
    const debugLog = (message: string, ...args: any[]) => {
      logDebugOverride(debugOverrideEnabled, message, ...args);
    };
    if (partyTurnExtraction.thinking) {
      debugLog(
        "[game/party-turn] Thinking tokens (%d chars):\n%s",
        partyTurnExtraction.thinking.length,
        partyTurnExtraction.thinking,
      );
    }
    if (debugLogsEnabled) {
      debugLog("[party-turn/raw] chatId=%s model=%s chars=%d\n%s", input.chatId, conn.model ?? "", raw.length, raw);
    }

    // Extract and apply reputation tags from party response
    const repRegex = /\[reputation:\s*npc="([^"]+)"\s*action="([^"]+)"\]/gi;
    let repMatch: RegExpExecArray | null;
    const repActions: Array<{ npcId: string; action: string }> = [];
    while ((repMatch = repRegex.exec(raw)) !== null) {
      repActions.push({ npcId: repMatch[1]!.trim(), action: repMatch[2]!.trim() });
    }
    if (repActions.length > 0) {
      try {
        await chats.updateMetadataWithMerge(input.chatId, (freshMeta) => {
          const currentNpcs = (freshMeta.gameNpcs as GameNpc[] | undefined) ?? [];
          const { npcs: updatedNpcs } = processReputationActions(currentNpcs, repActions);
          return { ...freshMeta, gameNpcs: updatedNpcs };
        });
        logger.info(`[party-turn] Applied ${repActions.length} reputation change(s)`);
      } catch (err) {
        logger.warn(err, "[party-turn] Failed to apply reputation");
      }
    }

    // Strip reputation tags from the displayed content
    const cleanRaw = raw.replace(/\[reputation:\s*npc="[^"]+"\s*action="[^"]+"\]/gi, "").trim();

    // Save party response as a message in the game chat
    const partyMsg = await chats.createMessage({
      chatId: input.chatId,
      role: "assistant",
      characterId: null,
      content: `[party-turn]\n${cleanRaw}`,
    });
    if (partyMsg?.id && partyTurnExtraction.thinking) {
      await chats.updateMessageExtra(partyMsg.id, { thinking: partyTurnExtraction.thinking });
    }
    mirrorGameMessageToDiscord(meta, cleanRaw, "Party");

    return { raw: cleanRaw };
  });

  const spotifySceneTrackCandidateSchema = z.object({
    uri: z.string().min(1).max(300),
    name: z.string().min(1).max(300),
    artist: z.string().min(1).max(300),
    album: z.string().max(300).nullable().optional(),
    position: z.number().nullable().optional(),
    score: z.number().nullable().optional(),
  });

  const spotifySceneTrackSelectionSchema = z.object({
    uri: z.string().min(1).max(300),
    name: z.string().max(300).nullable().optional(),
    artist: z.string().max(300).nullable().optional(),
    album: z.string().max(300).nullable().optional(),
    reason: z.string().max(500).nullable().optional(),
  });

  // ── POST /game/spotify/candidates ──
  // Builds a mechanical shortlist from the configured Spotify source. Scene analysis
  // then chooses one track from this bounded list, so the model never sees a giant playlist.
  const spotifyCandidatesSchema = z.object({
    chatId: z.string().min(1),
    narration: z.string().max(50000).optional().default(""),
    playerAction: z.string().max(5000).optional(),
    context: z.record(z.unknown()).optional().default({}),
    limit: z.number().min(1).max(50).optional().default(50),
  });

  function normalizeSpotifyTrackHistory(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((uri): uri is string => typeof uri === "string" && uri.startsWith("spotify:track:")).slice(0, 20)
      : [];
  }

  app.post("/spotify/candidates", async (req, reply) => {
    const input = spotifyCandidatesSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const agents = createAgentsStorage(app.db);
    const chat = await chats.getById(input.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const meta = parseMeta(chat.metadata);
    const query = buildGameSpotifySceneQuery({
      narration: input.narration,
      playerAction: input.playerAction,
      context: input.context,
    });
    const currentSpotifyTrack =
      typeof input.context.currentSpotifyTrack === "string" &&
      input.context.currentSpotifyTrack.startsWith("spotify:track:")
        ? input.context.currentSpotifyTrack
        : null;
    const recentTrackUris = Array.from(
      new Set([
        ...(currentSpotifyTrack ? [currentSpotifyTrack] : []),
        ...normalizeSpotifyTrackHistory(input.context.recentSpotifyTracks),
      ]),
    );

    try {
      return await getGameSpotifyCandidates({
        storage: agents,
        chatMeta: meta,
        query,
        limit: input.limit,
        recentTrackUris,
      });
    } catch (err) {
      logger.warn(err, "[spotify/game] Failed to build scene music candidates");
      return reply.status(getGameSpotifyErrorStatus(err)).send({
        error: err instanceof Error ? err.message : "Spotify candidate selection failed",
      });
    }
  });

  // ── POST /game/spotify/play ──
  // Plays the track picked by scene analysis in the global Spotify widget.
  const spotifyPlaySchema = z.object({
    chatId: z.string().min(1),
    track: spotifySceneTrackSelectionSchema,
    deviceId: z.string().min(1).nullable().optional(),
    mobileDeviceOnly: z.boolean().optional(),
  });

  app.post("/spotify/play", async (req, reply) => {
    const input = spotifyPlaySchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const agents = createAgentsStorage(app.db);
    const chat = await chats.getById(input.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    try {
      return await playGameSpotifyTrack({
        storage: agents,
        chatMeta: parseMeta(chat.metadata),
        track: input.track,
        deviceId: input.deviceId ?? null,
        mobileDeviceOnly: input.mobileDeviceOnly === true,
      });
    } catch (err) {
      logger.warn(err, "[spotify/game] Failed to play scene music");
      return reply.status(getGameSpotifyErrorStatus(err)).send({
        error: err instanceof Error ? err.message : "Spotify playback failed",
      });
    }
  });

  // ── POST /game/scene-wrap ──
  // Scene wrap-up using a regular LLM connection (fallback when sidecar isn't available).
  // Uses the same prompt as the sidecar scene analyzer but via API.
  const sceneWrapSchema = z.object({
    chatId: z.string().min(1),
    narration: z.string().min(1).max(50000),
    playerAction: z.string().max(5000).optional(),
    streaming: z.boolean().optional().default(true),
    context: z.object({
      currentState: z.string(),
      availableBackgrounds: z.array(z.string()).max(2000),
      availableSfx: z.array(z.string()).max(2000),
      activeWidgets: z.array(z.unknown()).max(100),
      trackedNpcs: z.array(z.unknown()).max(200),
      characterNames: z.array(z.string().max(200)).max(100),
      currentBackground: z.string().nullable(),
      currentMusic: z.string().nullable(),
      recentMusic: z.array(z.string().max(500)).max(20).optional().default([]),
      useSpotifyMusic: z.boolean().optional().default(false),
      availableSpotifyTracks: z.array(spotifySceneTrackCandidateSchema).max(50).optional().default([]),
      currentSpotifyTrack: z.string().max(300).nullable().optional().default(null),
      recentSpotifyTracks: z.array(z.string().max(300)).max(20).optional().default([]),
      currentAmbient: z.string().nullable().optional().default(null),
      currentWeather: z.string().nullable(),
      currentTimeOfDay: z.string().nullable(),
      canGenerateBackgrounds: z.boolean().optional(),
      canGenerateIllustrations: z.boolean().optional(),
      cgFrequency: z.enum(["off", "rare", "balanced", "frequent", "cinematic"]).optional(),
      artStylePrompt: z.string().nullable().optional(),
      imagePromptInstructions: z.string().max(1200).nullable().optional(),
    }),
    /** Override connection (falls back to scene connection → GM connection). */
    connectionId: z.string().optional(),
    debugMode: z.boolean().optional().default(false),
  });

  app.post("/scene-wrap", async (req) => {
    const input = sceneWrapSchema.parse(req.body);
    const requestDebug = input.debugMode === true;
    const debugOverrideEnabled = requestDebug || isDebugAgentsEnabled();
    const debugLogsEnabled = debugOverrideEnabled || logger.isLevelEnabled("debug");
    const debugLog = (message: string, ...args: any[]) => {
      logDebugOverride(debugOverrideEnabled, message, ...args);
    };
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const sceneConnId = (meta.gameSceneConnectionId as string) || null;
    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      input.connectionId ?? sceneConnId,
      chat.connectionId,
    );
    if (!conn.apiKey && conn.provider !== "claude_subscription" && conn.provider !== "openai_chatgpt") {
      throw Object.assign(
        new Error(
          `Scene Analyzer connection "${conn.name}" has no API key. Edit it in Settings → Connections, or pick a different connection in Chat Settings → Game.`,
        ),
        { statusCode: 400 },
      );
    }
    const gameGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);
    const enableGen = !!meta.enableSpriteGeneration;
    const imgConnId = (meta.gameImageConnectionId as string) || null;
    const setupCfgForScene = meta.gameSetupConfig as Record<string, unknown> | null;
    const artStyleForScene = (setupCfgForScene?.artStylePrompt as string) || "";
    const imagePromptInstructions =
      typeof meta.gameImagePromptInstructions === "string"
        ? meta.gameImagePromptInstructions.trim().slice(0, 1200)
        : "";

    // Compute approximate turn number: count user messages + 1 (current turn)
    const allMsgs = await chats.listMessages(input.chatId);
    const approxTurnNumber = Math.max(1, allMsgs.filter((m) => m.role === "user").length + 1);
    // Strip cross-chat per-chat backgrounds from the LLM-visible list so the
    // model never picks `backgrounds:chat:<otherChatId>:*` from a different
    // session. Per-chat tags from THIS chat stay in.
    const myChatPrefix = `backgrounds:chat:${input.chatId}:`;
    const filteredBackgrounds = input.context.availableBackgrounds.filter(
      (t) => !t.startsWith("backgrounds:chat:") || t.startsWith(myChatPrefix),
    );
    if (filteredBackgrounds.length !== input.context.availableBackgrounds.length) {
      logger.debug(
        "[game/scene-wrap][bg] filtered %d cross-chat tags from availableBackgrounds (kept %d)",
        input.context.availableBackgrounds.length - filteredBackgrounds.length,
        filteredBackgrounds.length,
      );
    }
    // Anchor the active scene plate so the analyzer's "keep the same bg" path
    // round-trips cleanly. Without this, a stale or sampled availableBackgrounds
    // list lets scene-postprocess.bestMatch() promote a sibling room (e.g.
    // pool-terrace → vip-corridor) as a "close match" instead of preserving the
    // current location.
    const currentBgTag = input.context.currentBackground;
    if (
      currentBgTag &&
      !currentBgTag.startsWith("backgrounds:illustrations:") &&
      (!currentBgTag.startsWith("backgrounds:chat:") || currentBgTag.startsWith(myChatPrefix)) &&
      !filteredBackgrounds.includes(currentBgTag)
    ) {
      filteredBackgrounds.unshift(currentBgTag);
      logger.debug("[game/scene-wrap][bg] anchored currentBackground into options: %s", currentBgTag);
    }
    // Belt-and-suspenders: pull every chat-scoped plate for THIS chat from the
    // server-side asset manifest. The client samples to 50, which can drop the
    // plate for the location narration is moving into — when that happens, the
    // analyzer has no matching tag to choose and keeps the stale plate. This
    // ensures all chat-scoped cadres are always offered.
    try {
      const serverManifestAssets = getAssetManifest().assets ?? {};
      let mergedChatBgs = 0;
      for (const key of Object.keys(serverManifestAssets)) {
        if (!key.startsWith(myChatPrefix)) continue;
        if (filteredBackgrounds.includes(key)) continue;
        filteredBackgrounds.push(key);
        mergedChatBgs++;
      }
      if (mergedChatBgs > 0) {
        logger.debug(
          "[game/scene-wrap][bg] merged %d chat-scoped plates from server manifest (now %d total)",
          mergedChatBgs,
          filteredBackgrounds.length,
        );
      }
    } catch (err) {
      logger.warn(err, "[game/scene-wrap][bg] failed to merge server-manifest chat plates");
    }

    const knownLocationIds = Object.keys(
      (meta.locationCatalog as Record<string, LocationCatalogEntry> | undefined) ?? {},
    );
    const currentLocationId = (meta.currentLocationId as string | null | undefined) ?? null;
    const currentSeason = coerceSeason(meta.gameCurrentSeason);
    const cgPreset = normalizeGameCgFrequency(meta.gameCgFrequency);
    const sessionNumber = currentGameSessionNumber(meta);

    const sceneCtx: SceneAnalyzerContext = {
      ...(input.context as unknown as SceneAnalyzerContext),
      availableBackgrounds: filteredBackgrounds,
      turnNumber: approxTurnNumber,
      currentLocationId,
      knownLocationIds,
      currentSeason,
      canGenerateBackgrounds: enableGen && !!imgConnId,
      canGenerateIllustrations: canAutoCgIllustrationForChat(meta, approxTurnNumber, enableGen, imgConnId),
      cgFrequency: cgPreset,
      artStylePrompt: artStyleForScene || null,
      imagePromptInstructions: imagePromptInstructions || null,
    };

    const systemPrompt = buildSceneAnalyzerSystemPrompt(sceneCtx);
    const userPrompt = buildSceneAnalyzerUserPrompt(input.narration, input.playerAction, sceneCtx);

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    if (debugLogsEnabled) {
      debugLog(
        "[debug/game/scene-analysis:connection] request chatId=%s model=%s narrationChars=%d playerActionChars=%d state=%s bgOptions=%d sfxOptions=%d widgets=%d npcs=%d streaming=%s generateBackgrounds=%s generateIllustration=%s",
        input.chatId,
        conn.model ?? "",
        input.narration.length,
        input.playerAction?.length ?? 0,
        input.context.currentState,
        input.context.availableBackgrounds.length,
        input.context.availableSfx.length,
        input.context.activeWidgets.length,
        input.context.trackedNpcs.length,
        input.streaming,
        !!sceneCtx.canGenerateBackgrounds,
        !!sceneCtx.canGenerateIllustrations,
      );
      debugLog("[debug/game/scene-analysis:connection] system prompt:\n%s", systemPrompt);
      debugLog("[debug/game/scene-analysis:connection] user prompt:\n%s", userPrompt);
    }

    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    logger.debug(
      "[game/scene-wrap] chatId=%s, model=%s, narration=%d chars, streaming=%s",
      input.chatId,
      conn.model,
      input.narration.length,
      input.streaming,
    );
    // Scene-wrap returns a single JSON payload to the caller, so the primary
    // request should stay on the buffered completion path regardless of the
    // UI's live-streaming toggle. Some GPT-5.5/OpenAI-compatible stacks return
    // empty content when `chatComplete()` is asked to stream this JSON route.
    const sceneWrapOptions = gameGenOptions(
      conn.model ?? "",
      {
        stream: false,
        responseFormat: { type: "json_object" },
      },
      gameGenerationParameters,
    );
    const result = await provider.chatComplete(messages, sceneWrapOptions);

    let sceneWrapExtraction = extractLeadingThinkingBlocks(result.content || "");
    let raw = sceneWrapExtraction.content;
    // Some provider/model combos can still return empty content on the buffered
    // path. Retry once via streamed collection using the same JSON mode.
    if (!raw.trim()) {
      logger.warn("[game/scene-wrap] Empty buffered response, retrying with streamed JSON collection");
      let streamed = "";
      for await (const chunk of provider.chat(messages, { ...sceneWrapOptions, stream: true })) {
        streamed += chunk;
      }
      sceneWrapExtraction = extractLeadingThinkingBlocks(streamed);
      raw = sceneWrapExtraction.content;
    }
    if (debugLogsEnabled) {
      debugLog(
        "[debug/game/scene-analysis:connection] raw response chatId=%s model=%s chars=%d\n%s",
        input.chatId,
        conn.model ?? "",
        raw.length,
        raw,
      );
    }
    logger.debug("[game/scene-wrap] Response (%d chars): %s", raw.length, raw);
    if (sceneWrapExtraction.thinking) {
      logger.debug(
        "[game/scene-wrap] Thinking tokens (%d chars):\n%s",
        sceneWrapExtraction.thinking.length,
        sceneWrapExtraction.thinking,
      );
    }

    try {
      const rawParsed = parseJSON(raw);
      logger.debug("[game/scene-wrap] Parsed keys: %s", Object.keys(rawParsed as Record<string, unknown>).join(", "));

      // Post-process: fuzzy-match prose → real tags and normalize direction payloads.
      const ppCtx: PostProcessContext = {
        availableBackgrounds: filteredBackgrounds,
        availableSfx: input.context.availableSfx,
        useSpotifyMusic: input.context.useSpotifyMusic,
        availableSpotifyTracks: input.context.availableSpotifyTracks,
        canGenerateBackgrounds: !!sceneCtx.canGenerateBackgrounds,
        validWidgetIds: new Set(
          input.context.activeWidgets
            .map((widget) =>
              widget && typeof widget === "object" && !Array.isArray(widget) ? (widget as { id?: unknown }).id : null,
            )
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
        characterNames: input.context.characterNames ?? [],
      };
      const parsed = postProcessSceneResult(rawParsed as import("@marinara-engine/shared").SceneAnalysis, ppCtx);

      // ── Dynamic music & ambient scoring ──
      // Replace LLM outputs with deterministic rule-based picks.
      // Read available tags from server-side manifest instead of client payload.
      const assetManifest = getAssetManifest();
      const allAssetKeys = Object.keys(assetManifest.assets ?? {});
      const serverMusicTags = allAssetKeys.filter((k) => k.startsWith("music:"));
      const serverAmbientTags = allAssetKeys.filter((k) => k.startsWith("ambient:"));

      if (input.context.useSpotifyMusic) {
        parsed.music = null;
      } else {
        const scoredMusic = scoreMusic({
          state: (input.context.currentState as GameActiveState) ?? "exploration",
          weather: parsed.weather ?? input.context.currentWeather,
          timeOfDay: parsed.timeOfDay ?? input.context.currentTimeOfDay,
          musicGenre: parsed.musicGenre,
          musicIntensity: parsed.musicIntensity,
          currentMusic: input.context.currentMusic,
          recentMusic: input.context.recentMusic,
          availableMusic: serverMusicTags,
        });
        if (scoredMusic) {
          parsed.music = scoredMusic;
        } else if (parsed.music) {
          parsed.music = null;
        }
      }

      const scoredAmbient = scoreAmbient({
        state: (input.context.currentState as GameActiveState) ?? "exploration",
        weather: parsed.weather ?? input.context.currentWeather,
        timeOfDay: parsed.timeOfDay ?? input.context.currentTimeOfDay,
        locationKind: parsed.locationKind,
        currentAmbient: input.context.currentAmbient ?? null,
        availableAmbient: serverAmbientTags,
        background: parsed.background ?? input.context.currentBackground,
      });
      if (scoredAmbient) {
        parsed.ambient = scoredAmbient;
      } else if (parsed.ambient) {
        parsed.ambient = null;
      }

      if (!sceneCtx.canGenerateIllustrations) {
        const suppressedIllustration = (parsed as { illustration?: SceneIllustrationRequest | null } | null)
          ?.illustration;
        if (suppressedIllustration) {
          const skipReason: IllustrationSkipReason = !enableGen
            ? "image_generation_disabled"
            : !imgConnId
              ? "no_image_connection"
              : !isGameCgAutoEnabled(cgPreset)
                ? "cg_frequency_off"
                : "cooldown_active";
          const lastIllustrationTurn =
            typeof meta.gameLastIllustrationTurn === "number" ? meta.gameLastIllustrationTurn : null;
          recordIllustrationSkip({
            chatId: input.chatId,
            reason: skipReason,
            illustration: suppressedIllustration,
            turnNumber: approxTurnNumber,
            lastIllustrationTurn,
            note: "game/scene-wrap",
          });
          logger.info(
            "[game/scene-wrap] illustration suppressed: reason=%s slug=%s segment=%s",
            skipReason,
            suppressedIllustration.slug ?? "?",
            suppressedIllustration.segment ?? "?",
          );
        }
        (parsed as unknown as Record<string, unknown>).illustration = null;
      }

      // ── Scene asset preparation ──
      // When sprite generation is enabled, scene-wrap may resolve cheap local
      // assets such as character-library portraits.
      //
      // Keep image generation out of /scene-wrap. This route is the scene-analysis
      // response path; if an image provider stalls here, the client can hit its
      // scene-analysis timeout even though the analyzer already returned valid JSON.
      // Missing/generated assets are handled by the follow-up /game/generate-assets
      // request, which reports asset failures separately.
      const generateSceneWrapAssetsInline = false;
      logger.info(
        "[game/scene-wrap][bg] asset-gen gate: enableSpriteGeneration=%s, gameImageConnectionId=%s, parsed.background=%s",
        enableGen,
        imgConnId ?? "null",
        (parsed as { background?: string | null } | null)?.background ?? "null",
      );


      if (!enableGen) {
        logger.info("[game/scene-wrap][bg] asset-gen SKIPPED: enableSpriteGeneration=false (toggle in chat settings)");
      } else if (!imgConnId) {
        logger.info(
          "[game/scene-wrap][bg] asset-gen SKIPPED: no gameImageConnectionId configured (set image connection in chat settings)",
        );
      }

      /** True if any `generateBackground` call in this scene-wrap wrote a new PNG (not disk cache hit). */
      let sceneWrapBackgroundFreshPaint = false;

      if (enableGen && imgConnId && parsed && typeof parsed === "object") {
        const sceneResult = parsed as unknown as Record<string, unknown>;

        try {
          const imgConn = await connections.getWithKey(imgConnId);
          if (!imgConn) {
            logger.warn(
              "[game/scene-wrap][bg] asset-gen ABORTED: image connection id=%s not found in DB",
              imgConnId,
            );
          }
          if (imgConn) {
            const imgModel = imgConn.model || "";
            const imgBaseUrl = imgConn.baseUrl || "https://image.pollinations.ai";
            const imgApiKey = imgConn.apiKey || "";
            const imgSource = (imgConn as any).imageGenerationSource || imgModel;
            const imgServiceHint = imgConn.imageService || imgSource;
            const imgComfyWorkflow = imgConn.comfyuiWorkflow || undefined;
            const imgEndpointId = imgConn.imageEndpointId || undefined;
            const imgDefaults = resolveConnectionImageDefaults(imgConn);

            const setupCfg = meta.gameSetupConfig as Record<string, unknown> | null;
            const genre = (setupCfg?.genre as string) || "";
            const setting = (setupCfg?.setting as string) || "";
            const artStyle = (setupCfg?.artStylePrompt as string) || "";

            logger.debug(
              '[game/scene-wrap][bg] using imgConnection name="%s" provider=%s model=%s source=%s baseUrl=%s; setupCfg genre="%s" setting="%s" artStyle="%s"',
              imgConn.name ?? "",
              imgConn.provider ?? "",
              imgModel,
              imgSource,
              imgBaseUrl,
              genre,
              setting,
              artStyle,
            );

            // ── Background resolution (cache → sync/async generation) ──
            //
            // Three outcomes per location:
            //   1. cache-hit       → reuse existing chat/<chatId>/<key>.png, NO API call
            //   2. cache-miss-sync → first turn of the session (no gameSceneBackground yet),
            //                        block until the image is ready so the player sees
            //                        it before narration paints
            //   3. cache-miss-async → subsequent transition; defer to client's
            //                         /generate-assets call so narration shows immediately
            const previousSceneBg = (meta.gameSceneBackground as string | null | undefined) ?? null;
            const isFirstTurnOfSession = !previousSceneBg;

            const charStore = createCharactersStorage(app.db);
            const allChars = await charStore.list();
            const charReferenceByName = new Map<string, string>();
            const charAvatarByName = new Map<string, string>();
            const charDescriptionByName = new Map<string, string>();
            for (const ch of allChars) {
              try {
                const parsed = JSON.parse(ch.data) as Record<string, unknown> & { name?: string };
                const fullBodyReference = parsed.name ? readPreferredFullBodySpriteBase64(ch.id) : null;
                if (parsed.name && fullBodyReference) {
                  addNameLookupEntry(charReferenceByName, parsed.name, fullBodyReference.base64);
                }
                if (parsed.name && ch.avatarPath) {
                  addNameLookupEntry(charAvatarByName, parsed.name, ch.avatarPath);
                }
                const appearanceText = extractCharacterAppearanceText(parsed);
                if (parsed.name && appearanceText) {
                  addNameLookupEntry(charDescriptionByName, parsed.name, appearanceText);
                }
              } catch {
                /* skip */
              }
            }

            const illustration = sceneResult.illustration as SceneIllustrationRequest | null | undefined;
            if (illustration && sceneCtx.canGenerateIllustrations && generateSceneWrapAssetsInline) {
              const illustrationAssets = collectIllustrationCharacterAssets({
                illustration,
                characterNames: input.context.characterNames ?? [],
                trackedNpcs: (input.context.trackedNpcs ?? []) as Array<Record<string, unknown>>,
                gameNpcs: (meta.gameNpcs as GameNpc[]) ?? [],
                charReferenceByName,
                charAvatarByName,
                charDescriptionByName,
                backgroundTag: (sceneResult.background as string) ?? (meta.gameSceneBackground as string) ?? null,
              });
              const illustrationSeason =
                coerceSeason((sceneResult as Record<string, unknown>).season) ?? coerceSeason(meta.gameCurrentSeason);
              const illustrationContinuity = buildIllustrationContinuity({
                narrationExcerpt: excerptNarrationForIllustration(input.narration, 1400),
                backgroundTag: (sceneResult.background as string) ?? null,
                backgroundPrompt: (sceneResult.backgroundPrompt as string) ?? null,
                locationId: (sceneResult.locationId as string) ?? null,
                weather: (sceneResult.weather as string) ?? input.context.currentWeather,
                timeOfDay: (sceneResult.timeOfDay as string) ?? input.context.currentTimeOfDay,
                season: illustrationSeason,
                priorBackgroundTag: input.context.currentBackground,
              });
              // Scene-wrap path: no live tracker snapshot here, so we feed
              // the rewriter the broad union of (sidecar + characterNames +
              // NPC cards) names+descriptions without the <scene_npcs> block.
              const rewrittenIllustrationPrompt = await rewriteIllustrationPrompt({
                app,
                chatId: input.chatId,
                draftPrompt: illustration.prompt,
                sceneContinuity: illustrationContinuity || null,
                characters: illustrationAssets.characterNamesForRewriter,
                characterDescriptions: illustrationAssets.characterDescriptionsForRewriter,
                reason: illustration.reason ?? null,
                genre,
                setting,
                artStyle,
                imagePromptInstructions,
                imageConn: {
                  provider: imgConn.provider ?? null,
                  baseUrl: imgConn.baseUrl ?? null,
                  model: imgModel,
                  imageGenerationSource: imgConn.imageGenerationSource ?? null,
                  imageService: imgConn.imageService ?? null,
                },
                chatConnectionId: chat.connectionId ?? null,
                rating: setupCfg?.rating === "nsfw" ? "nsfw" : "sfw",
              });
              const generatedTag = await generateSceneIllustration({
                chatId: input.chatId,
                prompt: illustration.prompt,
                reason: illustration.reason,
                characters: illustration.characters,
                characterDescriptions: illustrationAssets.characterDescriptions,
                sceneContinuity: illustrationContinuity || undefined,
                slug: illustration.slug,
                genre,
                setting,
                artStyle,
                imagePromptInstructions,
                referenceImages: illustrationAssets.referenceImages,
                imgSource,
                imgModel,
                imgBaseUrl,
                imgApiKey,
                imgService: imgServiceHint,
                imgEndpointId,
                imgComfyWorkflow,
                imgDefaults,
                debugLog: debugLogsEnabled ? debugLog : undefined,
                promptOverridesStorage: createPromptOverridesStorage(app.db),
                ...(rewrittenIllustrationPrompt ? { promptOverride: rewrittenIllustrationPrompt } : {}),
              });
              if (generatedTag) {
                await addGeneratedIllustrationToGallery({
                  app,
                  chatId: input.chatId,
                  tag: generatedTag,
                  illustration,
                  model: imgModel,
                });
                applyGeneratedIllustration(sceneResult, generatedTag, illustration.segment);
                sceneResult.illustration = null;
                try {
                  const latestChat = await chats.getById(input.chatId);
                  if (latestChat) {
                    const latestMeta = parseMeta(latestChat.metadata);
                    await chats.updateMetadata(input.chatId, {
                      ...latestMeta,
                      gameLastIllustrationTurn: approxTurnNumber,
                      gameLastIllustrationSessionNumber: sessionNumber,
                      gameLastIllustrationTag: generatedTag,
                    });
                  }
                } catch {
                  /* non-fatal */
                }
              }
            } else if (illustration && sceneCtx.canGenerateIllustrations) {
              logger.debug("[game/scene-wrap] illustration generation deferred to /game/generate-assets");
            }

            // ── Background generation ──
            // Check if the scene analysis picked a bg tag that doesn't exist
            const chosenBg = (sceneResult.background as string) ?? null;
            const topLevelLocationId =
              ((sceneResult as Record<string, unknown>).locationId as string | null | undefined) ?? null;
            const topLevelBgPrompt =
              ((sceneResult as Record<string, unknown>).backgroundPrompt as string | null | undefined) ?? null;
            const sceneSeason = coerceSeason((sceneResult as Record<string, unknown>).season);
            const conditions: BackgroundConditions = {
              weather: (sceneResult.weather as string | null | undefined) ?? input.context.currentWeather ?? null,
              timeOfDay:
                (sceneResult.timeOfDay as string | null | undefined) ?? input.context.currentTimeOfDay ?? null,
              season: sceneSeason,
            };

            let topLevelGeneratedTag: string | null = null;
            let topLevelGeneratedPrompt: string | null = null;
            let pendingBackgroundGeneration: PendingBackgroundGeneration | null = null;

            if (!chosenBg) {
              logger.info(
                "[game/scene-wrap][bg] LLM returned no background (parsed.background=null) — nothing to resolve at top-level",
              );
            } else if (chosenBg === "black" || chosenBg === "none") {
              logger.info(
                '[game/scene-wrap][bg] LLM picked sentinel bg="%s" — skipping generation by design',
                chosenBg,
              );
            } else if (!chosenBg.startsWith("backgrounds:generated:")) {
              // LLM picked a real existing tag from availableBackgrounds — nothing to do.
              logger.info(
                '[game/scene-wrap][bg] LLM chose existing tag bg="%s" (not generated) — REUSING, no image API call',
                chosenBg,
              );
            } else if (!topLevelLocationId) {
              logger.warn(
                '[game/scene-wrap][bg] LLM returned generated bg="%s" but no locationId — cannot cache, dropping back to async-only path',
                chosenBg,
              );
            } else {
              // Generated tag with a locationId — apply cache → sync/async logic.
              const cached = findCachedBackground(input.chatId, topLevelLocationId, conditions);
              if (cached) {
                logger.info(
                  '[game/scene-wrap][bg][cache-hit] locationId="%s" conditions=%s → reusing tag "%s" (NO API call)',
                  topLevelLocationId,
                  buildConditionsKey(conditions),
                  cached.tag,
                );
                sceneResult.background = cached.tag;
                topLevelGeneratedTag = cached.tag;
              } else if (!topLevelBgPrompt) {
                logger.warn(
                  '[game/scene-wrap][bg] cache-miss for locationId="%s" but LLM omitted backgroundPrompt — cannot generate; leaving placeholder "%s"',
                  topLevelLocationId,
                  chosenBg,
                );
              } else if (isFirstTurnOfSession) {
                logger.info(
                  '[game/scene-wrap][bg][cache-miss-sync] first turn of session — generating inline for locationId="%s", conditionsKey=%s',
                  topLevelLocationId,
                  buildConditionsKey(conditions),
                );
                const result = await generateBackground({
                  chatId: input.chatId,
                  locationId: topLevelLocationId,
                  conditions,
                  backgroundPrompt: topLevelBgPrompt,
                  setting,
                  artStyle,
                  imgSource,
                  imgModel,
                  imgBaseUrl,
                  imgApiKey,
                  imgService: imgServiceHint,
                  imgEndpointId,
                  imgComfyWorkflow,
                  imgDefaults,
                  debugLog: debugLogsEnabled ? debugLog : undefined,
                  promptOverridesStorage: createPromptOverridesStorage(app.db),
                });
                logger.info(
                  "[game/scene-wrap][bg][cache-miss-sync] generateBackground() returned: %s",
                  result?.tag ?? "null (failed)",
                );
                if (result) {
                  sceneResult.background = result.tag;
                  topLevelGeneratedTag = result.tag;
                  topLevelGeneratedPrompt = topLevelBgPrompt;
                  if (!result.reusedCache) sceneWrapBackgroundFreshPaint = true;
                }
              } else {
                logger.info(
                  '[game/scene-wrap][bg][cache-miss-async] subsequent transition — deferring to /generate-assets for locationId="%s", conditionsKey=%s',
                  topLevelLocationId,
                  buildConditionsKey(conditions),
                );
                // Pre-compute the deterministic tag so the client can match
                // against it once the file is on disk after async gen.
                const futureKey = buildBackgroundCacheKey(topLevelLocationId, conditions);
                pendingBackgroundGeneration = {
                  locationId: topLevelLocationId,
                  backgroundPrompt: topLevelBgPrompt,
                  conditions: {
                    weather: conditions.weather,
                    timeOfDay: conditions.timeOfDay,
                    season: conditions.season as Season | null,
                  },
                  placeholderTag: chosenBg,
                };
                logger.debug(
                  "[game/scene-wrap][bg][cache-miss-async] future tag will be %s",
                  backgroundTagForChat(input.chatId, futureKey),
                );
                // Leave sceneResult.background as-is (placeholder generated:slug);
                // client renders fallback until /generate-assets returns the real tag.
              }
            }

            // ── Per-segment backgrounds (always sync; usually a cache hit) ──
            if (Array.isArray(sceneResult.segmentEffects)) {
              const segments = sceneResult.segmentEffects as Record<string, unknown>[];
              logger.debug(
                "[game/scene-wrap][bg] scanning %d segmentEffects for additional bg tags",
                segments.length,
              );
              for (const fx of segments) {
                const segBg = fx.background as string | null;
                if (!segBg || segBg === "black" || segBg === "none") continue;

                // Patch top-level placeholder rewrite into matching segments first
                if (topLevelGeneratedTag && segBg === chosenBg) {
                  fx.background = topLevelGeneratedTag;
                  continue;
                }

                if (!segBg.startsWith("backgrounds:generated:")) {
                  logger.debug('[game/scene-wrap][bg] segment bg="%s" is existing tag — reuse', segBg);
                  continue;
                }

                const segLocationId = (fx.locationId as string | null | undefined) ?? null;
                const segBgPrompt = (fx.backgroundPrompt as string | null | undefined) ?? null;
                if (!segLocationId) {
                  logger.warn(
                    '[game/scene-wrap][bg] segment[%s] generated bg="%s" without locationId — skipping',
                    String(fx.segment ?? "?"),
                    segBg,
                  );
                  continue;
                }

                const cachedSeg = findCachedBackground(input.chatId, segLocationId, conditions);
                if (cachedSeg) {
                  logger.info(
                    '[game/scene-wrap][bg][cache-hit] segment[%s] locationId="%s" → reusing "%s"',
                    String(fx.segment ?? "?"),
                    segLocationId,
                    cachedSeg.tag,
                  );
                  fx.background = cachedSeg.tag;
                  continue;
                }

                if (!segBgPrompt) {
                  logger.warn(
                    '[game/scene-wrap][bg] segment[%s] cache-miss for locationId="%s" but no backgroundPrompt — leaving placeholder',
                    String(fx.segment ?? "?"),
                    segLocationId,
                  );
                  continue;
                }

                logger.info(
                  '[game/scene-wrap][bg][cache-miss-sync] segment[%s] generating inline for locationId="%s", conditionsKey=%s',
                  String(fx.segment ?? "?"),
                  segLocationId,
                  buildConditionsKey(conditions),
                );
                const segResult = await generateBackground({
                  chatId: input.chatId,
                  locationId: segLocationId,
                  conditions,
                  backgroundPrompt: segBgPrompt,
                  setting,
                  artStyle,
                  imgSource,
                  imgModel,
                  imgBaseUrl,
                  imgApiKey,
                  imgService: imgServiceHint,
                  imgEndpointId,
                  imgComfyWorkflow,
                });
                if (segResult) {
                  fx.background = segResult.tag;
                  if (!segResult.reusedCache) sceneWrapBackgroundFreshPaint = true;
                  // Persist this variant into the catalog right away.
                  await chats.updateMetadataWithMerge(input.chatId, (latestMeta) => ({
                    ...latestMeta,
                    locationCatalog: upsertLocationCatalogVariant(
                      latestMeta,
                      segLocationId,
                      conditions,
                      segResult.tag,
                      segBgPrompt,
                    ),
                  }));
                }
              }
            }

            // Persist top-level catalog/locationId updates after sync gen.
            if (topLevelGeneratedTag && topLevelLocationId) {
              await chats.updateMetadataWithMerge(input.chatId, (latestMeta) => {
                const next: Record<string, unknown> = {
                  ...latestMeta,
                  currentLocationId: topLevelLocationId,
                };
                if (topLevelGeneratedPrompt) {
                  next.locationCatalog = upsertLocationCatalogVariant(
                    latestMeta,
                    topLevelLocationId,
                    conditions,
                    topLevelGeneratedTag,
                    topLevelGeneratedPrompt,
                  );
                }
                if (sceneSeason) {
                  next.gameCurrentSeason = sceneSeason;
                }
                return next;
              });
            } else if (topLevelLocationId) {
              // Even on cache-hit / async-deferred we want to remember the
              // narrative location so the next turn's prompt sees it.
              await chats.updateMetadataWithMerge(input.chatId, (latestMeta) => {
                const next: Record<string, unknown> = {
                  ...latestMeta,
                  currentLocationId: topLevelLocationId,
                };
                if (sceneSeason) next.gameCurrentSeason = sceneSeason;
                return next;
              });
            }

            if (pendingBackgroundGeneration) {
              (sceneResult as Record<string, unknown>).pendingBackgroundGeneration = pendingBackgroundGeneration;
            }

            // ── NPC portrait generation ──
            // First, try to resolve avatars from the character library (cheap, in-memory).
            // Actual image generation for NPCs missing portraits is deferred to the client's
            // follow-up POST /game/generate-assets so it doesn't block scene-wrap — which
            // would otherwise keep the "Preparing the scene…" spinner waiting (or hit the
            // client-side safety timeout and let the user play before assets are ready).
            const stateStore = createGameStateStorage(app.db);
            const latestState = await stateStore.getLatest(input.chatId);
            const npcs = buildSceneAssetNpcCandidates(
              (input.context.trackedNpcs ?? []) as Array<Record<string, unknown>>,
              latestState?.presentCharacters,
              input.context.characterNames ?? [],
              input.narration,
            );
            const libResolvedNpcs: Array<{ name: string; description: string; avatarUrl: string }> = [];
            for (const npc of npcs) {
              if (!npc.name) continue;
              const libAvatar = findCharAvatarFuzzy(npc.name, charAvatarByName);
              if (libAvatar && npc.avatarUrl !== libAvatar) {
                npc.avatarUrl = libAvatar;
                libResolvedNpcs.push({ name: npc.name, description: npc.description, avatarUrl: libAvatar });
              }
            }

            // Persist any library-resolved avatars to chat metadata (no image gen involved)
            if (libResolvedNpcs.length > 0) {
              const chatsStore = createChatsStorage(app.db);
              await chatsStore.updateMetadataWithMerge(input.chatId, (latestMeta) => {
                const currentNpcs = (latestMeta.gameNpcs as GameNpc[] | undefined) ?? [];
                const nextNpcs = upsertGameNpcAvatarEntries(currentNpcs, libResolvedNpcs);
                if (nextNpcs === currentNpcs) return null;
                return { ...latestMeta, gameNpcs: nextNpcs };
              });
              (sceneResult as Record<string, unknown>).generatedNpcAvatars = libResolvedNpcs;
            }

            // Count NPCs that still need a portrait so logs make it clear what
            // the client's follow-up /generate-assets call will (or won't) do.
            const unresolvedNpcCount = npcs.filter((n) => !n.avatarUrl && n.name).length;
            logger.debug(
              `[game/scene-wrap] asset-gen summary: bg=${chosenBg ?? "none"}, npcs(library-resolved)=${libResolvedNpcs.length}, npcs(deferred to /generate-assets)=${unresolvedNpcCount}`,
            );
          }
        } catch (genErr) {
          logger.warn(genErr, "[game/scene-wrap] Asset generation error (non-fatal)");
        }
      }

      // Persist the resolved background to metadata so it survives refresh
      if (parsed.background) {
        try {
          await chats.updateMetadataWithMerge(input.chatId, (freshMeta) => ({
            ...freshMeta,
            gameSceneBackground: parsed.background,
            ...(sceneWrapBackgroundFreshPaint ? bumpGameBackgroundAssetRevisionMerge(freshMeta) : {}),
          }));
        } catch {
          /* non-fatal */
        }
      }

      if (debugLogsEnabled) {
        debugLog("[debug/game/scene-analysis:connection] final result:\n%s", JSON.stringify(parsed, null, 2));
      }

      return { result: parsed };
    } catch (err) {
      logger.warn(err, "[game/scene-wrap] Failed to parse LLM response as JSON: %s", raw.slice(0, 200));
      return { result: null, raw };
    }
  });

  // ── POST /game/generate-assets ──
  // Fire-and-forget asset generation for the sidecar path.
  // The client calls this after receiving a scene result with unresolvable tags.
  const generateAssetsConditionsSchema = z
    .object({
      weather: z.string().max(60).nullable().optional(),
      timeOfDay: z.string().max(60).nullable().optional(),
      season: z.enum(["spring", "summer", "autumn", "winter"]).nullable().optional(),
    })
    .optional();

  const imageSizeSchema = z.object({
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
  });
  const imageSizesSchema = z
    .object({
      background: imageSizeSchema.optional(),
      portrait: imageSizeSchema.optional(),
      selfie: imageSizeSchema.optional(),
    })
    .optional();
  const imagePromptOverrideSchema = z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        prompt: z.string().min(1).max(5000),
      }),
    )
    .max(32)
    .optional();
  const generateAssetsSchema = z.object({
    chatId: z.string().min(1),
    /**
     * Legacy: a background tag that didn't resolve. Still accepted so older
     * clients keep working — but new clients should populate the richer
     * `locationId` + `backgroundPrompt` + `conditions` triple instead.
     */
    backgroundTag: z.string().max(500).optional(),
    /** Stable kebab-case id for the location to render. */
    locationId: z.string().max(120).optional(),
    /** Rich 1–2 sentence visual brief for the image model. */
    backgroundPrompt: z.string().max(2000).optional(),
    /** Visual conditions (varies the cache key alongside locationId). */
    conditions: generateAssetsConditionsSchema,
    /** Placeholder tag the client is currently rendering as fallback. */
    placeholderTag: z.string().max(500).optional(),
    /**
     * NPCs needing portraits. `id` is the materializer-issued stable id
     * (`npc-...`); when supplied it's used as the on-disk filename. Older
     * clients may omit it, in which case the server resolves an id from
     * `chat.metadata.gameNpcs` by name.
     */
    npcsNeedingAvatars: z
      .array(
        z.object({
          id: z.string().min(1).max(120).optional(),
          name: z.string().min(1).max(200),
          description: z.string().max(1000),
        }),
      )
      .max(10)
      .optional(),
    /**
     * Resolve `locationId` / `backgroundPrompt` / `conditions` from
     * `locationCatalog` for the current `gameSceneBackground` and call the
     * image API even if the PNG already exists (`skipDiskCache`).
     */
    forceRegenerateBackground: z.boolean().optional(),
    /**
     * Like catalog-backed regeneration, but first rewrites `backgroundPrompt`
     * with the scene LLM using recent narration + setup context.
     */
    refreshBackgroundPrompt: z.boolean().optional(),
    forceNpcAvatarNames: z.array(z.string().min(1).max(200)).max(10).optional(),
    illustration: z
      .object({
        segment: z.number().int().min(0).max(500).optional(),
        prompt: z.string().min(40).max(1200),
        characters: z.array(z.string().min(1).max(200)).max(6).optional(),
        reason: z.string().max(300).optional(),
        slug: z.string().max(80).optional(),
      })
      .optional(),
    /**
     * Override the image connection used for THIS illustration call only.
     * Backgrounds and NPC avatars keep using `meta.gameImageConnectionId`.
     * Used by the gallery "+1 SFW / +1 NSFW" buttons to pick a different
     * image model (e.g. an NSFW-friendly one) per click.
     */
    illustrationConnectionId: z.string().min(1).max(120).optional(),
    /** With `illustration`, bypass the automatic per-turn illustration cooldown (player-triggered). */
    skipIllustrationCooldown: z.boolean().optional(),
    imageSizes: imageSizesSchema,
    promptOverrides: imagePromptOverrideSchema,
    debugMode: z.boolean().optional().default(false),
  });

  app.post("/generate-assets/preview", async (req) => {
    const input = generateAssetsSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const enableGen = !!meta.enableSpriteGeneration;
    const imgConnId = (meta.gameImageConnectionId as string) || null;
    if (!enableGen || !imgConnId) return { items: [] };

    const imgConn = await connections.getWithKey(imgConnId);
    if (!imgConn) return { items: [] };

    const imageSettings = await loadImageGenerationUserSettings(app.db);
    const backgroundSize: ImageGenerationSize = input.imageSizes?.background ?? imageSettings.background;
    const portraitSize: ImageGenerationSize = input.imageSizes?.portrait ?? imageSettings.portrait;

    const imgModel = imgConn.model || "";
    const imgBaseUrl = imgConn.baseUrl || "https://image.pollinations.ai";
    const imgApiKey = imgConn.apiKey || "";
    const imgSource = (imgConn as any).imageGenerationSource || imgModel;
    const imgComfyWorkflow = imgConn.comfyuiWorkflow || undefined;
    const imgServiceHint = imgConn.imageService || imgSource;
    const imgEndpointId = imgConn.imageEndpointId || undefined;
    const imgDefaults = resolveConnectionImageDefaults(imgConn);
    const promptOverridesStorage = createPromptOverridesStorage(app.db);

    const setupCfg = meta.gameSetupConfig as Record<string, unknown> | null;
    const genre = (setupCfg?.genre as string) || "";
    const setting = (setupCfg?.setting as string) || "";
    const artStyle = (setupCfg?.artStylePrompt as string) || "";
    const imagePromptInstructions =
      typeof meta.gameImagePromptInstructions === "string"
        ? meta.gameImagePromptInstructions.trim().slice(0, 1200)
        : "";

    const items: Array<{
      id: string;
      kind: "background" | "illustration" | "portrait";
      title: string;
      prompt: string;
      width: number;
      height: number;
    }> = [];

    if (input.backgroundTag) {
      const slug = generatedBackgroundSlug(input.backgroundTag);
      const prompt = await buildBackgroundImagePrompt({
        backgroundPrompt: input.backgroundTag.replace(/:/g, " ").replace(/-/g, " "),
        setting,
        artStyle,
        promptOverridesStorage,
      });
      items.push({
        id: gameImagePromptReviewId("background", slug),
        kind: "background",
        title: `Background: ${slug}`,
        prompt,
        width: backgroundSize.width,
        height: backgroundSize.height,
      });
    }

    if (input.illustration) {
      const allMsgs = await chats.listMessages(input.chatId);
      const approxTurnNumber = Math.max(1, allMsgs.filter((message) => message.role === "user").length + 1);
      const sessionNumber = currentGameSessionNumber(meta);
      if (isIllustrationAllowed(meta, approxTurnNumber)) {
        // Mirror the per-illustration connection override from /generate-assets
        // so the preview shows the prompt rendered for the model that will
        // actually run when the user clicks +1 SFW or +1 NSFW.
        let illImgModel = imgModel;
        let illImgBaseUrl = imgBaseUrl;
        let illImgApiKey = imgApiKey;
        let illImgSource = imgSource;
        let illImgServiceHint = imgServiceHint;
        let illImgComfyWorkflow = imgComfyWorkflow;
        let illImgDefaults = imgDefaults;
        if (input.illustrationConnectionId && input.illustrationConnectionId !== imgConnId) {
          const overrideConn = await connections.getWithKey(input.illustrationConnectionId);
          if (overrideConn) {
            illImgModel = overrideConn.model || "";
            illImgBaseUrl = overrideConn.baseUrl || "https://image.pollinations.ai";
            illImgApiKey = overrideConn.apiKey || "";
            illImgSource = (overrideConn as any).imageGenerationSource || illImgModel;
            illImgServiceHint = overrideConn.imageService || illImgSource;
            illImgComfyWorkflow = overrideConn.comfyuiWorkflow || undefined;
            illImgDefaults = resolveConnectionImageDefaults(overrideConn);
          }
        }

        const charStore = createCharactersStorage(app.db);
        const allChars = await charStore.list();
        const charReferenceByName = new Map<string, string>();
        const charAvatarByName = new Map<string, string>();
        const charDescriptionByName = new Map<string, string>();
        for (const ch of allChars) {
          try {
            const parsed = JSON.parse(ch.data) as Record<string, unknown> & { name?: string };
            const fullBodyReference = parsed.name ? readPreferredFullBodySpriteBase64(ch.id) : null;
            if (parsed.name && fullBodyReference) {
              addNameLookupEntry(charReferenceByName, parsed.name, fullBodyReference.base64);
            }
            if (parsed.name && ch.avatarPath) {
              addNameLookupEntry(charAvatarByName, parsed.name, ch.avatarPath);
            }
            const appearanceText = extractCharacterAppearanceText(parsed);
            if (parsed.name && appearanceText) {
              addNameLookupEntry(charDescriptionByName, parsed.name, appearanceText);
            }
          } catch {
            /* skip */
          }
        }

        const illustration = input.illustration as SceneIllustrationRequest;
        const illustrationAssets = collectIllustrationCharacterAssets({
          illustration,
          characterNames: illustration.characters ?? [],
          trackedNpcs: [],
          gameNpcs: (meta.gameNpcs as GameNpc[]) ?? [],
          charReferenceByName,
          charAvatarByName,
          charDescriptionByName,
          backgroundTag: (meta.gameSceneBackground as string) ?? null,
        });
        const prompt = await buildSceneIllustrationImagePrompt({
          chatId: input.chatId,
          prompt: illustration.prompt,
          reason: illustration.reason,
          characters: illustration.characters,
          characterDescriptions: illustrationAssets.characterDescriptions,
          slug: illustration.slug,
          genre,
          setting,
          artStyle,
          imagePromptInstructions,
          referenceImages: illustrationAssets.referenceImages,
          imgSource: illImgSource,
          imgModel: illImgModel,
          imgBaseUrl: illImgBaseUrl,
          imgApiKey: illImgApiKey,
          imgService: illImgServiceHint,
          imgEndpointId,
          imgComfyWorkflow: illImgComfyWorkflow,
          imgDefaults: illImgDefaults,
          promptOverridesStorage,
          size: backgroundSize,
        });
        const illustrationKey = illustration.slug || illustration.reason || illustration.prompt.slice(0, 80);
        items.push({
          id: gameImagePromptReviewId("illustration", illustrationKey),
          kind: "illustration",
          title: illustration.reason ? `Illustration: ${illustration.reason}` : "Scene illustration",
          prompt,
          width: backgroundSize.width,
          height: backgroundSize.height,
        });
      }
    }

    if (input.npcsNeedingAvatars?.length) {
      const forceNpcAvatarNames = new Set(
        (input.forceNpcAvatarNames ?? []).map((name) => normalizeJournalMatch(name)).filter(Boolean),
      );
      const currentNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
      const existingNpcAvatarByName = new Map<string, string>();
      for (const currentNpc of currentNpcs) {
        addExistingNpcAvatar(existingNpcAvatarByName, currentNpc.name, currentNpc.avatarUrl);
      }

      const latestState = await createGameStateStorage(app.db).getLatest(input.chatId);
      const presentCharacters = parseStoredJson<Array<Record<string, unknown>>>(latestState?.presentCharacters) ?? [];
      for (const presentCharacter of presentCharacters) {
        addExistingNpcAvatar(existingNpcAvatarByName, presentCharacter.name, presentCharacter.avatarPath);
      }

      for (const npc of input.npcsNeedingAvatars) {
        const generatedAvatarUrl = buildNpcAvatarUrl(input.chatId, npc.name);
        addExistingNpcAvatar(existingNpcAvatarByName, npc.name, generatedAvatarUrl);
      }

      const charStore = createCharactersStorage(app.db);
      const allChars = await charStore.list();
      const charAvatarByName = new Map<string, string>();
      for (const ch of allChars) {
        try {
          const parsed = JSON.parse(ch.data) as { name?: string };
          if (parsed.name && ch.avatarPath) {
            addNameLookupEntry(charAvatarByName, parsed.name, ch.avatarPath);
          }
        } catch {
          /* skip */
        }
      }

      const previewExistingNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
      const previewIdByKey = new Map<string, string>();
      for (const n of previewExistingNpcs) {
        if (n?.name && n?.id) previewIdByKey.set(npcNameKey(n.name), n.id);
      }

      for (const npc of input.npcsNeedingAvatars) {
        const normalizedNpcName = normalizeJournalMatch(npc.name);
        const forceNpcAvatar = forceNpcAvatarNames.has(normalizedNpcName);
        if (!forceNpcAvatar && existingNpcAvatarByName.get(normalizedNpcName)) continue;
        if (!forceNpcAvatar && findCharAvatarFuzzy(npc.name, charAvatarByName)) continue;

        const npcId =
          npc.id?.trim() ||
          previewIdByKey.get(npcNameKey(npc.name)) ||
          slugifyForFs(npc.name, { prefix: "s", hashHex: sha1HexLegacy });
        const prompt = await buildNpcPortraitImagePrompt({
          chatId: input.chatId,
          npcId,
          npcName: npc.name,
          appearance: npc.description,
          artStyle,
          imgSource,
          imgModel,
          imgBaseUrl,
          imgApiKey,
          imgService: imgServiceHint,
          imgEndpointId,
          imgComfyWorkflow,
          imgDefaults,
          promptOverridesStorage,
          size: portraitSize,
        });
        items.push({
          id: gameImagePromptReviewId("portrait", npc.name),
          kind: "portrait",
          title: `Portrait: ${npc.name}`,
          prompt,
          width: portraitSize.width,
          height: portraitSize.height,
        });
      }
    }

    return { items };
  });

  app.post("/generate-assets", async (req, reply) => {
    const input = generateAssetsSchema.parse(req.body);
    const requestDebug = input.debugMode === true;
    const debugOverrideEnabled = requestDebug || isDebugAgentsEnabled();
    const debugLogsEnabled = debugOverrideEnabled || logger.isLevelEnabled("debug");
    const debugLog = (message: string, ...args: any[]) => {
      logDebugOverride(debugOverrideEnabled, message, ...args);
    };
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    logger.info(
      "[game/generate-assets][bg] CALLED — chatId=%s, locationId=%s, backgroundTag=%s, hasPrompt=%s, forceRegenerate=%s, refreshPrompt=%s, npcsNeedingAvatars=%d",
      input.chatId,
      input.locationId ?? "null",
      input.backgroundTag ?? "null",
      !!input.backgroundPrompt,
      !!input.forceRegenerateBackground,
      !!input.refreshBackgroundPrompt,
      input.npcsNeedingAvatars?.length ?? 0,
    );
    if (debugLogsEnabled) {
      debugLog(
        "[debug/game/generate-assets] request payload:\n%s",
        JSON.stringify(
          {
            chatId: input.chatId,
            backgroundTag: input.backgroundTag ?? null,
            npcsNeedingAvatars: input.npcsNeedingAvatars ?? [],
            illustration: input.illustration ?? null,
          },
          null,
          2,
        ),
      );
    }

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const enableGen = !!meta.enableSpriteGeneration;
    const imgConnId = (meta.gameImageConnectionId as string) || null;

    const wantsCatalogBackedBg = !!(input.forceRegenerateBackground || input.refreshBackgroundPrompt);
    let forceRichBg: { locationId: string; backgroundPrompt: string; conditions: BackgroundConditions } | null = null;
    if (wantsCatalogBackedBg) {
      forceRichBg = findCatalogBackgroundRegeneratePayload(meta, meta.gameSceneBackground as string | undefined);
      if (!forceRichBg) {
        logger.info(
          "[game/generate-assets][bg][catalog] miss for gameSceneBackground=%s chatId=%s",
          (meta.gameSceneBackground as string | undefined) ?? "null",
          input.chatId,
        );
        return reply.code(400).send({
          error:
            "No stored background prompt for the current scene. Move to this location with sprite generation on so the catalog can record a variant.",
          generatedBackground: null,
          generatedNpcAvatars: [],
        });
      }
      if (!enableGen || !imgConnId) {
        logger.info(
          "[game/generate-assets][bg][catalog] rejected — sprite gen off or no image connection (force=%s refresh=%s)",
          !!input.forceRegenerateBackground,
          !!input.refreshBackgroundPrompt,
        );
        return reply.code(400).send({
          error: "Sprite generation is disabled or no image connection is configured.",
          generatedBackground: null,
          generatedNpcAvatars: [],
        });
      }
    }

    if (!enableGen || !imgConnId) {
      logger.info(
        "[game/generate-assets][bg] SKIPPED — enableSpriteGeneration=%s, gameImageConnectionId=%s",
        enableGen,
        imgConnId ?? "null",
      );
      return {
        generatedBackground: null,
        fallbackBackground: null,
        generatedIllustration: null,
        generatedNpcAvatars: [],
      };
    }

    const imgConn = await connections.getWithKey(imgConnId);
    if (!imgConn) {
      logger.warn("[game/generate-assets][bg] ABORTED — image connection id=%s not found in DB", imgConnId);
      if (wantsCatalogBackedBg) {
        return reply.code(400).send({
          error: "Image generation connection not found.",
          generatedBackground: null,
          generatedIllustration: null,
          generatedNpcAvatars: [],
        });
      }
      return {
        generatedBackground: null,
        fallbackBackground: null,
        generatedIllustration: null,
        generatedNpcAvatars: [],
      };
    }

    const imgModel = imgConn.model || "";
    const imgBaseUrl = imgConn.baseUrl || "https://image.pollinations.ai";
    const imgApiKey = imgConn.apiKey || "";
    const imgSource = (imgConn as any).imageGenerationSource || imgModel;
    const imgComfyWorkflow = imgConn.comfyuiWorkflow || undefined;
    const imgServiceHint = imgConn.imageService || imgSource;
    const imgEndpointId = imgConn.imageEndpointId || undefined;
    const imgDefaults = resolveConnectionImageDefaults(imgConn);
    const promptOverridesStorage = createPromptOverridesStorage(app.db);

    const setupCfg = meta.gameSetupConfig as Record<string, unknown> | null;
    const genre = (setupCfg?.genre as string) || "";
    const setting = (setupCfg?.setting as string) || "";
    const artStyle = (setupCfg?.artStylePrompt as string) || "";
    const imagePromptInstructions =
      typeof meta.gameImagePromptInstructions === "string"
        ? meta.gameImagePromptInstructions.trim().slice(0, 1200)
        : "";
    const imageSettings = await loadImageGenerationUserSettings(app.db);
    const backgroundSize: ImageGenerationSize = input.imageSizes?.background ?? imageSettings.background;
    const portraitSize: ImageGenerationSize = input.imageSizes?.portrait ?? imageSettings.portrait;
    const promptOverrideById = new Map((input.promptOverrides ?? []).map((item) => [item.id, item.prompt.trim()]));

    if (input.refreshBackgroundPrompt && forceRichBg) {
      const sceneConnId = (meta.gameSceneConnectionId as string) || null;
      let textConn: Awaited<ReturnType<typeof resolveConnection>>;
      try {
        textConn = await resolveConnection(connections, sceneConnId, chat.connectionId);
      } catch (err) {
        logger.warn(err, "[game/generate-assets][bg][refresh-prompt] resolveConnection failed chatId=%s", input.chatId);
        return reply.code(400).send({
          error:
            "No LLM connection configured for this chat. Set the main chat connection or the game scene connection in game settings.",
          generatedBackground: null,
          generatedNpcAvatars: [],
        });
      }

      const gameGenerationParameters = resolveStoredGameGenerationParameters(
        meta,
        textConn.defaultGenerationParameters,
      );
      const allMsgs = await chats.listMessages(input.chatId);
      let narrationExcerpt = "";
      for (let i = allMsgs.length - 1; i >= 0; i--) {
        const row = allMsgs[i]!;
        if (row.role !== "assistant" && row.role !== "narrator") continue;
        const cleaned = stripGameInlineTagsForContext(row.content ?? "").trim();
        if (!cleaned) continue;
        narrationExcerpt = cleaned.slice(0, 5000);
        break;
      }

      const condLine = [
        forceRichBg.conditions.weather && `weather: ${forceRichBg.conditions.weather}`,
        forceRichBg.conditions.timeOfDay && `time of day: ${forceRichBg.conditions.timeOfDay}`,
        forceRichBg.conditions.season && `season: ${forceRichBg.conditions.season}`,
      ]
        .filter(Boolean)
        .join(", ");

      const systemPrompt =
        "You write concise English visual briefs for fantasy and realistic environment illustrations. " +
        "Output ONLY the new brief as 1–2 plain sentences — no JSON, no markdown fences, no bullet list, no preamble. " +
        "Describe only the environment: architecture, landscape, lighting, weather, props. " +
        "Favor a visual-novel-friendly layout: lower third and bottom-center stay relatively open for standing character sprites; keep story-important props and focal points out of that overlay band when possible. " +
        "Never include people, figures, faces, crowds, text, UI, logos, or watermarks.";

      const userBody = [
        `Technical location id (context only, do not paste verbatim): ${forceRichBg.locationId}`,
        `Previous image brief to improve or replace: ${forceRichBg.backgroundPrompt}`,
        setting.trim() ? `Game world setting: ${setting.trim()}` : null,
        artStyle.trim() ? `Art direction: ${artStyle.trim()}` : null,
        condLine ? `Variant atmosphere: ${condLine}` : null,
        narrationExcerpt
          ? `Latest narration (excerpt):\n${narrationExcerpt}`
          : "No narration excerpt is available — infer a richer brief from the previous brief and location id alone.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const provider = createLLMProvider(
        textConn.conn.provider,
        textConn.baseUrl,
        textConn.conn.apiKey!,
        textConn.conn.maxContext,
        textConn.conn.openrouterProvider,
        textConn.conn.maxTokensOverride,
      );

      let llmContent = "";
      try {
        const llmResult = await provider.chatComplete(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userBody },
          ],
          gameGenOptions(textConn.conn.model ?? "", { temperature: 0.55, maxTokens: 400 }, gameGenerationParameters),
        );
        llmContent = llmResult.content ?? "";
      } catch (err) {
        logger.warn(err, "[game/generate-assets][bg][refresh-prompt] chatComplete failed chatId=%s", input.chatId);
        return reply.code(502).send({
          error: "Failed to rewrite the background brief with the language model.",
          generatedBackground: null,
          generatedNpcAvatars: [],
        });
      }

      const newPrompt = normalizeBackgroundBriefFromLlm(llmContent);
      if (!newPrompt) {
        logger.warn("[game/generate-assets][bg][refresh-prompt] empty brief chatId=%s", input.chatId);
        return reply.code(400).send({
          error: "The model returned an empty background brief. Try again.",
          generatedBackground: null,
          generatedNpcAvatars: [],
        });
      }

      logger.info(
        "[game/generate-assets][bg][refresh-prompt] ok chatId=%s oldLen=%d newLen=%d excerptLen=%d",
        input.chatId,
        forceRichBg.backgroundPrompt.length,
        newPrompt.length,
        narrationExcerpt.length,
      );
      logger.debug("[game/generate-assets][bg][refresh-prompt] newBrief=%s", newPrompt.slice(0, 400));

      forceRichBg = { ...forceRichBg, backgroundPrompt: newPrompt };
    }

    let generatedBackground: string | null = null;
    let fallbackBackground: string | null = null;
    let generatedIllustration: { tag: string; segment?: number } | null = null;
    const generatedNpcAvatars: Array<{ name: string; avatarUrl: string }> = [];

    // ── Generate background ──
    //
    // New rich path: the client sends `locationId` + `backgroundPrompt` +
    // `conditions` (mirrored from the scene-wrap response's
    // `pendingBackgroundGeneration` field) so the server uses the SAME cache
    // key the next scene-wrap turn will probe. Older clients may still POST
    // the legacy `backgroundTag`-only form; we keep that working but log a
    // warning because the resulting prompt is just a slug → poor quality.
    const conditions: BackgroundConditions = forceRichBg
      ? forceRichBg.conditions
      : {
          weather: input.conditions?.weather ?? null,
          timeOfDay: input.conditions?.timeOfDay ?? null,
          season: input.conditions?.season ?? null,
        };

    const richLocationId = forceRichBg?.locationId ?? input.locationId;
    const richBackgroundPrompt = forceRichBg?.backgroundPrompt ?? input.backgroundPrompt;
    const skipDiskCache = !!forceRichBg;

    if (richLocationId && richBackgroundPrompt) {
      if (forceRichBg) {
        const catalogLogLabel = input.refreshBackgroundPrompt ? "refresh-prompt" : "force";
        logger.info(
          '[game/generate-assets][bg][%s] resolved from catalog chatId=%s gameSceneBackground=%s locationId="%s" conditionsKey=%s backgroundPrompt="%s" settingLen=%d artStyleLen=%d',
          catalogLogLabel,
          input.chatId,
          (meta.gameSceneBackground as string | undefined) ?? "null",
          richLocationId,
          buildConditionsKey(conditions),
          richBackgroundPrompt,
          setting.length,
          artStyle.length,
        );
        logger.debug(
          '[game/generate-assets][bg][%s] setting="%s" artStyle="%s"',
          catalogLogLabel,
          setting.slice(0, 200),
          artStyle.slice(0, 200),
        );
      } else {
        logger.info(
          '[game/generate-assets][bg] rich-path locationId="%s" conditions=%s — invoking generateBackground()',
          richLocationId,
          buildConditionsKey(conditions),
        );
      }
      const richSlug = generatedBackgroundSlug(richLocationId);
      const richPromptOverride = promptOverrideById.get(gameImagePromptReviewId("background", richSlug));
      const result = await generateBackground({
        chatId: input.chatId,
        locationId: richLocationId,
        conditions,
        backgroundPrompt: richBackgroundPrompt,
        setting,
        artStyle,
        imgSource,
        imgModel,
        imgBaseUrl,
        imgApiKey,
        imgService: imgServiceHint,
        imgEndpointId,
        imgComfyWorkflow,
        imgDefaults,
        debugLog: debugLogsEnabled ? debugLog : undefined,
        promptOverridesStorage,
        size: backgroundSize,
        promptOverride: richPromptOverride,
        skipDiskCache,
      });
      logger.info(
        "[game/generate-assets][bg] generateBackground() returned: %s (cache=%s, locationId=%s, catalogBacked=%s)",
        result?.tag ?? "null (failed)",
        result?.reusedCache ? "hit" : "miss",
        richLocationId,
        !!forceRichBg,
      );
      if (result) {
        generatedBackground = result.tag;
        // Persist new variant + advance scene background pointer so the
        // client's `gameSceneBackground` mirror picks up the real tag.
        const locationId = richLocationId;
        const backgroundPrompt = richBackgroundPrompt;
        await chats.updateMetadataWithMerge(input.chatId, (latestMeta) => ({
          ...latestMeta,
          locationCatalog: upsertLocationCatalogVariant(
            latestMeta,
            locationId,
            conditions,
            result.tag,
            backgroundPrompt,
          ),
          currentLocationId: locationId,
          gameSceneBackground: result.tag,
          ...(conditions.season ? { gameCurrentSeason: conditions.season } : {}),
          ...(!result.reusedCache ? bumpGameBackgroundAssetRevisionMerge(latestMeta) : {}),
        }));
      } else {
        fallbackBackground = pickFallbackBackgroundTag(input.backgroundTag ?? null, getAssetManifest().assets);
        if (fallbackBackground) {
          logger.warn(
            '[game/generate-assets] background generation failed for locationId="%s"; using fallback "%s"',
            richLocationId,
            fallbackBackground,
          );
          const latestChat = await chats.getById(input.chatId);
          if (latestChat) {
            const latestMeta = parseMeta(latestChat.metadata);
            await chats.updateMetadata(input.chatId, { ...latestMeta, gameSceneBackground: fallbackBackground });
          }
        }
      }
    } else if (input.backgroundTag && !input.forceRegenerateBackground && !input.refreshBackgroundPrompt) {
      // Legacy path — derive the prompt from the tag slug. This mode loses
      // narrative context and produces lower-fidelity images; new clients
      // should ALWAYS use the rich-path above. Kept for backwards-compat.
      logger.warn(
        '[game/generate-assets][bg] legacy path (no locationId/backgroundPrompt) — falling back to slug-derived prompt for tag="%s"',
        input.backgroundTag,
      );

      // Derive a usable locationId from the tag for cache key stability.
      const derivedLocationId =
        input.backgroundTag
          .replace(/^backgrounds:/i, "")
          .replace(/:/g, "-")
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 80) || "legacy-scene";
      const derivedPrompt =
        input.backgroundTag.replace(/^backgrounds:/i, "").replace(/[:_-]+/g, " ").trim() || "generic environment";
      const slug = generatedBackgroundSlug(input.backgroundTag);
      const promptOverride = promptOverrideById.get(gameImagePromptReviewId("background", slug));

      const result = await generateBackground({
        chatId: input.chatId,
        locationId: derivedLocationId,
        conditions,
        backgroundPrompt: derivedPrompt,
        setting,
        artStyle,
        imgSource,
        imgModel,
        imgBaseUrl,
        imgApiKey,
        imgService: imgServiceHint,
        imgComfyWorkflow,
        imgDefaults,
        debugLog: debugLogsEnabled ? debugLog : undefined,
        promptOverridesStorage,
        size: backgroundSize,
        promptOverride,
      });
      logger.info(
        '[game/generate-assets][bg] (legacy) generateBackground() returned: %s (backgroundTag was "%s")',
        result?.tag ?? "null (failed)",
        input.backgroundTag,
      );
      if (result) {
        generatedBackground = result.tag;
        await chats.updateMetadataWithMerge(input.chatId, (latestMeta) => ({
          ...latestMeta,
          locationCatalog: upsertLocationCatalogVariant(
            latestMeta,
            derivedLocationId,
            conditions,
            result.tag,
            derivedPrompt,
          ),
          currentLocationId: derivedLocationId,
          gameSceneBackground: result.tag,
          ...(conditions.season ? { gameCurrentSeason: conditions.season } : {}),
          ...(!result.reusedCache ? bumpGameBackgroundAssetRevisionMerge(latestMeta) : {}),
        }));
      } else {
        fallbackBackground = pickFallbackBackgroundTag(input.backgroundTag, getAssetManifest().assets);
        if (fallbackBackground) {
          logger.warn(
            '[game/generate-assets] background generation failed for "%s"; using fallback "%s"',
            input.backgroundTag,
            fallbackBackground,
          );
          const latestChat = await chats.getById(input.chatId);
          if (latestChat) {
            const latestMeta = parseMeta(latestChat.metadata);
            await chats.updateMetadata(input.chatId, { ...latestMeta, gameSceneBackground: fallbackBackground });
          }
        }
      }
    }

    // ── Generate rare VN illustration ──
    if (input.illustration) {
      const allMsgs = await chats.listMessages(input.chatId);
      const approxTurnNumber = Math.max(1, allMsgs.filter((message) => message.role === "user").length + 1);
      const sessionNumber = currentGameSessionNumber(meta);
      const illustrationAllowed =
        input.skipIllustrationCooldown === true || isIllustrationAllowed(meta, approxTurnNumber);
      if (!illustrationAllowed) {
        const lastIllustrationTurn =
          typeof meta.gameLastIllustrationTurn === "number" ? meta.gameLastIllustrationTurn : null;
        logger.info(
          "[game/generate-assets] illustration skipped: cooldown active (turn=%d, lastIllustrationTurn=%s)",
          approxTurnNumber,
          lastIllustrationTurn ?? "?",
        );
        recordIllustrationSkip({
          chatId: input.chatId,
          reason: "cooldown_active",
          illustration: input.illustration,
          turnNumber: approxTurnNumber,
          lastIllustrationTurn,
          note: "game/generate-assets",
        });
      } else {
        // Per-illustration connection override (gallery "+1 SFW / +1 NSFW").
        // Only the illustration call uses this — backgrounds and NPC avatars
        // continue to use `meta.gameImageConnectionId` so a NSFW model never
        // bleeds into the location's regular plate.
        let illImgConn = imgConn;
        let illImgModel = imgModel;
        let illImgBaseUrl = imgBaseUrl;
        let illImgApiKey = imgApiKey;
        let illImgSource = imgSource;
        let illImgServiceHint = imgServiceHint;
        let illImgComfyWorkflow = imgComfyWorkflow;
        let illImgDefaults = imgDefaults;
        if (input.illustrationConnectionId && input.illustrationConnectionId !== imgConnId) {
          const overrideConn = await connections.getWithKey(input.illustrationConnectionId);
          if (!overrideConn) {
            logger.warn(
              "[game/generate-assets] illustration: override connection id=%s not found in DB — falling back to default image connection",
              input.illustrationConnectionId,
            );
            return reply.code(400).send({
              error: "Illustration image connection not found.",
              generatedBackground: null,
              fallbackBackground: null,
              generatedIllustration: null,
              generatedNpcAvatars: [],
            });
          }
          illImgConn = overrideConn;
          illImgModel = overrideConn.model || "";
          illImgBaseUrl = overrideConn.baseUrl || "https://image.pollinations.ai";
          illImgApiKey = overrideConn.apiKey || "";
          illImgSource = (overrideConn as any).imageGenerationSource || illImgModel;
          illImgServiceHint = overrideConn.imageService || illImgSource;
          illImgComfyWorkflow = overrideConn.comfyuiWorkflow || undefined;
          illImgDefaults = resolveConnectionImageDefaults(overrideConn);
          logger.info(
            "[game/generate-assets] illustration: using override connection id=%s model=%s (default chat connection id=%s)",
            input.illustrationConnectionId,
            illImgModel || "?",
            imgConnId,
          );
        }

        const charStore = createCharactersStorage(app.db);
        const allChars = await charStore.list();
        const charReferenceByName = new Map<string, string>();
        const charAvatarByName = new Map<string, string>();
        const charDescriptionByName = new Map<string, string>();
        for (const ch of allChars) {
          try {
            const parsed = JSON.parse(ch.data) as Record<string, unknown> & { name?: string };
            const fullBodyReference = parsed.name ? readPreferredFullBodySpriteBase64(ch.id) : null;
            if (parsed.name && fullBodyReference) {
              addNameLookupEntry(charReferenceByName, parsed.name, fullBodyReference.base64);
            }
            if (parsed.name && ch.avatarPath) {
              addNameLookupEntry(charAvatarByName, parsed.name, ch.avatarPath);
            }
            const appearanceText = extractCharacterAppearanceText(parsed);
            if (parsed.name && appearanceText) {
              addNameLookupEntry(charDescriptionByName, parsed.name, appearanceText);
            }
          } catch {
            /* skip */
          }
        }

        const illustration = input.illustration as SceneIllustrationRequest;
        let narrationExcerptForIll: string | undefined;
        for (let i = allMsgs.length - 1; i >= 0; i--) {
          const row = allMsgs[i];
          if (row && (row.role === "assistant" || row.role === "narrator") && row.content?.trim()) {
            narrationExcerptForIll = excerptNarrationForIllustration(row.content, 1400);
            break;
          }
        }
        const latestStateForIll = await createGameStateStorage(app.db).getLatest(input.chatId);
        // Parse the live tracker snapshot once so we can extract both names
        // (for the union below) and the full appearance/mood/outfit fields
        // (for the <scene_npcs> block sent to the image-prompt-writer).
        const presentCharactersForIll =
          parseStoredJson<PresentCharacter[]>(latestStateForIll?.presentCharacters) ?? [];
        const presentNames = presentCharactersForIll
          .map((p) => (typeof p?.name === "string" ? p.name.trim() : ""))
          .filter(Boolean);
        const npcMetaNames = ((meta.gameNpcs as GameNpc[]) ?? [])
          .map((n) => n.name?.trim())
          .filter((n): n is string => !!n);
        const characterNamesForIll = Array.from(
          new Set([...(illustration.characters ?? []), ...presentNames, ...npcMetaNames]),
        ).slice(0, 10);
        const illustrationKey = illustration.slug || illustration.reason || illustration.prompt.slice(0, 80);
        const illustrationPromptOverride = promptOverrideById.get(
          gameImagePromptReviewId("illustration", illustrationKey),
        );
        const metaBg = (meta.gameSceneBackground as string) ?? null;
        const metaLoc = (meta.currentLocationId as string) ?? null;
        const illustrationAssets = collectIllustrationCharacterAssets({
          illustration,
          characterNames: characterNamesForIll,
          trackedNpcs: ((meta.gameNpcs ?? []) as unknown as Array<Record<string, unknown>>) ?? [],
          gameNpcs: (meta.gameNpcs as GameNpc[]) ?? [],
          charReferenceByName,
          charAvatarByName,
          charDescriptionByName,
          backgroundTag: metaBg,
        });
        const illustrationSeasonGen = input.conditions?.season ?? coerceSeason(meta.gameCurrentSeason);
        const illustrationContinuityGen = buildIllustrationContinuity({
          narrationExcerpt: narrationExcerptForIll,
          backgroundTag: metaBg,
          backgroundPrompt: input.backgroundPrompt ?? null,
          locationId: input.locationId ?? metaLoc,
          weather: input.conditions?.weather ?? null,
          timeOfDay: input.conditions?.timeOfDay ?? null,
          season: illustrationSeasonGen,
          priorBackgroundTag: input.placeholderTag ?? null,
        });
        // User-supplied review override always wins. Otherwise let the
        // image-prompt-writer agent rewrite the sidecar draft for the target
        // image-model family.
        let resolvedIllustrationPromptOverride = illustrationPromptOverride;
        if (resolvedIllustrationPromptOverride?.trim()) {
          logger.info(
            "[game/generate-assets] illustration: user-supplied prompt override present — skipping image-prompt-writer",
          );
        } else {
          // Hand the rewriter the BROAD union of names + full appearance text
          // for everyone we know about (sidecar + tracker + NPC cards), plus
          // the live <scene_npcs> block. Without this the rewriter only sees
          // whoever the small sidecar model happened to mention in the draft.
          const sceneNpcsBlock = buildScenePresenceBlock(
            presentCharactersForIll,
            (meta.gameNpcs as GameNpc[]) ?? [],
            illustrationAssets.characterNamesForRewriter,
            { allowExtraTrackerEntries: !(illustration.characters && illustration.characters.length > 0) },
          );
          logger.info(
            "[game/generate-assets] illustration: requesting image-prompt-writer rewrite (chat=%s, draftChars=%d, names=%d, descs=%d, sceneNpcs=%s)",
            input.chatId,
            illustration.prompt.length,
            illustrationAssets.characterNamesForRewriter.length,
            illustrationAssets.characterDescriptionsForRewriter.length,
            sceneNpcsBlock ? `${sceneNpcsBlock.split("\n").length}lines` : "off",
          );
          const rewritten = await rewriteIllustrationPrompt({
            app,
            chatId: input.chatId,
            draftPrompt: illustration.prompt,
            sceneContinuity: illustrationContinuityGen || null,
            characters: illustrationAssets.characterNamesForRewriter,
            characterDescriptions: illustrationAssets.characterDescriptionsForRewriter,
            sceneNpcs: sceneNpcsBlock,
            reason: illustration.reason ?? null,
            genre,
            setting,
            artStyle,
            imagePromptInstructions,
            imageConn: {
              provider: illImgConn.provider ?? null,
              baseUrl: illImgConn.baseUrl ?? null,
              model: illImgModel,
              imageGenerationSource: illImgConn.imageGenerationSource ?? null,
              imageService: illImgConn.imageService ?? null,
            },
            chatConnectionId: chat.connectionId ?? null,
            rating: setupCfg?.rating === "nsfw" ? "nsfw" : "sfw",
          });
          if (rewritten) {
            resolvedIllustrationPromptOverride = rewritten;
            logger.info(
              "[game/generate-assets] illustration: using rewritten prompt (%d chars)",
              rewritten.length,
            );
          } else {
            logger.info(
              "[game/generate-assets] illustration: rewrite skipped/failed — falling back to draft prompt",
            );
          }
        }
        const tag = await generateSceneIllustration({
          chatId: input.chatId,
          prompt: illustration.prompt,
          reason: illustration.reason,
          characters: illustration.characters,
          characterDescriptions: illustrationAssets.characterDescriptions,
          sceneContinuity: illustrationContinuityGen || undefined,
          slug: illustration.slug,
          genre,
          setting,
          artStyle,
          imagePromptInstructions,
          referenceImages: illustrationAssets.referenceImages,
          imgSource: illImgSource,
          imgModel: illImgModel,
          imgBaseUrl: illImgBaseUrl,
          imgApiKey: illImgApiKey,
          imgService: illImgServiceHint,
          imgEndpointId,
          imgComfyWorkflow: illImgComfyWorkflow,
          imgDefaults: illImgDefaults,
          debugLog: debugLogsEnabled ? debugLog : undefined,
          promptOverridesStorage,
          size: backgroundSize,
          promptOverride: resolvedIllustrationPromptOverride,
        });

        if (tag) {
          await addGeneratedIllustrationToGallery({
            app,
            chatId: input.chatId,
            tag,
            illustration,
            model: illImgModel,
          });
          generatedIllustration = {
            tag,
            ...(illustration.segment !== undefined ? { segment: illustration.segment } : {}),
          };
          const latestChat = await chats.getById(input.chatId);
          if (latestChat) {
            const latestMeta = parseMeta(latestChat.metadata);
            await chats.updateMetadata(input.chatId, {
              ...latestMeta,
              gameLastIllustrationTurn: approxTurnNumber,
              gameLastIllustrationSessionNumber: sessionNumber,
              gameLastIllustrationTag: tag,
            });
          }
        }
      }
    }

    // ── Generate NPC avatars ──
    if (input.npcsNeedingAvatars?.length) {
      const forceNpcAvatarNames = new Set(
        (input.forceNpcAvatarNames ?? []).map((name) => normalizeJournalMatch(name)).filter(Boolean),
      );
      const latestChat = await chats.getById(input.chatId);
      const latestMeta = latestChat ? parseMeta(latestChat.metadata) : meta;
      const currentNpcs = (latestMeta.gameNpcs as GameNpc[]) ?? [];
      const existingNpcAvatarByName = new Map<string, string>();
      for (const currentNpc of currentNpcs) {
        addExistingNpcAvatar(existingNpcAvatarByName, currentNpc.name, currentNpc.avatarUrl);
      }

      const latestState = await createGameStateStorage(app.db).getLatest(input.chatId);
      const presentCharacters = parseStoredJson<Array<Record<string, unknown>>>(latestState?.presentCharacters) ?? [];
      for (const presentCharacter of presentCharacters) {
        addExistingNpcAvatar(existingNpcAvatarByName, presentCharacter.name, presentCharacter.avatarPath);
      }

      for (const npc of input.npcsNeedingAvatars) {
        const generatedAvatarUrl = buildNpcAvatarUrl(input.chatId, npc.name);
        addExistingNpcAvatar(existingNpcAvatarByName, npc.name, generatedAvatarUrl);
      }

      // Check character library first — reuse existing avatars
      const charStore = createCharactersStorage(app.db);
      const allChars = await charStore.list();
      const charAvatarByName = new Map<string, string>();
      for (const ch of allChars) {
        try {
          const parsed = JSON.parse(ch.data) as { name?: string };
          if (parsed.name && ch.avatarPath) {
            addNameLookupEntry(charAvatarByName, parsed.name, ch.avatarPath);
          }
        } catch {
          /* skip */
        }
      }

      // Build name→id lookup from currently materialized NPCs so we can
      // resolve a stable filesystem id even when the client doesn't pass one.
      const existingGameNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
      const idByKey = new Map<string, string>();
      for (const n of existingGameNpcs) {
        if (n?.name && n?.id) {
          idByKey.set(npcNameKey(n.name), n.id);
        }
      }

      for (const npc of input.npcsNeedingAvatars) {
        const normalizedNpcName = normalizeJournalMatch(npc.name);
        const forceNpcAvatar = forceNpcAvatarNames.has(normalizedNpcName);
        const existingAvatarUrl = existingNpcAvatarByName.get(normalizeJournalMatch(npc.name));
        if (!forceNpcAvatar && existingAvatarUrl) {
          logger.debug('[game/generate-assets] NPC avatar exists, skipping generation: "%s"', npc.name);
          generatedNpcAvatars.push({ name: npc.name, avatarUrl: existingAvatarUrl });
          continue;
        }

        const libAvatar = findCharAvatarFuzzy(npc.name, charAvatarByName);
        if (!forceNpcAvatar && libAvatar) {
          generatedNpcAvatars.push({ name: npc.name, avatarUrl: libAvatar });
          continue;
        }
        const npcId =
          npc.id?.trim() ||
          idByKey.get(npcNameKey(npc.name)) ||
          slugifyForFs(npc.name, { prefix: "s", hashHex: sha1HexLegacy });
        const avatarUrl = await generateNpcPortrait({
          chatId: input.chatId,
          npcId,
          npcName: npc.name,
          appearance: npc.description,
          artStyle,
          imgSource,
          imgModel,
          imgBaseUrl,
          imgApiKey,
          imgService: imgServiceHint,
          imgEndpointId,
          imgComfyWorkflow,
          imgDefaults,
          debugLog: debugLogsEnabled ? debugLog : undefined,
          promptOverridesStorage: createPromptOverridesStorage(app.db),
          size: portraitSize,
          promptOverride: promptOverrideById.get(gameImagePromptReviewId("portrait", npc.name)),
          force: forceNpcAvatar,
        });
        if (avatarUrl) {
          generatedNpcAvatars.push({
            name: npc.name,
            avatarUrl: `${avatarUrl.split("?")[0]}?v=${Date.now()}`,
          });
        }
      }

      // Persist avatar URLs to NPC list in metadata
      if (generatedNpcAvatars.length > 0) {
        await chats.updateMetadataWithMerge(input.chatId, (latestMeta) => {
          const npcsNow = (latestMeta.gameNpcs as GameNpc[] | undefined) ?? [];
          const avatarEntries: SceneAssetNpcAvatarEntry[] = generatedNpcAvatars.map((generatedAvatar) => ({
            ...generatedAvatar,
            description:
              input.npcsNeedingAvatars?.find(
                (npc) => normalizeJournalMatch(npc.name) === normalizeJournalMatch(generatedAvatar.name),
              )?.description ?? "",
          }));
          const nextNpcs = upsertGameNpcAvatarEntries(npcsNow, avatarEntries);
          if (nextNpcs === npcsNow) return null;
          return { ...latestMeta, gameNpcs: nextNpcs };
        });
      }
    }

    logger.info(
      "[game/generate-assets] result: bg=%s fallback=%s illustration=%s npcs=%d",
      generatedBackground ?? "none",
      fallbackBackground ?? "none",
      generatedIllustration?.tag ?? "none",
      generatedNpcAvatars.length,
    );
    if (debugLogsEnabled) {
      debugLog(
        "[debug/game/generate-assets] result payload:\n%s",
        JSON.stringify(
          { generatedBackground, fallbackBackground, generatedIllustration, generatedNpcAvatars },
          null,
          2,
        ),
      );
    }

    return { generatedBackground, fallbackBackground, generatedIllustration, generatedNpcAvatars };
  });

  // ── POST /game/npc/regenerate ──
  // User-triggered manual regeneration of an NPC's avatar and/or sprite.
  // Server-side this nukes the on-disk artifacts (otherwise the existsSync
  // short-circuits in the generators would skip work), resets the NPC's
  // metadata fields, and re-runs the unified asset pipeline. Image generation
  // remains fire-and-forget; the client picks up new assets via the existing
  // `useNpcAssetWatcher` polling on `chatKeys.detail`.
  const regenerateNpcAssetsSchema = z.object({
    chatId: z.string().min(1),
    npcId: z.string().min(1).max(120),
    /** Defaults to true. */
    avatar: z.boolean().optional(),
    /** Defaults to true. */
    sprite: z.boolean().optional(),
    /** Up to 6 expression labels after server normalization; empty uses chat defaults. */
    spriteExpressions: z.array(z.string().min(1).max(64)).max(12).optional(),
    /** Replaces NPC description in the sprite appearance block for this regeneration only. */
    spriteAppearanceOverride: z.string().max(4000).optional().nullable(),
    /** Which selected expression drives the full-body `full_idle` mood (must match a normalized sheet label). */
    spriteFullBodyExpression: z.string().min(1).max(64).optional().nullable(),
  });

  app.post("/npc/regenerate", async (req) => {
    const input = regenerateNpcAssetsSchema.parse(req.body);
    const connections = createConnectionsStorage(app.db);

    const result = await regenerateNpcAssets({
      db: app.db,
      connections,
      chatId: input.chatId,
      npcId: input.npcId,
      regenerateAvatar: input.avatar !== false,
      regenerateSprite: input.sprite !== false,
      spriteExpressions: input.spriteExpressions,
      spriteAppearanceOverride: input.spriteAppearanceOverride ?? null,
      spriteFullBodyExpression: input.spriteFullBodyExpression ?? null,
    });

    return result;
  });

  // ── POST /game/npc/sprite/full-body-expressions ──
  // Adds `full_<expression>.png` into an existing NPC sprite folder (selected version).
  const fullBodyEmotionSetSchema = z.object({
    chatId: z.string().min(1),
    npcId: z.string().min(1).max(120),
    spriteId: z.string().min(1).max(200),
    spriteExpressions: z.array(z.string().min(1).max(64)).max(12).optional(),
    spriteAppearanceOverride: z.string().max(4000).optional().nullable(),
    force: z.boolean().optional(),
  });

  app.post("/npc/sprite/full-body-expressions", async (req) => {
    const body = fullBodyEmotionSetSchema.parse(req.body);
    const connections = createConnectionsStorage(app.db);
    return scheduleNpcFullBodyEmotionSet({
      db: app.db,
      connections,
      chatId: body.chatId,
      npcId: body.npcId,
      spriteId: body.spriteId,
      spriteExpressions: body.spriteExpressions,
      spriteAppearanceOverride: body.spriteAppearanceOverride ?? null,
      force: body.force === true,
    });
  });

  // ── POST /game/npc/active-sprite ──
  // Switch which on-disk sprite folder is active for a tracked NPC (no generation).
  const setActiveNpcSpriteSchema = z.object({
    chatId: z.string().min(1),
    npcId: z.string().min(1).max(120),
    spriteId: z.string().min(1).max(200),
  });

  app.post("/npc/active-sprite", async (req, reply) => {
    const input = setActiveNpcSpriteSchema.parse(req.body);
    const result = await setActiveNpcSpriteGeneration({
      db: app.db,
      chatId: input.chatId,
      npcId: input.npcId,
      spriteId: input.spriteId,
    });
    if (!result.ok) {
      const status =
        result.reason === "chat-not-found"
          ? 404
          : result.reason === "sprite-not-on-disk" || result.reason === "invalid-sprite"
            ? 400
            : 404;
      return reply.status(status).send({ ok: false, reason: result.reason });
    }
    return { ok: true };
  });

  // ── POST /game/:chatId/fork-timeline ──
  // Copy GM chat messages up to a message into a new game (new gameId) for a clean LLM branch.
  const forkTimelineSchema = z.object({
    upToMessageId: z.string().min(1),
    name: z.string().min(1).max(200).optional(),
    forkLabel: z.string().max(200).optional(),
  });

  app.post<{ Params: { chatId: string } }>("/:chatId/fork-timeline", async (req, reply) => {
    const chats = createChatsStorage(app.db);
    const sourceChat = await chats.getById(req.params.chatId);
    if (!sourceChat) return reply.status(404).send({ error: "Chat not found" });
    if ((sourceChat.mode as string) !== "game") {
      return reply.status(400).send({ error: "Only game mode chats can fork the timeline" });
    }

    const body = forkTimelineSchema.parse(req.body ?? {});
    const msgs = await chats.listMessages(req.params.chatId);
    if (!msgs.some((m) => m.id === body.upToMessageId)) {
      return reply.status(400).send({ error: "upToMessageId not found in this chat" });
    }

    const sourceMeta = parseMeta(sourceChat.metadata);
    const oldGameId = sourceMeta.gameId as string | undefined;
    if (!oldGameId) return reply.status(400).send({ error: "Source chat has no gameId metadata" });

    const lineageRoot = (sourceMeta.forkLineageRootGameId as string | undefined) || oldGameId;
    const newGameId = randomUUID();

    const { summary: _sum, daySummaries: _day, weekSummaries: _week, ...settingsToKeep } = sourceMeta;

    let characterIds: string[] = [];
    try {
      characterIds = JSON.parse(sourceChat.characterIds as string) as string[];
    } catch {
      characterIds = [];
    }

    const branchName = body.name?.trim() || `${sourceChat.name} (fork)`;
    const newChat = await chats.create({
      name: branchName,
      mode: "game",
      characterIds,
      groupId: newGameId,
      personaId: sourceChat.personaId,
      promptPresetId: sourceChat.promptPresetId,
      connectionId: sourceChat.connectionId,
    });
    if (!newChat) return reply.status(500).send({ error: "Failed to create fork chat" });

    let nextMeta: Record<string, unknown> = {
      ...settingsToKeep,
      gameId: newGameId,
      forkLineageRootGameId: lineageRoot,
      forkedFromGameId: oldGameId,
      forkedFromChatId: req.params.chatId,
      forkedFromMessageId: body.upToMessageId,
      ...(body.forkLabel?.trim() ? { forkLabel: body.forkLabel.trim() } : {}),
      gameSessionNumber: 1,
      gameSessionStatus: "active",
      gameDialogueChatId: null,
      gameCombatChatId: null,
      gamePartyChatId: null,
      gamePreviousSessionSummaries: [],
    };

    nextMeta = remapBackgroundChatTagsInMetadata(nextMeta, req.params.chatId, newChat.id);

    await chats.updateMetadata(newChat.id, nextMeta);

    const { sourceToBranchedMessageId, snapshotIdMap } = await copyBranchMessagesAndSnapshots(
      app.db,
      chats,
      req.params.chatId,
      newChat.id,
      { upToMessageId: body.upToMessageId },
    );

    await copyGameCheckpointsForFork(app.db, req.params.chatId, newChat.id, sourceToBranchedMessageId, snapshotIdMap);

    const hydrated = await buildHydratedGameMeta(newChat.id, parseMeta((await chats.getById(newChat.id))!.metadata));
    await chats.updateMetadata(newChat.id, hydrated);

    await chats.update(newChat.id, {});

    logger.info("[game/fork-timeline] Forked chat %s → %s (gameId %s)", req.params.chatId, newChat.id, newGameId);

    return chats.getById(newChat.id);
  });

  // ── POST /game/checkpoint ──
  // Create a checkpoint (manual or auto-triggered).
  const checkpointCreateSchema = z.object({
    chatId: z.string().min(1),
    label: z.string().min(1).max(200),
    triggerType: z.enum([
      "manual",
      "session_start",
      "session_end",
      "combat_start",
      "combat_end",
      "location_change",
      "auto_interval",
    ]),
  });

  app.post("/checkpoint", async (req) => {
    const input = checkpointCreateSchema.parse(req.body);
    const checkpoints = createCheckpointService(app.db);
    const stateStore = createGameStateStorage(app.db);

    const snapshot = await stateStore.getLatest(input.chatId);
    if (!snapshot) throw new Error("No game state snapshot to checkpoint");

    const id = await checkpoints.create({
      chatId: input.chatId,
      snapshotId: snapshot.id,
      messageId: snapshot.messageId,
      label: input.label,
      triggerType: input.triggerType as CheckpointTrigger,
      location: snapshot.location,
      gameState: null, // filled by caller if needed
      weather: snapshot.weather,
      timeOfDay: snapshot.time,
      turnNumber: null,
    });

    return { id };
  });

  // ── GET /game/:chatId/checkpoints ──
  // List all checkpoints for a chat.
  app.get("/:chatId/checkpoints", async (req) => {
    const { chatId } = req.params as { chatId: string };
    const checkpoints = createCheckpointService(app.db);
    return checkpoints.listForChat(chatId);
  });

  // ── DELETE /game/checkpoint/:id ──
  // Delete a specific checkpoint.
  app.delete("/checkpoint/:id", async (req) => {
    const { id } = req.params as { id: string };
    const checkpoints = createCheckpointService(app.db);
    await checkpoints.deleteById(id);
    return { ok: true };
  });

  // ── POST /game/checkpoint/load ──
  // Restore game state from a checkpoint.
  // Creates a system message marking the restore point and copies the
  // checkpoint's snapshot data as the new "latest" game state.
  const checkpointLoadSchema = z.object({
    chatId: z.string().min(1),
    checkpointId: z.string().min(1),
  });

  app.post("/checkpoint/load", async (req) => {
    const input = checkpointLoadSchema.parse(req.body);
    const checkpointSvc = createCheckpointService(app.db);
    const stateStore = createGameStateStorage(app.db);
    const chats = createChatsStorage(app.db);

    const cp = await checkpointSvc.getById(input.checkpointId);
    if (!cp) throw new Error("Checkpoint not found");
    if (cp.chatId !== input.chatId) throw new Error("Checkpoint does not belong to this chat");

    // Fetch the original snapshot
    const snapshot = await stateStore.getByMessage(cp.messageId, 0);
    if (!snapshot) throw new Error("Checkpoint snapshot no longer exists");

    // Create a system message to mark the restore point
    const restoreMsg = await chats.createMessage({
      chatId: input.chatId,
      role: "system",
      characterId: null,
      content: `[Checkpoint restored: ${cp.label}]`,
    });
    if (!restoreMsg) throw new Error("Failed to create restore message");

    // Clone the snapshot state onto the new message
    await stateStore.create({
      chatId: input.chatId,
      messageId: restoreMsg.id,
      swipeIndex: 0,
      date: snapshot.date,
      time: snapshot.time,
      location: snapshot.location,
      weather: snapshot.weather,
      temperature: snapshot.temperature,
      presentCharacters: JSON.parse((snapshot.presentCharacters as string) ?? "[]"),
      recentEvents: JSON.parse((snapshot.recentEvents as string) ?? "[]"),
      playerStats: snapshot.playerStats ? JSON.parse(snapshot.playerStats as string) : null,
      personaStats: snapshot.personaStats ? JSON.parse(snapshot.personaStats as string) : null,
      committed: true,
    });

    // Restore chat metadata fields from checkpoint
    const chat = await chats.getById(input.chatId);
    if (chat) {
      const meta = parseMeta(chat.metadata);
      if (cp.gameState) meta.gameActiveState = cp.gameState as GameActiveState;
      await chats.updateMetadata(input.chatId, meta);
    }

    return { ok: true, messageId: restoreMsg.id };
  });
}
