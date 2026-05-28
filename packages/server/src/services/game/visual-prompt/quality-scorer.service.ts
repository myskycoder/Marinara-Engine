import type { FastifyInstance } from "fastify";
import { logger } from "../../../lib/logger.js";

export interface QualityScoreResult {
  pov: number;
  mirror: number;
  anatomy: number;
  pose: number;
  overall: number;
  shouldRegenerate: boolean;
  corrections: string[];
}

export interface QualityScorerRequest {
  app: FastifyInstance;
  chatId: string;
  positivePrompt: string;
  negativePrompt: string;
  imagePath?: string;
  scorerConnectionId?: string | null;
  anatomyThreshold?: number;
}

/**
 * Phase 2 stub: VLM quality scorer.
 * Returns passing scores when no scorer connection configured.
 */
export async function scoreIllustrationQuality(req: QualityScorerRequest): Promise<QualityScoreResult> {
  if (!req.scorerConnectionId) {
    return {
      pov: 1,
      mirror: 1,
      anatomy: 1,
      pose: 1,
      overall: 1,
      shouldRegenerate: false,
      corrections: [],
    };
  }

  logger.info(
    "[quality-scorer] scorer connection configured but VLM scoring not yet implemented (chat=%s)",
    req.chatId,
  );

  return {
    pov: 0.85,
    mirror: 0.85,
    anatomy: 0.85,
    pose: 0.85,
    overall: 0.85,
    shouldRegenerate: false,
    corrections: [],
  };
}

export interface RegenerateLoopInput {
  positive: string;
  tokensToInject: string[];
}

/** Inject correction tokens before a regenerate attempt (Phase 2 stub). */
export function buildRegeneratePrompt(input: RegenerateLoopInput): string {
  if (!input.tokensToInject.length) return input.positive;
  const injection = input.tokensToInject.map((t) => t.replace(/_/g, " ")).join(", ");
  const block1End = input.positive.indexOf("\n\n");
  if (block1End > 0) {
    return `${input.positive.slice(0, block1End)}, ${injection}${input.positive.slice(block1End)}`;
  }
  return `${input.positive}, ${injection}`;
}
