const IMAGE_COMPRESSION_EDGE = 1536;
const IMAGE_COMPRESSION_SOURCE_BYTES = 1.5 * 1024 * 1024;
const IMAGE_COMPRESSION_TARGET_BYTES = 4 * 1024 * 1024;

const COMPRESSION_ATTEMPTS = [
  { edge: IMAGE_COMPRESSION_EDGE, quality: 0.82 },
  { edge: 1280, quality: 0.76 },
  { edge: 1024, quality: 0.68 },
];

export interface PreparedImageAttachment {
  type: string;
  data: string;
  name: string;
  resized: boolean;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

function replaceExtension(name: string, extension: string): string {
  const trimmed = name.trim() || `image.${extension}`;
  return trimmed.includes(".") ? trimmed.replace(/\.[^.]+$/, `.${extension}`) : `${trimmed}.${extension}`;
}

function fitWithinEdge(width: number, height: number, edge: number): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= edge) return { width, height };
  const scale = edge / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function createCanvasSurface(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to compress image attachment"));
        }
      },
      type,
      quality,
    );
  });
}

async function renderBitmapAsJpeg(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const size = fitWithinEdge(bitmap.width, bitmap.height, edge);
  const canvas = createCanvasSurface(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to prepare image attachment");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  return canvasToBlob(canvas, "image/jpeg", quality);
}

export async function prepareImageAttachment(blob: Blob, displayName = "image"): Promise<PreparedImageAttachment> {
  const originalType = blob.type.toLowerCase();
  const shouldAlwaysConvert = originalType === "image/gif";
  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(blob);
    const shouldCompress =
      shouldAlwaysConvert ||
      blob.size > IMAGE_COMPRESSION_SOURCE_BYTES ||
      bitmap.width > IMAGE_COMPRESSION_EDGE ||
      bitmap.height > IMAGE_COMPRESSION_EDGE;

    if (!shouldCompress) {
      return {
        type: blob.type || "image/png",
        data: await readBlobAsDataUrl(blob),
        name: displayName,
        resized: false,
      };
    }

    let compressed: Blob | null = null;
    for (const attempt of COMPRESSION_ATTEMPTS) {
      compressed = await renderBitmapAsJpeg(bitmap, attempt.edge, attempt.quality);
      if (compressed.size <= IMAGE_COMPRESSION_TARGET_BYTES) break;
    }

    if (!compressed || compressed.size > IMAGE_COMPRESSION_TARGET_BYTES) {
      throw new Error("Image attachment remains too large after compression");
    }

    return {
      type: "image/jpeg",
      data: await readBlobAsDataUrl(compressed),
      name: replaceExtension(displayName, "jpg"),
      resized: true,
    };
  } finally {
    bitmap?.close();
  }
}
