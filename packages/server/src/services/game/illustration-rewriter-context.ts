// ──────────────────────────────────────────────
// Game: illustration rewriter — shared context helpers
// ──────────────────────────────────────────────

import type { GameNpc, PresentCharacter } from "@marinara-engine/shared";

export interface BuildScenePresenceBlockOptions {
  maxNpcs?: number;
  maxLineChars?: number;
  totalCharCap?: number;
  allowExtraTrackerEntries?: boolean;
}

/**
 * Build a compact `<scene_npcs>` text block from the character-tracker's live
 * state, so the image-prompt-writer can translate mood/outfit/thoughts into
 * the right pose/expression/clothing tags.
 *
 * Output shape (one bullet per known character, missing fields skipped):
 *   - Rin: mood=sleepy/dazed; appearance=teen girl, short black hair...; outfit=...
 *
 * Returns null when there's nothing usable to emit.
 */
export function buildScenePresenceBlock(
  presentCharacters: PresentCharacter[] | null | undefined,
  gameNpcs: GameNpc[] | null | undefined,
  focusNames: string[],
  options: BuildScenePresenceBlockOptions = {},
): string | null {
  const maxNpcs = options.maxNpcs ?? 6;
  const maxLineChars = options.maxLineChars ?? 360;
  const totalCharCap = options.totalCharCap ?? 1800;
  const allowExtraTrackerEntries = options.allowExtraTrackerEntries ?? true;

  const focusLowercase = new Set(focusNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const npcCardByName = new Map<string, GameNpc>();
  for (const npc of gameNpcs ?? []) {
    if (npc?.name) npcCardByName.set(npc.name.toLowerCase(), npc);
  }

  const seenLower = new Set<string>();
  const orderedNames: string[] = [];
  for (const name of focusNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seenLower.has(lower)) continue;
    if (lower === "player" || lower === "{{user}}" || lower === "user") continue;
    seenLower.add(lower);
    orderedNames.push(trimmed);
  }
  if (allowExtraTrackerEntries) {
    for (const tracker of presentCharacters ?? []) {
      const trimmed = tracker?.name?.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (seenLower.has(lower)) continue;
      if (lower === "player" || lower === "{{user}}" || lower === "user") continue;
      seenLower.add(lower);
      orderedNames.push(trimmed);
    }
  }

  if (!orderedNames.length) return null;

  const trackerByName = new Map<string, PresentCharacter>();
  for (const tracker of presentCharacters ?? []) {
    if (tracker?.name) trackerByName.set(tracker.name.toLowerCase(), tracker);
  }

  const stripWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
  const clamp = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;

  const lines: string[] = [];
  for (const name of orderedNames) {
    if (lines.length >= maxNpcs) break;
    const lower = name.toLowerCase();
    const tracker = trackerByName.get(lower);
    const card = npcCardByName.get(lower);
    const inFocus = focusLowercase.has(lower);

    const fields: string[] = [];
    const mood = stripWhitespace(tracker?.mood ?? "");
    if (mood) fields.push(`mood=${clamp(mood, 80)}`);
    const appearance = stripWhitespace(tracker?.appearance ?? card?.description ?? "");
    if (appearance) fields.push(`appearance=${clamp(appearance, 200)}`);
    const outfit = stripWhitespace(tracker?.outfit ?? "");
    if (outfit) fields.push(`outfit=${clamp(outfit, 160)}`);
    const thoughts = stripWhitespace(tracker?.thoughts ?? "");
    if (thoughts) fields.push(`thoughts=${clamp(thoughts, 160)}`);

    if (!fields.length && !inFocus) continue;
    if (!fields.length) continue;

    const line = `- ${name}: ${fields.join("; ")}`;
    lines.push(clamp(line, maxLineChars));
  }

  if (!lines.length) return null;

  let block = lines.join("\n");
  if (block.length > totalCharCap) {
    block = `${block.slice(0, totalCharCap - 1)}…`;
  }
  return block;
}

/** Resolve rewriter rating from game setup and per-request illustration hints. */
export function resolveIllustrationRewriterRating(opts: {
  gameRating?: "sfw" | "nsfw" | null;
  illustrationConnectionId?: string | null;
  nsfwImageConnectionId?: string | null;
  reason?: string | null;
}): "sfw" | "nsfw" {
  const nsfwConn = opts.nsfwImageConnectionId?.trim();
  const illConn = opts.illustrationConnectionId?.trim();
  if (nsfwConn && illConn && illConn === nsfwConn) return "nsfw";
  if ((opts.reason ?? "").toLowerCase().includes("nsfw")) return "nsfw";
  return opts.gameRating === "nsfw" ? "nsfw" : "sfw";
}
