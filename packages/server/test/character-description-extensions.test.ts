import test from "node:test";
import assert from "node:assert/strict";
import type { CharacterData } from "@marinara-engine/shared";
import { getCharacterDescriptionWithExtensions } from "../src/services/prompt/character-description-extensions.js";

function characterWithExtensions(altDescriptions: CharacterData["extensions"]["altDescriptions"]): CharacterData {
  return {
    name: "Aster",
    description: "Base description.",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    tags: [],
    creator: "",
    character_version: "1.0",
    alternate_greetings: [],
    extensions: {
      talkativeness: 0.5,
      fav: false,
      world: "",
      depth_prompt: { prompt: "", depth: 4, role: "system" },
      backstory: "",
      appearance: "",
      altDescriptions,
    },
    character_book: null,
  };
}

test("character description extensions append only active content", () => {
  const data = characterWithExtensions([
    { id: "combat", label: "Combat", active: true, content: "Uses ritual knives." },
    { id: "secret", label: "Secret", active: false, content: "Hidden betrayal." },
    { id: "empty", label: "Empty", active: true, content: "  " },
  ]);

  assert.equal(getCharacterDescriptionWithExtensions(data), "Base description.\nUses ritual knives.");
});
