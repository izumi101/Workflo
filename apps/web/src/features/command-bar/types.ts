import type { Label, Project, WorkspaceMember } from "@workflo/shared";

/**
 * Every top-level `WorkfloQuery` field that can render as a chip, PLUS
 * "text" for the free-text FTS clause. One chip per present field — see
 * `chip-format.ts`'s `deriveChips` (the bijective chips <-> AST invariant,
 * docs/design/nlq-search.md §2.3).
 */
export type FieldKey =
  | "project"
  | "type"
  | "status"
  | "priority"
  | "assignee"
  | "reporter"
  | "labels"
  | "due"
  | "updated"
  | "created"
  | "order"
  | "text";

/** A candidate entity for a tentative chip (§2.4 — "multiple -> tentative ... Enter shows list"). */
export interface Candidate {
  id: string;
  label: string;
}

/** Per-field bookkeeping for an ambiguous name resolution — only present while a chip is tentative. */
export interface TentativeInfo {
  candidates: Candidate[];
}

export type TentativeMap = Partial<Record<FieldKey, TentativeInfo>>;

/**
 * The client-side entity directory used to resolve names -> ids (and back,
 * for chip display). Loaded once per active workspace via
 * `command-bar.queries.ts`'s `useCommandBarDirectory`.
 */
export interface Directory {
  members: WorkspaceMember[];
  projects: Project[];
  labels: Label[];
}

export type ChipDisplayState = "firm" | "tentative" | "text";

/** A derived, render-ready chip — see `chip-format.ts`'s `deriveChips`. */
export interface ChipView {
  field: FieldKey;
  state: ChipDisplayState;
  /** Short field label shown before the colon, e.g. "assignee". */
  fieldLabel: string;
  /** The value portion, e.g. "me" or "Alice, Bob". */
  valueLabel: string;
  candidates?: Candidate[];
}
