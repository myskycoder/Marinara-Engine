import { z } from "zod";

export const SceneMetaSchema = z.object({
  type: z.string().optional(),
  pov: z.enum(["first_person", "third_person"]).optional().default("first_person"),
  explicitness: z.enum(["sfw", "suggestive", "explicit"]).optional(),
});

export const CharacterOutfitSchema = z.object({
  dress: z.string().optional(),
  state: z.string().optional(),
  panties: z.string().optional(),
});

export const CharacterAstSchema = z.object({
  id: z.string(),
  role: z.string().optional(),
  hair: z.string().optional(),
  outfit: CharacterOutfitSchema.optional(),
  appearance: z.string().optional(),
});

export const PoseAstSchema = z.object({
  base: z.string().optional(),
  spine: z.string().optional(),
  head: z.string().optional(),
  hands: z.string().optional(),
  legs: z.string().optional(),
});

export const InteractionAstSchema = z.object({
  type: z.string().optional(),
  intensity: z.string().optional(),
  player_contact: z.string().optional(),
});

export const EnvironmentAstSchema = z.object({
  room: z.string().optional(),
  surfaces: z.array(z.string()).optional(),
  mirror: z.string().optional(),
  layout: z.string().optional(),
});

export const CompositionAstSchema = z.object({
  focal: z.array(z.string()).optional(),
  reflection_centered: z.boolean().optional(),
  face_via_mirror_only: z.boolean().optional(),
});

export const SceneAstSchema = z.object({
  scene: SceneMetaSchema.optional(),
  characters: z.array(CharacterAstSchema).optional(),
  pose: PoseAstSchema.optional(),
  interaction: InteractionAstSchema.optional(),
  environment: EnvironmentAstSchema.optional(),
  composition: CompositionAstSchema.optional(),
  avoid: z.array(z.string()).optional(),
  camera: z
    .object({
      pov: z.string().optional(),
      height: z.string().optional(),
      distance: z.string().optional(),
      angle: z.string().optional(),
      focal_subject: z.string().optional(),
      framing: z.string().optional(),
      lens: z.string().optional(),
      depth_of_field: z.string().optional(),
    })
    .optional(),
});

export type SceneAst = z.infer<typeof SceneAstSchema>;

export function validateSceneAst(input: unknown): SceneAst {
  return SceneAstSchema.parse(input);
}

export function safeParseSceneAst(input: unknown): SceneAst | null {
  const result = SceneAstSchema.safeParse(input);
  return result.success ? result.data : null;
}
