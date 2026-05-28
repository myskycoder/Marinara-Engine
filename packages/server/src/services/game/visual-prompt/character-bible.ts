import { booruTagForToken } from "@marinara-engine/shared";
import type { VisualTokenBundle } from "@marinara-engine/shared";

export interface CharacterBibleEntry {
  characterId: string;
  displayName: string;
  subjectTokenOverrides: string[];
}

function isFluxFamily(family: string): boolean {
  const f = family.toLowerCase();
  return f === "flux" || f === "flux2" || f.startsWith("flux");
}

/** Build stable subject token overrides from character descriptions / NPC cards. */
export function buildCharacterBible(
  characterNames: string[],
  characterDescriptions: string[],
  family = "flux",
): CharacterBibleEntry[] {
  const entries: CharacterBibleEntry[] = [];

  for (let i = 0; i < characterNames.length; i++) {
    const name = characterNames[i]?.trim();
    if (!name) continue;
    const desc = characterDescriptions[i] ?? characterDescriptions.find((d) => d.startsWith(`${name}:`)) ?? "";
    const tokens = extractAppearanceTokens(name, desc, family);
    entries.push({
      characterId: slugifyId(name),
      displayName: name,
      subjectTokenOverrides: tokens,
    });
  }

  return entries;
}

function extractAppearanceTokens(name: string, description: string, family: string): string[] {
  const blob = `${name} ${description}`.toLowerCase();
  const tokens: string[] = [];
  if (/red\s*hair|рыж/i.test(blob)) tokens.push("red_hair");
  if (/black.*dress|чёрн.*плать/i.test(blob)) tokens.push("black_cocktail_dress");
  if (/blonde|блонд/i.test(blob)) tokens.push("blonde_hair");
  if (/long\s*hair|длинн.*волос/i.test(blob)) tokens.push("long_hair");

  if (isFluxFamily(family)) {
    return [...new Set(tokens)];
  }
  return [...new Set(tokens.map((t) => booruTagForToken(t)))];
}

function slugifyId(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 32);
}

const MAX_SUBJECT_TOKENS = 10;

/** Merge character bible overrides into subject_tokens (deterministic, no LLM). */
export function applyCharacterBible(
  tokens: VisualTokenBundle,
  bible: CharacterBibleEntry[],
  _family = "flux",
): VisualTokenBundle {
  if (!bible.length) return tokens;
  const primary = bible[0]!;
  const merged = new Set([...primary.subjectTokenOverrides, ...tokens.subject_tokens]);
  return { ...tokens, subject_tokens: [...merged].slice(0, MAX_SUBJECT_TOKENS) };
}
