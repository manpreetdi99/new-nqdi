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
import type { AllCallsRow, CellBandCountRow, DataCallRow, ServingBandTechRow, SrvccRow, TechnologyMixRow } from "@/lib/api";

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
  if (loc.includes("free")) return "FREE";
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

export interface VoiceTable {
  mode: CallMode;
  byOperator: Map<string, VoiceStats>;
  total: VoiceStats;
}

/**
 * `cellBandCountRows` (βλ. buildCellBandCountTable) εφαρμόζεται μόνο όταν mode="GSM" —
 * το "Number of 900/1800 band Cells" δεν βγάζει νόημα στο FREE table. `srvccRows` (βλ.
 * buildSrvccTable) εφαρμόζεται μόνο όταν mode="FREE" — το αντίστροφο.
 */
export const buildVoiceTable = (
  rows: AllCallsRow[],
  mode: CallMode,
  cellBandCountRows: CellBandCountRow[] = [],
  srvccRows: SrvccRow[] = [],
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
  byOperator: Map<string, DataTestStats>;
  total: DataTestStats;
}

const DIRECTION_LABELS: Record<string, string> = { dl: "DL", ul: "UL", downlink: "DL", uplink: "UL" };

/** "Capacity" + "DL" → "Capacity DL", όπως τα section headers του Attachment C. */
const sectionLabel = (row: DataCallRow): string => {
  const test = (row.testType ?? "Unknown test").trim();
  const raw = (row.direction ?? "").trim().toLowerCase();
  const direction = DIRECTION_LABELS[raw] ?? (raw ? raw.toUpperCase() : "");
  return direction ? `${test} ${direction}` : test;
};

const buildDataMetrics = (rows: DataCallRow[]): DataMetric[] => {
  const testType = (rows[0]?.testType ?? "").toLowerCase();
  const collect = (pick: (row: DataCallRow) => number | null): Sample =>
    mean(rows.map(pick).filter((value): value is number => value != null && value > 0));

  if (testType.includes("ping")) {
    const rtt = collect((row) => numeric(row.pingRttAvg));
    return [{ label: "Mean RTT", unit: "ms", decimals: 1, higherIsBetter: false, value: rtt.avg, samples: rtt.samples }];
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

export const buildDataSections = (rows: DataCallRow[]): DataTestSection[] => {
  const sections = new Map<string, DataCallRow[]>();

  for (const row of rows) {
    const key = sectionLabel(row);
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

      return { key, label: key, byOperator, total: buildDataTestStats(sectionRows) };
    })
    .sort((a, b) => b.total.total - a.total.total || a.label.localeCompare(b.label));
};

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

  if (times.length === 0) return { from: null, to: null, week: null };

  const from = new Date(Math.min(...times));
  return { from, to: new Date(Math.max(...times)), week: isoWeek(from) };
};

/* ────────────────────────── Formatting ────────────────────────── */

export const formatPercent = (value: number | null, decimals = 2): string =>
  value == null ? "—" : `${(value * 100).toFixed(decimals)}%`;

export const formatNumber = (value: number | null, decimals = 2): string =>
  value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const formatCount = (value: number): string => value.toLocaleString("en-US");

export const formatMetric = (metric: DataMetric): string =>
  metric.value == null ? "—" : `${formatNumber(metric.value, metric.decimals)}${metric.unit ? ` ${metric.unit}` : ""}`;
