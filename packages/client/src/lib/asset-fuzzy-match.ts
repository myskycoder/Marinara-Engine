// ──────────────────────────────────────────────
// Asset Fuzzy Matching
//
// Resolves descriptive/semantic asset tags from the
// GM model (e.g. "tense combat music") to real asset
// tags in the manifest using keyword overlap scoring.
// ──────────────────────────────────────────────

/** Score how well a prose description matches an asset tag by keyword overlap. */
function tagScore(prose: string, tag: string): number {
  const words = prose
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const parts = tag
    .toLowerCase()
    .split(/[:\-_]+/)
    .filter((p) => p.length > 1);

  let score = 0;
  for (const part of parts) {
    for (const word of words) {
      if (part.includes(word) || word.includes(part)) {
        score++;
        break;
      }
    }
  }
  return score;
}

/** Find the best-matching tag for a prose description. Returns null if no reasonable match. */
function bestMatch(prose: string, tags: string[]): string | null {
  if (!tags.length) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const tag of tags) {
    const s = tagScore(prose, tag);
    if (s > bestScore) {
      bestScore = s;
      best = tag;
    }
  }
  return best;
}

/**
 * Resolve a potentially descriptive asset tag to a real manifest tag.
 * If the tag already exists in the manifest, returns it as-is.
 * Otherwise fuzzy-matches against tags in the given category.
 */
export function resolveAssetTag(
  tag: string,
  category: "music" | "sfx" | "backgrounds" | "ambient",
  manifest: Record<string, { path: string }> | null,
): string {
  if (!manifest) return tag;

  // Already an exact match
  if (manifest[tag]) return tag;

  // Gallery / VN illustration tags are path-like and share substrings (`illustrations`,
  // slug fragments). When the new PNG is not in the manifest yet, fuzzy scoring often
  // picks an unrelated older CG. Never remap these — keep the exact tag until manifest
  // refresh (fetchManifest / gallery) adds the real entry.
  if (category === "backgrounds" && tag.startsWith("backgrounds:illustrations:")) {
    return tag;
  }

  // Collect tags in this category
  const categoryTags = Object.keys(manifest).filter((k) => k.startsWith(category + ":"));

  // Try fuzzy match
  const matched = bestMatch(tag, categoryTags);
  if (matched) {
    console.debug(`[asset-resolve] "${tag}" → "${matched}"`);
    return matched;
  }

  // For backgrounds, fall through to generated slug format
  if (category === "backgrounds") {
    const slug = tag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
    const gen = `backgrounds:generated:${slug}`;
    console.debug(`[asset-resolve] "${tag}" → "${gen}" (no match, generated slug)`);
    return gen;
  }

  // No match — return original (will fail to resolve but won't crash)
  console.debug(`[asset-resolve] "${tag}" → no match in ${categoryTags.length} ${category} tags`);
  return tag;
}
