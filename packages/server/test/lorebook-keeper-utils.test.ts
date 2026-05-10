import test from "node:test";
import assert from "node:assert/strict";
import {
  loadLorebookKeeperExistingEntries,
  mergeLorebookKeeperUpdateContent,
} from "../src/routes/generate/lorebook-keeper-utils.js";

test("loads existing lorebook entry content for Keeper context", async () => {
  const lorebooksStore = {
    async listEntries(lorebookId: string) {
      assert.equal(lorebookId, "book-1");
      return [
        {
          id: "entry-1",
          name: "Snezhnaya",
          content: "The city is built around a frozen harbor.",
          keys: ["Snezhnaya", "frozen harbor"],
          locked: false,
        },
      ];
    },
  } as unknown as Parameters<typeof loadLorebookKeeperExistingEntries>[0];

  const entries = await loadLorebookKeeperExistingEntries(lorebooksStore, "book-1");

  assert.deepEqual(entries, [
    {
      id: "entry-1",
      name: "Snezhnaya",
      content: "The city is built around a frozen harbor.",
      keys: ["Snezhnaya", "frozen harbor"],
      locked: false,
    },
  ]);
});

test("falls back to replacement content for older Lorebook Keeper update payloads", () => {
  const merged = mergeLorebookKeeperUpdateContent({
    existingContent: "Old content.",
    replacementContent: "Old content plus a model-merged addition.",
    newFacts: undefined,
  });

  assert.equal(merged, "Old content plus a model-merged addition.");
});

test("keeps legacy content-based updates append-only when old details are missing", () => {
  const merged = mergeLorebookKeeperUpdateContent({
    existingContent: "The old entry mentions a sealed blue door.",
    replacementContent: "The new scene reveals a silver key.",
    newFacts: undefined,
  });

  assert.equal(merged, "The old entry mentions a sealed blue door.\n\nThe new scene reveals a silver key.");
});
