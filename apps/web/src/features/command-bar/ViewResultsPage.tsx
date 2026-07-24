import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { IssueStatus, ViewScope } from "@workflo/shared";
import { useActiveWorkspaceStore } from "../../store/active-workspace.store.js";
import { useCreateView } from "../views/view.queries.js";
import { useCommandBarDirectory } from "./command-bar.queries.js";
import { useQueryExecutePaged } from "./view-results.queries.js";
import { decodeAstFromUrl } from "./ast-url.js";
import { deriveChips, removeField } from "./chip-format.js";
import { ChipRail } from "./ChipRail.js";
import { formatDueDate, PRIORITY_LABELS, STATUS_LABELS } from "./results-format.js";
import type { FieldKey } from "./types.js";

const STATUS_CLASS: Record<IssueStatus, string> = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  DONE: "done",
};

/**
 * `/views/new?q=<url-encoded AST JSON>&workspaceId=<id>` — the full results
 * page reached via ⌘Enter (§2.5, "generalized BacklogPage": chip rail + full
 * columns + cursor Load more). `workspaceId` travels alongside `q` in the
 * URL rather than inside the AST itself — the AST deliberately carries no
 * workspace field (see packages/shared/src/query.ts's header comment; the
 * 2026-07-04 issue-key-collision lesson), so whatever links here must supply
 * scope out-of-band the same way `POST /query/execute` requires it.
 *
 * Saving this as a named View (⌘S or the "Save view" button) prompts for a
 * name + scope inline and stores {name, ast, scope} via POST /views — the
 * left rail (features/views/ViewRail.tsx) is where it shows up afterward.
 * This page is otherwise read/refine-only: the chip rail is the SAME
 * interactive component the command bar uses (so "×"/Backspace-remove still
 * re-executes), but there's no free-text input to add further filters and
 * no candidate-picker (tentative ids were already resolved before the AST
 * was serialized into the URL — by the time you're here, the AST IS the
 * source of truth per §0, so a re-guessed "top candidate" is simply shown
 * as a firm chip; removing it is still one click away).
 */
export function ViewResultsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setActiveWorkspace = useActiveWorkspaceStore((s) => s.setActiveWorkspace);

  const workspaceId = searchParams.get("workspaceId");
  const initialAst = useMemo(() => decodeAstFromUrl(searchParams.get("q")), [searchParams]);
  const [ast, setAst] = useState(initialAst);

  useEffect(() => {
    setAst(initialAst);
  }, [initialAst]);

  useEffect(() => {
    if (workspaceId) {
      setActiveWorkspace({ workspaceId, name: "View" });
    }
  }, [workspaceId, setActiveWorkspace]);

  const { directory } = useCommandBarDirectory(workspaceId);
  const chips = deriveChips(ast, {}, directory);

  const { data, isPending, isError, isFetching, loadMore } = useQueryExecutePaged(workspaceId, ast);
  const items = data?.items ?? [];

  const createView = useCreateView();
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveScope, setSaveScope] = useState<ViewScope>("PERSONAL");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSaveForm) {
      nameInputRef.current?.focus();
    }
  }, [showSaveForm]);

  // ⌘S / Ctrl+S anywhere on this page opens the save-view form, overriding the browser's save-page dialog.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setShowSaveForm(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const canSave = saveName.trim().length > 0 && chips.length > 0;

  async function handleSaveView(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || !canSave) return;
    try {
      await createView.mutateAsync({ workspaceId, name: saveName.trim(), ast, scope: saveScope, pinned: false });
      setShowSaveForm(false);
      setSaveName("");
      setSaveScope("PERSONAL");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
    }
  }

  if (!workspaceId) {
    return <p className="board-status board-status--error">Missing workspace context.</p>;
  }

  function handleRemove(field: FieldKey) {
    setAst((prev) => removeField(prev, field));
  }

  return (
    <main className="backlog-page">
      <div className="backlog-page__header">
        <h1 className="board-page__title">Results</h1>
        <button type="button" className="view-save__trigger" onClick={() => setShowSaveForm((v) => !v)}>
          Save view
        </button>
        {saveStatus === "saved" ? <span className="view-save__confirm">Saved</span> : null}
      </div>

      {showSaveForm ? (
        <form className="view-save-form" onSubmit={handleSaveView}>
          <input
            ref={nameInputRef}
            type="text"
            className="view-save-form__name"
            placeholder="View name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            required
          />
          <select
            className="view-save-form__scope"
            value={saveScope}
            onChange={(e) => setSaveScope(e.target.value as ViewScope)}
          >
            <option value="PERSONAL">Personal</option>
            <option value="WORKSPACE">Workspace</option>
          </select>
          <button type="submit" disabled={!canSave || createView.isPending}>
            Save
          </button>
          <button type="button" onClick={() => setShowSaveForm(false)}>
            Cancel
          </button>
          {saveStatus === "error" ? <span className="form-error">Could not save view.</span> : null}
        </form>
      ) : null}

      <ChipRail
        chips={chips}
        focusIndex={null}
        candidatePickerField={null}
        onFocusChange={() => {}}
        onRemove={handleRemove}
        onOpenCandidates={() => {}}
        onCloseCandidates={() => {}}
        onResolveCandidate={() => {}}
      />

      {chips.length === 0 ? <p className="board-status">No filters — showing nothing. Start from ⌘K.</p> : null}

      <div className="backlog-page__meta">
        <span className="backlog-page__count">
          {items.length} issue{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {isPending ? (
        <p className="board-status">Loading…</p>
      ) : isError ? (
        <p className="board-status board-status--error">Failed to load results.</p>
      ) : items.length === 0 ? (
        <p className="board-status">No issues match these filters.</p>
      ) : (
        <table className="backlog-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
              <th>Labels</th>
              <th>Due date</th>
            </tr>
          </thead>
          <tbody>
            {items.map((issue) => {
              const member = directory.members.find((m) => m.userId === issue.assigneeId);
              return (
                <tr key={issue.id} className="backlog-table__row" onClick={() => navigate(`/issues/${issue.key}`)}>
                  <td className="backlog-table__key">{issue.key}</td>
                  <td className="backlog-table__title">{issue.title}</td>
                  <td>{issue.type}</td>
                  <td>
                    <span className={`backlog-status-chip backlog-status-chip--${STATUS_CLASS[issue.status]}`}>
                      {STATUS_LABELS[issue.status]}
                    </span>
                  </td>
                  <td>
                    <span className={`issue-card__priority issue-card__priority--${issue.priority.toLowerCase()}`}>
                      {PRIORITY_LABELS[issue.priority]}
                    </span>
                  </td>
                  <td>{member ? member.user.name : "—"}</td>
                  <td>
                    {issue.labelIds.length === 0 ? (
                      "—"
                    ) : (
                      <span className="backlog-labels">
                        {issue.labelIds.map((id) => {
                          const label = directory.labels.find((l) => l.id === id);
                          if (!label) return null;
                          return (
                            <span key={id} className="label-chip" style={{ borderColor: label.color, color: label.color }}>
                              {label.name}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </td>
                  <td>{formatDueDate(issue.dueDate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {data?.nextCursor ? (
        <button type="button" className="backlog-page__load-more" onClick={() => void loadMore()} disabled={isFetching}>
          {isFetching ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </main>
  );
}
