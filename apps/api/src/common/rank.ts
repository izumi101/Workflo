/**
 * Minimal lexicographic rank helper for issue ordering within a status
 * column (docs/architecture.md §3 "Board ordering"). This is intentionally
 * simple — just enough to append new issues after existing ones so lists
 * sort correctly. Full LexoRank-style midpoint insertion for drag & drop
 * reordering is a LATER step (see CLAUDE.md §8 "Next up").
 *
 * Ranks are plain strings over the alphabet [a-z], compared with normal
 * string comparison (`<`). `nextRank(previous)` returns a string that sorts
 * strictly after `previous` (or after nothing, i.e. first-in-column, when
 * `previous` is undefined).
 */
const MID = "m"; // roughly the middle of the alphabet — used as the first rank

/** Returns a rank string that sorts strictly after `previous`. */
export function nextRank(previous?: string | null): string {
  if (!previous) {
    return MID;
  }
  // Append a middling character — guarantees previous < previous + anything,
  // since a non-empty string is always greater than its own prefix under
  // standard lexicographic (string) comparison.
  return `${previous}${MID}`;
}
