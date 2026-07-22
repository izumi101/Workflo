import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { View } from "@workflo/shared";
import { useProjects } from "../../lib/queries.js";
import { encodeAstForUrl } from "../command-bar/ast-url.js";
import { useTriage } from "../triage/triage.queries.js";
import { useDeleteView, useUpdateView, useViews } from "./view.queries.js";

const RAIL_COLLAPSED_KEY = "workflo:rail-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // localStorage unavailable (e.g. private browsing) — collapse state just won't persist.
  }
}

export interface ViewRailProps {
  workspaceId: string | null;
}

/**
 * The slim left rail (§2.6, ~220px): Triage (placeholder) · Views (pinned
 * then recent) · Projects. Rendered on Home; a collapse toggle persists to
 * localStorage so it stays out of the way once a user has their bearings.
 */
export function ViewRail({ workspaceId }: ViewRailProps) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const { data: views, isPending: viewsPending } = useViews(workspaceId);
  const { data: projects, isPending: projectsPending } = useProjects(workspaceId);
  const { data: triage } = useTriage(workspaceId);
  const updateView = useUpdateView(workspaceId);
  const deleteView = useDeleteView(workspaceId);

  const triageBadge = triage?.badge ?? 0;

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }

  function openView(view: View) {
    if (!workspaceId) return;
    navigate(`/views/new?q=${encodeAstForUrl(view.ast)}&workspaceId=${workspaceId}`);
  }

  return (
    <nav className={`view-rail${collapsed ? " view-rail--collapsed" : ""}`} aria-label="Views and projects">
      <div className="view-rail__header">
        {!collapsed ? <span className="view-rail__brand">Browse</span> : null}
        <button
          type="button"
          className="view-rail__collapse-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <div className="view-rail__section">
        {!collapsed ? <div className="view-rail__section-title">Triage</div> : null}
        <button
          type="button"
          className="view-rail__item view-rail__item--triage"
          onClick={() => navigate("/triage")}
        >
          {!collapsed ? "Triage" : "T"}
          {triageBadge > 0 ? <span className="notif-bell__badge">{triageBadge > 9 ? "9+" : triageBadge}</span> : null}
        </button>
      </div>

      <div className="view-rail__section">
        {!collapsed ? <div className="view-rail__section-title">Views</div> : null}
        {!collapsed && viewsPending ? <p className="view-rail__status">Loading…</p> : null}
        {!collapsed && !viewsPending && (views?.length ?? 0) === 0 ? (
          <p className="view-rail__status">No views yet.</p>
        ) : null}
        {!collapsed ? (
          <ul className="view-rail__list">
            {views?.map((view) => (
              <li key={view.id} className="view-rail__row">
                <button type="button" className="view-rail__link" onClick={() => openView(view)}>
                  {view.name}
                </button>
                <button
                  type="button"
                  className={`view-rail__pin${view.pinned ? " view-rail__pin--active" : ""}`}
                  aria-label={view.pinned ? "Unpin view" : "Pin view"}
                  onClick={() => updateView.mutate({ id: view.id, pinned: !view.pinned })}
                >
                  ★
                </button>
                <button
                  type="button"
                  className="view-rail__delete"
                  aria-label="Delete view"
                  onClick={() => deleteView.mutate(view.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="view-rail__section">
        {!collapsed ? <div className="view-rail__section-title">Projects</div> : null}
        {!collapsed && projectsPending ? <p className="view-rail__status">Loading…</p> : null}
        {!collapsed && !projectsPending && (projects?.length ?? 0) === 0 ? (
          <p className="view-rail__status">No projects yet.</p>
        ) : null}
        {!collapsed ? (
          <ul className="view-rail__list">
            {projects?.map((project) => (
              <li key={project.id} className="view-rail__row">
                <button
                  type="button"
                  className="view-rail__link"
                  onClick={() => navigate(`/projects/${project.id}/board`)}
                >
                  {project.key} — {project.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </nav>
  );
}
