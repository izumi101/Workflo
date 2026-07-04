import { create } from "zustand";
import type { AuthResponse, AuthUser, Login, Register } from "@workflo/shared";
import { api, configureApiAuth } from "../lib/api.js";
import { configureSocketAuth, connectSocket, disconnectSocket } from "../lib/socket.js";
import { useActiveWorkspaceStore } from "./active-workspace.store.js";

type BootstrapStatus = "idle" | "loading" | "done";

type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  bootstrapStatus: BootstrapStatus;
  login: (input: Login) => Promise<void>;
  register: (input: Register) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  bootstrapStatus: "idle",

  login: async (input) => {
    const res = await api.post<AuthResponse>("/auth/login", input);
    set({ accessToken: res.accessToken, user: res.user });
    connectSocket();
  },

  register: async (input) => {
    const res = await api.post<AuthResponse>("/auth/register", input);
    set({ accessToken: res.accessToken, user: res.user });
    connectSocket();
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      set({ accessToken: null, user: null });
      disconnectSocket();
      useActiveWorkspaceStore.getState().clearActiveWorkspace();
    }
  },

  bootstrap: async () => {
    if (get().bootstrapStatus !== "idle") {
      return;
    }
    set({ bootstrapStatus: "loading" });
    try {
      const res = await api.post<AuthResponse>("/auth/refresh");
      set({ accessToken: res.accessToken, user: res.user, bootstrapStatus: "done" });
      connectSocket();
    } catch {
      set({ accessToken: null, user: null, bootstrapStatus: "done" });
    }
  },
}));

// Wire the plain `api.ts` transport layer to this store, so `api.ts` stays
// framework-agnostic while still being able to read/refresh the token and
// react to a hard auth failure (e.g. refresh itself 401s mid-session).
configureApiAuth({
  getAccessToken: () => useAuthStore.getState().accessToken,
  setAccessToken: (token) => useAuthStore.setState({ accessToken: token }),
  onAuthFailure: () => {
    useAuthStore.setState({ accessToken: null, user: null });
    disconnectSocket();
    useActiveWorkspaceStore.getState().clearActiveWorkspace();
  },
});

// Same wiring pattern as api.ts — socket.ts stays framework-agnostic and
// always reads the latest token straight from the store.
configureSocketAuth(() => useAuthStore.getState().accessToken);
