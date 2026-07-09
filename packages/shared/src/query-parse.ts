import type { IssueStatus, IssueType, Priority } from "./enums.js";
import { workfloQuerySchema, type QueryWarning, type WorkfloQuery } from "./query.js";

/**
 * Lane A of the NLQ pipeline (docs/design/nlq-search.md §2.2) — a pure,
 * synchronous, NO-I/O deterministic parser. Runs on every keystroke,
 * client-side, zero network. Recognizes a CLOSED grammar of common filter
 * phrasings and turns them into concrete `WorkfloQuery` clauses; everything
 * it doesn't recognize is left as the free-text `text` clause (the FTS
 * term) — nothing typed is ever silently dropped.
 *
 * Deliberately does NOT resolve entity names (people/projects/labels) to
 * ids: that requires a per-workspace directory, which is only available to
 * the caller (client-side, or the server at execute-time), not to this pure
 * function. `@Name` tokens (and "assigned to <Name>"/"reported by <Name>")
 * are recognized SYNTACTICALLY (removed from the free-text residue so they
 * don't pollute the FTS term) but surfaced as a `{kind: "mention"}` warning
 * carrying the raw name — the caller resolves it against the directory (or
 * leaves it as a tentative/text chip) before sending an AST to
 * `/query/execute`. Same reasoning applies to project/label names — they
 * are NOT recognized here (no directory), and fall through into `text`.
 *
 * Resolution policy for contradictory input (e.g. two different status
 * words in one sentence): first match wins per field; later conflicting
 * words for the same field are still stripped from the residual text (so
 * they don't leak into the FTS term) but do not overwrite the first value.
 * This function never throws — arbitrary/garbage input always returns some
 * `{ast, warnings}` (worst case: an all-`text` AST with no warnings).
 */
export interface ParseQueryDeterministicResult {
  ast: WorkfloQuery;
  warnings: QueryWarning[];
}

/**
 * `text.replace(re, " ")`, reporting whether anything changed. Always use
 * `.replace()` — never `.test()`/`.exec()` — for a global-flag regex here:
 * per spec, `String.prototype.replace` always resets the regex's
 * `lastIndex` to 0 before scanning, so this is safe to call repeatedly
 * (including reusing module-scoped regex constants across calls) without
 * the classic stateful-`lastIndex` gotcha that affects `.test()`/`.exec()`.
 */
function strip(text: string, re: RegExp): { text: string; matched: boolean } {
  const next = text.replace(re, " ");
  return { text: next, matched: next !== text };
}

/** Collects every capture-group-1 match of a global regex without mutating `text`. */
function collectMentions(text: string, re: RegExp): string[] {
  const found: string[] = [];
  const local = new RegExp(re.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = local.exec(text))) {
    found.push(m[1]!);
  }
  return found;
}

const SORT_BY = /\bsort by (smart|updated|created|due|priority)\b/gi;

const REPORTED_BY_ME = /\breported by me\b/gi;
const ASSIGNED_TO_ME = /\bassigned to me\b/gi;
const BARE_MY = /\bmy\b/gi;

const UNASSIGNED = /\bunassigned\b/gi;

const REPORTER_MENTION = /\b(?:reported|filed|created) by @([A-Za-z][\w'-]*)/gi;
const ASSIGNEE_MENTION_TO = /\bassigned to @([A-Za-z][\w'-]*)/gi;
const BARE_MENTION = /@([A-Za-z][\w'-]*)/gi;

const PRIORITY_AT_LEAST_HIGH = /\bhigh\s*\+/gi;
const PRIORITY_WORDS: Array<[RegExp, Priority]> = [
  [/\b(?:urgent|p1)\b/gi, "URGENT"],
  [/\bhigh\b/gi, "HIGH"],
  [/\bmedium\b/gi, "MEDIUM"],
  [/\blow\b/gi, "LOW"],
];

const TYPE_WORDS: Array<[RegExp, IssueType]> = [
  [/\bbugs?\b/gi, "BUG"],
  [/\btasks?\b/gi, "TASK"],
  [/\bepics?\b/gi, "EPIC"],
];

const STATUS_IN_PROGRESS = /\bin progress\b/gi;
const STATUS_TODO = /\bto[\s-]?do\b/gi;
const STATUS_DONE = /\bdone\b/gi;
const STATUS_OPEN = /\bopen\b/gi;

const OVERDUE = /\boverdue\b/gi;
const DUE_TODAY = /\bdue today\b/gi;
const DUE_THIS_WEEK = /\bdue this week\b/gi;
const DUE_BEFORE = /\bdue before \d{4}-\d{2}-\d{2}\b/gi;

const UPDATED_LAST_N_DAYS = /\bupdated in (?:the )?last \d+ days?\b/gi;
const CREATED_LAST_N_DAYS = /\bcreated in (?:the )?last \d+ days?\b/gi;
const STALE = /\b(?:stale|untouched)\b/gi;

export function parseQueryDeterministic(input: string): ParseQueryDeterministicResult {
  const warnings: QueryWarning[] = [];
  const draft: Partial<WorkfloQuery> = {};
  let text = typeof input === "string" ? input : "";

  // --- sort by <field> --- (extracted first so a leftover bare field word,
  // e.g. "priority" in "sort by priority", is removed as part of the whole
  // phrase rather than left to interact with later per-word rules).
  const sortMatch = /\bsort by (smart|updated|created|due|priority)\b/i.exec(text);
  if (sortMatch) {
    draft.order = sortMatch[1]!.toLowerCase() as WorkfloQuery["order"];
  }
  text = strip(text, SORT_BY).text;

  // --- reporter / assignee = me ---
  let hit = strip(text, REPORTED_BY_ME);
  text = hit.text;
  if (hit.matched) draft.reporter = "me";

  hit = strip(text, ASSIGNED_TO_ME);
  text = hit.text;
  if (!draft.assignee && hit.matched) draft.assignee = "me";

  hit = strip(text, BARE_MY);
  text = hit.text;
  if (!draft.assignee && hit.matched) draft.assignee = "me";

  // --- unassigned ---
  hit = strip(text, UNASSIGNED);
  text = hit.text;
  if (!draft.assignee && hit.matched) draft.assignee = "unassigned";

  // --- @Name mentions (recognized syntactically, resolved by the caller) ---
  for (const name of collectMentions(text, REPORTER_MENTION)) {
    warnings.push({ field: "reporter", kind: "mention", text: name });
  }
  text = strip(text, REPORTER_MENTION).text;

  for (const name of collectMentions(text, ASSIGNEE_MENTION_TO)) {
    warnings.push({ field: "assignee", kind: "mention", text: name });
  }
  text = strip(text, ASSIGNEE_MENTION_TO).text;

  for (const name of collectMentions(text, BARE_MENTION)) {
    warnings.push({ field: "assignee", kind: "mention", text: name });
  }
  text = strip(text, BARE_MENTION).text;

  // --- priority words --- ("high+" checked before bare "high")
  hit = strip(text, PRIORITY_AT_LEAST_HIGH);
  text = hit.text;
  const atLeastMatched = hit.matched;

  const priorityFound = new Set<Priority>();
  for (const [re, value] of PRIORITY_WORDS) {
    const r = strip(text, re);
    text = r.text;
    if (r.matched) priorityFound.add(value);
  }

  if (atLeastMatched) {
    draft.priority = { atLeast: "HIGH" };
  } else if (priorityFound.size > 0) {
    draft.priority = { in: Array.from(priorityFound) };
  }

  // --- type words ---
  const typeFound = new Set<IssueType>();
  for (const [re, value] of TYPE_WORDS) {
    const r = strip(text, re);
    text = r.text;
    if (r.matched) typeFound.add(value);
  }
  if (typeFound.size > 0) {
    draft.type = { in: Array.from(typeFound) };
  }

  // --- status words ---
  const statusFound = new Set<IssueStatus>();
  hit = strip(text, STATUS_IN_PROGRESS);
  text = hit.text;
  if (hit.matched) statusFound.add("IN_PROGRESS");

  hit = strip(text, STATUS_TODO);
  text = hit.text;
  if (hit.matched) statusFound.add("TODO");

  hit = strip(text, STATUS_DONE);
  text = hit.text;
  if (hit.matched) statusFound.add("DONE");

  hit = strip(text, STATUS_OPEN);
  text = hit.text;
  const openMatched = hit.matched;

  if (statusFound.size > 0) {
    draft.status = { in: Array.from(statusFound) };
  } else if (openMatched) {
    draft.status = { not: "DONE" };
  }

  // --- overdue (mutually exclusive with the other `due` shapes) ---
  hit = strip(text, OVERDUE);
  text = hit.text;
  if (hit.matched) {
    draft.due = { overdue: true };
  }

  // --- due today / this week / before <date> ---
  if (!draft.due) {
    const beforeMatch = /\bdue before (\d{4}-\d{2}-\d{2})\b/i.exec(text);
    if (beforeMatch) {
      const dateStr = beforeMatch[1]!;
      // The AST has no standalone "before an absolute date" shape for `due`
      // (only withinDays/olderThanDays/between/overdue, per the LOCKED
      // §3.1 schema) — represented as a `between` range from the epoch up
      // to the end of the named date, which is exactly "due before <date>"
      // (inclusive of everything overdue too, which is the intuitive read).
      draft.due = { between: ["1970-01-01T00:00:00.000Z", `${dateStr}T23:59:59.999Z`] };
    }
  }
  text = strip(text, DUE_BEFORE).text;

  hit = strip(text, DUE_TODAY);
  text = hit.text;
  if (!draft.due && hit.matched) {
    // Approximation: "today" as a rolling 24h window from execution time
    // rather than the caller's calendar-day boundary (would need
    // `tz`-aware start/end-of-day math not attempted at parse time, since
    // this function has no access to "now"). Documented limitation.
    draft.due = { withinDays: 1 };
  }

  hit = strip(text, DUE_THIS_WEEK);
  text = hit.text;
  if (!draft.due && hit.matched) {
    draft.due = { withinDays: 7 };
  }

  // --- updated / created in last N days ---
  const updatedMatch = /\bupdated in (?:the )?last (\d+) days?\b/i.exec(text);
  if (updatedMatch) {
    draft.updated = { withinDays: Number(updatedMatch[1]) };
  }
  text = strip(text, UPDATED_LAST_N_DAYS).text;

  const createdMatch = /\bcreated in (?:the )?last (\d+) days?\b/i.exec(text);
  if (createdMatch) {
    draft.created = { withinDays: Number(createdMatch[1]) };
  }
  text = strip(text, CREATED_LAST_N_DAYS).text;

  // --- stale / untouched -> updated: olderThanDays 7 (only if `updated`
  // isn't already set by a more specific "updated in last N days" clause;
  // the words are stripped from the residue either way) ---
  hit = strip(text, STALE);
  text = hit.text;
  if (!draft.updated && hit.matched) {
    draft.updated = { olderThanDays: 7 };
  }

  // --- whatever's left is the free-text FTS term ---
  const residual = text.replace(/\s+/g, " ").trim();
  if (residual.length > 0) {
    draft.text = residual.slice(0, 255);
  }

  const ast = workfloQuerySchema.parse(draft);
  return { ast, warnings };
}
