import test from "node:test";
import assert from "node:assert/strict";
import {
  comfyWorkflowExpectsBackgroundReference,
  comfyWorkflowFieldsFromConnection,
  countActiveComfyReferenceImages,
  describeComfyWorkflowVariant,
  resolveActiveComfyWorkflow,
} from "../src/services/image/comfy-workflow.js";

const noRef = '{"prompt":"no-ref"}';
const withRef = '{"prompt":"with-ref","image":"%reference_image_name%"}';

test("resolveActiveComfyWorkflow picks with-reference workflow when referenceImage is present", () => {
  assert.equal(
    resolveActiveComfyWorkflow({
      comfyWorkflow: noRef,
      comfyWorkflowWithReference: withRef,
      referenceImage: "abc123",
    }),
    withRef,
  );
});

test("resolveActiveComfyWorkflow picks with-reference workflow when referenceImages is non-empty", () => {
  assert.equal(
    resolveActiveComfyWorkflow({
      comfyWorkflow: noRef,
      comfyWorkflowWithReference: withRef,
      referenceImages: ["abc123"],
    }),
    withRef,
  );
});

test("resolveActiveComfyWorkflow picks no-reference workflow when no reference is attached", () => {
  assert.equal(
    resolveActiveComfyWorkflow({
      comfyWorkflow: noRef,
      comfyWorkflowWithReference: withRef,
    }),
    noRef,
  );
});

test("resolveActiveComfyWorkflow falls back to legacy comfyWorkflow when with-reference slot is empty", () => {
  assert.equal(
    resolveActiveComfyWorkflow({
      comfyWorkflow: noRef,
      referenceImage: "abc123",
    }),
    noRef,
  );
});

test("resolveActiveComfyWorkflow falls back to with-reference workflow when no-reference slot is empty", () => {
  assert.equal(
    resolveActiveComfyWorkflow({
      comfyWorkflowWithReference: withRef,
    }),
    withRef,
  );
});

test("resolveActiveComfyWorkflow returns undefined when both slots are empty", () => {
  assert.equal(resolveActiveComfyWorkflow({}), undefined);
});

test("resolveActiveComfyWorkflow picks negative workflow when preferNegativeWorkflow is set", () => {
  const withNeg = '{"prompt":"with-neg","negative":"%negative_prompt%","ref":"%reference_image_name%"}';
  assert.equal(
    resolveActiveComfyWorkflow({
      comfyWorkflow: noRef,
      comfyWorkflowWithReference: withRef,
      comfyWorkflowWithNegative: withNeg,
      referenceImage: "abc123",
      preferNegativeWorkflow: true,
    }),
    withNeg,
  );
});

test("comfyWorkflowFieldsFromConnection maps new workflow slots", () => {
  assert.deepEqual(
    comfyWorkflowFieldsFromConnection({
      comfyuiWorkflow: '{"a":1}',
      comfyuiWorkflowWithReference: '{"b":2}',
      comfyuiWorkflowWithNegative: '{"c":3}',
      comfyuiSplitReferenceWorkflow: '{"d":4}',
    }),
    {
      comfyWorkflow: '{"a":1}',
      comfyWorkflowWithReference: '{"b":2}',
      comfyWorkflowWithNegative: '{"c":3}',
      comfyWorkflowSplitReference: '{"d":4}',
    },
  );
});

test("comfyWorkflowFieldsFromConnection maps connection fields onto request spread fields", () => {
  assert.deepEqual(
    comfyWorkflowFieldsFromConnection({
      comfyuiWorkflow: '{"a":1}',
      comfyuiWorkflowWithReference: '{"b":2}',
    }),
    {
      comfyWorkflow: '{"a":1}',
      comfyWorkflowWithReference: '{"b":2}',
    },
  );
});

test("comfyWorkflowFieldsFromConnection omits empty/null connection values", () => {
  assert.deepEqual(
    comfyWorkflowFieldsFromConnection({ comfyuiWorkflow: null, comfyuiWorkflowWithReference: "" }),
    {},
  );
});

test("describeComfyWorkflowVariant labels explicit with-reference selection", () => {
  assert.equal(
    describeComfyWorkflowVariant({
      comfyWorkflow: "{}",
      comfyWorkflowWithReference: '{"ref":true}',
      referenceImage: "x",
    }),
    "with-reference",
  );
});

test("describeComfyWorkflowVariant labels explicit no-reference selection", () => {
  assert.equal(
    describeComfyWorkflowVariant({
      comfyWorkflow: "{}",
      comfyWorkflowWithReference: '{"ref":true}',
    }),
    "no-reference",
  );
});

test("comfyWorkflowExpectsBackgroundReference detects background placeholder", () => {
  assert.equal(
    comfyWorkflowExpectsBackgroundReference('{"bg":"%background_reference_image_name%"}'),
    true,
  );
  assert.equal(comfyWorkflowExpectsBackgroundReference('{"ref":"%reference_image_name%"}'), false);
});

test("countActiveComfyReferenceImages counts only NPC ref for single-ref workflow", () => {
  assert.equal(
    countActiveComfyReferenceImages(
      {
        comfyWorkflowWithReference: '{"ref":"%reference_image_name%"}',
        referenceImages: ["npc-ref", "bg-ref"],
      },
      '{"ref":"%reference_image_name%"}',
    ),
    1,
  );
});

test("countActiveComfyReferenceImages counts NPC + background for dual-ref workflow", () => {
  assert.equal(
    countActiveComfyReferenceImages(
      {
        comfyWorkflowWithReference:
          '{"ref":"%reference_image_name%","bg":"%background_reference_image_name%"}',
        referenceImages: ["npc-ref", "bg-ref"],
      },
      '{"ref":"%reference_image_name%","bg":"%background_reference_image_name%"}',
    ),
    2,
  );
});

test("countActiveComfyReferenceImages returns 0 when workflow has no reference slots", () => {
  assert.equal(
    countActiveComfyReferenceImages(
      {
        comfyWorkflow: '{"prompt":"%prompt%"}',
        referenceImages: ["npc-ref"],
      },
      '{"prompt":"%prompt%"}',
    ),
    0,
  );
});
