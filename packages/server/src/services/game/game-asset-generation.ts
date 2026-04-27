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

/** Map a game genre string to one of the canonical background folders. */
function genreToFolder(genre?: string): string {
  if (!genre) return "fantasy";
  const g = genre.toLowerCase();
  if (g.includes("sci") || g.includes("cyber") || g.includes("space") || g.includes("futur")) return "scifi";
  if (g.includes("modern") || g.includes("contemporary") || g.includes("urban") || g.includes("real")) return "modern";
  return "fantasy";
}

export interface BackgroundGenRequest {
  chatId: string;
  /** Short slug for the location, e.g. "dark-forest-clearing" */
  locationSlug: string;
  /** Scene description used as the image prompt. */
  sceneDescription: string;
  /** The game's genre/setting/tone for style guidance. */
  genre?: string;
  setting?: string;
  /** Unified art style prompt for visual consistency. */
  artStyle?: string;
  /** Connection credentials. */
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
}

/**
 * Generate a background image for a game location and add it to the
 * asset manifest. Returns the asset tag on success, or null on failure.
 */
export async function generateBackground(req: BackgroundGenRequest): Promise<string | null> {
  const slug = safeName(req.locationSlug);
  if (!slug) return null;

  const subcategory = genreToFolder(req.genre);
  const filename = `${slug}.png`;
  const targetDir = join(GAME_ASSETS_DIR, "backgrounds", subcategory);
  const targetPath = join(targetDir, filename);

  // Build asset tag: backgrounds:<category>:<slug>
  const tag = `backgrounds:${subcategory}:${slug}`;

  // Skip if already generated
  if (existsSync(targetPath)) {
    return tag;
  }

  const styleHint = [req.artStyle, req.genre, req.setting].filter(Boolean).join(", ");
  const prompt =
    `${req.sceneDescription}. ${styleHint ? `Style: ${styleHint}.` : ""} Wide-angle landscape, detailed environment, no characters, no text, no UI, game background art, high quality`.slice(
      0,
      1000,
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
        width: 1024,
        height: 576,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetPath, Buffer.from(result.base64, "base64"));

    // Rebuild manifest so the new tag is available immediately
    buildAssetManifest();

    logger.info(`[game-asset-gen] Generated background "${slug}" → tag: ${tag}`);
    return tag;
  } catch (err) {
    logger.warn(err, '[game-asset-gen] Failed to generate background "%s"', slug);
    return null;
  }
}
