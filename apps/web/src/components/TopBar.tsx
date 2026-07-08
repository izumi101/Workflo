import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth.store.js";
import { GlobalSearch } from "../features/search/GlobalSearch.js";
import { NotificationBell } from "../features/notifications/NotificationBell.js";

export function TopBar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="topbar">
      <span className="topbar__brand">Workflo</span>
      <GlobalSearch />
      {user ? (
        <>
          <NotificationBell />
          <div className="topbar__user">
            <span>{user.name}</span>
            <button type="button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </>
      ) : null}
    </header>
  );
}
