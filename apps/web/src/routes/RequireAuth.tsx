import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/auth.store.js";

/**
 * Route guard: redirects to /login once bootstrap has resolved and there is
 * no authenticated user. Renders nothing while bootstrap is still in flight
 * to avoid a login-page flash for a user with a valid refresh cookie.
 */
export function RequireAuth({ children }: { children: ReactElement }): ReactElement | null {
  const user = useAuthStore((s) => s.user);
  const bootstrapStatus = useAuthStore((s) => s.bootstrapStatus);
  const location = useLocation();

  if (bootstrapStatus !== "done") {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
