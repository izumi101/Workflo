import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateProject, useCreateWorkspace, useProjects, useWorkspaces } from "../lib/queries.js";
import { isApiError } from "../lib/api.js";
import { useActiveWorkspaceStore } from "../store/active-workspace.store.js";
import { ViewRail } from "../features/views/ViewRail.js";

/**
 * Home: a slim left rail (Triage placeholder / Views / Projects, §2.6) plus
 * a compact right pane for workspace switching + onboarding (create a
 * workspace/project). Picking a workspace also sets the active-workspace
 * store so the ⌘K command bar works from Home too, same as the board/
 * backlog/issue-detail pages already do.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { data: workspaces, isPending: workspacesPending } = useWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setActiveWorkspace = useActiveWorkspaceStore((s) => s.setActiveWorkspace);

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces && workspaces.length > 0 && workspaces[0]) {
      setSelectedWorkspaceId(workspaces[0].id);
    }
  }, [workspaces, selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId || !workspaces) return;
    const selected = workspaces.find((ws) => ws.id === selectedWorkspaceId);
    if (selected) {
      setActiveWorkspace({ workspaceId: selected.id, name: selected.name });
    }
  }, [selectedWorkspaceId, workspaces, setActiveWorkspace]);

  const { data: projects, isPending: projectsPending } = useProjects(selectedWorkspaceId);
  const createProject = useCreateProject();
  const [projectName, setProjectName] = useState("");
  const [projectKey, setProjectKey] = useState("");

  async function handleCreateWorkspace(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const ws = await createWorkspace.mutateAsync({ name: workspaceName });
      setWorkspaceName("");
      setSelectedWorkspaceId(ws.id);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not create workspace");
    }
  }

  async function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedWorkspaceId) return;
    try {
      const project = await createProject.mutateAsync({
        workspaceId: selectedWorkspaceId,
        name: projectName,
        key: projectKey.toUpperCase(),
      });
      setProjectName("");
      setProjectKey("");
      navigate(`/projects/${project.id}/board`);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not create project");
    }
  }

  if (workspacesPending) {
    return (
      <main className="home-layout">
        <p>Loading workspaces…</p>
      </main>
    );
  }

  return (
    <main className="home-layout">
      <ViewRail workspaceId={selectedWorkspaceId} />

      <div className="home-main">
        <section className="picker-column">
          <h2>Workspaces</h2>
          <ul className="picker-list">
            {workspaces?.map((ws) => (
              <li key={ws.id}>
                <button
                  type="button"
                  className={ws.id === selectedWorkspaceId ? "picker-item picker-item--active" : "picker-item"}
                  onClick={() => setSelectedWorkspaceId(ws.id)}
                >
                  {ws.name}
                </button>
              </li>
            ))}
          </ul>

          <form className="inline-form" onSubmit={handleCreateWorkspace}>
            <input
              type="text"
              placeholder="New workspace name"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              required
            />
            <button type="submit" disabled={createWorkspace.isPending}>
              Create workspace
            </button>
          </form>
        </section>

        {selectedWorkspaceId ? (
          <section className="picker-column">
            <h2>Projects</h2>
            {projectsPending ? (
              <p>Loading projects…</p>
            ) : (
              <ul className="picker-list">
                {projects?.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      className="picker-item"
                      onClick={() => navigate(`/projects/${project.id}/board`)}
                    >
                      <strong>{project.key}</strong> — {project.name}
                    </button>
                  </li>
                ))}
                {projects?.length === 0 ? <li className="picker-empty">No projects yet.</li> : null}
              </ul>
            )}

            <form className="inline-form" onSubmit={handleCreateProject}>
              <input
                type="text"
                placeholder="Key (e.g. WF)"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                minLength={2}
                maxLength={10}
                required
              />
              <input
                type="text"
                placeholder="Project name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                required
              />
              <button type="submit" disabled={createProject.isPending}>
                Create project
              </button>
            </form>
          </section>
        ) : null}

        <p className="home-main__hint">Pick a view or project on the left.</p>

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </main>
  );
}
