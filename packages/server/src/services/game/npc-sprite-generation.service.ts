import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GameNpc } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import { generateImage } from "../image/image-generation.js";
import { removeNearWhiteBackgroundPng } from "../image/sprite-bg-removal.js";

// Auto-generated NPC sprites are rendered on a solid white background (it's
// in the prompt). Match the default cleanup strength used by the manual
// `POST /api/sprites/generate-sheet` endpoint so users see the same result.
const NPC_SPRITE_BG_CLEANUP_STRENGTH = 50;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpFn = any;
let sharpModule: SharpFn | null = null;

async function getSharp(): Promise<SharpFn> {
  if (sharpModule) return sharpModule;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - optional native dependency; sprite generation can fail gracefully.
  const mod = await import("sharp");
  sharpModule = (mod.default ?? mod) as SharpFn;
  return sharpModule;
}

export interface NpcSpriteGenerationRequest {
  chatId: string;
  npc: GameNpc;
  spriteId: string;
  expressions: string[];
  artStyle?: string | null;
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
  referenceImage?: string | null;
}

const SPRITES_ROOT = join(DATA_DIR, "sprites");
const DEFAULT_NPC_SPRITE_EXPRESSIONS = ["neutral", "happy", "sad", "angry", "surprised", "thinking"];

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

function normalizeExpressions(expressions: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const expression of expressions.length > 0 ? expressions : DEFAULT_NPC_SPRITE_EXPRESSIONS) {
    const key = sanitizeExpression(expression);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized.slice(0, 6);
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
function buildAppearancePrompt(npc: GameNpc, artStyle?: string | null): string {
  const description = npc.description?.trim() || `scene-relevant character`;
  return [
    `${description}.`,
    `Match the described gender, age, build, hair, and features exactly — do not invent attributes.`,
    npc.location ? `Current location context: ${npc.location}.` : "",
    artStyle ? `Art style: ${artStyle}.` : "",
    `Subject is named ${npc.name} (name is for reference only, the description above is authoritative).`,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1400);
}

async function saveSprite(spriteId: string, expression: string, base64: string): Promise<void> {
  const dir = join(SPRITES_ROOT, spriteId);
  ensureDir(dir);
  const filename = `${sanitizeExpression(expression)}.png`;
  await writeFile(join(dir, filename), Buffer.from(base64, "base64"));
}

async function generateExpressionSprites(req: NpcSpriteGenerationRequest, expressions: string[]): Promise<void> {
  const cols = 2;
  const rows = Math.ceil(expressions.length / cols);
  const cellSize = 512;
  const sheetWidth = cols * cellSize;
  const sheetHeight = rows * cellSize;
  const appearance = buildAppearancePrompt(req.npc, req.artStyle);
  const prompt = [
    `character expression sheet, strict ${cols} columns by ${rows} rows grid,`,
    `${cols * rows} equally sized square cells arranged in a perfectly uniform grid,`,
    `solid white background, thin straight lines separating each cell,`,
    `same character in every cell, consistent art style,`,
    `expressions left-to-right top-to-bottom: ${expressions.join(", ")},`,
    appearance,
    `each cell shows head and shoulders portrait with a different facial expression,`,
    `all cells same size, perfectly aligned, no overlapping, no merged cells, no text, no labels, no numbers`,
  ].join(" ");

  const imageResult = await generateImage(req.imgModel, req.imgBaseUrl, req.imgApiKey, req.imgService || req.imgSource || "", {
    prompt,
    model: req.imgModel,
    width: sheetWidth,
    height: sheetHeight,
    referenceImage: req.referenceImage || undefined,
    comfyWorkflow: req.imgComfyWorkflow || undefined,
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

async function generateFullBodyIdle(req: NpcSpriteGenerationRequest): Promise<void> {
  const appearance = buildAppearancePrompt(req.npc, req.artStyle);
  const prompt = [
    `single full-body character sprite, one character only, entire body visible from head to toe, centered in frame,`,
    `solid white studio background, ${appearance},`,
    `general standing idle game pose, no text, no watermark`,
  ].join(" ");
  const targetWidth = 832;
  const targetHeight = 1216;
  const imageResult = await generateImage(req.imgModel, req.imgBaseUrl, req.imgApiKey, req.imgService || req.imgSource || "", {
    prompt,
    model: req.imgModel,
    width: targetWidth,
    height: targetHeight,
    referenceImage: req.referenceImage || undefined,
    comfyWorkflow: req.imgComfyWorkflow || undefined,
  });

  let spriteBuffer: Buffer = Buffer.from(imageResult.base64, "base64");
  const sharp = await getSharp();
  const metadata = await sharp(spriteBuffer).metadata();
  if (metadata.width && metadata.height && (metadata.width !== targetWidth || metadata.height !== targetHeight)) {
    spriteBuffer = await sharp(spriteBuffer).resize(targetWidth, targetHeight, { fit: "cover", position: "centre" }).png().toBuffer();
  }
  // Same VN-overlay reasoning as the expression sheet: drop the white studio
  // backdrop to alpha so the standing pose can be layered onto a scene.
  try {
    spriteBuffer = await removeNearWhiteBackgroundPng(spriteBuffer, NPC_SPRITE_BG_CLEANUP_STRENGTH);
  } catch (err) {
    logger.warn(err, "[npc-sprite-gen] Background removal failed for full-body sprite; saving with original background");
  }
  await saveSprite(req.spriteId, "full_idle", spriteBuffer.toString("base64"));
}

export async function generateNpcSprites(req: NpcSpriteGenerationRequest): Promise<boolean> {
  const spriteDir = join(SPRITES_ROOT, req.spriteId);
  const existingFullIdle = join(spriteDir, "full_idle.png");
  if (existsSync(existingFullIdle)) {
    return true;
  }

  const expressions = normalizeExpressions(req.expressions);
  try {
    await generateExpressionSprites(req, expressions);
    await generateFullBodyIdle(req);
    const generated = existsSync(existingFullIdle) ? statSync(existingFullIdle).isFile() : false;
    logger.info("[npc-sprite-gen] Generated sprites for %s (%s)", req.npc.name, req.spriteId);
    return generated;
  } catch (err) {
    logger.warn(err, '[npc-sprite-gen] Failed to generate sprites for "%s"', req.npc.name);
    return false;
  }
}
