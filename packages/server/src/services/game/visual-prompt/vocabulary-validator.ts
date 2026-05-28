import type { VisualTokenBundle } from "@marinara-engine/shared";
import {
  BOORU_TOKEN_TAGS,
  FLUX_TOKEN_PHRASES,
  isKnownBooruToken,
  isKnownFluxToken,
  normalizeTokenSlug,
  TOKEN_SYNONYMS,
} from "@marinara-engine/shared";

export interface VocabularyValidationResult {
  tokens: VisualTokenBundle;
  missCount: number;
  misses: string[];
}

const TOKEN_CATEGORIES: Array<keyof VisualTokenBundle> = [
  "subject_tokens",
  "pose_tokens",
  "interaction_tokens",
  "composition_tokens",
  "expression_tokens",
  "material_tokens",
  "camera_tokens",
  "environment_tokens",
];

function isKnownToken(slug: string, family: string): boolean {
  const normalized = normalizeTokenSlug(slug);
  if (normalized in TOKEN_SYNONYMS) return true;
  if (isFluxRewriterFamilyLocal(family)) return isKnownFluxToken(slug);
  return isKnownBooruToken(slug) || normalized in BOORU_TOKEN_TAGS || normalized in FLUX_TOKEN_PHRASES;
}

function isFluxRewriterFamilyLocal(family: string): boolean {
  const f = family.toLowerCase();
  return f === "flux" || f === "flux2" || f.startsWith("flux");
}

function mapSlug(slug: string): { mapped: string; wasMiss: boolean } {
  const normalized = normalizeTokenSlug(slug);
  if (normalized in FLUX_TOKEN_PHRASES || normalized in BOORU_TOKEN_TAGS) {
    return { mapped: normalized, wasMiss: normalized !== slug.trim().toLowerCase().replace(/\s+/g, "_") };
  }
  if (slug in TOKEN_SYNONYMS || normalized in TOKEN_SYNONYMS) {
    return { mapped: normalized, wasMiss: true };
  }
  return { mapped: slug, wasMiss: true };
}

/** Map unknown slugs to canonical vocabulary keys; track misses for audit metadata. */
export function validateTokenBundle(tokens: VisualTokenBundle, family: string): VocabularyValidationResult {
  const misses: string[] = [];
  const out = { ...tokens } as VisualTokenBundle;

  for (const category of TOKEN_CATEGORIES) {
    const mapped: string[] = [];
    const seen = new Set<string>();
    for (const slug of tokens[category] ?? []) {
      const { mapped: canonical, wasMiss } = mapSlug(slug);
      if (!isKnownToken(canonical, family) && wasMiss) {
        misses.push(`${category}:${slug}`);
      }
      const key = canonical.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        mapped.push(canonical);
      }
    }
    out[category] = mapped;
  }

  return {
    tokens: out,
    missCount: misses.length,
    misses,
  };
}
