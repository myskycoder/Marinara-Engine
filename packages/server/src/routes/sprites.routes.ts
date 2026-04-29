// ──────────────────────────────────────────────
// Routes: Character Sprite Upload, List & Serving
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, createReadStream, readdirSync, unlinkSync, statSync, readFileSync } from "fs";
import { writeFile, mkdir, readdir, unlink } from "fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { DATA_DIR } from "../utils/data-dir.js";
import { removeNearWhiteBackgroundPng } from "../services/image/sprite-bg-removal.js";
import { getSharp } from "../services/image/sharp-loader.js";

async function getSpriteCapabilities() {
  try {
    await getSharp();
    return {
      imageProcessingAvailable: true,
      spriteGenerationAvailable: true,
      backgroundRemovalAvailable: true,
      reason: null as string | null,
    };
  } catch (error) {
    return {
      imageProcessingAvailable: false,
      spriteGenerationAvailable: false,
      backgroundRemovalAvailable: false,
      reason: error instanceof Error ? error.message : "Image processing is unavailable on this platform.",
    };
  }
}
import { generateImage } from "../services/image/image-generation.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";

const SPRITES_ROOT = join(DATA_DIR, "sprites");
const ROUTE_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_PUBLIC_DIR = resolve(ROUTE_DIR, "../../../client/public");
const CLIENT_DIST_DIR = resolve(ROUTE_DIR, "../../../client/dist");

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function isOpenAIGptImageModel(model?: string): boolean {
  return !!model && /^gpt-image-(?:1|1\.5|2)(?:$|-)/i.test(model.trim());
}

function looksLikeBase64(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length < 32) return false;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed);
}

function extractBase64ImageData(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    if (comma < 0) return "";
    return trimmed.slice(comma + 1);
  }

  return trimmed;
}

function normalizeLocalImagePath(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (value.startsWith("/")) return value.split("?")[0] ?? value;
  try {
    const url = new URL(value);
    return url.pathname;
  } catch {
    return value.split("?")[0] ?? value;
  }
}

function readSafeNestedFile(root: string, pathSegments: string[]): string | undefined {
  if (pathSegments.length === 0) return undefined;
  const decoded = pathSegments.map((segment) => decodeURIComponent(segment));
  if (
    decoded.some((segment) => !segment || segment.includes("..") || segment.includes("/") || segment.includes("\\"))
  ) {
    return undefined;
  }
  const diskPath = resolve(root, ...decoded);
  const normalizedRoot = resolve(root);
  const relativePath = relative(normalizedRoot, diskPath);
  if (relativePath.startsWith("..") || relativePath === "" || isAbsolute(relativePath)) return undefined;
  try {
    if (!existsSync(diskPath)) return undefined;
    return readFileSync(diskPath).toString("base64");
  } catch {
    return undefined;
  }
}

/** Accepts data URL, raw base64, or local avatar/sprite URL and returns base64 if resolvable. */
function resolveReferenceImageBase64(input?: string): string | undefined {
  if (!input?.trim()) return undefined;
  const value = input.trim();

  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    if (comma < 0) return undefined;
    const b64 = value.slice(comma + 1);
    return looksLikeBase64(b64) ? b64 : undefined;
  }

  const path = normalizeLocalImagePath(value);
  if (path.startsWith("/api/avatars/file/")) {
    const filenameRaw = path.split("/").pop();
    if (!filenameRaw) return undefined;
    const filename = decodeURIComponent(filenameRaw);
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return undefined;
    try {
      const diskPath = join(DATA_DIR, "avatars", filename);
      if (!existsSync(diskPath)) return undefined;
      return readFileSync(diskPath).toString("base64");
    } catch {
      return undefined;
    }
  }

  if (path.startsWith("/api/avatars/npc/")) {
    const parts = path.split("/").filter(Boolean);
    const chatId = parts[3] ? decodeURIComponent(parts[3]) : "";
    const filename = parts[4] ? decodeURIComponent(parts[4]) : "";
    if (!chatId || !filename) return undefined;
    if (
      chatId.includes("..") ||
      chatId.includes("/") ||
      chatId.includes("\\") ||
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      return undefined;
    }
    try {
      const diskPath = join(DATA_DIR, "avatars", "npc", chatId, filename);
      if (!existsSync(diskPath)) return undefined;
      return readFileSync(diskPath).toString("base64");
    } catch {
      return undefined;
    }
  }

  if (path.startsWith("/sprites/")) {
    const segments = path.split("/").filter(Boolean).slice(1);
    return (
      readSafeNestedFile(join(CLIENT_PUBLIC_DIR, "sprites"), segments) ??
      readSafeNestedFile(join(CLIENT_DIST_DIR, "sprites"), segments)
    );
  }

  if (path.startsWith("/api/sprites/")) {
    const parts = path.split("/").filter(Boolean);
    const characterId = parts[2] ? decodeURIComponent(parts[2]) : "";
    const filename = parts[4] ? decodeURIComponent(parts[4]) : "";
    if (!characterId || !filename) return undefined;
    return readSafeNestedFile(SPRITES_ROOT, [characterId, filename]);
  }

  if (looksLikeBase64(value)) return value;
  return undefined;
}

export async function spritesRoutes(app: FastifyInstance) {
  app.get("/capabilities", async () => getSpriteCapabilities());

  /**
   * GET /api/sprites/:characterId
   * List all sprite expressions for a character.
   */
  app.get<{ Params: { characterId: string } }>("/:characterId", async (req, reply) => {
    const { characterId } = req.params;
    const dir = join(SPRITES_ROOT, characterId);
    ensureDir(dir);

    try {
      const files = readdirSync(dir);
      const sprites = files
        .filter((f) => /\.(png|jpg|jpeg|gif|webp|avif|svg)$/i.test(f))
        .map((f) => {
          const ext = extname(f);
          const expression = f.slice(0, -ext.length);
          const mtime = statSync(join(dir, f)).mtimeMs;
          return {
            expression,
            filename: f,
            url: `/api/sprites/${characterId}/file/${encodeURIComponent(f)}?v=${Math.floor(mtime)}`,
          };
        });
      return sprites;
    } catch {
      return [];
    }
  });

  /**
   * POST /api/sprites/:characterId
   * Upload a sprite image for a given expression.
   * Body: { expression: string, image: string (base64 data URL) }
   */
  app.post<{ Params: { characterId: string } }>("/:characterId", async (req, reply) => {
    const { characterId } = req.params;

    // Prevent path traversal
    if (characterId.includes("..") || characterId.includes("/") || characterId.includes("\\")) {
      return reply.status(400).send({ error: "Invalid character ID" });
    }

    const body = req.body as { expression?: string; image?: string };

    if (!body.expression?.trim()) {
      return reply.status(400).send({ error: "Expression label is required" });
    }
    if (!body.image) {
      return reply.status(400).send({ error: "No image data provided" });
    }

    const expression = body.expression
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_");

    // Parse base64
    let base64 = body.image;
    let ext = "png";
    if (base64.startsWith("data:")) {
      const match = base64.match(/^data:image\/([\w+]+);base64,/);
      if (match?.[1]) {
        ext = match[1].replace("+xml", "");
        base64 = base64.slice(base64.indexOf(",") + 1);
      }
    }

    const dir = join(SPRITES_ROOT, characterId);
    await mkdir(dir, { recursive: true });

    const filename = `${expression}.${ext}`;
    const filepath = join(dir, filename);
    await writeFile(filepath, Buffer.from(base64, "base64"));

    const mtime = statSync(filepath).mtimeMs;
    return {
      expression,
      filename,
      url: `/api/sprites/${characterId}/file/${encodeURIComponent(filename)}?v=${Math.floor(mtime)}`,
    };
  });

  /**
   * DELETE /api/sprites/:characterId/:expression
   * Remove a sprite expression image.
   */
  app.delete<{ Params: { characterId: string; expression: string } }>(
    "/:characterId/:expression",
    async (req, reply) => {
      const { characterId, expression } = req.params;

      // Prevent path traversal
      if (characterId.includes("..") || characterId.includes("/") || characterId.includes("\\")) {
        return reply.status(400).send({ error: "Invalid character ID" });
      }

      const dir = join(SPRITES_ROOT, characterId);

      if (!existsSync(dir)) {
        return reply.status(404).send({ error: "No sprites found" });
      }

      const files = readdirSync(dir);
      const match = files.find((f) => {
        const ext = extname(f);
        return f.slice(0, -ext.length) === expression;
      });

      if (!match) {
        return reply.status(404).send({ error: "Expression not found" });
      }

      unlinkSync(join(dir, match));
      return reply.status(204).send();
    },
  );

  /**
   * GET /api/sprites/:characterId/file/:filename
   * Serve a sprite image file.
   */
  app.get<{ Params: { characterId: string; filename: string } }>("/:characterId/file/:filename", async (req, reply) => {
    const { characterId, filename } = req.params;

    // Prevent path traversal
    if (filename.includes("..") || filename.includes("/") || characterId.includes("..")) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = join(SPRITES_ROOT, characterId, filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".avif": "image/avif",
      ".svg": "image/svg+xml",
    };

    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", mimeMap[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(stream);
  });

  /**
   * POST /api/sprites/generate-sheet
   * Generate a sprite sheet via image generation, then slice it into individual cells.
   * Body: { connectionId, appearance, referenceImages?, expressions: string[], cols, rows }
   * Returns: { sheetBase64, cells: [{ expression, base64 }] }
   */
  app.post("/generate-sheet", async (req, reply) => {
    const body = req.body as {
      connectionId?: string;
      appearance?: string;
      referenceImage?: string;
      referenceImages?: string[];
      expressions?: string[];
      cols?: number;
      rows?: number;
      spriteType?: "expressions" | "full-body";
      noBackground?: boolean;
      cleanupStrength?: number;
    };

    if (!body.connectionId) {
      return reply.status(400).send({ error: "connectionId is required" });
    }
    if (!body.appearance?.trim()) {
      return reply.status(400).send({ error: "appearance description is required" });
    }
    if (!body.expressions || body.expressions.length === 0) {
      return reply.status(400).send({ error: "At least one expression is required" });
    }

    const cols = body.cols ?? 2;
    const rows = body.rows ?? 3;
    const expressions = body.expressions.slice(0, cols * rows);
    const cleanupStrength = Number.isFinite(body.cleanupStrength) ? Number(body.cleanupStrength) : 50;

    // Resolve image generation connection
    const connections = createConnectionsStorage(app.db);
    const conn = await connections.getWithKey(body.connectionId);
    if (!conn) {
      return reply.status(404).send({ error: "Image generation connection not found or could not be decrypted" });
    }

    const imgModel = conn.model || "";
    const imgBaseUrl = conn.baseUrl || "https://image.pollinations.ai";
    const imgApiKey = conn.apiKey || "";
    const imgSource = (conn as any).imageGenerationSource || imgModel;
    const imgServiceHint = conn.imageService || imgSource;

    // Build the prompt for an expression sheet or full-body pose sheet.
    const expressionList = expressions.join(", ");
    const singlePortrait = body.spriteType !== "full-body" && expressions.length === 1 && cols === 1 && rows === 1;
    const singleFullBody = body.spriteType === "full-body" && expressions.length === 1 && cols === 1 && rows === 1;
    const generateExpressionsIndividually =
      body.spriteType !== "full-body" && !singlePortrait && isOpenAIGptImageModel(imgModel);
    let prompt = "";
    if (singleFullBody) {
      prompt = [
        `single full-body character sprite, one character only,`,
        `entire body visible from head to toe, centered in frame, no cropping,`,
        `solid white studio background,`,
        `${body.appearance?.trim() || ""},`,
        `pose/action: ${expressions[0] ?? "idle"},`,
        `anime/game sprite style, consistent character design,`,
        `no grid, no panel borders, no text, no labels, no watermark`,
      ].join(" ");
    } else if (body.spriteType === "full-body") {
      prompt = [
        `full-body character sprite sheet with EXACTLY ${expressions.length} total pose cells,`,
        `strict ${cols} columns by ${rows} rows grid, no extra rows, no extra columns, no extra panels,`,
        `${expressions.length} equally sized tall cells arranged in a perfectly uniform grid,`,
        `solid white background, thin straight lines separating each cell,`,
        `same character in every cell, consistent art style and outfit,`,
        `poses left-to-right top-to-bottom: ${expressionList},`,
        `${body.appearance?.trim() || ""},`,
        `each cell shows the entire body from head to toe, centered, no cropping,`,
        `leave enough whitespace around each full-body pose so feet, hair, weapons, and hands are fully visible,`,
        `all cells same size, perfectly aligned, no overlapping, no merged cells,`,
        `the final image must stop after the ${rows} row; do not draw a bonus row or bonus poses,`,
        `no text, no labels, no numbers`,
      ].join(" ");
    } else if (singlePortrait) {
      prompt = [
        `single character portrait sprite, one character only,`,
        `head and shoulders portrait, centered in frame, no cropping,`,
        `solid white studio background,`,
        `${body.appearance?.trim() || ""},`,
        `facial expression: ${expressions[0] ?? "neutral"},`,
        `anime/game sprite style, consistent character design,`,
        `no grid, no panel borders, no text, no labels, no watermark`,
      ].join(" ");
    } else {
      prompt = [
        `character expression sheet with EXACTLY ${expressions.length} total portrait cells,`,
        `strict ${cols} columns by ${rows} rows grid, no extra rows, no extra columns, no extra panels,`,
        `${expressions.length} equally sized square cells arranged in a perfectly uniform grid,`,
        `solid white background, thin straight lines separating each cell,`,
        `same character in every cell, consistent art style,`,
        `expressions left-to-right top-to-bottom: ${expressionList},`,
        `${body.appearance?.trim() || ""},`,
        `each cell shows head and shoulders portrait with a different facial expression,`,
        `all cells same size, perfectly aligned, no overlapping, no merged cells,`,
        `the final image must stop after the ${rows} row; do not draw a fourth row or bonus expressions,`,
        `no text, no labels, no numbers`,
      ].join(" ");
    }

    // Parse reference images to raw base64 (supports data URL, raw base64, or local avatar URL)
    const rawRefs = body.referenceImages?.length
      ? body.referenceImages
      : body.referenceImage
        ? [body.referenceImage]
        : [];
    const resolvedRefs = rawRefs.map(resolveReferenceImageBase64).filter((r): r is string => !!r);

    try {
      if (generateExpressionsIndividually) {
        const cells: Array<{ expression: string; base64: string }> = [];
        const failedExpressions: Array<{ expression: string; error: string }> = [];

        for (const expression of expressions) {
          try {
            const expressionPrompt = [
              `single character portrait sprite, one character only,`,
              `head and shoulders portrait, centered in frame, no cropping,`,
              `solid white studio background,`,
              `${body.appearance?.trim() || ""},`,
              `facial expression: ${expression},`,
              `anime/game sprite style, consistent character design,`,
              `no grid, no panel borders, no text, no labels, no watermark`,
            ].join(" ");

            const targetSize = 1024;
            const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, imgServiceHint, {
              prompt: expressionPrompt,
              model: imgModel,
              width: targetSize,
              height: targetSize,
              referenceImage: resolvedRefs[0],
              referenceImages: resolvedRefs.length > 1 ? resolvedRefs : undefined,
              comfyWorkflow: conn.comfyuiWorkflow || undefined,
            });

            let spriteBuffer: Buffer = Buffer.from(imageResult.base64, "base64");
            const sharp = await getSharp();
            const meta = await sharp(spriteBuffer).metadata();
            if (meta.width && meta.height && (meta.width !== targetSize || meta.height !== targetSize)) {
              spriteBuffer = await sharp(spriteBuffer)
                .resize(targetSize, targetSize, { fit: "cover", position: "centre" })
                .png()
                .toBuffer();
            }

            if (body.noBackground) {
              try {
                spriteBuffer = await removeNearWhiteBackgroundPng(spriteBuffer, cleanupStrength);
              } catch (bgErr) {
                app.log.warn(bgErr, "Expression sprite background cleanup failed; continuing with original image");
              }
            }

            cells.push({
              expression,
              base64: spriteBuffer.toString("base64"),
            });
          } catch (expressionErr: any) {
            const msg = String(expressionErr?.message || "Generation failed")
              .replace(/<[^>]*>/g, "")
              .slice(0, 300);
            app.log.warn(expressionErr, `Expression sprite "${expression}" generation failed; skipping`);
            failedExpressions.push({ expression, error: msg });
          }
        }

        if (cells.length === 0) {
          return reply.status(500).send({
            error: "All expression generations failed",
            failedExpressions,
          });
        }

        return {
          sheetBase64: "",
          cells,
          ...(failedExpressions.length > 0 ? { failedExpressions } : {}),
        };
      }

      // Generate the sheet image.
      // Size the canvas so the grid aspect ratio matches the requested cells;
      // full-body sheets use taller cells so poses have room from head to toe.
      const cellWidthHint = 512;
      const cellHeightHint = body.spriteType === "full-body" ? 768 : 512;
      const sheetWidth = cols * cellWidthHint;
      const sheetHeight = rows * cellHeightHint;

      const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, imgServiceHint, {
        prompt,
        model: imgModel,
        width: sheetWidth,
        height: sheetHeight,
        referenceImage: resolvedRefs[0],
        referenceImages: resolvedRefs.length > 1 ? resolvedRefs : undefined,
        comfyWorkflow: conn.comfyuiWorkflow || undefined,
      });

      // Decode the generated image
      let sheetBuffer: Buffer = Buffer.from(imageResult.base64, "base64");
      const sharp = await getSharp();
      let metadata = await sharp(sheetBuffer).metadata();

      // If noBackground is requested, remove near-white background after generation.
      // Keep this resilient: if cleanup fails, continue with the original image rather than throwing.
      if (body.noBackground) {
        const originalSheetBuffer = sheetBuffer;
        try {
          sheetBuffer = await removeNearWhiteBackgroundPng(sheetBuffer, cleanupStrength);
          metadata = await sharp(sheetBuffer).metadata();
        } catch (bgErr) {
          app.log.warn(bgErr, "Sprite background cleanup failed; continuing with original image");
          sheetBuffer = originalSheetBuffer;
          metadata = await sharp(sheetBuffer).metadata();
        }
      }

      const imgWidth = metadata.width ?? (cols <= 2 ? 1024 : 1536);
      const imgHeight = metadata.height ?? (rows <= 2 ? 1024 : 1536);

      const cellWidth = Math.floor(imgWidth / cols);
      const cellHeight = Math.floor(imgHeight / rows);

      const cellPromises: Promise<{ expression: string; base64: string }>[] = [];

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          if (idx >= expressions.length) break;

          const expression = expressions[idx]!;
          const left = col * cellWidth;
          const top = row * cellHeight;

          cellPromises.push(
            sharp(sheetBuffer)
              .extract({ left, top, width: cellWidth, height: cellHeight })
              .png()
              .toBuffer()
              .then((buf: Buffer) => ({
                expression,
                base64: buf.toString("base64"),
              })),
          );
        }
      }

      const cells = await Promise.all(cellPromises);

      return {
        sheetBase64: sheetBuffer.toString("base64"),
        cells,
      };
    } catch (err: any) {
      app.log.error(err, "Sprite sheet generation failed");
      return reply.status(500).send({
        error: err?.message || "Sprite sheet generation failed",
      });
    }
  });

  /**
   * POST /api/sprites/cleanup
   * Apply near-white background cleanup to already generated sprites.
   * Body: { cells: [{ expression, base64 }], cleanupStrength }
   * Returns: { cells: [{ expression, base64 }] }
   */
  app.post("/cleanup", async (req, reply) => {
    const body = req.body as {
      cells?: Array<{ expression?: string; base64?: string }>;
      cleanupStrength?: number;
    };

    if (!body.cells || body.cells.length === 0) {
      return reply.status(400).send({ error: "At least one cell is required" });
    }

    const cleanupStrength = Number.isFinite(body.cleanupStrength) ? Number(body.cleanupStrength) : 50;

    try {
      const processed = await Promise.all(
        body.cells.map(async (cell) => {
          const base64 = extractBase64ImageData(cell.base64 ?? "");
          if (!base64 || !looksLikeBase64(base64)) {
            throw new Error(`Invalid base64 image for expression: ${cell.expression ?? "unknown"}`);
          }

          const inputBuffer = Buffer.from(base64, "base64");
          const outputBuffer = await removeNearWhiteBackgroundPng(inputBuffer, cleanupStrength);

          return {
            expression: cell.expression ?? "",
            base64: outputBuffer.toString("base64"),
          };
        }),
      );

      return { cells: processed };
    } catch (err: any) {
      app.log.error(err, "Sprite cleanup failed");
      return reply.status(500).send({
        error: err?.message || "Sprite cleanup failed",
      });
    }
  });
}
