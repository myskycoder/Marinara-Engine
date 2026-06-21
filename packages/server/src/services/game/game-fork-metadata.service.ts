// ──────────────────────────────────────────────
// Remap per-chat asset tags after a game timeline fork (new chat id)
// ──────────────────────────────────────────────

const CHAT_TAG_PREFIX = (chatId: string) => `backgrounds:chat:${chatId}:`;
const CHAT_TAG_ID_PATTERN = /backgrounds:chat:([^:]+):/g;

/**
 * Collect every chat id referenced by `backgrounds:chat:<chatId>:` tags in metadata.
 */
export function collectBackgroundChatIdsFromMetadata(meta: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();

  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (!value.includes("backgrounds:chat:")) return;
      for (const match of value.matchAll(CHAT_TAG_ID_PATTERN)) {
        const chatId = match[1]?.trim();
        if (chatId) ids.add(chatId);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        walk(entry);
      }
    }
  };

  walk(meta);
  return ids;
}

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
