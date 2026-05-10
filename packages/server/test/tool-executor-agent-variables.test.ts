import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCalls, type MetadataPatchInput } from "../src/services/tools/tool-executor.js";

function toolCall(name: string, args: Record<string, unknown>) {
  return {
    id: `${name}-1`,
    type: "function" as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

test("chat variable tools read and replace chat-scoped string values", async () => {
  let metadata: Record<string, unknown> = {};
  const onUpdateMetadata = async (patchOrUpdater: MetadataPatchInput) => {
    const patch = typeof patchOrUpdater === "function" ? await patchOrUpdater({ ...metadata }) : patchOrUpdater;
    metadata = { ...metadata, ...patch };
    return metadata;
  };

  const writeResults = await executeToolCalls([toolCall("write_chat_variable", { key: "plot.note", value: "first" })], {
    chatMeta: metadata,
    onUpdateMetadata,
  });

  assert.equal(writeResults[0]?.success, true);
  assert.deepEqual(metadata.agentVariables, { "plot.note": "first" });

  const replaceResults = await executeToolCalls(
    [toolCall("write_chat_variable", { key: "plot.note", value: "replacement" })],
    {
      chatMeta: metadata,
      onUpdateMetadata,
    },
  );
  const replacePayload = JSON.parse(replaceResults[0]!.result) as Record<string, unknown>;
  assert.equal(replacePayload.replaced, true);

  const readResults = await executeToolCalls([toolCall("read_chat_variable", { key: "plot.note" })], {
    chatMeta: metadata,
    onUpdateMetadata,
  });
  const readPayload = JSON.parse(readResults[0]!.result) as Record<string, unknown>;
  assert.deepEqual(readPayload, { key: "plot.note", value: "replacement", exists: true });
});

test("chat variable tools reject missing keys and unavailable metadata writes", async () => {
  const missingKey = await executeToolCalls([toolCall("read_chat_variable", { key: " " })], {
    chatMeta: {},
  });
  assert.match(missingKey[0]!.result, /non-empty string/);

  const unavailableWrite = await executeToolCalls([toolCall("write_chat_variable", { key: "x", value: "y" })], {
    chatMeta: {},
  });
  assert.match(unavailableWrite[0]!.result, /metadata updates are not available/);
});
