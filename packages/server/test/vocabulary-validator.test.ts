import assert from "node:assert/strict";
import test from "node:test";
import { validateVisualTokenBundle } from "@marinara-engine/shared";
import { validateTokenBundle } from "../src/services/game/visual-prompt/vocabulary-validator.js";

test("vocabulary validator maps synonyms to canonical slugs", () => {
  const tokens = validateVisualTokenBundle({
    pose_tokens: ["pressed_against_marble_counter"],
    material_tokens: ["cold_polished_marble"],
    camera_tokens: ["tight_medium_framing"],
  });
  const result = validateTokenBundle(tokens, "flux");
  assert.ok(result.tokens.pose_tokens.includes("bent_over_marble_counter"));
  assert.ok(result.tokens.material_tokens.includes("polished_marble"));
  assert.ok(result.tokens.camera_tokens.includes("tight_medium"));
});

test("vocabulary validator records unknown slugs as misses", () => {
  const tokens = validateVisualTokenBundle({
    subject_tokens: ["unknown_garbage_token_xyz"],
  });
  const result = validateTokenBundle(tokens, "flux");
  assert.equal(result.missCount, 1);
  assert.ok(result.misses.some((m) => m.includes("unknown_garbage_token_xyz")));
});

test("intimate_distance is known after vocabulary expansion", () => {
  const tokens = validateVisualTokenBundle({ camera_tokens: ["intimate_distance"] });
  const result = validateTokenBundle(tokens, "flux");
  assert.equal(result.missCount, 0);
});
