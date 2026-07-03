import { type FormEvent, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Issue, IssueStatus } from "@workflo/shared";
import { IssueCard } from "./IssueCard.js";

const STATUS_LABELS: Record<IssueStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

export function Column({
  status,
  issues,
  projectKey,
  assigneeInitials,
  showCreateForm,
  onCreateIssue,
  creating,
}: {
  status: IssueStatus;
  issues: Issue[];
  projectKey: string;
  assigneeInitials: Record<string, string>;
  showCreateForm?: boolean;
  onCreateIssue?: (title: string) => void;
  creating?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [title, setTitle] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !onCreateIssue) return;
    onCreateIssue(trimmed);
    setTitle("");
  }

  return (
    <div className={isOver ? "board-column board-column--over" : "board-column"}>
      <div className="board-column__header">
        <h3>{STATUS_LABELS[status]}</h3>
        <span className="board-column__count">{issues.length}</span>
      </div>

      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="board-column__body">
          {issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              projectKey={projectKey}
              assigneeInitial={issue.assigneeId ? assigneeInitials[issue.assigneeId] : null}
            />
          ))}
          {issues.length === 0 ? <div className="board-column__empty">No issues</div> : null}
        </div>
      </SortableContext>

      {showCreateForm ? (
        <form className="board-column__create" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="New issue title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={creating}
          />
          <button type="submit" disabled={creating || !title.trim()}>
            Add
          </button>
        </form>
      ) : null}
    </div>
  );
}
