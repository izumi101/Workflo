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

export const createProjectSchema = projectSchema
  .pick({
    workspaceId: true,
    name: true,
  })
  .extend({
    key: z
      .string()
      .min(2)
      .max(10)
      .regex(/^[A-Z][A-Z0-9]*$/, "key must be uppercase letters/digits, starting with a letter"),
  });
export type CreateProject = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = projectSchema
  .pick({
    name: true,
  })
  .partial();
export type UpdateProject = z.infer<typeof updateProjectSchema>;

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

/**
 * projectId is intentionally NOT part of this schema — it's supplied by the
 * route (`POST /projects/:id/issues`), never trusted from the request body.
 */
export const createIssueSchema = z.object({
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

export const updateIssueSchema = createIssueSchema.partial().extend({
  status: issueStatusSchema.optional(),
  rank: z.string().optional(),
});
export type UpdateIssue = z.infer<typeof updateIssueSchema>;

/**
 * Query params for listing issues within a project (filters + cursor
 * pagination). `q` is a simple case-insensitive contains match on
 * title/description — a placeholder until dedicated Postgres FTS search
 * (ADR-0006) lands; do not read this as a full-text search contract.
 */
export const issueListQuerySchema = z.object({
  status: issueStatusSchema.optional(),
  assigneeId: z.string().cuid().optional(),
  labelId: z.string().cuid().optional(),
  q: z.string().min(1).max(255).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
});
export type IssueListQuery = z.infer<typeof issueListQuerySchema>;
