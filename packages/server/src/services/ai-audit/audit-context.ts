// ──────────────────────────────────────────────
// AI Audit — Async Context
// ──────────────────────────────────────────────
// Lightweight AsyncLocalStorage for propagating "who triggered this AI call"
// metadata down the call stack so the LLM/image/TTS layers can record an
// audit log entry without every provider needing to thread the data
// explicitly. Callers wrap their handler in `withAiAuditContext({...})` and
// downstream code reads the active context via `getAiAuditContext()`.
import { AsyncLocalStorage } from "node:async_hooks";

export type AiAuditSource =
  | "main_generate"
  | "agent"
  | "agent_pipeline"
  | "character_maker"
  | "persona_maker"
  | "lorebook_maker"
  | "prompt_reviewer"
  | "translate"
  | "scene"
  | "encounter"
  | "game"
  | "conversation"
  | "image_generation"
  | "tts"
  | "embedding"
  | "connection_test"
  | "other";

export interface AiAuditContext {
  source: AiAuditSource;
  agentConfigId?: string | null;
  agentName?: string | null;
  chatId?: string | null;
  messageId?: string | null;
  /** Free-form metadata merged into each audit entry written under this scope. */
  metadata?: Record<string, unknown>;
}

const aiAuditStorage = new AsyncLocalStorage<AiAuditContext>();

export function withAiAuditContext<T>(ctx: AiAuditContext, fn: () => T): T {
  return aiAuditStorage.run(ctx, fn);
}

/**
 * Sets the audit context for the current async chain. Use inside route
 * handlers when wrapping the entire body in `withAiAuditContext` is
 * impractical (e.g. multi-thousand-line handlers). Once called, every
 * subsequent `await` inside the same logical request inherits the context.
 *
 * Internally uses `AsyncLocalStorage.enterWith()`, which Node guarantees to
 * isolate per-request (each Fastify handler invocation already runs in its
 * own async resource), so this does NOT bleed into other requests.
 */
export function enterAiAuditContext(ctx: AiAuditContext): void {
  aiAuditStorage.enterWith(ctx);
}

export function getAiAuditContext(): AiAuditContext | undefined {
  return aiAuditStorage.getStore();
}

/**
 * Returns a context derived from the current store with overrides applied.
 * Useful when a nested operation knows extra fields (e.g. agentConfigId) that
 * the outer scope did not.
 */
export function deriveAiAuditContext(overrides: Partial<AiAuditContext> & Pick<AiAuditContext, "source">): AiAuditContext {
  const current = aiAuditStorage.getStore();
  return {
    ...(current ?? { source: overrides.source }),
    ...overrides,
    metadata: { ...(current?.metadata ?? {}), ...(overrides.metadata ?? {}) },
  };
}
