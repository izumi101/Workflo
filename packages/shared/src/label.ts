import { z } from "zod";

/**
 * Label schema — mirrors the `Label` Prisma model (docs/architecture.md §3).
 * Labels are scoped per-project; name is unique within a project.
 */
export const labelSchema = z.object({
  id: z.string().cuid(),
  projectId: z.string().cuid(),
  name: z.string().min(1).max(50),
  color: z.string().min(1).max(20),
});
export type Label = z.infer<typeof labelSchema>;

export const createLabelSchema = labelSchema.pick({
  name: true,
  color: true,
});
export type CreateLabel = z.infer<typeof createLabelSchema>;
