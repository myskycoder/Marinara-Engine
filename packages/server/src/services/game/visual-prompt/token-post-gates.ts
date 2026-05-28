import type { SceneAst, VisualTokenBundle } from "@marinara-engine/shared";
import type { SceneParserHints } from "./scene-parser.js";
import { parseLegacySaliencyToTokens, parseSceneAstFromLegacyYaml, inferExpressionTokensFromSceneYaml } from "./yaml-parse-utils.js";

const MAX_POSE_TOKENS = 3;

/** Deterministic post-gates after LLM token extraction. */
export function applyTokenPostGates(
  tokens: VisualTokenBundle,
  scene: SceneAst,
  hints: SceneParserHints,
  sceneYaml?: string,
): VisualTokenBundle {
  const interaction = new Set(tokens.interaction_tokens);
  const pose = new Set(tokens.pose_tokens);
  const composition = new Set(tokens.composition_tokens);
  const camera = new Set(tokens.camera_tokens);
  const expression = new Set(tokens.expression_tokens ?? []);

  const needsPenetration =
    hints.hasPenetration ||
    scene.interaction?.type === "rear_penetration" ||
    /penetrat|rear|behind|rhythm/i.test(scene.interaction?.type ?? "");

  if (needsPenetration) {
    interaction.add("rear_penetration");
    if (scene.interaction?.intensity === "deep" || hints.hasPenetration) {
      interaction.add("deep_rhythm");
    }
    interaction.add("player_hands_on_hips");
  }

  if (hints.hasMirror || scene.composition?.face_via_mirror_only) {
    composition.add("mirror_face_centered");
    composition.add("face_mirror_only");
  }

  if (!camera.size) {
    camera.add("first_person");
    camera.add("35mm");
    camera.add("shallow_dof");
  }

  if (scene.pose?.base && pose.size < MAX_POSE_TOKENS) pose.add(scene.pose.base);
  if (scene.pose?.spine === "arched") pose.add("arched_back");

  if (!expression.size && sceneYaml) {
    for (const slug of inferExpressionTokensFromSceneYaml(sceneYaml)) {
      expression.add(slug);
    }
  }

  return {
    ...tokens,
    pose_tokens: [...pose].slice(0, MAX_POSE_TOKENS),
    interaction_tokens: [...interaction],
    composition_tokens: [...composition],
    camera_tokens: [...camera],
    expression_tokens: [...expression],
  };
}

/** Deterministic token bundle when LLM extraction fails. */
export function deterministicTokenBundle(sceneYaml: string, hints: SceneParserHints): VisualTokenBundle {
  const scene = parseSceneAstFromLegacyYaml(sceneYaml);
  const legacy = parseLegacySaliencyToTokens(sceneYaml);
  return applyTokenPostGates(legacy, scene, hints);
}
