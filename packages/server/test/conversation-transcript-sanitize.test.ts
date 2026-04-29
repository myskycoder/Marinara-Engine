import test from "node:test";
import assert from "node:assert/strict";
import { stripConversationPromptTimestamps } from "../src/services/conversation/transcript-sanitize.js";

test("strips leading prompt timestamps from conversation text", () => {
  assert.equal(stripConversationPromptTimestamps("[12:01] Dottore said hello."), "Dottore said hello.");
  assert.equal(stripConversationPromptTimestamps("Dottore: [12:01] We should begin."), "Dottore: We should begin.");
});

test("removes date wrappers when conversation context crosses into roleplay", () => {
  const content = `<date="27.04.2026">\n[27.04.2026] Mari: [23:59] Let's move this into the scene.\n</date>`;

  assert.equal(stripConversationPromptTimestamps(content), "Mari: Let's move this into the scene.");
});
