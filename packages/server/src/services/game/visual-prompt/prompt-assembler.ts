import type { SceneAst, ShotGraph, VisualTokenBundle, PromptAssemblyMode } from "@marinara-engine/shared";
import { isFluxRewriterFamily } from "@marinara-engine/shared";
import type { FluxStyleContext } from "../flux-static-style.js";
import { assembleFluxPromptFromGraph, clampFluxPromptByPriority } from "./adapters/flux.adapter.js";
import { assembleIllustriousPrompt } from "./adapters/illustrious.adapter.js";
import { assemblePonyPrompt } from "./adapters/pony.adapter.js";
import { assembleSdxlPrompt } from "./adapters/sdxl.adapter.js";
import { applyCompositionConstraints } from "./constraint-engine.js";
import { assembleNegativePrompt } from "./negative-assembler.js";

export interface AssemblerInput {
  scene: SceneAst;
  tokens: VisualTokenBundle;
  shot: ShotGraph;
  style: FluxStyleContext;
  family: string;
  baseNegative?: string;
  fluxAdapterMeta?: {
    block3FilteredOut?: string[];
    cameraDuplicatesRemoved?: number;
  };
}

export interface AssembledPrompt {
  positive: string;
  negative: string;
  metadata: {
    pipelineVersion: "v4";
    assembly: "deterministic";
    family: string;
    tokenCounts: Record<string, number>;
    constraintViolations: string[];
    constraintInjections: string[];
    block3FilteredOut?: string[];
    cameraDuplicatesRemoved?: number;
    expressionTokenCount?: number;
  };
}

function tokenCounts(tokens: VisualTokenBundle): Record<string, number> {
  return {
    subject: tokens.subject_tokens.length,
    pose: tokens.pose_tokens.length,
    interaction: tokens.interaction_tokens.length,
    composition: tokens.composition_tokens.length,
    expression: tokens.expression_tokens?.length ?? 0,
    material: tokens.material_tokens.length,
    camera: tokens.camera_tokens.length,
    environment: tokens.environment_tokens.length,
  };
}

function assemblePositive(input: AssemblerInput): { prompt: string; fluxMeta?: AssembledPrompt["metadata"] } {
  const { scene, tokens, shot, style, family } = input;

  if (isFluxRewriterFamily(family) || family === "flux") {
    const result = assembleFluxPromptFromGraph({ scene, tokens, shot, style });
    return {
      prompt: result.prompt,
      fluxMeta: {
        pipelineVersion: "v4",
        assembly: "deterministic",
        family,
        tokenCounts: tokenCounts(tokens),
        constraintViolations: [],
        constraintInjections: [],
        block3FilteredOut: result.block3FilteredOut,
        cameraDuplicatesRemoved: result.cameraDuplicatesRemoved,
        expressionTokenCount: tokens.expression_tokens?.length ?? 0,
      },
    };
  }
  if (family === "illustrious" || family === "illustrious_xl") {
    return { prompt: assembleIllustriousPrompt(tokens, scene, shot) };
  }
  if (family === "pony" || family === "pony_diffusion") {
    return { prompt: assemblePonyPrompt(tokens, scene, shot) };
  }
  if (family === "sdxl" || family === "sdxl_booru") {
    return { prompt: assembleSdxlPrompt(tokens, scene, shot) };
  }
  const result = assembleFluxPromptFromGraph({ scene, tokens, shot, style });
  return { prompt: result.prompt };
}

export function assemblePrompt(input: AssemblerInput): AssembledPrompt {
  const assembled = assemblePositive(input);
  const constrained = applyCompositionConstraints(assembled.prompt, input.shot, input.tokens);
  const negative = assembleNegativePrompt({
    scene: input.scene,
    shot: input.shot,
    baseNegative: input.baseNegative,
    family: input.family,
  });

  const fluxFamily = isFluxRewriterFamily(input.family) || input.family === "flux";
  const positive = fluxFamily
    ? clampFluxPromptByPriority(constrained.prompt)
    : constrained.prompt;

  return {
    positive,
    negative,
    metadata: {
      pipelineVersion: "v4",
      assembly: "deterministic",
      family: input.family,
      tokenCounts: tokenCounts(input.tokens),
      constraintViolations: constrained.violations,
      constraintInjections: constrained.injected,
      block3FilteredOut: assembled.fluxMeta?.block3FilteredOut ?? input.fluxAdapterMeta?.block3FilteredOut,
      cameraDuplicatesRemoved:
        assembled.fluxMeta?.cameraDuplicatesRemoved ?? input.fluxAdapterMeta?.cameraDuplicatesRemoved,
      expressionTokenCount: assembled.fluxMeta?.expressionTokenCount ?? input.tokens.expression_tokens?.length ?? 0,
    },
  };
}

export function resolvePromptAssemblyMode(
  setting: PromptAssemblyMode | undefined,
  isComfyUi: boolean,
): PromptAssemblyMode {
  if (setting === "v4" || setting === "v3-prose") return setting;
  return isComfyUi ? "v4" : "v3-prose";
}
