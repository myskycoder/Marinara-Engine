import assert from "node:assert/strict";
import test from "node:test";
import { splitVisualDirectorYaml } from "@marinara-engine/shared";

test("splitVisualDirectorYaml parses merged visual_tokens and shot_graph sections", () => {
  const raw = `
visual_tokens:
  subject_tokens:
    - red_hair
  pose_tokens:
    - bent_over_marble_counter
  interaction_tokens:
    - rear_penetration
  composition_tokens:
    - face_mirror_only
  expression_tokens:
    - flushed_face
  material_tokens: []
  camera_tokens:
    - first_person
  environment_tokens:
    - luxury_bathroom
  discarded_tokens: []
shot_graph:
  camera:
    angle: slight_downward
    distance: intimate_distance
    lens: 35mm
    framing: tight_medium
    dof: shallow_dof
  subject_blocking:
    primary: lina
    body_orientation: away_from_camera
    face_visibility: mirror_only
  frame_layout:
    mirror_centered: true
  pov_constraints:
    - no_player_body
`;

  const split = splitVisualDirectorYaml(raw);
  assert.ok(split);
  assert.match(split!.tokensYaml, /subject_tokens:/);
  assert.match(split!.tokensYaml, /flushed_face/);
  assert.match(split!.shotYaml, /^camera:/m);
  assert.match(split!.shotYaml, /shallow_dof/);
});

test("splitVisualDirectorYaml returns null for invalid output", () => {
  assert.equal(splitVisualDirectorYaml("subject_tokens:\n  - red_hair"), null);
});
