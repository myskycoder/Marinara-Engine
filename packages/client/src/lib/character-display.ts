export interface CharacterDisplayInfo {
  name: string;
  comment?: string | null;
}

export function getCharacterTitle(character: CharacterDisplayInfo | null | undefined): string | null {
  const title = typeof character?.comment === "string" ? character.comment.trim() : "";
  return title || null;
}

export function parseCharacterDisplayData(raw: { data: unknown; comment?: string | null }): CharacterDisplayInfo {
  const comment = typeof raw.comment === "string" ? raw.comment.trim() : "";

  try {
    const parsed = typeof raw.data === "string" ? JSON.parse(raw.data) : raw.data;
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const name = typeof record?.name === "string" && record.name.trim() ? record.name.trim() : "Unknown";
    return { name, comment };
  } catch {
    return { name: "Unknown", comment };
  }
}
