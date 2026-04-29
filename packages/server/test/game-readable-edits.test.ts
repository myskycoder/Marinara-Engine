import test from "node:test";
import assert from "node:assert/strict";
import { createJournal, addNoteEntry } from "../src/services/game/journal.service.js";
import { applySegmentEdits } from "../src/services/game/segment-edits.js";

test("addNoteEntry updates an existing readable by source segment instead of duplicating it", () => {
  const initial = addNoteEntry(createJournal(), "Note", "Old wording", {
    readableType: "note",
    sourceMessageId: "msg-1",
    sourceSegmentIndex: 2,
  });

  const updated = addNoteEntry(initial, "Note", "Corrected wording", {
    readableType: "note",
    sourceMessageId: "msg-1",
    sourceSegmentIndex: 2,
  });

  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0]?.content, "Corrected wording");
  assert.equal(updated.entries[0]?.sourceMessageId, "msg-1");
  assert.equal(updated.entries[0]?.sourceSegmentIndex, 2);
  assert.equal(updated.entries[0]?.readableType, "note");
});

test("applySegmentEdits rebuilds readable tags with edited content", () => {
  const content = [
    "The drawer sticks for a second before it opens.",
    "",
    "[Note: The old passphrase is carved into the underside of the desk.]",
  ].join("\n");

  const edited = applySegmentEdits(content, {
    1: {
      readableContent: "The new passphrase is hidden under the bronze lamp.",
      readableType: "note",
    },
  });

  assert.match(edited, /\[Note: The new passphrase is hidden under the bronze lamp\.\]/);
  assert.doesNotMatch(edited, /old passphrase/);
});
