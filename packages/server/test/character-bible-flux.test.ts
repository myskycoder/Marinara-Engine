import assert from "node:assert/strict";
import test from "node:test";
import { validateVisualTokenBundle } from "@marinara-engine/shared";
import { buildCharacterBible, applyCharacterBible } from "../src/services/game/visual-prompt/character-bible.js";

test("character bible keeps flux slugs for flux family", () => {
  const bible = buildCharacterBible(["Lina"], ["Lina: red hair, black cocktail dress"], "flux");
  const tokens = applyCharacterBible(validateVisualTokenBundle({ subject_tokens: [] }), bible, "flux");
  assert.ok(tokens.subject_tokens.includes("black_cocktail_dress"));
  assert.ok(!tokens.subject_tokens.includes("black_dress"));
});

test("character bible maps to booru tags for booru family", () => {
  const bible = buildCharacterBible(["Lina"], ["Lina: red hair, black cocktail dress"], "pony");
  const tokens = applyCharacterBible(validateVisualTokenBundle({ subject_tokens: [] }), bible, "pony");
  assert.ok(tokens.subject_tokens.includes("black_dress"));
});
