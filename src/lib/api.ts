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

export async function fetchCollectionNames(database: string): Promise<string[]> {
  const params = new URLSearchParams({ database });
  const json = await requestJson<{ collections: string[] }>(`/api/collections?${params.toString()}`);
  return json.collections;
}

export async function fetchLocations(database: string, collections: string[] = []): Promise<string[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  const json = await requestJson<{ locations: string[] }>(`/api/locations?${params.toString()}`);
  return json.locations;
}

export interface AllCallsRow {
  Location: string | null;
  SessionId: string;
  callType: string | null;
  technology: string | null;
  callDir: string | null;
  status: string | null;
  setupTime: number | null;
  CollectionName: string | null;
  callDuration: number | null;
  callStartTimeStamp: string | null;
  Avg_mos: number | null;
  latitude: number | null;
  longitude: number | null;
  ASideFileName?: string | null;
  comment: string | null;
}

export async function fetchAllCalls(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
): Promise<AllCallsRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: AllCallsRow[] }>(`/api/calls?${params.toString()}`);
  return json.rows;
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