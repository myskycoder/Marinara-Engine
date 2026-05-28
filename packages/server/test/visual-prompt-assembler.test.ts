import assert from "node:assert/strict";
import test from "node:test";
import {
  validateSceneAst,
  validateVisualTokenBundle,
  validateShotGraph,
  VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT,
  SHOT_DIRECTOR_SYSTEM_PROMPT,
} from "@marinara-engine/shared";
import { applyTokenPostGates } from "../src/services/game/visual-prompt/token-post-gates.js";
import { assemblePrompt } from "../src/services/game/visual-prompt/prompt-assembler.js";
import { assembleNegativePrompt } from "../src/services/game/visual-prompt/negative-assembler.js";
import { applyCompositionConstraints, sanitizeAssembledPrompt } from "../src/services/game/visual-prompt/constraint-engine.js";
import { deriveShotGraphHeuristic } from "../src/services/game/visual-prompt/derive-shot-graph.js";
import { buildCharacterBible, applyCharacterBible } from "../src/services/game/visual-prompt/character-bible.js";
import { parseSceneHints } from "../src/services/game/visual-prompt/scene-parser.js";

test("SceneAST / VisualTokenBundle / ShotGraph Zod schemas accept minimal valid payloads", () => {
  const scene = validateSceneAst({
    scene: { pov: "first_person", explicitness: "explicit" },
    interaction: { type: "rear_penetration", intensity: "deep" },
    composition: { face_via_mirror_only: true },
    avoid: ["third_person", "player_body_visible"],
  });
  assert.equal(scene.interaction?.type, "rear_penetration");

  const tokens = validateVisualTokenBundle({
    subject_tokens: ["red_hair"],
    interaction_tokens: ["rear_penetration"],
  });
  assert.ok(tokens.subject_tokens.includes("red_hair"));

  const shot = validateShotGraph({
    camera: { lens: "35mm", dof: "shallow" },
    pov_constraints: ["no_player_body", "hands_at_frame_edge_only"],
  });
  assert.ok(shot.pov_constraints?.includes("no_player_body"));
});

test("token post-gates inject penetration when scene AST implies rear_penetration", () => {
  const scene = validateSceneAst({
    interaction: { type: "rear_penetration", intensity: "deep" },
    composition: { face_via_mirror_only: true },
  });
  const tokens = validateVisualTokenBundle({ subject_tokens: ["red_hair"], pose_tokens: ["bent_over_sink"] });
  const hints = parseSceneHints("deep rhythm from behind", []);
  const gated = applyTokenPostGates(tokens, scene, hints);
  assert.ok(gated.interaction_tokens.includes("rear_penetration"));
  assert.ok(gated.interaction_tokens.includes("deep_rhythm"));
  assert.ok(gated.composition_tokens.includes("face_mirror_only"));
});

test("v4 Flux assembler uses fixed order and no Cyrillic in output", () => {
  const scene = validateSceneAst({
    scene: { pov: "first_person" },
    environment: { room: "luxury_bathroom" },
    avoid: ["third_person"],
  });
  const tokens = validateVisualTokenBundle({
    subject_tokens: ["red_hair", "black_cocktail_dress"],
    pose_tokens: ["bent_over_sink", "arched_back", "hands_on_sink_rim"],
    interaction_tokens: ["rear_penetration", "deep_rhythm", "player_hands_on_hips"],
    composition_tokens: ["mirror_face_centered", "face_mirror_only"],
    material_tokens: ["wet_skin", "polished_marble"],
    camera_tokens: ["first_person", "35mm", "shallow_dof"],
    environment_tokens: ["luxury_bathroom"],
  });
  const shot = deriveShotGraphHeuristic(scene, tokens);
  const result = assemblePrompt({
    scene,
    tokens,
    shot,
    style: { artStyle: "glossy anime", genre: "Romance", setting: "Nightclub" },
    family: "flux",
  });

  assert.match(result.positive, /first-person POV/i);
  assert.match(result.positive, /penetrated from behind/i);
  assert.match(result.positive, /mirror reflection/i);
  assert.doesNotMatch(result.positive, /nightclub setting/i);
  assert.doesNotMatch(result.positive, /[\u0400-\u04FF]/);
  assert.equal(result.metadata.assembly, "deterministic");
  assert.equal(result.metadata.pipelineVersion, "v4");
});

test("negative assembler merges scene avoid and pov constraints", () => {
  const scene = validateSceneAst({ avoid: ["third_person", "player_body_visible"] });
  const shot = validateShotGraph({ pov_constraints: ["no_player_body", "hands_at_frame_edge_only"] });
  const negative = assembleNegativePrompt({ scene, shot, baseNegative: "low quality" });
  assert.match(negative, /third person/i);
  assert.match(negative, /player body visible/i);
  assert.match(negative, /extra limbs/i);
  assert.match(negative, /low quality/i);
});

test("constraint engine strips euphemism leaks and injects mirror constraint", () => {
  const tokens = validateVisualTokenBundle({
    composition_tokens: ["face_mirror_only"],
    pose_tokens: ["hands_on_sink_rim"],
  });
  const shot = validateShotGraph({
    subject_blocking: { face_visibility: "mirror_only" },
    frame_layout: { mirror_centered: true },
    pov_constraints: ["no_player_body", "hands_at_frame_edge_only"],
  });
  const raw = "first-person POV, intimate encounter, in climax, mirror scene";
  const sanitized = sanitizeAssembledPrompt(raw);
  assert.doesNotMatch(sanitized, /intimate encounter/i);
  assert.doesNotMatch(sanitized, /in climax/i);

  const constrained = applyCompositionConstraints(sanitized, shot, tokens);
  assert.match(constrained.prompt, /mirror/i);
  assert.ok(constrained.injected.length > 0 || constrained.prompt.includes("mirror"));
});

test("constraint engine preserves block separators and comma before block 2", () => {
  const tokens = validateVisualTokenBundle({
    composition_tokens: ["face_mirror_only"],
  });
  const shot = validateShotGraph({
    subject_blocking: { face_visibility: "mirror_only" },
    frame_layout: { mirror_centered: true },
    pov_constraints: ["no_player_body", "hands_at_frame_edge_only"],
  });
  const raw = [
    "first-person POV, red-haired woman, penetrated from behind",
    "mirror reflection centered, narrow luxury bathroom",
  ].join("\n\n");

  const constrained = applyCompositionConstraints(raw, shot, tokens);
  assert.match(constrained.prompt, /\n\n/);
  assert.match(constrained.prompt, /limbs\n\nmirror reflection centered/i);
});

test("character bible merges stable appearance tokens for flux", () => {
  const bible = buildCharacterBible(["Лина"], ["Лина: red hair, black cocktail dress"], "flux");
  const tokens = applyCharacterBible(validateVisualTokenBundle({ subject_tokens: [] }), bible, "flux");
  assert.ok(tokens.subject_tokens.some((t) => /red/i.test(t)));
  assert.ok(tokens.subject_tokens.some((t) => t.includes("black_cocktail_dress")));
});

test("v4 system prompts mandate graph/token output not prose", () => {
  assert.match(VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT, /VisualTokenBundle YAML ONLY/i);
  assert.match(VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT, /rear_penetration/i);
  assert.match(SHOT_DIRECTOR_SYSTEM_PROMPT, /ShotGraph YAML ONLY/i);
  assert.match(SHOT_DIRECTOR_SYSTEM_PROMPT, /NEVER write final image prompt/i);
});
