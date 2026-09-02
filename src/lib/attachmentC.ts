/**
 * ATTACHMENT C (A-LEVEL) — παραγωγή των KPI πινάκων ανά operator.
 *
 * Το φύλλο "ATTACHMENT C" του A-LEVEL workbook είναι πίνακες όπου οι γραμμές
 * είναι KPIs και οι στήλες οι operators (COSMOTE / VODAFONE / NOVA):
 *
 *   TABLE 20 — GSM CALL STATS
 *   TABLE 21 — FREE (2G-3G-LTE) CALL STATS
 *   TABLE 22 — PS DATA STATS
 *
 * Εδώ βγάζουμε τα ίδια νούμερα κατευθείαν από τα rows που ήδη φέρνει το API,
 * χωρίς Excel. Ο operator και το mode προκύπτουν από το ASideLocation
 * (π.χ. "Cosmote Free A", "Vodafone GSM A", "Nova Data A").
 */
import type {
  AllCallsRow,
  CapacityLinkRow,
  CellBandCountRow,
  DataCallRow,
  DnsRow,
  InteractivityRow,
  OoklaRow,
  PingRow,
  ServingBandTechRow,
  SrvccRow,
  TechnologyMixRow,
} from "@/lib/api";

/* ────────────────────────── Operators & modes ────────────────────────── */

export interface OperatorMeta {
  key: string;
  label: string;
  /** Categorical slot. Δένεται στον operator, ποτέ στη σειρά/κατάταξη. */
  color: string;
}

/**
 * Σταθερά χρώματα ανά operator, στα brand χρώματα (πράσινο / κόκκινο / μαύρο).
 * Το χρώμα ακολουθεί την οντότητα: ένα φίλτρο που κόβει operator δεν ξαναβάφει
 * τους υπόλοιπους. Το μαύρο της NOVA πατάει πάνω σε dark surface, οπότε τα
 * swatches/bars το τυπώνουν με λεπτό φωτεινό περίγραμμα για να διαβάζεται.
 */
const OPERATOR_SLOTS: { key: string; label: string; color: string; match: RegExp }[] = [
  { key: "COSMOTE", label: "COSMOTE", color: "#3ab54a", match: /cosmote/i },
  { key: "VODAFONE", label: "VODAFONE", color: "#e60000", match: /vodafone/i },
  { key: "NOVA", label: "NOVA", color: "#111318", match: /nova|wind/i },
];

/** Ό,τι δεν αναγνωρίζεται μένει ουδέτερο — δεν παράγουμε νέα hues. */
export const UNKNOWN_OPERATOR_COLOR = "#898781";

export type CallMode = "GSM" | "FREE" | "DATA" | "OTHER";

export const resolveMode = (location: string | null | undefined): CallMode => {
  const loc = (location ?? "").toLowerCase();
  if (loc.includes("gsm")) return "GSM";
  // "voice" is an alternate naming for the FREE (2G-3G-LTE) table — π.χ. "Vodafone_Voice_A".
  if (loc.includes("free") || loc.includes("voice")) return "FREE";
  if (loc.includes("data")) return "DATA";
  return "OTHER";
};

export const resolveOperator = (location: string | null | undefined): OperatorMeta => {
  const loc = location ?? "";
  const slot = OPERATOR_SLOTS.find((candidate) => candidate.match.test(loc));
  if (slot) return { key: slot.key, label: slot.label, color: slot.color };

  // Άγνωστος operator: κρατάμε το location χωρίς τις λέξεις του mode/side.
  const cleaned = loc
    .replace(/\b(free|gsm|data|voice)\b/gi, " ")
    .replace(/\b[ab]\b\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  const key = cleaned || "UNKNOWN";
  return { key, label: key, color: UNKNOWN_OPERATOR_COLOR };
};

/** Operators με σταθερή σειρά: πρώτα οι γνωστοί, μετά αλφαβητικά οι υπόλοιποι. */
export const collectOperators = (locations: (string | null | undefined)[]): OperatorMeta[] => {
  const found = new Map<string, OperatorMeta>();
  for (const location of locations) {
    const operator = resolveOperator(location);
    if (!found.has(operator.key)) found.set(operator.key, operator);
  }

  const known = OPERATOR_SLOTS.map((slot) => found.get(slot.key)).filter(
    (operator): operator is OperatorMeta => operator != null,
  );
  const knownKeys = new Set(known.map((operator) => operator.key));
  const rest = Array.from(found.values())
    .filter((operator) => !knownKeys.has(operator.key))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...known, ...rest];
};

/* ────────────────────────── Ταξινόμηση κλήσεων ────────────────────────── */

export type CallOutcome = "completed" | "sysRelease" | "dropped" | "failed";

export const classifyCallStatus = (status: string | null | undefined): CallOutcome => {
  const s = (status ?? "").toLowerCase();
  if (s.includes("system release") || s.includes("system realase")) return "sysRelease";
  if (s.includes("drop")) return "dropped";
  if (s.includes("fail")) return "failed";
  return "completed";
};

export type CustomCallModeKey = "volte" | "cs";

/**
 * VoLTE Call / CS call — ίδιο "CustomCallMode" CASE με το A-LEVEL "LQCallData.sql"
 * reference query, απλοποιημένο όπως το volteSetupTime/csSetupTime (βλ.
 * backend/routers/calls.py): εδώ είναι ένα row ανά κλήση (CallAnalysis), όχι A/B-side
 * ζευγάρι σαν CallSession.CallMode/CallModeB, οπότε αρκεί το callMode/technology της
 * γραμμής χωρίς το callDir. null όταν η κλήση δεν πληροί κανένα κριτήριο.
 */
export const classifyCustomCallMode = (
  row: Pick<AllCallsRow, "callMode" | "technology">,
): CustomCallModeKey | null => {
  const mode = (row.callMode ?? "").trim();
  const tech = (row.technology ?? "").toLowerCase();

  if (mode === "VoLTE" || mode === "SRVCC") return "volte";
  if (mode === "CSFB" || mode === "CS") return "cs";
  if (mode === "-") {
    if (tech.includes("lte")) return "volte";
    if (tech.includes("umts") || tech.includes("gsm")) return "cs";
    return null;
  }
  if (mode.toLowerCase().includes("unknown") && tech.includes("5g")) return "volte";
  return null;
};

export type DataTestOutcome = "success" | "failed" | "other";

export const classifyDataTest = (row: DataCallRow): DataTestOutcome => {
  const s = (row.scoringStatus ?? row.status ?? "").toLowerCase();
  if (s.includes("fail") || s === "f") return "failed";
  if (s === "a" || s.includes("success") || s.includes("complet")) return "success";
  return "other";
};

/* ────────────────────────── Μικρά helpers ────────────────────────── */

export interface Sample {
  avg: number | null;
  samples: number;
  min: number | null;
  max: number | null;
}

const EMPTY_SAMPLE: Sample = { avg: null, samples: 0, min: null, max: null };

const mean = (values: number[]): Sample =>
  values.length === 0
    ? EMPTY_SAMPLE
    : {
        avg: values.reduce((sum, v) => sum + v, 0) / values.length,
        samples: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
      };

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

const numeric = (value: number | null | undefined): number | null =>
  value == null || Number.isNaN(Number(value)) ? null : Number(value);

/**
 * Συνδυάζει per-session αθροίσματα (avg/min/max/count ήδη υπολογισμένα στο backend
 * πάνω σε raw ResultsLQ08Avg δείγματα) σε ένα group-level Sample. Η στάθμιση με το
 * count κάθε session κρατάει το avg σωστό ακόμα κι όταν οι κλήσεις έχουν διαφορετικό
 * πλήθος δειγμάτων (π.χ. μια κλήση με 4 samples δεν μετράει όσο μια με 1).
 */
interface WeightedAgg {
  sum: number;
  count: number;
  min: number | null;
  max: number | null;
}

const emptyAgg = (): WeightedAgg => ({ sum: 0, count: 0, min: null, max: null });

const addToAgg = (
  agg: WeightedAgg,
  avg: number | null,
  count: number | null,
  min: number | null,
  max: number | null,
): void => {
  if (avg != null && count != null && count > 0) {
    agg.sum += avg * count;
    agg.count += count;
  }
  if (min != null) agg.min = agg.min == null ? min : Math.min(agg.min, min);
  if (max != null) agg.max = agg.max == null ? max : Math.max(agg.max, max);
};

const aggToSample = (agg: WeightedAgg): Sample =>
  agg.count > 0 ? { avg: agg.sum / agg.count, samples: agg.count, min: agg.min, max: agg.max } : EMPTY_SAMPLE;

/* ────────────────────────── TABLE 20 / 21 — Voice ────────────────────────── */

/**
 * Οι βάσεις και τα rates ενός σεναρίου υπολογισμού. Το VoiceStats ικανοποιεί
 * το ίδιο σχήμα, οπότε "με" και "χωρίς" system releases διαβάζονται ίδια.
 */
export interface VoiceRates {
  /** Βάση των CSR / AFR */
  attempts: number;
  /** Βάση του DCR */
  connections: number;
  csr: number | null;
  dcr: number | null;
  afr: number | null;
}

export interface VoiceStats {
  /** Total Nbr. of Call Attempts */
  attempts: number;
  /** Total Nbr. of Normal Releases */
  completed: number;
  dropped: number;
  /** Unsuccessful Call Attempts (access failures) */
  failed: number;
  sysRelease: number;
  /**
   * Attempts/Dropped/Unsuccessful σπασμένα σε VoLTE Call / CS call (classifyCustomCallMode)
   * — ίδιο σχήμα με το LQCallExtend_1PT pivot του Summary Voice (A-LEVEL "LQCallData.sql"
   * reference query's CustomCallMode). Ουσιαστικό μόνο στο FREE table — βλ. SummaryTab.
   */
  volte: CustomCallModeCounts;
  cs: CustomCallModeCounts;
  /** Total Calls = attempts − unsuccessful attempts */
  connections: number;
  /** Call Success Rate = normal releases / attempts */
  csr: number | null;
  /** Dropped Call Rate = dropped / connections */
  dcr: number | null;
  /** Access Failure Rate = unsuccessful / attempts */
  afr: number | null;
  /** System Release Rate = system releases / connections */
  srr: number | null;
  /**
   * Τα ίδια rates με τα system releases εντελώς έξω από τη βάση: οι κλήσεις που
   * έκλεισε το σύστημα δεν χρεώνονται ούτε ως επιτυχία ούτε ως αποτυχία.
   */
  withoutSysRelease: VoiceRates;
  mos: Sample;
  /**
   * Raw ResultsLQ08Avg δείγματα (OptionalWB σε [1,5], TestInfo.Valid=1) με
   * TestInfo.direction = A→B — μετράει ως "UL". Πολλά δείγματα ανά κλήση,
   * όχι ένα ήδη-μέσο-όρο νούμερο ανά session.
   */
  mosUl: Sample;
  /** Ίδιο με το mosUl, για TestInfo.direction = B→A — μετράει ως "DL". */
  mosDl: Sample;
  /** Low Speech Quality Calls (POLQA < 2.2) */
  lowQualityCalls: number;
  /** Low Speech Quality Calls (POLQA < 1.3) */
  badQualityCalls: number;
  setupAll: Sample;
  /**
   * MOC = A→B (mobile originated) — ίδιο κριτήριο με το A-LEVEL "LQCallDataGSM.sql"
   * reference query's MOCSetupTime (Callstatus in Completed/Dropped, Technology σε
   * UMTS 2100/900 GSM 900/1800· βλ. AllCallsRow.mocSetupTime / calls.py).
   */
  setupMoc: Sample;
  /** MTC = B→A (mobile terminated) — ίδιο κριτήριο, βλ. setupMoc. */
  setupMtc: Sample;
  /**
   * VoLTE Call setup time — ίδιο κριτήριο με το A-LEVEL "LQCallData.sql" reference
   * query's CallSetupTimeVoLTE (Callstatus in Completed/Dropped, callMode σε
   * VoLTE/SRVCC· βλ. AllCallsRow.volteSetupTime / calls.py).
   */
  volteSetup: Sample;
  /** CS Call setup time — ίδιο κριτήριο, βλ. volteSetup (callMode σε CSFB/CS). */
  csSetup: Sample;
  /**
   * Πλήθος ΔΙΑΚΡΙΤΩΝ GSM 900/1800 band cells — μόνο για το GSM table (buildVoiceTable
   * περνάει cellBandCountRows μόνο εκεί)· null στο FREE table ή όταν δεν έχουν φτάσει
   * ακόμα τα δεδομένα του /api/cell_band_count. Ίδιο query/μεθοδολογία με το A-LEVEL
   * "CELL ID GSM.sql" reference query — βλ. buildCellBandCountTable.
   */
  cellCount900: number | null;
  cellCount1800: number | null;
  /**
   * "Total/Successful/Failed SRVCC attempts" — 3 γραμμές στο τέλος ΜΟΝΟ του FREE table
   * (buildVoiceTable περνάει srvccRows μόνο εκεί, ίδιο σχήμα με cellCount900/1800 στο
   * GSM table)· null όταν δεν έχουν φτάσει ακόμα τα δεδομένα του /api/srvcc. Ίδιο
   * query/μεθοδολογία με το A-LEVEL "SRVCC RAW.sql" reference query — βλ. buildSrvccTable.
   */
  srvcc: SrvccStats | null;
  /**
   * "Fake Event(s)" — πλήθος sessions με isValid=0 (Sessions.valid='0'), δηλ. σημαδεμένα
   * ψεύτικα/άκυρα (comment "fake..." — βλ. update_call_comment στο backend/routers/calls.py
   * και το "FAKE EVENT LIST" reference query). Υπολογίζεται πάνω στις ΑΝΕΠΕΞΕΡΓΑΣΤΕΣ γραμμές
   * (πριν το "Valid calls only" toggle του SummaryTab πετάξει έξω τα isValid=0) — βλ.
   * buildFakeEventTable· έτσι η γραμμή δείχνει τα fake events ΑΚΟΜΑ κι όταν το toggle τα
   * κρύβει από τα υπόλοιπα στατιστικά. Σε αντίθεση με cellCount900/1800 (μόνο GSM) και
   * srvcc (μόνο FREE), αυτό μπαίνει ΚΑΙ στα δύο tables. null όταν δεν έχουν περάσει ακόμα
   * fakeEventRows στο buildVoiceTable.
   */
  fakeEvents: number | null;
  duration: Sample;
  /**
   * Ανά-band breakdown από το χοντρικό CA.technology (π.χ. "LTE", "GSM/LTE") — βλ.
   * buildDetailedTechnologyMix. Fallback μόνο: το SummaryTab προτιμά το πραγματικό
   * per-sample mix του /api/technology_mix (βλ. buildTechnologyMixTable) όταν
   * υπάρχει, γιατί αυτό εδώ δεν ξεχωρίζει π.χ. GSM 900 από GSM 1800.
   */
  technologyMix: TechnologyShare[];
  /** Bucketed codec breakdown — βλ. buildCodecMix / CallCodecTypeUsageGSM.sql. Table 20's "Codec Type Usage %". */
  codecMix: CodecShare[];
}

/** Πλήθος-0 δομή, ξαναχρησιμοποιείται σαν immutable "κενό" σε EMPTY_VOICE_STATS. */
export interface CustomCallModeCounts {
  attempts: number;
  dropped: number;
  failed: number;
}

const EMPTY_CUSTOM_CALL_MODE_COUNTS: CustomCallModeCounts = { attempts: 0, dropped: 0, failed: 0 };

export const EMPTY_VOICE_STATS: VoiceStats = {
  attempts: 0,
  completed: 0,
  dropped: 0,
  failed: 0,
  sysRelease: 0,
  volte: EMPTY_CUSTOM_CALL_MODE_COUNTS,
  cs: EMPTY_CUSTOM_CALL_MODE_COUNTS,
  connections: 0,
  csr: null,
  dcr: null,
  afr: null,
  srr: null,
  withoutSysRelease: { attempts: 0, connections: 0, csr: null, dcr: null, afr: null },
  mos: EMPTY_SAMPLE,
  mosUl: EMPTY_SAMPLE,
  mosDl: EMPTY_SAMPLE,
  lowQualityCalls: 0,
  badQualityCalls: 0,
  setupAll: EMPTY_SAMPLE,
  setupMoc: EMPTY_SAMPLE,
  setupMtc: EMPTY_SAMPLE,
  volteSetup: EMPTY_SAMPLE,
  csSetup: EMPTY_SAMPLE,
  cellCount900: null,
  cellCount1800: null,
  srvcc: null,
  fakeEvents: null,
  duration: EMPTY_SAMPLE,
  technologyMix: [],
  codecMix: [],
};

/* ────────────────────────── Codec mix ────────────────────────── */

/** Σταθερά χρώματα για τα γνωστά codec buckets· ό,τι άλλο παίρνει χρώμα από FALLBACK_CODEC_COLORS. */
const CODEC_BUCKET_COLORS: Record<string, string> = {
  "FR AMR WB": "#2f8f6e",
  "AMR HR": "#d99a2b",
  AMR: "#3568c9",
  EFR: "#8a4fd1",
  FR: "#4f6fd1",
  HR: "#c15fa0",
  "no codec rate": UNKNOWN_OPERATOR_COLOR,
};

const FALLBACK_CODEC_COLORS = ["#767a8a", "#9a8f6a", "#6a9a8f", "#9a6a8f", "#8f9a6a"];

/** Σειρά εμφάνισης των γνωστών buckets· ό,τι δεν αναγνωρίζεται πάει αλφαβητικά στο τέλος. */
const CODEC_BUCKET_ORDER = ["FR AMR WB", "AMR HR", "AMR", "EFR", "FR", "HR", "no codec rate"];

export interface CodecShare {
  bucket: string;
  color: string;
  count: number;
  share: number;
}

/**
 * Ποιο πεδίο του AllCallsRow τροφοδοτεί κάθε bucket — τα counts έρχονται ήδη
 * bucketed από το backend (CODEC OUTER APPLY στο calls.py), με το ίδιο CASE
 * που έχει το A-LEVEL "CallCodecTypeUsageGSM.sql" reference query.
 */
const CODEC_COUNT_FIELDS: { bucket: string; field: keyof AllCallsRow }[] = [
  { bucket: "FR AMR WB", field: "codecFrAmrWbCount" },
  { bucket: "AMR HR", field: "codecAmrHrCount" },
  { bucket: "AMR", field: "codecAmrCount" },
  { bucket: "EFR", field: "codecEfrCount" },
  { bucket: "FR", field: "codecFrCount" },
  { bucket: "HR", field: "codecHrCount" },
  { bucket: "other", field: "codecOtherCount" },
  { bucket: "no codec rate", field: "codecNoRateCount" },
];

/**
 * Αθροίζει τα per-session codec-bucket test counts (βλ. CODEC_COUNT_FIELDS)
 * σε ένα mix ανά bucket — ίδιο κριτήριο/βάρος με το "Codec Type Usage %" του
 * A-LEVEL CallCodecTypeUsageGSM.sql query: το % κάθε bucket είναι το μερίδιό
 * του στο σύνολο των tests, όχι το ποσοστό των sessions με αυτόν ως "dominant".
 */
export const buildCodecMix = (rows: AllCallsRow[]): CodecShare[] => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const { bucket, field } of CODEC_COUNT_FIELDS) {
      const n = numeric(row[field] as number | null | undefined);
      if (!n) continue;
      counts.set(bucket, (counts.get(bucket) ?? 0) + n);
    }
  }

  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  const known = CODEC_BUCKET_ORDER.filter((bucket) => counts.has(bucket));
  const rest = Array.from(counts.keys())
    .filter((bucket) => !CODEC_BUCKET_ORDER.includes(bucket))
    .sort((a, b) => a.localeCompare(b));

  return [...known, ...rest].map((bucket, index) => {
    const count = counts.get(bucket) ?? 0;
    return {
      bucket,
      color: CODEC_BUCKET_COLORS[bucket] ?? FALLBACK_CODEC_COLORS[index % FALLBACK_CODEC_COLORS.length],
      count,
      share: total > 0 ? count / total : 0,
    };
  });
};

/** POLQA thresholds — ίδια με το Attachment C. */
export const LOW_QUALITY_MOS = 2.2;
export const BAD_QUALITY_MOS = 1.3;
/** Ποσοστό-δειγμάτων threshold του "BadCall" κριτηρίου — βλ. σχόλιο στο buildVoiceStats. */
export const BAD_CALL_SAMPLE_PCT = 15;

export const buildVoiceStats = (rows: AllCallsRow[]): VoiceStats => {
  const counts = { completed: 0, sysRelease: 0, dropped: 0, failed: 0 };
  const customCounts: Record<CustomCallModeKey, CustomCallModeCounts> = {
    volte: { attempts: 0, dropped: 0, failed: 0 },
    cs: { attempts: 0, dropped: 0, failed: 0 },
  };
  const mosValues: number[] = [];
  const mosUlAgg = emptyAgg();
  const mosDlAgg = emptyAgg();
  const setupAll: number[] = [];
  const setupMoc: number[] = [];
  const setupMtc: number[] = [];
  const volteSetup: number[] = [];
  const csSetup: number[] = [];
  const durations: number[] = [];
  const technologyNames: (string | null | undefined)[] = [];
  let lowQualityCalls = 0;
  let badQualityCalls = 0;

  for (const row of rows) {
    const outcome = classifyCallStatus(row.status);
    counts[outcome]++;

    // CustomCallMode (VoLTE Call / CS call) — βλ. LQCallExtend_1PT στο VoiceStats.
    // CallAttemps/CallDropped/CallFailed του A-LEVEL "LQCallData.sql" reference query,
    // απλά σπασμένα ανά mode αντί για ανά operator.
    const customMode = classifyCustomCallMode(row);
    if (customMode) {
      if (outcome === "completed" || outcome === "dropped" || outcome === "failed") {
        customCounts[customMode].attempts++;
      }
      if (outcome === "dropped") customCounts[customMode].dropped++;
      else if (outcome === "failed") customCounts[customMode].failed++;
    }

    const mos = numeric(row.Avg_mos);
    if (mos != null && mos > 0) {
      mosValues.push(mos);
      // "Low Speech Quality Calls" (< 2.2): προτιμάμε το per-sample "BadCall" που φέρνει
      // το backend (>15% κακά/silence δείγματα ανά session, ίδιο με το A-LEVEL
      // LQStatisticData.sql reference query) — ακριβέστερο από το να συγκρίνεις απλά τον
      // ήδη-μέσο-όρο Avg_mos με το threshold. Fallback στο avg-based κριτήριο μόνο όταν
      // το backend δεν στέλνει καθόλου badCall (π.χ. παλιότερο API response).
      if (row.badCall === 1 || row.badCall === 0) {
        if (row.badCall === 1) lowQualityCalls++;
      } else if (mos < LOW_QUALITY_MOS) {
        lowQualityCalls++;
      }
    }

    // "Low Speech Quality Calls" (< 1.3): προτιμάμε το backend "BadQualityCall" (ίδιο
    // κριτήριο με το A-LEVEL "LOW MOS 1_3.sql" reference query — 2 από 3 διαδοχικά
    // δείγματα κάτω από 1.3/silence σε Completed κλήση), ανεξάρτητο από τον μέσο MOS.
    // Fallback στο avg-based κριτήριο μόνο όταν λείπει το πεδίο.
    if (row.badQualityCall === 1 || row.badQualityCall === 0) {
      if (row.badQualityCall === 1) badQualityCalls++;
    } else if (mos != null && mos > 0 && mos < BAD_QUALITY_MOS) {
      badQualityCalls++;
    }

    // Raw per-session UL/DL δείγματα από το backend (TestInfo.direction) — βλ. σχόλιο στο VoiceStats.
    addToAgg(mosUlAgg, numeric(row.mosUlAvg), numeric(row.mosUlSamples), numeric(row.mosUlMin), numeric(row.mosUlMax));
    addToAgg(mosDlAgg, numeric(row.mosDlAvg), numeric(row.mosDlSamples), numeric(row.mosDlMin), numeric(row.mosDlMax));

    const setup = numeric(row.setupTime);
    if (setup != null && setup > 0) setupAll.push(setup);

    // MOC/MTC setup time: ήδη φιλτραρισμένα/χωρισμένα από το backend (Callstatus
    // Completed/Dropped, Technology σε UMTS 2100/900 GSM 900/1800 — ίδιο κριτήριο με
    // το A-LEVEL "LQCallDataGSM.sql" reference query, βλ. VoiceStats.setupMoc/setupMtc).
    const moc = numeric(row.mocSetupTime);
    if (moc != null && moc > 0) setupMoc.push(moc);

    const mtc = numeric(row.mtcSetupTime);
    if (mtc != null && mtc > 0) setupMtc.push(mtc);

    // VoLTE/CS Call setup time: ήδη φιλτραρισμένα/χωρισμένα από το backend (Callstatus
    // Completed/Dropped, callMode σε VoLTE/SRVCC ή CSFB/CS — ίδιο κριτήριο με το
    // A-LEVEL "LQCallData.sql" reference query, βλ. VoiceStats.volteSetup/csSetup).
    const volte = numeric(row.volteSetupTime);
    if (volte != null && volte > 0) volteSetup.push(volte);

    const cs = numeric(row.csSetupTime);
    if (cs != null && cs > 0) csSetup.push(cs);

    const duration = numeric(row.callDuration);
    if (duration != null && duration > 0) durations.push(duration);

    technologyNames.push(row.technology);
  }

  const attempts = rows.length;
  const connections = attempts - counts.failed;

  // "Avoid system release": οι system releases φεύγουν και από τον αριθμητή
  // (δεν είναι normal release ούτε drop) και από τις βάσεις.
  const attemptsExcl = attempts - counts.sysRelease;
  const connectionsExcl = attemptsExcl - counts.failed;

  return {
    attempts,
    completed: counts.completed,
    dropped: counts.dropped,
    failed: counts.failed,
    sysRelease: counts.sysRelease,
    volte: customCounts.volte,
    cs: customCounts.cs,
    connections,
    csr: ratio(counts.completed, attempts),
    dcr: ratio(counts.dropped, connections),
    afr: ratio(counts.failed, attempts),
    srr: ratio(counts.sysRelease, connections),
    withoutSysRelease: {
      attempts: attemptsExcl,
      connections: connectionsExcl,
      csr: ratio(counts.completed, attemptsExcl),
      dcr: ratio(counts.dropped, connectionsExcl),
      afr: ratio(counts.failed, attemptsExcl),
    },
    mos: mean(mosValues),
    mosUl: aggToSample(mosUlAgg),
    mosDl: aggToSample(mosDlAgg),
    lowQualityCalls,
    badQualityCalls,
    setupAll: mean(setupAll),
    setupMoc: mean(setupMoc),
    setupMtc: mean(setupMtc),
    volteSetup: mean(volteSetup),
    csSetup: mean(csSetup),
    // buildVoiceTable τα γεμίζει μετά (μόνο για το GSM table) — βλ. σχόλιο στο VoiceStats.
    cellCount900: null,
    cellCount1800: null,
    // buildVoiceTable το γεμίζει μετά (μόνο για το FREE table) — βλ. σχόλιο στο VoiceStats.
    srvcc: null,
    // buildVoiceTable το γεμίζει μετά (ΚΑΙ GSM ΚΑΙ FREE) — βλ. σχόλιο στο VoiceStats.
    fakeEvents: null,
    duration: mean(durations),
    technologyMix: buildDetailedTechnologyMix(technologyNames),
    codecMix: buildCodecMix(rows),
  };
};

interface CellBandCounts {
  band900: number;
  band1800: number;
}

const EMPTY_CELL_BAND_COUNTS: CellBandCounts = { band900: 0, band1800: 0 };

/**
 * Πλήθος ΔΙΑΚΡΙΤΩΝ GSM 900/1800 band cells ανά operator, από τα (location, technology,
 * cellCount) rows του /api/cell_band_count — ίδιο query/μεθοδολογία με το A-LEVEL
 * "CELL ID GSM.sql" reference query. Total = άθροισμα των per-operator counts (ασφαλές
 * εδώ: το CID είναι μοναδικό μόνο μέσα στο δίκτυο ενός operator, όχι global, οπότε ένα
 * "φρέσκο" COUNT(DISTINCT CID) σε όλα τα operators μαζί θα συγχώνευε λάθος διαφορετικά
 * cells με τυχαία ίδιο αριθμό CID).
 */
export const buildCellBandCountTable = (
  rows: CellBandCountRow[],
): { byOperator: Map<string, CellBandCounts>; total: CellBandCounts } => {
  const byOperator = new Map<string, CellBandCounts>();
  const total: CellBandCounts = { band900: 0, band1800: 0 };

  for (const row of rows) {
    if (resolveMode(row.location) !== "GSM") continue;
    const technology = (row.technology ?? "").trim();
    if (technology !== "GSM 900" && technology !== "GSM 1800") continue;

    const key = resolveOperator(row.location).key;
    const current = byOperator.get(key) ?? { band900: 0, band1800: 0 };
    if (technology === "GSM 900") {
      current.band900 += row.cellCount;
      total.band900 += row.cellCount;
    } else {
      current.band1800 += row.cellCount;
      total.band1800 += row.cellCount;
    }
    byOperator.set(key, current);
  }

  return { byOperator, total };
};

export interface SrvccStats {
  /** COUNT όλων των distinct (session, ErrorCode) HO events — success + fail + other. */
  attempts: number;
  successful: number;
  /** Μόνο ErrorCode=108003 — άλλα ErrorCode που δεν είναι 0 μπαίνουν στο attempts αλλά όχι εδώ. */
  failed: number;
}

const EMPTY_SRVCC_STATS: SrvccStats = { attempts: 0, successful: 0, failed: 0 };

/**
 * "Total/Successful/Failed SRVCC attempts" ανά operator, από τα ήδη-αθροισμένα
 * (location, status, count) rows του /api/srvcc — ίδιο σχήμα με buildCellBandCountTable.
 */
export const buildSrvccTable = (rows: SrvccRow[]): { byOperator: Map<string, SrvccStats>; total: SrvccStats } => {
  const byOperator = new Map<string, SrvccStats>();
  const total: SrvccStats = { attempts: 0, successful: 0, failed: 0 };

  for (const row of rows) {
    if (!(row.count > 0)) continue;

    const key = resolveOperator(row.location).key;
    const current = byOperator.get(key) ?? { attempts: 0, successful: 0, failed: 0 };

    current.attempts += row.count;
    total.attempts += row.count;
    if (row.status === "success") {
      current.successful += row.count;
      total.successful += row.count;
    } else if (row.status === "fail") {
      current.failed += row.count;
      total.failed += row.count;
    }
    byOperator.set(key, current);
  }

  return { byOperator, total };
};

/**
 * "Fake Event(s)" ανά operator — πλήθος AllCallsRow με isValid=0 ΚΑΙ σχόλιο που αρχίζει
 * από "fake" (case-insensitive), σκοπισμένο στο ίδιο mode (GSM ή FREE) βάσει ASideLocation,
 * ίδιο pattern με resolveMode/resolveOperator παντού αλλού εδώ.
 *
 * ΓΙΑΤΙ όχι απλά isValid=0, ΟΥΤΕ isValid=0 + "έχει οποιοδήποτε σχόλιο" (2026-09-02,
 * real-data check: 191 "fake" σε βάση με ΜΟΝΟ 1 πραγματικό fake session): Sessions.Valid=0
 * από μόνο του ΔΕΝ σημαίνει "μαρκαρίστηκε fake εδώ" — πολλά sessions μπαίνουν Valid=0 από
 * το ίδιο το import/collection pipeline (π.χ. αποτυχημένη λήψη, calibration run) πολύ πριν
 * αγγίξει κανείς το comment box σε αυτή την εφαρμογή, και ένα session μπορεί να έχει ΟΠΟΙΟ-
 * ΔΗΠΟΤΕ άσχετο σχόλιο (π.χ. "route ok") χωρίς να είναι fake. Το ΜΟΝΟ σημείο που η ίδια η
 * εφαρμογή αποφασίζει "αυτό είναι fake" είναι το update_call_comment στο
 * backend/routers/calls.py: SET Valid=0 ΜΟΝΟ όταν το σχόλιο αρχίζει από "fake"/"FAKE"
 * (comment.lower().startswith("fake")) — ό,τι δεν αρχίζει έτσι παίρνει Valid=1. Άρα το
 * σωστό κριτήριο ξαναδιαβάζει το ΙΔΙΟ startswith πάνω στο τρέχον comment (ήδη
 * COALESCE(DWC.Comment, S.InvalidReason), βλ. AllCallsRow.comment / /api/calls στο
 * backend) — όχι μόνο "υπάρχει κάποιο σχόλιο".
 */
export const buildFakeEventTable = (
  rows: AllCallsRow[],
  mode: CallMode,
): { byOperator: Map<string, number>; total: number } => {
  const byOperator = new Map<string, number>();
  let total = 0;

  for (const row of rows) {
    if (resolveMode(row.Location) !== mode) continue;
    if (row.isValid !== 0) continue;
    if (!row.comment?.toLowerCase().startsWith("fake")) continue;

    const key = resolveOperator(row.Location).key;
    byOperator.set(key, (byOperator.get(key) ?? 0) + 1);
    total++;
  }

  return { byOperator, total };
};

export interface VoiceTable {
  mode: CallMode;
  byOperator: Map<string, VoiceStats>;
  total: VoiceStats;
}

/**
 * `cellBandCountRows` (βλ. buildCellBandCountTable) εφαρμόζεται μόνο όταν mode="GSM" —
 * το "Number of 900/1800 band Cells" δεν βγάζει νόημα στο FREE table. `srvccRows` (βλ.
 * buildSrvccTable) εφαρμόζεται μόνο όταν mode="FREE" — το αντίστροφο. `fakeEventRows`
 * (βλ. buildFakeEventTable) εφαρμόζεται ΚΑΙ στα δύο — προτίμησε να περάσεις εδώ τις
 * ΑΝΕΠΕΞΕΡΓΑΣΤΕΣ AllCallsRow γραμμές (πριν το "Valid calls only" filter), όχι το ίδιο
 * `rows`, αλλιώς τα isValid=0 events λείπουν ήδη πριν φτάσουν εδώ.
 */
export const buildVoiceTable = (
  rows: AllCallsRow[],
  mode: CallMode,
  cellBandCountRows: CellBandCountRow[] = [],
  srvccRows: SrvccRow[] = [],
  fakeEventRows: AllCallsRow[] = [],
): VoiceTable => {
  const scoped = rows.filter((row) => resolveMode(row.Location) === mode);
  const grouped = new Map<string, AllCallsRow[]>();

  for (const row of scoped) {
    const key = resolveOperator(row.Location).key;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const applyCellCounts = mode === "GSM" && cellBandCountRows.length > 0;
  const cellBandCounts = applyCellCounts ? buildCellBandCountTable(cellBandCountRows) : null;

  const applySrvcc = mode === "FREE" && srvccRows.length > 0;
  const srvccTable = applySrvcc ? buildSrvccTable(srvccRows) : null;

  const applyFakeEvents = fakeEventRows.length > 0;
  const fakeEventTable = applyFakeEvents ? buildFakeEventTable(fakeEventRows, mode) : null;

  const byOperator = new Map<string, VoiceStats>();
  for (const [key, operatorRows] of grouped) {
    const stats = buildVoiceStats(operatorRows);
    if (cellBandCounts) {
      const counts = cellBandCounts.byOperator.get(key) ?? EMPTY_CELL_BAND_COUNTS;
      stats.cellCount900 = counts.band900;
      stats.cellCount1800 = counts.band1800;
    }
    if (srvccTable) {
      stats.srvcc = srvccTable.byOperator.get(key) ?? EMPTY_SRVCC_STATS;
    }
    if (fakeEventTable) {
      stats.fakeEvents = fakeEventTable.byOperator.get(key) ?? 0;
    }
    byOperator.set(key, stats);
  }

  const total = buildVoiceStats(scoped);
  if (cellBandCounts) {
    total.cellCount900 = cellBandCounts.total.band900;
    total.cellCount1800 = cellBandCounts.total.band1800;
  }
  if (srvccTable) {
    total.srvcc = srvccTable.total;
  }
  if (fakeEventTable) {
    total.fakeEvents = fakeEventTable.total;
  }

  return { mode, byOperator, total };
};

/* ────────────────────────── TABLE 22 — PS Data ────────────────────────── */

export interface DataMetric {
  label: string;
  unit: string;
  decimals: number;
  higherIsBetter: boolean;
  value: number | null;
  samples: number;
}

export interface DataTestStats {
  total: number;
  success: number;
  failed: number;
  successRate: number | null;
  metrics: DataMetric[];
}

export interface DataTestSection {
  key: string;
  label: string;
  /** "Ε1 · Bulk throughput" κ.λπ. — βλ. SECTION_GROUP_LABELS/sectionGroupOf. "" όταν unmatched. */
  group: string;
  byOperator: Map<string, DataTestStats>;
  total: DataTestStats;
}

const DIRECTION_LABELS: Record<string, string> = { dl: "DL", ul: "UL", downlink: "DL", uplink: "UL" };

/**
 * "Capacity" + "DL" → "Capacity DL", όπως τα section headers του Attachment C.
 *
 * Δύο ειδικές περιπτώσεις πάνω στο ίδιο βασικό label:
 * - Μερικά testType ήδη έχουν το direction μέσα τους (π.χ. "CAPACITY DL (Test Data
 *   Server) 10GB.bin" ή ένα απλό "Capacity DL") — τότε δεν το ξανακολλάμε στο τέλος,
 *   αλλιώς βγαίνει διπλό ("Capacity DL DL").
 * - Ένα ΓΥΜΝΟ "Capacity DL"/"Capacity UL" (χωρίς ήδη ενσωματωμένο μέγεθος payload,
 *   π.χ. το "(Test Data Server) 10GB.bin" παραπάνω) εμφανίζεται με το σταθερό μέγεθος
 *   payload του Attachment C για την αντίστοιχη κατεύθυνση — "Capacity DL 10GB",
 *   "Capacity UL 1GB" (ασύμμετρο: το DL κατεβάζει πολύ μεγαλύτερο αρχείο απ' ό,τι
 *   ανεβάζει το UL) — απλά αυτό το testType δεν το γράφει.
 */
const BARE_CAPACITY_PAYLOAD: Record<string, string> = { dl: "10GB", ul: "1GB" };

/**
 * Το "HTTPS Browser (site)" και τα "YouTube Service*" tests δεν κολλάνε "DL" στο section
 * header — τρέχουν μόνο downlink, οπότε το "DL" είναι απλά θόρυβος στο Attachment C
 * (αντίθετα με τα άλλα tests που έχουν ξεχωριστό DL/UL section, βλ. sectionLabel).
 */
const NO_DL_SUFFIX_TESTS = /https?\s*browser|^youtube service/i;

/**
 * Μετονομασίες συγκεκριμένων section labels στο PS Data Stats — το raw testType/direction
 * δεν δείχνει το σταθερό μέγεθος payload του Attachment C (ίδιο σκεπτικό με το
 * BARE_CAPACITY_PAYLOAD παραπάνω, εδώ όμως πάνω σε ολόκληρο το label).
 */
const SECTION_LABEL_RENAMES: Record<string, string> = {
  "HTTP Transfer (DL)": "HTTP Transfer (DL) 10MB",
  "HTTP UL": "HTTP Transfer (UL) 5MB",
  // Capacity ανά Link (grx/akamai) — βλ. mapCapacityLinkRowsToDataCallRows. ΕΠΙΠΛΕΟΝ
  // sections δίπλα στα κύρια "Capacity DL 10GB"/"Capacity UL 1GB" (CDRCombined), μόνο
  // στο Full mode (βλ. COMPACT_EXCLUDED_SECTION_LABELS στο SummaryTab.tsx).
  "Capacity grx DL": "Capacity DL 10GB (grx)",
  "Capacity grx UL": "Capacity UL 1GB (grx)",
  "Capacity akamai DL": "Capacity DL 10GB (akamai)",
  "Capacity akamai UL": "Capacity UL 1GB (akamai)",
  // "ICMP Ping 40"/"ICMP Ping 800": παλιό CDRCombined TestName, ΔΕΝ φτάνει πια στο summary
  // pipeline (βλ. excludeCdrPingDuplicates) — μένει εδώ μόνο για ό,τι άλλο διαβάζει raw
  // /api/data_calls rows χωρίς να περνάει από το dedup. "Ping 40"/"Ping 800": το ΝΕΟ raw
  // ResultsPingTest testType (βλ. mapPing1000RowsToDataCallRows) — ίδιο "B" section label
  // και για τα δύο, ώστε το PING_B_ORDER να τα βλέπει ίδια ανεξαρτήτως πηγής.
  "ICMP Ping 40": "Ping 40 B",
  "ICMP Ping 800": "Ping 800 B",
  "Ping 40": "Ping 40 B",
  "Ping 800": "Ping 800 B",
  "Ping 1000": "Ping 1000 B",
  // "5 group, QoS → QoE" πρόταση του πελάτη (2026-08-26) — πιο περιγραφικά display labels.
  DNS: "DNS Resolution",
  Interactivity: "Interactivity (eGaming)",
  "YouTube Service_4K": "YouTube Service 4K",
  "YouTube Service_Live": "YouTube Service Live",
};

const sectionLabel = (row: DataCallRow): string => {
  const test = (row.testType ?? "Unknown test").trim();
  const raw = (row.direction ?? "").trim().toLowerCase();
  const direction = DIRECTION_LABELS[raw] ?? (raw ? raw.toUpperCase() : "");
  const alreadyHasDirection = direction ? new RegExp(`\\b${direction}\\b`, "i").test(test) : false;
  const skipDlSuffix = direction === "DL" && NO_DL_SUFFIX_TESTS.test(test);
  const base = skipDlSuffix
    ? test.replace(/\s*\bDL\b\s*$/i, "").trim()
    : direction && !alreadyHasDirection
      ? `${test} ${direction}`
      : test;

  const bareCapacityMatch = /^capacity (dl|ul)$/i.exec(base);
  if (bareCapacityMatch) return `${base} ${BARE_CAPACITY_PAYLOAD[bareCapacityMatch[1].toLowerCase()]}`;
  // "Kepler 2" (αρχική υπόθεση) -> friendly display name — δες KEPLER_PAUSE_RE. Ανεκτικό
  // και σε "HTTP Browser (Kepler 2)" τυλιγμένο (βλ. parenOrWhole), ΚΑΙ σε "Kepler_2"
  // (underscore αντί για κενό — πραγματικό raw TestName format, 2026-08-31: "HTTP
  // Browser (Kepler_2)" δεν αναγνωριζόταν καθόλου γιατί το \s* δεν πιάνει "_"). Αν το raw
  // name λέει ήδη "pause" δεν ξαναπειράζεται (δεν ταιριάζει με αυτό το regex).
  if (/^kepler[\s_]*2\b/i.test(parenOrWhole(base))) return "Kepler +30s Pause";
  return SECTION_LABEL_RENAMES[base] ?? base;
};

const buildDataMetrics = (rows: DataCallRow[]): DataMetric[] => {
  const testType = (rows[0]?.testType ?? "").toLowerCase();
  const collect = (pick: (row: DataCallRow) => number | null): Sample =>
    mean(rows.map(pick).filter((value): value is number => value != null && value > 0));

  // Έλεγχος πριν το γενικό "ping" — reuse του ίδιου πεδίου (pingRttAvg) για το DNS
  // resolution time, βλ. mapDnsRowsToDataCallRows. Ίδιο σχήμα μετρικής (ένα "Mean X σε
  // ms"), διαφορετική ετικέτα.
  if (testType.includes("dns")) {
    const duration = collect((row) => numeric(row.pingRttAvg));
    return [
      {
        label: "Mean DNS Resolution Time",
        unit: "ms",
        decimals: 1,
        higherIsBetter: false,
        value: duration.avg,
        samples: duration.samples,
      },
    ];
  }

  if (testType.includes("ping")) {
    const rtt = collect((row) => numeric(row.pingRttAvg));
    return [{ label: "Mean RTT", unit: "ms", decimals: 1, higherIsBetter: false, value: rtt.avg, samples: rtt.samples }];
  }

  if (testType.includes("interactivity")) {
    // PacketsLostRate=0 (τέλειο τεστ, καθόλου απώλειες) είναι έγκυρο και θέλουμε να
    // μετράει στον μέσο όρο — σε αντίθεση με το `collect` παραπάνω (φιλτράρει value>0
    // παντού αλλού, όπου το 0 σημαίνει "δεν υπάρχει τιμή"), εδώ κρατάμε και τα μηδενικά.
    const collectAllowZero = (pick: (row: DataCallRow) => number | null): Sample =>
      mean(rows.map(pick).filter((value): value is number => value != null && value >= 0));

    const throughput = collect((row) => numeric(row.throughputKbps));
    const rtt = collect((row) => numeric(row.interactivityRtt));
    const packetsLostRate = collectAllowZero((row) => numeric(row.interactivityPacketsLostRate));
    const packetDelay = collect((row) => numeric(row.interactivityPacketDelay));
    const qoe = collect((row) => numeric(row.interactivityQoeScore));

    return [
      {
        label: "eGaming Average of ThroughputKbps",
        unit: "",
        decimals: 1,
        higherIsBetter: true,
        value: throughput.avg,
        samples: throughput.samples,
      },
      { label: "eGaming Average of RTT", unit: "", decimals: 1, higherIsBetter: false, value: rtt.avg, samples: rtt.samples },
      {
        // PacketsLostRate φτάνει ως raw fraction (0-1) — *100 για εμφάνιση ως ποσοστό.
        label: "eGaming Average of PacketsLostRate",
        unit: "%",
        decimals: 3,
        higherIsBetter: false,
        value: packetsLostRate.avg == null ? null : packetsLostRate.avg * 100,
        samples: packetsLostRate.samples,
      },
      {
        label: "eGaming Average of PacketDelay",
        unit: "",
        decimals: 1,
        higherIsBetter: false,
        value: packetDelay.avg,
        samples: packetDelay.samples,
      },
      {
        // QoEScore φτάνει επίσης ως raw fraction (0-1) — *100 για εμφάνιση ως ποσοστό.
        label: "eGaming Avg QoEScore",
        unit: "%",
        decimals: 2,
        higherIsBetter: true,
        value: qoe.avg == null ? null : qoe.avg * 100,
        samples: qoe.samples,
      },
    ];
  }

  if (testType.includes("youtube")) {
    const mos = collect((row) => numeric(row.youtubeMos));
    const interruptions = mean(
      rows.map((row) => numeric(row.youtubeInterruptions)).filter((value): value is number => value != null),
    );
    return [
      { label: "Mean video MOS", unit: "", decimals: 2, higherIsBetter: true, value: mos.avg, samples: mos.samples },
      {
        label: "Mean interruptions",
        unit: "",
        decimals: 2,
        higherIsBetter: false,
        value: interruptions.avg,
        samples: interruptions.samples,
      },
    ];
  }

  if (testType.includes("capacity")) {
    const capacity = collect((row) => numeric(row.capacityThroughputKbps));
    return [
      {
        label: "Mean sustainable throughput",
        unit: "Mbps",
        decimals: 1,
        higherIsBetter: true,
        value: capacity.avg == null ? null : capacity.avg / 1000,
        samples: capacity.samples,
      },
    ];
  }

  const throughput = collect((row) => numeric(row.throughputKbps));
  return [
    {
      label: "Mean application throughput",
      unit: "Mbps",
      decimals: 2,
      higherIsBetter: true,
      value: throughput.avg == null ? null : throughput.avg / 1000,
      samples: throughput.samples,
    },
  ];
};

const buildDataTestStats = (rows: DataCallRow[]): DataTestStats => {
  let success = 0;
  let failed = 0;
  for (const row of rows) {
    const outcome = classifyDataTest(row);
    if (outcome === "success") success++;
    else if (outcome === "failed") failed++;
  }

  return {
    total: rows.length,
    success,
    failed,
    // Success rate μόνο πάνω στα scored tests — τα "other" δεν κρίθηκαν.
    successRate: ratio(success, success + failed),
    metrics: buildDataMetrics(rows),
  };
};

/**
 * Σταθερή, ρητή σειρά εμφάνισης των PS Data Stats sections στο Attachment C — η
 * "5 group, QoS → QoE" πρόταση του πελάτη (2026-08-26), 5 ενότητες:
 *
 *   Ε1 · Bulk throughput            Capacity DL/UL, HTTP Transfer DL/UL, Ookla DL/UL
 *   Ε2 · Latency / Responsiveness   Ping 40/800/1000 B, DNS Resolution, Interactivity
 *   Ε3 · Browser engines            Kepler, Kepler +30s Pause, Newton
 *   Ε4 · HTTPS sites                website tests, αλφαβητικά (alpha, amazon, car.gr, …)
 *   Ε5 · Video streaming            YouTube Service / 4K / Live
 *
 * (αντικατέστησε την προηγούμενη επίπεδη 26-θέσεων λίστα — το Ookla μετακινήθηκε
 * ΜΕΤΑ το HTTP Transfer μέσα στο Ε1, και το Ping/DNS/Interactivity ανέβηκε πολύ πιο
 * πάνω, στο Ε2, αντί να είναι τελευταίο). Ό,τι test type δεν ταιριάζει σε κανένα από
 * αυτά (π.χ. ένα απλό "Ping" χωρίς μέγεθος, ή ένα ad-hoc "FTP DL") πέφτει στο
 * UNMATCHED_RANK, ακριβώς πριν το Ping 40/800/1000 group — ίδια σχετική θέση με το
 * παλιό "rank 3" catch-all, ώστε ένα άγνωστο/νέο test type να μη χαθεί σιωπηλά αντί
 * να σκάσει.
 *
 * ΣΗΜΕΙΩΣΗ Kepler/"Kepler +30s Pause"/Newton/website tests: matchάρουν σε regex
 * φτιαγμένα πάνω στα ονόματα που δόθηκαν (case-insensitive, ανεκτικά σε "Kepler 2"
 * σαν εναλλακτικό raw name για το "+30s Pause" variant) — επιβεβαίωσε πάνω σε
 * πραγματικά δεδομένα αν το raw TestName διαφέρει.
 *
 * "Payload Ping BIDIRECTIONAL" ΔΕΝ έχει rank εδώ — αποκλείεται εντελώς, βλ. isExcludedSection.
 */
export const SECTION_GROUP_LABELS = {
  bulkThroughput: "Ε1 · Bulk throughput",
  latency: "Ε2 · Latency / Responsiveness",
  browserEngines: "Ε3 · Browser engines",
  httpsSites: "Ε4 · HTTPS sites",
  videoStreaming: "Ε5 · Video streaming",
} as const;

/**
 * Ε4 · HTTPS sites — 9 site tests (8 domains + "alpha"), αλφαβητικά. Ανεκτικό σε
 * οποιοδήποτε raw format δει η βάση: πλήρες URL ("https://www.amazon.com"), "HTTPS/
 * HTTP Browser (site)" (π.χ. "HTTPS Browser (alpha)"), ή γυμνό domain ("amazon.com") —
 * βλ. httpsSiteKeyword παρακάτω. Alpha πρώτο (επιβεβαιωμένο ξεχωριστό test, όχι
 * URL-shaped, βλ. σχόλιο εκεί), μετά τα υπόλοιπα 8 αλφαβητικά.
 */
const HTTPS_SITE_ORDER = ["alpha", "amazon", "car.gr", "ebay", "google", "imdb", "in.gr", "yahoo", "youtube"];

/**
 * Το περιεχόμενο μέσα σε "(...)" αν το label έχει αυτή τη μορφή (π.χ. "HTTP Browser
 * (Kepler)" -> "Kepler"), αλλιώς όλο το label αμετάβλητο. Reused από Ε3 (Kepler/
 * Kepler +30s Pause/Newton) και Ε4 (HTTPS sites) — και τα δύο groups έχουν δει raw
 * TestName είτε "γυμνό" είτε τυλιγμένο σε "Browser (X)".
 */
const parenOrWhole = (l: string): string => {
  const parenMatch = /\(([^)]+)\)/.exec(l);
  return parenMatch ? parenMatch[1] : l;
};

/**
 * Εξάγει ποιο HTTPS_SITE_ORDER keyword ταιριάζει σε ένα label — όποιο raw format κι αν
 * είναι (πλήρες URL, "Browser (site)", ή γυμνό domain) — ή null αν δεν ταιριάζει κανένα.
 */
const httpsSiteKeyword = (l: string): string | null =>
  HTTPS_SITE_ORDER.find((keyword) => parenOrWhole(l).includes(keyword)) ?? null;

/** Σειρά μεταξύ των "YouTube Service*" sections: plain, μετά _4K, μετά _Live. */
/**
 * Space, όχι underscore — ίδια μορφή με το SECTION_LABEL_RENAMES's "YouTube Service
 * 4K"/"YouTube Service Live" display labels (η ταξινόμηση τρέχει πάνω στο ήδη-
 * μετονομασμένο label, όχι στο raw testType).
 */
const YOUTUBE_SERVICE_ORDER = ["youtube service", "youtube service 4k", "youtube service live"];

/**
 * Ε2 · Latency / Responsiveness — A-LEVEL "PING RAW.sql" reference query (ίδιο με το
 * "Ping RAW" saved query του QueryEditor), η πηγή και για τα τρία "Ping 40 B" / "Ping
 * 800 B" / "Ping 1000 B" sections — μόνο το ResultsPingTest.PacketSize διαφέρει (40/800/
 * 1000), όλα τα άλλα (RTT/Success/Failed/Host/κ.λπ.) βγαίνουν από το ΙΔΙΟ query:
 *
 *   Select FileList.ASideFileName,
 *   FileList.TestDescription,
 *   FileList.CollectionName,
 *   FileList.ASideDevice as 'A Device',
 *   Sessions.SessionId,
 *   TestInfo.TestId,
 *   TestInfo.StartDate as 'Date',
 *   TestInfo.StartTime as 'Time',
 *   NetworkInfo.Cid,
 *   NetworkInfo.LAC,
 *   FileList.ASideLocation,
 *   ResultsPingTest.Host,
 *   case when (ResultsPingTest.ErrorCode=0) then ResultsPingTest.RTT else NULL end as RTT,
 *   ResultsPingTest.PacketSize,
 *   ErrorCodes.msg As ErrorCode,
 *   case when (ResultsPingTest.ErrorCode=0) then 1 else 0 end as Success,
 *   case when (ResultsPingTest.ErrorCode=0) then 0 else 1 end as Failed,
 *   ResultsPingTest.seqNumber as 'Sequence Number'
 *   from FileList, Sessions, TestInfo, NetworkInfo, ResultsPingTest, ErrorCodes
 *   where CollectionName like '%%' AND Sessions.Valid = 1 AND TestInfo.Valid = 1 AND
 *   FileList.FileId = Sessions.FileId AND
 *   TestInfo.SessionId = Sessions.SessionId AND
 *   ResultsPingTest.TestId = TestInfo.TestId AND
 *   ResultsPingTest.ErrorCode = ErrorCodes.Code AND
 *   TestInfo.NetworkId = NetworkInfo.NetworkId
 *
 * ΕΝΗΜΕΡΩΣΗ (2026-08-31): πλέον ΚΑΙ τα τρία περνάνε ΚΥΡΙΟΛΕΚΤΙΚΑ από αυτό το query, χωρίς
 * PacketSize filter — backend /api/ping_1000 (βλ. get_ping_1000 στο backend/routers/
 * calls.py) γυρνάει packets και για τα 40/800/1000 μαζί σε ένα call, το frontend τα
 * χωρίζει σε testType "Ping 40"/"Ping 800"/"Ping 1000" βάσει του row.packetSize (βλ.
 * mapPing1000RowsToDataCallRows). Τα παλιά "ICMP Ping 40"/"ICMP Ping 800" TestName του
 * CDRCombined view (/api/data_calls) ΔΕΝ χρησιμοποιούνται πια εδώ — βγαίνουν ρητά πριν
 * μπουν στο summary pipeline (βλ. excludeCdrPingDuplicates), αλλιώς θα μετρούσαν διπλά.
 */

/**
 * Σειρά μεταξύ των "Ping 40 B" / "Ping 800 B" / "Ping 1000 B" sections, αύξουσα σειρά
 * μεγέθους payload. Και τα τρία φτάνουν πλέον από το ΙΔΙΟ raw query — testType "Ping 40"/
 * "Ping 800"/"Ping 1000" (βλ. mapPing1000RowsToDataCallRows) — το SECTION_LABEL_RENAMES τα
 * μετονομάζει πριν φτάσουν εδώ.
 */
const PING_B_ORDER = ["ping 40 b", "ping 800 b", "ping 1000 b"];

/**
 * "Ping 40 B" -> 40, "Ping 800 B" -> 800, "Ping 1000 B" -> 1000, αλλιώς null. Οι τρεις
 * πίνακες έχουν ΑΚΡΙΒΩΣ την ίδια δομή γραμμών (Success Rate/Total Tests/Successful/
 * Failed/Mean RTT) — το ΜΟΝΟ που διαφέρει είναι το packet size, οπότε το SummaryTab
 * προσθέτει ένα "Packet Size (bytes)" row (βλ. packetSizeRow) για να ξεχωρίζουν με μια
 * ματιά, χωρίς να χρειάζεται να διαβάσεις το section label.
 */
export const pingPacketSizeBytes = (label: string): number | null => {
  const match = /^Ping (\d+) B$/.exec(label);
  return match ? Number(match[1]) : null;
};

/**
 * "Kepler 2" (η αρχική υπόθεση) ή ό,τι raw name περιέχει "pause" ή μοναχικό "2" μετά
 * το "kepler" — matchάρει το "Kepler +30s Pause" variant, ανεξάρτητα ποιο από τα δύο
 * raw formats στέλνει τελικά η βάση. Δες SECTION_LABEL_RENAMES για το display label.
 * Εφαρμόζεται πάνω σε parenOrWhole(l) — ανεκτικό σε "Kepler 2" γυμνό ΚΑΙ σε "HTTP
 * Browser (Kepler 2)" τυλιγμένο, ίδιο σκεπτικό με το httpsSiteKeyword.
 */
const KEPLER_PAUSE_RE = /^kepler\b.*(pause|\b2\b)/i;

interface SectionGroup {
  match: (l: string) => boolean;
  /** Σειρά ΜΕΣΑ στο group· χωρίς αυτό, ισοπαλία -> count-sort σαν πριν. */
  subRank?: (l: string) => number;
  group: string;
}

const SECTION_ORDER: SectionGroup[] = [
  // subRank: το κύριο "Capacity DL 10GB" (χωρίς παρένθεση) πριν τα ανά-link breakdowns
  // "Capacity DL 10GB (grx)"/"(akamai)" — βλ. mapCapacityLinkRowsToDataCallRows.
  { match: (l) => /^capacity dl\b/.test(l), subRank: (l) => (l.includes("(") ? 1 : 0), group: SECTION_GROUP_LABELS.bulkThroughput },
  { match: (l) => /^capacity ul\b/.test(l), subRank: (l) => (l.includes("(") ? 1 : 0), group: SECTION_GROUP_LABELS.bulkThroughput },
  { match: (l) => l.includes("http transfer (dl)"), group: SECTION_GROUP_LABELS.bulkThroughput },
  { match: (l) => l.includes("http transfer (ul)"), group: SECTION_GROUP_LABELS.bulkThroughput },
  { match: (l) => l.includes("ookla") && /\bdl\b/.test(l), subRank: () => 0, group: SECTION_GROUP_LABELS.bulkThroughput },
  { match: (l) => l.includes("ookla") && /\bul\b/.test(l), subRank: () => 1, group: SECTION_GROUP_LABELS.bulkThroughput },
  // Ookla χωρίς DL/UL στο label (π.χ. "Ookla Speedtest").
  { match: (l) => l.includes("ookla"), subRank: () => 0.5, group: SECTION_GROUP_LABELS.bulkThroughput },
  { match: (l) => PING_B_ORDER.includes(l), subRank: (l) => PING_B_ORDER.indexOf(l), group: SECTION_GROUP_LABELS.latency },
  { match: (l) => l.includes("dns"), group: SECTION_GROUP_LABELS.latency },
  // Substring, όχι exact-equality — το label φτάνει εδώ ήδη μετονομασμένο σε
  // "Interactivity (eGaming)" (βλ. SECTION_LABEL_RENAMES), όχι "interactivity" γυμνό.
  { match: (l) => l.includes("interactivity"), group: SECTION_GROUP_LABELS.latency },
  {
    match: (l) => /^kepler\b/.test(parenOrWhole(l)) && !KEPLER_PAUSE_RE.test(parenOrWhole(l)),
    group: SECTION_GROUP_LABELS.browserEngines,
  },
  { match: (l) => KEPLER_PAUSE_RE.test(parenOrWhole(l)), group: SECTION_GROUP_LABELS.browserEngines },
  { match: (l) => /^newton\b/.test(parenOrWhole(l)), group: SECTION_GROUP_LABELS.browserEngines },
  {
    // "YouTube Service*" tests περιέχουν κι αυτά "youtube" σαν substring — αποκλείονται
    // ρητά εδώ ώστε να μην τα αρπάξει το Ε4 group αντί για το σωστό τους Ε5.
    match: (l) => !l.includes("service") && httpsSiteKeyword(l) !== null,
    subRank: (l) => HTTPS_SITE_ORDER.indexOf(httpsSiteKeyword(l)!),
    group: SECTION_GROUP_LABELS.httpsSites,
  },
  {
    match: (l) => YOUTUBE_SERVICE_ORDER.includes(l),
    subRank: (l) => YOUTUBE_SERVICE_ORDER.indexOf(l),
    group: SECTION_GROUP_LABELS.videoStreaming,
  },
];

/**
 * Ό,τι δεν ταιριάζει σε κανένα SECTION_ORDER group (π.χ. ένα απλό "Ping" χωρίς
 * μέγεθος, ή ένα ad-hoc "FTP DL") — ακριβώς πριν το Ping 40/800/1000 group, ίδια
 * σχετική θέση με το παλιό "rank 3" catch-all.
 */
const UNMATCHED_RANK = SECTION_ORDER.findIndex((group) => group.match("ping 40 b")) - 0.5;

const sectionRank = (label: string): [number, number] => {
  const l = label.toLowerCase();
  const index = SECTION_ORDER.findIndex((group) => group.match(l));
  if (index === -1) return [UNMATCHED_RANK, 0];
  const group = SECTION_ORDER[index];
  return [index, group.subRank ? group.subRank(l) : 0];
};

/** Το "Εν · ..." group label ενός section, για group headers στο SummaryTab. "" όταν unmatched. */
export const sectionGroupOf = (label: string): string => {
  const l = label.toLowerCase();
  return SECTION_ORDER.find((group) => group.match(l))?.group ?? "";
};

/**
 * Sections που αποκλείονται εντελώς από το PS Data Stats table:
 * - "Ookla(R) BIDIRECTIONAL" — παλιό combined DL+UL test type, αχρησιμοποίητο
 *   "success" (πάντα "—") · αντικαταστάθηκε από το ξεχωριστό "Ookla DL"/"Ookla UL"
 *   split (βλ. mapOoklaRowsToDataCallRows). ΔΕΝ πιάνει τα δικά μας "Ookla DL"/"Ookla
 *   UL" — αυτά δεν έχουν "bidirectional".
 * - "Payload Ping BIDIRECTIONAL" — τρέχει συνέχεια στο background (βλ. σχόλιο στο
 *   παλιό test file), όχι ζητούμενο section του Attachment C. ΔΕΝ πιάνει τα "Ping"/
 *   "Ping 40/800/1000 B" — αυτά δεν έχουν "bidirectional".
 * - "Interactivity BIDIRECTIONAL" — ίδιο σκεπτικό, όχι ζητούμενο section. ΔΕΝ πιάνει
 *   το δικό μας "Interactivity" (mapInteractivityRowsToDataCallRows) — δεν έχει
 *   "bidirectional".
 */
const isExcludedSection = (label: string): boolean => {
  const l = label.toLowerCase();
  return (l.includes("ookla") || l.includes("ping") || l.includes("interactivity")) && l.includes("bidirectional");
};

export const buildDataSections = (rows: DataCallRow[]): DataTestSection[] => {
  const sections = new Map<string, DataCallRow[]>();

  for (const row of rows) {
    const key = sectionLabel(row);
    if (isExcludedSection(key)) continue;
    const bucket = sections.get(key);
    if (bucket) bucket.push(row);
    else sections.set(key, [row]);
  }

  return Array.from(sections.entries())
    .map(([key, sectionRows]) => {
      const byOperator = new Map<string, DataTestStats>();
      const grouped = new Map<string, DataCallRow[]>();

      for (const row of sectionRows) {
        const operatorKey = resolveOperator(row.Location).key;
        const bucket = grouped.get(operatorKey);
        if (bucket) bucket.push(row);
        else grouped.set(operatorKey, [row]);
      }
      for (const [operatorKey, operatorRows] of grouped) {
        byOperator.set(operatorKey, buildDataTestStats(operatorRows));
      }

      return { key, label: key, group: sectionGroupOf(key), byOperator, total: buildDataTestStats(sectionRows) };
    })
    .sort((a, b) => {
      const [groupA, subA] = sectionRank(a.label);
      const [groupB, subB] = sectionRank(b.label);
      if (groupA !== groupB) return groupA - groupB;
      if (subA !== subB) return subA - subB;
      return b.total.total - a.total.total || a.label.localeCompare(b.label);
    });
};

/**
 * DataTestStats "κενό" αντίγραφο — ίδια metric labels/units/decimals/higherIsBetter με το
 * `total` που δόθηκε, μηδενικές/null τιμές. Για operators χωρίς δικά τους δεδομένα σε ένα
 * section/side, ώστε η στήλη τους να δείχνει "—" με το σωστό unit αντί να χαθεί το
 * decimals/unit (βλ. χρήση στο DataSectionBlock/DirectionalSectionBlock του SummaryTab).
 */
export const emptyDataTestStatsLike = (total: DataTestStats): DataTestStats => ({
  total: 0,
  success: 0,
  failed: 0,
  successRate: null,
  metrics: total.metrics.map((metric) => ({ ...metric, value: null, samples: 0 })),
});

/** Ίδιο με emptyDataTestStatsLike, όταν δεν υπάρχει καν ένα `total` για να αντιγράψουμε το σχήμα του metric. */
const BARE_EMPTY_DATA_TEST_STATS: DataTestStats = { total: 0, success: 0, failed: 0, successRate: null, metrics: [] };

export interface DirectionalDataTestStats {
  dl: DataTestStats;
  ul: DataTestStats;
}

export interface DirectionalDataTestSection {
  key: string;
  label: string;
  group: string;
  byOperator: Map<string, DirectionalDataTestStats>;
  total: DirectionalDataTestStats;
}

/**
 * Ζευγάρια section labels (DL/UL) του Ε1 · Bulk throughput που ενώνονται σε ΕΝΑ compact
 * table — βλ. buildDirectionalDataSections. Τα labels πρέπει να ταιριάζουν ΑΚΡΙΒΩΣ με ό,τι
 * βγάζει το sectionLabel εδώ πιο πάνω (βλ. BARE_CAPACITY_PAYLOAD / SECTION_LABEL_RENAMES /
 * mapOoklaRowsToDataCallRows για το πώς προκύπτει κάθε label).
 *
 * ΧΩΡΙΣ HTTP Transfer (2026-08-31: αφαιρέθηκε από το compact merge) — τα "HTTP Transfer
 * (DL) 10MB"/"HTTP Transfer (UL) 5MB" μένουν ασύνδετα, στο `rest`, σαν ξεχωριστά sections
 * ίδια με το Full mode.
 */
const DIRECTIONAL_MERGE_PAIRS: { label: string; dl: string; ul: string }[] = [
  { label: "Capacity DL 10GB / Capacity UL 1GB", dl: "Capacity DL 10GB", ul: "Capacity UL 1GB" },
  { label: "Ookla DL / Ookla UL", dl: "Ookla DL", ul: "Ookla UL" },
];

/**
 * Compact PS Data view — βλ. "comapct_data .txt" (2026-08-31). Αντικατέστησε το παλιό
 * "5 groups, ένα averaged AVG το καθένα" σχέδιο (πρώην buildDataGroupSections, αφαιρέθηκε
 * εντελώς): το average πάνω σε DL+UL μαζί έχανε τη διάκριση κατεύθυνσης, που ήταν ακριβώς
 * αυτό που ζητήθηκε να ξαναφανεί.
 *
 * Τα Ε1 · Bulk throughput ζευγάρια DL/UL (Capacity, Ookla — βλ. DIRECTIONAL_MERGE_PAIRS)
 * ενώνονται σε ΕΝΑ table το καθένα, με τις δύο κατευθύνσεις σαν ξεχωριστές γραμμές (DL
 * group πρώτα, μετά UL group — βλ. SummaryTab's directionalDataRows, "όλα πρώτα dl και
 * μετά ul"). Αν λείπει η μία πλευρά (π.χ. καθόλου UL δεδομένα ακόμα), αυτή γίνεται απλά
 * κενή/μηδενική — δεν χάνεται όλο το table.
 *
 * Ό,τι test ΔΕΝ έχει DL/UL pair (HTTP Transfer/Ping/DNS/Interactivity/Kepler/Newton/HTTPS
 * sites/YouTube) μένει σαν ξεχωριστό section στο `rest`, ίδιο με το Full mode — δεν
 * ξαναμπαίνει σε average.
 *
 * Δουλεύει πάνω στο ήδη υπολογισμένο buildDataSections, δεν ξαναδιαβάζει raw rows.
 */
export const buildDirectionalDataSections = (
  sections: DataTestSection[],
): { merged: DirectionalDataTestSection[]; rest: DataTestSection[] } => {
  const byLabel = new Map(sections.map((section) => [section.label, section]));
  const used = new Set<string>();
  const merged: DirectionalDataTestSection[] = [];

  for (const pair of DIRECTIONAL_MERGE_PAIRS) {
    const dl = byLabel.get(pair.dl);
    const ul = byLabel.get(pair.ul);
    if (!dl && !ul) continue; // κανένα από τα δύο δεν υπάρχει στα δεδομένα — παράλειψε το ζευγάρι.
    used.add(pair.dl);
    used.add(pair.ul);

    const operatorKeys = new Set<string>([...(dl?.byOperator.keys() ?? []), ...(ul?.byOperator.keys() ?? [])]);
    const byOperator = new Map<string, DirectionalDataTestStats>();
    for (const key of operatorKeys) {
      byOperator.set(key, {
        dl: dl ? (dl.byOperator.get(key) ?? emptyDataTestStatsLike(dl.total)) : BARE_EMPTY_DATA_TEST_STATS,
        ul: ul ? (ul.byOperator.get(key) ?? emptyDataTestStatsLike(ul.total)) : BARE_EMPTY_DATA_TEST_STATS,
      });
    }

    merged.push({
      key: pair.label,
      label: pair.label,
      group: (dl ?? ul)!.group,
      byOperator,
      total: { dl: dl?.total ?? BARE_EMPTY_DATA_TEST_STATS, ul: ul?.total ?? BARE_EMPTY_DATA_TEST_STATS },
    });
  }

  return { merged, rest: sections.filter((section) => !used.has(section.label)) };
};

/**
 * Σταθμισμένος μέσος όρος (Σ value×samples / Σ samples) πάνω στο ΠΡΩΤΟ metric κάθε section —
 * ίδιο σκεπτικό με το παλιό (αφαιρεμένο) mergeGroupStats, εδώ σκοπισμένο σε compact "όλα σε
 * ένα total" merges όπου τα sections μετράνε το ΙΔΙΟ πράγμα στην ΙΔΙΑ μονάδα — π.χ. Ε4 ·
 * HTTPS sites (application throughput ανά site, βλ. buildHttpsSitesTotal) ή Ping 40/800/
 * 1000 B (RTT σε ms, βλ. buildPingTotal). Αντίθετα με τα Ε1 DL/UL pairs
 * (buildDirectionalDataSections), εδώ δεν υπάρχει direction να χαθεί.
 */
const mergeWeightedTestStats = (stats: DataTestStats[]): DataTestStats => {
  const unit = stats.find((entry) => entry.metrics[0])?.metrics[0] ?? null;
  let total = 0;
  let success = 0;
  let failed = 0;
  let weighted = 0;
  let samples = 0;

  for (const entry of stats) {
    total += entry.total;
    success += entry.success;
    failed += entry.failed;

    const metric = entry.metrics[0];
    if (!unit || !metric || metric.unit !== unit.unit || metric.value == null || metric.samples <= 0) continue;
    weighted += metric.value * metric.samples;
    samples += metric.samples;
  }

  return {
    total,
    success,
    failed,
    successRate: ratio(success, success + failed),
    metrics: unit
      ? [
          {
            label: unit.label,
            unit: unit.unit,
            decimals: unit.decimals,
            higherIsBetter: unit.higherIsBetter,
            value: samples > 0 ? weighted / samples : null,
            samples,
          },
        ]
      : [],
  };
};

/**
 * Compact "Ε4 · HTTPS sites" total — βλ. "όλα τα σάιτε μαζεμένα σε total στο compact"
 * (2026-08-31). Τα 9 site tests (alpha/amazon/car.gr/ebay/google/imdb/in.gr/yahoo/youtube)
 * μαζεύονται σε ΕΝΑ section, στη θέση του πρώτου site section στη λίστα — η υπόλοιπη σειρά
 * (Ε1..Ε5) μένει ανέπαφη. Επιστρέφει τα sections αυτούσια όταν δεν υπάρχει κανένα Ε4 section.
 *
 * Επιστρέφει κανονικό DataTestSection — ίδιο σχήμα με buildDataSections, οπότε περνάει
 * αυτούσιο στο ίδιο DataSectionBlock/compactDataRows του SummaryTab, δεν χρειάζεται νέο
 * rendering path (αντίθετα με το directional DL/UL merge).
 */
export const buildHttpsSitesTotal = (sections: DataTestSection[]): DataTestSection[] => {
  const siteSections = sections.filter((section) => section.group === SECTION_GROUP_LABELS.httpsSites);
  if (siteSections.length === 0) return sections;

  const operatorKeys = new Set<string>();
  for (const section of siteSections) {
    for (const operatorKey of section.byOperator.keys()) operatorKeys.add(operatorKey);
  }
  const byOperator = new Map<string, DataTestStats>();
  for (const operatorKey of operatorKeys) {
    byOperator.set(
      operatorKey,
      mergeWeightedTestStats(
        siteSections.map((section) => section.byOperator.get(operatorKey)).filter((s): s is DataTestStats => s != null),
      ),
    );
  }

  const merged: DataTestSection = {
    key: SECTION_GROUP_LABELS.httpsSites,
    label: "HTTPS sites (all sites combined)",
    group: SECTION_GROUP_LABELS.httpsSites,
    byOperator,
    total: mergeWeightedTestStats(siteSections.map((section) => section.total)),
  };

  const result: DataTestSection[] = [];
  let inserted = false;
  for (const section of sections) {
    if (section.group !== SECTION_GROUP_LABELS.httpsSites) {
      result.push(section);
      continue;
    }
    if (!inserted) {
      result.push(merged);
      inserted = true;
    }
  }
  return result;
};

/**
 * Compact "Ping 40 B / 800 B / 1000 B" total — βλ. "τα ping στο compact όλα μαζεμένα"
 * (2026-08-31), ίδιο σκεπτικό με buildHttpsSitesTotal: τα τρία packet sizes μαζεύονται σε
 * ΕΝΑ section, στη θέση του πρώτου Ping B section στη λίστα. Ίδια μονάδα (ms RTT) και στα
 * τρία, οπότε ο σταθμισμένος μέσος όρος έχει νόημα — λιγότερο "καθαρός" απ' ό,τι στα HTTPS
 * sites βέβαια (διαφορετικό packet size -> ελαφρώς διαφορετικό RTT baseline), αλλά αυτό
 * ΕΙΝΑΙ το σημείο του compact: λιγότερη λεπτομέρεια.
 *
 * ΔΕΝ πιάνει το γυμνό "Ping" section (χωρίς μέγεθος, group === "" — unmatched, ξεχωριστό
 * test type, βλ. sectionRank) — μόνο τα Ping 40 B/800 B/1000 B (pingPacketSizeBytes !=
 * null). Το "Packet Size (bytes)" row (βλ. packetSizeRow στο SummaryTab) δεν εμφανίζεται
 * πια εδώ — το merged section.label δεν ταιριάζει με pingPacketSizeBytes, οπότε φεύγει
 * αυτόματα (δεν αντιστοιχεί πια σε ΕΝΑ μέγεθος).
 */
export const buildPingTotal = (sections: DataTestSection[]): DataTestSection[] => {
  const pingSections = sections.filter((section) => pingPacketSizeBytes(section.label) != null);
  if (pingSections.length === 0) return sections;

  const operatorKeys = new Set<string>();
  for (const section of pingSections) {
    for (const operatorKey of section.byOperator.keys()) operatorKeys.add(operatorKey);
  }
  const byOperator = new Map<string, DataTestStats>();
  for (const operatorKey of operatorKeys) {
    byOperator.set(
      operatorKey,
      mergeWeightedTestStats(
        pingSections.map((section) => section.byOperator.get(operatorKey)).filter((s): s is DataTestStats => s != null),
      ),
    );
  }

  const merged: DataTestSection = {
    key: "Ping (all sizes combined)",
    label: "Ping (all sizes combined)",
    group: SECTION_GROUP_LABELS.latency,
    byOperator,
    total: mergeWeightedTestStats(pingSections.map((section) => section.total)),
  };

  const result: DataTestSection[] = [];
  let inserted = false;
  for (const section of sections) {
    if (pingPacketSizeBytes(section.label) == null) {
      result.push(section);
      continue;
    }
    if (!inserted) {
      result.push(merged);
      inserted = true;
    }
  }
  return result;
};

/**
 * Μετατρέπει τα Downlink/Uplink Performance rows του /api/ookla σε DataCallRow σχήμα
 * (testType="Ookla", direction="DL"/"UL" από το actionName) ώστε να μπουν στο ίδιο
 * buildDataSections pipeline με τα υπόλοιπα PS Data tests — sectionLabel τα ονομάζει
 * "Ookla DL"/"Ookla UL", και το sectionRank τα pin-άρει αμέσως κάτω από το Capacity UL.
 * Το backend ήδη φιλτράρει σε actionName Downlink/Uplink Performance μόνο (όχι social
 * media/messaging actions άλλων app tests) — το filter εδώ είναι απλά defensive.
 */
export const mapOoklaRowsToDataCallRows = (rows: OoklaRow[]): DataCallRow[] =>
  rows
    .filter((row) => row.actionName === "Downlink Performance" || row.actionName === "Uplink Performance")
    .map((row) => ({
      Location: row.location,
      SessionId: row.sessionId,
      TestId: row.testId,
      callStartTimeStamp: row.startTime,
      testType: "Ookla",
      direction: row.actionName === "Downlink Performance" ? "DL" : "UL",
      status: row.actionStatus,
      scoringStatus: row.actionStatus,
      host: row.app,
      pingRttAvg: null,
      throughputKbps: row.throughputKbps,
      capacityThroughputKbps: null,
      youtubeMos: null,
      youtubeInterruptions: null,
      interactivityQoeScore: null,
      interactivityRtt: null,
      interactivityPacketsLostRate: null,
      interactivityPacketDelay: null,
      technology: row.technology,
      startTechnology: row.dataTechnology,
      CollectionName: row.collectionName,
      ASideFileName: row.aSideFileName,
      isValid: 1,
      comment: null,
      latitude: null,
      longitude: null,
    }));

/**
 * Μετατρέπει τα raw Capacity rows του /api/capacity_link (ResultsCapacityTest ×
 * ResultsCapacityTestParameters, ένα row ανά test με το Link — grx/akamai/άλλο) σε
 * DataCallRow σχήμα, testType="Capacity grx"/"Capacity akamai" (ή "Capacity <ό,τι άλλο
 * URIList>" αν ποτέ εμφανιστεί τρίτος server) ώστε να μπουν στο ίδιο buildDataSections
 * pipeline με τα υπόλοιπα PS Data tests — βλ. "θέλω να μου το σπάσεις Link grx και
 * akamai" (2026-08-31). Το SECTION_LABEL_RENAMES μετονομάζει τα sections σε "Capacity DL
 * 10GB (grx)"/"Capacity DL 10GB (akamai)" κ.λπ., δίπλα στα κύρια "Capacity DL 10GB"/
 * "Capacity UL 1GB" (που έρχονται ΑΝΕΞΑΡΤΗΤΑ από το CDRCombined, /api/data_calls — ΔΕΝ
 * αγγίζονται) — ένα ΕΠΙΠΛΕΟΝ breakdown, όχι υποκατάστατο (δεν διπλομετράει τα κύρια
 * σύνολα, απλά τα σπάει κατά link). Compact δεν τα δείχνει καθόλου — βλ.
 * COMPACT_EXCLUDED_SECTION_LABELS στο SummaryTab.tsx.
 */
export const mapCapacityLinkRowsToDataCallRows = (rows: CapacityLinkRow[]): DataCallRow[] =>
  rows.map((row) => ({
    Location: row.location,
    SessionId: row.sessionId,
    TestId: row.testId,
    callStartTimeStamp: null,
    testType: `Capacity ${row.link ?? "?"}`,
    direction: row.direction,
    status: row.success === 1 ? "Completed" : "Failed",
    scoringStatus: row.success === 1 ? "success" : "failed",
    host: row.link,
    pingRttAvg: null,
    throughputKbps: null,
    capacityThroughputKbps: row.throughputKbps,
    youtubeMos: null,
    youtubeInterruptions: null,
    interactivityQoeScore: null,
    interactivityRtt: null,
    interactivityPacketsLostRate: null,
    interactivityPacketDelay: null,
    technology: null,
    startTechnology: null,
    CollectionName: row.collectionName,
    ASideFileName: row.aSideFileName,
    isValid: 1,
    comment: null,
    latitude: null,
    longitude: null,
  }));

/**
 * Μετατρέπει τα raw ping-packet rows του /api/ping_1000 (ResultsPingTest — ΟΛΑ τα
 * PacketSize μαζί: 40, 800, 1000, βλ. ΣΗΜΕΙΩΣΗ παρακάτω) σε DataCallRow σχήμα, ΕΝΑ
 * testType ανά packet size ("Ping 40" / "Ping 800" / "Ping 1000", βλ. row.packetSize) ώστε
 * να μπουν στο ίδιο buildDataSections pipeline με τα υπόλοιπα PS Data tests — ίδιο
 * σκεπτικό με mapOoklaRowsToDataCallRows. Το SECTION_LABEL_RENAMES μετονομάζει και τα
 * τρία σε "Ping 40 B"/"Ping 800 B"/"Ping 1000 B", και το PING_B_RANK/PING_B_ORDER τα
 * κρατάει μαζεμένα, το ένα κάτω από το άλλο, σε αύξουσα σειρά μεγέθους — βλ. σχόλια στο
 * sectionRank. `row.packetSize` μηδέν/null δεν αναμένεται στην πράξη (ResultsPingTest
 * έχει πάντα packet size) — αν συμβεί, πέφτει σε "Ping ? B" (δεν ταιριάζει με κανένα
 * rename, μένει ορατό ως-έχει αντί να χαθεί σιωπηλά).
 *
 * ΣΗΜΕΙΩΣΗ (2026-08-31): το backend δεν φιλτράρει πια σε PacketSize=1000 — το
 * /api/ping_1000 (A-LEVEL "PING RAW.sql" reference query) γυρνάει packets ΚΑΙ για τα
 * τρία μεγέθη μαζί, βλ. docstring του get_ping_1000 στο backend/routers/calls.py. Τα
 * "ICMP Ping 40"/"ICMP Ping 800" του CDRCombined view (/api/data_calls) ΑΝΤΙΚΑΤΑΣΤΑΘΗΚΑΝ
 * εντελώς από αυτό — βλ. excludeCdrPingDuplicates, καλείται στο Index.tsx πριν μπουν τα
 * /api/data_calls rows στο summary PS Data pipeline, ώστε το Ping 40 B/800 B να μη
 * μετρήσει διπλά (μία φορά από το CDRCombined, μία από εδώ).
 */
export const mapPing1000RowsToDataCallRows = (rows: PingRow[]): DataCallRow[] =>
  rows.map((row) => ({
    Location: row.location,
    SessionId: row.sessionId,
    TestId: row.testId,
    callStartTimeStamp: null,
    testType: row.packetSize != null ? `Ping ${row.packetSize}` : "Ping ? B",
    direction: null,
    status: row.success === 1 ? "Completed" : "Failed",
    scoringStatus: row.success === 1 ? "success" : "failed",
    host: row.host,
    pingRttAvg: row.rtt,
    throughputKbps: null,
    capacityThroughputKbps: null,
    youtubeMos: null,
    youtubeInterruptions: null,
    interactivityQoeScore: null,
    interactivityRtt: null,
    interactivityPacketsLostRate: null,
    interactivityPacketDelay: null,
    technology: null,
    startTechnology: null,
    CollectionName: row.collectionName,
    ASideFileName: row.aSideFileName,
    isValid: 1,
    comment: null,
    latitude: null,
    longitude: null,
  }));

/**
 * "ICMP Ping 40"/"ICMP Ping 800" TestName values του CDRCombined view (/api/data_calls) —
 * ΑΝΤΙΚΑΤΑΣΤΑΘΗΚΑΝ εντελώς από το raw /api/ping_1000 endpoint (2026-08-31, βλ.
 * mapPing1000RowsToDataCallRows) που πλέον καλύπτει PacketSize 40/800/1000 μαζί, όχι μόνο
 * 1000. Αν κρατούσαμε ΚΑΙ τα δύο sources ενεργά, το Ping 40 B/800 B θα μετρούσε ΔΙΠΛΑ
 * (λάθος Total Tests/Success Rate/Mean RTT) — βλ. excludeCdrPingDuplicates.
 */
const CDR_PING_TEST_TYPES_REPLACED_BY_RAW = new Set(["ICMP Ping 40", "ICMP Ping 800"]);

/**
 * Βγάζει τα "ICMP Ping 40"/"ICMP Ping 800" rows από ένα batch /api/data_calls rows, πριν
 * μπουν στο summary PS Data pipeline — βλ. CDR_PING_TEST_TYPES_REPLACED_BY_RAW. Καλείται
 * στο Index.tsx πάνω στα raw summaryDataCallsRows, ΠΡΙΝ ενωθούν με τα
 * mapPing1000RowsToDataCallRows(summaryPing1000Rows) — η σειρά έχει σημασία, αλλιώς θα
 * μετρούσαν διπλά. Ό,τι άλλο test type (Capacity/HTTP Transfer/κ.λπ.) περνάει ανέπαφο.
 */
export const excludeCdrPingDuplicates = (rows: DataCallRow[]): DataCallRow[] =>
  rows.filter((row) => !CDR_PING_TEST_TYPES_REPLACED_BY_RAW.has(row.testType ?? ""));

/**
 * Μετατρέπει τα raw interactivity-test rows του /api/interactivity (FactInteractivity
 * — gaming/app pattern tests, δεν φτάνουν σαν δικό τους TestName από το CDRCombined
 * view του /api/data_calls, βλ. σχόλιο εκεί) σε DataCallRow σχήμα
 * (testType="Interactivity") ώστε να μπουν στο ίδιο buildDataSections pipeline με τα
 * υπόλοιπα PS Data tests — ίδιο σκεπτικό με mapOoklaRowsToDataCallRows/
 * mapPing1000RowsToDataCallRows. `host` κρατάει το PatternName (το test παράμετρο
 * που ξεχωρίζει ένα interactivity test, ίδιο σκεπτικό με row.app στο Ookla mapping) —
 * εμφανίζεται ως "Host=<PatternName>" στο DataSessionDetail. buildDataMetrics δείχνει
 * τα 5 "eGaming Average of..." metrics του Attachment C (Throughput/RTT/PacketsLostRate/
 * PacketDelay/QoEScore) — βλ. εκεί.
 */
export const mapInteractivityRowsToDataCallRows = (rows: InteractivityRow[]): DataCallRow[] =>
  rows.map((row) => ({
    Location: row.location,
    SessionId: row.sessionId,
    TestId: row.testId,
    callStartTimeStamp: null,
    testType: "Interactivity",
    direction: null,
    status: row.status,
    scoringStatus: row.status,
    host: row.patternName,
    pingRttAvg: null,
    throughputKbps: row.throughputKbps,
    capacityThroughputKbps: null,
    youtubeMos: null,
    youtubeInterruptions: null,
    interactivityQoeScore: row.qoeScore,
    interactivityRtt: row.rttAverage,
    interactivityPacketsLostRate: row.packetsLostRate,
    interactivityPacketDelay: row.packetDelayMedian,
    technology: row.technology,
    startTechnology: null,
    CollectionName: row.collectionName,
    ASideFileName: row.aSideFileName,
    isValid: 1,
    comment: null,
    latitude: null,
    longitude: null,
  }));

/**
 * Μετατρέπει τα ήδη-αθροισμένα (location, status, count, avg, minVal, maxVal, stdVal)
 * rows του /api/dns (KPIID=31100 — δεν φτάνει σαν δικό του TestName από το CDRCombined
 * view, βλ. σχόλιο στο /api/data_calls) σε DataCallRow σχήμα (testType="DNS") ώστε να
 * μπουν στο ίδιο buildDataSections pipeline με τα υπόλοιπα PS Data tests.
 *
 * Σε αντίθεση με τα Ookla/Ping1000/Interactivity mappings (raw, ένα row ανά πραγματικό
 * test), εδώ η SQL φτάνει ήδη ομαδοποιημένη ανά (location, status) — δεν έχουμε per-
 * attempt δείγματα. Για να δουλέψει σωστά το ίδιο weighted-average σκεπτικό με το
 * buildDataTestStats/buildDataMetrics (ένα row = ένα test), φτιάχνουμε `count`
 * συνθετικά rows ανά group με value = το group's avg — το unweighted mean πάνω σε
 * αυτά τα αντίγραφα ισοδυναμεί ακριβώς με το σωστό, count-σταθμισμένο mean μεταξύ
 * groups (sum(avg_i × count_i) / sum(count_i)). Η πραγματική min/max ανά attempt χάνεται
 * (όλα τα αντίγραφα ενός group έχουν την ίδια τιμή), αλλά το DataMetric δεν τη δείχνει
 * ούτως ή άλλως — μόνο τον μέσο όρο (βλ. buildDataMetrics's "dns" branch).
 *
 * `pingRttAvg` reused ως γενικό "duration σε ms" πεδίο (ίδιο σχήμα μετρικής με το
 * Ping — δες buildDataMetrics) — δεν σημαίνει RTT εδώ, σημαίνει DNS resolution time.
 */
export const mapDnsRowsToDataCallRows = (rows: DnsRow[]): DataCallRow[] =>
  rows.flatMap((row, groupIndex) =>
    Array.from({ length: Math.max(row.count, 0) }, (_, i) => ({
      Location: row.location,
      // Συνθετικό, μοναδικό ανά group — δεν αντιστοιχεί σε πραγματικό session.
      SessionId: `dns-${groupIndex}-${i}`,
      TestId: null,
      callStartTimeStamp: null,
      testType: "DNS",
      direction: null,
      status: row.status,
      scoringStatus: row.status,
      host: null,
      pingRttAvg: row.avg,
      throughputKbps: null,
      capacityThroughputKbps: null,
      youtubeMos: null,
      youtubeInterruptions: null,
      interactivityQoeScore: null,
      interactivityRtt: null,
      interactivityPacketsLostRate: null,
      interactivityPacketDelay: null,
      technology: null,
      startTechnology: null,
      CollectionName: null,
      ASideFileName: null,
      isValid: 1,
      comment: null,
      latitude: null,
      longitude: null,
    })),
  );

/* ────────────────────────── Technology mix ────────────────────────── */

/**
 * Ordinal ramp (ένα hue, 2G → 5G). Οι τεχνολογίες έχουν φυσική σειρά, οπότε
 * παίρνουν κλίμακα και όχι categorical χρώματα — έτσι δεν μπερδεύονται με τα
 * χρώματα των operators.
 */
export const TECHNOLOGY_BUCKETS = [
  { key: "2G", color: "#184f95", match: /gsm|edge|gprs/i },
  { key: "3G", color: "#256abf", match: /umts|hspa|wcdma|r99/i },
  { key: "4G", color: "#5598e7", match: /lte|e-utra/i },
  { key: "5G", color: "#9ec5f4", match: /\bnr\b|5g/i },
] as const;

export const OTHER_TECHNOLOGY = { key: "Other", color: UNKNOWN_OPERATOR_COLOR } as const;

export const bucketTechnology = (technology: string | null | undefined): string => {
  const value = (technology ?? "").trim();
  if (!value) return OTHER_TECHNOLOGY.key;
  // 5G πρώτα: το "LTE-5GNR" είναι NSA και μετράει ως 5G.
  const nr = TECHNOLOGY_BUCKETS.find((bucket) => bucket.key === "5G");
  if (nr && nr.match.test(value)) return nr.key;
  return TECHNOLOGY_BUCKETS.find((bucket) => bucket.match.test(value))?.key ?? OTHER_TECHNOLOGY.key;
};

export interface TechnologyShare {
  bucket: string;
  color: string;
  count: number;
  share: number;
}

export const buildTechnologyMix = (technologies: (string | null | undefined)[]): TechnologyShare[] => {
  const counts = new Map<string, number>();
  for (const technology of technologies) {
    const bucket = bucketTechnology(technology);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  const order = [...TECHNOLOGY_BUCKETS, OTHER_TECHNOLOGY];

  return order
    .filter((bucket) => (counts.get(bucket.key) ?? 0) > 0)
    .map((bucket) => {
      const count = counts.get(bucket.key) ?? 0;
      return { bucket: bucket.key, color: bucket.color, count, share: total > 0 ? count / total : 0 };
    });
};

/**
 * Σταθερά χρώματα για γνωστά bands (ίδια παλέτα με το QueryMap's "technology_free"
 * scheme, ώστε το ίδιο band να δείχνει ίδιο χρώμα σε όλη την εφαρμογή)· ό,τι band
 * δεν αναγνωρίζεται παίρνει χρώμα από FALLBACK_TECHNOLOGY_COLORS.
 */
const DETAILED_TECHNOLOGY_COLORS: Record<string, string> = {
  "GSM 900": "#00ffff",
  "GSM 1800": "#0000ff",
  "LTE E-UTRA 1": "#800000",
  "LTE E-UTRA 3": "#008000",
  "LTE E-UTRA 7": "#ff0000",
  "LTE E-UTRA 8": "#A24FFF",
  "LTE E-UTRA 20": "#ff9900",
  "LTE E-UTRA 28": "#800080",
};

const FALLBACK_TECHNOLOGY_COLORS = ["#767a8a", "#9a8f6a", "#6a9a8f", "#9a6a8f", "#8f9a6a"];

/** Γενιά → σειρά εμφάνισης, ίδια σειρά με το TECHNOLOGY_BUCKETS (2G → 5G, "Other" τελευταίο). */
const GENERATION_RANK = new Map<string, number>(
  [...TECHNOLOGY_BUCKETS, OTHER_TECHNOLOGY].map((bucket, index) => [bucket.key, index]),
);

const normalizeTechnologyLabel = (technology: string | null | undefined): string => {
  const value = (technology ?? "").replace(/\s+/g, " ").trim();
  return value || OTHER_TECHNOLOGY.key;
};

/** Κοινός πυρήνας: label -> count map σε ταξινομημένο TechnologyShare[] (γενιά, μετά πλήθος φθίνουσα). */
const detailedMixFromCounts = (counts: Map<string, number>): TechnologyShare[] => {
  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  const labels = Array.from(counts.keys()).sort((a, b) => {
    const rankA = GENERATION_RANK.get(bucketTechnology(a)) ?? GENERATION_RANK.get(OTHER_TECHNOLOGY.key)!;
    const rankB = GENERATION_RANK.get(bucketTechnology(b)) ?? GENERATION_RANK.get(OTHER_TECHNOLOGY.key)!;
    if (rankA !== rankB) return rankA - rankB;
    return (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
  });

  let fallbackIndex = 0;
  return labels.map((label) => {
    const count = counts.get(label) ?? 0;
    const color =
      label === OTHER_TECHNOLOGY.key
        ? OTHER_TECHNOLOGY.color
        : (DETAILED_TECHNOLOGY_COLORS[label] ?? FALLBACK_TECHNOLOGY_COLORS[fallbackIndex++ % FALLBACK_TECHNOLOGY_COLORS.length]);
    return { bucket: label, color, count, share: total > 0 ? count / total : 0 };
  });
};

/**
 * Λεπτομερές technology mix — κρατάει το raw band label (π.χ. "GSM 900" vs
 * "GSM 1800", κάθε "LTE E-UTRA N" ξεχωριστά) αντί να τα μαζεύει σε 2G/3G/4G/5G
 * όπως το buildTechnologyMix. Ταξινομημένο πρώτα κατά γενιά (ίδια σειρά με τα
 * buckets), μετά κατά πλήθος φθίνουσα μέσα στην ίδια γενιά.
 *
 * ΠΡΟΣΟΧΗ: δουλεύει πάνω στο `AllCallsRow.technology` (CA.technology), που είναι
 * χοντρικό (π.χ. "LTE", "GSM/LTE") — δεν έχει bands. Για πραγματικό ανά-band mix
 * («GSM 900» vs «GSM 1800», κ.λπ.) χρησιμοποίησε το buildTechnologyMixTable πάνω
 * στα δείγματα του /api/technology_mix (βλ. σχόλιο εκεί).
 */
export const buildDetailedTechnologyMix = (technologies: (string | null | undefined)[]): TechnologyShare[] => {
  const counts = new Map<string, number>();
  for (const technology of technologies) {
    const label = normalizeTechnologyLabel(technology);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return detailedMixFromCounts(counts);
};

/**
 * Πραγματικό ανά-band technology mix, από τα αθροισμένα GPS samples του
 * /api/technology_mix (ίδια μεθοδολογία με "bi queries/RadioTech_Voice_newDB.sql":
 * ένα sample ανά θέση πάνω σε κλήση, technology = NetworkInfo.Technology — πιάνει
 * και intra-call handovers, σε αντίθεση με το CA.technology του buildDetailedTechnologyMix).
 * Σπάει σε FREE/GSM ίδιο με το buildVoiceTable (resolveMode πάνω στο location) και μετά
 * ανά operator (resolveOperator) — ίδιο σχήμα με ένα VoiceTable, χωρίς VoiceStats.
 */
export const buildTechnologyMixTable = (
  rows: TechnologyMixRow[],
  mode: CallMode,
): { byOperator: Map<string, TechnologyShare[]>; total: TechnologyShare[] } => {
  const scoped = rows.filter((row) => resolveMode(row.location) === mode && (row.samples ?? 0) > 0);

  const totalCounts = new Map<string, number>();
  const perOperatorCounts = new Map<string, Map<string, number>>();

  for (const row of scoped) {
    const label = normalizeTechnologyLabel(row.technology);
    const samples = row.samples;

    totalCounts.set(label, (totalCounts.get(label) ?? 0) + samples);

    const operatorKey = resolveOperator(row.location).key;
    const operatorCounts = perOperatorCounts.get(operatorKey) ?? new Map<string, number>();
    operatorCounts.set(label, (operatorCounts.get(label) ?? 0) + samples);
    perOperatorCounts.set(operatorKey, operatorCounts);
  }

  const byOperator = new Map<string, TechnologyShare[]>();
  for (const [key, counts] of perOperatorCounts) byOperator.set(key, detailedMixFromCounts(counts));

  return { byOperator, total: detailedMixFromCounts(totalCounts) };
};

/* ────────────────────────── Serving Band / Serving Technology (per Time) ────────────────────────── */

/**
 * Σταθερή λίστα γραμμών, ίδια σειρά/labels με το reference SQL (Serving Band NR +
 * Serving Technology, για FTP DL / HTTP TRANSFER (DL) / Capacity DL — βλ.
 * /api/serving_band_tech). Το ποσοστό κάθε γραμμής υπολογίζεται πάνω στο δικό της
 * σύνολο: οι 3 πρώτες (BAND) πάνω στα δείγματα με γνωστό NR band, οι υπόλοιπες
 * (TECH, incl. "No data transfer") πάνω σε ΟΛΑ τα δείγματα του test scope.
 */
export interface ServingBandTechMetricDef {
  ord: number;
  label: string;
  kind: "BAND" | "TECH";
  code: string;
}

export const SERVING_BAND_TECH_METRICS: ServingBandTechMetricDef[] = [
  { ord: 1, label: "Serving Band (per Time) NR28 (%)", kind: "BAND", code: "NR28" },
  { ord: 2, label: "Serving Band (per Time) NR1 (%)", kind: "BAND", code: "NR1" },
  { ord: 3, label: "Serving Band (per Time) NR78 (%)", kind: "BAND", code: "NR78" },
  { ord: 5, label: "Serving Technology (per Time) LTE-5GNR (%)", kind: "TECH", code: "LTE-5GNR" },
  { ord: 6, label: "Serving Technology (per Time) LTE CA (%)", kind: "TECH", code: "LTE CA" },
  { ord: 7, label: "Serving Technology (per Time) LTE (%)", kind: "TECH", code: "LTE" },
  { ord: 8, label: "Serving Technology (per Time) HSPA+ (%)", kind: "TECH", code: "HSPA+" },
  { ord: 9, label: "Serving Technology (per Time) HSPA (%)", kind: "TECH", code: "HSPA" },
  { ord: 10, label: "Serving Technology (per Time) HSDPA (%)", kind: "TECH", code: "HSDPA" },
  { ord: 11, label: "Serving Technology (per Time) R99(CELL_FACH) (%)", kind: "TECH", code: "R99(CELL_FACH)" },
  { ord: 12, label: "Serving Technology (per Time) R99 (%)", kind: "TECH", code: "R99" },
  { ord: 13, label: "Serving Technology (per Time) HSUPA (%)", kind: "TECH", code: "HSUPA" },
  { ord: 14, label: "Serving Technology (per Time) GPRS (%)", kind: "TECH", code: "GPRS" },
  { ord: 15, label: "Serving Technology (per Time) HSPA-DC (%)", kind: "TECH", code: "HSPA-DC" },
  { ord: 16, label: "No data transfer (%)", kind: "TECH", code: "#NODATA" },
];

export interface ServingBandTechShare {
  ord: number;
  label: string;
  kind: "BAND" | "TECH";
  pct: number | null;
  samples: number;
  total: number;
}

const sumCounts = (counts: Map<string, number>): number => Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

const servingBandTechSharesFor = (bandCounts: Map<string, number>, techCounts: Map<string, number>): ServingBandTechShare[] => {
  const bandTotal = sumCounts(bandCounts);
  const techTotal = sumCounts(techCounts);

  return SERVING_BAND_TECH_METRICS.map((metric) => {
    const counts = metric.kind === "BAND" ? bandCounts : techCounts;
    const total = metric.kind === "BAND" ? bandTotal : techTotal;
    const samples = counts.get(metric.code) ?? 0;
    return { ord: metric.ord, label: metric.label, kind: metric.kind, pct: total > 0 ? samples / total : null, samples, total };
  });
};

/**
 * Ίδιο σχήμα με buildTechnologyMixTable, πάνω στα (location, kind, code, samples)
 * counts του /api/serving_band_tech: αθροίζει ανά operator (resolveOperator στο
 * location) και υπολογίζει τα 16 σταθερά ποσοστά ανά operator + σύνολο.
 */
export const buildServingBandTechTable = (
  rows: ServingBandTechRow[],
): { byOperator: Map<string, ServingBandTechShare[]>; total: ServingBandTechShare[] } => {
  const totalBandCounts = new Map<string, number>();
  const totalTechCounts = new Map<string, number>();
  const perOperatorBandCounts = new Map<string, Map<string, number>>();
  const perOperatorTechCounts = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const code = (row.code ?? "").trim();
    if (!code || !(row.samples > 0)) continue;

    const totalCounts = row.kind === "BAND" ? totalBandCounts : totalTechCounts;
    totalCounts.set(code, (totalCounts.get(code) ?? 0) + row.samples);

    const perOperatorCounts = row.kind === "BAND" ? perOperatorBandCounts : perOperatorTechCounts;
    const operatorKey = resolveOperator(row.location).key;
    const operatorCounts = perOperatorCounts.get(operatorKey) ?? new Map<string, number>();
    operatorCounts.set(code, (operatorCounts.get(code) ?? 0) + row.samples);
    perOperatorCounts.set(operatorKey, operatorCounts);
  }

  const operatorKeys = new Set<string>([...perOperatorBandCounts.keys(), ...perOperatorTechCounts.keys()]);
  const byOperator = new Map<string, ServingBandTechShare[]>();
  for (const operatorKey of operatorKeys) {
    byOperator.set(
      operatorKey,
      servingBandTechSharesFor(
        perOperatorBandCounts.get(operatorKey) ?? new Map<string, number>(),
        perOperatorTechCounts.get(operatorKey) ?? new Map<string, number>(),
      ),
    );
  }

  return { byOperator, total: servingBandTechSharesFor(totalBandCounts, totalTechCounts) };
};

/* ────────────────────────── Report metadata ────────────────────────── */

export interface ReportPeriod {
  from: Date | null;
  to: Date | null;
  /** ISO week number της πρώτης μέρας — το "Week:" του Attachment C. */
  week: number | null;
  /**
   * ISO week number της τελευταίας μέρας. Ίδιο με το `week` όταν όλα τα timestamps πέφτουν
   * μέσα στην ίδια εβδομάδα· διαφορετικό όταν η επιλογή (π.χ. παραπάνω από ένα collection,
   * το καθένα από άλλη εβδομάδα) καλύπτει περισσότερες — βλ. Week chip στο SummaryTab, που
   * δείχνει εύρος "από–έως" αντί για ένα (παραπλανητικό) νούμερο σε αυτή την περίπτωση.
   */
  weekTo: number | null;
}

/** ISO-8601 week number (Δευτέρα = 1η μέρα). */
export const isoWeek = (date: Date): number => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Πάμε στην Πέμπτη της ίδιας εβδομάδας: η χρονιά της ορίζει την ISO χρονιά.
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

export const buildReportPeriod = (timestamps: (string | null | undefined)[]): ReportPeriod => {
  const times = timestamps
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => !Number.isNaN(value));

  if (times.length === 0) return { from: null, to: null, week: null, weekTo: null };

  const from = new Date(Math.min(...times));
  const to = new Date(Math.max(...times));
  return { from, to, week: isoWeek(from), weekTo: isoWeek(to) };
};

/* ────────────────────────── Formatting ────────────────────────── */

export const formatPercent = (value: number | null, decimals = 2): string =>
  value == null ? "—" : `${(value * 100).toFixed(decimals)}%`;

export const formatNumber = (value: number | null, decimals = 2): string =>
  value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const formatCount = (value: number): string => value.toLocaleString("en-US");

export const formatMetric = (metric: DataMetric): string =>
  metric.value == null ? "—" : `${formatNumber(metric.value, metric.decimals)}${metric.unit ? ` ${metric.unit}` : ""}`;
