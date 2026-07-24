import { z } from "zod";
import { workfloQuerySchema } from "./query.js";
import { queryResultSchema } from "./query.js";

/**
 * Smart Triage (docs/design/nlq-search.md §2.7/§3.5) — `/triage`, per-user,
 * workspace-scoped, "meant to be empty". Three of the four sections are
 * canned `WorkfloQuery` ASTs run through the existing `QueryExecutionService`
 * (see apps/api/src/triage/triage.service.ts); `NEEDS_REPLY` is a bespoke
 * comment-join with no AST representation.
 */
export const triageSectionKeySchema = z.enum(["OVERDUE", "GOING_STALE", "NEEDS_REPLY", "UNOWNED_URGENT"]);
export type TriageSectionKey = z.infer<typeof triageSectionKeySchema>;

export const triageSectionSchema = z.object({
  key: triageSectionKeySchema,
  title: z.string(),
  description: z.string(),
  /** The canned AST behind this section, so the FE can render the chip rail ("why is this here"). null for NEEDS_REPLY, which is a bespoke comment-join with no AST representation. */
  ast: workfloQuerySchema.nullable(),
  items: z.array(queryResultSchema),
});
export type TriageSection = z.infer<typeof triageSectionSchema>;

export const triageResponseSchema = z.object({
  sections: z.array(triageSectionSchema),
  badge: z.number().int().nonnegative(),
});
export type TriageResponse = z.infer<typeof triageResponseSchema>;

export const triageQuerySchema = z.object({
  workspaceId: z.string().cuid(),
  tz: z.coerce.number().int().optional(),
});
export type TriageQuery = z.infer<typeof triageQuerySchema>;

export const triageDismissRequestSchema = z.object({
  issueId: z.string().cuid(),
  section: triageSectionKeySchema,
});
export type TriageDismissRequest = z.infer<typeof triageDismissRequestSchema>;

export const triageSeenRequestSchema = z.object({ workspaceId: z.string().cuid() });
export type TriageSeenRequest = z.infer<typeof triageSeenRequestSchema>;
