import type { Prisma } from "@prisma/client";
import type { QueryResult } from "@workflo/shared";

/**
 * Pure move (NLQ V1a step 5 / triage brief): this `include`/mapper pair used
 * to be private to `query-execution.service.ts`. Extracted so
 * `triage.service.ts`'s bespoke NEEDS_REPLY (comment-join) rows are hydrated
 * through the EXACT same shape as the three AST-backed sections — no
 * behavior change here, just a shared home for both callers.
 */
export const ISSUE_INCLUDE = {
  labels: { select: { id: true } },
  project: { select: { key: true } },
} as const;

export type IssueRow = Prisma.IssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

export function toQueryResult(row: IssueRow): QueryResult {
  return {
    id: row.id,
    key: `${row.project.key}-${row.number}`,
    title: row.title,
    status: row.status,
    priority: row.priority,
    projectId: row.projectId,
    assigneeId: row.assigneeId,
    dueDate: row.dueDate,
    updatedAt: row.updatedAt,
    labelIds: row.labels.map((l) => l.id),
    type: row.type,
  };
}
