import { generateKeyBetween } from "fractional-indexing";

/**
 * Shared fractional-indexing wrapper so the frontend board (drag & drop) and
 * the backend (server-authoritative move endpoint) compute ranks the exact
 * same way — no drift between optimistic client ordering and what the server
 * persists (docs/architecture.md §3 "Board ordering").
 *
 * `rankBetween(before, after)` returns a rank string that sorts strictly
 * between `before` and `after` under plain string comparison (`<`). Pass
 * `null` for an open end:
 *  - `rankBetween(null, null)` — first key ever (empty column).
 *  - `rankBetween(x, null)` — append after `x` (end of column).
 *  - `rankBetween(null, x)` — prepend before `x` (start of column).
 *  - `rankBetween(a, b)` — insert strictly between two existing ranks.
 *
 * `fractional-indexing`'s `generateKeyBetween(a, b)` takes the "lower, upper"
 * bound in that same before/after order and guarantees a result that is
 * never equal to either neighbor (it throws if `a >= b`, which callers
 * should treat as a 400 — see IssuesService.move for the same-status
 * neighbor validation that keeps this precondition true).
 *
 * NOTE (rebalance hook): fractional-indexing keys can grow in length with
 * many repeated insertions at the same boundary (e.g. always inserting
 * between the same two neighbors). We don't rebalance yet (MVP-light, see
 * CLAUDE.md §8 "board rank foundation") — a future background job would
 * re-derive short, evenly-spaced ranks for a status column here, keyed off
 * `[projectId, status]`, without changing this function's contract.
 */
export function rankBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}
