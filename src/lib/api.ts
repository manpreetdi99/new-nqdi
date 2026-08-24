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
  /** Raw ResultsLQ08Avg samples για TestInfo.direction = 'A->B', OptionalWB σε [1,5]. */
  mosUlAvg?: number | null;
  mosUlMin?: number | null;
  mosUlMax?: number | null;
  mosUlSamples?: number | null;
  /** Raw ResultsLQ08Avg samples για TestInfo.direction = 'B->A', OptionalWB σε [1,5]. */
  mosDlAvg?: number | null;
  mosDlMin?: number | null;
  mosDlMax?: number | null;
  mosDlSamples?: number | null;
  /**
   * Setup time (sec), split MOC (A→B) / MTC (B→A) — ίδια τιμή ΚΑΙ κριτήριο με το
   * A-LEVEL "LQCallDataGSM.sql" reference query's MOCSetupTime/MTCSetupTime:
   * vResultsKPI.Duration (KPIID=10100, ErrorCode=0), Callstatus in Completed/Dropped,
   * Technology σε UMTS 2100/900 GSM 900/1800 (βλ. VKPI/CASE στο backend/routers/
   * calls.py). Επαληθεύτηκε 1:1 (τιμή+samples) στο STR_EVIA SOUTH_TOURISTIC
   * AREAS_2026H2. null όταν η κλήση δεν πληροί τα κριτήρια.
   */
  mocSetupTime?: number | null;
  mtcSetupTime?: number | null;
  /**
   * Setup time (sec), split VoLTE Call / CS Call — ίδιο κριτήριο με το A-LEVEL
   * "LQCallData.sql" reference query's CallSetupTimeVoLTE/CallSetupTimeCS:
   * vResultsKPI.Duration (KPIID 11013 για VoLTE, 10100 για CS στα δεδομένα που
   * ελέγχθηκαν — το 10108 της reference είναι σχεδόν άδειο εδώ), ErrorCode=0,
   * Callstatus in Completed/Dropped, callMode σε VoLTE/SRVCC ή CSFB/CS (βλ. CASE στο
   * backend/routers/calls.py). null όταν η κλήση δεν πληροί τα κριτήρια.
   */
  volteSetupTime?: number | null;
  csSetupTime?: number | null;
  /**
   * Per-session test counts by codec bucket — ίδιο bucketing με το A-LEVEL
   * "CallCodecTypeUsageGSM.sql" reference query (βλ. CODEC OUTER APPLY στο
   * backend/routers/calls.py). Χρησιμοποιούνται από buildCodecMix (attachmentC.ts)
   * ώστε το "Codec Type Usage %" να ζυγίζεται με πραγματικό όγκο tests, όχι με τον
   * ένα "dominant" codec ανά session.
   */
  codecFrAmrWbCount?: number | null;
  codecAmrHrCount?: number | null;
  codecAmrCount?: number | null;
  codecEfrCount?: number | null;
  codecFrCount?: number | null;
  codecHrCount?: number | null;
  codecOtherCount?: number | null;
  codecNoRateCount?: number | null;
  /**
   * "BadCall" — ίδιο κριτήριο με το A-LEVEL LQStatisticData.sql reference query:
   * 1 αν >15% των ResultsLQ08Avg δειγμάτων του session είναι κακά (OptionalWB < 2.2
   * ή Silence flag), 0 αν όχι, null αν δεν υπάρχουν έγκυρα δείγματα.
   */
  badCall?: number | null;
  /** Ποσοστό κακών δειγμάτων (0–100) που παρήγαγε το badCall· null όπως το badCall. */
  badCallPercentage?: number | null;
  numBadSample?: number | null;
  numValidSample?: number | null;
  numSilenceSample?: number | null;
  /**
   * "Low Speech Quality Calls (POLQA < 1.3)" — ίδιο κριτήριο με το A-LEVEL
   * "LOW MOS 1_3.sql" reference query: 1 αν το session (Completed) έχει 2 από 3
   * διαδοχικά δείγματα "κακά" (βλ. σχόλιο στο calls.py), αλλιώς 0.
   */
  badQualityCall?: number | null;
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

/**
 * Ένα (location, technology) ζευγάρι με το πλήθος GPS samples — ίδια μεθοδολογία με
 * το reference report "bi queries/RadioTech_Voice_newDB.sql": ένα sample ανά θέση
 * GPS πάνω σε φωνητική κλήση, technology = NetworkInfo.Technology. Πιο λεπτομερές
 * (π.χ. "GSM 900" vs "GSM 1800") και πιο ακριβές (πιάνει intra-call handovers) από
 * το χοντρικό `AllCallsRow.technology`/`CA.technology` — βλ. /api/technology_mix.
 */
export interface TechnologyMixRow {
  location: string | null;
  technology: string | null;
  samples: number;
}

export async function fetchTechnologyMix(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
): Promise<TechnologyMixRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: TechnologyMixRow[] }>(`/api/technology_mix?${params.toString()}`);
  return json.rows;
}

/**
 * Ένα (location, technology, cellCount) row για το "Number of 900/1800 band Cells"
 * (Attachment C, GSM) — βλ. /api/cell_band_count. cellCount = COUNT(DISTINCT
 * NetworkInfo.CID), ίδιο query/μεθοδολογία με το A-LEVEL "CELL ID GSM.sql" reference
 * query (κοινό πλέον για τους 3 operators, βλ. σχόλιο στο backend). Επαληθεύτηκε 1:1
 * στο STR_EVIA SOUTH_TOURISTIC AREAS_2026H2.
 */
export interface CellBandCountRow {
  location: string | null;
  technology: string | null;
  cellCount: number;
}

export async function fetchCellBandCount(database: string, collections: string[] = []): Promise<CellBandCountRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  const json = await requestJson<{ rows: CellBandCountRow[] }>(`/api/cell_band_count?${params.toString()}`);
  return json.rows;
}

/**
 * Ένα (location, status, count) ήδη-αθροισμένο row για τα "Total/Successful/Failed
 * SRVCC attempts" (Attachment C, FREE table — 3 γραμμές στο τέλος) — βλ. /api/srvcc.
 * status: 'success' (ErrorCode=0) / 'fail' (ErrorCode=108003) / 'other' (κάθε άλλο
 * ErrorCode — μετράει στο "attempts" total αλλά όχι στο "fail", ίδιο με το A-LEVEL
 * "SRVCC RAW.sql" reference query's HO_Status='N/A').
 */
export interface SrvccRow {
  location: string | null;
  status: "success" | "fail" | "other";
  count: number;
}

export async function fetchSrvcc(database: string, collections: string[] = []): Promise<SrvccRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  const json = await requestJson<{ rows: SrvccRow[] }>(`/api/srvcc?${params.toString()}`);
  return json.rows;
}

/**
 * Ένα (location, kind, code, samples) row για τα "Serving Band (per Time)" / "Serving
 * Technology (per Time)" ποσοστά των PS Data DL tests (Capacity DL / FTP DL / HTTP
 * TRANSFER (DL)) — βλ. /api/serving_band_tech. `kind` = "BAND" (NR band, π.χ. "NR28")
 * ή "TECH" (Technology.CurrTechnology, π.χ. "LTE-5GNR"· "#NODATA" = χωρίς data transfer).
 * Flat counts, όχι ποσοστά — βλ. buildServingBandTechTable στο attachmentC.ts.
 */
export interface ServingBandTechRow {
  location: string | null;
  kind: "BAND" | "TECH";
  code: string | null;
  samples: number;
}

export async function fetchServingBandTech(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
): Promise<ServingBandTechRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: ServingBandTechRow[] }>(`/api/serving_band_tech?${params.toString()}`);
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

// 5G NR serving-cell radio (FactNR5GRadio), για κλήσεις VoNR / VoNR/VoLTE N26 HO
// όπου το call.callMode δεν είναι πάντα σκέτο LTE anchor.
export async function fetchNr5gValues(
  database: string,
  session_id: string
): Promise<{ nr5gValues: any[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/nr5g_values?${params.toString()}`);
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

export interface CallNeighbors {
  prevSessionId: number | null;
  nextSessionId: number | null;
}

export async function fetchCallNeighbors(
  database: string,
  session_id: string
): Promise<CallNeighbors> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/call_neighbors?${params.toString()}`);
}

export async function fetchGsmValuesBSide(
  database: string,
  session_id: string
): Promise<{ gsmValuesBSide: any[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/gsm_values_b_side?${params.toString()}`);
}

export interface MosValueRow {
  MOS: number | null;
  OptionalWB: number | null;
  OptionalNB: number | null;
}

export async function fetchMosValues(
  database: string,
  session_id: string
): Promise<{ mosValues: MosValueRow[] }> {
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

/**
 * Έτοιμη περίοδος τεχνολογίας από το FactRadioTechnology (η πηγή που χρησιμοποιεί και
 * το SmartAnalytics Scene). Σε αντίθεση με το /api/call_context_technology, εδώ
 * υπάρχει και το GSM σκέλος ενός SRVCC και ολόκληρη η διάρκεια μιας CS κλήσης.
 */
export interface TechnologyPeriodRow {
  StartTime: string;
  EndTime: string | null;
  Duration: number | null;
  RadioTechnology: string | null;
  /** Band όπως το γράφει το εργαλείο, π.χ. "LTE E-UTRA 20", "GSM 900" */
  Band: string | null;
  /** π.χ. "Home network", "No service", "Emergency calls only" */
  NetworkStatus: string | null;
  /** π.χ. "LTE", "5G EN-DC" */
  RANConfiguration: string | null;
  RFBand: number | null;
  CGI: string | null;
  CellChanged: string | null;
  phase: "before" | "during" | "after";
}

export async function fetchTechnologyPeriods(
  database: string,
  session_id: string,
  window_sec = 10,
  side: "A" | "B" = "A"
): Promise<{ periods: TechnologyPeriodRow[] }> {
  const params = new URLSearchParams({ database, session_id, window_sec: String(window_sec), side });
  return requestJson(`/api/technology_periods?${params.toString()}`);
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
  cgi: string,
  start: string,
  end: string
): Promise<any[]> {
  const params = new URLSearchParams({ database, cgi, start, end });
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

export async function fetchGsmScannerBest(
  database: string,
  session_id: string
): Promise<any[]> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/gsm_scanner_best?${params.toString()}`);
}

export async function fetchLteScannerBest(
  database: string,
  session_id: string
): Promise<any[]> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/lte_scanner_best?${params.toString()}`);
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

export interface HandoverInfoRow {
  MsgId: number;
  SessionId: string | null;
  MsgTime: string | null;
  HoStatus: string | null;
  hoDuration: number | null;
  Latitude: number | null;
  Longitude: number | null;
}

export async function fetchHandoverInfo(
  database: string,
  session_id: string
): Promise<{ handoverInfo: HandoverInfoRow[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/handover_info?${params.toString()}`);
}

export interface SrvccEventRow {
  Side: "A" | "B" | string | null;
  MsgId: number | null;
  SessionId: string | null;
  KPIId: 38040 | 38050 | number;
  HandoverType: "4G->3G" | "4G->2G" | string;
  ErrorCode: number | null;
  Status: "Success" | "Fail" | "Unknown" | string;
  EventTime: string | null;
  TargetTime: string | null;
  InterruptionMs: number | null;
  SourceTime: string | null;
  SourceTechnology: string | null;
  SourceBand: string | number | null;
  SourceCGI: string | null;
  SourceCellId: string | number | null;
  SourceLAC: string | number | null;
  SourceRAC: string | number | null;
  SourceBCCH: string | number | null;
  SourceBSIC: string | number | null;
  SourceOperator: string | null;
  SourceMCC: string | number | null;
  SourceMNC: string | number | null;
  TargetNetworkTime: string | null;
  TargetTechnology: string | null;
  TargetBand: string | number | null;
  TargetCGI: string | null;
  TargetCellId: string | number | null;
  TargetLAC: string | number | null;
  TargetRAC: string | number | null;
  TargetBCCH: string | number | null;
  TargetBSIC: string | number | null;
  TargetOperator: string | null;
  TargetMCC: string | number | null;
  TargetMNC: string | number | null;
  SourceRadioTime: string | null;
  SourceEARFCN: number | null;
  SourcePCI: number | null;
  SourceRadioCGI: string | null;
  SourceRSRP: number | null;
  SourceRSRQ: number | null;
  SourceSINR: number | null;
  SourceRSSI: number | null;
  SourceDLBandwidth: string | number | null;
  SourceULBandwidth: string | number | null;
  TargetRadioTime: string | null;
  TargetRadioBand: string | number | null;
  TargetRadioCGI: string | null;
  TargetRxLev: number | null;
  TargetRxQual: number | null;
}

export interface SrvccTechnologyRow extends TechnologyTimelineRow {
  Side: "A" | "B" | string | null;
  SessionId: string | null;
}

export interface SrvccDetailResponse {
  events: SrvccEventRow[];
  technology: SrvccTechnologyRow[];
}

export async function fetchCallSrvccDetail(
  database: string,
  session_id: string
): Promise<SrvccDetailResponse> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/call_srvcc_detail?${params.toString()}`);
}

export interface TechnologyTimelineRow {
  MsgTime: string | null;
  PrevTechnology: string | null;
  CurrTechnology: string | null;
  Duration: number | null;
  Band: string | null;
  LTEDLCarriers: number | null;
  LTEULCarriers: number | null;
  NR5GDLCarriers: number | null;
  NR5GULCarriers: number | null;
  Latitude: number | null;
  Longitude: number | null;
}

export async function fetchTechnologyTimeline(
  database: string,
  session_id: string
): Promise<{ technologyTimeline: TechnologyTimelineRow[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/technology_timeline?${params.toString()}`);
}

export interface VoiceCodecRow {
  MsgTime: string | null;
  SessionId: string | null;
  Direction: string | null; // "U" (uplink) or "D" (downlink)
  Codec: number | null;
  CodecName: string | null;
  CodecRate: number | null;
  Duration: number | null;
}

export async function fetchVoiceCodec(
  database: string,
  session_id: string
): Promise<{ voiceCodec: VoiceCodecRow[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/voice_codec?${params.toString()}`);
}

export interface MarkerRow {
  markerId: number;
  SessionId: string | null;
  MsgTime: string | null;
  PosId: number | null;
  NetworkId: number | null;
  MarkerText: string | null;
}

export async function fetchMarkers(
  database: string,
  session_id: string
): Promise<{ markers: MarkerRow[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/markers?${params.toString()}`);
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
