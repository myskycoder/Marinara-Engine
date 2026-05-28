import { SALIENCY_REDUCER_SYSTEM_PROMPT, sanitizeSaliencyYaml } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import { withAiAuditContext } from "../ai-audit/audit-context.js";
import { buildSaliencyReducerUserMessage } from "./illustration-scene-state.js";

export interface ReduceVisualSaliencyRequest {
  sceneYaml: string;
  chatId: string;
  agentConfigId: string | null;
  isNsfw: boolean;
  provider: ReturnType<typeof createLLMProvider>;
  model: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

const NSFW_SALIENCY_BLOCK = [
  "<rating_guidelines>",
  "NSFW fiction. Preserve explicit penetration, rhythm, garment state, and body contact in important_visuals (English). Do not sanitize or euphemize.",
  "</rating_guidelines>",
].join("\n");

/**
 * Premium Stage 2: LLM compresses full scene YAML into saliency-ranked state.
 * Returns null on failure — caller falls back to deterministic saliency reducer.
 */
export async function reduceVisualSaliency(req: ReduceVisualSaliencyRequest): Promise<string | null> {
  const systemPrompt = req.isNsfw
    ? `${SALIENCY_REDUCER_SYSTEM_PROMPT}\n\n${NSFW_SALIENCY_BLOCK}`
    : SALIENCY_REDUCER_SYSTEM_PROMPT;

  const userMessage = buildSaliencyReducerUserMessage(req.sceneYaml);

  logger.debug("[scene-saliency-reducer] system:\n%s", systemPrompt);
  logger.debug("[scene-saliency-reducer] user:\n%s", userMessage);

  try {
    const result = await withAiAuditContext(
      {
        source: "agent",
        agentConfigId: req.agentConfigId,
        agentName: "Visual Saliency Reducer",
        chatId: req.chatId,
        metadata: {
          stage: "saliency-reduce",
          rating: req.isNsfw ? "nsfw" : "sfw",
        },
      },
      () =>
        req.provider.chatComplete(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          {
            model: req.model,
            temperature: req.temperature,
            maxTokens: req.maxTokens,
            signal: req.signal,
          },
        ),
    );

    const finishReason = result.finishReason ?? "stop";
    const raw = (result.content ?? "").trim();

    if (finishReason === "content_filter") {
      logger.warn(
        "[scene-saliency-reducer] provider content filter blocked — falling back to deterministic saliency",
      );
      return null;
    }

    if (!raw) {
      logger.warn("[scene-saliency-reducer] empty output — falling back to deterministic saliency");
      return null;
    }

    const cleaned = sanitizeSaliencyYaml(raw);
    if (!cleaned || cleaned.length < 20 || !/^dominant_pose:/m.test(cleaned)) {
      logger.warn("[scene-saliency-reducer] invalid saliency YAML — falling back to deterministic saliency");
      return null;
    }

    logger.info("[scene-saliency-reducer] reduce ok (yamlChars=%d)", cleaned.length);
    return cleaned.length > 1800 ? `${cleaned.slice(0, 1797)}…` : cleaned;
  } catch (err) {
    logger.warn(err, "[scene-saliency-reducer] LLM call failed — falling back to deterministic saliency");
    return null;
  }
}
