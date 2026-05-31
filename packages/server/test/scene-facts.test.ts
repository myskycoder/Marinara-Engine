import assert from "node:assert/strict";
import test from "node:test";
import { parseFactsJson, validateFacts } from "../src/services/game/scene-facts.js";
import {
  buildExtractorUserMessage,
  validateComposedPrompt,
} from "../src/services/game/image-prompt-pipeline.js";

const sampleFacts = {
  pov: "first_person" as const,
  protagonist_visible: false,
  visible_body_parts: ["hands"],
  characters: [
    {
      name: "Лина",
      hair: "red",
      outfit: "black dress",
      garment_state: "dress hiked",
      expression: "crying",
      pose: "bent over counter",
    },
  ],
  action: "penetration from behind",
  location_id: "vip-room",
  location_label: "Mark Stone Penthouse VIP room",
  props: ["marble countertop", "mirror"],
  lighting: "soft neon",
  time_weather: "night, clear",
  offscreen: ["Igor behind the door"],
  mirror_shows: "her face in reflection",
  nsfw: true,
};

test("parseFactsJson strips code fences and surrounding text", () => {
  const raw = 'Here you go:\n```json\n{"pov":"first_person"}\n```\nDone.';
  const parsed = parseFactsJson(raw);
  assert.equal(parsed.pov, "first_person");
});

test("validateFacts rejects empty characters", () => {
  assert.throws(
    () => validateFacts({ ...sampleFacts, characters: [] }),
    /facts\.characters is empty/,
  );
});

test("validateFacts rejects empty action", () => {
  assert.throws(() => validateFacts({ ...sampleFacts, action: "" }), /facts\.action is empty/);
});

test("validateFacts rejects empty location_label", () => {
  assert.throws(
    () => validateFacts({ ...sampleFacts, location_label: "  " }),
    /facts\.location_label is empty/,
  );
});

test("validateComposedPrompt requires exactly 7 lines for flux family", () => {
  const sevenLines = Array.from({ length: 7 }, (_, i) => `Sentence ${i + 1}.`).join("\n");
  const result = validateComposedPrompt(sevenLines, "flux");
  assert.equal(result.split("\n").length, 7);

  const sixLines = Array.from({ length: 6 }, (_, i) => `Sentence ${i + 1}.`).join("\n");
  assert.throws(() => validateComposedPrompt(sixLines, "flux"), /expected exactly 7 non-empty lines/);
});

test("validateComposedPrompt accepts non-empty prose for non-flux families", () => {
  const prompt = "1girl, solo, long_hair, standing in a forest, detailed lighting";
  const result = validateComposedPrompt(prompt, "sdxl");
  assert.ok(result.includes("1girl"));
});

test("buildExtractorUserMessage includes draft and omits target_image_model", () => {
  const message = buildExtractorUserMessage({
    app: {} as never,
    chatId: "chat-1",
    draftPrompt: "Player-requested VN CG still: first-person view.",
    sceneContinuity: "Location: penthouse VIP room.",
    characters: ["Лина"],
    imageConn: {},
  });
  assert.match(message, /<draft_prompt>/);
  assert.match(message, /<scene_continuity>/);
  assert.doesNotMatch(message, /<target_image_model>/);
  assert.match(message, /Extract the visual facts/);
});

test("validateFacts accepts complete facts object", () => {
  const facts = validateFacts(sampleFacts);
  assert.equal(facts.location_label, "Mark Stone Penthouse VIP room");
  assert.equal(facts.characters.length, 1);
});
