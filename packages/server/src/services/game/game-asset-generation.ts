// ──────────────────────────────────────────────
// Game: On-the-fly Asset Generation
//
// Generates NPC portraits and location backgrounds
// mid-game using the user's image generation connection.
// Called from the scene-wrap pipeline when
// `enableSpriteGeneration` is active.
// ──────────────────────────────────────────────

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { logger } from "../../lib/logger.js";
import { basename, join } from "path";
import { slugifyForFs } from "@marinara-engine/shared";
import { DATA_DIR } from "../../utils/data-dir.js";
import { generateImage, type ImageGenResult } from "../image/image-generation.js";
import { buildAssetManifest, GAME_ASSETS_DIR, getAssetManifest } from "./asset-manifest.service.js";
import { sha1HexLegacy } from "./npc-name-server.js";
import type { PromptOverridesStorage } from "../storage/prompt-overrides.storage.js";
import { loadPrompt, GAME_NPC_PORTRAIT, GAME_BACKGROUND, GAME_SCENE_ILLUSTRATION } from "../prompt-overrides/index.js";
import { type ImageGenerationDefaultsProfile, type ImageStyleProfileSettings } from "@marinara-engine/shared";
import type { ImageGenerationSize } from "../image/image-generation-settings.js";
import { compileImagePrompt } from "../image/image-prompt-compiler.js";
import { hasExplicitOutfit } from "./npc-visual-description.js";

const NPC_AVATAR_DIR = join(DATA_DIR, "avatars", "npc");
const CHAT_BACKGROUND_DIR = join(DATA_DIR, "backgrounds");
const CHAT_BACKGROUND_META_PATH = join(CHAT_BACKGROUND_DIR, "meta.json");
export const DEFAULT_GAME_BACKGROUND_SIZE: ImageGenerationSize = { width: 1280, height: 720 };
export const DEFAULT_GAME_PORTRAIT_SIZE: ImageGenerationSize = { width: 1024, height: 1024 };
export const GENERATED_GAME_BACKGROUND_EXTS = ["png", "jpg", "jpeg", "webp", "avif", "gif"] as const;
const GAME_BACKGROUND_EXT_SET = new Set<string>(GENERATED_GAME_BACKGROUND_EXTS);
const GAME_PORTRAIT_NEGATIVE_PROMPT =
  "text, letters, captions, subtitles, UI, watermark, logo, signature, speech bubble, split screen, panel, collage, contact sheet, grid, four portraits, multiple portraits, duplicated face, extra head, extra person, bad anatomy, low quality";
const GAME_PORTRAIT_UNSPECIFIED_OUTFIT_NEGATIVE_PROMPT =
  `${GAME_PORTRAIT_NEGATIVE_PROMPT}, armor, chainmail, plate armor, military uniform, tactical gear, heavy pauldrons, knight, full plate`;
const GAME_BACKGROUND_NEGATIVE_PROMPT =
  "text, letters, captions, subtitles, UI, watermark, logo, signature, people, character, portrait, split screen, panel, collage, contact sheet, grid, multiple frames, low quality";
const GAME_ILLUSTRATION_NEGATIVE_PROMPT =
  "text, letters, captions, subtitles, UI, watermark, logo, signature, speech bubble, split screen, panel, collage, contact sheet, character sheet, grid, four images, duplicated face, extra head, unrelated character, bad anatomy, low quality";
const MAX_GENERATED_ASSET_SLUG_BYTES = 180;

// sharp is optional in the server package. Generated game backgrounds should be
// stored at the VN canvas ratio when possible, but generation must still work on
// platforms where sharp is unavailable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpFn = any;
let _sharp: SharpFn | null = null;
let _sharpLoadFailed = false;

async function getSharp(): Promise<SharpFn | null> {
  if (_sharp) return _sharp;
  if (_sharpLoadFailed) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - optional native dependency
    const mod = await import("sharp");
    _sharp = (mod.default ?? mod) as SharpFn;
    return _sharp;
  } catch {
    _sharpLoadFailed = true;
    return null;
  }
}

type GameBackgroundImage = {
  buffer: Buffer;
  ext: string;
};

type ChatBackgroundMeta = Record<string, { originalName?: string; tags: string[] }>;

/** Return the extension implied by known image file signatures. */
function detectImageExt(buffer: Buffer): string | null {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "gif";
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "webp";
  }
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
  }
  return null;
}

/** Prefer the actual encoded bytes, then fall back to provider metadata. */
function normalizeGeneratedImageExt(result: Pick<ImageGenResult, "mimeType" | "ext">, buffer: Buffer): string {
  const detectedExt = detectImageExt(buffer);
  if (detectedExt) return detectedExt;

  const ext = result.ext.trim().toLowerCase().replace(/^\./, "");
  if (GAME_BACKGROUND_EXT_SET.has(ext)) return ext === "jpeg" ? "jpg" : ext;

  const mime = result.mimeType.toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("avif")) return "avif";
  if (mime.includes("gif")) return "gif";
  return "png";
}

/** Resize generated backgrounds through sharp when available, preserving original format otherwise. */
async function gameBackgroundImage(result: ImageGenResult, size: ImageGenerationSize): Promise<GameBackgroundImage> {
  const input = Buffer.from(result.base64, "base64");
  const sharp = await getSharp();
  if (!sharp) return { buffer: input, ext: normalizeGeneratedImageExt(result, input) };
  try {
    const buffer = await sharp(input)
      .resize(size.width, size.height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    return { buffer, ext: "png" };
  } catch (err) {
    logger.warn(err, "[game-asset-gen] Failed to resize generated game background; saving original image");
    return { buffer: input, ext: normalizeGeneratedImageExt(result, input) };
  }
}

/** Build the generated game background file path for a slug and extension. */
function generatedBackgroundPath(targetDir: string, slug: string, ext: string): string {
  return join(targetDir, `${slug}.${ext}`);
}

/** Find an existing generated background regardless of the saved image format. */
function existingGeneratedBackgroundPath(targetDir: string, slug: string): string | null {
  for (const ext of GENERATED_GAME_BACKGROUND_EXTS) {
    const candidate = generatedBackgroundPath(targetDir, slug, ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

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

function readChatBackgroundMeta(): ChatBackgroundMeta {
  if (!existsSync(CHAT_BACKGROUND_META_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CHAT_BACKGROUND_META_PATH, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as ChatBackgroundMeta) : {};
  } catch {
    return {};
  }
}

function writeChatBackgroundMeta(meta: ChatBackgroundMeta): void {
  if (!existsSync(CHAT_BACKGROUND_DIR)) mkdirSync(CHAT_BACKGROUND_DIR, { recursive: true });
  writeFileSync(CHAT_BACKGROUND_META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

function chatBackgroundTags(req: ChatBackgroundGenRequest, slug: string): string[] {
  const tags = new Set<string>(["generated", "roleplay", slug.replace(/-/g, " ")]);
  for (const value of [req.locationSlug, req.reason]) {
    if (!value) continue;
    const clean = value.trim().replace(/\s+/g, " ");
    if (clean) tags.add(clean.slice(0, 80));
  }
  return Array.from(tags).filter(Boolean);
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

/** Resolve a background asset tag to raw base64 bytes for ComfyUI reference slots. */
export function readBackgroundBase64(backgroundTag: string | null | undefined): string | undefined {
  if (!backgroundTag?.trim()) return undefined;
  const tag = backgroundTag.trim();

  const manifestEntry = getAssetManifest().assets[tag];
  if (manifestEntry?.path) {
    const diskPath = join(GAME_ASSETS_DIR, manifestEntry.path);
    try {
      if (existsSync(diskPath)) return readFileSync(diskPath).toString("base64");
    } catch {
      /* fall through */
    }
  }

  if (tag.startsWith("backgrounds:chat:")) {
    const parts = tag.split(":");
    const chatId = parts[2];
    const key = parts.slice(3).join(":");
    if (chatId && key) {
      const diskPath = backgroundFilePath(chatId, key);
      try {
        if (existsSync(diskPath)) return readFileSync(diskPath).toString("base64");
      } catch {
        return undefined;
      }
    }
  }

  if (tag.startsWith("backgrounds:generated:") || tag.startsWith("backgrounds:illustrations:")) {
    const slug = tag.split(":").slice(2).join("-");
    const subdir = tag.startsWith("backgrounds:illustrations:") ? "illustrations" : "generated";
    const targetDir = join(GAME_ASSETS_DIR, "backgrounds", subdir);
    for (const ext of GENERATED_GAME_BACKGROUND_EXTS) {
      const diskPath = join(targetDir, `${slug}.${ext}`);
      try {
        if (existsSync(diskPath)) return readFileSync(diskPath).toString("base64");
      } catch {
        /* try next ext */
      }
    }
  }

  return undefined;
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


function truncateSlugByBytes(slug: string, maxBytes: number): string {
  let truncated = slug;
  while (Buffer.byteLength(truncated, "utf8") > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.replace(/-+$/g, "");
}

export function safeGeneratedAssetSlug(name: string, opts: { maxBytes?: number; suffix?: string } = {}): string {
  const maxBytes = opts.maxBytes ?? MAX_GENERATED_ASSET_SLUG_BYTES;
  const slug = safeName(name) || "asset";
  const suffix = opts.suffix ? safeName(opts.suffix) : "";
  const candidate = suffix ? `${slug}-${suffix}` : slug;
  if (Buffer.byteLength(candidate, "utf8") <= maxBytes) return candidate;

  const hash = createHash("sha256").update(slug).digest("hex").slice(0, 8);
  const tail = [hash, suffix].filter(Boolean).join("-");
  const prefixBudget = Math.max(1, maxBytes - Buffer.byteLength(tail, "utf8") - 1);
  const prefix = truncateSlugByBytes(slug, prefixBudget) || "asset";
  return `${prefix}-${tail}`;
}

function hasExplicitNonHumanCue(value: string): boolean {
  return /\b(?:animal|cat|kitten|dog|puppy|wolf|fox|bird|raven|crow|owl|horse|deer|rabbit|rat|mouse|snake|lizard|dragon|beast|creature|monster|spirit|ghost|construct|golem|doll|object|statue|mascot|non[-\s]?human|anthropomorphic|feral|quadruped)\b/i.test(
    value,
  );
}

function normalizeNpcGenderCue(gender: string | null | undefined, pronouns: string | null | undefined, text: string) {
  const explicit = `${gender ?? ""} ${pronouns ?? ""}`.toLowerCase();
  if (/\b(?:non[-\s]?binary|enby|androgynous|genderless|agender|they\/them)\b/.test(explicit)) {
    return "androgynous";
  }
  if (/\b(?:female|woman|girl|lady|feminine|she\/her|she|her)\b/.test(explicit)) return "female";
  if (/\b(?:male|man|boy|gentleman|masculine|he\/him|he|him|his)\b/.test(explicit)) return "male";

  const lower = text.toLowerCase();
  if (/\b(?:non[-\s]?binary|enby|androgynous|genderless|agender)\b/.test(lower)) return "androgynous";
  if (/\b(?:she|her|hers|woman|female|girl|lady)\b/.test(lower)) return "female";
  if (/\b(?:he|him|his|man|male|boy|gentleman)\b/.test(lower)) return "male";
  return null;
}

function deriveNpcAgeCue(text: string): string | null {
  const lower = text.toLowerCase();
  const decade = lower.match(/\b(?:early|mid|late)\s+(?:twenties|thirties|forties|fifties|sixties)\b/);
  if (decade?.[0]) return decade[0];
  const ageLabel = lower.match(/\b(?:young adult|middle[-\s]aged|elderly|senior|adult|teen(?:ager)?|child|kid)\b/);
  if (ageLabel?.[0]) return ageLabel[0].replace(/\s+/, " ");

  const adultMilestones = [
    /\b(?:owner|employee|business|agency|rent|debt|pay off|mercenary work|adventuring guilds?)\b/,
    /\b(?:joined the army|basic training|deployed|shipped off|fight in the war|crew)\b/,
    /\b(?:high\s*school dropout|expelled|academy|final exam)\b/,
    /\b(?:refugee|moved to|save enough money|opened)\b/,
  ];
  const score = adultMilestones.reduce((count, pattern) => count + (pattern.test(lower) ? 1 : 0), 0);
  return score >= 2 ? "young adult" : null;
}

function normalizeVisualTag(value: string): string | null {
  const tag = value
    .toLowerCase()
    .replace(/\b(?:her|his|their|the|a|an|with|has|have|having|is|are|was|were)\b/g, " ")
    .replace(/[^a-z0-9 -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!tag || tag.length > 48) return null;
  if (/\b(?:someone|something|nothing|thing|person|people|room|scene)\b/.test(tag)) return null;
  return tag;
}

function addUniqueVisualTag(tags: string[], value: string | null | undefined): void {
  const tag = value ? normalizeVisualTag(value) : null;
  if (!tag || tags.some((existing) => existing.toLowerCase() === tag)) return;
  tags.push(tag);
}

function collectNpcVisualAttributeTags(text: string): string[] {
  const tags: string[] = [];
  const clean = text.replace(/\s+/g, " ");
  const nounPattern = /\b((?:short|long|curly|wavy|straight|messy|neat|dark|light|pale|bright|piercing|deep|warm|cool|grey|gray|blue|green|hazel|brown|black|blonde|blond|auburn|red|white|silver|golden|olive|tan|tanned|fair|freckled|weathered)(?:[-\s]+[a-z]+){0,4}\s+(?:hair|eyes|skin))\b/gi;
  for (const match of clean.matchAll(nounPattern)) {
    addUniqueVisualTag(tags, match[1]);
  }

  const eyesArePattern = /\beyes?\s+(?:are|is|were|was)\s+(?:a\s+|an\s+)?((?:piercing|bright|deep|pale|dark|light|grey|gray|blue|green|hazel|brown|black|amber)(?:[-\s]+[a-z]+){0,3})\b/gi;
  for (const match of clean.matchAll(eyesArePattern)) {
    addUniqueVisualTag(tags, `${match[1]} eyes`);
  }

  const skinPattern = /\b(?:skin|complexion)\s+(?:is|are|was|were)?\s*(?:a\s+|an\s+)?((?:pale|fair|tan|tanned|olive|brown|dark|light|warm|cool|freckled|weathered)(?:[-\s]+[a-z]+){0,3})\b/gi;
  for (const match of clean.matchAll(skinPattern)) {
    addUniqueVisualTag(tags, `${match[1]} skin`);
  }

  return tags.slice(0, 4);
}

function buildNpcAppearanceLine(req: NpcPortraitRequest, explicitNonHuman: boolean): string {
  const context = req.appearance.trim();
  if (explicitNonHuman && !context) return "Appearance: non-human creature.";

  const identityTags: string[] = [];
  if (!explicitNonHuman) {
    identityTags.push(deriveNpcAgeCue(context) ?? "adult");
    identityTags.push(normalizeNpcGenderCue(req.gender, req.pronouns, context) ?? "androgynous");
    identityTags.push("human or humanoid person");
  }
  identityTags.push(...collectNpcVisualAttributeTags(context));

  const identityLine = identityTags.length > 0 ? `Appearance: ${identityTags.join(", ")}.` : "";
  if (!context) return identityLine || "Appearance: human or humanoid adult.";
  return `${identityLine} Canonical visual description from the current game: ${context}.`.trim();
}

function npcPortraitVariables(req: NpcPortraitRequest) {
  const context = req.appearance.trim();
  const explicitNonHuman = hasExplicitNonHumanCue(`${req.npcName} ${context}`);
  const hasOutfit = hasExplicitOutfit(context);
  return {
    npcName: req.npcName,
    appearanceLine: buildNpcAppearanceLine(req, explicitNonHuman),
    nonHumanRule: explicitNonHuman
      ? "The description explicitly indicates a non-human subject. Preserve that exact species, body plan, age category, and silhouette; do not turn it into a human or kemonomimi character unless the description says humanoid."
      : "Unless the description explicitly says otherwise, depict this NPC as a human or humanoid person. Do not infer an animal species from the name, mood, speech verbs, or setting.",
    artStyleLine: req.artStyle ? `Art style: ${req.artStyle}.` : "",
    compositionRule: explicitNonHuman
      ? "Use a centered avatar composition appropriate to the subject, including a creature portrait or full head-and-body crop only when that best preserves the described non-human form."
      : hasOutfit
        ? "Use a centered human/humanoid avatar composition: face and shoulders, readable expression, clear outfit cues."
        : "Use a centered human/humanoid avatar composition: face and shoulders, readable expression. Plain simple everyday clothing only; do not invent armor, uniforms, plate mail, or profession-specific gear unless explicitly described in the appearance block.",
  };
}

function portraitNegativePromptForAppearance(appearance: string): string {
  return hasExplicitOutfit(appearance)
    ? GAME_PORTRAIT_NEGATIVE_PROMPT
    : GAME_PORTRAIT_UNSPECIFIED_OUTFIT_NEGATIVE_PROMPT;
}

function resolvedSize(size: ImageGenerationSize | undefined, fallback: ImageGenerationSize): ImageGenerationSize {
  return {
    width: size?.width ?? fallback.width,
    height: size?.height ?? fallback.height,
  };
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
  gender?: string | null;
  pronouns?: string | null;
  /** Unified art style prompt for visual consistency. */
  artStyle?: string;
  /** Connection credentials — already resolved & decrypted. */
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgEndpointId?: string | null;
  imgComfyWorkflow?: string | undefined;
  imgComfyWorkflowWithReference?: string | undefined;
  imgDefaults?: ImageGenerationDefaultsProfile | null;
  styleProfiles?: ImageStyleProfileSettings;
  styleProfileId?: string | null;
  debugLog?: (message: string, ...args: any[]) => void;
  /** Storage for user-supplied prompt overrides. Optional — falls back to default builder when omitted. */
  promptOverridesStorage?: PromptOverridesStorage;
  size?: ImageGenerationSize;
  promptOverride?: string;
  negativePromptOverride?: string;
  /** When true, overwrite an existing generated NPC portrait instead of reusing it. */
  force?: boolean;
}

export type CompiledGameImagePrompt = {
  prompt: string;
  negativePrompt: string;
};

async function buildNpcPortraitRawPrompt(req: NpcPortraitRequest): Promise<string> {
  const vars = npcPortraitVariables(req);
  return req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_NPC_PORTRAIT, vars)
    : GAME_NPC_PORTRAIT.defaultBuilder(vars);
}

export async function buildNpcPortraitProviderPrompt(req: NpcPortraitRequest): Promise<CompiledGameImagePrompt> {
  if (req.promptOverride?.trim()) {
    return {
      prompt: req.promptOverride.trim(),
      negativePrompt: req.negativePromptOverride?.trim() || "",
    };
  }
  return compileGameImagePrompt(
    req,
    "portrait",
    await buildNpcPortraitRawPrompt(req),
    1400,
    portraitNegativePromptForAppearance(req.appearance),
  );
}

export async function buildNpcPortraitImagePrompt(req: NpcPortraitRequest): Promise<string> {
  return (await buildNpcPortraitProviderPrompt(req)).prompt;
}

function compileGameImagePrompt(
  req: Pick<
    NpcPortraitRequest | BackgroundGenRequest | SceneIllustrationGenRequest,
    "styleProfiles" | "styleProfileId" | "imgDefaults" | "artStyle"
  >,
  kind: "portrait" | "background" | "illustration",
  prompt: string,
  maxLength: number,
  hardNegative?: string,
  negativePrompt?: string | null,
) {
  if (!req.styleProfiles) {
    return {
      prompt: prompt.slice(0, maxLength),
      negativePrompt: [negativePrompt, hardNegative].filter(Boolean).join(", "),
    };
  }
  const compiled = compileImagePrompt({
    kind,
    prompt,
    negativePrompt,
    hardNegative,
    styleProfiles: req.styleProfiles,
    styleProfileId: req.styleProfileId,
    imageDefaults: req.imgDefaults,
    generatedStyle: req.artStyle,
  });
  return {
    prompt: compiled.prompt.slice(0, maxLength),
    negativePrompt: compiled.negativePrompt,
  };
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

  // Skip if already exists unless the caller explicitly asked for a fresh portrait.
  if (!req.force && existsSync(avatarPath)) {
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

    const prompt = await buildNpcPortraitImagePrompt(req);
    const size = resolvedSize(req.size, DEFAULT_GAME_PORTRAIT_SIZE);
    req.debugLog?.(
      "[debug/game/image-generation] NPC portrait request name=%s id=%s model=%s source=%s size=%dx%d prompt:\n%s",
      req.npcName,
      req.npcId,
      req.imgModel,
      req.imgSource || req.imgService || "",
      size.width,
      size.height,
      prompt,
    );

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
          negativePrompt: portraitNegativePromptForAppearance(req.appearance),
          model: req.imgModel,
          width: size.width,
          height: size.height,
          comfyWorkflow: req.imgComfyWorkflow || undefined,
          comfyWorkflowWithReference: req.imgComfyWorkflowWithReference || undefined,
          imageDefaults: req.imgDefaults ?? undefined,
        },
      );

      if (!existsSync(avatarDir)) mkdirSync(avatarDir, { recursive: true });
      writeFileSync(avatarPath, Buffer.from(result.base64, "base64"));

      req.debugLog?.(
        "[debug/game/image-generation] NPC portrait result name=%s bytes=%d url=%s",
        req.npcName,
        Buffer.byteLength(result.base64, "base64"),
        url,
      );
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

/** Directory holding all per-chat generated background plates for one chat. */
export function chatBackgroundPlatesDir(chatId: string): string {
  return join(GAME_ASSETS_DIR, "backgrounds", "chat", chatId);
}

/**
 * Copy every on-disk chat-scoped background plate from one chat to another.
 * Used when a new game session inherits the previous session's location catalog.
 * Returns the number of files copied (existing destination files are skipped).
 */
export function copyChatBackgroundPlates(fromChatId: string, toChatId: string): number {
  if (fromChatId === toChatId) return 0;
  const sourceDir = chatBackgroundPlatesDir(fromChatId);
  if (!existsSync(sourceDir)) return 0;

  const destDir = chatBackgroundPlatesDir(toChatId);
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  let copied = 0;
  for (const entry of readdirSync(sourceDir)) {
    if (entry.startsWith(".")) continue;
    const sourcePath = join(sourceDir, entry);
    const destPath = join(destDir, entry);
    if (existsSync(destPath)) continue;
    try {
      copyFileSync(sourcePath, destPath);
      copied++;
    } catch (err) {
      logger.warn(err, "[game-asset-gen] Failed to copy chat background plate %s -> %s", sourcePath, destPath);
    }
  }
  if (copied > 0) {
    logger.info("[game-asset-gen] Copied %d chat background plates from %s to %s", copied, fromChatId, toChatId);
  }
  return copied;
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

/**
 * Inputs the background prompt builder actually reads. Both the cache-keyed
 * `BackgroundGenRequest` and the one-off `ChatBackgroundGenRequest` satisfy
 * this — kept separate so the chat path doesn't have to fabricate dummy
 * `locationId` + `conditions` values it never uses.
 */
export interface BackgroundPromptInput {
  /** Rich 1–2 sentence visual brief fed to the image model. */
  backgroundPrompt: string;
  /** Visual conditions used to compose an "atmosphere" line. Optional. */
  conditions?: BackgroundConditions;
  /** Genre / tone hint for style guidance (e.g. "fantasy", "sci-fi"). */
  genre?: string;
  /** The game's broader cultural/era context (e.g. "Snowy Russian village, 1992"). */
  setting?: string;
  /** Unified art-style prompt for visual consistency. */
  /** Current tracked world-state location, used to keep generic scene prompts grounded. */
  currentLocation?: string | null;
  currentWeather?: string | null;
  currentTimeOfDay?: string | null;
  worldOverview?: string | null;
  artStyle?: string;
  /** Verbatim prompt that bypasses the builder. */
  promptOverride?: string;
  /** Storage for user-supplied prompt overrides. Optional — falls back to default builder when omitted. */
  promptOverridesStorage?: PromptOverridesStorage;
}

/** Image-provider credentials + io knobs shared by all asset-generation paths. */
export interface ImageProviderCredentials {
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgEndpointId?: string | null;
  imgComfyWorkflow?: string | undefined;
  imgComfyWorkflowWithReference?: string | undefined;
  imgDefaults?: ImageGenerationDefaultsProfile | null;
  styleProfiles?: ImageStyleProfileSettings;
  styleProfileId?: string | null;
  debugLog?: (message: string, ...args: any[]) => void;
  size?: ImageGenerationSize;
  promptOverride?: string;
  negativePromptOverride?: string;
}

export interface BackgroundGenRequest extends BackgroundPromptInput, ImageProviderCredentials {
  chatId: string;
  /** Stable kebab-case id for the location (e.g. `chernorechye-village-edge`). */
  locationId: string;
  /** Visual conditions that vary the cache key (weather × timeOfDay × season). */
  conditions: BackgroundConditions;
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

export interface ChatBackgroundGenRequest
  extends Omit<BackgroundPromptInput, "backgroundPrompt">,
    ImageProviderCredentials {
  chatId: string;
  /** Why the background agent asked for generation. Stored as background metadata. */
  reason?: string;
  /** Stable slug used to compose the saved filename and originalName label. */
  locationSlug?: string;
  /** Narrative description of the scene — fed to the image model and used to build the slug. */
  sceneDescription: string;
}

export interface SceneIllustrationGenRequest {
  chatId: string;
  title?: string;
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
  /** Extra user instructions appended to scene illustration prompts. */
  imagePromptInstructions?: string;
  referenceImages?: string[];
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgEndpointId?: string | null;
  imgComfyWorkflow?: string | undefined;
  imgComfyWorkflowWithReference?: string | undefined;
  imgDefaults?: ImageGenerationDefaultsProfile | null;
  styleProfiles?: ImageStyleProfileSettings;
  styleProfileId?: string | null;
  debugLog?: (message: string, ...args: any[]) => void;
  /** Storage for user-supplied prompt overrides. Optional — falls back to default builder when omitted. */
  promptOverridesStorage?: PromptOverridesStorage;
  size?: ImageGenerationSize;
  promptOverride?: string;
  negativePromptOverride?: string;
}

async function buildBackgroundRawPrompt(req: BackgroundPromptInput): Promise<string> {
  const styleHint = [req.artStyle, req.genre, req.setting].filter(Boolean).join(", ");
  const worldContext = buildBackgroundWorldContext(req);
  const groundedSceneDescription = [worldContext, req.backgroundPrompt].filter(Boolean).join(". ");
  const backgroundVars = {
    sceneDescription: groundedSceneDescription,
    styleLine: styleHint ? `Style: ${styleHint}.` : "",
  };
  return req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_BACKGROUND, backgroundVars)
    : GAME_BACKGROUND.defaultBuilder(backgroundVars);
}

function buildBackgroundWorldContext(req: BackgroundPromptInput): string {
  const fragments = [
    req.genre,
    req.setting,
    req.currentLocation ? `location ${req.currentLocation}` : "",
    req.currentWeather ? `${req.currentWeather} weather` : "",
    req.currentTimeOfDay ? req.currentTimeOfDay : "",
    compactWorldOverview(req.worldOverview),
  ]
    .map((fragment) => cleanBackgroundContextFragment(fragment))
    .filter(Boolean);
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const fragment of fragments) {
    const key = fragment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fragment);
  }
  return deduped.slice(0, 6).join(", ");
}

function compactWorldOverview(value: string | null | undefined): string {
  const clean = cleanBackgroundContextFragment(value);
  if (!clean) return "";
  const firstSentence = clean.split(/(?<=[.!?])\s+/)[0]?.trim() ?? clean;
  return firstSentence.split(/\s+/).slice(0, 18).join(" ");
}

function cleanBackgroundContextFragment(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[<>\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim()
    .slice(0, 180);
}

export async function buildBackgroundProviderPrompt(req: BackgroundGenRequest): Promise<CompiledGameImagePrompt> {
  if (req.promptOverride?.trim()) {
    return {
      prompt: req.promptOverride.trim(),
      negativePrompt: req.negativePromptOverride?.trim() || "",
    };
  }
  return compileGameImagePrompt(
    req,
    "background",
    await buildBackgroundRawPrompt(req),
    1000,
    GAME_BACKGROUND_NEGATIVE_PROMPT,
  );
}

function adaptChatBackgroundToProviderRequest(req: ChatBackgroundGenRequest): BackgroundGenRequest {
  const conditions = req.conditions ?? {
    weather: req.currentWeather ?? null,
    timeOfDay: req.currentTimeOfDay ?? null,
    season: null,
  };
  const locationId =
    req.locationSlug ||
    safeGeneratedAssetSlug(req.sceneDescription.slice(0, 80), { maxBytes: 160 }) ||
    "roleplay-scene";
  return {
    chatId: req.chatId,
    locationId,
    conditions,
    backgroundPrompt: req.sceneDescription,
    genre: req.genre,
    setting: req.setting,
    currentLocation: req.currentLocation,
    currentWeather: req.currentWeather ?? conditions.weather,
    currentTimeOfDay: req.currentTimeOfDay ?? conditions.timeOfDay,
    worldOverview: req.worldOverview,
    artStyle: req.artStyle,
    promptOverride: req.promptOverride,
    negativePromptOverride: req.negativePromptOverride,
    promptOverridesStorage: req.promptOverridesStorage,
    imgSource: req.imgSource,
    imgModel: req.imgModel,
    imgBaseUrl: req.imgBaseUrl,
    imgApiKey: req.imgApiKey,
    imgService: req.imgService,
    imgEndpointId: req.imgEndpointId,
    imgComfyWorkflow: req.imgComfyWorkflow,
    imgComfyWorkflowWithReference: req.imgComfyWorkflowWithReference,
    imgDefaults: req.imgDefaults,
    styleProfiles: req.styleProfiles,
    styleProfileId: req.styleProfileId,
    debugLog: req.debugLog,
    size: req.size,
  };
}

/**
 * Tokens that describe people / figures and conflict with the background plate's
 * "no humans, no figures, no characters" hard-negative. We strip art-style
 * tokens that mention any of these words so the prompt doesn't simultaneously
 * ask for and forbid people — that mixed signal pushes image models (notably
 * `google/gemini-2.5-flash-image`) to refuse with a text reply instead of bytes.
 */
const BACKGROUND_FIGURE_TOKEN_PATTERN =
  /\b(?:figures?|characters?|portraits?|faces?|persons?|people|humans?|sensual|cleavage|breasts?|nude|nudity|nsfw|anatomy)\b/i;

/**
 * Strip figure/character/NSFW tokens from a persona-level `artStyle` string so
 * it's safe to feed into a background-plate prompt. Splits on commas that are
 * NOT inside parentheses to keep parenthesised qualifiers intact.
 * Returns `undefined` when nothing usable remains.
 */
function sanitizeArtStyleForBackground(artStyle?: string): string | undefined {
  const trimmed = artStyle?.trim();
  if (!trimmed) return undefined;

  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of trimmed) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (current.trim()) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current);

  const kept = tokens.map((t) => t.trim()).filter((t) => t.length > 0 && !BACKGROUND_FIGURE_TOKEN_PATTERN.test(t));
  const joined = kept.join(", ").replace(/\s+/g, " ").trim();
  return joined.length > 0 ? joined : undefined;
}

async function buildChatBackgroundImagePrompt(req: BackgroundPromptInput): Promise<string> {
  if (req.promptOverride?.trim()) return req.promptOverride.trim().slice(0, 1500);
  const conditionParts = req.conditions
    ? [
        req.conditions.timeOfDay && `time of day: ${req.conditions.timeOfDay}`,
        req.conditions.weather && `weather: ${req.conditions.weather}`,
        req.conditions.season && `season: ${req.conditions.season}`,
      ].filter(Boolean)
    : [];
  const atmosphereLine = conditionParts.length ? ` Atmosphere — ${conditionParts.join(", ")}.` : "";

  const sanitizedArt = sanitizeArtStyleForBackground(req.artStyle);
  const styleHint = [sanitizedArt, req.setting].filter(Boolean).join(", ");
  const backgroundVars = {
    sceneDescription: `${req.backgroundPrompt.trim().replace(/\s+/g, " ")}${atmosphereLine}`,
    styleLine: styleHint ? `Style: ${styleHint}.` : "",
  };
  const rawBackgroundPrompt = req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_BACKGROUND, backgroundVars)
    : GAME_BACKGROUND.defaultBuilder(backgroundVars);
  const composition =
    " Visual-novel composition: wide 16:9 establishing shot; keep the lower third and bottom-center visually open and uncluttered so standing character sprites read at a natural scale. Place doors, signage, faces-on-posters, and story-critical props away from that overlay zone — stronger depth, architecture, and sky in mid-ground and upper frame.";
  const hardNegative =
    " Empty environment plate — no people, no figures, no characters, no humans, no faces, no text, no UI, no logos, no watermarks. Cinematic perspective, atmospheric, high detail, high quality.";
  return `${rawBackgroundPrompt}${composition}${hardNegative}`.slice(0, 1500);
}

export async function buildBackgroundImagePrompt(req: BackgroundGenRequest): Promise<string> {
  return (await buildBackgroundProviderPrompt(req)).prompt;
}

async function buildSceneIllustrationRawPrompt(req: SceneIllustrationGenRequest): Promise<string> {
  const styleHint = [req.artStyle, req.genre, req.setting].filter(Boolean).join(", ");
  const sceneTitle = sceneIllustrationContextTitle(req);
  const narrativePurpose = cleanSceneIllustrationContext(req.reason);
  const meaningfulNarrativePurpose = isGenericSceneMomentLabel(narrativePurpose) ? "" : narrativePurpose;
  const imagePromptInstructionsLine = req.imagePromptInstructions?.trim()
    ? `User image instructions: ${req.imagePromptInstructions.trim().replace(/\s+/g, " ").slice(0, 1200)}`
    : "";
  const continuityHint = req.sceneContinuity?.trim()
    ? `Scene continuity (mandatory — same place, era, and cast as the live scene; do not invent a different room, biome, or unrelated people): ${req.sceneContinuity.trim()}`
    : "";
  const scenePromptCombined = continuityHint ? `${req.prompt}\n${continuityHint}` : req.prompt;
  const sceneIllustrationVars = {
    sceneTitleLine: sceneTitle ? `${sceneTitle}.` : "",
    scenePrompt: scenePromptCombined,
    narrativePurposeLine: meaningfulNarrativePurpose ? `Narrative purpose: ${meaningfulNarrativePurpose}.` : "",
    charactersLine: req.characters?.length ? `Characters: ${req.characters.join(", ")}.` : "",
    referenceHandlingLine: req.referenceImages?.length
      ? "Reference handling: attached character reference images are available. Use them to match faces, hair, build, colors, and distinctive features for the referenced characters."
      : "",
    appearanceNotesBlock: req.characterDescriptions?.length
      ? `Appearance notes for visible characters without an attached reference image:\n- ${req.characterDescriptions.join("\n- ")}`
      : "",
    artDirectionLine: styleHint ? `Art direction: ${styleHint}.` : "",
    imagePromptInstructionsLine,
  };
  const rawIllustrationPrompt = req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_SCENE_ILLUSTRATION, sceneIllustrationVars)
    : GAME_SCENE_ILLUSTRATION.defaultBuilder(sceneIllustrationVars);
  const finalPrompt =
    imagePromptInstructionsLine && !rawIllustrationPrompt.includes(imagePromptInstructionsLine)
      ? `${rawIllustrationPrompt}\n${imagePromptInstructionsLine}`
      : rawIllustrationPrompt;
  return finalPrompt;
}

function sceneIllustrationContextTitle(req: SceneIllustrationGenRequest): string {
  const explicitTitle = cleanSceneIllustrationContext(req.title);
  if (explicitTitle) return explicitTitle;

  const visualReason = cleanSceneIllustrationContext(req.reason);
  if (visualReason && hasSceneSubjectCue(visualReason)) return visualReason;

  const slugTitle = cleanSceneIllustrationContext(req.slug?.replace(/[-_]+/g, " "));
  return slugTitle && hasSceneSubjectCue(slugTitle) ? slugTitle : "";
}

function cleanSceneIllustrationContext(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\b(?:major character moment|key emotional moment|major reveal|dramatic action scene|important scene|scene moment|narrative purpose)\s*[-:]\s*/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim()
    .slice(0, 180);
}

function hasSceneSubjectCue(value: string): boolean {
  return /\b(?:seeing|watching|looking|facing|meeting|holding|reaching|standing|kneeling|falling|fighting|duel|kiss|confession|reveal|transformation|mirror|uniform|door|character|protagonist|player|npc|self|room|hall|chamber|courtyard|battle|boss|monster|creature|arrival|entrance)\b/i.test(value);
}

function isGenericSceneMomentLabel(value: string): boolean {
  return /^(?:major character moment|key emotional moment|major reveal|dramatic action scene|important scene|scene moment)$/i.test(
    value,
  );
}

export async function buildSceneIllustrationProviderPrompt(
  req: SceneIllustrationGenRequest,
): Promise<CompiledGameImagePrompt> {
  if (req.promptOverride?.trim()) {
    return {
      prompt: req.promptOverride.trim(),
      negativePrompt: req.negativePromptOverride?.trim() || "",
    };
  }
  return compileGameImagePrompt(
    req,
    "illustration",
    await buildSceneIllustrationRawPrompt(req),
    2200,
    GAME_ILLUSTRATION_NEGATIVE_PROMPT,
  );
}

export async function buildSceneIllustrationImagePrompt(req: SceneIllustrationGenRequest): Promise<string> {
  return (await buildSceneIllustrationProviderPrompt(req)).prompt;
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

  const compiled = await buildBackgroundProviderPrompt(req);
  const prompt = compiled.prompt;
  const size = resolvedSize(req.size, DEFAULT_GAME_BACKGROUND_SIZE);
  req.debugLog?.(
    "[debug/game/image-generation] background request key=%s model=%s source=%s targetSize=%dx%d prompt:\n%s",
    key,
    req.imgModel,
    req.imgSource || req.imgService || "",
    size.width,
    size.height,
    prompt,
  );
  logger.info(
    '[game-asset-gen][bg] FINAL PROMPT (%d chars, target tag=%s, %dx%d): %s',
    prompt.length,
    tag,
    size.width,
    size.height,
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
        negativePrompt: compiled.negativePrompt || undefined,
        model: req.imgModel,
        width: size.width,
        height: size.height,
        imageEndpointId: req.imgEndpointId || undefined,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
        comfyWorkflowWithReference: req.imgComfyWorkflowWithReference || undefined,
        imageDefaults: req.imgDefaults ?? undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const image = await gameBackgroundImage(result, size);
    const finalTargetPath = generatedBackgroundPath(targetDir, key, image.ext);
    writeFileSync(finalTargetPath, image.buffer);

    buildAssetManifest();

    req.debugLog?.(
      "[debug/game/image-generation] background result key=%s bytes=%d tag=%s",
      key,
      image.buffer.byteLength,
      tag,
    );
    logger.info(
      '[game-asset-gen][bg] SUCCESS: generated key="%s" in %dms → tag=%s, file=%s, bytes=%d',
      key,
      Date.now() - startedAt,
      tag,
      finalTargetPath,
      image.buffer.byteLength,
    );
    return { tag, path: finalTargetPath, key, reusedCache: false, prompt };
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

/**
 * Generate a reusable Roleplay chat background and save it into the normal
 * user backgrounds folder so the Background agent can select it on later turns.
 * Returns the saved filename on success, or null on failure.
 */
export async function generateChatBackground(req: ChatBackgroundGenRequest): Promise<string | null> {
  const baseSlug = safeGeneratedAssetSlug(req.locationSlug || req.sceneDescription.slice(0, 80), {
    maxBytes: 160,
  });
  if (!baseSlug) return null;

  const slug = `generated-${baseSlug}`;
  if (!existsSync(CHAT_BACKGROUND_DIR)) mkdirSync(CHAT_BACKGROUND_DIR, { recursive: true });

  const existingPath = existingGeneratedBackgroundPath(CHAT_BACKGROUND_DIR, slug);
  if (existingPath) return basename(existingPath);

  const compiled = await buildBackgroundProviderPrompt(adaptChatBackgroundToProviderRequest(req));
  const prompt = compiled.prompt;
  const size = resolvedSize(req.size, DEFAULT_GAME_BACKGROUND_SIZE);
  req.debugLog?.(
    "[debug/background-agent/image-generation] request slug=%s model=%s source=%s targetSize=%dx%d prompt:\n%s",
    slug,
    req.imgModel,
    req.imgSource || req.imgService || "",
    size.width,
    size.height,
    prompt,
  );

  try {
    const result = await generateImage(
      req.imgModel,
      req.imgBaseUrl,
      req.imgApiKey,
      req.imgSource || req.imgService || "",
      {
        prompt,
        negativePrompt: compiled.negativePrompt || undefined,
        model: req.imgModel,
        width: size.width,
        height: size.height,
        imageEndpointId: req.imgEndpointId || undefined,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
        comfyWorkflowWithReference: req.imgComfyWorkflowWithReference || undefined,
        imageDefaults: req.imgDefaults ?? undefined,
      },
    );

    const image = await gameBackgroundImage(result, size);
    const filename = `${slug}.${image.ext}`;
    writeFileSync(join(CHAT_BACKGROUND_DIR, filename), image.buffer);

    const meta = readChatBackgroundMeta();
    meta[filename] = {
      originalName: `Generated: ${req.locationSlug || baseSlug}`,
      tags: chatBackgroundTags(req, baseSlug),
    };
    writeChatBackgroundMeta(meta);

    buildAssetManifest();
    logger.info('[background-agent] Generated roleplay background "%s"', filename);
    req.debugLog?.(
      "[debug/background-agent/image-generation] result slug=%s bytes=%d filename=%s",
      slug,
      image.buffer.byteLength,
      filename,
    );
    return filename;
  } catch (err) {
    logger.warn(err, '[background-agent] Failed to generate roleplay background "%s"', slug);
    return null;
  }
}

export async function generateSceneIllustration(req: SceneIllustrationGenRequest): Promise<string | null> {
  const slug = safeGeneratedAssetSlug(req.slug || req.reason || req.prompt.slice(0, 80) || "scene-illustration", {
    suffix: Date.now().toString(36),
  });
  const targetDir = join(GAME_ASSETS_DIR, "backgrounds", "illustrations");
  const tag = `backgrounds:illustrations:${slug}`;

  const compiled = await buildSceneIllustrationProviderPrompt(req);
  const prompt = compiled.prompt;
  const size = resolvedSize(req.size, DEFAULT_GAME_BACKGROUND_SIZE);
  req.debugLog?.(
    "[debug/game/image-generation] scene illustration request slug=%s model=%s source=%s targetSize=%dx%d refs=%d prompt:\n%s",
    slug,
    req.imgModel,
    req.imgSource || req.imgService || "",
    size.width,
    size.height,
    req.referenceImages?.length ?? 0,
    prompt,
  );

  try {
    const result = await generateImage(
      req.imgModel,
      req.imgBaseUrl,
      req.imgApiKey,
      req.imgSource || req.imgService || "",
      {
        prompt,
        negativePrompt: compiled.negativePrompt || undefined,
        model: req.imgModel,
        width: size.width,
        height: size.height,
        imageEndpointId: req.imgEndpointId || undefined,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
        comfyWorkflowWithReference: req.imgComfyWorkflowWithReference || undefined,
        imageDefaults: req.imgDefaults ?? undefined,
        referenceImages: req.referenceImages?.length ? req.referenceImages.slice(0, 4) : undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const image = await gameBackgroundImage(result, size);
    const targetPath = generatedBackgroundPath(targetDir, slug, image.ext);
    writeFileSync(targetPath, image.buffer);
    buildAssetManifest();

    logger.info('[game-asset-gen] Generated scene illustration "%s" -> tag: %s', slug, tag);
    req.debugLog?.(
      "[debug/game/image-generation] scene illustration result slug=%s bytes=%d tag=%s",
      slug,
      image.buffer.byteLength,
      tag,
    );
    return tag;
  } catch (err) {
    logger.warn(err, '[game-asset-gen] Failed to generate scene illustration "%s"', slug);
    return null;
  }
}
