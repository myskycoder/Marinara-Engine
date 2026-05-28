const SCENE_COMPILER_TASK = [
  "You are a VN scene visual compiler. Extract structured visual state ONLY.",
  "Do NOT write Flux prose, image prompts, or narration.",
  "Output ONLY valid YAML using the schema below. No markdown fences, no commentary.",
  "Draft may be Russian or English — output structured keys only (values may stay in source language).",
  "",
  "Schema (include every top-level key; use empty string or omit subfields when unknown):",
  "subject:",
  "pose:",
  "  dominant: []              # max 3 semantic pose anchors, not prose",
  "body_geometry: []           # raw geometry hints; saliency stage will trim",
  "camera:",
  "  pov:",
  "  height:",
  "  distance:",
  "  angle:",
  "  focal_subject:",
  "  framing:",
  "  lens:",
  "  depth_of_field:",
  "composition:",
  "  focal_priority: []",
  "  reflection_centered:",
  "  face_visible_via_mirror_only:",
  "environment:",
  "lighting:",
  "materials:",
  "expressions:",
  "avoid: []                  # structural composition negatives",
  "continuity:",
].join("\n");

const SCENE_COMPILER_NSFW = [
  "NSFW: preserve explicit acts, garment state, contact points, and body geometry exactly as implied by the draft. Do not sanitize or euphemize.",
].join("\n");

const SCENE_COMPILER_EXAMPLE = [
  "Example:",
  "Input draft excerpt: bent over marble vanity, dress hiked, hands on hips, mirror shows flushed face, deep rhythm.",
  "Output:",
  "subject:",
  "  name: Lina",
  "  appearance: red hair, short black dress hiked to waist",
  "pose:",
  "  dominant:",
  "    - bent_over_marble_counter",
  "    - arched_back",
  "    - player_hands_on_hips",
  "body_geometry:",
  "  - hips pressed against counter edge",
  "  - heels splayed on glossy tile",
  "camera:",
  "  pov: first_person",
  "  height: standing_eye_level",
  "  distance: intimate_close",
  "  angle: slightly_downward",
  "  focal_subject: mirror_reflection",
  "  framing: tight_medium",
  "  lens: 35mm",
  "  depth_of_field: shallow",
  "composition:",
  "  focal_priority:",
  "    - Lina face in mirror",
  "    - hips and hand contact",
  "  reflection_centered: true",
  "  face_visible_via_mirror_only: true",
  "environment:",
  "  layout: narrow luxury bathroom",
  "  surfaces:",
  "    - white marble walls and vanity",
  "    - glossy black tile floor",
  "    - gold fixtures",
  "  mirror: large wall mirror opposite",
  "lighting:",
  "  - purple neon rim light",
  "  - warm gold bathroom fill",
  "materials:",
  "  - cold polished marble",
  "  - wet skin sheen",
  "expressions:",
  "  - head thrown back",
  "  - mouth open",
  "  - tear-wet flushed face",
  "avoid:",
  "  - third_person_angle",
  "  - full_body_player",
  "  - detached_camera",
  "continuity:",
  "  mirror_visible: true",
  "  pov_constraints:",
  "    - no_protagonist_body",
].join("\n");

/** Top-level keys expected from the scene compiler. */
export const SCENE_COMPILER_REQUIRED_KEYS = [
  "subject",
  "pose",
  "camera",
  "environment",
] as const;

export const SCENE_COMPILER_SYSTEM_PROMPT = [SCENE_COMPILER_TASK, "", SCENE_COMPILER_NSFW, "", SCENE_COMPILER_EXAMPLE].join(
  "\n",
);

/** Strip code fences and preamble from compiler YAML output. */
export function sanitizeCompiledSceneYaml(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }
  cleaned = cleaned.replace(/^yaml\s*\n/i, "").trim();
  return cleaned;
}

/** Returns missing required top-level keys, or empty array when YAML looks complete. */
export function validateCompiledSceneYaml(yaml: string): string[] {
  const missing: string[] = [];
  for (const key of SCENE_COMPILER_REQUIRED_KEYS) {
    const pattern = new RegExp(`^${key}:`, "m");
    if (!pattern.test(yaml)) missing.push(key);
  }
  // Detect truncated YAML (ends mid-line without colon value or mid-list)
  const trimmed = yaml.trim();
  if (trimmed.endsWith(":") || trimmed.endsWith("-")) {
    missing.push("truncated");
  }
  return missing;
}
