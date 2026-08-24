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
import type { AllCallsRow, DataCallRow, ServingBandTechRow, TechnologyMixRow } from "@/lib/api";

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
  /** MOC = A→B (mobile originated) */
  setupMoc: Sample;
  /** MTC = B→A (mobile terminated) */
  setupMtc: Sample;
  duration: Sample;
  /**
   * Ανά-band breakdown από το χοντρικό CA.technology (π.χ. "LTE", "GSM/LTE") — βλ.
   * buildDetailedTechnologyMix. Fallback μόνο: το SummaryTab προτιμά το πραγματικό
   * per-sample mix του /api/technology_mix (βλ. buildTechnologyMixTable) όταν
   * υπάρχει, γιατί αυτό εδώ δεν ξεχωρίζει π.χ. GSM 900 από GSM 1800.
   */
  technologyMix: TechnologyShare[];
  /** Bucketed codec breakdown — βλ. bucketCodec/buildCodecMix. Table 20's "Codec Type Usage %". */
  codecMix: CodecShare[];
}

export const EMPTY_VOICE_STATS: VoiceStats = {
  attempts: 0,
  completed: 0,
  dropped: 0,
  failed: 0,
  sysRelease: 0,
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
  duration: EMPTY_SAMPLE,
  technologyMix: [],
  codecMix: [],
};

/* ────────────────────────── Codec mix ────────────────────────── */

/**
 * Bucketing rules ίδιες με το CallCodecTypeUsageGSM.sql / "Codec Type Usage %"
 * query (CASE πάνω σε vvct.CodecName): AMR-WB, AMR HR, AMR, EFR, HR, FR,
 * "no codec rate" — οτιδήποτε άλλο περνάει ως-έχει.
 */
export const bucketCodec = (codecName: string | null | undefined): string => {
  const raw = (codecName ?? "").trim();
  if (!raw || raw === "-" || raw.toLowerCase() === "no codec rate") return "no codec rate";

  const upper = raw.toUpperCase();
  if (upper.includes("AMR") && upper.includes("WB")) return "FR AMR WB";
  if (upper.includes("AMR") && upper.includes("HR")) return "AMR HR";
  if (upper.includes("AMR")) return "AMR";
  if (upper.includes("EFR")) return "EFR";
  if (upper.startsWith("HR")) return "HR";
  if (upper.startsWith("FR")) return "FR";
  return raw;
};

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

export const buildCodecMix = (codecNames: (string | null | undefined)[]): CodecShare[] => {
  const counts = new Map<string, number>();
  for (const name of codecNames) {
    const bucket = bucketCodec(name);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
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

const isMoc = (callDir: string | null | undefined): boolean => /a\s*->\s*b/i.test(callDir ?? "");
const isMtc = (callDir: string | null | undefined): boolean => /b\s*->\s*a/i.test(callDir ?? "");

export const buildVoiceStats = (rows: AllCallsRow[]): VoiceStats => {
  const counts = { completed: 0, sysRelease: 0, dropped: 0, failed: 0 };
  const mosValues: number[] = [];
  const mosUlAgg = emptyAgg();
  const mosDlAgg = emptyAgg();
  const setupAll: number[] = [];
  const setupMoc: number[] = [];
  const setupMtc: number[] = [];
  const durations: number[] = [];
  const technologyNames: (string | null | undefined)[] = [];
  const codecNames: (string | null | undefined)[] = [];
  let lowQualityCalls = 0;
  let badQualityCalls = 0;

  for (const row of rows) {
    counts[classifyCallStatus(row.status)]++;

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
    if (setup != null && setup > 0) {
      setupAll.push(setup);
      if (isMoc(row.callDir)) setupMoc.push(setup);
      else if (isMtc(row.callDir)) setupMtc.push(setup);
    }

    const duration = numeric(row.callDuration);
    if (duration != null && duration > 0) durations.push(duration);

    technologyNames.push(row.technology);
    codecNames.push(row.codecName);
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
    duration: mean(durations),
    technologyMix: buildDetailedTechnologyMix(technologyNames),
    codecMix: buildCodecMix(codecNames),
  };
};

export interface VoiceTable {
  mode: CallMode;
  byOperator: Map<string, VoiceStats>;
  total: VoiceStats;
}

export const buildVoiceTable = (rows: AllCallsRow[], mode: CallMode): VoiceTable => {
  const scoped = rows.filter((row) => resolveMode(row.Location) === mode);
  const grouped = new Map<string, AllCallsRow[]>();

  for (const row of scoped) {
    const key = resolveOperator(row.Location).key;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const byOperator = new Map<string, VoiceStats>();
  for (const [key, operatorRows] of grouped) {
    byOperator.set(key, buildVoiceStats(operatorRows));
  }

  return { mode, byOperator, total: buildVoiceStats(scoped) };
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
