import { z } from "zod";

export const VisualTokenBundleSchema = z.object({
  subject_tokens: z.array(z.string()).default([]),
  pose_tokens: z.array(z.string()).default([]),
  interaction_tokens: z.array(z.string()).default([]),
  composition_tokens: z.array(z.string()).default([]),
  expression_tokens: z.array(z.string()).default([]),
  material_tokens: z.array(z.string()).default([]),
  camera_tokens: z.array(z.string()).default([]),
  environment_tokens: z.array(z.string()).default([]),
  discarded_tokens: z.array(z.string()).default([]),
});

export type VisualTokenBundle = z.infer<typeof VisualTokenBundleSchema>;

export function validateVisualTokenBundle(input: unknown): VisualTokenBundle {
  return VisualTokenBundleSchema.parse(input);
}

export function emptyVisualTokenBundle(): VisualTokenBundle {
  return VisualTokenBundleSchema.parse({});
}
