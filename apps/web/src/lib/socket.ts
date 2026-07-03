import { io, type Socket } from "socket.io-client";

/**
 * Real-time client (see docs/architecture.md §5, ADR-0003).
 *
 * A lazily-created singleton Socket.IO client. `autoConnect` is disabled —
 * callers (the auth store) decide when to `.connect()` (after login /
 * successful bootstrap) and `.disconnect()` (on logout). The `auth` option
 * is a callback so every (re)connect attempt — including automatic
 * reconnects after a token refresh — reads the CURRENT access token instead
 * of a value captured once at socket-creation time.
 */

type AccessTokenGetter = () => string | null;

let getAccessToken: AccessTokenGetter = () => null;
let socket: Socket | null = null;

/** Wires this module to the auth store's token accessor (mirrors api.ts's configureApiAuth pattern). */
export function configureSocketAuth(getter: AccessTokenGetter): void {
  getAccessToken = getter;
}

function createSocket(): Socket {
  return io({
    path: "/socket.io",
    autoConnect: false,
    withCredentials: true,
    reconnection: true,
    auth: (cb) => cb({ token: getAccessToken() }),
  });
}

/** Returns the singleton socket, creating it on first use. Does NOT connect it. */
export function getSocket(): Socket {
  if (!socket) {
    socket = createSocket();
  }
  return socket;
}

/** Connects the singleton socket if there's a token to authenticate with and it isn't already connected. */
export function connectSocket(): void {
  const s = getSocket();
  if (!s.connected && getAccessToken()) {
    s.connect();
  }
}

/** Disconnects and tears down the singleton socket (e.g. on logout) so the next connect starts clean. */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
  }
}
