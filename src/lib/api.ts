import type { BenchmarkResult } from "@/types/benchmark";

const API_BASE_URL = "http://localhost:8000";

export class ApiClientError extends Error {
  code: string;
  status?: number;
  endpoint: string;
  hint: string;

  constructor({
    message,
    code,
    endpoint,
    hint,
    status,
  }: {
    message: string;
    code: string;
    endpoint: string;
    hint: string;
    status?: number;
  }) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.endpoint = endpoint;
    this.hint = hint;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const endpoint = `${API_BASE_URL}${path}`;

  try {
    const res = await fetch(endpoint, init);

    if (!res.ok) {
      let serverMessage = `Request failed with status ${res.status}`;

      try {
        const json = await res.json();
        serverMessage = json.detail || json.message || serverMessage;
      } catch {
        const text = await res.text();
        if (text) serverMessage = text;
      }

      throw new ApiClientError({
        code: `HTTP-${res.status}`,
        endpoint,
        status: res.status,
        message: serverMessage,
        hint: "The Python API responded, but returned an application error.",
      });
    }

    return res.json();
  } catch (error) {
    if (error instanceof ApiClientError) throw error;

    throw new ApiClientError({
      code: "NET-001",
      endpoint,
      message: error instanceof Error ? error.message : "Failed to fetch",
      hint:
        "The Lovable preview cannot reach localhost on your computer. Run the frontend locally too, or expose the Python API with a public tunnel URL.",
    });
  }
}

export async function fetchDatabases(): Promise<string[]> {
  const json = await requestJson<{ databases: string[] }>("/api/databases");
  return json.databases;
}

export async function runBenchmarkApi(
  database: string,
  queries: string[]
): Promise<{
  results: BenchmarkResult[];
  totalTime: number;
}> {
  return requestJson("/api/benchmark", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ database, queries }),
  });
}