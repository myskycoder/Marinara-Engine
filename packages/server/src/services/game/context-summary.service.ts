import type { GameContextSummary } from "@marinara-engine/shared";
import type { BaseLLMProvider } from "../llm/base-provider.js";
import { logger } from "../../lib/logger.js";

const SUMMARY_TIMEOUT_MS = 300_000;

export type { GameContextSummary };

export interface GameContextSummaryMessage {
  id: string;
  role: string;
  content: string;
  createdAt?: string | null;
}

export function normalizeContextMessageLimit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

export function getStoredGameContextSummary(meta: Record<string, unknown>): GameContextSummary | null {
  const raw = meta.gameContextSummary;
  if (!raw || typeof raw !== "object") return null;
  const summary = raw as Record<string, unknown>;
  if (
    typeof summary.summary !== "string" ||
    !summary.summary.trim() ||
    typeof summary.coveredThroughMessageId !== "string" ||
    typeof summary.coveredMessageCount !== "number"
  ) {
    return null;
  }

  return {
    summary: summary.summary.trim(),
    coveredThroughMessageId: summary.coveredThroughMessageId,
    coveredMessageCount: summary.coveredMessageCount,
    updatedAt: typeof summary.updatedAt === "string" ? summary.updatedAt : new Date().toISOString(),
    model: typeof summary.model === "string" ? summary.model : "unknown",
  };
}

export function formatGameContextSummaryPromptBlock(summary: GameContextSummary): string {
  return [
    `<compressed_session_history>`,
    `This is a rolling summary of older messages from the current game session that were removed from the live chat history because contextMessageLimit is active. Use it for continuity, causality, unresolved state, and character memory. Do not treat it as a new in-world document and do not mention that the conversation was summarized.`,
    `Covered older messages: ${summary.coveredMessageCount}. Last covered message id: ${summary.coveredThroughMessageId}.`,
    summary.summary,
    `</compressed_session_history>`,
  ].join("\n");
}

export async function applyGameContextMessageLimit<T extends GameContextSummaryMessage>(args: {
  chatId: string;
  messages: T[];
  summaryMessages?: GameContextSummaryMessage[];
  contextMessageLimit: number | null;
  metadata: Record<string, unknown>;
  provider: BaseLLMProvider;
  model: string;
  persistSummary: (summary: GameContextSummary) => Promise<void>;
}): Promise<{ messages: T[]; summary: GameContextSummary | null; hiddenMessages: T[]; updated: boolean }> {
  const { messages, contextMessageLimit } = args;
  const existingSummary = getStoredGameContextSummary(args.metadata);
  if (!contextMessageLimit || messages.length <= contextMessageLimit) {
    return { messages, summary: existingSummary, hiddenMessages: [], updated: false };
  }

  const hiddenMessages = messages.slice(0, messages.length - contextMessageLimit);
  const visibleMessages = messages.slice(-contextMessageLimit);
  const summaryMessages = args.summaryMessages?.length === messages.length ? args.summaryMessages : messages;
  const hiddenSummaryMessages = summaryMessages.slice(0, messages.length - contextMessageLimit);
  const latestHidden = hiddenMessages.at(-1);
  if (!latestHidden) {
    return { messages: visibleMessages, summary: existingSummary, hiddenMessages, updated: false };
  }

  let baseSummary: string | null = existingSummary?.summary ?? null;
  let messagesToSummarize = hiddenSummaryMessages;
  if (existingSummary) {
    const coveredIdx = hiddenSummaryMessages.findIndex(
      (message) => message.id === existingSummary.coveredThroughMessageId,
    );
    if (coveredIdx >= 0) {
      messagesToSummarize = hiddenSummaryMessages.slice(coveredIdx + 1);
    } else {
      baseSummary = null;
    }
  }

  if (messagesToSummarize.length === 0) {
    return { messages: visibleMessages, summary: existingSummary, hiddenMessages, updated: false };
  }

  try {
    const summaryText = await generateGameContextSummary({
      provider: args.provider,
      model: args.model,
      existingSummary: baseSummary,
      messages: messagesToSummarize,
    });
    if (!summaryText) {
      return { messages: visibleMessages, summary: existingSummary, hiddenMessages, updated: false };
    }

    const nextSummary: GameContextSummary = {
      summary: summaryText,
      coveredThroughMessageId: latestHidden.id,
      coveredMessageCount: hiddenMessages.length,
      updatedAt: new Date().toISOString(),
      model: args.model,
    };
    await args.persistSummary(nextSummary);
    logger.debug(
      "[generate/game] Updated rolling context summary for chat %s (%d new, %d hidden total)",
      args.chatId,
      messagesToSummarize.length,
      hiddenMessages.length,
    );
    return { messages: visibleMessages, summary: nextSummary, hiddenMessages, updated: true };
  } catch (err) {
    logger.warn(err, "[generate/game] Rolling context summary failed; continuing with message limit");
    return { messages: visibleMessages, summary: existingSummary, hiddenMessages, updated: false };
  }
}

async function generateGameContextSummary(args: {
  provider: BaseLLMProvider;
  model: string;
  existingSummary: string | null;
  messages: GameContextSummaryMessage[];
}): Promise<string | null> {
  const transcript = args.messages.map(formatSummaryMessage).join("\n\n");
  const systemPrompt = [
    "You are maintaining compressed continuity memory for an ongoing tabletop RPG game session.",
    "The full older transcript is no longer sent to the game master model because the chat has a contextMessageLimit.",
    "Update the rolling summary so the game master can preserve continuity while only receiving recent messages.",
    "",
    "Keep important facts, quests, unresolved decisions, NPC state, party state, locations, consequences, promises, secrets revealed to the player, and immediate scene continuity.",
    "Drop low-value banter, exact phrasing, repeated narration, and details that are already resolved unless they still matter.",
    "Write in the same language as the transcript when possible.",
    'Respond with ONLY valid JSON: { "summary": "..." }',
  ].join("\n");
  const userPrompt = [
    args.existingSummary
      ? `<existing_summary>\n${args.existingSummary}\n</existing_summary>`
      : "<existing_summary>\nNone yet. Create the first rolling summary from the transcript below.\n</existing_summary>",
    `<new_hidden_messages>\n${transcript}\n</new_hidden_messages>`,
  ].join("\n\n");

  const result = await withTimeout(
    args.provider.chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model: args.model, temperature: 0.2, maxTokens: 4096 },
    ),
    SUMMARY_TIMEOUT_MS,
  );

  const raw = (result.content ?? "").trim();
  if (!raw) return null;
  try {
    const jsonText = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)?.[1]?.trim() ?? raw;
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    return summary || raw;
  } catch {
    return raw;
  }
}

function formatSummaryMessage(message: GameContextSummaryMessage): string {
  const role = message.role === "narrator" ? "system" : message.role;
  const timestamp = message.createdAt ? ` @ ${message.createdAt}` : "";
  return `[${role}${timestamp}]\n${message.content ?? ""}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Game context summary timeout")), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}
