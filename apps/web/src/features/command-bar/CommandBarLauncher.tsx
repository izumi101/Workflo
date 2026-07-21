import { useEffect, useState } from "react";
import { useActiveWorkspaceStore } from "../../store/active-workspace.store.js";
import { useCommandBarDirectory } from "./command-bar.queries.js";
import { CommandBarOverlay } from "./CommandBarOverlay.js";

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/**
 * Top-bar affordance that replaces `GlobalSearch` (§2.1): a button styled
 * like an input ("Search or filter…  ⌘K") that opens the command bar
 * overlay. Also owns the global hotkeys — ⌘K/Ctrl+K always, and `/` only
 * when focus isn't already in a text field (so it doesn't hijack typing
 * elsewhere in the app, e.g. the comment composer). Rendered only once an
 * active workspace is known, same gating `GlobalSearch` used.
 */
export function CommandBarLauncher() {
  const workspaceId = useActiveWorkspaceStore((s) => s.workspaceId);
  const [isOpen, setIsOpen] = useState(false);
  const { directory } = useCommandBarDirectory(workspaceId);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen(true);
      } else if (e.key === "/" && !meta && !isTypingTarget(document.activeElement)) {
        e.preventDefault();
        setIsOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!workspaceId) {
    return null;
  }

  return (
    <>
      <button type="button" className="cmdbar-launcher" onClick={() => setIsOpen(true)}>
        <span className="cmdbar-launcher__label">Search or filter…</span>
        <span className="cmdbar-launcher__hint">⌘K</span>
      </button>

      {isOpen ? (
        <CommandBarOverlay workspaceId={workspaceId} directory={directory} onClose={() => setIsOpen(false)} />
      ) : null}
    </>
  );
}
