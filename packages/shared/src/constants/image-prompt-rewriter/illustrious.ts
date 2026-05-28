const ILLUSTRIOUS_FORMAT = [
  "Target: Illustrious-XL / NoobAI / WAI / Hassaku-IL — dense Danbooru tags ONLY.",
  "Format: lowercase comma-separated tags, underscores for compounds. NO English sentences.",
  "",
  "Order:",
  "  quality prefix: masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, year 2024",
  "  → rating → count + character + appearance → outfit + clothing state",
  "  → pose/action → expression + gaze → composition + camera → environment → lighting → style",
  "",
  "Density: 40–80 tags. Weight critical tags with (tag:1.2) sparingly (≤6).",
  "Player POV: always include pov, first-person_view when applicable.",
].join("\n");

const ILLUSTRIOUS_FAST_EXAMPLE = [
  "Example:",
  "Input: She straddles him on the bed, looking down, blushing.",
  "Output: masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, year 2024, rating_explicit, nsfw, 1girl, long_silver_hair, red_eyes, large_breasts, nude, straddling, cowgirl_position, girl_on_top, hands_on_chest, looking_down_at_viewer, blush, parted_lips, half-closed_eyes, pov, first-person_view, cowboy_shot, from_below, bedroom, dimly_lit_room, cinematic_lighting, rim_lighting, depth_of_field",
].join("\n");

const ILLUSTRIOUS_PREMIUM_EXAMPLES = [
  "Examples:",
  "",
  "Input: Bent over sink, dress lifted, gripping counter, mirror reflection, deep penetration from behind.",
  "Output: masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, year 2024, rating_explicit, nsfw, 1girl, red_hair, long_hair, medium_breasts, black_dress, clothes_lift, dress_lift, bent_over, leaning_forward, hands_on_object, gripping, from_behind, sex, deep_penetration, doggystyle, standing_sex, head_back, open_mouth, closed_eyes, blush, tears, trembling, pov, first-person_view, mirror, reflection, bathroom, marble_counter, tile_floor, indoors, neon_lights, purple_lighting, cinematic_lighting, rim_lighting, wet_skin, sweat, depth_of_field, dutch_angle",
  "",
  "Input: He grabs her hips and thrusts harder.",
  "Output: masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, year 2024, rating_explicit, nsfw, 1girl, hands_on_hips, grabbing_from_behind, deep_penetration, from_behind, arched_back, trembling_legs, open_mouth, looking_back, flushed_face, pov, first-person_view, cowboy_shot, motion_lines, sweat, cinematic_lighting",
].join("\n");

export const ILLUSTRIOUS_REWRITER_PROMPTS = {
  fast: [ILLUSTRIOUS_FORMAT, "", ILLUSTRIOUS_FAST_EXAMPLE].join("\n"),
  premium: [ILLUSTRIOUS_FORMAT, "", ILLUSTRIOUS_PREMIUM_EXAMPLES].join("\n"),
};
