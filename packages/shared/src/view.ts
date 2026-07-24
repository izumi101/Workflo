import { z } from "zod";
import { workfloQuerySchema } from "./query.js";

/**
 * Saved Views (docs/design/nlq-search.md §2.6/§3.5) — a named, stored
 * `WorkfloQuery` AST, never the NL sentence that produced it (relative
 * clauses like `assignee: "me"` and `due: {withinDays: 7}` stay symbolic and
 * re-resolve per viewer/day — see query.ts's file header). PERSONAL views
 * are creator-only; WORKSPACE views are visible to every workspace member
 * and editable by their creator OR the workspace OWNER.
 */
export const viewScopeSchema = z.enum(["PERSONAL", "WORKSPACE"]);
export type ViewScope = z.infer<typeof viewScopeSchema>;

export const viewSchema = z.object({
  id: z.string().cuid(),
  workspaceId: z.string().cuid(),
  creatorId: z.string().cuid(),
  name: z.string().min(1).max(80),
  scope: viewScopeSchema,
  ast: workfloQuerySchema,
  pinned: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type View = z.infer<typeof viewSchema>;

export const createViewSchema = z.object({
  workspaceId: z.string().cuid(),
  name: z.string().min(1).max(80),
  ast: workfloQuerySchema,
  scope: viewScopeSchema.default("PERSONAL"),
  pinned: z.boolean().default(false),
});
export type CreateView = z.infer<typeof createViewSchema>;

export const updateViewSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  ast: workfloQuerySchema.optional(),
  scope: viewScopeSchema.optional(),
  pinned: z.boolean().optional(),
});
export type UpdateView = z.infer<typeof updateViewSchema>;

export const viewListQuerySchema = z.object({ workspaceId: z.string().cuid() });
export type ViewListQuery = z.infer<typeof viewListQuerySchema>;
