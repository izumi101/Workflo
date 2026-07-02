import { z } from "zod";
import { roleSchema } from "./enums.js";
import { authUserSchema } from "./auth.js";

/**
 * Workspace + membership contracts (docs/architecture.md §3, §4). These are
 * the single source of truth for FE/BE — validate request bodies against
 * these schemas and keep response shapes in sync with them.
 */

export const workspaceSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(120),
  slug: z.string().min(1),
  createdAt: z.coerce.date(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateWorkspace = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
});
export type UpdateWorkspace = z.infer<typeof updateWorkspaceSchema>;

/** A membership row plus a summary of the member's user record. */
export const workspaceMemberSchema = z.object({
  userId: z.string().cuid(),
  workspaceId: z.string().cuid(),
  role: roleSchema,
  user: authUserSchema,
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/** Add an existing user to a workspace by email; role defaults to MEMBER. */
export const addMemberSchema = z.object({
  email: z.string().email(),
  role: roleSchema.default("MEMBER"),
});
export type AddMember = z.infer<typeof addMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: roleSchema,
});
export type UpdateMemberRole = z.infer<typeof updateMemberRoleSchema>;
