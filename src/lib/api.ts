import type { BenchmarkResult } from "@/types/benchmark";

export async function fetchDatabases(): Promise<string[]> {
  const res = await fetch("http://localhost:8000/api/databases");
  if (!res.ok) throw new Error("Failed to load databases");
  const json = await res.json();
  return json.databases;
}

export async function runBenchmarkApi(
  database: string,
  queries: string[]
): Promise<{
  results: BenchmarkResult[];
  totalTime: number;
}> {
  const res = await fetch("http://localhost:8000/api/benchmark", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ database, queries }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Benchmark failed");
  }

  return res.json();
}