// ──────────────────────────────────────────────
// Conversation: Transcript Sanitizers
// ──────────────────────────────────────────────

const DATE_TAG_RE = /<\/?date(?:="[^"]*")?>/gi;
const TIMESTAMP_TOKEN = String.raw`\[(?:\d{1,2}[:.]\d{2}(?:\s*(?:am|pm))?|\d{1,2}\.\d{1,2}\.\d{2,4})\]`;
const LEADING_TIMESTAMP_RE = new RegExp(`^(\\s*(?:[-*]\\s*)?)(?:${TIMESTAMP_TOKEN}\\s*)+`, "gim");
const SPEAKER_TIMESTAMP_RE = new RegExp(`^(\\s*(?:[-*]\\s*)?[^:\\n]{1,80}:\\s*)(?:${TIMESTAMP_TOKEN}\\s*)+`, "gim");

/**
 * Conversation mode adds prompt-only timestamps like [12:01] for DM time awareness.
 * Strip those when conversation text crosses into roleplay/game context.
 */
export function stripConversationPromptTimestamps(content: string): string {
  return content
    .replace(DATE_TAG_RE, "")
    .replace(LEADING_TIMESTAMP_RE, "$1")
    .replace(SPEAKER_TIMESTAMP_RE, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
