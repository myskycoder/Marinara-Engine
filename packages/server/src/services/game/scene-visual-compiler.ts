import {
  SCENE_COMPILER_SYSTEM_PROMPT,
  sanitizeCompiledSceneYaml,
  validateCompiledSceneYaml,
} from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import { withAiAuditContext } from "../ai-audit/audit-context.js";
import {
  buildSceneCompilerUserMessage,
  buildStructuredSceneState,
  type IllustrationSceneStateInput,
} from "./illustration-scene-state.js";

export interface CompileVisualSceneStateRequest extends IllustrationSceneStateInput {
  chatId: string;
  agentConfigId: string | null;
  isNsfw: boolean;
  provider: ReturnType<typeof createLLMProvider>;
  model: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

const NSFW_COMPILER_BLOCK = [
  "<rating_guidelines>",
  "NSFW fiction. Preserve explicit acts, garment state, contact points, and body geometry in the YAML. Do not sanitize.",
  "</rating_guidelines>",
].join("\n");

/**
 * Premium Stage 1: LLM extracts structured visual YAML from the draft.
 * Returns null on any failure — caller falls back to deterministic schema.
 */
export async function compileVisualSceneState(req: CompileVisualSceneStateRequest): Promise<string | null> {
  const systemPrompt = req.isNsfw
    ? `${SCENE_COMPILER_SYSTEM_PROMPT}\n\n${NSFW_COMPILER_BLOCK}`
    : SCENE_COMPILER_SYSTEM_PROMPT;

  const userMessage = buildSceneCompilerUserMessage(req);

  logger.debug("[scene-visual-compiler] system:\n%s", systemPrompt);
  logger.debug("[scene-visual-compiler] user:\n%s", userMessage);

  try {
    const result = await withAiAuditContext(
      {
        source: "agent",
        agentConfigId: req.agentConfigId,
        agentName: "Scene Visual Compiler",
        chatId: req.chatId,
        metadata: {
          stage: "scene-compile",
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
        "[scene-visual-compiler] provider content filter blocked compile — falling back to deterministic scene_state (use Claude Sonnet 4 or GPT-4.1 for NSFW)",
      );
      return null;
    }

    if (!raw) {
      logger.warn("[scene-visual-compiler] empty YAML output — falling back to deterministic scene_state");
      return null;
    }

    const cleaned = sanitizeCompiledSceneYaml(raw);
    if (!cleaned || cleaned.length < 20) {
      logger.warn("[scene-visual-compiler] sanitized YAML too short — falling back to deterministic scene_state");
      return null;
    }

    const missingKeys = validateCompiledSceneYaml(cleaned);
    if (missingKeys.length) {
      logger.warn(
        "[scene-visual-compiler] incomplete YAML (missing: %s) — falling back to deterministic scene_state",
        missingKeys.join(", "),
      );
      return null;
    }

    logger.info("[scene-visual-compiler] compile ok (yamlChars=%d)", cleaned.length);
    return cleaned.length > 2400 ? `${cleaned.slice(0, 2397)}…` : cleaned;
  } catch (err) {
    logger.warn(err, "[scene-visual-compiler] LLM call failed — falling back to deterministic scene_state");
    return null;
  }
}

/** Resolve scene state YAML: premium compiler with deterministic fallback. */
export async function resolveSceneStateYaml(
  input: IllustrationSceneStateInput & {
    useCompiler: boolean;
    compileRequest?: Omit<CompileVisualSceneStateRequest, keyof IllustrationSceneStateInput | "useCompiler">;
  },
): Promise<{ yaml: string; sceneCompileUsed: boolean }> {
  if (input.useCompiler && input.compileRequest) {
    const compiled = await compileVisualSceneState({ ...input.compileRequest, ...input });
    if (compiled) {
      return { yaml: compiled, sceneCompileUsed: true };
    }
  }
  return { yaml: buildStructuredSceneState(input), sceneCompileUsed: false };
}
