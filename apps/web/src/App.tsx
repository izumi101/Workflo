import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { TopBar } from "./components/TopBar.js";
import { RequireAuth } from "./routes/RequireAuth.js";
import { useAuthStore } from "./store/auth.store.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { HomePage } from "./pages/HomePage.js";
import { BoardPage } from "./features/board/BoardPage.js";

export function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const bootstrapStatus = useAuthStore((s) => s.bootstrapStatus);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <>
      <TopBar />
      {bootstrapStatus !== "done" ? (
        <p className="app-loading">Loading…</p>
      ) : (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <HomePage />
              </RequireAuth>
            }
          />
          <Route
            path="/projects/:projectId/board"
            element={
              <RequireAuth>
                <BoardPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </>
  );
}
