import type { QueryResult, WorkfloQuery } from "@workflo/shared";
import { applyCandidate, isAstEmpty } from "./entity-resolution.js";
import { removeField } from "./chip-format.js";
import type { FieldKey, TentativeMap } from "./types.js";

/**
 * The command bar's single state machine (docs/design/nlq-search.md §2.2:
 * "one reducer owns chip/result state"). Every transition — typing, entity
 * resolution landing, an execute response arriving, removing a chip,
 * picking a candidate, moving the keyboard highlight — goes through this
 * reducer. This is what makes the two-lane input race-safe: `execute`
 * responses carry the request id they were fired with, and are dropped in
 * the reducer itself if a newer request has since started (see
 * `EXECUTE_SUCCESS`/`EXECUTE_ERROR`), so a slow response for a
 * since-superseded keystroke can never clobber a newer one.
 */
export interface CommandBarState {
  rawInput: string;
  ast: WorkfloQuery;
  tentative: TentativeMap;
  results: QueryResult[];
  nextCursor: string | null;
  highlightedIndex: number;
  pendingExecuteReqId: number;
  executeStatus: "idle" | "loading" | "success" | "error";
  /** Roving keyboard focus within the chip rail; `null` = focus is on the text input. */
  chipFocusIndex: number | null;
  /** Which tentative chip currently has its candidate list open (Enter on a tentative chip). */
  candidatePickerField: FieldKey | null;
}

export const EMPTY_AST: WorkfloQuery = { v: 1 };

export const initialCommandBarState: CommandBarState = {
  rawInput: "",
  ast: EMPTY_AST,
  tentative: {},
  results: [],
  nextCursor: null,
  highlightedIndex: 0,
  pendingExecuteReqId: 0,
  executeStatus: "idle",
  chipFocusIndex: null,
  candidatePickerField: null,
};

export type CommandBarAction =
  | { type: "SET_RAW_INPUT"; input: string }
  | { type: "PARSED"; ast: WorkfloQuery; tentative: TentativeMap }
  | { type: "EXECUTE_START"; reqId: number }
  | { type: "EXECUTE_SUCCESS"; reqId: number; items: QueryResult[]; nextCursor: string | null }
  | { type: "EXECUTE_ERROR"; reqId: number }
  | { type: "APPEND_RESULTS"; items: QueryResult[]; nextCursor: string | null }
  | { type: "SET_HIGHLIGHT"; index: number }
  | { type: "REMOVE_CHIP"; field: FieldKey }
  | { type: "RESOLVE_CANDIDATE"; field: FieldKey; candidateId: string }
  | { type: "OPEN_CANDIDATE_PICKER"; field: FieldKey }
  | { type: "CLOSE_CANDIDATE_PICKER" }
  | { type: "SET_CHIP_FOCUS"; index: number | null }
  | { type: "RESET" };

export function commandBarReducer(state: CommandBarState, action: CommandBarAction): CommandBarState {
  switch (action.type) {
    case "SET_RAW_INPUT":
      return { ...state, rawInput: action.input };

    case "PARSED":
      return {
        ...state,
        ast: action.ast,
        tentative: action.tentative,
        highlightedIndex: 0,
        candidatePickerField: null,
        chipFocusIndex: null,
      };

    case "EXECUTE_START":
      return { ...state, pendingExecuteReqId: action.reqId, executeStatus: "loading" };

    case "EXECUTE_SUCCESS":
      if (action.reqId !== state.pendingExecuteReqId) return state; // stale response, discard
      return {
        ...state,
        results: action.items,
        nextCursor: action.nextCursor,
        executeStatus: "success",
        highlightedIndex: 0,
      };

    case "EXECUTE_ERROR":
      if (action.reqId !== state.pendingExecuteReqId) return state;
      return { ...state, executeStatus: "error" };

    case "APPEND_RESULTS":
      return {
        ...state,
        results: [...state.results, ...action.items],
        nextCursor: action.nextCursor,
      };

    case "SET_HIGHLIGHT":
      return { ...state, highlightedIndex: action.index };

    case "REMOVE_CHIP": {
      const nextAst = removeField(state.ast, action.field);
      const nextTentative = { ...state.tentative };
      delete nextTentative[action.field];
      return {
        ...state,
        ast: nextAst,
        tentative: nextTentative,
        candidatePickerField: null,
        // If the input is empty, remove-via-chip is the user's only way to
        // edit — keep rawInput as-is (it may still hold recognized words
        // for OTHER chips); only the AST/tentative pair changes here.
      };
    }

    case "RESOLVE_CANDIDATE": {
      const nextAst = applyCandidate(state.ast, action.field, action.candidateId);
      const nextTentative = { ...state.tentative };
      delete nextTentative[action.field];
      return { ...state, ast: nextAst, tentative: nextTentative, candidatePickerField: null };
    }

    case "OPEN_CANDIDATE_PICKER":
      return state.tentative[action.field] ? { ...state, candidatePickerField: action.field } : state;

    case "CLOSE_CANDIDATE_PICKER":
      return { ...state, candidatePickerField: null };

    case "SET_CHIP_FOCUS":
      return { ...state, chipFocusIndex: action.index, candidatePickerField: null };

    case "RESET":
      return initialCommandBarState;

    default:
      return state;
  }
}

export { isAstEmpty };
