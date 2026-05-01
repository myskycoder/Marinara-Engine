// ──────────────────────────────────────────────
// Game: On-the-fly Asset Generation
//
// Generates NPC portraits and location backgrounds
// mid-game using the user's image generation connection.
// Called from the scene-wrap pipeline when
// `enableSpriteGeneration` is active.
// ──────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { logger } from "../../lib/logger.js";
import { join } from "path";
import { slugifyForFs } from "@marinara-engine/shared";
import { DATA_DIR } from "../../utils/data-dir.js";
import { generateImage, type ImageGenRequest } from "../image/image-generation.js";
import { buildAssetManifest, GAME_ASSETS_DIR } from "./asset-manifest.service.js";
import { sha1HexLegacy } from "./npc-name-server.js";

const NPC_AVATAR_DIR = join(DATA_DIR, "avatars", "npc");

/**
 * Robust slugifier for arbitrary user-provided names (NPCs, locations, …).
 * Thin wrapper around the shared `slugifyForFs` that pins the legacy
 * `prefix: "s"` and SHA-1 hash to keep filenames stable for chats whose
 * avatars are already on disk (any non-Latin NPC name relied on the SHA-1
 * fallback). New code should prefer `npcAvatarFilename(npc.id)` which
 * sidesteps slug logic entirely.
 *
 * @deprecated Use `slugifyForFs` from `@marinara-engine/shared` directly for
 * new code, or `npcAvatarFilename(npc.id)` for Game-mode NPCs.
 */
export function safeName(name: string): string {
  return slugifyForFs(name, { prefix: "s", hashHex: sha1HexLegacy });
}

/**
 * Canonical on-disk filename for an NPC portrait. The materializer-provided
 * `npc.id` (e.g. `npc-2e5ec5b399`) is always ASCII-safe, so we use it as-is.
 */
export function npcAvatarFilename(npcId: string): string {
  return `${npcId}.png`;
}

/** Canonical public URL for an NPC portrait. */
export function npcAvatarUrl(chatId: string, npcId: string): string {
  return `/api/avatars/npc/${chatId}/${npcAvatarFilename(npcId)}`;
}

/**
 * Absolute filesystem path for an NPC portrait file. Note: this points at
 * the on-disk location; not all callers need it (the URL is what gets stored
 * in chat metadata), but read-side resolvers benefit from the path helper.
 */
export function npcAvatarFilePath(chatId: string, npcId: string): string {
  return join(NPC_AVATAR_DIR, chatId, npcAvatarFilename(npcId));
}

/**
 * Load an NPC portrait from disk and return raw base64 bytes (no data: prefix).
 *
 * Image-generation providers (Gemini via OpenRouter, etc.) expect inline image
 * references as base64 in `inline_data.data`. Internally we store the avatar
 * URL (`/api/avatars/npc/<chatId>/<id>.png`) on `npc.avatarUrl` because that's
 * what the client renders. When the same value is forwarded to the sprite
 * generator as `referenceImage`, the provider tries to base64-decode the URL
 * string itself and rejects the request (HTTP 400, "Base64 decoding failed").
 *
 * Returns `undefined` if the file is missing or unreadable so callers can
 * gracefully fall back to text-only prompting instead of failing hard.
 */
export function readNpcAvatarBase64(chatId: string, npcId: string): string | undefined {
  try {
    const path = npcAvatarFilePath(chatId, npcId);
    if (!existsSync(path)) return undefined;
    return readFileSync(path).toString("base64");
  } catch (err) {
    logger.warn(err, "[game-asset-gen] Failed to read NPC avatar bytes for %s/%s", chatId, npcId);
    return undefined;
  }
}

export function readAvatarBase64(avatarPath: string | null | undefined): string | undefined {
  if (!avatarPath) return undefined;
  const cleanAvatarPath = avatarPath.split("?")[0] ?? avatarPath;
  const parts = cleanAvatarPath.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part.includes("\\"))) return undefined;

  let diskPath: string | null = null;
  if (cleanAvatarPath.startsWith("/api/avatars/file/")) {
    const filename = parts.at(-1);
    if (filename) diskPath = join(DATA_DIR, "avatars", filename);
  } else if (cleanAvatarPath.startsWith("/api/avatars/npc/")) {
    const chatId = parts.at(-2);
    const filename = parts.at(-1);
    if (chatId && filename) diskPath = join(DATA_DIR, "avatars", "npc", chatId, filename);
  } else if (cleanAvatarPath.startsWith("avatars/")) {
    diskPath = join(DATA_DIR, ...parts);
  }

  if (!diskPath) return undefined;
  try {
    if (!existsSync(diskPath)) return undefined;
    return readFileSync(diskPath).toString("base64");
  } catch {
    return undefined;
  }
}

/**
 * Delete an NPC portrait file from disk so the next generation pass will
 * actually re-run (the existsSync guard in `generateNpcPortrait` short-circuits
 * when the file is present). Used by the user-triggered "Regenerate avatar"
 * action — for fully automatic regeneration we never reach here because the
 * materializer only generates when `avatarUrl` is unset.
 *
 * Returns true if a file was removed, false otherwise. Errors are logged and
 * swallowed: a missing file is the desired end state regardless.
 */
export function deleteNpcAvatar(chatId: string, npcId: string): boolean {
  try {
    const path = npcAvatarFilePath(chatId, npcId);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    logger.info("[game-asset-gen] Deleted NPC portrait for regeneration: %s/%s", chatId, npcId);
    return true;
  } catch (err) {
    logger.warn(err, "[game-asset-gen] Failed to delete NPC avatar for regeneration: %s/%s", chatId, npcId);
    return false;
  }
}

function hasExplicitNonHumanCue(value: string): boolean {
  return /\b(?:animal|cat|kitten|dog|puppy|wolf|fox|bird|raven|crow|owl|horse|deer|rabbit|rat|mouse|snake|lizard|dragon|beast|creature|monster|spirit|ghost|construct|golem|doll|object|statue|mascot|non[-\s]?human|anthropomorphic|feral|quadruped)\b/i.test(
    value,
  );
}

function buildNpcPortraitPrompt(req: NpcPortraitRequest): string {
  const context = req.appearance.trim();
  const explicitNonHuman = hasExplicitNonHumanCue(`${req.npcName} ${context}`);
  return [
    `NPC portrait for ${req.npcName}.`,
    context ? `Canonical visual description from the current game: ${context}.` : "",
    explicitNonHuman
      ? "The description explicitly indicates a non-human subject. Preserve that exact species, body plan, age category, and silhouette; do not turn it into a human or kemonomimi character unless the description says humanoid."
      : "Unless the description explicitly says otherwise, depict this NPC as a human or humanoid person. Do not infer an animal species from the name, mood, speech verbs, or setting.",
    req.artStyle ? `Art style: ${req.artStyle}.` : "",
    explicitNonHuman
      ? "Use a centered avatar composition appropriate to the subject, including a creature portrait or full head-and-body crop only when that best preserves the described non-human form."
      : "Use a centered human/humanoid avatar composition: face and shoulders, readable expression, clear outfit cues.",
    "High quality game avatar, clear readable design, no text, no UI, no watermark.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1400);
}

// ── NPC Portrait Generation ──

export interface NpcPortraitRequest {
  chatId: string;
  /**
   * Stable NPC identifier used as the on-disk filename (and URL). Required —
   * Game-mode auto-materializer always supplies one. For legacy name-based
   * uploads the server-side route resolves an id (or hashed slug) before
   * calling this function.
   */
  npcId: string;
  /** Display name — used only inside the image prompt, never in paths. */
  npcName: string;
  appearance: string;
  /** Unified art style prompt for visual consistency. */
  artStyle?: string;
  /** Connection credentials — already resolved & decrypted. */
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
}

/**
 * In-flight coalescing for `generateNpcPortrait`.
 *
 * The Auto NPC Materializer fires portrait generation server-side as soon as a
 * new NPC is detected. Independently, the client's scene-effects pipeline
 * POSTs to `/game/generate-assets` with `npcsNeedingAvatars` and triggers
 * `generateNpcPortrait` again. Without coalescing, both call sites pass the
 * `existsSync` guard before either finishes writing, so we pay for two
 * identical image-generation API calls per NPC.
 *
 * The map is keyed by `${chatId}/${npcId}` and entries are removed once the
 * underlying promise settles. Sprite generation also peeks at this map via
 * `getInFlightNpcPortrait` so it can sequence itself after avatar completion
 * without forcing extra orchestration in the materializer.
 */
const inFlightNpcPortraits = new Map<string, Promise<string | null>>();

function npcPortraitKey(chatId: string, npcId: string): string {
  return `${chatId}/${npcId}`;
}

/**
 * Returns the in-flight portrait promise for `(chatId, npcId)` if one is
 * currently running, or `undefined` otherwise. Does NOT start a new
 * generation — peek-only, intended for callers that want to wait on an
 * already-scheduled portrait (e.g. sprite generation that needs the avatar
 * as a reference image).
 */
export function getInFlightNpcPortrait(chatId: string, npcId: string): Promise<string | null> | undefined {
  return inFlightNpcPortraits.get(npcPortraitKey(chatId, npcId));
}

/**
 * Generate a single portrait for an NPC and save it to disk.
 * Returns the avatar URL path on success, or null on failure.
 *
 * Concurrent calls for the same `(chatId, npcId)` share one promise — see the
 * `inFlightNpcPortraits` doc above for context.
 */
export async function generateNpcPortrait(req: NpcPortraitRequest): Promise<string | null> {
  if (!req.npcId) {
    logger.warn('[game-asset-gen] generateNpcPortrait called without npcId for "%s" — skipping', req.npcName);
    return null;
  }

  const key = npcPortraitKey(req.chatId, req.npcId);
  const inFlight = inFlightNpcPortraits.get(key);
  if (inFlight) {
    logger.debug(
      '[game-asset-gen] NPC portrait generation already in-flight for "%s" (id=%s, chat=%s) — awaiting existing request',
      req.npcName,
      req.npcId,
      req.chatId,
    );
    return inFlight;
  }

  const avatarPath = npcAvatarFilePath(req.chatId, req.npcId);
  const url = npcAvatarUrl(req.chatId, req.npcId);

  // Skip if already exists — return the URL so callers can patch metadata.
  if (existsSync(avatarPath)) {
    logger.debug(
      '[game-asset-gen] NPC portrait already on disk for "%s" (id=%s) → %s (skipping API call)',
      req.npcName,
      req.npcId,
      url,
    );
    return url;
  }

  const promise = (async (): Promise<string | null> => {
    const avatarDir = join(NPC_AVATAR_DIR, req.chatId);

    // Prompt design: lead with the physical description (highest token weight
    // for diffusion / DiT models) so the character's gender, age and build
    // are locked in before the model sees the (potentially gender-ambiguous)
    // name. Image models tend to associate names like "Greta Iron-Tooth"
    // with a stock dwarven smith silhouette and drift male; explicit
    // appearance keeps that drift in check.
    //
    // The "Match the description exactly..." line is an anti-drift directive:
    // models trained with instruction-tuning treat it as a constraint
    // rather than mere flavor text.
    const appearance = req.appearance?.trim() || "scene-relevant character";
    const prompt = [
      `Character portrait, head and shoulders, detailed face, high quality.`,
      `${appearance}.`,
      `Match the described gender, age, build and features exactly — do not invent attributes that are not stated.`,
      `Subject is named ${req.npcName} (name is for reference only, do not let it override the description above).`,
      req.artStyle ? `Art style: ${req.artStyle}.` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1000);

    logger.info(
      '[game-asset-gen] Generating NPC portrait for "%s" (id=%s, chat=%s) via %s/%s',
      req.npcName,
      req.npcId,
      req.chatId,
      req.imgSource || req.imgService || "auto",
      req.imgModel || "default",
    );

    try {
      const result = await generateImage(
        req.imgModel,
        req.imgBaseUrl,
        req.imgApiKey,
        req.imgSource || req.imgService || "",
        {
          prompt,
          model: req.imgModel,
          width: 512,
          height: 512,
          comfyWorkflow: req.imgComfyWorkflow || undefined,
        },
      );

      if (!existsSync(avatarDir)) mkdirSync(avatarDir, { recursive: true });
      writeFileSync(avatarPath, Buffer.from(result.base64, "base64"));

      logger.info('[game-asset-gen] Generated NPC portrait for "%s" → %s', req.npcName, url);
      return url;
    } catch (err) {
      logger.warn(err, '[game-asset-gen] Failed to generate portrait for "%s" (id=%s)', req.npcName, req.npcId);
      return null;
    }
  })();

  inFlightNpcPortraits.set(key, promise);
  try {
    return await promise;
  } finally {
    // Always clear regardless of success/failure so the next legitimate
    // request (e.g. retry after a transient failure) starts a fresh call.
    inFlightNpcPortraits.delete(key);
  }
}

// ── Background Generation ──

/**
 * Visual conditions that, combined with `locationId`, define a unique
 * cached background variant. `null` is normalised to the literal `"none"`
 * inside the cache key so the resulting filename is always stable.
 */
export interface BackgroundConditions {
  weather: string | null;
  timeOfDay: string | null;
  season: string | null;
}

/** Sanitise a string to ASCII kebab-case suitable for a filename component. */
function kebabForFs(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Stringify a single condition slot for the cache key (`null` → `"none"`). */
function conditionSlot(value: string | null): string {
  if (!value) return "none";
  const cleaned = kebabForFs(String(value));
  return cleaned || "none";
}

/**
 * Build the deterministic cache key used as both the filename stem and the
 * tail of the asset tag.
 *
 * `<locationId>__<weather>__<timeOfDay>__<season>` — separator is double
 * underscore so single hyphens inside slugs (e.g. `chernorechye-village-edge`)
 * stay readable.
 */
export function buildBackgroundCacheKey(locationId: string, conditions: BackgroundConditions): string {
  const loc = kebabForFs(locationId) || "unknown";
  return `${loc}__${conditionSlot(conditions.weather)}__${conditionSlot(conditions.timeOfDay)}__${conditionSlot(conditions.season)}`;
}

/** Asset tag for a per-chat generated background, e.g.
 *  `backgrounds:chat:<chatId>:<key>`. The pathToTag scanner derives the same
 *  string from `backgrounds/chat/<chatId>/<key>.png`, so both sides agree. */
export function backgroundTagForChat(chatId: string, key: string): string {
  return `backgrounds:chat:${chatId}:${key}`;
}

/** Absolute filesystem path for a per-chat generated background. */
export function backgroundFilePath(chatId: string, key: string): string {
  return join(GAME_ASSETS_DIR, "backgrounds", "chat", chatId, `${key}.png`);
}

/**
 * Look up a previously-generated background for `(chatId, locationId,
 * conditions)`. Returns `null` if no matching file exists yet.
 */
export function findCachedBackground(
  chatId: string,
  locationId: string,
  conditions: BackgroundConditions,
): { tag: string; path: string; key: string } | null {
  const key = buildBackgroundCacheKey(locationId, conditions);
  const path = backgroundFilePath(chatId, key);
  if (!existsSync(path)) return null;
  return { tag: backgroundTagForChat(chatId, key), path, key };
}

export interface BackgroundGenRequest {
  chatId: string;
  /** Stable kebab-case id for the location (e.g. `chernorechye-village-edge`). */
  locationId: string;
  /** Visual conditions that vary the cache key (weather × timeOfDay × season). */
  conditions: BackgroundConditions;
  /**
   * Rich 1–2 sentence visual brief from the scene-analyzer. This is the
   * primary description fed to the image model — NOT the location id.
   */
  backgroundPrompt: string;
  /** The game's broader cultural/era context (e.g. "Snowy Russian village, 1992"). */
  setting?: string;
  /** Unified art-style prompt for visual consistency. */
  artStyle?: string;
  /** Connection credentials. */
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
  /**
   * When true, do not reuse an existing PNG on disk — call the image API and
   * overwrite the file (used for user-triggered background regeneration).
   */
  skipDiskCache?: boolean;
}

export interface BackgroundGenResult {
  tag: string;
  /** True when an existing on-disk cache entry was reused (no API call). */
  reusedCache: boolean;
  /** Cache key (filename stem) for diagnostics. */
  key: string;
  /** Absolute path to the file (for debugging only). */
  path: string;
  /** The full prompt actually sent to the image model (only set on miss). */
  prompt?: string;
}

export interface SceneIllustrationGenRequest {
  chatId: string;
  prompt: string;
  reason?: string;
  characters?: string[];
  characterDescriptions?: string[];
  /** Location, weather, narration excerpt, background brief — keeps CG on-model. */
  sceneContinuity?: string | null;
  slug?: string;
  genre?: string;
  setting?: string;
  artStyle?: string;
  referenceImages?: string[];
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
}

/**
 * Build the image-generation prompt from the LLM's `backgroundPrompt`,
 * environmental conditions, and global style hints. Adds a strong
 * "no people" negative tail to keep characters out of the background plate.
 */
function buildBackgroundImagePrompt(req: BackgroundGenRequest): string {
  const conditionParts = [
    req.conditions.timeOfDay && `time of day: ${req.conditions.timeOfDay}`,
    req.conditions.weather && `weather: ${req.conditions.weather}`,
    req.conditions.season && `season: ${req.conditions.season}`,
  ].filter(Boolean);

  const sentences: string[] = [req.backgroundPrompt.trim().replace(/\s+/g, " ")];
  if (conditionParts.length) sentences.push(`Atmosphere — ${conditionParts.join(", ")}.`);
  if (req.setting?.trim()) sentences.push(`Setting: ${req.setting.trim()}.`);
  if (req.artStyle?.trim()) sentences.push(`Style: ${req.artStyle.trim()}.`);
  // Composition: backgrounds are shown behind full-body VN sprites — keep the
  // overlay zone legible and proportional (models respond well to explicit layout).
  sentences.push(
    "Visual-novel composition: wide 16:9 establishing shot; keep the lower third and bottom-center visually open and uncluttered so standing character sprites read at a natural scale. Place doors, signage, faces-on-posters, and story-critical props away from that overlay zone — stronger depth, architecture, and sky in mid-ground and upper frame.",
  );
  // Hard negative — repeated multi-phrase form because diffusion models
  // respond better to several restatements than to a single "no characters".
  sentences.push(
    "Empty environment plate — no people, no figures, no characters, no humans, no faces, no text, no UI, no logos, no watermarks. Cinematic perspective, atmospheric, high detail, high quality.",
  );

  return sentences.join(" ").slice(0, 1500);
}

/**
 * Generate (or reuse) a per-chat, location-aware background image and add it
 * to the asset manifest. Returns the asset tag plus diagnostics, or `null`
 * on failure.
 *
 * Cache: files are stored at `GAME_ASSETS_DIR/backgrounds/chat/<chatId>/
 * <locationId>__<weather>__<timeOfDay>__<season>.png`. When the same key
 * already exists on disk the function short-circuits without any API call.
 */
export async function generateBackground(req: BackgroundGenRequest): Promise<BackgroundGenResult | null> {
  if (!req.locationId) {
    logger.warn("[game-asset-gen][bg] generateBackground called without locationId — aborting");
    return null;
  }
  if (!req.backgroundPrompt?.trim()) {
    logger.warn(
      '[game-asset-gen][bg] generateBackground called with empty backgroundPrompt for locationId="%s" — aborting',
      req.locationId,
    );
    return null;
  }

  const key = buildBackgroundCacheKey(req.locationId, req.conditions);
  const targetDir = join(GAME_ASSETS_DIR, "backgrounds", "chat", req.chatId);
  const targetPath = join(targetDir, `${key}.png`);
  const tag = backgroundTagForChat(req.chatId, key);

  logger.info(
    '[game-asset-gen][bg] generateBackground() CALLED — chatId=%s, locationId="%s", key="%s"',
    req.chatId,
    req.locationId,
    key,
  );
  logger.debug(
    '[game-asset-gen][bg] request details: conditions=%o, backgroundPrompt="%s", setting="%s", artStyle="%s", imgSource="%s", imgModel="%s", imgService="%s", baseUrl="%s", hasComfyWorkflow=%s, skipDiskCache=%s',
    req.conditions,
    req.backgroundPrompt,
    req.setting ?? "",
    req.artStyle ?? "",
    req.imgSource ?? "",
    req.imgModel ?? "",
    req.imgService ?? "",
    req.imgBaseUrl ?? "",
    !!req.imgComfyWorkflow,
    !!req.skipDiskCache,
  );

  // Cache hit — file already exists on disk for this exact (location, conditions) combo.
  if (existsSync(targetPath) && !req.skipDiskCache) {
    logger.info(
      '[game-asset-gen][bg][cache-hit] file already on disk → reusing tag "%s" (path=%s) — NO image API call',
      tag,
      targetPath,
    );
    return { tag, path: targetPath, key, reusedCache: true };
  }

  if (existsSync(targetPath) && req.skipDiskCache) {
    logger.info(
      '[game-asset-gen][bg][skip-disk-cache] existing file at %s will be overwritten after image API call',
      targetPath,
    );
  }

  const prompt = buildBackgroundImagePrompt(req);
  logger.info(
    '[game-asset-gen][bg] FINAL PROMPT (%d chars, target tag=%s, %dx%d): %s',
    prompt.length,
    tag,
    1024,
    576,
    prompt,
  );

  const startedAt = Date.now();
  try {
    const result = await generateImage(
      req.imgModel,
      req.imgBaseUrl,
      req.imgApiKey,
      req.imgSource || req.imgService || "",
      {
        prompt,
        model: req.imgModel,
        width: 1024,
        height: 576,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetPath, Buffer.from(result.base64, "base64"));

    // Rebuild manifest so the new tag is available immediately
    buildAssetManifest();

    logger.info(
      '[game-asset-gen][bg] SUCCESS: generated key="%s" in %dms → tag=%s, file=%s, bytes=%d',
      key,
      Date.now() - startedAt,
      tag,
      targetPath,
      result.base64 ? Math.floor((result.base64.length * 3) / 4) : 0,
    );
    return { tag, path: targetPath, key, reusedCache: false, prompt };
  } catch (err) {
    logger.warn(
      err,
      '[game-asset-gen][bg] FAILED for key="%s" after %dms (tag would have been %s)',
      key,
      Date.now() - startedAt,
      tag,
    );
    return null;
  }
}

export async function generateSceneIllustration(req: SceneIllustrationGenRequest): Promise<string | null> {
  const baseSlug = safeName(req.slug || req.reason || req.prompt.slice(0, 80)) || "scene-illustration";
  const slug = `${baseSlug}-${Date.now().toString(36)}`;
  const filename = `${slug}.png`;
  const targetDir = join(GAME_ASSETS_DIR, "backgrounds", "illustrations");
  const targetPath = join(targetDir, filename);
  const tag = `backgrounds:illustrations:${slug}`;

  const styleHint = [req.artStyle, req.genre, req.setting].filter(Boolean).join(", ");
  const characterHint = req.characters?.length ? `Characters: ${req.characters.join(", ")}.` : "";
  const referenceHint = req.referenceImages?.length
    ? "Reference handling: attached character reference images are available. Use them to match faces, hair, build, colors, and distinctive features for the referenced characters."
    : "";
  const descriptionHint = req.characterDescriptions?.length
    ? `Appearance notes for visible characters without an attached reference image:\n- ${req.characterDescriptions.join("\n- ")}`
    : "";
  const continuityHint = req.sceneContinuity?.trim()
    ? [
        "Scene continuity (mandatory — same place, era, and cast as the live scene; do not invent a different room, biome, or unrelated people):",
        req.sceneContinuity.trim(),
      ].join("\n")
    : "";
  const prompt = [
    "Image type: polished visual novel CG illustration replacing the game background for one important scene.",
    "Camera / POV: first-person view from the player protagonist's eyes. Do not show the protagonist except hands or arms when the moment explicitly requires them.",
    continuityHint,
    `Scene moment: ${req.prompt}`,
    req.reason ? `Narrative purpose: ${req.reason}.` : "",
    characterHint,
    referenceHint,
    descriptionHint,
    styleHint ? `Art direction: ${styleHint}.` : "",
    "Composition: cinematic 16:9 visual novel CG, emotionally specific staging, clear focal point, high-quality finished illustration.",
    "Mandatory: match named characters to reference images and appearance notes; match environment and props to the continuity block. Do not substitute different individuals or a generic unrelated location.",
    "Avoid: text, UI, captions, speech bubbles, watermarks, and unrelated characters.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2600);

  try {
    const result = await generateImage(
      req.imgModel,
      req.imgBaseUrl,
      req.imgApiKey,
      req.imgSource || req.imgService || "",
      {
        prompt,
        model: req.imgModel,
        width: 1024,
        height: 576,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
        referenceImages: req.referenceImages?.length ? req.referenceImages.slice(0, 4) : undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetPath, Buffer.from(result.base64, "base64"));
    buildAssetManifest();

    logger.info('[game-asset-gen] Generated scene illustration "%s" -> tag: %s', slug, tag);
    return tag;
  } catch (err) {
    logger.warn(err, '[game-asset-gen] Failed to generate scene illustration "%s"', slug);
    return null;
  }
}
