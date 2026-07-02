import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerSchema } from "@workflo/shared";
import { useAuthStore } from "../store/auth.store.js";
import { isApiError } from "../lib/api.js";

export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);

    const result = registerSchema.safeParse({ name, email, password });
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
      await register(result.data);
      navigate("/", { replace: true });
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setServerError("An account with this email already exists.");
      } else {
        setServerError(isApiError(err) ? err.message : "Registration failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Create account</h1>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        {fieldErrors.name ? <p className="field-error">{fieldErrors.name}</p> : null}

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
            autoComplete="new-password"
          />
        </label>
        {fieldErrors.password ? <p className="field-error">{fieldErrors.password}</p> : null}

        {serverError ? <p className="form-error">{serverError}</p> : null}

        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create account"}
        </button>

        <p>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}
