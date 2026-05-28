import { fluxAllowedTokenSlugsByCategory } from "../../visual-prompt/token-vocabulary.js";
import { stripCodeFences } from "../../visual-prompt/yaml-utils.js";

function buildAllowedTokensBlock(): string {
  const byCategory = fluxAllowedTokenSlugsByCategory();
  const lines = ["<allowed_tokens>", "Prefer slugs from this closed vocabulary. Invent new slug ONLY if none fits."];
  for (const [category, slugs] of Object.entries(byCategory)) {
    lines.push(`${category}: ${slugs.join(", ")}`);
  }
  lines.push("</allowed_tokens>");
  return lines.join("\n");
}

const SALIENCY_TASK = [
  "You are a Visual Saliency Reducer for VN CG illustration prompts.",
  "Input: full structured scene YAML from the Scene Visual Compiler.",
  "Output: compressed saliency YAML ONLY. No markdown fences, no commentary, no Flux prose.",
  "Output values MUST be English — translate Russian compiler values into English semantic tokens.",
  "",
  "Output schema:",
  "dominant_pose:          # max 3 English snake_case semantic anchors — merge redundant limb geometry",
  "important_visuals:      # high saliency — MUST appear in final image prompt",
  "secondary_visuals:      # medium saliency — include if token budget allows",
  "discarded_details:      # audit trail only — never render",
  "composition_directives: # directing-language seeds for the prompt director (English)",
  "structural_avoid:       # POV/composition negatives from scene avoid + camera",
].join("\n");

const SALIENCY_RULES = [
  "Rules:",
  "1. DROP low-salience narrative microdetails: bite marks, orgasm aftermath, sound echoes, emotional prose, exact literary phrasing.",
  "2. MERGE redundant body_geometry into dominant_pose English anchors (bent_over_marble_counter + arched_back + hands_on_sink_rim — NOT 9 limb statements, NOT Russian prose).",
  "3. dominant_pose: maximum 3 items, English snake_case only (e.g. bent_over_marble_counter, not 'согнута над столешницей').",
  "4. KEEP in important_visuals: pose silhouette, garment state, explicit contact/penetration/rhythm when NSFW, mirror/composition drivers, wet skin sheen.",
  "5. NSFW mandatory: if draft or scene implies penetration, deep rhythm, hip contact, or garment displacement — include explicit visual contact in important_visuals. Never euphemize or omit the act.",
  "6. Lighting and palette tokens go in secondary_visuals only — Block 3 static style inject handles them.",
  "7. Pass composition.focal_priority and avoid[] through as composition_directives and structural_avoid (English).",
  "8. All output strings English only.",
].join("\n");

const SALIENCY_EXAMPLE = [
  "Example input excerpt:",
  "pose:",
  "  dominant: [согнута над столешницей, руки на раковине]",
  "body_geometry:",
  "  - knees spread",
  "  - hips pressed",
  "  - heels sliding",
  "  - bite mark on fist",
  "composition:",
  "  focal_priority: [face in mirror, hip contact]",
  "avoid: [third_person_angle, full_body_player]",
  "",
  "Example output:",
  "dominant_pose:",
  "  - bent_over_marble_counter",
  "  - arched_back",
  "  - hands_on_sink_rim",
  "important_visuals:",
  "  - red-haired woman, black dress hiked to waist, lace panties pushed aside",
  "  - deep penetration from behind, hips pressed to counter edge",
  "  - mirror reflection centered, tear-wet flushed face visible only in mirror",
  "  - player hands gripping hips at frame edge",
  "  - wet skin sheen on thighs and lower back",
  "secondary_visuals:",
  "  - glossy marble vanity, gold fixtures",
  "  - purple neon rim light, warm gold fill",
  "discarded_details:",
  "  - bite mark on fist",
  "  - heels sliding on tile",
  "composition_directives:",
  "  - mirror reflection centered behind subject",
  "  - face visible only through mirror reflection",
  "  - focal priority on hip contact and mirror face",
  "structural_avoid:",
  "  - third_person_angle",
  "  - full_body_player",
  "  - detached_camera",
].join("\n");

export const SALIENCY_REDUCER_SYSTEM_PROMPT = [SALIENCY_TASK, "", SALIENCY_RULES, "", SALIENCY_EXAMPLE].join("\n");

/** v4: tokenized visual primitives output (no prose lists). */
export const VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT = [
  "You are a Visual Token Extractor for VN CG illustrations.",
  "Input: SceneAST / scene YAML from the Scene Visual Compiler.",
  "Output: VisualTokenBundle YAML ONLY. English snake_case tokens. No prose sentences.",
  "",
  "Output schema:",
  "subject_tokens: []",
  "pose_tokens: []",
  "interaction_tokens: []",
  "composition_tokens: []",
  "expression_tokens: []",
  "material_tokens: []",
  "camera_tokens: []",
  "environment_tokens: []",
  "discarded_tokens: []",
  "",
  "Rules:",
  "1. Each item is ONE discrete visual token slug (red_hair, bent_over_sink, rear_penetration).",
  "2. NSFW: interaction_tokens MUST include rear_penetration and/or deep_rhythm when draft implies penetration.",
  "3. pose_tokens: max 3 anchors.",
  "4. composition_tokens: mirror_face_centered, face_mirror_only, hips_foreground, etc.",
  "5. camera_tokens: first_person, intimate_distance, 35mm, shallow_dof, tight_medium.",
  "6. expression_tokens (NEVER discard for NSFW): flushed_face, tear_streaks, open_mouth, head_thrown_back, gasping, biting_lip.",
  "7. Lighting/neon/palette → material_tokens or discarded — not duplicated.",
  "8. DROP into discarded_tokens ONLY: bite_mark, orgasm_aftermath, sound_echo, wet_sound — NOT facial expressions.",
  "",
  buildAllowedTokensBlock(),
  "",
  "Example:",
  "subject_tokens:",
  "  - red_hair",
  "  - black_cocktail_dress",
  "  - displaced_lace_panties",
  "pose_tokens:",
  "  - bent_over_sink",
  "  - arched_back",
  "  - hands_on_sink_rim",
  "interaction_tokens:",
  "  - rear_penetration",
  "  - deep_rhythm",
  "  - player_hands_on_hips",
  "composition_tokens:",
  "  - mirror_face_centered",
  "  - face_mirror_only",
  "expression_tokens:",
  "  - flushed_face",
  "  - tear_streaks",
  "  - open_mouth",
  "material_tokens:",
  "  - wet_skin",
  "  - polished_marble",
  "camera_tokens:",
  "  - first_person",
  "  - 35mm",
  "  - shallow_dof",
  "environment_tokens:",
  "  - luxury_bathroom",
  "  - white_marble",
  "discarded_tokens:",
  "  - bite_mark",
].join("\n");

/** Strip code fences from saliency YAML output. */
export function sanitizeSaliencyYaml(raw: string): string {
  return stripCodeFences(raw);
}
