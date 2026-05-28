import {
  FLUX_PHYSICALITY_RULES,
  REWRITER_POV_CORRECTIONS,
  REWRITER_PRIORITY_STACK,
} from "./shared-rules.js";

/** Legacy v2 3-block format — used only as director-failure fallback. */
const FLUX_V2_FORMAT = [
  "Target: FLUX / Black Forest — hybrid cinematic prose + render stack (legacy fallback).",
  "",
  "Output EXACTLY 3 blocks (plain text, blocks separated by blank lines):",
  "  Block 1 — one cinematic sentence: POV + lens + framing + subject + pose + body geometry.",
  "  Block 2 — one spatial-composition sentence: mirror/reflection, environment layout, contact points.",
  "  Block 3 — render stack ONLY: comma-separated lighting, materials, DoF, style modifiers. No full sentences.",
  "",
  FLUX_PHYSICALITY_RULES,
  "",
  REWRITER_PRIORITY_STACK,
  "",
  REWRITER_POV_CORRECTIONS,
].join("\n");

const FLUX_V2_EXAMPLE = [
  "Example:",
  "Input: She bends over the marble sink, dress hiked, gripping the counter. Mirror shows her flushed face.",
  "Output:",
  "First-person POV, tight medium shot on a 35mm lens with shallow depth of field — a flushed red-haired woman bent over a white marble vanity, black cocktail dress pushed to her waist, fingers locked around the sink edge, trembling thighs spread against glossy tile.",
  "",
  "A large wall mirror opposite reflects her tear-wet face, parted lips, and copper hair scattered across polished stone while the player's hands grip her hips at the bottom edge of frame.",
  "",
  "Purple neon rim light, warm gold bathroom downlighting, humid air haze, wet skin sheen, specular reflections on marble and chrome, shallow depth of field, glossy anime realism.",
].join("\n");

export const FLUX_REWRITER_PROMPTS = {
  fast: [FLUX_V2_FORMAT, "", FLUX_V2_EXAMPLE].join("\n"),
  premium: [FLUX_V2_FORMAT, "", FLUX_V2_EXAMPLE].join("\n"),
};
