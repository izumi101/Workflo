import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Issue, IssueStatus, Project, WorkspaceMember } from "@workflo/shared";
import { api } from "../../lib/api.js";
import { useActiveWorkspaceStore } from "../../store/active-workspace.store.js";
import { ViewToggle } from "../../components/ViewToggle.js";
import { useProjectIssuesFiltered, useProjectLabels } from "./backlog.queries.js";
import type { BacklogFilters } from "./backlog.queries.js";
import { useBacklogRealtime } from "./useBacklogRealtime.js";

const STATUS_LABELS: Record<IssueStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

const STATUSES: IssueStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

const SEARCH_DEBOUNCE_MS = 300;

function useProjectById(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
  });
}

function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["members", workspaceId ?? ""],
    queryFn: () => api.get<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId),
  });
}

function formatDueDate(dueDate: Issue["dueDate"]): string {
  if (!dueDate) return "—";
  const date = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function BacklogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) {
    return <p className="board-status board-status--error">Missing project id.</p>;
  }
  return <BacklogPageInner projectId={projectId} />;
}

function BacklogPageInner({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: project } = useProjectById(projectId);
  const projectKey = project?.key ?? "";
  const { data: members } = useWorkspaceMembers(project?.workspaceId);
  const { data: labels } = useProjectLabels(projectId);

  const setActiveWorkspace = useActiveWorkspaceStore((s) => s.setActiveWorkspace);
  useEffect(() => {
    if (project) {
      setActiveWorkspace({ workspaceId: project.workspaceId, name: projectKey });
    }
  }, [project, projectKey, setActiveWorkspace]);

  // Filter state lives in the URL so a filtered view is shareable/bookmarkable.
  const status = (searchParams.get("status") as IssueStatus | null) ?? "";
  const assigneeId = searchParams.get("assigneeId") ?? "";
  const labelId = searchParams.get("labelId") ?? "";
  const qParam = searchParams.get("q") ?? "";

  // The search input is debounced locally before it's pushed into the URL
  // (and therefore into the API call) so we don't fire a request per keystroke.
  const [qInput, setQInput] = useState(qParam);
  useEffect(() => {
    setQInput(qParam);
  }, [qParam]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (qInput === qParam) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (qInput.trim()) {
            next.set("q", qInput.trim());
          } else {
            next.delete("q");
          }
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  function updateFilter(key: "status" | "assigneeId" | "labelId", value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== "all") {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function clearFilters() {
    setQInput("");
    setSearchParams({});
  }

  const filters: BacklogFilters = useMemo(
    () => ({
      status: status ? (status as IssueStatus) : undefined,
      assigneeId: assigneeId || undefined,
      labelId: labelId || undefined,
      q: qParam || undefined,
    }),
    [status, assigneeId, labelId, qParam],
  );

  const { data, isPending, isError, isFetching, loadMore } = useProjectIssuesFiltered(projectId, filters);

  useBacklogRealtime(projectId);

  const memberList = members ?? [];
  const labelList = labels ?? [];
  const memberById = useMemo(() => new Map(memberList.map((m) => [m.userId, m.user.name])), [memberList]);
  const labelById = useMemo(() => new Map(labelList.map((l) => [l.id, l])), [labelList]);

  const items = data?.items ?? [];

  const hasActiveFilters = Boolean(status || assigneeId || labelId || qParam);

  if (isPending) {
    return <p className="board-status">Loading backlog…</p>;
  }
  if (isError) {
    return <p className="board-status board-status--error">Failed to load issues.</p>;
  }

  return (
    <main className="backlog-page">
      <div className="backlog-page__header">
        <h1 className="board-page__title">{projectKey || "Backlog"}</h1>
        <ViewToggle projectId={projectId} active="backlog" />
      </div>

      <div className="backlog-toolbar">
        <label className="backlog-toolbar__field">
          <span>Status</span>
          <select value={status || "all"} onChange={(e) => updateFilter("status", e.target.value)}>
            <option value="all">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="backlog-toolbar__field">
          <span>Assignee</span>
          <select value={assigneeId || "all"} onChange={(e) => updateFilter("assigneeId", e.target.value)}>
            <option value="all">All</option>
            {memberList.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </select>
        </label>

        <label className="backlog-toolbar__field">
          <span>Label</span>
          <select value={labelId || "all"} onChange={(e) => updateFilter("labelId", e.target.value)}>
            <option value="all">All</option>
            {labelList.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="backlog-toolbar__field backlog-toolbar__field--search">
          <span>Search</span>
          <input
            type="text"
            placeholder="Search title/description…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </label>

        {hasActiveFilters ? (
          <button type="button" className="backlog-toolbar__clear" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="backlog-page__meta">
        <span className="backlog-page__count">
          {items.length} issue{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="board-status">No issues match these filters.</p>
      ) : (
        <table className="backlog-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
              <th>Labels</th>
              <th>Due date</th>
            </tr>
          </thead>
          <tbody>
            {items.map((issue) => (
              <tr
                key={issue.id}
                className="backlog-table__row"
                onClick={() => navigate(`/issues/${projectKey}-${issue.number}`)}
              >
                <td className="backlog-table__key">{`${projectKey}-${issue.number}`}</td>
                <td className="backlog-table__title">{issue.title}</td>
                <td>
                  <span className={`backlog-status-chip backlog-status-chip--${issue.status.toLowerCase()}`}>
                    {STATUS_LABELS[issue.status]}
                  </span>
                </td>
                <td>
                  <span className={`issue-card__priority issue-card__priority--${issue.priority.toLowerCase()}`}>
                    {issue.priority}
                  </span>
                </td>
                <td>{issue.assigneeId ? (memberById.get(issue.assigneeId) ?? "—") : "—"}</td>
                <td>
                  {issue.labelIds.length === 0 ? (
                    "—"
                  ) : (
                    <span className="backlog-labels">
                      {issue.labelIds.map((id) => {
                        const label = labelById.get(id);
                        if (!label) return null;
                        return (
                          <span
                            key={id}
                            className="label-chip"
                            style={{ borderColor: label.color, color: label.color }}
                          >
                            {label.name}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </td>
                <td>{formatDueDate(issue.dueDate)}</td>
              </tr>
            ))}
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
