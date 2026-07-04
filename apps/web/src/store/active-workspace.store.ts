import { create } from "zustand";

/**
 * Tracks which workspace the user is currently "inside", derived from the
 * project loaded by the board/backlog/issue-detail views (a project always
 * carries its `workspaceId`). This is what gates the global search box in
 * `TopBar` — search needs a `workspaceId`, so the box only renders once we
 * know one. Cleared on logout so a fresh session never leaks a stale value.
 */
type ActiveWorkspaceState = {
  workspaceId: string | null;
  name: string | null;
  setActiveWorkspace: (workspace: { workspaceId: string; name: string }) => void;
  clearActiveWorkspace: () => void;
};

export const useActiveWorkspaceStore = create<ActiveWorkspaceState>((set) => ({
  workspaceId: null,
  name: null,

  setActiveWorkspace: ({ workspaceId, name }) => {
    set((state) => {
      if (state.workspaceId === workspaceId && state.name === name) {
        return state;
      }
      return { workspaceId, name };
    });
  },

  clearActiveWorkspace: () => {
    set({ workspaceId: null, name: null });
  },
}));
