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
 * Σταθερά χρώματα ανά operator (dataviz categorical slots 1-3, validated
 * all-pairs για dark surface). Το χρώμα ακολουθεί την οντότητα: ένα φίλτρο που
 * κόβει operator δεν ξαναβάφει τους υπόλοιπους.
 */
const OPERATOR_SLOTS: { key: string; label: string; color: string; match: RegExp }[] = [
  { key: "COSMOTE", label: "COSMOTE", color: "#3987e5", match: /cosmote/i },
  { key: "VODAFONE", label: "VODAFONE", color: "#d95926", match: /vodafone/i },
  { key: "NOVA", label: "NOVA", color: "#199e70", match: /nova|wind/i },
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
}

const EMPTY_SAMPLE: Sample = { avg: null, samples: 0 };

const mean = (values: number[]): Sample =>
  values.length === 0
    ? EMPTY_SAMPLE
    : { avg: values.reduce((sum, v) => sum + v, 0) / values.length, samples: values.length };

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

const numeric = (value: number | null | undefined): number | null =>
  value == null || Number.isNaN(Number(value)) ? null : Number(value);

/* ────────────────────────── TABLE 20 / 21 — Voice ────────────────────────── */

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
  mos: Sample;
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
  mos: EMPTY_SAMPLE,
  lowQualityCalls: 0,
  badQualityCalls: 0,
  setupAll: EMPTY_SAMPLE,
  setupMoc: EMPTY_SAMPLE,
  setupMtc: EMPTY_SAMPLE,
  duration: EMPTY_SAMPLE,
  technologyMix: [],
};

/** POLQA thresholds — ίδια με το Attachment C. */
export const LOW_QUALITY_MOS = 2.2;
export const BAD_QUALITY_MOS = 1.3;

const isMoc = (callDir: string | null | undefined): boolean => /a\s*->\s*b/i.test(callDir ?? "");
const isMtc = (callDir: string | null | undefined): boolean => /b\s*->\s*a/i.test(callDir ?? "");

export const buildVoiceStats = (rows: AllCallsRow[]): VoiceStats => {
  const counts = { completed: 0, sysRelease: 0, dropped: 0, failed: 0 };
  const mosValues: number[] = [];
  const setupAll: number[] = [];
  const setupMoc: number[] = [];
  const setupMtc: number[] = [];
  const durations: number[] = [];
  const technologies = new Map<string, number>();
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
  }

  const attempts = rows.length;
  const connections = attempts - counts.failed;

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
    mos: mean(mosValues),
    lowQualityCalls,
    badQualityCalls,
    setupAll: mean(setupAll),
    setupMoc: mean(setupMoc),
    setupMtc: mean(setupMtc),
    duration: mean(durations),
    technologyMix: Array.from(technologies.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
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
