import { useEffect, useReducer, useRef, useState } from "react";
import { parseQueryDeterministic, type QueryExecuteResponse } from "@workflo/shared";
import { api } from "../../lib/api.js";
import { resolveEntities } from "./entity-resolution.js";
import { commandBarReducer, initialCommandBarState, isAstEmpty, EMPTY_AST } from "./command-bar.reducer.js";
import type { Directory } from "./types.js";

const DEBOUNCE_MS = 250;
const BAR_RESULTS_LIMIT = 8;

/**
 * Lane A end-to-end (docs/design/nlq-search.md §2.2), zero LLM:
 *
 *  1. Every keystroke updates `rawInput` immediately (so the input never
 *     feels laggy) but is debounced ~250ms before anything downstream runs.
 *  2. The debounced text is run through the pure, synchronous
 *     `parseQueryDeterministic` + `resolveEntities` (client-side, zero
 *     network — the directory is already loaded) to produce a concrete AST.
 *  3. Whenever the AST changes, `POST /query/execute` runs with a fresh
 *     request id; a response is only applied if it's still the latest
 *     (`commandBarReducer`'s `EXECUTE_SUCCESS`/`EXECUTE_ERROR` discard stale
 *     ids) — this is the race guard called out in the brief, and it also
 *     naturally covers "clear the input while a request is in flight".
 *
 * `limit` is fixed at 8 (the bar's "top 8" per §2.5); the full `/views/new`
 * results page uses its own cursor-paginated hook, not this one.
 */
export function useCommandBar(workspaceId: string | null, directory: Directory) {
  const [state, dispatch] = useReducer(commandBarReducer, initialCommandBarState);
  const reqIdRef = useRef(0);
  const [retryNonce, setRetryNonce] = useState(0);

  const [debouncedInput, setDebouncedInput] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedInput(state.rawInput), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [state.rawInput]);

  // Parse + resolve (pure, synchronous) whenever the debounced text or the
  // directory changes (e.g. the member/project/label lists finish loading
  // after the bar was already opened and typed into).
  useEffect(() => {
    const trimmed = debouncedInput.trim();
    if (!trimmed) {
      dispatch({ type: "PARSED", ast: EMPTY_AST, tentative: {} });
      return;
    }
    const parsed = parseQueryDeterministic(trimmed);
    const { ast, tentative } = resolveEntities(parsed, directory);
    dispatch({ type: "PARSED", ast, tentative });
    // directory identity changes each render (new arrays from useMemo deps),
    // so depend on its constituent lists' lengths/ids-ish signal instead —
    // simplest correct dependency is the debounced text plus the directory
    // object itself, which only changes reference when its inputs change
    // (see useCommandBarDirectory's useMemo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedInput, directory]);

  // Execute whenever the resolved AST changes. Always goes through the same
  // EXECUTE_START/EXECUTE_SUCCESS path (even for an empty AST) so the reqId
  // counter uniformly invalidates any still-in-flight older request.
  const astKey = JSON.stringify(state.ast);
  useEffect(() => {
    if (!workspaceId) return;
    const reqId = ++reqIdRef.current;
    dispatch({ type: "EXECUTE_START", reqId });

    if (isAstEmpty(state.ast)) {
      dispatch({ type: "EXECUTE_SUCCESS", reqId, items: [], nextCursor: null });
      return;
    }

    const tz = -new Date().getTimezoneOffset();
    let cancelled = false;
    api
      .post<QueryExecuteResponse>("/query/execute", {
        workspaceId,
        ast: state.ast,
        limit: BAR_RESULTS_LIMIT,
        tz,
      })
      .then((res) => {
        if (cancelled) return;
        dispatch({ type: "EXECUTE_SUCCESS", reqId, items: res.items, nextCursor: res.nextCursor });
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "EXECUTE_ERROR", reqId });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [astKey, workspaceId, retryNonce]);

  function setRawInput(input: string) {
    dispatch({ type: "SET_RAW_INPUT", input });
  }

  /** Re-runs execute against the current AST unchanged (§2.5 "execute error -> Retry"). */
  function retry() {
    setRetryNonce((n) => n + 1);
  }

  return { state, dispatch, setRawInput, retry };
}
