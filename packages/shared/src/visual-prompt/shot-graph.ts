import { z } from "zod";

export const ShotGraphSchema = z.object({
  camera: z
    .object({
      angle: z.string().optional(),
      distance: z.string().optional(),
      lens: z.string().optional(),
      framing: z.string().optional(),
      dof: z.string().optional(),
    })
    .optional(),
  subject_blocking: z
    .object({
      primary: z.string().optional(),
      body_orientation: z.string().optional(),
      face_visibility: z.string().optional(),
    })
    .optional(),
  frame_layout: z
    .object({
      mirror_centered: z.boolean().optional(),
      hips_lower_center: z.boolean().optional(),
      hands_lower_frame: z.boolean().optional(),
      subject_fill: z.number().min(0).max(1).optional(),
    })
    .optional(),
  depth_layers: z
    .object({
      foreground: z.array(z.string()).optional(),
      midground: z.array(z.string()).optional(),
      background: z.array(z.string()).optional(),
    })
    .optional(),
  pov_constraints: z.array(z.string()).optional(),
});

export type ShotGraph = z.infer<typeof ShotGraphSchema>;

export function validateShotGraph(input: unknown): ShotGraph {
  return ShotGraphSchema.parse(input);
}

export function emptyShotGraph(): ShotGraph {
  return {};
}
