import { stripCodeFences } from "../../visual-prompt/yaml-utils.js";
import { VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT } from "./saliency-reducer.js";
import { SHOT_DIRECTOR_SYSTEM_PROMPT } from "./shot-director.js";

export const VISUAL_DIRECTOR_SYSTEM_PROMPT = [
  "You are a Visual Director for VN CG illustrations.",
  "Input: SceneAST YAML from the Scene Visual Compiler.",
  "Output: TWO YAML sections ONLY — visual_tokens then shot_graph. No markdown fences, no commentary.",
  "",
  "Output format (exact top-level keys):",
  "visual_tokens:",
  "  subject_tokens: []",
  "  pose_tokens: []",
  "  interaction_tokens: []",
  "  composition_tokens: []",
  "  expression_tokens: []",
  "  material_tokens: []",
  "  camera_tokens: []",
  "  environment_tokens: []",
  "  discarded_tokens: []",
  "shot_graph:",
  "  camera:",
  "    angle:",
  "    distance:",
  "    lens:",
  "    framing:",
  "    dof:",
  "  subject_blocking:",
  "    primary:",
  "    body_orientation:",
  "    face_visibility:",
  "  frame_layout:",
  "    mirror_centered:",
  "    hips_lower_center:",
  "    hands_lower_frame:",
  "    subject_fill:",
  "  depth_layers:",
  "    foreground: []",
  "    midground: []",
  "    background: []",
  "  pov_constraints: []",
  "",
  "Rules:",
  "1. visual_tokens: follow Visual Token Extractor rules (English snake_case slugs only).",
  "2. shot_graph: follow Shot Director rules (cinematography graph only, no prose).",
  "3. dof must be shallow_dof (not shallow). distance intimate_distance. framing tight_medium.",
  "4. expression_tokens MUST include facial state when scene expressions imply it (flushed_face, tear_streaks, open_mouth).",
  "",
  "--- Visual Token Extractor reference ---",
  VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT,
  "",
  "--- Shot Director reference ---",
  SHOT_DIRECTOR_SYSTEM_PROMPT,
].join("\n");

export function sanitizeVisualDirectorYaml(raw: string): string {
  return stripCodeFences(raw);
}

/** Split merged Visual Director output into token bundle YAML and shot graph YAML. */
export function splitVisualDirectorYaml(raw: string): { tokensYaml: string; shotYaml: string } | null {
  const cleaned = sanitizeVisualDirectorYaml(raw);
  const shotIdx = cleaned.search(/^shot_graph:/m);
  if (shotIdx < 0) return null;

  const tokensSection = cleaned.slice(0, shotIdx).trim();
  const shotSection = cleaned.slice(shotIdx).trim();

  const tokensYaml = tokensSection.replace(/^visual_tokens:\s*/m, "").trim();
  const shotYaml = shotSection.replace(/^shot_graph:\s*/m, "").trim();

  if (!/^subject_tokens:/m.test(tokensYaml) || !/^camera:/m.test(shotYaml)) {
    return null;
  }

  return { tokensYaml, shotYaml };
}
