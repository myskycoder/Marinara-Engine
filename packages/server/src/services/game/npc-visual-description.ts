import type { GameNpc, PresentCharacter } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { createGameStateStorage } from "../storage/game-state.storage.js";
import { isNpcNameStrictPrefixClusterMatch, isSameNpcName } from "./npc-name-server.js";
import { sanitizeNpcSpriteAppearanceSource } from "./npc-sprite-generation.service.js";

const NON_VISUAL_LINE_PREFIXES = [
  /^Initial mood:/i,
  /^Thoughts:/i,
  /^Scene role:/i,
  /^First seen at:/i,
];

function trimValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseStructuredNpcDescription(description: string): {
  appearance: string | null;
  outfit: string | null;
  narrativeFallback: string | null;
} {
  const lines = description
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  let appearance: string | null = null;
  let outfit: string | null = null;
  const narrativeParts: string[] = [];

  for (const line of lines) {
    const appearanceMatch = line.match(/^Appearance:\s*(.+)$/i);
    if (appearanceMatch) {
      appearance = appearanceMatch[1]!.trim();
      continue;
    }
    const outfitMatch = line.match(/^Outfit:\s*(.+)$/i);
    if (outfitMatch) {
      outfit = outfitMatch[1]!.trim();
      continue;
    }
    if (NON_VISUAL_LINE_PREFIXES.some((pattern) => pattern.test(line))) continue;
    narrativeParts.push(line);
  }

  return {
    appearance,
    outfit,
    narrativeFallback: narrativeParts.length > 0 ? narrativeParts.join(" ") : null,
  };
}

/** True when a visual description block includes an explicit Outfit line. */
export function hasExplicitOutfit(visualDescription: string): boolean {
  return /^Outfit:\s*.+/im.test(visualDescription.trim());
}

/** Read outfit from a structured GameNpc.description block when present. */
export function extractNpcOutfitFromDescription(description: string): string | null {
  const parsed = parseStructuredNpcDescription(description);
  return parsed.outfit ? parsed.outfit.trim() : null;
}

function formatVisualDescriptionParts(parts: string[]): string {
  return parts.filter(Boolean).join("\n").trim();
}

/** Match a tracked present character to a materialized GameNpc by name cluster rules. */
export function findPresentCharacterForNpc(
  npc: GameNpc,
  presentCharacters: PresentCharacter[],
): PresentCharacter | null {
  for (const character of presentCharacters) {
    if (
      isSameNpcName(character.name, npc.name) ||
      isNpcNameStrictPrefixClusterMatch(character.name, npc.name)
    ) {
      return character;
    }
  }
  return null;
}

/**
 * Build a visual-only description block for NPC portrait/sprite generation.
 * Tracker appearance/outfit wins over stale card description when no override is set.
 */
export function resolveNpcVisualDescription(args: {
  npc: GameNpc;
  presentCharacter?: PresentCharacter | null;
  appearanceOverride?: string | null;
}): string {
  const override = trimValue(args.appearanceOverride);
  if (override) {
    const cleaned = sanitizeNpcSpriteAppearanceSource(override);
    return cleaned || "scene-relevant character";
  }

  const description = args.npc.description?.trim() || "";
  const parsed = description ? parseStructuredNpcDescription(description) : null;

  let appearance =
    parsed?.appearance ??
    parsed?.narrativeFallback ??
    (description && !parsed?.appearance && !parsed?.outfit ? description : null);
  let outfit = parsed?.outfit ?? null;

  const trackerAppearance = trimValue(args.presentCharacter?.appearance ?? null);
  const trackerOutfit = trimValue(args.presentCharacter?.outfit ?? null);
  if (trackerAppearance) appearance = trackerAppearance;
  if (trackerOutfit) outfit = trackerOutfit;

  const parts: string[] = [];
  const gender = trimValue(args.npc.gender ?? null);
  const pronouns = trimValue(args.npc.pronouns ?? null);
  if (gender) parts.push(`Gender: ${gender}`);
  if (pronouns) parts.push(`Pronouns: ${pronouns}`);
  if (appearance) parts.push(`Appearance: ${appearance}`);
  if (outfit) parts.push(`Outfit: ${outfit}`);

  const formatted = formatVisualDescriptionParts(parts);
  return formatted || "scene-relevant character";
}

/** Load the latest committed character-tracker snapshot for a chat. */
export async function loadLatestPresentCharacters(db: DB, chatId: string): Promise<PresentCharacter[]> {
  const store = createGameStateStorage(db);
  const row = await store.getLatest(chatId);
  if (!row?.presentCharacters) return [];

  try {
    const parsed = JSON.parse(row.presentCharacters as string) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as PresentCharacter[];
  } catch {
    return [];
  }
}

/** Resolve visual description using the latest tracker snapshot for the chat. */
export async function resolveNpcVisualDescriptionForChat(
  db: DB,
  chatId: string,
  npc: GameNpc,
  appearanceOverride?: string | null,
): Promise<string> {
  const presentCharacters = await loadLatestPresentCharacters(db, chatId);
  const presentCharacter = findPresentCharacterForNpc(npc, presentCharacters);
  return resolveNpcVisualDescription({ npc, presentCharacter, appearanceOverride });
}
