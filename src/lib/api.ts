import type { BenchmarkResult } from "@/types/benchmark";

// Βάλε εδώ το public (local) tunnel URL σου, π.χ. "https://my-tunnel.ngrok.io" ή χρησιμοποίησε το environment variable
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://192.168.10.44:8000";

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
        "The preview cannot reach localhost on your computer. Run the frontend locally too, or expose the Python API with a public tunnel URL.",
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
  callMode: string | null;
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
  isValid?: number | null;
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

export async function fetchLteValues(
  database: string,
  session_id: string
): Promise<{ lteValues: any[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/lte_values?${params.toString()}`);
}

export async function fetchLteValuesBSide(
  database: string,
  session_id: string
): Promise<{ lteValuesBSide: any[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/lte_values_b_side?${params.toString()}`);
}

export async function fetchGsmValues(
  database: string,
  session_id: string
): Promise<{ gsmValues: any[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/gsm_values?${params.toString()}`);
}

export async function fetchGsmValuesBSide(
  database: string,
  session_id: string
): Promise<{ gsmValuesBSide: any[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/gsm_values_b_side?${params.toString()}`);
}

export async function fetchMosValues(
  database: string,
  session_id: string
): Promise<{ mosValues: any[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/mos_values?${params.toString()}`);
}

export async function fetchKpiValues(
  database: string,
  session_id?: string
): Promise<{ kpiValues: any[] }> {
  const params = new URLSearchParams({ database });
  if (session_id) params.append("session_id", session_id);
  return requestJson(`/api/results_kpi?${params.toString()}`);
}

export interface CallSideComparisonRow {
  Side: string | null;
  callStatus: string | null;
  code: string | null;
  codeDescription: string | null;
  calls: number | null;
}

export async function fetchCallSideComparison(
  database: string,
  session_id: string
): Promise<{ comparison: CallSideComparisonRow[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/call_side_comparison?${params.toString()}`);
}

export async function updateCallComment(
  database: string,
  session_id: string,
  comment: string
): Promise<{ message: string }> {
  return requestJson("/api/calls/comment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ database, session_id, comment }),
  });
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

export interface TraceLogRow {
  // FactId: number | null;
  FullDate: string | null;
  SessionId: string | null;
  Info: string | null;
  Side: string | null; // Added Side field to include it in TraceLogRow
  
}

export interface AntennaRow {
  lat: number;
  lon: number;
  siteId: number | null;
  cellId: number | null;
  cellName: string | null;
  azimuth: number | null;
  freq: number | null;
  vendor: string | null;
  enbName: string | null;
  tech: string | null;
  status: string | null;
  pci: number | null;
  downtilt: number | null;
  height: number | null;
}

export async function fetchAntennas(): Promise<{ antennas: AntennaRow[]; total: number }> {
  return requestJson("/api/antennas");
}

export async function fetchCellInfo(
  database: string,
  session_id: string
): Promise<{ eNBId: number | null; EARFCN: number | null; PCI: number | null }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/cell_info?${params.toString()}`);
}

export async function fetchCellInfoBSide(
  database: string,
  session_id: string
): Promise<{ eNBId: number | null; EARFCN: number | null; PCI: number | null }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/cell_info_b_side?${params.toString()}`);
}

export async function fetchTracelogValues(
  database: string,
  session_id?: string
): Promise<{ tracelogValues: TraceLogRow[] }> {
  const params = new URLSearchParams({ database });
  if (session_id) params.append("session_id", session_id);
  return requestJson(`/api/tracelog_values?${params.toString()}`);
}

export async function fetchCallContextSignal(
  database: string,
  session_id: string,
  window_sec = 10
): Promise<{ signal: any[] }> {
  const params = new URLSearchParams({ database, session_id, window_sec: String(window_sec) });
  return requestJson(`/api/call_context_signal?${params.toString()}`);
}

export async function fetchCallContextTechnology(
  database: string,
  session_id: string,
  window_sec = 10
): Promise<{ technology: any[] }> {
  const params = new URLSearchParams({ database, session_id, window_sec: String(window_sec) });
  return requestJson(`/api/call_context_technology?${params.toString()}`);
}

export interface PagingTimelineEvent {
  phase: "before" | "during" | "after";
  time: string | null;
  secondsFromCallStart: number | null;
  type: "lte_paging_edrx" | "lte_rrc_paging" | "nr_rrc_paging";
  title: string;
  details: Record<string, any>;
}

export interface CallPagingInfoResponse {
  callWindow: Record<string, any> | null;
  ltePagingEDRX: Record<string, any>[];
  lteRrcPaging: Record<string, any>[];
  nrRrcPaging: Record<string, any>[];
  timeline: PagingTimelineEvent[];
  summary: {
    ltePagingEDRX: number;
    lteRrcPaging: number;
    nrRrcPaging: number;
    totalPagingEvents: number;
  };
  message?: string;
}

export interface CallDeviceInfo {
  fileInfo: {
    ASideDevice: string | null;
    BSideDevice: string | null;
    ASideNumber: string | null;
    BSideNumber: string | null;
    IMEI: string | null;
    FirmwareV: string | null;
    IMSI: string | null;
    ProductVersion: string | null;
    MFVersion: string | null;
    SWVersion: string | null;
    ASideFileName: string | null;
    BSideFileName: string | null;
    ASideLocation: string | null;
    BSideLocation: string | null;
  };
  aSideDevice: {
    Model: string | null;
    IMEI: string | null;
    IMSI: string | null;
    Firmware: string | null;
    Number: string | null;
    Side: string | null;
    DeviceType: string | null;
    RFManufacturer: string | null;
    RFModel: string | null;
    SerialNumber: string | null;
    OS: string | null;
    BaseBand: string | null;
  } | null;
  bSideDevice: {
    Model: string | null;
    IMEI: string | null;
    IMSI: string | null;
    Firmware: string | null;
    Number: string | null;
    Side: string | null;
    DeviceType: string | null;
    RFManufacturer: string | null;
    RFModel: string | null;
    SerialNumber: string | null;
    OS: string | null;
    BaseBand: string | null;
  } | null;
}

export async function fetchCallDeviceInfo(
  database: string,
  session_id: string
): Promise<CallDeviceInfo> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/call_device_info?${params.toString()}`);
}

export async function fetchCallPagingInfo(
  database: string,
  session_id: string,
  before_seconds = 60,
  after_seconds = 60
): Promise<CallPagingInfoResponse> {
  const params = new URLSearchParams({
    database,
    session_id,
    before_seconds: String(before_seconds),
    after_seconds: String(after_seconds),
  });
  return requestJson(`/api/call_paging_info?${params.toString()}`);
}