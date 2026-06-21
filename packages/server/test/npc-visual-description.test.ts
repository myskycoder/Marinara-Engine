import test from "node:test";
import assert from "node:assert/strict";
import type { GameNpc, PresentCharacter } from "@marinara-engine/shared";
import {
  findPresentCharacterForNpc,
  hasExplicitOutfit,
  resolveNpcVisualDescription,
} from "../src/services/game/npc-visual-description.js";
import { buildNpcPortraitProviderPrompt } from "../src/services/game/game-asset-generation.js";
import { sanitizeNpcSpriteAppearanceSource } from "../src/services/game/npc-sprite-generation.service.js";

function baseNpc(overrides: Partial<GameNpc> = {}): GameNpc {
  return {
    id: "npc-1",
    name: "River",
    emoji: "👤",
    description: "",
    location: "Docks",
    reputation: 0,
    met: true,
    notes: [],
    ...overrides,
  };
}

function presentChar(overrides: Partial<PresentCharacter> = {}): PresentCharacter {
  return {
    characterId: "char-1",
    name: "River",
    emoji: "👤",
    mood: "neutral",
    appearance: null,
    outfit: null,
    thoughts: null,
    customFields: {},
    stats: [],
    ...overrides,
  };
}

test("resolveNpcVisualDescription prefers tracker outfit over stale card description", () => {
  const npc = baseNpc({
    description: "Appearance: tall woman with silver hair.\nOutfit: old red cloak.\nInitial mood: stern.",
  });
  const tracker = presentChar({ outfit: "white blouse, red neckerchief, dark skirt" });
  const visual = resolveNpcVisualDescription({ npc, presentCharacter: tracker });
  assert.match(visual, /Appearance: tall woman with silver hair/);
  assert.match(visual, /Outfit: white blouse, red neckerchief, dark skirt/);
  assert.doesNotMatch(visual, /old red cloak/);
  assert.doesNotMatch(visual, /Initial mood/);
});

test("resolveNpcVisualDescription merges plain narrative description with tracker outfit", () => {
  const npc = baseNpc({
    description: "Senior camp counselor, 24, strict, manga proportions, low bun.",
  });
  const tracker = presentChar({ outfit: "white blouse, red tie, pioneer uniform skirt" });
  const visual = resolveNpcVisualDescription({ npc, presentCharacter: tracker });
  assert.match(visual, /Appearance: Senior camp counselor/);
  assert.match(visual, /Outfit: white blouse, red tie/);
});

test("resolveNpcVisualDescription excludes mood and thoughts from structured description", () => {
  const npc = baseNpc({
    description:
      "Appearance: young boy with freckles.\nOutfit: camp clothes.\nInitial mood: amused.\nThoughts: curious about the counselor.",
  });
  const visual = resolveNpcVisualDescription({ npc });
  assert.match(visual, /Appearance: young boy with freckles/);
  assert.match(visual, /Outfit: camp clothes/);
  assert.doesNotMatch(visual, /Initial mood/);
  assert.doesNotMatch(visual, /Thoughts:/);
});

test("resolveNpcVisualDescription adds gender and pronouns when set on GameNpc", () => {
  const npc = baseNpc({
    description: "Appearance: tall woman.",
    gender: "female",
    pronouns: "she/her",
  });
  const visual = resolveNpcVisualDescription({ npc });
  assert.match(visual, /Gender: female/);
  assert.match(visual, /Pronouns: she\/her/);
});

test("resolveNpcVisualDescription uses sanitized override without tracker merge", () => {
  const npc = baseNpc({ description: "IGNORED CARD BODY" });
  const tracker = presentChar({ outfit: "tracker-only outfit" });
  const override =
    "Custom red cloak. Match the described gender, age, build, hair, and features exactly — do not invent attributes.";
  const visual = resolveNpcVisualDescription({
    npc,
    presentCharacter: tracker,
    appearanceOverride: override,
  });
  assert.match(visual, /Custom red cloak/);
  assert.doesNotMatch(visual, /IGNORED CARD BODY/);
  assert.doesNotMatch(visual, /tracker-only outfit/);
  assert.doesNotMatch(visual, /Match the described gender/);
});

test("findPresentCharacterForNpc matches prefix cluster names", () => {
  const npc = baseNpc({ name: "Марина Викторовна" });
  const hit = findPresentCharacterForNpc(npc, [presentChar({ name: "Марина" })]);
  assert.equal(hit?.name, "Марина");
});

test("sanitizeNpcSpriteAppearanceSource stays idempotent for prior spritePrompt fragments", () => {
  const noisy =
    "Tall woman. Match the described gender, age, build, hair, and features exactly — do not invent attributes.";
  assert.equal(sanitizeNpcSpriteAppearanceSource(noisy), "Tall woman");
});

test("hasExplicitOutfit detects Outfit lines in visual descriptions", () => {
  assert.equal(hasExplicitOutfit("Appearance: bald man\nOutfit: worn tunic"), true);
  assert.equal(hasExplicitOutfit("Appearance: bald man"), false);
});

test("buildNpcPortraitProviderPrompt discourages invented armor when outfit is missing", async () => {
  const compiled = await buildNpcPortraitProviderPrompt({
    chatId: "chat-1",
    npcId: "npc-1",
    npcName: "Dock Worker",
    appearance: "Appearance: middle-aged man, bald, with a scar across his eyebrow",
    imgModel: "",
    imgBaseUrl: "",
    imgApiKey: "",
  });
  assert.match(compiled.prompt, /Plain simple everyday clothing/i);
  assert.match(compiled.negativePrompt, /armor/i);
  assert.doesNotMatch(compiled.prompt, /clear outfit cues/i);
});
