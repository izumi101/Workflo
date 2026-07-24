import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { TopBar } from "./components/TopBar.js";
import { RequireAuth } from "./routes/RequireAuth.js";
import { useAuthStore } from "./store/auth.store.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { HomePage } from "./pages/HomePage.js";
import { BoardPage } from "./features/board/BoardPage.js";
import { BacklogPage } from "./features/backlog/BacklogPage.js";
import { IssueDetailPage } from "./features/issue-detail/IssueDetailPage.js";
import { ViewResultsPage } from "./features/command-bar/ViewResultsPage.js";
import { TriagePage } from "./features/triage/TriagePage.js";

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
          <Route
            path="/projects/:projectId/backlog"
            element={
              <RequireAuth>
                <BacklogPage />
              </RequireAuth>
            }
          />
          <Route
            path="/issues/:key"
            element={
              <RequireAuth>
                <IssueDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/views/new"
            element={
              <RequireAuth>
                <ViewResultsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/triage"
            element={
              <RequireAuth>
                <TriagePage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </>
  );
}
