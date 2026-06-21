import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GameNpc, ImageGenerationDefaultsProfile } from "@marinara-engine/shared";
import { DEFAULT_NPC_SPRITE_EXPRESSIONS } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import { generateImage } from "../image/image-generation.js";
import { removeNearWhiteBackgroundPng } from "../image/sprite-bg-removal.js";
import { getSharp } from "../image/sharp-loader.js";
import { hasExplicitOutfit } from "./npc-visual-description.js";

// Auto-generated NPC sprites are rendered on a solid white background (it's
// in the prompt). Match the default cleanup strength used by the manual
// `POST /api/sprites/generate-sheet` endpoint so users see the same result.
const NPC_SPRITE_BG_CLEANUP_STRENGTH = 50;

export interface NpcSpritePromptBundle {
  appearance: string;
  expressionSheet: string;
  fullBody: string;
}

export interface NpcSpriteGenerationRequest {
  chatId: string;
  npc: GameNpc;
  spriteId: string;
  expressions: string[];
  /** When set, used as the physical-description block instead of `npc.description` for sprite prompts. */
  appearanceOverride?: string | null;
  /**
   * Facial mood for the full-body `full_idle` render only (must match one of the normalized `expressions` when set).
   * When omitted, uses `neutral` if present in the sheet list else the first expression.
   */
  fullBodyExpression?: string | null;
  artStyle?: string | null;
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
  imgComfyWorkflowWithReference?: string | undefined;
  /** Connection-scoped ComfyUI / A1111 / NovelAI defaults (steps, cfg, sampler, …). */
  imgDefaults?: ImageGenerationDefaultsProfile | null;
  referenceImage?: string | null;
}

const SPRITES_ROOT = join(DATA_DIR, "sprites");

/** Absolute path to the full-body idle PNG for an NPC sprite folder. */
export function getNpcSpriteFullIdleFsPath(spriteId: string): string {
  return join(SPRITES_ROOT, spriteId, "full_idle.png");
}
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Recursively delete an NPC's sprite folder so the next generation pass
 * actually re-renders. `generateNpcSprites` short-circuits when it finds
 * `full_idle.png` already on disk, so deletion is the only way to force a
 * regeneration without touching SQLite. Used by the user-triggered
 * "Regenerate sprite" action.
 *
 * Returns `true` if a folder existed and was removed. Errors are logged and
 * swallowed because a missing folder is the desired end state regardless.
 */
export function deleteNpcSpriteFolder(spriteId: string): boolean {
  if (!spriteId) return false;
  try {
    const dir = join(SPRITES_ROOT, spriteId);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    logger.info("[npc-sprite-gen] Deleted sprite folder for regeneration: %s", spriteId);
    return true;
  } catch (err) {
    logger.warn(err, "[npc-sprite-gen] Failed to delete sprite folder for regeneration: %s", spriteId);
    return false;
  }
}

function sanitizeExpression(expression: string): string {
  return expression
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Same key normalization as expression filenames / metadata (exported for regenerate validation). */
export function sanitizeNpcSpriteExpression(expression: string): string {
  return sanitizeExpression(expression);
}

function normalizeExpressions(expressions: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const expression of expressions.length > 0 ? expressions : [...DEFAULT_NPC_SPRITE_EXPRESSIONS]) {
    const key = sanitizeExpression(expression);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized.slice(0, 6);
}

/** Normalized expression list (max 6) — same rules as sprite sheet generation. */
export function normalizeNpcSpriteExpressionList(expressions: string[]): string[] {
  return normalizeExpressions(expressions);
}

function resolveFullBodyIdleExpression(
  sheetExpressions: string[],
  explicit: string | null | undefined,
): string {
  if (sheetExpressions.length === 0) return "neutral";
  const key = explicit?.trim() ? sanitizeExpression(explicit) : "";
  if (key && sheetExpressions.includes(key)) return key;
  if (sheetExpressions.includes("neutral")) return "neutral";
  return sheetExpressions[0]!;
}

const NPC_SPRITE_VISUAL_CORE_MAX_CHARS = 1000;
const NPC_SPRITE_APPEARANCE_PROMPT_MAX_CHARS = 1600;

const NPC_SPRITE_VN_STYLE_LINE_WITH_OUTFIT =
  "VN game sprite style, cel-shaded character art, clean readable silhouette, consistent proportions, detailed costume,";
const NPC_SPRITE_VN_STYLE_LINE_PLAIN_CLOTHING =
  "VN game sprite style, cel-shaded character art, clean readable silhouette, consistent proportions, plain readable everyday clothing,";

function npcSpriteStyleLine(appearanceText: string): string {
  return hasExplicitOutfit(appearanceText)
    ? NPC_SPRITE_VN_STYLE_LINE_WITH_OUTFIT
    : NPC_SPRITE_VN_STYLE_LINE_PLAIN_CLOTHING;
}

const NPC_SPRITE_GENDER_RULE =
  "Match the described gender, age, build, hair, and features exactly — do not invent attributes.";

const NPC_SPRITE_APPEARANCE_BOILERPLATE_PATTERNS: RegExp[] = [
  /Match the described gender, age, build(?:, hair)?(?:, and features)? exactly — do not invent attributes\.?/gi,
  /Current location context:\s*[^.]+\./gi,
  /Art style:\s*[^.]+\./gi,
  /Character art style \(linework, shading, costume only — no scenery or backgrounds\):\s*[^.]+\./gi,
  /Subject is named [^(]+\(name is for reference only[^)]*\)\.?/gi,
];

function normalizeNpcSpriteAppearanceWhitespace(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/(?:\.\s*)+$/g, "")
    .replace(/^\.\s*/g, "")
    .trim();
}

/**
 * Strip known sprite appearance boilerplate so re-generation with a stored
 * `spritePrompt` (or a user-pasted full appearance block) stays idempotent.
 */
export function sanitizeNpcSpriteAppearanceSource(text: string, _npcName?: string | null): string {
  let cleaned = text.trim();
  if (!cleaned) return "";

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of NPC_SPRITE_APPEARANCE_BOILERPLATE_PATTERNS) {
      const next = cleaned.replace(pattern, " ");
      if (next !== cleaned) {
        cleaned = next;
        changed = true;
      }
    }
  }

  return normalizeNpcSpriteAppearanceWhitespace(cleaned);
}

export type NpcSpriteAppearancePurpose = "expression-sheet" | "full-body";

export interface BuildNpcSpriteAppearancePromptOptions {
  purpose?: NpcSpriteAppearancePurpose;
}

/**
 * Build a description block for sprite generation.
 *
 * Order matters: image models weight earlier tokens more heavily, so we
 * lead with the explicit physical description (which Character Tracker is
 * now instructed to start with apparent gender + age range — see
 * `agent-prompts.ts` → "character-tracker"). The display name comes last
 * and is explicitly framed as reference-only so a gender-ambiguous name
 * (e.g. "Greta Iron-Tooth") doesn't override stated traits.
 */
export function buildNpcSpriteAppearancePrompt(
  npc: GameNpc,
  artStyle?: string | null,
  appearanceOverride?: string | null,
  options?: BuildNpcSpriteAppearancePromptOptions,
): string {
  const purpose = options?.purpose ?? "expression-sheet";
  const fromOverride =
    typeof appearanceOverride === "string" && appearanceOverride.trim()
      ? appearanceOverride.trim()
      : null;
  const fromNpc = npc.description?.trim() || null;
  const rawDescription = (fromOverride ?? fromNpc) || `scene-relevant character`;
  const description = sanitizeNpcSpriteAppearanceSource(rawDescription) || `scene-relevant character`;

  const trimmedArtStyle = artStyle?.trim() || "";
  const artStyleLine =
    purpose === "full-body" && trimmedArtStyle
      ? `Character art style (linework, shading, costume only — no scenery or backgrounds): ${trimmedArtStyle}.`
      : trimmedArtStyle
        ? `Art style: ${trimmedArtStyle}.`
        : "";

  return [
    `${description.slice(0, NPC_SPRITE_VISUAL_CORE_MAX_CHARS)}.`,
    NPC_SPRITE_GENDER_RULE,
    purpose === "expression-sheet" && npc.location ? `Current location context: ${npc.location}.` : "",
    artStyleLine,
    `Subject is named ${npc.name} (name is for reference only, the description above is authoritative).`,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, NPC_SPRITE_APPEARANCE_PROMPT_MAX_CHARS);
}

/**
 * Full-body prompt for one sheet expression label (writes to `full_<expr>.png`).
 * Used when augmenting an existing sprite folder with per-emotion full-body renders.
 */
export function buildNpcSpriteFullBodyPromptForExpression(
  npc: GameNpc,
  artStyle: string | null | undefined,
  appearanceOverride: string | null | undefined,
  allExpressions: string[],
  moodExpression: string,
  hasExistingFullIdle: boolean,
): string {
  void allExpressions;
  const appearance = buildNpcSpriteAppearancePrompt(npc, artStyle ?? null, appearanceOverride ?? null, {
    purpose: "full-body",
  });
  const idleHint = hasExistingFullIdle
    ? `General stance, silhouette, proportions, and outfit should stay consistent with the existing full-body idle reference for this character set (same sprite folder on disk). `
    : "";
  return [
    `single full-body character sprite, one character only, entire body visible from head to toe, centered in frame,`,
    `solid white studio background, plain white void, no environment, no scenery,`,
    `${npcSpriteStyleLine(appearance)} ${appearance},`,
    idleHint,
    `facial expression and overall mood for this render (asset full_${moodExpression}): clearly readable as "${moodExpression}", body language consistent with that mood,`,
    `single character only, one face with a clearly readable "${moodExpression}" expression, no grid, no panel borders, no multiple faces,`,
    `standing idle game pose, no text, no watermark`,
  ].join(" ");
}

export function buildNpcSpritePromptBundle(
  req: NpcSpriteGenerationRequest,
  expressions: string[],
): NpcSpritePromptBundle {
  const appearance = buildNpcSpriteAppearancePrompt(req.npc, req.artStyle, req.appearanceOverride ?? null);
  const appearanceForFullBody = buildNpcSpriteAppearancePrompt(req.npc, req.artStyle, req.appearanceOverride ?? null, {
    purpose: "full-body",
  });
  const idleFace = resolveFullBodyIdleExpression(expressions, req.fullBodyExpression ?? null);
  const cols = 2;
  const rows = Math.ceil(expressions.length / cols);
  const expressionSheet = [
    `character expression sheet, strict ${cols} columns by ${rows} rows grid,`,
    `${cols * rows} equally sized square cells arranged in a perfectly uniform grid,`,
    `solid white background, thin straight lines separating each cell,`,
    `same character in every cell, consistent art style,`,
    `${npcSpriteStyleLine(appearance)}`,
    `expressions left-to-right top-to-bottom: ${expressions.join(", ")},`,
    appearance,
    `each cell shows head and shoulders portrait with a different facial expression,`,
    `all cells same size, perfectly aligned, no overlapping, no merged cells, no text, no labels, no numbers`,
  ].join(" ");

  const fullBody = [
    `single full-body character sprite, one character only, entire body visible from head to toe, centered in frame,`,
    `solid white studio background, plain white void, no environment, no scenery,`,
    `${npcSpriteStyleLine(appearanceForFullBody)} ${appearanceForFullBody},`,
    `facial expression and overall mood for this full-body idle reference (asset full_idle): clearly readable as "${idleFace}", body language consistent with that mood,`,
    `single character only, one face with a clearly readable "${idleFace}" expression, no grid, no panel borders, no multiple faces,`,
    `standing idle game pose, no text, no watermark`,
  ].join(" ");

  return { appearance, expressionSheet, fullBody };
}

async function saveSprite(spriteId: string, expression: string, base64: string): Promise<void> {
  const dir = join(SPRITES_ROOT, spriteId);
  ensureDir(dir);
  const filename = `${sanitizeExpression(expression)}.png`;
  await writeFile(join(dir, filename), Buffer.from(base64, "base64"));
}

async function generateExpressionSprites(
  req: NpcSpriteGenerationRequest,
  expressions: string[],
  expressionSheetPrompt: string,
): Promise<void> {
  const cols = 2;
  const rows = Math.ceil(expressions.length / cols);
  const cellSize = 512;
  const sheetWidth = cols * cellSize;
  const sheetHeight = rows * cellSize;

  const imageResult = await generateImage(req.imgModel, req.imgBaseUrl, req.imgApiKey, req.imgService || req.imgSource || "", {
    prompt: expressionSheetPrompt,
    model: req.imgModel,
    width: sheetWidth,
    height: sheetHeight,
    referenceImage: req.referenceImage || undefined,
    comfyWorkflow: req.imgComfyWorkflow || undefined,
    comfyWorkflowWithReference: req.imgComfyWorkflowWithReference || undefined,
    imageDefaults: req.imgDefaults ?? undefined,
  });

  let sheetBuffer: Buffer = Buffer.from(imageResult.base64, "base64");
  // Strip the solid white background to alpha so dialogue/scene compositing
  // doesn't render a hard white box around the character. We do this on the
  // full sheet before slicing so cell-edge pixels stay consistent.
  try {
    sheetBuffer = await removeNearWhiteBackgroundPng(sheetBuffer, NPC_SPRITE_BG_CLEANUP_STRENGTH);
  } catch (err) {
    logger.warn(err, "[npc-sprite-gen] Background removal failed for expression sheet; saving with original background");
  }
  const sharp = await getSharp();
  const metadata = await sharp(sheetBuffer).metadata();
  const imgWidth = metadata.width ?? sheetWidth;
  const imgHeight = metadata.height ?? sheetHeight;
  const cellWidth = Math.floor(imgWidth / cols);
  const cellHeight = Math.floor(imgHeight / rows);

  await Promise.all(
    expressions.map(async (expression, idx) => {
      const left = (idx % cols) * cellWidth;
      const top = Math.floor(idx / cols) * cellHeight;
      const cell = await sharp(sheetBuffer).extract({ left, top, width: cellWidth, height: cellHeight }).png().toBuffer();
      await saveSprite(req.spriteId, expression, cell.toString("base64"));
    }),
  );
}

type FullBodyImageRequestFields = Pick<
  NpcSpriteGenerationRequest,
  | "imgModel"
  | "imgBaseUrl"
  | "imgApiKey"
  | "imgService"
  | "imgSource"
  | "imgComfyWorkflow"
  | "imgComfyWorkflowWithReference"
  | "imgDefaults"
  | "referenceImage"
>;

async function generateAndSaveFullBodyPng(
  req: FullBodyImageRequestFields,
  spriteId: string,
  fileStem: string,
  prompt: string,
): Promise<void> {
  const targetWidth = 832;
  const targetHeight = 1216;
  const imageResult = await generateImage(req.imgModel, req.imgBaseUrl, req.imgApiKey, req.imgService || req.imgSource || "", {
    prompt,
    model: req.imgModel,
    width: targetWidth,
    height: targetHeight,
    referenceImage: req.referenceImage || undefined,
    comfyWorkflow: req.imgComfyWorkflow || undefined,
    comfyWorkflowWithReference: req.imgComfyWorkflowWithReference || undefined,
    imageDefaults: req.imgDefaults ?? undefined,
  });

  let spriteBuffer: Buffer = Buffer.from(imageResult.base64, "base64");
  const sharp = await getSharp();
  const metadata = await sharp(spriteBuffer).metadata();
  if (metadata.width && metadata.height && (metadata.width !== targetWidth || metadata.height !== targetHeight)) {
    spriteBuffer = await sharp(spriteBuffer).resize(targetWidth, targetHeight, { fit: "cover", position: "centre" }).png().toBuffer();
  }
  try {
    spriteBuffer = await removeNearWhiteBackgroundPng(spriteBuffer, NPC_SPRITE_BG_CLEANUP_STRENGTH);
  } catch (err) {
    logger.warn(err, "[npc-sprite-gen] Background removal failed for full-body sprite; saving with original background");
  }
  await saveSprite(spriteId, fileStem, spriteBuffer.toString("base64"));
}

async function generateFullBodyIdle(req: NpcSpriteGenerationRequest, fullBodyPrompt: string): Promise<void> {
  await generateAndSaveFullBodyPng(req, req.spriteId, "full_idle", fullBodyPrompt);
}

/** Request shape for per-emotion full-body augmentation (reuses image fields from sprite generation). */
export interface NpcFullBodyEmotionSetRequest {
  chatId: string;
  npc: GameNpc;
  spriteId: string;
  expressions: string[];
  appearanceOverride?: string | null;
  artStyle?: string | null;
  /** When true, replace existing `full_<expr>.png` files (not `full_idle.png`). */
  force?: boolean;
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
  imgComfyWorkflowWithReference?: string | undefined;
  imgDefaults?: ImageGenerationDefaultsProfile | null;
  referenceImage?: string | null;
}

export type NpcFullBodyEmotionSetResult = { ok: boolean; generated: number; skipped: number };

const inFlightNpcFullBodyEmotionSets = new Map<string, Promise<NpcFullBodyEmotionSetResult>>();

/**
 * For each normalized expression, ensure `full_<expr>.png` exists in `spriteId`
 * (head-and-shoulders sheet unchanged). Skips files that already exist unless
 * `force` is set. Does not modify `full_idle.png`.
 */
export async function generateNpcFullBodyEmotionSet(req: NpcFullBodyEmotionSetRequest): Promise<NpcFullBodyEmotionSetResult> {
  const spriteDir = join(SPRITES_ROOT, req.spriteId);
  if (!existsSync(spriteDir)) {
    logger.warn("[npc-sprite-gen] full-body emotion set: folder missing for %s", req.spriteId);
    return { ok: false, generated: 0, skipped: 0 };
  }

  const coalesceKey = `fullbody:${req.spriteId}`;
  const existing = inFlightNpcFullBodyEmotionSets.get(coalesceKey);
  if (existing) {
    logger.debug("[npc-sprite-gen] full-body emotion set already in-flight for %s — coalescing", req.spriteId);
    return existing;
  }

  const promise = (async (): Promise<NpcFullBodyEmotionSetResult> => {
    const normalized = normalizeNpcSpriteExpressionList(req.expressions);
    if (normalized.length === 0) {
      return { ok: false, generated: 0, skipped: 0 };
    }
    const hasFullIdle = existsSync(join(spriteDir, "full_idle.png"));
    const imgReq: FullBodyImageRequestFields = {
      imgModel: req.imgModel,
      imgBaseUrl: req.imgBaseUrl,
      imgApiKey: req.imgApiKey,
      imgService: req.imgService,
      imgSource: req.imgSource,
      imgComfyWorkflow: req.imgComfyWorkflow,
      imgComfyWorkflowWithReference: req.imgComfyWorkflowWithReference,
      imgDefaults: req.imgDefaults,
      referenceImage: req.referenceImage,
    };

    let generated = 0;
    let skipped = 0;
    for (const expr of normalized) {
      const fileStem = `full_${expr}`;
      const filename = `${sanitizeExpression(fileStem)}.png`;
      const outPath = join(spriteDir, filename);
      if (sanitizeExpression(fileStem) === "full_idle") {
        skipped += 1;
        continue;
      }
      if (!req.force && existsSync(outPath)) {
        skipped += 1;
        continue;
      }
      const prompt = buildNpcSpriteFullBodyPromptForExpression(
        req.npc,
        req.artStyle,
        req.appearanceOverride ?? null,
        normalized,
        expr,
        hasFullIdle,
      );
      try {
        await generateAndSaveFullBodyPng(imgReq, req.spriteId, fileStem, prompt);
        generated += 1;
        logger.info(
          "[npc-sprite-gen] Wrote full-body emotion %s for NPC %s (chat=%s, spriteId=%s)",
          fileStem,
          req.npc.name,
          req.chatId,
          req.spriteId,
        );
      } catch (err) {
        logger.warn(err, '[npc-sprite-gen] Failed full-body emotion "%s" for "%s"', fileStem, req.npc.name);
      }
    }
    return { ok: generated > 0 || skipped > 0, generated, skipped };
  })();

  inFlightNpcFullBodyEmotionSets.set(coalesceKey, promise);
  try {
    return await promise;
  } finally {
    inFlightNpcFullBodyEmotionSets.delete(coalesceKey);
  }
}

/**
 * In-flight sprite generations keyed by `spriteId`.
 *
 * Mirror of `inFlightNpcPortraits` in `game-asset-generation.ts`. Without
 * this, two concurrent triggers for the same NPC (e.g. user clicks
 * "Regenerate sprite" while the auto pipeline is already mid-flight, or two
 * simultaneous turns both observe the same `spriteStatus = "pending"` row)
 * would each spend a full image-API call and race on the on-disk PNG writes.
 *
 * The disk pre-check below (`existsSync(full_idle.png)`) stays outside the
 * coalescing map because it's both cheap and the common short-circuit; only
 * when we're actually going to call the image API do we register the
 * promise.
 */
const inFlightNpcSprites = new Map<string, Promise<{ ok: boolean; prompts?: NpcSpritePromptBundle }>>();

/** Inspect whether a sprite generation is already running for `spriteId`. */
export function getInFlightNpcSprite(
  spriteId: string,
): Promise<{ ok: boolean; prompts?: NpcSpritePromptBundle }> | undefined {
  return inFlightNpcSprites.get(spriteId);
}

export async function generateNpcSprites(
  req: NpcSpriteGenerationRequest,
): Promise<{ ok: boolean; prompts?: NpcSpritePromptBundle }> {
  const spriteDir = join(SPRITES_ROOT, req.spriteId);
  const existingFullIdle = join(spriteDir, "full_idle.png");
  if (existsSync(existingFullIdle)) {
    return { ok: true };
  }

  const inFlight = inFlightNpcSprites.get(req.spriteId);
  if (inFlight) {
    logger.debug(
      "[npc-sprite-gen] Sprite generation already in-flight for %s — coalescing",
      req.spriteId,
    );
    return inFlight;
  }

  const expressions = normalizeExpressions(req.expressions);
  const prompts = buildNpcSpritePromptBundle(req, expressions);
  const promise = (async () => {
    try {
      await generateExpressionSprites(req, expressions, prompts.expressionSheet);
      await generateFullBodyIdle(req, prompts.fullBody);
      const generated = existsSync(existingFullIdle) ? statSync(existingFullIdle).isFile() : false;
      logger.info("[npc-sprite-gen] Generated sprites for %s (%s)", req.npc.name, req.spriteId);
      return { ok: generated, prompts: generated ? prompts : undefined };
    } catch (err) {
      logger.warn(err, '[npc-sprite-gen] Failed to generate sprites for "%s"', req.npc.name);
      return { ok: false };
    }
  })();

  inFlightNpcSprites.set(req.spriteId, promise);
  try {
    return await promise;
  } finally {
    inFlightNpcSprites.delete(req.spriteId);
  }
}
