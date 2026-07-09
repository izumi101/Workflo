import { z } from "zod";
import { issueTypeSchema, issueStatusSchema, prioritySchema } from "./enums.js";
import { searchResultSchema } from "./search.js";

/**
 * The Workflo NLQ query engine — "no-JQL" search (docs/design/nlq-search.md).
 * This file is the ONE Zod schema with (eventually) four consumers: FE chips,
 * BE compiler, the Claude structured-output contract (§3.3, a LATER task),
 * and View storage (also later). V1a (this slice) implements only the AST +
 * the deterministic (zero-LLM) parser + the execute contracts — see
 * query-parse.ts for parseQueryDeterministic.
 *
 * Design invariants (§3.1, LOCKED):
 *  - Flat, non-recursive: every field is a top-level optional clause,
 *    AND-combined. No nested boolean trees (that's what keeps a future
 *    strict-schema LLM structured-output expressible, and compilation
 *    trivial). IN-lists give per-field OR (e.g. `status: {in: [...]}`).
 *  - Symbolic time & identity: `"me"`, `"unassigned"`, and relative-day
 *    ranges (`withinDays`/`olderThanDays`) are NEVER resolved here — only at
 *    execution time, using the caller's id/now/timezone (see
 *    apps/api/src/query/query-compiler.service.ts). This is what makes a
 *    cached parse or a saved View stay "live" (re-resolves per viewer/day).
 *  - No workspace field: the AST cannot name a workspace. Workspace scope is
 *    ALWAYS supplied by the server (WorkspaceMemberGuard context), never by
 *    the AST — direct application of the 2026-07-04 issue-key-collision
 *    lesson (see CLAUDE.md §8 "BUGFIX" for that date). See the compiler's
 *    invariant tests for the enforcement of this.
 */

/**
 * `{withinDays: N}` / `{olderThanDays: N}` / `{between: [ISO, ISO]}`.
 * Resolved to concrete timestamps only at execution (`now` + tz). The
 * DIRECTION of `withinDays` depends on which field it's attached to (the
 * compiler owns this, not this schema): for `due` it's a forward-looking
 * window (now .. now+N days — "due soon"); for `updated`/`created` it's a
 * backward-looking window (now-N days .. now — "touched recently").
 * `olderThanDays` is always backward from now regardless of field (due:
 * "overdue by more than N days"; updated/created: "not touched in over N
 * days" — the "stale" definition).
 */
export const relativeRangeSchema = z.union([
  z.object({ withinDays: z.number().int().nonnegative() }),
  z.object({ olderThanDays: z.number().int().nonnegative() }),
  z.object({
    between: z.tuple([
      z.string().min(1), // ISO date/datetime string, validated loosely (no I/O here)
      z.string().min(1),
    ]),
  }),
]);
export type RelativeRange = z.infer<typeof relativeRangeSchema>;

const idListSchema = z.array(z.string().cuid()).min(1);

/**
 * `workfloQuery` v1 — see file header. Every field optional; AND semantics
 * across present fields. `v` is a literal so a future v2 (e.g. OR-groups)
 * can be introduced additively without breaking stored Views/caches.
 */
export const workfloQuerySchema = z.object({
  v: z.literal(1).default(1),

  /** Free-text term → Postgres FTS (websearch_to_tsquery), never SQL-concatenated. */
  text: z.string().max(255).optional(),

  project: z.object({ in: idListSchema }).optional(),
  type: z.object({ in: z.array(issueTypeSchema).min(1) }).optional(),

  status: z.union([z.object({ in: z.array(issueStatusSchema).min(1) }), z.object({ not: z.literal("DONE") })]).optional(),

  priority: z.union([z.object({ in: z.array(prioritySchema).min(1) }), z.object({ atLeast: prioritySchema })]).optional(),

  assignee: z.union([z.object({ in: idListSchema }), z.literal("me"), z.literal("unassigned")]).optional(),

  reporter: z.union([z.object({ in: idListSchema }), z.literal("me")]).optional(),

  labels: z.union([z.object({ any: idListSchema }), z.object({ all: idListSchema })]).optional(),

  due: z.union([relativeRangeSchema, z.object({ overdue: z.literal(true) })]).optional(),
  updated: relativeRangeSchema.optional(),
  created: relativeRangeSchema.optional(),

  order: z.enum(["smart", "updated", "created", "due", "priority"]).optional(),
});
export type WorkfloQuery = z.infer<typeof workfloQuerySchema>;

/**
 * Structured warning surfaced when a clause couldn't be fully honored:
 *  - "unmapped": free text the deterministic parser recognized as NOT
 *    mapping to any closed-grammar field (kept in `text`, never silently
 *    dropped).
 *  - "mention": an `@Name`/name-shaped token the parser found but can't
 *    resolve to a userId without a directory (resolution happens
 *    client-side, where the workspace member directory is available; see
 *    query-parse.ts's doc comment).
 *  - "invalid_id": (compiler-side) an id in the AST didn't belong to the
 *    caller's workspace and its clause (or the offending id within it) was
 *    dropped rather than widening scope or erroring — see the compiler's
 *    security-invariant tests.
 */
export const queryWarningSchema = z.object({
  field: z.string(),
  kind: z.enum(["unmapped", "mention", "invalid_id"]),
  text: z.string().optional(),
  ids: z.array(z.string()).optional(),
});
export type QueryWarning = z.infer<typeof queryWarningSchema>;

/**
 * `POST /query/execute` request body. `ast` carries no workspace field (see
 * file header) — `workspaceId` is the top-level, server-authorized scope.
 * `tz` is the caller's local UTC offset in MINUTES (e.g. UTC-5 => -300),
 * plumbed through to the compiler's execution context; v1a's relative-range
 * resolution is pure duration math from `now` and doesn't need it, but it's
 * accepted now for interface stability with future calendar-boundary-aware
 * resolution (e.g. a precise "due today" aligned to the caller's local
 * midnight).
 */
export const queryExecuteRequestSchema = z.object({
  workspaceId: z.string().cuid(),
  ast: workfloQuerySchema,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  tz: z.number().int().optional(),
});
export type QueryExecuteRequest = z.infer<typeof queryExecuteRequestSchema>;

/**
 * One result row — `SearchResult` (id/key/title/status/priority/projectId)
 * plus the fields the query-adaptive results column needs (§2.5):
 * assigneeId, dueDate, updatedAt, labelIds, type.
 */
export const queryResultSchema = searchResultSchema.extend({
  assigneeId: z.string().cuid().nullable(),
  dueDate: z.coerce.date().nullable(),
  updatedAt: z.coerce.date(),
  labelIds: z.array(z.string().cuid()),
  type: issueTypeSchema,
});
export type QueryResult = z.infer<typeof queryResultSchema>;

export const queryExecuteResponseSchema = z.object({
  items: z.array(queryResultSchema),
  nextCursor: z.string().nullable(),
});
export type QueryExecuteResponse = z.infer<typeof queryExecuteResponseSchema>;
