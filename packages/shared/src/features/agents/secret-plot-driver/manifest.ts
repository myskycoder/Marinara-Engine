import type { BuiltInAgentManifest } from "../agent-manifest.types.js";

export const secretPlotDriverAgentManifest = {
  id: "secret-plot-driver",
  name: "Secret Plot Driver",
  description:
    "Secretly develops an overarching story arc and scene directions behind the scenes. The user never sees the actual plot — only a hint that something is unfolding. Creates long-term narrative structure with protagonist growth, mysteries, and pacing control.",
  phase: "pre_generation",
  enabledByDefault: false,
  defaultInjectAsSection: true,
  category: "writer",
  defaultTools: [],
} satisfies BuiltInAgentManifest;
