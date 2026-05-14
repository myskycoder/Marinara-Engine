// ──────────────────────────────────────────────
// Schema: AI Request Audit Log
// ──────────────────────────────────────────────
// Records every outbound AI request (LLM chat, embeddings, image generation,
// TTS) with metadata so the admin UI can show history, debug provider issues,
// and track token usage per agent / chat.
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const aiRequestLogs = sqliteTable("ai_request_logs", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  /** High-level call site, e.g. "main_generate", "agent", "translate". */
  source: text("source").notNull(),
  /** Output kind: "chat" | "embed" | "image" | "tts". */
  kind: text("kind").notNull(),
  /** Provider identifier ("openai", "anthropic", "stability", ...). */
  provider: text("provider").notNull(),
  /** Concrete model (or empty string for non-LLM where N/A). */
  model: text("model").notNull().default(""),
  agentConfigId: text("agent_config_id"),
  agentName: text("agent_name"),
  chatId: text("chat_id"),
  messageId: text("message_id"),
  /** "ok" | "error" | "aborted". */
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms").notNull().default(0),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  cachedPromptTokens: integer("cached_prompt_tokens"),
  /** JSON-stringified request payload (messages/options/prompt/etc). */
  requestPayload: text("request_payload").notNull().default("{}"),
  /** JSON-stringified response payload (content/usage/url/etc). */
  responsePayload: text("response_payload").notNull().default("{}"),
  /** JSON-stringified extra metadata (batched agent ids, image dims, ...). */
  metadata: text("metadata").notNull().default("{}"),
  requestTruncated: text("request_truncated").notNull().default("false"),
  responseTruncated: text("response_truncated").notNull().default("false"),
});
