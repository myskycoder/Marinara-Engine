// ──────────────────────────────────────────────
// Remap per-chat asset tags after a game timeline fork (new chat id)
// ──────────────────────────────────────────────

const CHAT_TAG_PREFIX = (chatId: string) => `backgrounds:chat:${chatId}:`;

/**
 * Deep-walk metadata and replace `backgrounds:chat:<oldChatId>:` with the new chat id prefix.
 * Safe for nested objects (locationCatalog, strings in maps, etc.).
 */
export function remapBackgroundChatTagsInMetadata(
  meta: Record<string, unknown>,
  oldChatId: string,
  newChatId: string,
): Record<string, unknown> {
  if (oldChatId === newChatId) return { ...meta };
  const from = CHAT_TAG_PREFIX(oldChatId);
  const to = CHAT_TAG_PREFIX(newChatId);

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.includes(from) ? value.split(from).join(to) : value;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => walk(entry));
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v) as unknown;
      }
      return out;
    }
    return value;
  };

  return walk({ ...meta }) as Record<string, unknown>;
}
