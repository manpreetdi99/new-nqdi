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

export interface DataCallRow {
  Location: string | null;
  SessionId: string;
  TestId: number | null;
  callStartTimeStamp: string | null;
  testType: string | null;
  direction: string | null;
  status: string | null;
  scoringStatus: string | null;
  host: string | null;
  pingRttAvg: number | null;
  throughputKbps: number | null;
  capacityThroughputKbps: number | null;
  youtubeMos: number | null;
  youtubeInterruptions: number | null;
  technology: string | null;
  startTechnology: string | null;
  CollectionName: string | null;
  ASideFileName: string | null;
  isValid: number | null;
  comment: string | null;
  latitude: number | null;
  longitude: number | null;
}

export async function fetchDataCalls(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
): Promise<DataCallRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: DataCallRow[] }>(`/api/data_calls?${params.toString()}`);
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

export interface CallKpiTile {
  SetupTime_s: number | null;
  AvgMOS: number | null;
  Jitter_ms: number | null;
  PacketLoss_pct: number | null;
  Download_Mbps: number | null;
  Upload_Mbps: number | null;
  Latency_ms: number | null;
}

export async function fetchCallKpiTile(
  database: string,
  session_id: string
): Promise<CallKpiTile> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/call_kpi_tile?${params.toString()}`);
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

export interface L3MessageRow {
  Phase: "before" | "during" | "after";
  SecondsFromCallStart: number | null;
  MsgTime: string | null;
  SessionId: string | null;
  Technology: string | null;
  Direction: string | null;
  Layer: string | null;
  MsgName: string | null;
  SimpleMsgName: string | null;
  Category: string | null;
  Class: string | null;
  SIPResponse: string | null;
  CombinedMsgNameSIPResponse: string | null;
  SIPCallId: string | null;
  PCI: number | null;
  ARFCN: number | null;
  Message: string | null;
}

export interface CallL3MessagesResponse {
  callWindow: Record<string, any> | null;
  l3Messages: L3MessageRow[];
  summary: {
    total: number;
    byPhase: { before: number; during: number; after: number };
    windowBeforeSec: number;
    windowAfterSec: number;
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

export interface LteMeasurementStat {
  EARFCN: number | null;
  PCI: number | null;
  samples: number;
  avgRSRP: number | null;
  minRSRP: number | null;
  maxRSRP: number | null;
  avgRSRQ: number | null;
  minRSRQ: number | null;
  maxRSRQ: number | null;
  avgSINR0: number | null;
  avgSINR1: number | null;
}

export interface LteScannerStat {
  EARFCN: number | null;
  PCI: number | null;
  RFBand: number | null;
  samples: number;
  avgRSRP: number | null;
  minRSRP: number | null;
  maxRSRP: number | null;
  avgRSRQ: number | null;
  minRSRQ: number | null;
  maxRSRQ: number | null;
  avgSINR: number | null;
  avgRSSI: number | null;
}

export async function fetchLteScannerRaw(
  database: string,
  session_id: string,
  top_only: boolean = false
): Promise<{ aSide: any[]; bSide: any[] }> {
  const params = new URLSearchParams({ database, session_id, top_only: String(top_only) });
  return requestJson(`/api/lte_scanner_raw?${params.toString()}`);
}

export async function fetchLteServingVsScanner(
  database: string,
  session_id: string
): Promise<{ serving: any[]; scanner: any[]; missedHandoverHint: any | null }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/lte_serving_vs_scanner?${params.toString()}`);
}

export async function fetchGsmScannerRaw(
  database: string,
  cgi: string,
  start: string,
  end: string
): Promise<any[]> {
  const params = new URLSearchParams({ database, cgi, start, end });
  return requestJson(`/api/gsm_scanner_raw?${params.toString()}`);
}

export async function fetchLteMeasurementComparison(
  database: string,
  session_id: string
): Promise<{ aSide: LteMeasurementStat[]; bSide: LteMeasurementStat[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/lte_measurement_comparison?${params.toString()}`);
}

export async function fetchLteScannerMeasurement(
  database: string,
  session_id: string
): Promise<{ aSide: LteScannerStat[]; bSide: LteScannerStat[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/lte_scanner_measurement?${params.toString()}`);
}

export async function fetchL3Messages(
  database: string,
  session_id: string,
  options?: { side?: "A" | "B"; technology?: string; layer?: string; before_seconds?: number; after_seconds?: number }
): Promise<CallL3MessagesResponse> {
  const params = new URLSearchParams({
    database,
    session_id,
    side: options?.side ?? "A",
    before_seconds: String(options?.before_seconds ?? 10),
    after_seconds: String(options?.after_seconds ?? 10),
  });
  if (options?.technology) params.append("technology", options.technology);
  if (options?.layer) params.append("layer", options.layer);
  return requestJson(`/api/l3_messages?${params.toString()}`);
}

export async function fetchGsmContextSignal(
  database: string,
  session_id: string,
  window_sec = 10
): Promise<{ signal: any[] }> {
  const params = new URLSearchParams({ database, session_id, window_sec: String(window_sec) });
  return requestJson(`/api/gsm_context_signal?${params.toString()}`);
}

export async function fetchCallContextSignalBSide(
  database: string,
  session_id: string,
  window_sec = 10
): Promise<{ signal: any[] }> {
  const params = new URLSearchParams({ database, session_id, window_sec: String(window_sec) });
  return requestJson(`/api/call_context_signal_b_side?${params.toString()}`);
}

export async function fetchGsmContextSignalBSide(
  database: string,
  session_id: string,
  window_sec = 10
): Promise<{ signal: any[] }> {
  const params = new URLSearchParams({ database, session_id, window_sec: String(window_sec) });
  return requestJson(`/api/gsm_context_signal_b_side?${params.toString()}`);
}

export interface RunMapResponse {
  output_path: string | null;
  logs: string[];
  success: boolean;
}

export async function runMapGenerator(
  database: string,
  collection: string,
  gpx_path: string,
  max_workers: number
): Promise<RunMapResponse> {
  return requestJson("/api/run_map", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ database, collection, gpx_path, max_workers }),
  });
}