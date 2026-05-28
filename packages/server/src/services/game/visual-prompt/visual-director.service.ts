import {
  VISUAL_DIRECTOR_SYSTEM_PROMPT,
  splitVisualDirectorYaml,
} from "@marinara-engine/shared";
import { logger } from "../../../lib/logger.js";
import { createLLMProvider } from "../../llm/provider-registry.js";
import { withAiAuditContext } from "../../ai-audit/audit-context.js";
import type { SceneAst, ShotGraph, VisualTokenBundle } from "@marinara-engine/shared";
import { extractVisualTokens } from "./visual-token-extractor.service.js";
import { directShotGraph } from "./shot-director.service.js";
import { deriveShotGraphHeuristic } from "./derive-shot-graph.js";
import { parseShotGraphYaml, parseVisualTokenBundleYaml } from "./yaml-parse-utils.js";
import { applyTokenPostGates, deterministicTokenBundle } from "./token-post-gates.js";
import type { SceneParserHints } from "./scene-parser.js";

export interface DirectVisualsRequest {
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
  useHeuristicOnly?: boolean;
}

const NSFW_VISUAL_DIRECTOR_BLOCK = [
  "<rating_guidelines>",
  "NSFW fiction. Preserve explicit penetration, rhythm, garment state, and expression tokens. Do not sanitize.",
  "</rating_guidelines>",
].join("\n");

function buildVisualDirectorUserMessage(sceneYaml: string): string {
  return [
    "<scene_ast>",
    sceneYaml.trim(),
    "</scene_ast>",
    "",
    "Output visual_tokens and shot_graph YAML only. Use the schema from your system instructions.",
  ].join("\n");
}

/**
 * Premium v4 merged stage: single LLM call for VisualTokenBundle + ShotGraph.
 * Falls back to legacy two-stage extract + direct on failure.
 */
export async function directVisuals(req: DirectVisualsRequest): Promise<{
  tokens: VisualTokenBundle;
  graph: ShotGraph;
  tokenSource: "llm" | "deterministic";
  shotSource: "llm" | "heuristic";
  mergedStageUsed: boolean;
}> {
  if (req.useHeuristicOnly) {
    const tokens = deterministicTokenBundle(req.sceneYaml, req.hints);
    return {
      tokens,
      graph: deriveShotGraphHeuristic(req.scene, tokens),
      tokenSource: "deterministic",
      shotSource: "heuristic",
      mergedStageUsed: false,
    };
  }

  const systemPrompt = req.isNsfw
    ? `${VISUAL_DIRECTOR_SYSTEM_PROMPT}\n\n${NSFW_VISUAL_DIRECTOR_BLOCK}`
    : VISUAL_DIRECTOR_SYSTEM_PROMPT;

  const userMessage = buildVisualDirectorUserMessage(req.sceneYaml);

  try {
    const result = await withAiAuditContext(
      {
        source: "agent",
        agentConfigId: req.agentConfigId,
        agentName: "Visual Director",
        chatId: req.chatId,
        metadata: { stage: "visual-director", rating: req.isNsfw ? "nsfw" : "sfw" },
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

    const raw = (result.content ?? "").trim();
    const split = splitVisualDirectorYaml(raw);

    if (split && /^subject_tokens:/m.test(split.tokensYaml) && /^camera:/m.test(split.shotYaml)) {
      const parsed = parseVisualTokenBundleYaml(split.tokensYaml);
      const gated = applyTokenPostGates(parsed, req.scene, req.hints, req.sceneYaml);
      const graph = parseShotGraphYaml(split.shotYaml);
      logger.info("[visual-director] merged stage ok (tokens=%d)", gated.interaction_tokens.length);
      return {
        tokens: gated,
        graph,
        tokenSource: "llm",
        shotSource: "llm",
        mergedStageUsed: true,
      };
    }

    logger.warn("[visual-director] invalid merged YAML — falling back to two-stage pipeline");
  } catch (err) {
    logger.warn(err, "[visual-director] LLM call failed — falling back to two-stage pipeline");
  }

  const tokenResult = await extractVisualTokens({
    sceneYaml: req.sceneYaml,
    scene: req.scene,
    hints: req.hints,
    chatId: req.chatId,
    agentConfigId: req.agentConfigId,
    isNsfw: req.isNsfw,
    provider: req.provider,
    model: req.model,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    signal: req.signal,
  });

  const shotResult = await directShotGraph({
    scene: req.scene,
    tokens: tokenResult.tokens,
    sceneYaml: req.sceneYaml,
    chatId: req.chatId,
    agentConfigId: req.agentConfigId,
    isNsfw: req.isNsfw,
    provider: req.provider,
    model: req.model,
    temperature: req.temperature,
    maxTokens: Math.min(req.maxTokens, 1024),
    signal: req.signal,
  });

  return {
    tokens: tokenResult.tokens,
    graph: shotResult.graph,
    tokenSource: tokenResult.source,
    shotSource: shotResult.source,
    mergedStageUsed: false,
  };
}
