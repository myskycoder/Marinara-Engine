import type { DB } from "../../db/connection.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { isSameNpcName, npcNameKey } from "./npc-name-server.js";

type PresentCharacterRecord = Record<string, unknown>;

function normalizeLocationKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePresentCharacterEntry(entry: unknown): Record<string, unknown> | null {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed ? { name: trimmed } : null;
  }
  if (entry && typeof entry === "object") return entry as Record<string, unknown>;
  return null;
}

function trackerPresenceKey(character: Record<string, unknown>): string | null {
  const id = typeof character.characterId === "string" ? character.characterId.trim() : "";
  if (id) return `id:${id.toLowerCase()}`;
  const name = typeof character.name === "string" ? npcNameKey(character.name) : "";
  return name ? `name:${name}` : null;
}

function pickLastSeenLocation(character: Record<string, unknown>): string | null {
  const location = character.lastSeenLocation;
  return typeof location === "string" && location.trim() ? location.trim() : null;
}

function pickLastSeenTurn(character: Record<string, unknown>): number | null {
  const turn = finiteNumber(character.lastSeenTurn);
  return turn !== null && turn > 0 ? turn : null;
}

export function collectProtectedCharacterNames(names: Iterable<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) continue;
    const key = npcNameKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export async function loadProtectedCharacterNames(db: DB, characterIds: string[]): Promise<string[]> {
  if (!characterIds.length) return [];
  const charStore = createCharactersStorage(db);
  const names: string[] = [];
  for (const id of characterIds) {
    const row = await charStore.getById(id);
    if (!row?.data) continue;
    try {
      const data = JSON.parse(row.data as string) as { name?: string };
      if (typeof data.name === "string" && data.name.trim()) names.push(data.name.trim());
    } catch {
      /* skip malformed card */
    }
  }
  return collectProtectedCharacterNames(names);
}

function isProtectedCharacterName(name: string, protectedCharacterNames?: string[]): boolean {
  if (!name.trim() || !protectedCharacterNames?.length) return false;
  return protectedCharacterNames.some((protectedName) => isSameNpcName(protectedName, name));
}

function isCharacterMentionedInNarration(narration: string | null | undefined, name: string): boolean {
  if (!narration || !name.trim()) return false;
  const haystack = narration.toLowerCase();
  const candidates = Array.from(
    new Set([name.trim().toLowerCase(), npcNameKey(name)].filter((candidate) => candidate.length >= 2)),
  );
  for (const candidate of candidates) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(candidate)}([^\\p{L}\\p{N}]|$)`, "iu");
    if (pattern.test(haystack)) return true;
  }
  return false;
}

function formatCharacterStats(stats: unknown): string | null {
  if (!Array.isArray(stats) || stats.length === 0) return null;
  const parts = stats
    .map((stat) => {
      if (!stat || typeof stat !== "object") return null;
      const record = stat as Record<string, unknown>;
      const statName = typeof record.name === "string" ? record.name.trim() : "";
      if (!statName) return null;
      const value = typeof record.value === "number" ? String(record.value) : String(record.value ?? "");
      const max = typeof record.max === "number" ? `/${record.max}` : "";
      return `${statName}: ${value}${max}`;
    })
    .filter((value): value is string => !!value);
  return parts.length > 0 ? parts.join(", ") : null;
}

function shouldHideStaleCharacter(
  character: PresentCharacterRecord,
  opts: {
    location?: string | null;
    currentTurn?: number | null;
    staleTurnThreshold?: number;
    protectedCharacterNames?: string[];
  },
): boolean {
  const name = typeof character.name === "string" ? character.name : "";
  if (isProtectedCharacterName(name, opts.protectedCharacterNames)) return false;

  const currentLocationKey = normalizeLocationKey(opts.location);
  const lastSeenLocationKey = normalizeLocationKey(character.lastSeenLocation);
  if (!currentLocationKey || !lastSeenLocationKey || currentLocationKey === lastSeenLocationKey) return false;

  const currentTurn = finiteNumber(opts.currentTurn);
  const lastSeenTurn = finiteNumber(character.lastSeenTurn);
  if (currentTurn === null || lastSeenTurn === null) return false;

  const threshold = opts.staleTurnThreshold ?? 1;
  return currentTurn - lastSeenTurn >= threshold;
}

export function buildPresentCharacterContextLines(presentCharacters: unknown): string[] {
  if (!Array.isArray(presentCharacters)) return [];

  const lines: string[] = [];
  for (const character of presentCharacters) {
    if (typeof character === "string") {
      lines.push(`- ${character}`);
      continue;
    }
    if (!character || typeof character !== "object") continue;
    const record = character as PresentCharacterRecord;

    const details: string[] = [];
    if (typeof record.mood === "string" && record.mood.trim()) details.push(`mood: ${record.mood.trim()}`);
    if (typeof record.appearance === "string" && record.appearance.trim()) {
      details.push(`appearance: ${record.appearance.trim()}`);
    }
    if (typeof record.outfit === "string" && record.outfit.trim()) details.push(`outfit: ${record.outfit.trim()}`);
    if (typeof record.thoughts === "string" && record.thoughts.trim()) {
      details.push(`thoughts: ${record.thoughts.trim()}`);
    }
    const stats = formatCharacterStats(record.stats);
    if (stats) details.push(`stats: ${stats}`);

    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : String(character);
    const emoji = typeof record.emoji === "string" ? record.emoji : "";
    const detailStr = details.length > 0 ? ` (${details.join("; ")})` : "";
    lines.push(`- ${emoji} ${name}${detailStr}`);
  }

  return lines;
}

export function buildBracketLineCountByCharacterName(narration: string | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  if (!narration) return counts;
  const speakerPattern =
    /\[([^\]]+?)\]\s*\[(?:main|side|extra|action|thought|whisper(?::[^\]]+)?)(?:[^\]]*)?\]/gi;
  for (const match of narration.matchAll(speakerPattern)) {
    const name = npcNameKey(match[1] ?? "");
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

export function getAssistantTurnIndex(
  messages: Array<{ id?: unknown; role?: unknown }> | null | undefined,
  targetMessageId?: string | null,
): number | null {
  if (!messages?.length) return null;

  let count = 0;
  for (const message of messages) {
    if (message.role === "assistant" || message.role === "narrator") count += 1;
    if (targetMessageId && message.id === targetMessageId) return count;
  }
  return targetMessageId ? count + 1 : count || null;
}

/** 1-based turn index for the assistant message currently being generated. */
export function getGeneratingAssistantTurn(
  messages: Array<{ id?: unknown; role?: unknown }> | null | undefined,
  targetMessageId?: string | null,
): number {
  return (getAssistantTurnIndex(messages, targetMessageId) ?? 0) + 1;
}

/** 1-based turn index for a committed assistant message in history. */
export function getCommittedAssistantTurnAtMessage(
  messages: Array<{ id?: unknown; role?: unknown }> | null | undefined,
  messageId?: string | null,
): number | null {
  if (!messageId) return getAssistantTurnIndex(messages) ?? null;
  return getAssistantTurnIndex(messages, messageId);
}

export function applyTrackerPresenceMetadata(
  characters: Array<Record<string, unknown>>,
  opts: {
    location?: string | null;
    previousLocation?: string | null;
    turn?: number | null;
    lineCountByCharacterName?: Map<string, number>;
    previousCharacters?: Array<Record<string, unknown>>;
    protectedCharacterNames?: string[];
  },
): void {
  const location = typeof opts.location === "string" ? opts.location.trim() : "";
  const previousLocation = typeof opts.previousLocation === "string" ? opts.previousLocation.trim() : "";
  const turn = finiteNumber(opts.turn);
  const locationChanged =
    !!previousLocation && !!location && normalizeLocationKey(previousLocation) !== normalizeLocationKey(location);
  const previousByKey = new Map<string, Record<string, unknown>>();
  for (const previous of opts.previousCharacters ?? []) {
    const key = trackerPresenceKey(previous);
    if (key) previousByKey.set(key, previous);
  }

  for (const character of characters) {
    const name = typeof character.name === "string" ? character.name : "";
    const lineCount = opts.lineCountByCharacterName?.get(npcNameKey(name)) ?? 0;
    const spokeThisTurn = lineCount > 0;
    const isProtected = isProtectedCharacterName(name, opts.protectedCharacterNames);
    const previous = previousByKey.get(trackerPresenceKey(character) ?? "") ?? null;

    // Never trust Character Tracker for presence metadata — server owns these fields.
    delete character.lastSeenLocation;
    delete character.lastSeenTurn;

    const carriedLocation = previous ? pickLastSeenLocation(previous) : null;
    const carriedTurn = previous ? pickLastSeenTurn(previous) : null;
    if (carriedLocation) character.lastSeenLocation = carriedLocation;
    if (carriedTurn !== null) character.lastSeenTurn = carriedTurn;

    if (!character.lastSeenLocation && locationChanged && !spokeThisTurn && previousLocation) {
      character.lastSeenLocation = previousLocation;
      if (turn !== null) character.lastSeenTurn = turn > 1 ? turn - 1 : turn;
    }

    if (spokeThisTurn && location) character.lastSeenLocation = location;
    if (spokeThisTurn && turn !== null) character.lastSeenTurn = turn;

    if (locationChanged && !spokeThisTurn && isProtected && location) {
      character.lastSeenLocation = location;
      if (turn !== null) character.lastSeenTurn = turn;
    }
  }
}

export function shouldRemoveAbsentPresentCharacter(
  character: PresentCharacterRecord,
  opts: {
    location?: string | null;
    currentTurn?: number | null;
    staleTurnThreshold?: number;
    lineCountByCharacterName?: Map<string, number>;
    narration?: string | null;
    protectedCharacterNames?: string[];
  },
): boolean {
  const name = typeof character.name === "string" ? character.name : "";
  if (isProtectedCharacterName(name, opts.protectedCharacterNames)) return false;

  const lineCount = opts.lineCountByCharacterName?.get(npcNameKey(name)) ?? 0;
  if (lineCount > 0) return false;
  if (isCharacterMentionedInNarration(opts.narration, name)) return false;

  const currentLocationKey = normalizeLocationKey(opts.location);
  const lastSeenLocationKey = normalizeLocationKey(character.lastSeenLocation);
  if (currentLocationKey && lastSeenLocationKey && currentLocationKey !== lastSeenLocationKey) {
    return true;
  }

  return shouldHideStaleCharacter(character, opts);
}

export function removeStalePresentCharacters(
  characters: Array<Record<string, unknown>>,
  opts: {
    location?: string | null;
    currentTurn?: number | null;
    staleTurnThreshold?: number;
    protectedCharacterNames?: string[];
  },
): void {
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    if (!character || typeof character !== "object") continue;
    if (shouldHideStaleCharacter(character as PresentCharacterRecord, opts)) {
      characters.splice(index, 1);
    }
  }
}

export function removeAbsentPresentCharacters(
  characters: Array<Record<string, unknown>>,
  opts: {
    location?: string | null;
    currentTurn?: number | null;
    staleTurnThreshold?: number;
    lineCountByCharacterName?: Map<string, number>;
    narration?: string | null;
    protectedCharacterNames?: string[];
  },
): void {
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    if (!character || typeof character !== "object") continue;
    if (shouldRemoveAbsentPresentCharacter(character as PresentCharacterRecord, opts)) {
      characters.splice(index, 1);
    }
  }
}

export function filterPresentCharactersForContext(
  presentCharacters: unknown,
  opts: {
    location?: string | null;
    currentTurn?: number | null;
    staleTurnThreshold?: number;
    lineCountByCharacterName?: Map<string, number>;
    narration?: string | null;
    protectedCharacterNames?: string[];
  } = {},
): Array<Record<string, unknown>> {
  if (!Array.isArray(presentCharacters)) return [];
  const filtered = presentCharacters
    .map(normalizePresentCharacterEntry)
    .filter((character): character is Record<string, unknown> => !!character);
  removeStalePresentCharacters(filtered, opts);
  removeAbsentPresentCharacters(filtered, {
    ...opts,
    lineCountByCharacterName: opts.lineCountByCharacterName ?? new Map(),
    narration: opts.narration ?? "",
  });
  return filtered;
}

export function finalizePresentCharactersAfterTracker(
  characters: Array<Record<string, unknown>>,
  opts: {
    location?: string | null;
    previousLocation?: string | null;
    turn?: number | null;
    lineCountByCharacterName?: Map<string, number>;
    previousCharacters?: Array<Record<string, unknown>>;
    narration?: string | null;
    staleTurnThreshold?: number;
    protectedCharacterNames?: string[];
  },
): void {
  applyTrackerPresenceMetadata(characters, {
    location: opts.location,
    previousLocation: opts.previousLocation,
    turn: opts.turn,
    lineCountByCharacterName: opts.lineCountByCharacterName,
    previousCharacters: opts.previousCharacters,
    protectedCharacterNames: opts.protectedCharacterNames,
  });
  removeStalePresentCharacters(characters, {
    location: opts.location,
    currentTurn: opts.turn,
    staleTurnThreshold: opts.staleTurnThreshold,
    protectedCharacterNames: opts.protectedCharacterNames,
  });
  removeAbsentPresentCharacters(characters, {
    location: opts.location,
    currentTurn: opts.turn,
    staleTurnThreshold: opts.staleTurnThreshold,
    lineCountByCharacterName: opts.lineCountByCharacterName,
    narration: opts.narration,
    protectedCharacterNames: opts.protectedCharacterNames,
  });
}
