import assert from "node:assert/strict";
import test from "node:test";
import { validateSceneAst, validateShotGraph, validateVisualTokenBundle } from "@marinara-engine/shared";
import {
  assembleFluxPromptFromGraph,
  clampFluxPromptByPriority,
} from "../src/services/game/visual-prompt/adapters/flux.adapter.js";
import { deriveShotGraphHeuristic } from "../src/services/game/visual-prompt/derive-shot-graph.js";
import { assemblePrompt } from "../src/services/game/visual-prompt/prompt-assembler.js";

test("flux adapter deduplicates camera tokens between pov and shot graph", () => {
  const scene = validateSceneAst({ environment: { room: "luxury_bathroom" } });
  const tokens = validateVisualTokenBundle({
    subject_tokens: ["red_hair"],
    pose_tokens: ["bent_over_marble_counter"],
    interaction_tokens: ["rear_penetration"],
    camera_tokens: ["first_person", "35mm", "shallow_dof", "tight_medium_framing"],
    environment_tokens: ["luxury_bathroom"],
  });
  const shot = validateShotGraph({
    camera: { lens: "35mm", framing: "tight_medium", dof: "shallow", distance: "intimate" },
    pov_constraints: ["no_player_body"],
  });

  const result = assembleFluxPromptFromGraph({ scene, tokens, shot, style: {} });
  const block1 = result.prompt.split("\n\n")[0] ?? "";
  const lensMatches = block1.match(/35mm lens/gi) ?? [];
  assert.equal(lensMatches.length, 1, `expected one 35mm lens, got: ${block1}`);
  assert.match(block1, /shallow depth of field/i);
  assert.ok(result.cameraDuplicatesRemoved >= 1);
});

test("flux adapter includes expression tokens in block 1", () => {
  const scene = validateSceneAst({});
  const tokens = validateVisualTokenBundle({
    subject_tokens: ["red_hair"],
    expression_tokens: ["flushed_face", "tear_streaks"],
    interaction_tokens: ["rear_penetration"],
    camera_tokens: ["first_person"],
  });
  const shot = deriveShotGraphHeuristic(scene, tokens);
  const result = assembleFluxPromptFromGraph({ scene, tokens, shot, style: {} });
  assert.match(result.prompt, /flushed face/i);
  assert.match(result.prompt, /tear streaks/i);
});

test("flux clamp preserves expression tokens over interaction when over limit", () => {
  const scene = validateSceneAst({
    environment: { room: "luxury_bathroom" },
  });
  const tokens = validateVisualTokenBundle({
    subject_tokens: ["red_hair", "black_cocktail_dress", "long_red_hair", "black_high_heels", "bare_legs"],
    pose_tokens: ["bent_over_marble_counter", "arched_back", "hands_gripping_counter_edge", "knees_spread"],
    expression_tokens: ["flushed_face", "tear_streaks", "open_mouth", "gasping"],
    interaction_tokens: ["rear_penetration", "deep_rhythm", "player_hands_on_hips"],
    composition_tokens: ["mirror_face_centered", "face_mirror_only", "hips_foreground"],
    material_tokens: ["wet_skin", "polished_marble", "glossy_tile", "gold_fixtures"],
    camera_tokens: ["first_person", "35mm", "shallow_dof", "tight_medium_framing"],
    environment_tokens: ["luxury_bathroom", "white_marble_surfaces", "mirror_reflection"],
  });
  const shot = validateShotGraph({
    camera: { lens: "35mm", framing: "tight_medium", dof: "shallow_dof", distance: "intimate_distance" },
    subject_blocking: { face_visibility: "mirror_only" },
    frame_layout: { mirror_centered: true },
    pov_constraints: ["no_player_body", "hands_at_frame_edge_only"],
  });

  const assembled = assemblePrompt({
    scene,
    tokens,
    shot,
    style: {
      artStyle:
        "Glossy anime hentai style, soft neon lighting, detailed character art with expressive eyes, vibrant nightclub palette of purple, pink and gold, sensual atmosphere, semi-realistic backgrounds",
      genre: "Romance, harem, seduction",
      setting: "Nightclub",
    },
    family: "flux",
  });

  assert.match(assembled.positive, /flushed face/i);
  assert.match(assembled.positive, /tear streaks/i);
  assert.ok(assembled.positive.length <= 850);
  assert.doesNotMatch(assembled.positive, /nightclub palette/i);
  assert.doesNotMatch(assembled.positive, /\bharem\b/i);
});

test("clampFluxPromptByPriority keeps block separators", () => {
  const prompt = [
    "first-person POV, 35mm lens, flushed face, tear streaks",
    "mirror reflection centered, narrow luxury bathroom",
    "glossy anime realism, cinematic VN CG framing, anime illustration",
  ].join("\n\n");

  const clamped = clampFluxPromptByPriority(prompt, 850);
  assert.match(clamped, /\n\n/);
});
