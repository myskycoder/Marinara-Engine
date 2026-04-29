import test from "node:test";
import assert from "node:assert/strict";
import type { SceneAnalysis } from "@marinara-engine/shared";
import { postProcessSceneResult } from "../src/services/sidecar/scene-postprocess.js";

test("scene postprocess preserves valid cinematic directions and drops invalid ones", () => {
  const raw: SceneAnalysis = {
    background: null,
    music: null,
    ambient: null,
    weather: null,
    timeOfDay: null,
    reputationChanges: [],
    widgetUpdates: [],
    segmentEffects: [],
    directions: [
      {
        effect: "flash",
        duration: 2,
        intensity: 1.5,
        params: { color: "#fff", empty: "" },
      },
      {
        effect: "screen_shake",
        duration: -5,
        target: "all",
      },
      {
        effect: "not_real",
        duration: 1,
      } as any,
    ],
  };

  const result = postProcessSceneResult(raw, {
    availableBackgrounds: [],
    availableSfx: [],
    validWidgetIds: new Set(),
    characterNames: [],
  });

  assert.deepEqual(result.directions, [
    {
      effect: "flash",
      duration: 2,
      intensity: 1,
      params: { color: "#fff" },
    },
    {
      effect: "screen_shake",
      target: "all",
    },
  ]);
});
