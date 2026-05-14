// ──────────────────────────────────────────────
// AI Audit — Logger
// ──────────────────────────────────────────────
// Single insert point for audit log entries. Reads context from
// `aiAuditStorage` (set by callers via `withAiAuditContext`), respects the
// runtime settings, and writes asynchronously so the hot LLM path is never
// blocked by DB latency or transient failures.
import { logger } from "../../lib/logger.js";
import { getDB } from "../../db/connection.js";
import { aiRequestLogs } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import { getAiAuditContext, type AiAuditSource } from "./audit-context.js";
import { readAiAuditSettings } from "./audit-settings.js";

export type AiAuditKind = "chat" | "embed" | "image" | "tts";
export type AiAuditStatus = "ok" | "error" | "aborted";

export interface RecordAiRequestInput {
  kind: AiAuditKind;
  provider: string;
  model?: string;
  /** Override source from context. */
  source?: AiAuditSource;
  agentConfigId?: string | null;
  agentName?: string | null;
  chatId?: string | null;
  messageId?: string | null;
  status: AiAuditStatus;
  errorMessage?: string | null;
  durationMs: number;
  /** Will be JSON-serialized; binary blobs (images, audio bytes) must NOT be passed in. */
  request?: unknown;
  /** Will be JSON-serialized; binary blobs (images, audio bytes) must NOT be passed in. */
  response?: unknown;
  metadata?: Record<string, unknown>;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  cachedPromptTokens?: number | null;
}

const TRUNCATION_NOTE = "[AI-Audit: payload truncated]";

function safeStringify(value: unknown): string {
  if (value === undefined) return "{}";
  try {
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Map) return Object.fromEntries(v);
      if (v instanceof Set) return Array.from(v);
      return v;
    });
  } catch (err) {
    logger.warn(err, "[ai-audit] Failed to stringify payload; storing placeholder");
    return JSON.stringify({ _stringifyError: String(err) });
  }
}

function truncatePayload(serialized: string, maxBytes: number): { value: string; truncated: boolean } {
  if (maxBytes <= 0 || serialized.length <= maxBytes) {
    return { value: serialized, truncated: false };
  }
  const head = serialized.slice(0, Math.max(0, maxBytes - TRUNCATION_NOTE.length - 8));
  return {
    value: JSON.stringify({ truncated: true, preview: head, note: TRUNCATION_NOTE }),
    truncated: true,
  };
}

export function recordAiRequest(input: RecordAiRequestInput): void {
  setImmediate(() => {
    void writeAiRequest(input).catch((err) => {
      logger.warn(err, "[ai-audit] Failed to record AI request");
    });
  });
}

async function writeAiRequest(input: RecordAiRequestInput): Promise<void> {
  const settings = await readAiAuditSettings();
  if (!settings.enabled) return;

  const context = getAiAuditContext();
  const source = input.source ?? context?.source ?? "other";
  const agentConfigId = input.agentConfigId ?? context?.agentConfigId ?? null;
  const agentName = input.agentName ?? context?.agentName ?? null;
  const chatId = input.chatId ?? context?.chatId ?? null;
  const messageId = input.messageId ?? context?.messageId ?? null;

  const requestRaw = settings.logRequestBody && input.request !== undefined ? safeStringify(input.request) : "{}";
  const responseRaw = settings.logResponseBody && input.response !== undefined ? safeStringify(input.response) : "{}";

  const requestTrunc = truncatePayload(requestRaw, settings.maxRecordSize);
  const responseTrunc = truncatePayload(responseRaw, settings.maxRecordSize);

  const mergedMetadata = { ...(context?.metadata ?? {}), ...(input.metadata ?? {}) };

  try {
    const db = await getDB();
    await db.insert(aiRequestLogs).values({
      id: newId(),
      createdAt: now(),
      source,
      kind: input.kind,
      provider: input.provider,
      model: input.model ?? "",
      agentConfigId,
      agentName,
      chatId,
      messageId,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      cachedPromptTokens: input.cachedPromptTokens ?? null,
      requestPayload: requestTrunc.value,
      responsePayload: responseTrunc.value,
      metadata: safeStringify(mergedMetadata),
      requestTruncated: requestTrunc.truncated ? "true" : "false",
      responseTruncated: responseTrunc.truncated ? "true" : "false",
    });
  } catch (err) {
    logger.warn(err, "[ai-audit] DB insert failed");
  }
}

/**
 * Drains usage fields from a provider-supplied LLMUsage-like object onto the
 * audit input. Returns the input for chaining.
 */
export function applyUsageToAuditInput<T extends RecordAiRequestInput>(
  input: T,
  usage:
    | {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        cachedPromptTokens?: number;
      }
    | undefined
    | null,
): T {
  if (!usage) return input;
  if (usage.promptTokens != null) input.promptTokens = usage.promptTokens;
  if (usage.completionTokens != null) input.completionTokens = usage.completionTokens;
  if (usage.totalTokens != null) input.totalTokens = usage.totalTokens;
  if (usage.cachedPromptTokens != null) input.cachedPromptTokens = usage.cachedPromptTokens;
  return input;
}
