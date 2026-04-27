// ──────────────────────────────────────────────
// NPC name utilities
// ──────────────────────────────────────────────
//
// Single source of truth for NPC name comparison and filesystem-safe slugs.
// Previously each layer (server materializer, server avatars route, client
// matcher) had its own copy of normalize/slugify with subtly different rules,
// which let names match in one place and miss in another.
//
// All functions are Unicode-aware (`\p{L}\p{N}` instead of `[a-z0-9]`) so
// non-Latin scripts (Cyrillic, CJK, etc.) keep their characters during
// normalization rather than being collapsed to empty strings.

/**
 * Stable lookup key for "is this the same NPC" comparisons.
 *
 * NFKC + lowercase + collapse all non-letter/non-digit runs to a single space.
 * Trim trailing/leading separators. Preserves any Unicode letters/digits.
 *
 * Examples:
 *   "Bob the Builder" → "bob the builder"
 *   "Алёша  -- Попович!" → "алёша попович"
 *   "Mrs. O'Reilly"  → "mrs o reilly"
 */
export function npcNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whitespace-stripped variant of `npcNameKey`. Useful as a secondary fallback
 * when one source has "Mr. Smith" and another has "Mr Smith" without the dot.
 */
function compactNpcNameKey(name: string): string {
  return npcNameKey(name).replace(/\s+/g, "");
}

/**
 * True when two names refer to the same NPC, ignoring case, punctuation,
 * Unicode normalization form, and most whitespace differences.
 *
 * Returns `false` if either name is empty/whitespace-only after normalization.
 */
export function isSameNpcName(left: string, right: string): boolean {
  const leftKey = npcNameKey(left);
  const rightKey = npcNameKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  return compactNpcNameKey(leftKey) === compactNpcNameKey(rightKey);
}

/**
 * Filesystem-safe slug derived from an NPC name. ASCII-only, lowercase,
 * dash-separated. Falls back to `<prefix>-<hash[:10]>` for names that don't
 * survive ASCII normalization (Cyrillic, emoji-only, etc.) so we never write
 * an empty filename.
 *
 * Default hash is a tiny non-cryptographic 64-bit hash (good enough for a
 * filesystem fallback — no collision-resistance needed). Server callers may
 * pass `opts.hashHex` to use Node's `crypto.createHash("sha1")` for the same
 * SHA-1 prefix the legacy code produced (ensuring backwards compatibility
 * with already-written files).
 *
 * Synchronous on purpose — many call sites (e.g. existsSync probes) are
 * synchronous and forcing them async would ripple through the whole avatar
 * resolver path.
 */
export function slugifyForFs(
  name: string,
  opts?: { prefix?: string; hashHex?: (input: string) => string },
): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  if (ascii) return ascii;
  const hash = opts?.hashHex ? opts.hashHex(name) : fallbackHashHex(name);
  return `${opts?.prefix ?? "npc"}-${hash.slice(0, 10)}`;
}

/** Tiny non-cryptographic hash — good enough for filesystem fallbacks. */
function fallbackHashHex(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const a = (h2 >>> 0).toString(16).padStart(8, "0");
  const b = (h1 >>> 0).toString(16).padStart(8, "0");
  return `${a}${b}`;
}
