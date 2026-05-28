import type { SceneAst, ShotGraph, VisualTokenBundle } from "@marinara-engine/shared";

/** Fast path: derive ShotGraph from SceneAST + tokens without LLM. */
export function deriveShotGraphHeuristic(scene: SceneAst, tokens: VisualTokenBundle): ShotGraph {
  const mirrorCentered =
    scene.composition?.reflection_centered ||
    tokens.composition_tokens.some((t) => /mirror/i.test(t));
  const faceMirrorOnly =
    scene.composition?.face_via_mirror_only ||
    tokens.composition_tokens.some((t) => t.includes("face_mirror_only"));

  const povConstraints: string[] = ["no_player_body"];
  if (faceMirrorOnly) {
    povConstraints.push("hands_at_frame_edge_only");
  }

  return {
    camera: {
      angle: "slight_downward",
      distance: "intimate",
      lens: tokens.camera_tokens.find((t) => t.includes("35")) ? "35mm" : "35mm",
      framing: "tight_medium",
      dof: "shallow_dof",
    },
    subject_blocking: {
      primary: scene.characters?.[0]?.id ?? "subject",
      body_orientation: "away_from_camera",
      face_visibility: faceMirrorOnly ? "mirror_only" : "visible",
    },
    frame_layout: {
      mirror_centered: mirrorCentered,
      hips_lower_center: tokens.composition_tokens.some((t) => /hip/i.test(t)),
      hands_lower_frame: tokens.pose_tokens.some((t) => /hand/i.test(t)),
      subject_fill: 0.7,
    },
    depth_layers: {
      foreground: tokens.interaction_tokens.some((t) => /player_hand/i.test(t)) ? ["player_hands"] : [],
      midground: ["hips", "lower_back"],
      background: mirrorCentered ? ["mirror_face"] : [],
    },
    pov_constraints: povConstraints,
  };
}
