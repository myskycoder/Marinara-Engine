import test from "node:test";
import assert from "node:assert/strict";
import { parseGameJsonish } from "../src/services/game/jsonish.js";

test("game JSON parser repairs a missing comma between generated setup properties", () => {
  const parsed = parseGameJsonish(`{
    "worldOverview": "A veil has ripped across the city.",
    "storyArc": "Find the Harmonic Siphon before the veil collapses."
    "plotTwists": [
      "The Siphon was built as a safety measure."
    ]
  }`) as Record<string, unknown>;

  assert.equal(parsed.storyArc, "Find the Harmonic Siphon before the veil collapses.");
  assert.deepEqual(parsed.plotTwists, ["The Siphon was built as a safety measure."]);
});

test("game JSON parser ignores comments and trailing commas in model JSON", () => {
  const parsed = parseGameJsonish(`{
    // model note
    "storyArc": "Open the sealed door",
    "plotTwists": ["The lock is alive",],
  }`) as Record<string, unknown>;

  assert.equal(parsed.storyArc, "Open the sealed door");
  assert.deepEqual(parsed.plotTwists, ["The lock is alive"]);
});
