import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMentionedNpcNames,
  isFullSceneIllustrationRequest,
  isIllustrationReferenceSubject,
  resolveIllustrationFocusNames,
} from "../src/services/game/illustration-character-focus.js";

test("isIllustrationReferenceSubject excludes player aliases", () => {
  assert.equal(isIllustrationReferenceSubject("Player"), false);
  assert.equal(isIllustrationReferenceSubject("Штерн"), true);
});

test("extractMentionedNpcNames reads VN bracket tags and skips mood flags", () => {
  const known = ["Штерн", "Волкова", "Player"];
  const text = '[Штерн] [blushing]: "Ты..." [main] [embarrassed] She touches shoulder.';
  const names = extractMentionedNpcNames(text, known);
  assert.deepEqual(names, ["Штерн"]);
});

test("resolveIllustrationFocusNames prioritizes draft mentions over stale tracker", () => {
  const names = resolveIllustrationFocusNames({
    draftText: '[Штерн] [blushing]: intimate moment in office',
    presentTrackedNames: ["Волкова", "Штерн", "Комиссар Железнова"],
    knownNames: ["Штерн", "Волкова", "Комиссар Железнова", "Player"],
    limit: 4,
  });
  assert.equal(names[0], "Штерн");
  assert.ok(!names.includes("Player"));
});

test("extractMentionedNpcNames skips crying and thought mood tags", () => {
  const known = ["Лина", "Игорь", "Player"];
  const text =
    '[Лина] [main] [crying]: "О бо-же..." [Лина] [thought] [blushing]: Плевать на время.';
  const names = extractMentionedNpcNames(text, known);
  assert.deepEqual(names, ["Лина"]);
});

test("extractMentionedNpcNames skips whisper channel tags", () => {
  const known = ["Лина", "Player"];
  const text = '[Лина] [whisper:"User"] [crying]: "Сильнее..."';
  const names = extractMentionedNpcNames(text, known);
  assert.deepEqual(names, ["Лина"]);
});

test("extractMentionedNpcNames keeps side NPC with neutral expression", () => {
  const known = ["Игорь", "Лина", "Player"];
  const text = '[Игорь] [side] [neutral]: "Время."';
  const names = extractMentionedNpcNames(text, known);
  assert.deepEqual(names, ["Игорь"]);
});

test("isFullSceneIllustrationRequest detects Full SFW/NSFW gallery requests", () => {
  assert.equal(
    isFullSceneIllustrationRequest({
      prompt:
        "Player-requested VN CG still: third-person wide-shot scene illustration of the exact moment below. The player protagonist IS visible alongside the rest of the cast in frame.",
      reason: "Player requested full-scene NSFW illustration (Full NSFW) from gallery",
      slug: "manual-full-nsfw-abc123",
    }),
    true,
  );
  assert.equal(
    isFullSceneIllustrationRequest({
      prompt: "Player-requested VN CG still: exact moment below, first-person view.",
      reason: "Player requested extra NSFW illustration (+1) from gallery",
      slug: "manual-fp-nsfw-abc123",
    }),
    false,
  );
});
