import { z } from "zod";
import { issueTypeSchema, issueStatusSchema, prioritySchema } from "./enums.js";

/**
 * Project schema — mirrors the `Project` Prisma model
 * (docs/architecture.md §3).
 */
export const projectSchema = z.object({
  id: z.string().cuid(),
  workspaceId: z.string().cuid(),
  key: z.string().min(2).max(10),
  name: z.string().min(1).max(120),
  createdAt: z.coerce.date(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = projectSchema.pick({
  workspaceId: true,
  key: true,
  name: true,
});
export type CreateProject = z.infer<typeof createProjectSchema>;

/**
 * Issue schema — mirrors the `Issue` Prisma model
 * (docs/architecture.md §3). Human key is `${project.key}-${number}`.
 */
export const issueSchema = z.object({
  id: z.string().cuid(),
  projectId: z.string().cuid(),
  number: z.number().int().positive(),
  title: z.string().min(1).max(255),
  description: z.string().max(20_000).nullable().optional(),
  type: issueTypeSchema,
  status: issueStatusSchema,
  priority: prioritySchema,
  assigneeId: z.string().cuid().nullable().optional(),
  reporterId: z.string().cuid(),
  parentId: z.string().cuid().nullable().optional(),
  labelIds: z.array(z.string().cuid()).default([]),
  rank: z.string(),
  dueDate: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Issue = z.infer<typeof issueSchema>;

export const createIssueSchema = z.object({
  projectId: z.string().cuid(),
  title: z.string().min(1).max(255),
  description: z.string().max(20_000).nullable().optional(),
  type: issueTypeSchema.default("TASK"),
  priority: prioritySchema.default("MEDIUM"),
  assigneeId: z.string().cuid().nullable().optional(),
  parentId: z.string().cuid().nullable().optional(),
  labelIds: z.array(z.string().cuid()).optional(),
  dueDate: z.coerce.date().nullable().optional(),
});
export type CreateIssue = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = createIssueSchema
  .partial()
  .extend({
    status: issueStatusSchema.optional(),
    rank: z.string().optional(),
  })
  .omit({ projectId: true });
export type UpdateIssue = z.infer<typeof updateIssueSchema>;
