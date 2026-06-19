import type { BuiltInAgentManifest } from "../agent-manifest.types.js";

export const worldStateAgentManifest = {
  id: "world-state",
  name: "World State",
  description: "Tracks date/time, weather, location, and present characters automatically.",
  phase: "post_processing",
  enabledByDefault: false,
  defaultInjectAsSection: true,
  category: "tracker",
  defaultTools: ["update_game_state"],
} satisfies BuiltInAgentManifest;
