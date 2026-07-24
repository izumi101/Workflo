import type { WorkfloQuery } from "@workflo/shared";
import type { ChipView, Directory, FieldKey, TentativeMap } from "./types.js";

const FIELD_ORDER: FieldKey[] = [
  "project",
  "type",
  "status",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "due",
  "updated",
  "created",
  "order",
];

function namesFor(ids: string[], byId: Map<string, string>): string {
  return ids.map((id) => byId.get(id) ?? "?").join(", ");
}

function formatRelative(field: "due" | "updated" | "created", value: NonNullable<WorkfloQuery["due" | "updated" | "created"]>): string {
  if ("overdue" in value) return `${field}: overdue`;
  if ("withinDays" in value) {
    return field === "due" ? `${field}: within ${value.withinDays}d` : `${field}: last ${value.withinDays}d`;
  }
  if ("olderThanDays" in value) {
    return `${field}: >${value.olderThanDays}d ago`;
  }
  if ("between" in value) {
    const [, end] = value.between;
    return `${field}: before ${end.slice(0, 10)}`;
  }
  return field;
}

/**
 * `field: value` display strings for every populated AST field (§2.3). Pure
 * function of the AST + a name directory — never stores display strings in
 * state, so a chip can never drift from what the AST actually says.
 */
export function formatFieldLabel(field: FieldKey, ast: WorkfloQuery, directory: Directory): string {
  const projectById = new Map(directory.projects.map((p) => [p.id, p.key]));
  const memberById = new Map(directory.members.map((m) => [m.userId, m.user.name]));
  const labelById = new Map(directory.labels.map((l) => [l.id, l.name]));

  switch (field) {
    case "project":
      return `project: ${namesFor(ast.project?.in ?? [], projectById)}`;
    case "type":
      return `type: ${(ast.type?.in ?? []).join(", ")}`;
    case "status":
      if (!ast.status) return "status";
      return "in" in ast.status ? `status: ${ast.status.in.join(", ")}` : "status: not Done";
    case "priority":
      if (!ast.priority) return "priority";
      return "atLeast" in ast.priority ? `priority: ${ast.priority.atLeast}+` : `priority: ${ast.priority.in.join(", ")}`;
    case "assignee":
      if (ast.assignee === "me") return "assignee: me";
      if (ast.assignee === "unassigned") return "assignee: unassigned";
      return `assignee: ${namesFor(ast.assignee?.in ?? [], memberById)}`;
    case "reporter":
      if (ast.reporter === "me") return "reporter: me";
      return `reporter: ${namesFor(ast.reporter?.in ?? [], memberById)}`;
    case "labels":
      if (!ast.labels) return "labels";
      return "any" in ast.labels
        ? `labels: ${namesFor(ast.labels.any, labelById)}`
        : `labels (all): ${namesFor(ast.labels.all, labelById)}`;
    case "due":
      return ast.due ? formatRelative("due", ast.due) : "due";
    case "updated":
      return ast.updated ? formatRelative("updated", ast.updated) : "updated";
    case "created":
      return ast.created ? formatRelative("created", ast.created) : "created";
    case "order":
      return `sort: ${ast.order}`;
    case "text":
      return `contains: "${ast.text ?? ""}"`;
    default:
      return field;
  }
}

/**
 * Derives the render-ready chip list from the AST + tentative-candidate
 * metadata (§2.3 — chips <-> AST clauses are bijective, so chips are always
 * DERIVED, never stored independently). Field order is fixed for a stable,
 * predictable rail; the free-text chip (if any) always renders last.
 */
export function deriveChips(ast: WorkfloQuery, tentative: TentativeMap, directory: Directory): ChipView[] {
  const chips: ChipView[] = [];

  for (const field of FIELD_ORDER) {
    if (ast[field] === undefined) continue;
    const isTentative = Boolean(tentative[field]);
    const full = formatFieldLabel(field, ast, directory);
    const sep = full.indexOf(":");
    chips.push({
      field,
      state: isTentative ? "tentative" : "firm",
      fieldLabel: sep >= 0 ? full.slice(0, sep) : full,
      valueLabel: sep >= 0 ? full.slice(sep + 1).trim() : "",
      candidates: tentative[field]?.candidates,
    });
  }

  if (ast.text) {
    chips.push({ field: "text", state: "text", fieldLabel: "contains", valueLabel: `"${ast.text}"` });
  }

  return chips;
}

/** Removes one clause from the AST (the "x" / Backspace transparency contract — §2.3). */
export function removeField(ast: WorkfloQuery, field: FieldKey): WorkfloQuery {
  const next = { ...ast };
  delete next[field];
  return next;
}
