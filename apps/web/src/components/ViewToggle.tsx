import { Link } from "react-router-dom";

/** Small Board/Backlog switcher shown on both project views (roadmap 0.2). */
export function ViewToggle({ projectId, active }: { projectId: string; active: "board" | "backlog" }) {
  return (
    <nav className="view-toggle" aria-label="View">
      <Link
        to={`/projects/${projectId}/board`}
        className={active === "board" ? "view-toggle__link view-toggle__link--active" : "view-toggle__link"}
      >
        Board
      </Link>
      <Link
        to={`/projects/${projectId}/backlog`}
        className={active === "backlog" ? "view-toggle__link view-toggle__link--active" : "view-toggle__link"}
      >
        Backlog
      </Link>
    </nav>
  );
}
