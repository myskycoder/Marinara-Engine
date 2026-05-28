import type { SceneAst, VisualTokenBundle, ShotGraph } from "@marinara-engine/shared";
import { booruTagsForTokens, fluxPhrasesForTokens } from "@marinara-engine/shared";

/** SDXL booru: tag stack + short prose clause. */
export function assembleSdxlPrompt(tokens: VisualTokenBundle, scene: SceneAst, shot: ShotGraph): string {
  const tags = booruTagsForTokens([
    "1girl",
    ...tokens.subject_tokens,
    ...tokens.pose_tokens.slice(0, 3),
    ...tokens.interaction_tokens,
  ]).join(", ");

  const prose = fluxPhrasesForTokens([
    ...tokens.composition_tokens.slice(0, 2),
    ...(shot.frame_layout?.mirror_centered ? ["mirror_face_centered"] : []),
  ]).join(", ");

  return prose ? `${tags}, ${prose}` : tags;
}
