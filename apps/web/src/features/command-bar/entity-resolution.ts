import { workfloQuerySchema, type WorkfloQuery } from "@workflo/shared";
import type { ParseQueryDeterministicResult } from "@workflo/shared";
import type { Candidate, Directory, FieldKey, TentativeMap } from "./types.js";

/**
 * Lane A's client-side half of entity resolution (docs/design/nlq-search.md
 * §2.2/§2.4). `parseQueryDeterministic` (packages/shared) is a pure function
 * with NO directory access — it can recognize `@Name`/"assigned to
 * X"/"reported by X" SYNTACTICALLY (stripped from the residual text) and
 * surfaces each as a `{field, kind:"mention", text:name}` warning, but it
 * cannot turn a name into a userId. It also does NOT recognize project or
 * label names at all (no directory, no grammar for them — see that file's
 * header comment) — they simply fall through into the residual `text`.
 *
 * This module is where both halves get resolved against the workspace
 * directory (members/projects/labels), which only the client (or the
 * server at execute-time) has:
 *
 *  - assignee/reporter `mention` warnings: matched against
 *    `directory.members` by name (exact match preferred, then
 *    startsWith/contains). Zero matches -> the raw `@Name` text is folded
 *    back into the FTS `text` clause (nothing typed is silently dropped,
 *    per §2.4 "zero -> text chip" — the parser already stripped it out of
 *    the residue when it recognized the mention shape, so we must
 *    re-inject it here). One match -> firm. Multiple matches -> tentative,
 *    defaulting to the first (top) candidate, exactly as §2.4 specifies
 *    ("multiple -> tentative (top candidate ..., Enter shows list)").
 *    If the field is already set to something else (e.g. "assigned to me"
 *    elsewhere in the same sentence), the mention is left as text instead
 *    of trying to merge with "me"/"unassigned" — same first-match-wins
 *    policy the deterministic parser itself documents.
 *
 *  - project/label names: NOT covered by any parser warning (see above),
 *    so this is a from-scratch, deliberately simple whole-token pass over
 *    the residual `text`: split on whitespace, and for each token check
 *    for an exact (case-insensitive) match against a project KEY (e.g.
 *    "WF") or a label name. This is a v1a simplification/deviation — a
 *    fuzzier phrase-level matcher (multi-word project/label names, partial
 *    matches) was judged too easy to false-positive against ordinary
 *    sentence words for a first cut, and is flagged as a follow-up rather
 *    than guessed at silently. A matched token is removed from the
 *    residual text (so it doesn't pollute the FTS term) and turned into a
 *    firm (single match) or tentative (name shared by >1 label across
 *    projects) chip, following the same policy as mentions.
 */

interface MentionWarning {
  field: "assignee" | "reporter";
  name: string;
}

function collectMentionWarnings(parsed: ParseQueryDeterministicResult): MentionWarning[] {
  const out: MentionWarning[] = [];
  for (const w of parsed.warnings) {
    if (w.kind === "mention" && w.text && (w.field === "assignee" || w.field === "reporter")) {
      out.push({ field: w.field, name: w.text });
    }
  }
  return out;
}

/** Exact match preferred; falls back to startsWith, then contains — all case-insensitive. */
function findMemberMatches(name: string, members: Directory["members"]): Directory["members"] {
  const lower = name.toLowerCase();
  const exact = members.filter((m) => m.user.name.toLowerCase() === lower);
  if (exact.length > 0) return exact;
  const startsWith = members.filter((m) => m.user.name.toLowerCase().startsWith(lower));
  if (startsWith.length > 0) return startsWith;
  return members.filter((m) => m.user.name.toLowerCase().includes(lower));
}

function resolveMentionField(
  field: "assignee" | "reporter",
  names: string[],
  directory: Directory,
  ast: WorkfloQuery,
  tentative: TentativeMap,
  extraText: string[],
): void {
  if (ast[field] !== undefined) {
    // Field already set by something else in the same sentence (e.g. "me") —
    // first-match-wins; the mention becomes free text instead.
    for (const name of names) extraText.push(`@${name}`);
    return;
  }

  const resolvedIds = new Set<string>();
  let ambiguous: Candidate[] | null = null;

  for (const name of names) {
    const matches = findMemberMatches(name, directory.members);
    if (matches.length === 0) {
      extraText.push(`@${name}`);
    } else {
      resolvedIds.add(matches[0]!.userId);
      if (matches.length > 1 && !ambiguous) {
        ambiguous = matches.map((m) => ({ id: m.userId, label: m.user.name }));
      }
    }
  }

  if (resolvedIds.size > 0) {
    const idList = Array.from(resolvedIds);
    if (field === "assignee") ast.assignee = { in: idList };
    else ast.reporter = { in: idList };
    if (ambiguous) tentative[field] = { candidates: ambiguous };
  }
}

/** Strips a trailing/leading punctuation run from a whitespace-split token before matching. */
function bareToken(token: string): string {
  return token.replace(/^[.,!?;:"'()]+|[.,!?;:"'()]+$/g, "");
}

function resolveProjectAndLabelTokens(
  text: string,
  directory: Directory,
  ast: WorkfloQuery,
  tentative: TentativeMap,
): string {
  const words = text.split(/\s+/).filter(Boolean);
  const remaining: string[] = [];
  const projectIds = new Set<string>();
  const labelIds = new Set<string>();
  let labelAmbiguous: Candidate[] | null = null;

  for (const word of words) {
    const token = bareToken(word).toLowerCase();
    if (!token) {
      remaining.push(word);
      continue;
    }

    const projectMatch =
      ast.project === undefined ? directory.projects.find((p) => p.key.toLowerCase() === token) : undefined;
    if (projectMatch) {
      projectIds.add(projectMatch.id);
      continue;
    }

    if (ast.labels === undefined) {
      const labelMatches = directory.labels.filter((l) => l.name.toLowerCase() === token);
      if (labelMatches.length === 1) {
        labelIds.add(labelMatches[0]!.id);
        continue;
      }
      if (labelMatches.length > 1) {
        labelIds.add(labelMatches[0]!.id);
        if (!labelAmbiguous) {
          labelAmbiguous = labelMatches.map((l) => ({ id: l.id, label: l.name }));
        }
        continue;
      }
    }

    remaining.push(word);
  }

  if (projectIds.size > 0) {
    ast.project = { in: Array.from(projectIds) };
  }
  if (labelIds.size > 0) {
    ast.labels = { any: Array.from(labelIds) };
    if (labelAmbiguous) tentative.labels = { candidates: labelAmbiguous };
  }

  return remaining.join(" ");
}

export interface ResolveEntitiesResult {
  ast: WorkfloQuery;
  tentative: TentativeMap;
}

/**
 * Turns a deterministic-parse result into a fully client-resolved AST —
 * this is the "client-side entity resolution" step of Lane A. Pure and
 * synchronous (the directory is already loaded via TanStack Query by the
 * time this runs), so it needs no request-id race guard of its own; only
 * the subsequent `/query/execute` call does (see `useCommandBar`).
 */
export function resolveEntities(parsed: ParseQueryDeterministicResult, directory: Directory): ResolveEntitiesResult {
  const ast: WorkfloQuery = { ...parsed.ast };
  const tentative: TentativeMap = {};
  const extraText: string[] = [];

  const mentions = collectMentionWarnings(parsed);
  const byField = new Map<"assignee" | "reporter", string[]>();
  for (const m of mentions) {
    const arr = byField.get(m.field) ?? [];
    arr.push(m.name);
    byField.set(m.field, arr);
  }
  for (const [field, names] of byField) {
    resolveMentionField(field, names, directory, ast, tentative, extraText);
  }

  if (ast.text) {
    ast.text = resolveProjectAndLabelTokens(ast.text, directory, ast, tentative) || undefined;
  }

  if (extraText.length > 0) {
    const combined = [ast.text, ...extraText].filter(Boolean).join(" ").trim();
    ast.text = combined ? combined.slice(0, 255) : undefined;
  }

  return { ast: workfloQuerySchema.parse(ast), tentative };
}

/** Applies a user's explicit candidate pick (Enter on a tentative chip) — always resolves to a single id, firm. */
export function applyCandidate(ast: WorkfloQuery, field: FieldKey, candidateId: string): WorkfloQuery {
  const next: WorkfloQuery = { ...ast };
  if (field === "assignee") next.assignee = { in: [candidateId] };
  else if (field === "reporter") next.reporter = { in: [candidateId] };
  else if (field === "labels") next.labels = { any: [candidateId] };
  else if (field === "project") next.project = { in: [candidateId] };
  return workfloQuerySchema.parse(next);
}

export function isAstEmpty(ast: WorkfloQuery): boolean {
  return Object.keys(ast).filter((k) => k !== "v").length === 0;
}
