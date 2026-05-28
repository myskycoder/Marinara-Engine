import { REWRITER_POV_CORRECTIONS, REWRITER_PRIORITY_STACK } from "./shared-rules.js";

const NATURAL_LANGUAGE_FORMAT = [
  "Target: natural-language image model (DALL·E 3, GPT-Image, Imagen, Pollinations, SDXL natural, generic).",
  "Format: plain English art-director prose. Subject → composition → lighting → mood → camera → style.",
  "No tag dumps, no quality boilerplate, no negative-prompt syntax. Under ~400 words.",
  "",
  REWRITER_PRIORITY_STACK,
  "",
  REWRITER_POV_CORRECTIONS,
].join("\n");

const NATURAL_LANGUAGE_FAST_EXAMPLE = [
  "Example:",
  "Input: She bends over the marble sink, dress hiked, mirror shows her flushed face.",
  "Output: First-person view looking down at a red-haired woman bent over a cold marble bathroom counter, black dress gathered at her waist, gripping the sink edge. Her head is thrown back, eyes closed, lips parted. A mirror captures her flushed reflection. Soft neon purple lighting, warm ambient fill, cinematic medium shot with shallow depth of field.",
].join("\n");

const NATURAL_LANGUAGE_PREMIUM_EXAMPLES = [
  "Examples:",
  "",
  "Input: He grabs her hips and thrusts harder. Mirror opposite shows everything.",
  "Output: First-person POV, tight medium framing — a copper-haired woman bent forward over a polished marble vanity, dress rucked to her waist, knuckles white on the sink. The viewer's hands grip her hips at the lower frame edge; her head is thrown back, mouth open. A wall mirror reflects the same moment: flushed cheeks, disheveled hair on white stone. Purple neon rim light, warm gold downlighting, specular highlights on damp skin, shallow depth of field.",
  "",
  "Input: Two characters argue in a rain-soaked alley.",
  "Output: First-person view from the alley entrance — a soaked woman in a torn leather jacket faces the viewer, jaw set, rain on short silver hair. Neon pink and cyan signs cast cross-light on wet asphalt. Cold rain sheen, puddle reflections, 50mm lens, deep focus, cinematic composition.",
].join("\n");

export const NATURAL_LANGUAGE_REWRITER_PROMPTS = {
  fast: [NATURAL_LANGUAGE_FORMAT, "", NATURAL_LANGUAGE_FAST_EXAMPLE].join("\n"),
  premium: [NATURAL_LANGUAGE_FORMAT, "", NATURAL_LANGUAGE_PREMIUM_EXAMPLES].join("\n"),
};
