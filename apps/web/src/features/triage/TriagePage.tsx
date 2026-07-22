import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { IssueStatus, QueryResult, TriageSectionKey } from "@workflo/shared";
import { api } from "../../lib/api.js";
import { useAuthStore } from "../../store/auth.store.js";
import { useActiveWorkspaceStore } from "../../store/active-workspace.store.js";
import { useCommandBarDirectory } from "../command-bar/command-bar.queries.js";
import { deriveChips } from "../command-bar/chip-format.js";
import { ChipRail } from "../command-bar/ChipRail.js";
import { formatDueDate, PRIORITY_LABELS, STATUS_LABELS } from "../command-bar/results-format.js";
import { triageQueryKey, useDismissTriage, useMarkTriageSeen, useTriage } from "./triage.queries.js";

const STATUS_CLASS: Record<IssueStatus, string> = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  DONE: "done",
};

interface FlatRow {
  sectionKey: TriageSectionKey;
  item: QueryResult;
}

/**
 * `/triage` — Smart Triage (docs/design/nlq-search.md §2.7): "attention
 * without asking". Renders each non-empty section (canned AST sections show
 * an explanatory, non-editable chip rail so "why is this here" is
 * self-evident; NEEDS_REPLY has no AST, so it's description-only). Rows are
 * keyboard-navigable across the WHOLE flattened list (not per-section):
 * up/down move a highlight, Enter opens the issue, "d" dismisses it.
 */
export function TriagePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const workspaceId = useActiveWorkspaceStore((s) => s.workspaceId);

  const { data, isPending, isError, refetch } = useTriage(workspaceId);
  const { directory } = useCommandBarDirectory(workspaceId);
  const dismissTriage = useDismissTriage(workspaceId);
  const markSeen = useMarkTriageSeen(workspaceId);

  const assignToMe = useMutation({
    mutationFn: (issueKey: string) => api.patch(`/issues/${issueKey}`, { assigneeId: user?.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: triageQueryKey(workspaceId) });
    },
  });

  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const flatRows = useMemo<FlatRow[]>(() => {
    if (!data) return [];
    return data.sections.flatMap((section) => section.items.map((item) => ({ sectionKey: section.key, item })));
  }, [data]);

  // Fire markSeen exactly once per successful load — clears the rail's badge
  // without re-firing on every re-render/refetch.
  const markSeenFiredRef = useRef(false);
  useEffect(() => {
    if (data && workspaceId && !markSeenFiredRef.current) {
      markSeenFiredRef.current = true;
      markSeen.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, workspaceId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (flatRows.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < 0 ? 0 : (prev + 1) % flatRows.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < 0 ? 0 : (prev - 1 + flatRows.length) % flatRows.length));
      } else if (e.key === "Enter") {
        const row = flatRows[highlightedIndex];
        if (row) navigate(`/issues/${row.item.key}`);
      } else if (e.key.toLowerCase() === "d") {
        const row = flatRows[highlightedIndex];
        if (row) dismissTriage.mutate({ issueId: row.item.id, section: row.sectionKey });
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [flatRows, highlightedIndex, navigate, dismissTriage]);

  if (!workspaceId) {
    return (
      <main className="triage-page">
        <p className="board-status">
          Pick a workspace first. <Link to="/">Go home</Link>
        </p>
      </main>
    );
  }

  if (isPending) {
    return (
      <main className="triage-page">
        <h1 className="board-page__title">Triage</h1>
        <p className="board-status">Loading…</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="triage-page">
        <h1 className="board-page__title">Triage</h1>
        <p className="board-status board-status--error">
          Couldn&apos;t load triage.{" "}
          <button type="button" onClick={() => void refetch()}>
            Retry
          </button>
        </p>
      </main>
    );
  }

  const sections = data?.sections ?? [];

  return (
    <main className="triage-page">
      <h1 className="board-page__title">Triage</h1>

      {sections.length === 0 ? (
        <div className="triage-empty">
          <p className="triage-empty__title">Nothing needs your attention.</p>
          <p className="triage-empty__hint">Triage is meant to be empty — check back later.</p>
        </div>
      ) : (
        sections.map((section) => {
          const chips = section.ast ? deriveChips(section.ast, {}, directory) : [];
          return (
            <section className="triage-section" key={section.key}>
              <div className="triage-section__header">
                <h2 className="triage-section__title">{section.title}</h2>
                <p className="triage-section__description">{section.description}</p>
              </div>

              {section.ast ? (
                <ChipRail
                  chips={chips}
                  focusIndex={null}
                  candidatePickerField={null}
                  onFocusChange={() => {}}
                  onRemove={() => {}}
                  onOpenCandidates={() => {}}
                  onCloseCandidates={() => {}}
                  onResolveCandidate={() => {}}
                  interactive={false}
                />
              ) : null}

              <ul className="triage-row-list">
                {section.items.map((item) => {
                  const flatIndex = flatRows.findIndex((r) => r.sectionKey === section.key && r.item.id === item.id);
                  const isHighlighted = flatIndex === highlightedIndex;
                  const member = directory.members.find((m) => m.userId === item.assigneeId);
                  return (
                    <li
                      key={item.id}
                      className={`triage-row${isHighlighted ? " triage-row--active" : ""}`}
                      onMouseEnter={() => setHighlightedIndex(flatIndex)}
                    >
                      <button
                        type="button"
                        className="triage-row__main"
                        onClick={() => navigate(`/issues/${item.key}`)}
                      >
                        <span className="triage-row__key">{item.key}</span>
                        <span className="triage-row__title">{item.title}</span>
                        <span className={`backlog-status-chip backlog-status-chip--${STATUS_CLASS[item.status]}`}>
                          {STATUS_LABELS[item.status]}
                        </span>
                        <span className={`issue-card__priority issue-card__priority--${item.priority.toLowerCase()}`}>
                          {PRIORITY_LABELS[item.priority]}
                        </span>
                        <span className="triage-row__due">{formatDueDate(item.dueDate)}</span>
                        {member ? <span className="triage-row__assignee">{member.user.name}</span> : null}
                      </button>

                      <div className="triage-row__actions">
                        <button type="button" onClick={() => navigate(`/issues/${item.key}`)}>
                          Open
                        </button>
                        {section.key === "UNOWNED_URGENT" ? (
                          <button
                            type="button"
                            className="triage-row__assign"
                            disabled={assignToMe.isPending}
                            onClick={() => assignToMe.mutate(item.key)}
                          >
                            Assign to me
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="triage-row__dismiss"
                          disabled={dismissTriage.isPending}
                          onClick={() => dismissTriage.mutate({ issueId: item.id, section: section.key })}
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </main>
  );
}
