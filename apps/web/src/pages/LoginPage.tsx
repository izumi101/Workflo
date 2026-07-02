import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loginSchema } from "@workflo/shared";
import { useAuthStore } from "../store/auth.store.js";
import { isApiError } from "../lib/api.js";

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string") errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await login(result.data);
      navigate("/", { replace: true });
    } catch (err) {
      setServerError(isApiError(err) ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Log in</h1>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        {fieldErrors.email ? <p className="field-error">{fieldErrors.email}</p> : null}

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {fieldErrors.password ? <p className="field-error">{fieldErrors.password}</p> : null}

        {serverError ? <p className="form-error">{serverError}</p> : null}

        <button type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>

        <p>
          No account? <Link to="/register">Register</Link>
        </p>
      </form>
    </main>
  );
}
