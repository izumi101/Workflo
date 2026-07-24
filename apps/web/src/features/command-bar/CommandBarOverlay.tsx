import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { formatRelativeTime } from "../../lib/relativeTime.js";
import { ChipRail } from "./ChipRail.js";
import { useCommandBar } from "./useCommandBar.js";
import { deriveChips } from "./chip-format.js";
import { encodeAstForUrl } from "./ast-url.js";
import { adaptiveColumnKind, formatDueDate, PRIORITY_LABELS, STATUS_LABELS } from "./results-format.js";
import type { Directory } from "./types.js";

export interface CommandBarOverlayProps {
  workspaceId: string;
  directory: Directory;
  onClose: () => void;
}

/**
 * The ⌘K overlay itself (§2.1/§2.2). Rendered only while open (mounted by
 * `CommandBarLauncher`), so its internal `useCommandBar` state resets
 * naturally on every open — matches GlobalSearch/NotificationBell's
 * close-clears-state convention rather than persisting a stale query across
 * opens.
 */
export function CommandBarOverlay({ workspaceId, directory, onClose }: CommandBarOverlayProps) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { state, dispatch, setRawInput, retry } = useCommandBar(workspaceId, directory);
  const chips = deriveChips(state.ast, state.tentative, directory);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Outside mousedown closes (mirrors GlobalSearch/NotificationBell).
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [onClose]);

  function openResult(index: number) {
    const result = state.results[index];
    if (!result) return;
    navigate(`/issues/${result.key}`);
    onClose();
  }

  function openAsView() {
    const q = encodeAstForUrl(state.ast);
    navigate(`/views/new?q=${q}&workspaceId=${workspaceId}`);
    onClose();
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        openAsView();
        return;
      }
      if (state.results.length === 0) return;
      openResult(state.highlightedIndex);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (state.results.length === 0) return;
      dispatch({ type: "SET_HIGHLIGHT", index: (state.highlightedIndex + 1) % state.results.length });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (state.results.length === 0) return;
      dispatch({
        type: "SET_HIGHLIGHT",
        index: (state.highlightedIndex - 1 + state.results.length) % state.results.length,
      });
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Backspace" && inputRef.current?.selectionStart === 0 && inputRef.current.selectionEnd === 0) {
      if (chips.length > 0) {
        e.preventDefault();
        dispatch({ type: "SET_CHIP_FOCUS", index: chips.length - 1 });
      }
    }
  }

  function handlePanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && state.candidatePickerField === null) {
      onClose();
    }
  }

  // Per §2.5: "no result-area spinner" — Lane A is fast enough (<150ms) that
  // the previous results (or nothing, on first keystroke) just sit quietly
  // until the new ones land; only the error and empty states get an
  // explicit status row.
  const showError = state.executeStatus === "error";
  const showEmpty =
    state.executeStatus === "success" &&
    state.results.length === 0 &&
    (chips.length > 0 || state.rawInput.trim().length > 0);
  const lastChipField = chips.length > 0 ? chips[chips.length - 1]!.field : null;

  return (
    <div className="cmdbar-overlay__backdrop" role="presentation">
      <div
        className="cmdbar-overlay__panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search or filter issues"
        onKeyDown={handlePanelKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          className="cmdbar-overlay__input"
          placeholder="Try “high priority bugs assigned to me”…"
          value={state.rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
          aria-label="Search or filter issues"
          aria-autocomplete="list"
          aria-controls="cmdbar-results"
          role="combobox"
          aria-expanded={state.results.length > 0}
        />

        <ChipRail
          chips={chips}
          focusIndex={state.chipFocusIndex}
          candidatePickerField={state.candidatePickerField}
          onFocusChange={(index) => {
            dispatch({ type: "SET_CHIP_FOCUS", index });
            if (index === null) inputRef.current?.focus();
          }}
          onRemove={(field) => dispatch({ type: "REMOVE_CHIP", field })}
          onOpenCandidates={(field) => dispatch({ type: "OPEN_CANDIDATE_PICKER", field })}
          onCloseCandidates={() => dispatch({ type: "CLOSE_CANDIDATE_PICKER" })}
          onResolveCandidate={(field, candidateId) => dispatch({ type: "RESOLVE_CANDIDATE", field, candidateId })}
        />

        <ul className="cmdbar-results" id="cmdbar-results" role="listbox">
          {showError ? (
            <li className="cmdbar-results__status">
              Something went wrong.{" "}
              <button type="button" className="cmdbar-results__action" onClick={retry}>
                Retry
              </button>
            </li>
          ) : showEmpty ? (
            <li className="cmdbar-results__status">
              <span>No issues match</span>
              <span className="cmdbar-results__actions">
                {lastChipField ? (
                  <button
                    type="button"
                    className="cmdbar-results__action"
                    onClick={() => dispatch({ type: "REMOVE_CHIP", field: lastChipField })}
                  >
                    Remove last filter
                  </button>
                ) : null}
                {state.ast.text && chips.length > 1 ? (
                  <button
                    type="button"
                    className="cmdbar-results__action"
                    onClick={() => {
                      for (const chip of chips) {
                        if (chip.field !== "text") dispatch({ type: "REMOVE_CHIP", field: chip.field });
                      }
                    }}
                  >
                    Search everywhere for &ldquo;{state.ast.text}&rdquo;
                  </button>
                ) : null}
              </span>
            </li>
          ) : (
            state.results.map((result, index) => {
              const kind = adaptiveColumnKind(state.ast);
              let contextValue = "—";
              if (kind === "due") {
                contextValue = formatDueDate(result.dueDate);
              } else if (kind === "assignee") {
                const member = directory.members.find((m) => m.userId === result.assigneeId);
                contextValue = member ? member.user.name : "Unassigned";
              } else {
                contextValue = formatRelativeTime(result.updatedAt);
              }

              return (
                <li key={result.id} role="option" aria-selected={index === state.highlightedIndex}>
                  <button
                    type="button"
                    className={
                      index === state.highlightedIndex
                        ? "cmdbar-result cmdbar-result--active"
                        : "cmdbar-result"
                    }
                    onMouseEnter={() => dispatch({ type: "SET_HIGHLIGHT", index })}
                    onClick={() => openResult(index)}
                  >
                    <span className="cmdbar-result__key">{result.key}</span>
                    <span className="cmdbar-result__title">{result.title}</span>
                    <span
                      className={`backlog-status-chip backlog-status-chip--${result.status.toLowerCase()}`}
                    >
                      {STATUS_LABELS[result.status]}
                    </span>
                    <span className={`issue-card__priority issue-card__priority--${result.priority.toLowerCase()}`}>
                      {PRIORITY_LABELS[result.priority]}
                    </span>
                    <span className="cmdbar-result__context">{contextValue}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="cmdbar-overlay__footer">
          <span>↑↓ navigate · Enter open · ⌘Enter view all · Esc close</span>
        </div>
      </div>
    </div>
  );
}
