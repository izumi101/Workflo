import { useQuery } from "@tanstack/react-query";

type HealthResponse = {
  status: string;
  service: string;
  ts: string;
};

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/v1/health");
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return res.json();
}

export function App() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });

  const statusClass = isPending
    ? "status status--pending"
    : isError
      ? "status status--error"
      : "status status--ok";

  const label = isPending
    ? "API: connecting…"
    : isError
      ? `API: error (${(error as Error).message})`
      : `API: connected (${data?.service} @ ${data?.ts})`;

  return (
    <main>
      <h1>Workflo</h1>
      <p>Jira alternative — skeleton build.</p>
      <span className={statusClass}>{label}</span>
    </main>
  );
}
