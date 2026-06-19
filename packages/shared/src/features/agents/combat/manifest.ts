import type { BuiltInAgentManifest } from "../agent-manifest.types.js";

export const combatAgentManifest = {
  id: "combat",
  name: "Combat",
  description: "Manages combat encounters, initiative, HP tracking, and turn-based actions.",
  phase: "parallel",
  enabledByDefault: false,
  category: "misc",
  defaultTools: ["roll_dice", "update_game_state"],
} satisfies BuiltInAgentManifest;
