import type { IssueStatus, Priority, WorkfloQuery } from "@workflo/shared";

export const STATUS_LABELS: Record<IssueStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export type AdaptiveColumnKind = "due" | "assignee" | "updated";

/**
 * §2.5 "query-adaptive context column": date if the AST filters on any date
 * field, else assignee if it filters assignee, else relative updatedAt.
 * `due` is checked before `updated`/`created` since a query can combine
 * several date filters but due-ness is the most actionable to surface.
 */
export function adaptiveColumnKind(ast: WorkfloQuery): AdaptiveColumnKind {
  if (ast.due || ast.updated || ast.created) return ast.due ? "due" : "updated";
  if (ast.assignee || ast.reporter) return "assignee";
  return "updated";
}

export function formatDueDate(dueDate: Date | string | null): string {
  if (!dueDate) return "—";
  const date = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
