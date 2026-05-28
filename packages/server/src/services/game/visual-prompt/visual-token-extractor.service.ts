import { VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT, stripCodeFences } from "@marinara-engine/shared";
import { logger } from "../../../lib/logger.js";
import { createLLMProvider } from "../../llm/provider-registry.js";
import { withAiAuditContext } from "../../ai-audit/audit-context.js";
import type { SceneAst, VisualTokenBundle } from "@marinara-engine/shared";
import { buildSaliencyReducerUserMessage } from "../illustration-scene-state.js";
import { parseVisualTokenBundleYaml } from "./yaml-parse-utils.js";
import { applyTokenPostGates, deterministicTokenBundle } from "./token-post-gates.js";
import type { SceneParserHints } from "./scene-parser.js";

export interface ExtractVisualTokensRequest {
  sceneYaml: string;
  scene: SceneAst;
  hints: SceneParserHints;
  chatId: string;
  agentConfigId: string | null;
  isNsfw: boolean;
  provider: ReturnType<typeof createLLMProvider>;
  model: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

const NSFW_TOKEN_BLOCK = [
  "<rating_guidelines>",
  "NSFW fiction. interaction_tokens MUST include rear_penetration and/or deep_rhythm when penetration implied.",
  "</rating_guidelines>",
].join("\n");

function sanitizeTokenYaml(raw: string): string {
  return stripCodeFences(raw);
}

/** v4 Stage 2: LLM extracts VisualTokenBundle; post-gates applied deterministically. */
export async function extractVisualTokens(req: ExtractVisualTokensRequest): Promise<{
  tokens: VisualTokenBundle;
  source: "llm" | "deterministic";
}> {
  const systemPrompt = req.isNsfw
    ? `${VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT}\n\n${NSFW_TOKEN_BLOCK}`
    : VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT;

  const userMessage = buildSaliencyReducerUserMessage(req.sceneYaml);

  try {
    const result = await withAiAuditContext(
      {
        source: "agent",
        agentConfigId: req.agentConfigId,
        agentName: "Visual Token Extractor",
        chatId: req.chatId,
        metadata: { stage: "token-extract", rating: req.isNsfw ? "nsfw" : "sfw" },
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

    const raw = sanitizeTokenYaml((result.content ?? "").trim());
    if (raw && /^subject_tokens:/m.test(raw)) {
      const parsed = parseVisualTokenBundleYaml(raw);
      const gated = applyTokenPostGates(parsed, req.scene, req.hints, req.sceneYaml);
      logger.info("[visual-token-extractor] extract ok (tokens=%d)", gated.interaction_tokens.length);
      return { tokens: gated, source: "llm" };
    }

    logger.warn("[visual-token-extractor] invalid token YAML — falling back to deterministic bundle");
  } catch (err) {
    logger.warn(err, "[visual-token-extractor] LLM call failed — falling back to deterministic bundle");
  }

  return {
    tokens: deterministicTokenBundle(req.sceneYaml, req.hints),
    source: "deterministic",
  };
}
