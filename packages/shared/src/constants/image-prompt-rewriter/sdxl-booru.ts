const SDXL_BOORU_FORMAT = [
  "Target: SDXL anime / Animagine / Counterfeit / Anything-XL / Horde — Danbooru tags.",
  "Format: lowercase comma-separated tags. NO full sentences.",
  "",
  "Order:",
  "  masterpiece, best quality, highly detailed, sharp focus",
  "  → rating → count + character + appearance → outfit → pose/action",
  "  → expression → composition + camera → environment → lighting → style",
  "",
  "Density: 30–60 tags. Stay compact — Horde workers truncate aggressively.",
  "Player POV: include pov, first-person_view when applicable.",
].join("\n");

const SDXL_FAST_EXAMPLE = [
  "Example:",
  "Input: She straddles him, looking down, blushing.",
  "Output: masterpiece, best quality, highly detailed, sharp focus, rating_explicit, 1girl, long_silver_hair, red_eyes, straddling, cowgirl_position, looking_down_at_viewer, blush, pov, first-person_view, cowboy_shot, cinematic_lighting, depth_of_field",
].join("\n");

const SDXL_PREMIUM_EXAMPLE = [
  "Example:",
  "Input: Bent over sink, dress lifted, mirror reflection, from behind.",
  "Output: masterpiece, best quality, highly detailed, sharp focus, rating_explicit, 1girl, red_hair, black_dress, clothes_lift, bent_over, from_behind, sex, deep_penetration, open_mouth, blush, pov, first-person_view, mirror, bathroom, marble, neon_lights, cinematic_lighting, sweat, depth_of_field",
].join("\n");

export const SDXL_BOORU_REWRITER_PROMPTS = {
  fast: [SDXL_BOORU_FORMAT, "", SDXL_FAST_EXAMPLE].join("\n"),
  premium: [SDXL_BOORU_FORMAT, "", SDXL_PREMIUM_EXAMPLE].join("\n"),
};
