// ──────────────────────────────────────────────
// Game: deterministic static style layer for Flux prompts
// ──────────────────────────────────────────────

export interface FluxStyleContext {
  artStyle?: string | null;
  genre?: string | null;
  setting?: string | null;
}

export interface FluxStaticStyleResult {
  block: string;
  filteredOut: string[];
}

export const FLUX_CRITICAL_STYLE_ANCHORS = [
  "glossy anime realism",
  "cinematic VN CG framing",
  "anime illustration",
];

const DEFAULT_FLUX_STYLE_TOKENS = ["glossy anime realism", "cinematic VN CG framing"];

/** Style tokens incompatible with detected scene environment. */
export const STYLE_ENVIRONMENT_CONFLICTS: Record<string, string[]> = {
  bathroom: [
    "nightclub setting",
    "bartender",
    "party scene",
    "nightclub neon palette",
    "harem",
    "romance",
    "seduction",
  ],
  bedroom: ["nightclub setting", "bartender", "party scene", "harem", "seduction"],
  kitchen: ["nightclub setting", "bartender", "party scene"],
  office: ["nightclub setting", "bartender", "party scene", "harem"],
  outdoors: ["nightclub setting", "bartender", "party scene"],
};

/** Substring patterns for style tokens that conflict with a given environment key. */
export const STYLE_ENVIRONMENT_CONFLICT_PATTERNS: Record<string, RegExp[]> = {
  bathroom: [/nightclub/i, /\bbar\b/i, /bartender/i, /party scene/i, /harem/i, /romance/i, /seduction/i],
};

/** Map common Russian genre/setting tokens to English Flux-friendly tags. */
const RU_STYLE_TAG_MAP: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /хентай|hentai/i, tag: "hentai" },
  { pattern: /разврат|erotic/i, tag: "erotic" },
  { pattern: /гарем|harem/i, tag: "harem" },
  { pattern: /романтик|romance/i, tag: "romance" },
  { pattern: /ночн|nightclub|клуб/i, tag: "nightclub setting" },
  { pattern: /неон|neon/i, tag: "neon lighting" },
  { pattern: /бармен|bartender/i, tag: "bartender" },
  { pattern: /вечерин|party/i, tag: "party scene" },
  { pattern: /соблазн|seduc/i, tag: "seduction" },
];

const CYRILLIC = /[\u0400-\u04FF]/;

function tokenizeStyle(value: string): string[] {
  return value
    .split(/[,;|/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isEnglishFluxToken(token: string): boolean {
  if (!token.trim()) return false;
  if (CYRILLIC.test(token)) return false;
  return true;
}

function mapRuStyleHints(...sources: Array<string | null | undefined>): string[] {
  const blob = sources.filter(Boolean).join(" ").toLowerCase();
  const tags: string[] = [];
  for (const { pattern, tag } of RU_STYLE_TAG_MAP) {
    if (pattern.test(blob)) tags.push(tag);
  }
  return tags;
}

function normalizeTokenKey(token: string): string {
  return token.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Drop tokens that are substrings of an already-kept token (or vice versa). */
function dedupeSimilarTokens(tokens: string[]): string[] {
  const kept: string[] = [];
  for (const token of tokens) {
    const key = normalizeTokenKey(token);
    const dominated = kept.some((existing) => {
      const existingKey = normalizeTokenKey(existing);
      return existingKey.includes(key) || key.includes(existingKey);
    });
    if (!dominated) kept.push(token);
  }
  return kept;
}

function detectEnvironmentKeys(environmentHints: string[]): string[] {
  const blob = environmentHints.join(" ").toLowerCase();
  const keys: string[] = [];
  if (/bathroom|ванн|luxury_bathroom/i.test(blob)) keys.push("bathroom");
  if (/bedroom|спальн/i.test(blob)) keys.push("bedroom");
  if (/kitchen|кухн/i.test(blob)) keys.push("kitchen");
  if (/office|офис/i.test(blob)) keys.push("office");
  if (/outdoor|street|forest|парк|улиц/i.test(blob)) keys.push("outdoors");
  return keys;
}

function filterStyleTokensForEnvironment(tokens: Set<string>, environmentHints: string[]): string[] {
  const filteredOut: string[] = [];
  const envKeys = detectEnvironmentKeys(environmentHints);
  if (!envKeys.length) return filteredOut;

  const conflicts = new Set<string>();
  for (const key of envKeys) {
    for (const tag of STYLE_ENVIRONMENT_CONFLICTS[key] ?? []) {
      conflicts.add(normalizeTokenKey(tag));
    }
  }

  for (const token of [...tokens]) {
    const key = normalizeTokenKey(token);
    const exactConflict = conflicts.has(key);
    const patternConflict = envKeys.some((envKey) =>
      (STYLE_ENVIRONMENT_CONFLICT_PATTERNS[envKey] ?? []).some((pattern) => pattern.test(key)),
    );
    if (exactConflict || patternConflict) {
      tokens.delete(token);
      filteredOut.push(token);
    }
  }
  return filteredOut;
}

/**
 * Build the static Block 3 style comma stack from game art profile.
 * English-only tokens for Flux; Russian genre/setting mapped to EN tags.
 */
export function buildFluxStaticStyleBlock(
  ctx: FluxStyleContext,
  environmentHints: string[] = [],
): FluxStaticStyleResult {
  const tokens = new Set<string>(DEFAULT_FLUX_STYLE_TOKENS);

  if (ctx.artStyle?.trim()) {
    for (const token of tokenizeStyle(ctx.artStyle)) {
      if (isEnglishFluxToken(token)) tokens.add(token);
    }
  }

  for (const tag of mapRuStyleHints(ctx.genre, ctx.setting, ctx.artStyle)) {
    tokens.add(tag);
  }

  if (ctx.genre?.trim()) {
    for (const token of tokenizeStyle(ctx.genre)) {
      if (isEnglishFluxToken(token)) tokens.add(token);
    }
  }
  if (ctx.setting?.trim()) {
    for (const token of tokenizeStyle(ctx.setting)) {
      if (isEnglishFluxToken(token)) tokens.add(token);
    }
  }

  const style = (ctx.artStyle ?? "").toLowerCase();
  if (/neon|nightclub|purple|gold/.test(style)) tokens.add("nightclub neon palette");
  if (/semi-real|realistic/.test(style)) tokens.add("semi-realistic materials");
  if (/hentai|anime/i.test(style)) tokens.add("anime illustration");

  const filteredOut = filterStyleTokensForEnvironment(tokens, environmentHints);
  const block = dedupeSimilarTokens([...tokens]).join(", ");
  return { block, filteredOut };
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Assemble final Flux prompt: Blocks 1–2 from director + deterministic Block 3.
 * Deduplicates style tokens already present in blocks 1–2.
 */
export function assembleFluxPrompt(blocks12: string, staticStyle: string | FluxStaticStyleResult): string {
  const styleBlock = typeof staticStyle === "string" ? staticStyle : staticStyle.block;
  const trimmed = blocks12.trim();
  const blocks = trimmed.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  const dynamicBlocks = blocks.length > 2 ? blocks.slice(0, 2) : blocks;
  const dynamicText = dynamicBlocks.join("\n\n").toLowerCase();

  const styleTokens = styleBlock
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const uniqueStyleTokens = styleTokens.filter((token) => {
    const key = normalizeToken(token);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const dedupedStyle = uniqueStyleTokens.filter((token) => !dynamicText.includes(normalizeToken(token)));

  const block3 = dedupedStyle.length ? dedupedStyle.join(", ") : styleBlock.trim();
  if (!block3) return trimmed;

  return dynamicBlocks.length ? `${dynamicBlocks.join("\n\n")}\n\n${block3}` : block3;
}
