/**
 * Typed fetch wrapper for the Workflo API (see docs/architecture.md §4).
 *
 * - Base path is `/api/v1`; the Vite dev proxy forwards it to the API.
 * - Attaches `Authorization: Bearer <token>` from the in-memory access token.
 * - Always sends `credentials: "include"` so the httpOnly refresh cookie
 *   travels with every request.
 * - On a 401 (and the request wasn't already a refresh/retry), transparently
 *   calls `/auth/refresh` ONCE, updates the token, and retries the original
 *   request. If refresh also fails, clears auth and rethrows so callers can
 *   route to /login.
 */

export type ApiError = {
  status: number;
  message: string;
  issues?: unknown;
};

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "status" in value && "message" in value;
}

export { isApiError };

type TokenGetter = () => string | null;
type TokenSetter = (token: string | null) => void;
type OnAuthFailure = () => void;

let getAccessToken: TokenGetter = () => null;
let setAccessToken: TokenSetter = () => {};
let onAuthFailure: OnAuthFailure = () => {};

/**
 * Wires the API client to the auth store. Called once from the auth store
 * module so `api.ts` never imports Zustand state directly (keeps this file
 * a plain, testable transport layer).
 */
export function configureApiAuth(hooks: {
  getAccessToken: TokenGetter;
  setAccessToken: TokenSetter;
  onAuthFailure: OnAuthFailure;
}): void {
  getAccessToken = hooks.getAccessToken;
  setAccessToken = hooks.setAccessToken;
  onAuthFailure = hooks.onAuthFailure;
}

const API_BASE = "/api/v1";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** internal — prevents infinite refresh retry loops */
  _isRetry?: boolean;
};

async function parseErrorBody(res: Response): Promise<{ message: string; issues?: unknown }> {
  try {
    const data = (await res.json()) as { message?: string; error?: { message?: string; details?: unknown } };
    if (data?.error?.message) {
      return { message: data.error.message, issues: data.error.details };
    }
    if (data?.message) {
      return { message: data.message, issues: (data as { issues?: unknown }).issues };
    }
    return { message: res.statusText || "Request failed" };
  } catch {
    return { message: res.statusText || "Request failed" };
  }
}

async function doFetch(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  return fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
    credentials: "include",
  });
}

let refreshInFlight: Promise<boolean> | null = null;

/** Calls /auth/refresh once; dedupes concurrent callers onto a single promise. */
async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          return false;
        }
        const data = (await res.json()) as { accessToken: string };
        setAccessToken(data.accessToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await doFetch(path, options);

  if (res.status === 401 && !options._isRetry && path !== "/auth/refresh") {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _isRetry: true });
    }
    setAccessToken(null);
    onAuthFailure();
    const err: ApiError = { status: 401, message: "Session expired" };
    throw err;
  }

  if (!res.ok) {
    const { message, issues } = await parseErrorBody(res);
    const err: ApiError = { status: res.status, message, issues };
    throw err;
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
