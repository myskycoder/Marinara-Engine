import test from "node:test";
import assert from "node:assert/strict";
import { resolveDialogueFullBodyPose } from "../../client/src/lib/game-full-body-pose.ts";

test("resolveDialogueFullBodyPose prefers matching emotion when full_* sprite exists", () => {
  const sprites = [{ expression: "full_happy" }, { expression: "full_idle" }];
  assert.equal(resolveDialogueFullBodyPose("happy", sprites), "happy");
});

test("resolveDialogueFullBodyPose falls back to idle when emotion missing", () => {
  const sprites = [{ expression: "full_neutral" }, { expression: "full_idle" }];
  assert.equal(resolveDialogueFullBodyPose("angry", sprites), "idle");
});

test("resolveDialogueFullBodyPose maps thinking to thinking then idle", () => {
  const sprites = [{ expression: "full_thinking" }, { expression: "full_idle" }];
  assert.equal(resolveDialogueFullBodyPose("thinking", sprites), "thinking");
  const idleOnly = [{ expression: "full_idle" }];
  assert.equal(resolveDialogueFullBodyPose("thinking", idleOnly), "idle");
});
