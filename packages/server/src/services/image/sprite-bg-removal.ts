// ──────────────────────────────────────────────
// Near-white background removal for generated sprites/portraits.
//
// Image-generation models that aren't aware of transparent canvases tend to
// render characters on a "solid white studio background" (literally part of
// our prompt). For VN-style overlay sprites we want the white pixels stripped
// to alpha so the character can sit on top of the scene background instead of
// a hard white box.
//
// Extracted into its own module so both the manual sprite-sheet route and the
// auto NPC sprite generator can apply identical cleanup without duplicating
// the pixel-walk logic.
// ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpFn = any;
let sharpModule: SharpFn | null = null;
let sharpLoadError: Error | null = null;

async function getSharp(): Promise<SharpFn> {
  if (sharpModule) return sharpModule;
  if (sharpLoadError) throw sharpLoadError;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - optional native dep, may not be installed on some platforms
    const mod = await import("sharp");
    sharpModule = (mod.default ?? mod) as SharpFn;
    return sharpModule;
  } catch (err) {
    sharpLoadError =
      err instanceof Error
        ? err
        : new Error("sharp is not available; sprite background removal is disabled");
    throw sharpLoadError;
  }
}

/**
 * Convert near-white background pixels to transparency.
 *
 * `cleanupStrength` is a 0-100 dial:
 *   - 0   → only erases almost-pure white pixels (safe default)
 *   - 50  → typical preset, erases white + soft halos
 *   - 100 → aggressive, may chew into very pale skin/highlights
 *
 * Guards against eating colored pixels:
 *   - Only affects pixels whose minimum RGB channel is already very bright
 *     (i.e. close to white in *every* channel).
 *   - Only affects near-neutral pixels (small RGB channel spread).
 *   - Soft alpha fade between hard-cutoff and soft-cutoff, so the silhouette
 *     edge isn't a hard binary mask that looks aliased.
 */
export async function removeNearWhiteBackgroundPng(
  input: Buffer,
  cleanupStrength = 50,
): Promise<Buffer> {
  const sharp = await getSharp();
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    return sharp(input).png().toBuffer();
  }

  const rgba = Buffer.from(data);
  const channels = info.channels;
  const strength = Math.max(0, Math.min(100, cleanupStrength));

  const hardCutoff = Math.round(1 + (strength / 100) * 7); // 1..8
  const fadeWindow = Math.round(6 + (strength / 100) * 24); // 6..30
  const softCutoff = hardCutoff + fadeWindow;

  const minChannelFloor = Math.round(242 + (strength / 100) * 8); // 242..250
  const spreadHardLimit = Math.round(5 + (strength / 100) * 8); // 5..13
  const spreadSoftWindow = 10;
  const spreadSoftLimit = spreadHardLimit + spreadSoftWindow;

  for (let i = 0; i < rgba.length; i += channels) {
    const r = rgba[i] ?? 255;
    const g = rgba[i + 1] ?? 255;
    const b = rgba[i + 2] ?? 255;
    const a = rgba[i + 3] ?? 255;

    const minChannel = Math.min(r, g, b);
    const maxChannel = Math.max(r, g, b);
    const spread = maxChannel - minChannel;

    if (minChannel < minChannelFloor || spread > spreadSoftLimit) {
      continue;
    }

    const distanceFromWhite = Math.sqrt((255 - r) * (255 - r) + (255 - g) * (255 - g) + (255 - b) * (255 - b));

    let alphaFactor = 1;

    if (spread > spreadHardLimit) {
      const spreadT = (spread - spreadHardLimit) / Math.max(1, spreadSoftWindow);
      alphaFactor *= 1 - Math.max(0, Math.min(1, spreadT));
    }

    if (distanceFromWhite <= hardCutoff) {
      rgba[i + 3] = Math.max(0, Math.min(a, Math.round(a * (1 - alphaFactor))));
      continue;
    }

    if (distanceFromWhite <= softCutoff) {
      const t = (distanceFromWhite - hardCutoff) / Math.max(1, fadeWindow);
      const keep = Math.max(0, Math.min(1, t));
      rgba[i + 3] = Math.max(0, Math.min(a, Math.round(a * (keep + (1 - keep) * (1 - alphaFactor)))));
    }
  }

  return sharp(rgba, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}
