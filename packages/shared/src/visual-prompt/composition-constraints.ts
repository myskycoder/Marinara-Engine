/** Known frame constraint slugs for composition validation. */
export const FRAME_CONSTRAINT_SLUGS = [
  "face_visible_via_mirror_when_required",
  "no_cutoff_hands",
  "mirror_not_occluded",
  "hips_visible_when_focal",
  "no_player_body_visible",
  "hands_at_frame_edge_only",
] as const;

export type FrameConstraintSlug = (typeof FRAME_CONSTRAINT_SLUGS)[number];

/** Map structural avoid slugs to negative prompt phrases. */
export const AVOID_TO_NEGATIVE: Record<string, string> = {
  player_body_visible: "player body visible, protagonist full body",
  third_person: "third person view, third person camera, detached camera",
  third_person_angle: "third person view, third person camera",
  detached_camera: "detached camera, external camera angle",
  full_body_player: "full body player, protagonist body",
  extra_characters: "extra characters, crowd, multiple unrelated people",
};

/** Phrases stripped from assembled prompts (euphemism / low-salience leaks). */
export const PROMPT_SANITIZE_PATTERNS: RegExp[] = [
  /\bintimate encounter\b/gi,
  /\bin climax\b/gi,
  /\brecent orgasm\b/gi,
  /\bsultry atmosphere\b/gi,
];
