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
import type { AllCallsRow, DataCallRow } from "@/lib/api";

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
  technologyMix: { name: string; count: number }[];
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
  const technologies = new Map<string, number>();
  const codecNames: (string | null | undefined)[] = [];
  let lowQualityCalls = 0;
  let badQualityCalls = 0;

  for (const row of rows) {
    counts[classifyCallStatus(row.status)]++;

    const mos = numeric(row.Avg_mos);
    if (mos != null && mos > 0) {
      mosValues.push(mos);
      if (mos < LOW_QUALITY_MOS) lowQualityCalls++;
      if (mos < BAD_QUALITY_MOS) badQualityCalls++;
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

    const technology = (row.technology ?? "").trim();
    if (technology) technologies.set(technology, (technologies.get(technology) ?? 0) + 1);

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
    technologyMix: Array.from(technologies.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
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
