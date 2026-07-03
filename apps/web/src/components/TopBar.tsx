import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth.store.js";

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
      {user ? (
        <div className="topbar__user">
          <span>{user.name}</span>
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      ) : null}
    </header>
  );
}
