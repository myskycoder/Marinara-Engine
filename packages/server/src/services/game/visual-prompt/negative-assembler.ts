/**
 * WARNING: Flux 2 Klein workflows zero out negative conditioning (ConditioningZeroOut).
 * Critical composition negatives MUST also be expressed as positive constraints via constraint-engine.ts.
 */
import type { SceneAst, ShotGraph } from "@marinara-engine/shared";
import { AVOID_TO_NEGATIVE, isFluxRewriterFamily } from "@marinara-engine/shared";

const FAMILY_ANATOMY_NEGATIVES = [
  "extra limbs",
  "detached hands",
  "broken spine",
  "bad anatomy",
  "malformed hands",
  "extra fingers",
];

const DEFAULT_COMPOSITION_NEGATIVES = [
  "third person view",
  "cropped face",
  "empty upper frame",
  "character sheet",
  "split screen",
  "panel",
  "collage",
];

/** Minimal negative for Flux 2 (ConditioningZeroOut — kept for non-Flux backends and audit trail). */
const FLUX_ARTIFACT_NEGATIVES = [
  "text",
  "letters",
  "watermark",
  "logo",
  "signature",
  "character sheet",
  "grid",
  "four images",
  "split screen",
  "panel",
  "collage",
];

export interface NegativeAssemblerInput {
  scene: SceneAst;
  shot: ShotGraph;
  baseNegative?: string;
  family?: string;
}

/** Merge scene avoid + shot constraints + family anatomy into negative prompt. */
export function assembleNegativePrompt(input: NegativeAssemblerInput): string {
  const parts = new Set<string>();
  const isFlux = input.family ? isFluxRewriterFamily(input.family) : false;

  if (input.baseNegative?.trim()) {
    for (const chunk of input.baseNegative.split(",")) {
      const trimmed = chunk.trim();
      if (trimmed) parts.add(trimmed);
    }
  }

  if (isFlux) {
    for (const slug of FLUX_ARTIFACT_NEGATIVES) parts.add(slug);
  } else {
    for (const slug of FAMILY_ANATOMY_NEGATIVES) parts.add(slug);
    for (const slug of DEFAULT_COMPOSITION_NEGATIVES) parts.add(slug);
  }

  for (const avoid of input.scene.avoid ?? []) {
    const mapped = AVOID_TO_NEGATIVE[avoid];
    if (mapped) {
      for (const chunk of mapped.split(",")) {
        const trimmed = chunk.trim();
        if (trimmed) parts.add(trimmed);
      }
    } else {
      parts.add(avoid.replace(/_/g, " "));
    }
  }

  if (!isFlux) {
    for (const constraint of input.shot.pov_constraints ?? []) {
      if (constraint === "no_player_body") {
        parts.add("player body visible");
        parts.add("protagonist full body");
      }
      if (constraint === "hands_at_frame_edge_only") {
        parts.add("floating hands");
        parts.add("detached hands in mirror");
      }
    }
  }

  return [...parts].join(", ");
}
