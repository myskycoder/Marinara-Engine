import type { SceneAst, VisualTokenBundle, ShotGraph } from "@marinara-engine/shared";
import { booruTagsForTokens } from "@marinara-engine/shared";

const PONY_PREFIX = "score_9, score_8_up, score_7_up, source_anime, rating_explicit";

export function assemblePonyPrompt(tokens: VisualTokenBundle, _scene: SceneAst, _shot: ShotGraph): string {
  const tags = [
    ...booruTagsForTokens(["1girl", ...tokens.subject_tokens]),
    ...booruTagsForTokens(tokens.pose_tokens.slice(0, 3)),
    ...booruTagsForTokens(tokens.interaction_tokens),
    ...booruTagsForTokens(tokens.composition_tokens),
    ...booruTagsForTokens(tokens.camera_tokens),
    ...booruTagsForTokens(tokens.environment_tokens),
    "depth_of_field",
  ];
  const unique = [...new Set(tags)];
  return `${PONY_PREFIX}, ${unique.join(", ")}`;
}
