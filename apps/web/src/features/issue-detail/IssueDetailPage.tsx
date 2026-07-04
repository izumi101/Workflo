import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { IssueStatus, Priority } from "@workflo/shared";
import { CommentsSection } from "./CommentsSection.js";
import { useIssue, useProject, useUpdateIssue, useWorkspaceMembers } from "./issue-detail.queries.js";
import { useIssueDetailRealtime } from "./useIssueDetailRealtime.js";
import { useActiveWorkspaceStore } from "../../store/active-workspace.store.js";

const STATUS_LABELS: Record<IssueStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUSES: IssueStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

export function IssueDetailPage() {
  const { key } = useParams<{ key: string }>();
  if (!key) {
    return <p className="board-status board-status--error">Missing issue key.</p>;
  }
  return <IssueDetailPageInner issueKey={key} />;
}

function IssueDetailPageInner({ issueKey }: { issueKey: string }) {
  const { data: issue, isPending, isError } = useIssue(issueKey);
  const { data: project } = useProject(issue?.projectId);
  const { data: members } = useWorkspaceMembers(project?.workspaceId);
  const updateIssue = useUpdateIssue(issueKey);

  useIssueDetailRealtime(issue?.projectId, issueKey);

  const setActiveWorkspace = useActiveWorkspaceStore((s) => s.setActiveWorkspace);
  useEffect(() => {
    if (project) {
      setActiveWorkspace({ workspaceId: project.workspaceId, name: project.key });
    }
  }, [project, setActiveWorkspace]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (issue) {
      setTitle(issue.title);
      setDescription(issue.description ?? "");
    }
  }, [issue?.id, issue?.title, issue?.description]);

  if (isPending) {
    return <p className="board-status">Loading issue…</p>;
  }
  if (isError || !issue) {
    return <p className="board-status board-status--error">Failed to load issue.</p>;
  }

  const boardHref = `/projects/${issue.projectId}/board`;

  function saveTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === issue!.title) {
      setTitle(issue!.title);
      return;
    }
    updateIssue.mutate({ title: trimmed });
  }

  function saveDescription(e: FormEvent) {
    e.preventDefault();
    const trimmed = description.trim();
    if (trimmed === (issue!.description ?? "")) return;
    updateIssue.mutate({ description: trimmed.length > 0 ? trimmed : null });
  }

  function handleStatusChange(status: IssueStatus) {
    updateIssue.mutate({ status });
  }

  function handlePriorityChange(priority: Priority) {
    updateIssue.mutate({ priority });
  }

  function handleAssigneeChange(assigneeId: string) {
    updateIssue.mutate({ assigneeId: assigneeId === "" ? null : assigneeId });
  }

  const memberList = members ?? [];

  return (
    <main className="issue-detail-page">
      <div className="issue-detail-page__header">
        <Link to={boardHref} className="issue-detail-page__back">
          ← Back to board
        </Link>
        <span className="issue-detail-page__key">
          {project?.key ? `${project.key}-${issue.number}` : issue.id}
        </span>
      </div>

      <input
        className="issue-detail-page__title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Issue title"
      />

      <div className="issue-detail-page__fields">
        <label className="issue-detail-page__field">
          <span>Status</span>
          <select
            value={issue.status}
            onChange={(e) => handleStatusChange(e.target.value as IssueStatus)}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="issue-detail-page__field">
          <span>Priority</span>
          <select
            value={issue.priority}
            onChange={(e) => handlePriorityChange(e.target.value as Priority)}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>

        <label className="issue-detail-page__field">
          <span>Assignee</span>
          <select value={issue.assigneeId ?? ""} onChange={(e) => handleAssigneeChange(e.target.value)}>
            <option value="">Unassigned</option>
            {memberList.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form className="issue-detail-page__description" onSubmit={saveDescription}>
        <label htmlFor="issue-description">Description</label>
        <textarea
          id="issue-description"
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a description…"
        />
        <button type="submit" disabled={updateIssue.isPending}>
          Save description
        </button>
      </form>

      <CommentsSection issueKey={issueKey} members={memberList} />
    </main>
  );
}
