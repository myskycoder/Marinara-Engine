const NOVELAI_V3_FORMAT = [
  "Target: NovelAI v3 — pure Danbooru tags.",
  "Format: lowercase comma-separated tags. Weight with {tag} boost and [tag] de-boost when needed.",
  "",
  "Order:",
  "  best quality, amazing quality, very aesthetic, absurdres",
  "  → count + character + appearance → outfit → pose/action → expression",
  "  → composition → environment → lighting → style",
  "",
  "Player POV: include pov, first-person_view when applicable.",
].join("\n");

const NOVELAI_V3_FAST_EXAMPLE = [
  "Example:",
  "Input: She straddles him, looking down, blushing.",
  "Output: best quality, amazing quality, very aesthetic, absurdres, 1girl, long_silver_hair, red_eyes, straddling, cowgirl_position, looking_down_at_viewer, blush, pov, first-person_view, cowboy_shot, cinematic_lighting",
].join("\n");

const NOVELAI_V3_PREMIUM_EXAMPLE = [
  "Example:",
  "Input: Bent over sink, dress lifted, mirror reflection.",
  "Output: best quality, amazing quality, very aesthetic, absurdres, 1girl, {red_hair}, {long_hair}, black_dress, clothes_lift, bent_over, from_behind, sex, deep_penetration, open_mouth, blush, pov, first-person_view, mirror, bathroom, marble, neon_lights, cinematic_lighting",
].join("\n");

const NOVELAI_V4_FORMAT = [
  "Target: NovelAI v4 — short comma-joined clauses mixed with Danbooru tags.",
  "Prefix: best quality, amazing quality, very aesthetic, absurdres.",
  "Multi-character: use Text 1. / Text 2. region syntax when more than one named character is visible.",
  "Player POV: describe first-person framing explicitly.",
].join("\n");

const NOVELAI_V4_EXAMPLE = [
  "Example:",
  "Input: Two women face each other in a neon-lit bar.",
  "Output: best quality, amazing quality, very aesthetic, absurdres. Text 1. silver-haired woman in a black cocktail dress, leaning forward with a smirk. Text 2. red-haired woman in a white blouse, blushing, looking away. Neon bar interior, purple and pink lighting, shallow depth of field, cinematic framing.",
].join("\n");

export const NOVELAI_V3_REWRITER_PROMPTS = {
  fast: [NOVELAI_V3_FORMAT, "", NOVELAI_V3_FAST_EXAMPLE].join("\n"),
  premium: [NOVELAI_V3_FORMAT, "", NOVELAI_V3_PREMIUM_EXAMPLE].join("\n"),
};

export const NOVELAI_V4_REWRITER_PROMPTS = {
  fast: [NOVELAI_V4_FORMAT, "", NOVELAI_V4_EXAMPLE].join("\n"),
  premium: [NOVELAI_V4_FORMAT, "", NOVELAI_V4_EXAMPLE].join("\n"),
};
