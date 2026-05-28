import type { ShotGraph, VisualTokenBundle } from "@marinara-engine/shared";
import { PROMPT_SANITIZE_PATTERNS } from "@marinara-engine/shared";

export interface ConstraintEngineResult {
  prompt: string;
  violations: string[];
  injected: string[];
}

const CONSTRAINT_INJECTIONS: Record<string, string> = {
  face_visible_via_mirror_when_required: "face visible only through mirror reflection",
  no_cutoff_hands: "full hands visible gripping surface",
  mirror_not_occluded: "mirror reflection unobstructed",
  hips_visible_when_focal: "hips as foreground focal point",
  no_player_body_visible: "no protagonist body visible",
  hands_at_frame_edge_only: "only player hands at bottom edge of frame",
  no_panels_or_grid: "single shot, no panels, no grid, no character sheet",
  no_duplicate_face: "single character, single face",
  no_extra_limbs: "anatomically correct hands and limbs",
};

function shotRequiresMirrorFace(shot: ShotGraph, tokens: VisualTokenBundle): boolean {
  return (
    shot.subject_blocking?.face_visibility === "mirror_only" ||
    tokens.composition_tokens.some((t) => /face_mirror_only|mirror_face/i.test(t))
  );
}

function shotRequiresNoPlayerBody(shot: ShotGraph): boolean {
  return shot.pov_constraints?.includes("no_player_body") ?? false;
}

/** Validate assembled prompt; inject missing constraint phrases deterministically. */
export function applyCompositionConstraints(
  positive: string,
  shot: ShotGraph,
  tokens: VisualTokenBundle,
): ConstraintEngineResult {
  const violations: string[] = [];
  const injected: string[] = [];
  let prompt = positive;

  const required: string[] = ["no_panels_or_grid"];

  if (shotRequiresMirrorFace(shot, tokens)) {
    required.push("face_visible_via_mirror_when_required");
    if (!/mirror/i.test(prompt)) violations.push("missing_mirror_reference");
  }
  if (shotRequiresNoPlayerBody(shot)) {
    required.push("no_player_body_visible");
    if (/protagonist body|player torso/i.test(prompt)) violations.push("player_body_leak");
  }
  if (shot.pov_constraints?.includes("hands_at_frame_edge_only")) {
    required.push("hands_at_frame_edge_only");
  }
  if (shot.frame_layout?.mirror_centered) {
    required.push("mirror_not_occluded");
  }
  if (tokens.composition_tokens.some((t) => /hip/i.test(t))) {
    required.push("hips_visible_when_focal");
  }
  if (tokens.pose_tokens.some((t) => /hand/i.test(t))) {
    required.push("no_cutoff_hands");
  }

  required.push("no_duplicate_face", "no_extra_limbs");

  for (const slug of required) {
    const phrase = CONSTRAINT_INJECTIONS[slug];
    if (!phrase) continue;
    const needle = phrase.toLowerCase().slice(0, 20);
    if (!prompt.toLowerCase().includes(needle)) {
      injected.push(phrase);
    }
  }

  if (injected.length) {
    const block1End = prompt.indexOf("\n\n");
    if (block1End > 0) {
      const block1 = prompt.slice(0, block1End).trim().replace(/,\s*$/, "");
      const rest = prompt.slice(block1End);
      prompt = `${block1}, ${injected.join(", ")}${rest}`;
    } else {
      const trimmed = prompt.trim().replace(/,\s*$/, "");
      prompt = `${trimmed}, ${injected.join(", ")}`;
    }
  }

  prompt = sanitizeAssembledPrompt(prompt);

  return { prompt, violations, injected };
}

export function sanitizeAssembledPrompt(prompt: string): string {
  return prompt
    .split(/\n\s*\n/)
    .map((block) => {
      let cleaned = block;
      for (const pattern of PROMPT_SANITIZE_PATTERNS) {
        cleaned = cleaned.replace(pattern, "");
      }
      return cleaned.replace(/,\s*,/g, ",").replace(/[ \t]{2,}/g, " ").trim();
    })
    .filter(Boolean)
    .join("\n\n");
}
