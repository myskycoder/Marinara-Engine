import type { SceneIllustrationRequest } from "@marinara-engine/shared";
import { isSameNpcName, npcNameKey } from "./npc-name-server.js";

/** Bracket tags that are VN channels, moods, or flags — not character names. */
const BRACKET_TAG_SKIP = new Set([
  // VN dialogue channels (PartyDialogueType)
  "main",
  "side",
  "extra",
  "action",
  "thought",
  "react",
  // Common expression / mood tags
  "thinking",
  "blushing",
  "embarrassed",
  "happy",
  "sad",
  "angry",
  "neutral",
  "surprised",
  "confused",
  "sleepy",
  "dazed",
  "excited",
  "determined",
  "observant",
  "crying",
  "laughing",
  "smirk",
  "focused",
  "worried",
  "amused",
  // Meta / player aliases
  "player",
  "user",
  "{{user}}",
  "narrator",
  "gm",
  "system",
  "sfw",
  "nsfw",
]);

/** True when an unmatched bracket tag is likely a mood/channel token, not an NPC name. */
function isLikelyNonCharacterBracketTag(inner: string): boolean {
  const lower = inner.toLowerCase();
  if (BRACKET_TAG_SKIP.has(lower)) return true;
  if (/^whisper:/.test(lower)) return true;
  // Single lowercase ASCII word with no Cyrillic — e.g. crying, thought, smirk
  if (/^[a-z][a-z0-9_-]*$/.test(lower) && !/[а-яё]/i.test(inner)) return true;
  return false;
}

export function isIllustrationReferenceSubject(name: string): boolean {
  const key = npcNameKey(name);
  return key !== "player" && key !== "protagonist" && key !== "self";
}

/** Third-person Full SFW/NSFW gallery requests — player protagonist must be visible and described. */
export function isFullSceneIllustrationRequest(
  illustration: Pick<SceneIllustrationRequest, "prompt" | "reason" | "slug">,
): boolean {
  const reason = (illustration.reason ?? "").toLowerCase();
  const slug = (illustration.slug ?? "").toLowerCase();
  const prompt = illustration.prompt ?? "";
  if (reason.includes("full-scene")) return true;
  if (slug.startsWith("manual-wow-full-")) return true;
  if (slug.startsWith("manual-full-")) return true;
  if (/third-person wide-shot scene illustration/i.test(prompt)) return true;
  if (/player protagonist IS visible/i.test(prompt)) return true;
  return false;
}

export interface IllustrationPlayerProtagonist {
  name: string;
  appearanceText: string;
  avatarPath?: string | null;
}

function dedupeNames(names: string[], limit: number): string[] {
  const seenKeys = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = npcNameKey(trimmed);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Extract NPC/character names mentioned in illustration draft text:
 * VN bracket tags (`[Штерн]`) plus substring hits against known roster names.
 */
export function extractMentionedNpcNames(text: string, knownNames: string[]): string[] {
  if (!text.trim() || knownNames.length === 0) return [];

  const found: string[] = [];
  const seen = new Set<string>();

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !isIllustrationReferenceSubject(trimmed)) return;
    const key = npcNameKey(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(trimmed);
  };

  for (const match of text.matchAll(/\[([^\]\n]{1,80})\]/g)) {
    const inner = match[1]!.trim();
    if (!inner || isLikelyNonCharacterBracketTag(inner)) continue;
    let matched = false;
    for (const known of knownNames) {
      if (isSameNpcName(inner, known)) {
        add(known);
        matched = true;
        break;
      }
    }
    if (!matched && !isLikelyNonCharacterBracketTag(inner)) add(inner);
  }

  const lowerText = text.toLowerCase();
  for (const known of knownNames) {
    const trimmed = known.trim();
    if (!trimmed) continue;
    if (lowerText.includes(trimmed.toLowerCase())) add(trimmed);
  }

  return found;
}

/**
 * Focus cast for CG illustration: names mentioned in the draft first, then live
 * present tracker entries. Excludes party-wide rosters unless they appear in text.
 */
export function resolveIllustrationFocusNames(opts: {
  draftText: string;
  presentTrackedNames: string[];
  knownNames: string[];
  limit?: number;
}): string[] {
  const mentioned = extractMentionedNpcNames(opts.draftText, opts.knownNames);
  return dedupeNames(
    [
      ...mentioned.filter(isIllustrationReferenceSubject),
      ...opts.presentTrackedNames.filter(isIllustrationReferenceSubject),
    ],
    opts.limit ?? 6,
  );
}
