import { io, type Socket } from "socket.io-client";

/**
 * Real-time client stub (see docs/architecture.md §5). Creates a configured
 * Socket.IO client authenticated via the JWT access token, but does NOT
 * auto-connect — callers decide when to `.connect()` once the real-time
 * feature is implemented.
 */
export function createSocket(token: string | null): Socket {
  const url = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

  return io(url, {
    autoConnect: false,
    withCredentials: true,
    auth: token ? { token } : undefined,
  });
}
