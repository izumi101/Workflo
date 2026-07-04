import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { IssueStatus, Priority } from "@workflo/shared";
import { useActiveWorkspaceStore } from "../../store/active-workspace.store.js";
import { useGlobalSearch } from "./search.queries.js";

const SEARCH_DEBOUNCE_MS = 250;

const STATUS_LABELS: Record<IssueStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

/**
 * Global search box, rendered in TopBar only while an active workspace is
 * known (see useActiveWorkspaceStore). Debounces input ~250ms before firing
 * GET /search, shows a results dropdown, and supports full keyboard
 * navigation (↑/↓ to highlight, Enter to open, Escape to close) — this is
 * part of the "keyboard-first" product pitch, not a nice-to-have.
 */
export function GlobalSearch() {
  const workspaceId = useActiveWorkspaceStore((s) => s.workspaceId);
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(input);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  const trimmedQuery = debouncedQuery.trim();
  const { data, isFetching } = useGlobalSearch(workspaceId, trimmedQuery);
  const items = data?.items ?? [];

  // Reset the highlight whenever the result set changes so it never points
  // past the end of a shorter new list.
  useEffect(() => {
    setHighlightedIndex(0);
  }, [items.length, trimmedQuery]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  if (!workspaceId) {
    return null;
  }

  function closeAndClear() {
    setIsOpen(false);
    setInput("");
    setDebouncedQuery("");
    setHighlightedIndex(0);
  }

  function openResult(index: number) {
    const result = items[index];
    if (!result) return;
    navigate(`/issues/${result.key}`);
    closeAndClear();
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length === 0) return;
      setIsOpen(true);
      setHighlightedIndex((prev) => (prev + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      setIsOpen(true);
      setHighlightedIndex((prev) => (prev - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items.length === 0) return;
      openResult(highlightedIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (input.length > 0 || isOpen) {
        closeAndClear();
      }
      inputRef.current?.blur();
    }
  }

  const showDropdown = isOpen && trimmedQuery.length > 0;
  const showEmpty = showDropdown && !isFetching && items.length === 0;

  return (
    <div className="global-search" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="global-search__input"
        placeholder="Search issues…"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          if (trimmedQuery.length > 0) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        aria-label="Search issues"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        role="combobox"
      />

      {showDropdown ? (
        <ul className="global-search__dropdown" role="listbox">
          {isFetching && items.length === 0 ? (
            <li className="global-search__status">Searching…</li>
          ) : showEmpty ? (
            <li className="global-search__status">No results</li>
          ) : (
            items.map((result, index) => (
              <li key={result.id} role="option" aria-selected={index === highlightedIndex}>
                <button
                  type="button"
                  className={
                    index === highlightedIndex
                      ? "global-search__result global-search__result--active"
                      : "global-search__result"
                  }
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => openResult(index)}
                >
                  <span className="global-search__result-key">{result.key}</span>
                  <span className="global-search__result-title">{result.title}</span>
                  <span
                    className={`global-search__result-status global-search__result-status--${result.status.toLowerCase()}`}
                  >
                    {STATUS_LABELS[result.status]}
                  </span>
                  <span
                    className={`global-search__result-priority global-search__result-priority--${result.priority.toLowerCase()}`}
                  >
                    {PRIORITY_LABELS[result.priority]}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
