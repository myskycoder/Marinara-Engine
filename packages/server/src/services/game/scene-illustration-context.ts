// ──────────────────────────────────────────────
// Game: Scene illustration — extra context for image models
// ──────────────────────────────────────────────

import { stripGmCommandTags } from "./segment-edits.js";

/** Strip GM tags and compress whitespace for a compact continuity excerpt. */
export function excerptNarrationForIllustration(raw: string, maxLen: number): string {
  const stripped = stripGmCommandTags(raw).replace(/\s+/g, " ").trim();
  return stripped.slice(0, maxLen);
}

export interface IllustrationContinuityInput {
  narrationExcerpt?: string | null;
  backgroundTag?: string | null;
  backgroundPrompt?: string | null;
  locationId?: string | null;
  weather?: string | null;
  timeOfDay?: string | null;
  season?: string | null;
  priorBackgroundTag?: string | null;
}

/**
 * Single text block passed to the image model so the CG matches the current
 * location, atmosphere, and narration — not a generic stock scene.
 */
export function buildIllustrationContinuity(opts: IllustrationContinuityInput): string {
  const lines: string[] = [];
  if (opts.locationId?.trim()) {
    lines.push(`Location id (stable place, keep architecture/era consistent): ${opts.locationId.trim()}.`);
  }
  if (opts.backgroundPrompt?.trim()) {
    lines.push(`Environment / plate brief (must match this setting and props): ${opts.backgroundPrompt.trim()}`);
  }
  const bg = opts.backgroundTag?.trim();
  if (bg && !bg.startsWith("backgrounds:illustrations:")) {
    lines.push(`Scene background tag for this turn: ${bg}.`);
  }
  const prior = opts.priorBackgroundTag?.trim();
  if (prior && prior !== bg && !prior.startsWith("backgrounds:illustrations:")) {
    lines.push(`Prior location background tag (continuity if still same place): ${prior}.`);
  }
  const cond = [
    opts.weather?.trim() && `weather: ${opts.weather.trim()}`,
    opts.timeOfDay?.trim() && `time: ${opts.timeOfDay.trim()}`,
    opts.season?.trim() && `season: ${opts.season.trim()}`,
  ].filter(Boolean);
  if (cond.length) lines.push(`Atmosphere: ${cond.join(", ")}.`);
  if (opts.narrationExcerpt?.trim()) {
    lines.push(
      `Recent narration (facts, who is present, visible props — stay aligned; do not contradict): ${opts.narrationExcerpt.trim()}`,
    );
  }
  const joined = lines.join("\n");
  const max = 2000;
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}
