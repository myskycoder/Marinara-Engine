import type { BuiltInAgentManifest } from "../agent-manifest.types.js";

export const questAgentManifest = {
  id: "quest",
  name: "Quest Tracker",
  description: "Manages quest objectives, completion states, and rewards.",
  phase: "post_processing",
  enabledByDefault: false,
  defaultInjectAsSection: true,
  category: "tracker",
  defaultTools: ["update_game_state"],
} satisfies BuiltInAgentManifest;
