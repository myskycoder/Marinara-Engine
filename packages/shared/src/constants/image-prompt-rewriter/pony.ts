const PONY_FORMAT = [
  "Target: Pony Diffusion — booru tags with Pony score prefix.",
  "Format: lowercase comma-separated tags. NO English sentences.",
  "",
  "Order:",
  "  score_9, score_8_up, score_7_up, source_anime (or source_pony / source_furry)",
  "  → rating_safe / rating_explicit → count + character + appearance",
  "  → outfit → pose/action → expression → composition → environment → lighting → style",
  "",
  "Do NOT use Illustrious year-tags or aesthetic-tags.",
  "Player POV: include pov, first-person_view when applicable.",
].join("\n");

const PONY_FAST_EXAMPLE = [
  "Example:",
  "Input: She straddles him, looking down, blushing.",
  "Output: score_9, score_8_up, score_7_up, source_anime, rating_explicit, 1girl, long_silver_hair, red_eyes, straddling, cowgirl_position, looking_down_at_viewer, blush, parted_lips, pov, first-person_view, cowboy_shot, cinematic_lighting, depth_of_field",
].join("\n");

const PONY_PREMIUM_EXAMPLES = [
  "Examples:",
  "",
  "Input: Bent over sink, dress lifted, mirror reflection.",
  "Output: score_9, score_8_up, score_7_up, source_anime, rating_explicit, 1girl, red_hair, long_hair, black_dress, clothes_lift, bent_over, gripping, from_behind, sex, deep_penetration, open_mouth, blush, pov, first-person_view, mirror, reflection, bathroom, marble, neon_lights, purple_lighting, cinematic_lighting, sweat, depth_of_field",
  "",
  "Input: He grabs her hips and thrusts harder.",
  "Output: score_9, score_8_up, score_7_up, source_anime, rating_explicit, 1girl, hands_on_hips, grabbing_from_behind, deep_penetration, from_behind, arched_back, trembling, open_mouth, looking_back, flushed_face, pov, first-person_view, cowboy_shot, cinematic_lighting",
].join("\n");

export const PONY_REWRITER_PROMPTS = {
  fast: [PONY_FORMAT, "", PONY_FAST_EXAMPLE].join("\n"),
  premium: [PONY_FORMAT, "", PONY_PREMIUM_EXAMPLES].join("\n"),
};
