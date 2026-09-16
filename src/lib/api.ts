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

/**
 * Πόσο περιμένουμε ΕΝΑ request πριν το κόψουμε. Τα summary endpoints πάνω σε ΟΛΑ τα
 * collections μιας βάσης (π.χ. PEL_26H2) είναι λεπτά, όχι δευτερόλεπτα: το /api/calls
 * χτίζει 6 #temp tables, το /api/data_calls γυρίζει 30k+ γραμμές. Χωρίς ρητό όριο
 * κληρώναμε ό,τι όριο είχε ο network stack του browser/proxy — γι' αυτό "έκανε timeout
 * εύκολα". 15' default, override με VITE_API_TIMEOUT_MS (0 = καθόλου όριο).
 */
const readNumberEnv = (raw: unknown, fallback: number): number => {
  const parsed = Number(raw);
  return raw == null || raw === "" || !Number.isFinite(parsed) || parsed < 0 ? fallback : parsed;
};

const DEFAULT_TIMEOUT_MS = readNumberEnv(import.meta.env.VITE_API_TIMEOUT_MS, 15 * 60_000);

/** Πόσες φορές ξαναδοκιμάζουμε ΜΟΝΟ τα transient σφάλματα (δες isRetryable). */
const MAX_RETRIES = readNumberEnv(import.meta.env.VITE_API_RETRIES, 2);

/**
 * Ό,τι δέχεται το fetch (άρα και `signal`, π.χ. από το react-query queryFn ({ signal })),
 * συν per-request override του timeout. 0 = καθόλου όριο.
 */
export type RequestOptions = RequestInit & { timeoutMs?: number };

/**
 * Transient = αξίζει retry: χαμένο/μισό δίκτυο, δικό μας timeout, ή gateway/overload
 * απαντήσεις. Ένα HTTP-500 από SQL error ΔΕΝ είναι transient — θα ξαναγυρίσει το ίδιο.
 */
const isRetryable = (error: unknown): boolean => {
  if (error instanceof ApiClientError) {
    if (error.code === "NET-001" || error.code === "NET-TIMEOUT") return true;
    return error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504;
  }
  return false;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ένα signal που ανάβει είτε από τον caller (react-query cancel) είτε από το δικό μας
 * timeout. Χειροκίνητα αντί για AbortSignal.any(), που δεν υπάρχει σε παλιότερα browsers.
 * Γυρίζει και `timedOut` ώστε να ξεχωρίσουμε "το έκοψε ο χρήστης" από "άργησε".
 */
const withTimeout = (timeoutMs: number, external?: AbortSignal) => {
  const controller = new AbortController();
  const state = { timedOut: false };

  const abortFromExternal = () => controller.abort();
  external?.addEventListener("abort", abortFromExternal);

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          state.timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;

  return {
    signal: controller.signal,
    state,
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      external?.removeEventListener("abort", abortFromExternal);
    },
  };
};

async function requestJson<T>(path: string, options?: RequestOptions): Promise<T> {
  const endpoint = `${API_BASE_URL}${path}`;
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...init } = options ?? {};

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    // Ο caller ακύρωσε όσο περιμέναμε το backoff — μη ξεκινήσεις νέο attempt.
    if (externalSignal?.aborted) throw lastError ?? new DOMException("Aborted", "AbortError");

    const guard = withTimeout(timeoutMs, externalSignal ?? undefined);

    try {
      const res = await fetch(endpoint, { ...init, signal: guard.signal });

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

      return (await res.json()) as T;
    } catch (error) {
      // Ακύρωση από τον caller: πέτα το ως είναι, ΧΩΡΙΣ retry και χωρίς toast-άξιο error.
      if (externalSignal?.aborted && !guard.state.timedOut) throw error;

      lastError = guard.state.timedOut
        ? new ApiClientError({
            code: "NET-TIMEOUT",
            endpoint,
            message: `Το request ξεπέρασε τα ${Math.round(timeoutMs / 1000)}s και κόπηκε.`,
            hint:
              "Πολλά collections μαζί = λεπτά SQL. Ανέβασε το VITE_API_TIMEOUT_MS ή διάλεξε λιγότερα collections.",
          })
        : error instanceof ApiClientError
          ? error
          : new ApiClientError({
              code: "NET-001",
              endpoint,
              message: error instanceof Error ? error.message : "Failed to fetch",
              hint:
                "The preview cannot reach localhost on your computer. Run the frontend locally too, or expose the Python API with a public tunnel URL.",
            });

      if (attempt === MAX_RETRIES || !isRetryable(lastError)) throw lastError;

      // 1s, 2s, 4s ... — δίνει χρόνο στον SQL Server να αποσυμφορηθεί πριν ξαναρωτήσουμε.
      await sleep(1000 * 2 ** attempt);
    } finally {
      guard.cleanup();
    }
  }

  throw lastError;
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
  codecEvsCount?: number | null;
  codecEvsWbCount?: number | null;
  codecAmrUmtsCount?: number | null;
  codecAmrFrCount?: number | null;
  codecAmrWbCount?: number | null;
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
  options?: RequestOptions,
): Promise<AllCallsRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: AllCallsRow[] }>(`/api/calls?${params.toString()}`, options);
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
  options?: RequestOptions,
): Promise<TechnologyMixRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: TechnologyMixRow[] }>(`/api/technology_mix?${params.toString()}`, options);
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

export async function fetchCellBandCount(database: string, collections: string[] = [], options?: RequestOptions): Promise<CellBandCountRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  const json = await requestJson<{ rows: CellBandCountRow[] }>(`/api/cell_band_count?${params.toString()}`, options);
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

export async function fetchSrvcc(database: string, collections: string[] = [], options?: RequestOptions): Promise<SrvccRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  const json = await requestJson<{ rows: SrvccRow[] }>(`/api/srvcc?${params.toString()}`, options);
  return json.rows;
}

/**
 * Ένα (location, status, count, avg, minVal, maxVal, stdVal) ήδη-αθροισμένο row για
 * το "DNS" section του PS Data Stats table — βλ. /api/dns. Ίδιο σχήμα με το SrvccRow
 * (αθροισμένο ανά location+status αντί για raw ανά-attempt rows). `avg`/`minVal`/
 * `maxVal`/`stdVal` σε ms (DNS resolution time, vResultsKPI.Duration KPIID=31100). Το
 * frontend τα μετατρέπει σε DataCallRow σχήμα (testType="DNS") — βλ.
 * mapDnsRowsToDataCallRows στο attachmentC.ts.
 */
export interface DnsRow {
  location: string | null;
  status: string;
  count: number;
  avg: number | null;
  minVal: number | null;
  maxVal: number | null;
  stdVal: number | null;
}

export async function fetchDns(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
  options?: RequestOptions,
): Promise<DnsRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: DnsRow[] }>(`/api/dns?${params.toString()}`, options);
  return json.rows;
}

/**
 * Ένα Ookla speedtest action row (Downlink Performance / Uplink Performance μόνο —
 * το backend φιλτράρει έξω τα social media/messaging actions άλλων app tests) — βλ.
 * /api/ookla. `throughputKbps` ήδη σε kbps. Το frontend τα μετατρέπει σε DataCallRow
 * σχήμα (testType="Ookla", direction="DL"/"UL" από το actionName) ώστε να μπουν στο
 * ίδιο PS Data Stats pipeline με τα υπόλοιπα tests — βλ. mapOoklaRowsToDataCallRows
 * στο attachmentC.ts.
 */
export interface OoklaRow {
  sessionId: string;
  testId: number | null;
  collectionName: string | null;
  aSideDevice: string | null;
  aSideFileName: string | null;
  location: string | null;
  homeOperator: string | null;
  technology: string | null;
  dataTechnology: string | null;
  endTime: string | null;
  app: string | null;
  profileName: string | null;
  actionId: number | null;
  durationMs: number | null;
  throughputKbps: number | null;
  actionStatus: "Success" | "Failed";
  actionName: "Downlink Performance" | "Uplink Performance";
  latencyMs: number | null;
  packetLossPct: number | null;
  cgi: string | null;
  startTime: string | null;
}

export async function fetchOokla(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
  options?: RequestOptions,
): Promise<OoklaRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: OoklaRow[] }>(`/api/ookla?${params.toString()}`, options);
  return json.rows;
}

/**
 * Ένα raw Capacity test row, με το "Link" (grx/akamai/άλλο) που το εξυπηρέτησε — βλ.
 * /api/capacity_link. Ίδιο query με το ήδη υπάρχον "CAPACITY – DL/UL Throughput
 * (grx+akamai+ookla)" saved query του QueryMap (src/components/QueryMap.tsx), χωρίς το
 * APP TESTS union branch. `direction` ήδη "DL"/"UL" (από ResultsCapacityTestParameters.
 * Direction 'get%'/'put%'), `throughputKbps` ήδη σε kbps (ίδια μονάδα με
 * DataCallRow.capacityThroughputKbps). ΔΕΝ αντικαθιστά τις "Capacity" γραμμές του
 * CDRCombined (/api/data_calls) — είναι ΕΠΙΠΛΕΟΝ breakdown ανά link, μόνο για το Full
 * mode. Το frontend το μετατρέπει σε DataCallRow σχήμα (testType="Capacity grx"/
 * "Capacity akamai") — βλ. mapCapacityLinkRowsToDataCallRows στο attachmentC.ts.
 */
export interface CapacityLinkRow {
  location: string | null;
  sessionId: string;
  testId: number | null;
  direction: "DL" | "UL" | string;
  link: string | null;
  throughputKbps: number | null;
  success: number;
  failed: number;
  collectionName: string | null;
  aSideFileName: string | null;
}

export async function fetchCapacityLink(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
  options?: RequestOptions,
): Promise<CapacityLinkRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: CapacityLinkRow[] }>(`/api/capacity_link?${params.toString()}`, options);
  return json.rows;
}

/**
 * Ένα raw ping-packet row — PacketSize 40, 800, Ή 1000 (βλ. `packetSize`, το πεδίο που τα
 * ξεχωρίζει) — για τα "Ping 40 B"/"Ping 800 B"/"Ping 1000 B" sections του PS Data Stats
 * table, βλ. /api/ping_1000. Ίδιο query με το A-LEVEL "PING RAW.sql" reference query / το
 * "Ping RAW" saved query του QueryEditor· δεν φτάνουν σαν δικό τους TestName από το
 * CDRCombined view του /api/data_calls, γι' αυτό τα φτιάχνουμε από εδώ — και τα τρία
 * packet sizes μαζί, ΧΩΡΙΣ PacketSize filter (2026-08-31), σε ένα call. `rtt` είναι NULL
 * όταν το packet απέτυχε (errorCode <> 0). Το frontend τα μετατρέπει σε DataCallRow σχήμα
 * (testType="Ping 40"/"Ping 800"/"Ping 1000", βάσει `packetSize`) — βλ.
 * mapPing1000RowsToDataCallRows στο attachmentC.ts. Τα παλιά "ICMP Ping 40"/"ICMP Ping
 * 800" rows του /api/data_calls βγαίνουν ρητά πριν μπουν στο summary pipeline (βλ.
 * excludeCdrPingDuplicates), αλλιώς θα μετρούσαν διπλά με αυτά εδώ.
 */
export interface PingRow {
  location: string | null;
  /** Λείπει σε aggregate mode — ένα group δεν ανήκει σε ένα session. */
  sessionId?: string;
  testId?: number | null;
  host: string | null;
  /** Raw mode: το RTT του packet. Aggregate mode: ο μέσος όρος πάνω σε `rttSamples`. */
  rtt: number | null;
  packetSize: number | null;
  errorCode?: string | null;
  success: number;
  failed: number;
  sequenceNumber?: number | null;
  collectionName: string | null;
  aSideFileName: string | null;
  /** Aggregate mode μόνο: πόσα packets αντιπροσωπεύει η γραμμή. Λείπει = raw, δηλαδή 1. */
  count?: number;
  /** Aggregate mode μόνο: πόσα από αυτά έχουν RTT > 0, δηλαδή μπαίνουν στο Mean RTT. */
  rttSamples?: number;
}

/**
 * `aggregate`: ΕΝΑ row ανά (location, collection, host, packet size, outcome) αντί για ένα
 * ανά packet. Το Summary δεν κοιτάζει ποτέ μεμονωμένο packet και τα raw packets ήταν 63k
 * γραμμές / ~20 MB ανά βάση (PEL_26H2) — με aggregate είναι ~300 γραμμές / 85 KB και τα
 * νούμερα βγαίνουν ΙΔΙΑ (επαληθεύτηκε πάνω σε PEL_26H2: total/success/failed/mean RTT
 * ανά operator & packet size, μηδέν αποκλίσεις). Άφησέ το false όπου χρειάζεσαι per-packet
 * ανάλυση.
 */
export async function fetchPing1000(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
  options?: RequestOptions,
  aggregate = false,
): Promise<PingRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  if (aggregate) params.append("aggregate", "1");
  const json = await requestJson<{ rows: PingRow[] }>(`/api/ping_1000?${params.toString()}`, options);
  return json.rows;
}

/**
 * Ένα raw interactivity-test row (FactInteractivity — gaming/app pattern tests) για το
 * "Interactivity" section του PS Data Stats table — βλ. /api/interactivity. Ίδιο query
 * με το A-LEVEL "INTERACTIVITY RAW.sql" reference query / το "Interactivity RAW" saved
 * query του QueryEditor (δεν φτάνει σαν δικό του TestName από το CDRCombined view του
 * /api/data_calls). `status` = "Successful"/"Failed" (ErrorCode=0 -> Successful). Το
 * frontend τα μετατρέπει σε DataCallRow σχήμα (testType="Interactivity") — βλ.
 * mapInteractivityRowsToDataCallRows στο attachmentC.ts.
 */
export interface InteractivityRow {
  location: string | null;
  sessionId: string;
  testId: number | null;
  homeOperator: string | null;
  technology: string | null;
  status: "Successful" | "Failed";
  patternName: string | null;
  connectivity: number | null;
  packetsSent: number | null;
  packetsNotSent: number | null;
  packetsLost: number | null;
  packetsLostRate: number | null;
  throughput: number | null;
  throughputKbps: number | null;
  rtt10thPercentile: number | null;
  rttAverage: number | null;
  packetDelayMedian: number | null;
  duration: number | null;
  qualityIndex: number | null;
  qoeScore: number | null;
  collectionName: string | null;
  aSideFileName: string | null;
}

export async function fetchInteractivity(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
  options?: RequestOptions,
): Promise<InteractivityRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: InteractivityRow[] }>(`/api/interactivity?${params.toString()}`, options);
  return json.rows;
}

/**
 * Ένα (location, kind, code, samples) row για τα "Serving Band (per Time)" / "Serving
 * Technology (per Time)" ποσοστά των PS Data DL tests (Capacity DL / FTP DL / HTTP
 * TRANSFER (DL)) — βλ. /api/serving_band_tech. `kind` = "BAND" (NR band, π.χ. "NR28")
 * ή "TECH" (Technology.CurrTechnology, π.χ. "LTE-5GNR"). Το backend πλέον ταιριάζει
 * 1:1 με το reference query (INNER join σε NetworkInfo/Technology) — δείγματα χωρίς
 * NetworkInfo ή προγενέστερο Technology row αποκλείονται εντελώς, δεν εμφανίζονται
 * ως "#NODATA" (βλ. σχόλιο στο backend/routers/calls.py::get_serving_band_tech).
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
  options?: RequestOptions,
): Promise<ServingBandTechRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: ServingBandTechRow[] }>(`/api/serving_band_tech?${params.toString()}`, options);
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
  /** FactInteractivity.QoEScore — μόνο για testType="Interactivity", βλ. mapInteractivityRowsToDataCallRows. */
  interactivityQoeScore: number | null;
  /** RTTMedian — μόνο για testType="Interactivity". */
  interactivityRtt: number | null;
  /** PacketsLostRate, raw fraction 0-1 (πολλαπλασιάζεται *100 στο buildDataMetrics) — μόνο για testType="Interactivity". */
  interactivityPacketsLostRate: number | null;
  /** PacketDelayVarMedian — μόνο για testType="Interactivity". */
  interactivityPacketDelay: number | null;
  technology: string | null;
  startTechnology: string | null;
  CollectionName: string | null;
  ASideFileName: string | null;
  isValid: number | null;
  comment: string | null;
  latitude: number | null;
  longitude: number | null;
  /**
   * Πόσα tests αντιπροσωπεύει αυτή η γραμμή. Λείπει/undefined = 1, δηλαδή ό,τι ίσχυε
   * πάντα για τα raw rows του /api/data_calls.
   *
   * Υπάρχει για τις ΗΔΗ-ΑΘΡΟΙΣΜΕΝΕΣ πηγές: το /api/dns γυρίζει 6 γραμμές με count, και
   * το /api/ping_1000?aggregate=1 μία γραμμή ανά (location, packet size, host, outcome).
   * Πριν, το frontend τις ΞΕΔΙΠΛΩΝΕ σε ένα fake object ανά test για να περάσουν από το
   * ίδιο pipeline — 6 γραμμές DNS γίνονταν 169.381 αντικείμενα των 24 πεδίων στο
   * PEL_26H2 και κρέμαγαν το tab. Τώρα η γραμμή μένει μία και κουβαλάει το πλήθος της.
   */
  weight?: number;
  /**
   * Πόσα από τα `weight` tests έχουν έγκυρη τιμή στη μετρική του section. Λείπει =
   * όσα και τα tests. Χρειάζεται μόνο όπου τα δύο διαφέρουν: ένα failed ping μετράει
   * κανονικά στο Total/Failed αλλά δεν έχει RTT, οπότε δεν πρέπει να μπει στο Mean RTT.
   */
  metricSamples?: number;
}

export async function fetchDataCalls(
  database: string,
  collections: string[] = [],
  locations: string[] = [],
  options?: RequestOptions,
): Promise<DataCallRow[]> {
  const params = new URLSearchParams({ database });
  for (const collection of collections) {
    if (collection) params.append("collection", collection);
  }
  for (const location of locations) {
    params.append("location", location);
  }
  const json = await requestJson<{ rows: DataCallRow[] }>(`/api/data_calls?${params.toString()}`, options);
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

export interface CellInfoAllRow {
  eNBId: number | null;
  EARFCN: number | null;
  PhyCellId: number | null;
  FirstSeen: string | null;
}

// Every distinct serving cell the call passed through (not just the first one) — used to plot
// every station the call handed over to on the map, instead of a single antenna marker.
export async function fetchCellInfoAll(
  database: string,
  session_id: string
): Promise<{ cells: CellInfoAllRow[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/cell_info_all?${params.toString()}`);
}

export async function fetchCellInfoAllBSide(
  database: string,
  session_id: string
): Promise<{ cells: CellInfoAllRow[] }> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/cell_info_all_b_side?${params.toString()}`);
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

/** Same "Scanner & Κινητό" shape as fetchCallDeviceInfo, but for a data session
 * (Sessions/FileList-backed — data tests have no CallAnalysis row). */
export async function fetchDataDeviceInfo(
  database: string,
  session_id: string
): Promise<CallDeviceInfo> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/data_device_info?${params.toString()}`);
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

// 5G NR SS-RSRP/SS-RSRQ γύρω από την κλήση (FactNR5GRadio) — το NR αντίστοιχο των
// call_context_signal / gsm_context_signal, ώστε το ενιαίο διάγραμμα να έχει σειρά και για VoNR.
export async function fetchNr5gContextSignal(
  database: string,
  session_id: string,
  window_sec = 10
): Promise<{ signal: any[] }> {
  const params = new URLSearchParams({ database, session_id, window_sec: String(window_sec) });
  return requestJson(`/api/nr5g_context_signal?${params.toString()}`);
}

export async function fetchNr5gContextSignalBSide(
  database: string,
  session_id: string,
  window_sec = 10
): Promise<{ signal: any[] }> {
  const params = new URLSearchParams({ database, session_id, window_sec: String(window_sec) });
  return requestJson(`/api/nr5g_context_signal_b_side?${params.toString()}`);
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

/**
 * CSFB (CS Fallback) — το ανάλογο του SrvccEventRow: μία γραμμή ανά πλευρά που
 * όντως έπεσε από LTE σε 2G/3G για να στηθεί η κλήση. Οι διάρκειες ανά φάση
 * έρχονται από τα "Voice(LTE CSFB)" KPIs (βλ. /api/call_csfb_detail).
 */
export interface CsfbEventRow {
  Side: "A" | "B" | string | null;
  SessionId: string | number | null;
  /** Αρχή του fallback (Extended Service Request) και τέλος της τελευταίας φάσης. */
  FallbackStart: string | null;
  FallbackEnd: string | null;
  /** Πότε έφυγε το RRCConnectionRelease με το redirect (KPI 10181). */
  RedirectTime: string | null;
  ReturnStart: string | null;
  ReturnEnd: string | null;
  RadioRedirectMs: number | null;
  RadioFallbackMs: number | null;
  TechChangeMs: number | null;
  TelephonyFallbackMs: number | null;
  CsFallbackDelayMs: number | null;
  TelephonyServiceMs: number | null;
  ReturnDelayMs: number | null;
  ErrorCode: number | null;
  ErrorMessage: string | null;
  Status: "Success" | "Fail" | "Unknown" | string;
  /** Από την αρχή του fallback μέχρι την πρώτη 2G/3G κυψέλη στο NetworkInfo. */
  RadioGapMs: number | null;
  SourceTime: string | null;
  SourceTechnology: string | null;
  SourceRFBand: string | number | null;
  SourceCGI: string | null;
  SourceCellId: string | number | null;
  SourceLAC: string | number | null;
  SourceEARFCN: string | number | null;
  SourceOperator: string | null;
  TargetTime: string | null;
  TargetTechnology: string | null;
  TargetRFBand: string | number | null;
  TargetCGI: string | null;
  TargetCellId: string | number | null;
  TargetLAC: string | number | null;
  TargetRAC: string | number | null;
  TargetBCCH: string | number | null;
  TargetBSIC: string | number | null;
  TargetOperator: string | null;
  ReturnTime: string | null;
  ReturnTechnology: string | null;
  ReturnCGI: string | null;
  SourceRadioTime: string | null;
  SourceRadioEARFCN: number | null;
  SourcePCI: number | null;
  SourceRadioCGI: string | null;
  SourceRSRP: number | null;
  SourceRSRQ: number | null;
  SourceSINR: number | null;
  TargetRadioTime: string | null;
  TargetRadioBand: string | number | null;
  TargetRadioCGI: string | null;
  TargetRxLev: number | null;
  TargetRxQual: number | null;
}

/** Μία φάση της μετάβασης — ένα KPI row, για τον πίνακα βημάτων. */
export interface CsfbStepRow {
  Side: "A" | "B" | string | null;
  SessionId: string | number | null;
  KPIId: number;
  MsgId: number | null;
  StepName: string;
  Phase: "fallback" | "return" | string;
  StartTime: string | null;
  EndTime: string | null;
  DurationMs: number | null;
  ErrorCode: number | null;
  ErrorMessage: string | null;
  Status: "Success" | "Fail" | "Unknown" | string;
}

export interface CsfbDetailResponse {
  events: CsfbEventRow[];
  steps: CsfbStepRow[];
  technology: SrvccTechnologyRow[];
}

export async function fetchCallCsfbDetail(
  database: string,
  session_id: string
): Promise<CsfbDetailResponse> {
  const params = new URLSearchParams({ database, session_id });
  return requestJson(`/api/call_csfb_detail?${params.toString()}`);
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

/**
 * Historic tab: read-only snapshot από το BI data warehouse (BI_VOICE/BI_DATA), ΕΝΑ
 * campaign (CollectionName) τη φορά — βλ. backend/routers/historic.py +
 * src/components/BI_DW_SYSTEM_PROMPT.md. Ξεχωριστό dataset από τα fetchAllCalls/
 * fetchDataCalls παραπάνω: εκεί ο χρήστης διαλέγει `database` (swissqual-srvsa, live
 * per-campaign DB)· εδώ η πηγή είναι πάντα το warehouse, οπότε τα endpoints παίρνουν
 * μόνο `collection`.
 */
export async function fetchHistoricCollections(): Promise<string[]> {
  const json = await requestJson<{ collections: string[] }>("/api/historic/collections");
  return json.collections;
}

export interface HistoricScoreRow {
  operator: string;
  totalVoice: number | null;
  totalData: number | null;
  totalScore: number | null;
  voiceScoreGsm: number | null;
  voiceScoreFree: number | null;
  scoreBrowsing: number | null;
  scoreHttp: number | null;
  scoreCap: number | null;
  scorePing: number | null;
  scoreYt: number | null;
}

export interface HistoricBestOperator {
  category: string;
  operator: string;
  score: number | null;
}

export interface HistoricScorecard {
  scores: HistoricScoreRow[];
  winners: HistoricBestOperator[];
}

export async function fetchHistoricScorecard(collection: string): Promise<HistoricScorecard> {
  const params = new URLSearchParams({ collection });
  return requestJson(`/api/historic/scorecard?${params.toString()}`);
}

export interface HistoricVoiceRow {
  operator: string;
  attempts: number;
  cssr: number | null;
  dcr: number | null;
  completionRate: number | null;
  mos: number | null;
  voltePct: number | null;
}

export async function fetchHistoricVoice(collection: string): Promise<HistoricVoiceRow[]> {
  const params = new URLSearchParams({ collection });
  const json = await requestJson<{ rows: HistoricVoiceRow[] }>(`/api/historic/voice?${params.toString()}`);
  return json.rows;
}

/**
 * GSM voice (Mobile-to-Fixed) KPIs — βλ. backend/routers/historic.py::get_historic_voice_gsm.
 * Ίδιο σχήμα με HistoricVoiceRow (FREE/M→M), χωρίς voltePct (χαρακτηριστικό μόνο του FREE
 * axis) και με avgCallSetupTime αντ' αυτού (MO_CallSetupTime — μονάδα όπως είναι αποθηκευμένη
 * στη βάση, μη επαληθευμένη).
 */
export interface HistoricVoiceGsmRow {
  operator: string;
  attempts: number;
  cssr: number | null;
  dcr: number | null;
  completionRate: number | null;
  mos: number | null;
  avgCallSetupTime: number | null;
}

export async function fetchHistoricVoiceGsm(collection: string): Promise<HistoricVoiceGsmRow[]> {
  const params = new URLSearchParams({ collection });
  const json = await requestJson<{ rows: HistoricVoiceGsmRow[] }>(`/api/historic/voice_gsm?${params.toString()}`);
  return json.rows;
}

/** YouTube/video KPIs — βλ. backend/routers/historic.py::get_historic_video. `freezingPct`
 * είναι το "test" measure (AVERAGE(Youtube[FreezingTimePerc])) του blueprint §04/§09. */
export interface HistoricVideoRow {
  operator: string;
  attempts: number;
  successRate: number | null;
  freezingPct: number | null;
  avgVmos: number | null;
}

export async function fetchHistoricVideo(collection: string): Promise<HistoricVideoRow[]> {
  const params = new URLSearchParams({ collection });
  const json = await requestJson<{ rows: HistoricVideoRow[] }>(`/api/historic/video?${params.toString()}`);
  return json.rows;
}

export interface HistoricDataRow {
  operator: string;
  avgThrpDlMbps: number | null;
  avgThrpUlMbps: number | null;
  taskSuccessRate: number | null;
  totalTests: number | null;
  avgRttMs: number | null;
  totalPingAttempts: number | null;
  successPingTests: number | null;
}

export async function fetchHistoricData(collection: string): Promise<HistoricDataRow[]> {
  const params = new URLSearchParams({ collection });
  const json = await requestJson<{ rows: HistoricDataRow[] }>(`/api/historic/data?${params.toString()}`);
  return json.rows;
}

/**
 * Χρονοσειρά ΟΛΩΝ των campaigns, μία γραμμή ανά Scope (π.χ. "2026H2") — βλ.
 * backend/routers/historic.py::get_historic_trend. Ίδιο πνεύμα με τον πίνακα
 * "Ποιότητα δεδομένων" + "Δ vs προηγούμενο scope" του §09 του blueprint: pooled
 * KPIs ανά operator πάνω σε ΟΛΑ τα collections ενός scope, plus coverage counts και
 * Δ vs το προηγούμενο scope που όντως έχει τιμή (π.χ. 2023H1 συγκρίνεται με 2022H1
 * γιατί δεν έγινε καμπάνια το 2022H2).
 */
export interface HistoricTrendOperatorRow {
  operator: string;
  totalScore: number | null;
  cssr: number | null;
  avgThrpDlMbps: number | null;
  deltaTotalScore: number | null;
  deltaCssr: number | null;
  deltaAvgThrpDlMbps: number | null;
}

export interface HistoricTrendScope {
  scope: string;
  collections: number | null;
  voiceCollections: number | null;
  capacityCollections: number | null;
  operators: HistoricTrendOperatorRow[];
}

export async function fetchHistoricTrend(): Promise<HistoricTrendScope[]> {
  const json = await requestJson<{ scopes: HistoricTrendScope[] }>("/api/historic/trend");
  return json.scopes;
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
