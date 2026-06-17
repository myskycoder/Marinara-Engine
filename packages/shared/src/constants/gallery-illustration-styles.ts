// ──────────────────────────────────────────────
// Gallery manual illustration — art style presets
// ──────────────────────────────────────────────

export const GALLERY_ILLUSTRATION_STYLE_PRESET_IDS = [
  "game",
  "vn-cel",
  "cinematic",
  "painterly",
  "noir",
  "retro-90s",
] as const;

export type GalleryIllustrationStylePresetId = (typeof GALLERY_ILLUSTRATION_STYLE_PRESET_IDS)[number];

export type GalleryIllustrationStylePresetKey = Exclude<GalleryIllustrationStylePresetId, "game">;

export const GALLERY_ILLUSTRATION_STYLE_PRESETS: Record<GalleryIllustrationStylePresetKey, string> = {
  "vn-cel":
    "visual novel CG, clean cel shading, soft anime linework, gentle gradients, polished character rendering, intimate framing, soft key light, minimal noise, high detail faces",
  cinematic:
    "cinematic still frame, dramatic directional lighting, shallow depth of field, film color grading, subtle lens bloom, realistic proportions, moody atmosphere, 35mm composition",
  painterly:
    "digital painting, visible brush strokes, rich color harmony, atmospheric perspective, concept art illustration, painterly edges, soft texture, illustrative not photoreal",
  noir: "noir mood, high contrast chiaroscuro, muted desaturated palette, deep shadows, rim lighting, tense atmosphere, minimal background detail, dramatic silhouette",
  "retro-90s":
    "1990s anime OVA aesthetic, bold outlines, saturated colors, slightly soft focus, classic hand-drawn anime shading, nostalgic cel animation look, limited animation polish",
};

/** Resolve art direction for a gallery-triggered illustration request. */
export function resolveGalleryIllustrationArtStyle(
  gameArtStyle: string,
  preset?: GalleryIllustrationStylePresetId | null,
): string {
  if (!preset || preset === "game") {
    return gameArtStyle.trim();
  }
  return GALLERY_ILLUSTRATION_STYLE_PRESETS[preset];
}
