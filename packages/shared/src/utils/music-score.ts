// ──────────────────────────────────────────────
// Music Score — Rule-Based Selector
//
// Maps (game state, weather, time, biome) to the
// best available music tag without LLM involvement.
// ──────────────────────────────────────────────

import type { GameActiveState } from "../types/game.js";

export interface MusicScoreInput {
  state: GameActiveState;
  weather?: string | null;
  timeOfDay?: string | null;
  currentMusic?: string | null;
  recentMusic?: string[] | null;
  availableMusic: string[];
}

// ── State → primary subcategory ──

const STATE_SUBCATEGORY: Record<GameActiveState, string> = {
  exploration: "exploration",
  dialogue: "dialogue",
  combat: "combat",
  travel_rest: "travel_rest",
};

const MIN_STATE_MUSIC_POOL_SIZE = 6;

// ── Mood keyword associations ──
// Each mood is an array of keywords that, when found in a tag's name parts
// or in the context values, increase the tag's score.

const MOOD_DARK = ["dark", "shadow", "eerie", "haunt", "ominous", "dread", "grim", "doom", "sinister", "tense"];
const MOOD_BRIGHT = ["bright", "dream", "hope", "light", "peace", "gentle", "serene", "calm", "soft", "warm"];
const MOOD_INTENSE = ["epic", "battle", "intense", "fierce", "urgent", "boss", "aggress", "war", "rage", "fury"];
const MOOD_MYSTIC = ["mystic", "mystery", "ancient", "spirit", "ethereal", "enchant", "magic", "arcane"];

// Weather → mood bias
const WEATHER_MOOD: Record<string, string[]> = {
  clear: MOOD_BRIGHT,
  cloudy: [],
  overcast: MOOD_DARK,
  rain: MOOD_DARK,
  heavy_rain: MOOD_DARK,
  storm: [...MOOD_DARK, ...MOOD_INTENSE],
  snow: MOOD_MYSTIC,
  blizzard: MOOD_INTENSE,
  fog: [...MOOD_DARK, ...MOOD_MYSTIC],
  wind: [],
  hail: MOOD_INTENSE,
  sandstorm: MOOD_INTENSE,
  heat_wave: MOOD_BRIGHT,
};

// Time → mood bias
const TIME_MOOD: Record<string, string[]> = {
  dawn: MOOD_BRIGHT,
  morning: MOOD_BRIGHT,
  noon: MOOD_BRIGHT,
  afternoon: MOOD_BRIGHT,
  evening: MOOD_DARK,
  night: MOOD_DARK,
  midnight: [...MOOD_DARK, ...MOOD_MYSTIC],
};

/**
 * Score how well a music tag's name keywords match the desired mood.
 */
function moodScore(tagParts: string[], moodKeywords: string[]): number {
  let score = 0;
  for (const part of tagParts) {
    for (const keyword of moodKeywords) {
      if (part.includes(keyword) || keyword.includes(part)) {
        score++;
        break;
      }
    }
  }
  return score;
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

/**
 * Pick the best music tag for the current game context.
 * Returns `null` when the current music is already appropriate.
 */
export function scoreMusic(input: MusicScoreInput): string | null {
  const { state, weather, timeOfDay, currentMusic, recentMusic, availableMusic } = input;

  if (!availableMusic.length) return null;

  // 1. Prefer the primary subcategory for this state, but only use it as the
  //    whole pool when it has enough variety. Default installs often have just
  //    one track per state folder; forcing that tiny pool makes music repeat
  //    even when the user's full music library contains better alternatives.
  const primarySub = STATE_SUBCATEGORY[state];
  const primaryCandidates = availableMusic.filter((tag) => tag.split(":")[1] === primarySub);
  const customCandidates = availableMusic.filter((tag) => tag.split(":")[1] === "custom");
  const candidates =
    primaryCandidates.length >= MIN_STATE_MUSIC_POOL_SIZE
      ? primaryCandidates
      : uniqueTags([...primaryCandidates, ...customCandidates, ...availableMusic]);

  // 3. If only one candidate, pick it (skip scoring)
  if (candidates.length === 1) {
    return candidates[0] === currentMusic ? null : candidates[0]!;
  }

  // 4. Build mood keywords from context
  const contextMood: string[] = [];
  if (weather && WEATHER_MOOD[weather]) {
    contextMood.push(...WEATHER_MOOD[weather]);
  }
  if (timeOfDay && TIME_MOOD[timeOfDay]) {
    contextMood.push(...TIME_MOOD[timeOfDay]);
  }

  // 5. Score each candidate
  const scored = candidates.map((tag) => {
    const parts = tag
      .toLowerCase()
      .split(/[:\-_]+/)
      .filter((p) => p.length > 1);
    let score = contextMood.length > 0 ? moodScore(parts, contextMood) : 0;
    const subcategory = tag.split(":")[1];
    if (subcategory === primarySub) score += 2;
    if (subcategory === "custom") score += 1;
    return { tag, score };
  });

  // 6. Avoid the current track and a short recent-history window when possible.
  const recentSet = new Set((recentMusic ?? []).filter((tag) => tag && tag !== currentMusic));
  const nonCurrent = scored.filter((entry) => entry.tag !== currentMusic);
  const nonRecent = nonCurrent.filter((entry) => !recentSet.has(entry.tag));
  const poolBase = nonRecent.length > 0 ? nonRecent : nonCurrent.length > 0 ? nonCurrent : scored;
  if (!poolBase.length) return null;

  // 7. Prefer the strongest matches, but widen the pool until it is large
  //    enough to prevent a tiny set of keyword-heavy filenames from monopolizing playback.
  let threshold = Math.max(...poolBase.map((entry) => entry.score));
  let selectionPool = poolBase.filter((entry) => entry.score >= threshold);
  const targetPoolSize = Math.min(12, poolBase.length);

  while (selectionPool.length < targetPoolSize && threshold > 0) {
    threshold -= 1;
    selectionPool = poolBase.filter((entry) => entry.score >= threshold);
  }

  return pickRandom(selectionPool).tag;
}

// ──────────────────────────────────────────────
// Ambient Score — Deterministic Rule Engine
// ──────────────────────────────────────────────

export interface AmbientScoreInput {
  state: GameActiveState;
  weather?: string | null;
  timeOfDay?: string | null;
  currentAmbient?: string | null;
  availableAmbient: string[];
  /** LLM-selected background tag — helps infer interior/exterior. */
  background?: string | null;
}

// Weather → preferred ambient keywords
// Keys must match WeatherType values from weather.service.ts
const WEATHER_AMBIENT: Record<string, string[]> = {
  clear: ["birds", "wind", "water"],
  cloudy: ["wind"],
  overcast: ["wind", "eerie"],
  rain: ["rain", "thunder"],
  heavy_rain: ["rain", "thunder", "howling"],
  storm: ["rain", "thunder", "howling"],
  snow: ["wind", "howling"],
  blizzard: ["wind", "howling"],
  fog: ["eerie", "wind"],
  wind: ["wind", "howling"],
  hail: ["rain", "wind"],
  sandstorm: ["wind", "howling"],
  heat_wave: ["birds"],
};

// Time → preferred ambient keywords
const TIME_AMBIENT: Record<string, string[]> = {
  dawn: ["birds"],
  morning: ["birds"],
  noon: [],
  afternoon: [],
  evening: ["crickets"],
  night: ["crickets", "eerie"],
  midnight: ["eerie", "crickets"],
};

// State → preferred ambient keywords
const STATE_AMBIENT: Record<GameActiveState, string[]> = {
  exploration: ["nature", "birds", "wind", "water", "river"],
  dialogue: ["crowd", "murmur", "interior"],
  combat: ["wind", "rain"],
  travel_rest: ["rain-on-roof", "river", "water", "birds"],
};

/**
 * Pick the best ambient tag for the current game context.
 * Returns `null` when the current ambient is already appropriate or no match found.
 */
export function scoreAmbient(input: AmbientScoreInput): string | null {
  const { state, weather, timeOfDay, currentAmbient, availableAmbient, background } = input;

  if (!availableAmbient.length) return null;

  // Detect interior from background tag
  const bgLower = (background ?? "").toLowerCase();
  const isInterior =
    bgLower.includes("interior") ||
    bgLower.includes("room") ||
    bgLower.includes("laboratory") ||
    bgLower.includes("mansion") ||
    bgLower.includes("house") ||
    bgLower.includes("tavern") ||
    bgLower.includes("palace") ||
    bgLower.includes("hallway") ||
    bgLower.includes("bedroom") ||
    bgLower.includes("classroom") ||
    bgLower.includes("library");

  // Build desired keywords
  const keywords: string[] = [];
  if (isInterior) {
    keywords.push("interior", "rain-on-roof", "eerie", "dungeon");
  } else {
    keywords.push(...(STATE_AMBIENT[state] ?? []));
  }
  if (weather && WEATHER_AMBIENT[weather]) {
    keywords.push(...WEATHER_AMBIENT[weather]);
  }
  if (timeOfDay && TIME_AMBIENT[timeOfDay]) {
    keywords.push(...TIME_AMBIENT[timeOfDay]);
  }

  // Score each candidate
  const scored = availableAmbient.map((tag) => {
    const parts = tag
      .toLowerCase()
      .split(/[:\-_]+/)
      .filter((p) => p.length > 1);
    let score = 0;
    // Interior tag bonus / penalty
    const tagIsInterior = parts.includes("interior");
    if (isInterior && tagIsInterior) score += 2;
    if (!isInterior && tagIsInterior) score -= 2;
    // Keyword matching
    for (const kw of keywords) {
      if (parts.some((p) => p.includes(kw) || kw.includes(p))) {
        score++;
      }
    }
    return { tag, score };
  });

  // Shuffle first for stable tie-breaking, then sort by score descending
  for (let i = scored.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [scored[i], scored[j]] = [scored[j]!, scored[i]!];
  }
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  if (best.score <= 0) return null; // no good match

  if (best.tag === currentAmbient) {
    const alt = scored.find((s) => s.score === best.score && s.tag !== currentAmbient);
    return alt ? alt.tag : null;
  }

  if (currentAmbient && availableAmbient.includes(currentAmbient)) {
    const currentParts = currentAmbient
      .toLowerCase()
      .split(/[:\-_]+/)
      .filter((p) => p.length > 1);
    let currentScore = 0;
    if (isInterior && currentParts.includes("interior")) currentScore += 2;
    if (!isInterior && currentParts.includes("interior")) currentScore -= 2;
    for (const kw of keywords) {
      if (currentParts.some((p) => p.includes(kw) || kw.includes(p))) currentScore++;
    }
    if (currentScore >= best.score) return null;
  }

  return best.tag;
}
