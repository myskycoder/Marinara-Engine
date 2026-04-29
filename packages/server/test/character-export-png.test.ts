import test from "node:test";
import assert from "node:assert/strict";
import { createMinimalPng, injectTextChunk } from "../src/routes/characters.routes.js";

function readTextChunks(png: Buffer): Array<{ type: string; keyword: string; text: string }> {
  const chunks: Array<{ type: string; keyword: string; text: string }> = [];
  let offset = 8;

  while (offset < png.length) {
    const chunkLen = png.readUInt32BE(offset);
    const chunkType = png.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkData = png.subarray(offset + 8, offset + 8 + chunkLen);

    if (chunkType === "tEXt") {
      const nullIdx = chunkData.indexOf(0);
      if (nullIdx > 0) {
        chunks.push({
          type: chunkType,
          keyword: chunkData.subarray(0, nullIdx).toString("latin1"),
          text: chunkData.subarray(nullIdx + 1).toString("latin1"),
        });
      }
    }

    offset += 12 + chunkLen;
    if (chunkType === "IEND") break;
  }

  return chunks;
}

test("injectTextChunk replaces existing embedded chara payloads instead of preserving stale ones", () => {
  const avatarWithMetadata = injectTextChunk(
    injectTextChunk(createMinimalPng(), "comment", "keep-me"),
    "chara",
    "old-character-card",
  );

  const exported = injectTextChunk(avatarWithMetadata, "chara", "new-character-card");
  const textChunks = readTextChunks(exported);

  assert.deepEqual(
    textChunks.map((chunk) => [chunk.keyword, chunk.text]),
    [
      ["comment", "keep-me"],
      ["chara", "new-character-card"],
    ],
  );
});

test("injectTextChunk strips legacy ccv3 payloads before exporting a new chara payload", () => {
  const avatarWithLegacyCard = injectTextChunk(createMinimalPng(), "ccv3", "legacy-v3-card");
  const exported = injectTextChunk(avatarWithLegacyCard, "chara", "new-v2-card");
  const textChunks = readTextChunks(exported);

  assert.deepEqual(
    textChunks.map((chunk) => [chunk.keyword, chunk.text]),
    [["chara", "new-v2-card"]],
  );
});
