import type { SceneAst, VisualTokenBundle, ShotGraph } from "@marinara-engine/shared";
import { booruTagsForTokens } from "@marinara-engine/shared";

const ILLUSTRIOUS_PREFIX =
  "masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, year 2024, rating_explicit, nsfw";

export function assembleIllustriousPrompt(
  tokens: VisualTokenBundle,
  _scene: SceneAst,
  _shot: ShotGraph,
): string {
  const tags = [
    ...booruTagsForTokens(["1girl", ...tokens.subject_tokens]),
    ...booruTagsForTokens(tokens.pose_tokens.slice(0, 3)),
    ...booruTagsForTokens(tokens.interaction_tokens),
    ...booruTagsForTokens(tokens.composition_tokens),
    ...booruTagsForTokens(tokens.camera_tokens),
    ...booruTagsForTokens(tokens.environment_tokens),
    ...booruTagsForTokens(tokens.material_tokens),
    "depth_of_field",
  ];
  const unique = [...new Set(tags)];
  return `${ILLUSTRIOUS_PREFIX}, ${unique.join(", ")}`;
}
