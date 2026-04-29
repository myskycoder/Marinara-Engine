import test from "node:test";
import assert from "node:assert/strict";
import { dedupeSessionSummaryLists } from "../src/services/game/session-summary-normalization.js";

test("legacy revelations migrate into key discoveries", () => {
  const normalized = dedupeSessionSummaryLists({
    keyDiscoveries: ["The Regent controls the warding engine.", "A hidden sigil points to the catacombs."],
    legacyRevelations: ["The hidden archive is beneath the chapel."],
    characterMoments: [],
    littleDetails: [],
    npcUpdates: [],
  });

  assert.deepEqual(normalized.keyDiscoveries, [
    "The Regent controls the warding engine.",
    "A hidden sigil points to the catacombs.",
    "The hidden archive is beneath the chapel.",
  ]);
});

test("duplicate items collapse within and across summary fact buckets", () => {
  const normalized = dedupeSessionSummaryLists({
    keyDiscoveries: ["The vault is beneath the cathedral.", "The vault is beneath the cathedral"],
    legacyRevelations: ["The vault is beneath the cathedral."],
    characterMoments: ["Aster admitted she stole the relic.", "Aster admitted she stole the relic!"],
    littleDetails: ["Aster prefers cardamom tea.", "Aster prefers cardamom tea!"],
    npcUpdates: ["Captain Vale now distrusts the party.", "Captain Vale now distrusts the party."],
  });

  assert.deepEqual(normalized.keyDiscoveries, ["The vault is beneath the cathedral."]);
  assert.deepEqual(normalized.characterMoments, ["Aster admitted she stole the relic."]);
  assert.deepEqual(normalized.littleDetails, ["Aster prefers cardamom tea."]);
  assert.deepEqual(normalized.npcUpdates, ["Captain Vale now distrusts the party."]);
});
