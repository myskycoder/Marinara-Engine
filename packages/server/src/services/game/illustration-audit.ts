// ──────────────────────────────────────────────
// AI Audit — Illustration Skip Recorder
// ──────────────────────────────────────────────
// Writes a synthetic AI audit row whenever a VN illustration is intentionally
// skipped by the server (cooldown, missing image connection, generation
// disabled, etc.) so dashboards can distinguish "model didn't ask for one"
// from "server suppressed one". No provider call is made — the row is purely
// a marker, with `durationMs: 0` and a `skipped` provider sentinel.
import type { SceneIllustrationRequest } from "@marinara-engine/shared";

import { recordAiRequest } from "../ai-audit/audit-logger.js";

export type IllustrationSkipReason =
  | "cooldown_active"
  | "cg_frequency_off"
  | "no_image_connection"
  | "image_generation_disabled";

export interface RecordIllustrationSkipInput {
  chatId: string | null;
  reason: IllustrationSkipReason;
  illustration?: SceneIllustrationRequest | null;
  turnNumber?: number | null;
  lastIllustrationTurn?: number | null;
  /** Optional free-form note (e.g. which endpoint suppressed it). */
  note?: string;
}

/**
 * Record a synthetic "image_generation skipped" audit row. Fire-and-forget;
 * never throws into the caller.
 */
export function recordIllustrationSkip(input: RecordIllustrationSkipInput): void {
  recordAiRequest({
    kind: "image",
    source: "image_generation",
    provider: "skipped",
    status: "aborted",
    errorMessage: input.reason,
    durationMs: 0,
    chatId: input.chatId,
    request: {
      illustration: input.illustration ?? null,
    },
    metadata: {
      skipReason: input.reason,
      turnNumber: input.turnNumber ?? null,
      lastIllustrationTurn: input.lastIllustrationTurn ?? null,
      ...(input.note ? { note: input.note } : {}),
    },
  });
}
