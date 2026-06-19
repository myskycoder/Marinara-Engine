import type { BuiltInAgentManifest } from "../agent-manifest.types.js";

export const expressionAgentManifest = {
  id: "expression",
  name: "Expression Engine",
  description: "Detects character emotions and selects VN sprites/expressions.",
  phase: "post_processing",
  enabledByDefault: false,
  category: "tracker",
  defaultTools: ["set_expression"],
} satisfies BuiltInAgentManifest;
