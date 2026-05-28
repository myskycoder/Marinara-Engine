import {
  SHOT_DIRECTOR_SYSTEM_PROMPT,
  sanitizeShotGraphYaml,
} from "@marinara-engine/shared";
import { logger } from "../../../lib/logger.js";
import { createLLMProvider } from "../../llm/provider-registry.js";
import { withAiAuditContext } from "../../ai-audit/audit-context.js";
import type { SceneAst, ShotGraph, VisualTokenBundle } from "@marinara-engine/shared";
import { parseShotGraphYaml, shotGraphToYaml, visualTokenBundleToYaml } from "./yaml-parse-utils.js";
import { deriveShotGraphHeuristic } from "./derive-shot-graph.js";

export interface DirectShotGraphRequest {
  scene: SceneAst;
  tokens: VisualTokenBundle;
  sceneYaml: string;
  chatId: string;
  agentConfigId: string | null;
  isNsfw: boolean;
  provider: ReturnType<typeof createLLMProvider>;
  model: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  useHeuristicOnly?: boolean;
}

function buildShotDirectorUserMessage(sceneYaml: string, tokens: VisualTokenBundle): string {
  return [
    "<scene_ast>",
    sceneYaml.trim(),
    "</scene_ast>",
    "",
    "<visual_tokens>",
    visualTokenBundleToYaml(tokens),
    "</visual_tokens>",
    "",
    "Output ShotGraph YAML only.",
  ].join("\n");
}

/**
 * Premium Stage 3 (v4): LLM outputs cinematography graph.
 * Falls back to heuristic derivation on failure.
 */
export async function directShotGraph(req: DirectShotGraphRequest): Promise<{
  graph: ShotGraph;
  source: "llm" | "heuristic";
}> {
  if (req.useHeuristicOnly) {
    return { graph: deriveShotGraphHeuristic(req.scene, req.tokens), source: "heuristic" };
  }

  const systemPrompt = req.isNsfw
    ? `${SHOT_DIRECTOR_SYSTEM_PROMPT}\n\nNSFW: preserve explicit blocking for penetration scenes; face_mirror_only when required.`
    : SHOT_DIRECTOR_SYSTEM_PROMPT;

  const userMessage = buildShotDirectorUserMessage(req.sceneYaml, req.tokens);

  try {
    const result = await withAiAuditContext(
      {
        source: "agent",
        agentConfigId: req.agentConfigId,
        agentName: "Shot Director",
        chatId: req.chatId,
        metadata: { stage: "shot-director", rating: req.isNsfw ? "nsfw" : "sfw" },
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

    const raw = sanitizeShotGraphYaml((result.content ?? "").trim());
    if (raw && /^camera:/m.test(raw)) {
      const graph = parseShotGraphYaml(raw);
      logger.info("[shot-director] graph ok (yamlChars=%d)", raw.length);
      return { graph, source: "llm" };
    }

    logger.warn("[shot-director] invalid graph YAML — using heuristic shot graph");
  } catch (err) {
    logger.warn(err, "[shot-director] LLM call failed — using heuristic shot graph");
  }

  return { graph: deriveShotGraphHeuristic(req.scene, req.tokens), source: "heuristic" };
}

export { shotGraphToYaml };
