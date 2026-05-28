import test from "node:test";
import assert from "node:assert/strict";
import type { GameNpcSpriteGeneration } from "@marinara-engine/shared";
import {
  buildNpcSpriteAppearancePrompt,
  buildNpcSpritePromptBundle,
  sanitizeNpcSpriteAppearanceSource,
} from "../src/services/game/npc-sprite-generation.service.js";
import {
  SPRITE_GEN_HISTORY_CAP,
  trimOldestRemovableSpriteGenerations,
} from "../src/services/game/npc-materializer.service.js";

test("buildNpcSpriteAppearancePrompt includes description, location, art style, and name", () => {
  const npc = {
    id: "npc-1",
    name: "River",
    emoji: "👤",
    description: "Tall woman with silver hair.",
    location: "Harbor docks",
    reputation: 0,
    met: true,
    notes: [],
  };
  const p = buildNpcSpriteAppearancePrompt(npc, "anime ink");
  assert.match(p, /Tall woman with silver hair/);
  assert.match(p, /Harbor docks/);
  assert.match(p, /anime ink/);
  assert.match(p, /River/);
});

test("buildNpcSpritePromptBundle embeds chosen full-body expression in fullBody prompt", () => {
  const npc = {
    id: "npc-1",
    name: "River",
    emoji: "👤",
    description: "Short red hair.",
    location: "Docks",
    reputation: 0,
    met: true,
    notes: [],
  };
  const bundle = buildNpcSpritePromptBundle(
    {
      chatId: "c1",
      npc,
      spriteId: "s1",
      expressions: ["neutral", "happy", "sad"],
      fullBodyExpression: "happy",
      artStyle: "Bright anime with dreamy lakeside backgrounds.",
      imgModel: "m",
      imgBaseUrl: "https://example.com",
      imgApiKey: "k",
    },
    ["neutral", "happy", "sad"],
  );
  assert.match(bundle.fullBody, /full_idle/);
  assert.match(bundle.fullBody, /"happy"/);
  assert.match(bundle.fullBody, /plain white void/);
  assert.match(bundle.fullBody, /VN game sprite style/);
  assert.match(bundle.fullBody, /cel-shaded/);
  assert.match(bundle.expressionSheet, /VN game sprite style/);
  assert.doesNotMatch(bundle.fullBody, /Current location context/);
  assert.doesNotMatch(bundle.fullBody, /multi-cell expression sheet/);
  assert.match(bundle.fullBody, /no scenery or backgrounds/);
});

test("sanitizeNpcSpriteAppearanceSource removes repeated sprite boilerplate", () => {
  const noisy =
    "Tall woman. Match the described gender, age, build, hair, and features exactly — do not invent attributes. Current location context: Docks. Art style: anime ink. Subject is named River (name is for reference only, the description above is authoritative).. Match the described gender, age, build, hair, and features exactly — do not invent attributes. Current location context: Docks. Art style: anime ink. Subject is named River (name is for reference only, the description above is authoritative).";
  const cleaned = sanitizeNpcSpriteAppearanceSource(noisy);
  assert.equal(cleaned, "Tall woman");
});

test("buildNpcSpriteAppearancePrompt is idempotent when override contains prior spritePrompt", () => {
  const npc = {
    id: "npc-1",
    name: "River",
    emoji: "👤",
    description: "Tall woman with silver hair.",
    location: "Harbor docks",
    reputation: 0,
    met: true,
    notes: [],
  };
  const prior = buildNpcSpriteAppearancePrompt(npc, "anime ink");
  const rebuilt = buildNpcSpriteAppearancePrompt(npc, "anime ink", prior);
  assert.equal(
    (rebuilt.match(/Match the described gender/g) ?? []).length,
    1,
  );
  assert.match(rebuilt, /Tall woman with silver hair/);
});

test("buildNpcSpriteAppearancePrompt keeps art style suffix when visual core is long", () => {
  const npc = {
    id: "npc-1",
    name: "River",
    emoji: "👤",
    description: "A".repeat(1500),
    location: "Harbor docks",
    reputation: 0,
    met: true,
    notes: [],
  };
  const p = buildNpcSpriteAppearancePrompt(npc, "anime ink");
  assert.match(p, /Art style: anime ink/);
  assert.match(p, /Match the described gender/);
});

test("buildNpcSpriteAppearancePrompt uses override instead of npc.description when provided", () => {
  const npc = {
    id: "npc-1",
    name: "River",
    emoji: "👤",
    description: "IGNORED BODY",
    location: "Harbor docks",
    reputation: 0,
    met: true,
    notes: [],
  };
  const p = buildNpcSpriteAppearancePrompt(npc, null, "Override red cloak.");
  assert.match(p, /Override red cloak/);
  assert.doesNotMatch(p, /IGNORED BODY/);
});

test("trimOldestRemovableSpriteGenerations drops oldest non-active rows until cap", () => {
  const active = "sheet-active";
  const rows: GameNpcSpriteGeneration[] = [];
  for (let i = 0; i < SPRITE_GEN_HISTORY_CAP + 3; i++) {
    rows.push({
      spriteId: `sheet-${i}`,
      createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      prompt: `p${i}`,
    });
  }
  rows.push({ spriteId: active, createdAt: "2026-02-01T00:00:00.000Z", prompt: "active" });

  const { next, removedSpriteIds } = trimOldestRemovableSpriteGenerations(rows, active);
  assert.equal(next.length, SPRITE_GEN_HISTORY_CAP);
  assert.ok(next.some((g) => g.spriteId === active));
  assert.equal(removedSpriteIds.length, rows.length - SPRITE_GEN_HISTORY_CAP);
  for (const id of removedSpriteIds) {
    assert.notEqual(id, active);
  }
});

test("trimOldestRemovableSpriteGenerations never removes the active id", () => {
  const active = "only";
  const rows: GameNpcSpriteGeneration[] = [{ spriteId: active, createdAt: "2026-01-01T00:00:00.000Z", prompt: "x" }];
  const { next, removedSpriteIds } = trimOldestRemovableSpriteGenerations(rows, active);
  assert.deepEqual(next, rows);
  assert.equal(removedSpriteIds.length, 0);
});
