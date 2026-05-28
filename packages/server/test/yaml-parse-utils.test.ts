import assert from "node:assert/strict";
import test from "node:test";
import { splitVisualDirectorYaml } from "@marinara-engine/shared";
import {
  inferExpressionTokensFromSceneYaml,
  parseSceneAstFromLegacyYaml,
  parseShotGraphYaml,
  parseVisualTokenBundleYaml,
} from "../src/services/game/visual-prompt/yaml-parse-utils.js";
import { assembleFluxPromptFromGraph } from "../src/services/game/visual-prompt/adapters/flux.adapter.js";
import { assemblePrompt } from "../src/services/game/visual-prompt/prompt-assembler.js";
import { applyTokenPostGates } from "../src/services/game/visual-prompt/token-post-gates.js";
import { validateSceneAst } from "@marinara-engine/shared";

const MERGED_DIRECTOR_OUTPUT = `visual_tokens:
  subject_tokens:
    - red_hair
    - black_cocktail_dress
    - black_dress_hiked_up
    - displaced_lace_panties
    - black_high_heels
    - bare_legs
  pose_tokens:
    - bent_over_marble_counter
    - arched_back
    - hands_on_sink_rim
  interaction_tokens:
    - rear_penetration
    - deep_rhythm
    - player_hands_on_hips
  composition_tokens:
    - mirror_face_centered
    - face_mirror_only
    - hips_foreground
  expression_tokens:
    - flushed_face
    - tear_streaks
    - open_mouth
    - head_thrown_back
    - gasping
    - biting_lip
  material_tokens:
    - wet_skin
    - polished_marble
    - lace_lingerie
  camera_tokens:
    - first_person
    - intimate_distance
    - 35mm
    - shallow_dof
    - tight_medium
  environment_tokens:
    - luxury_bathroom
    - white_marble
    - gold_fixtures
    - glossy_tile
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
    hips_lower_center: true
    hands_lower_frame: true
    subject_fill: 0.7
  depth_layers:
    foreground:
      - player_hands
    midground:
      - hips
      - lower_back
    background:
      - mirror_face
  pov_constraints:
    - no_player_body
    - hands_at_frame_edge_only`;

test("parseVisualTokenBundleYaml reads indented merged Visual Director lists", () => {
  const split = splitVisualDirectorYaml(MERGED_DIRECTOR_OUTPUT);
  assert.ok(split);

  const bundle = parseVisualTokenBundleYaml(split!.tokensYaml);

  assert.deepEqual(bundle.subject_tokens.slice(0, 3), [
    "red_hair",
    "black_cocktail_dress",
    "black_dress_hiked_up",
  ]);
  assert.deepEqual(bundle.pose_tokens, ["bent_over_marble_counter", "arched_back", "hands_on_sink_rim"]);
  assert.equal(bundle.expression_tokens.length, 6);
  assert.ok(bundle.expression_tokens.includes("flushed_face"));
  assert.ok(bundle.expression_tokens.includes("tear_streaks"));
  assert.ok(bundle.expression_tokens.includes("open_mouth"));
  assert.deepEqual(bundle.environment_tokens.slice(0, 2), ["luxury_bathroom", "white_marble"]);
  assert.deepEqual(bundle.discarded_tokens, []);
});

test("parseVisualTokenBundleYaml does not merge sibling token sections", () => {
  const yaml = [
    "subject_tokens:",
    "    - red_hair",
    "  pose_tokens:",
    "    - bent_over_marble_counter",
    "  expression_tokens:",
    "    - flushed_face",
    "  interaction_tokens:",
    "    - rear_penetration",
  ].join("\n");

  const bundle = parseVisualTokenBundleYaml(yaml);
  assert.deepEqual(bundle.subject_tokens, ["red_hair"]);
  assert.deepEqual(bundle.pose_tokens, ["bent_over_marble_counter"]);
  assert.deepEqual(bundle.expression_tokens, ["flushed_face"]);
  assert.deepEqual(bundle.interaction_tokens, ["rear_penetration"]);
});

test("parseVisualTokenBundleYaml handles inline empty list and legacy 2-space items", () => {
  const yaml = [
    "subject_tokens:",
    "  - red_hair",
    "discarded_tokens: []",
    "pose_tokens:",
    "  - arched_back",
  ].join("\n");

  const bundle = parseVisualTokenBundleYaml(yaml);
  assert.deepEqual(bundle.subject_tokens, ["red_hair"]);
  assert.deepEqual(bundle.discarded_tokens, []);
  assert.deepEqual(bundle.pose_tokens, ["arched_back"]);
});

test("parseShotGraphYaml reads nested camera and depth layers with flexible indent", () => {
  const split = splitVisualDirectorYaml(MERGED_DIRECTOR_OUTPUT);
  const graph = parseShotGraphYaml(split!.shotYaml);

  assert.equal(graph.camera?.dof, "shallow_dof");
  assert.equal(graph.camera?.framing, "tight_medium");
  assert.equal(graph.subject_blocking?.face_visibility, "mirror_only");
  assert.equal(graph.frame_layout?.mirror_centered, true);
  assert.deepEqual(graph.depth_layers?.foreground, ["player_hands"]);
  assert.ok(graph.pov_constraints?.includes("no_player_body"));
});

test("merged director tokens produce expression phrases in Flux block 1", () => {
  const split = splitVisualDirectorYaml(MERGED_DIRECTOR_OUTPUT);
  const tokens = parseVisualTokenBundleYaml(split!.tokensYaml);
  const graph = parseShotGraphYaml(split!.shotYaml);
  const scene = validateSceneAst({ environment: { room: "luxury_bathroom" } });

  const { prompt } = assembleFluxPromptFromGraph({
    scene,
    tokens,
    shot: graph,
    style: { artStyle: "glossy anime", genre: "Romance", setting: "Nightclub" },
  });

  assert.match(prompt, /flushed face/i);
  assert.match(prompt, /tear streaks/i);
  assert.match(prompt, /open mouth/i);
  assert.match(prompt, /bent over marble counter/i);
  assert.match(prompt, /penetrated from behind/i);
});

test("merged director tokens keep expressions after clamp on typical audit-sized bundle", () => {
  const split = splitVisualDirectorYaml(MERGED_DIRECTOR_OUTPUT);
  const tokens = parseVisualTokenBundleYaml(split!.tokensYaml);
  const graph = parseShotGraphYaml(split!.shotYaml);
  const scene = validateSceneAst({ environment: { room: "luxury_bathroom" } });

  const result = assemblePrompt({
    scene,
    tokens: {
      ...tokens,
      subject_tokens: tokens.subject_tokens.slice(0, 2),
      material_tokens: tokens.material_tokens.slice(0, 1),
      environment_tokens: tokens.environment_tokens.slice(0, 1),
    },
    shot: graph,
    style: { artStyle: "glossy anime hentai", genre: "Romance", setting: "Nightclub" },
    family: "flux",
  });

  assert.match(result.positive, /flushed face/i);
  assert.match(result.positive, /tear streaks/i);
  assert.ok(result.positive.length <= 850);
});

test("inferExpressionTokensFromSceneYaml extracts slugs from Russian compiler YAML", () => {
  const sceneYaml = [
    "expressions:",
    "  - лицо Лины: рот приоткрыт, щёки красные, глаза блестят от слёз",
    "  - голова запрокинута вверх",
  ].join("\n");

  const slugs = inferExpressionTokensFromSceneYaml(sceneYaml);
  assert.ok(slugs.includes("flushed_face"));
  assert.ok(slugs.includes("tear_streaks"));
  assert.ok(slugs.includes("open_mouth"));
  assert.ok(slugs.includes("head_thrown_back"));
});

test("applyTokenPostGates falls back to scene YAML expressions when bundle is empty", () => {
  const sceneYaml = "expressions:\n  - рот приоткрыт, щёки красные, слёзы\n";
  const scene = parseSceneAstFromLegacyYaml(sceneYaml);
  const gated = applyTokenPostGates(
    {
      subject_tokens: [],
      pose_tokens: [],
      interaction_tokens: [],
      composition_tokens: [],
      material_tokens: [],
      camera_tokens: [],
      environment_tokens: [],
      discarded_tokens: [],
    },
    scene,
    { hasPenetration: false, hasMirror: false },
    sceneYaml,
  );

  assert.ok(gated.expression_tokens?.includes("flushed_face"));
  assert.ok(gated.expression_tokens?.includes("tear_streaks"));
  assert.ok(gated.expression_tokens?.includes("open_mouth"));
});
