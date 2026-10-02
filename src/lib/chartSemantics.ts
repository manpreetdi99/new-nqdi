/**
 * Σημασιολογία στηλών για τα charts του Query Editor (βλ. ResultCharts.tsx).
 *
 * Ένα ad-hoc query μπορεί να φέρει πολύ διαφορετικά είδη αριθμών, και το ποια συνάρτηση
 * δίνει σωστό νούμερο όταν ενώνεις γραμμές (ανά operator, ανά collection, ανά bin)
 * εξαρτάται ΑΠΟΚΛΕΙΣΤΙΚΑ από το είδος:
 *
 *   - raw δείγματα (RSRP ανά μέτρηση, MOS ανά κλήση)          → AVG / median / P10 / P90
 *   - 0/1 flags (CallDropped, Success — alev "LQCallData.sql", "PING RAW.sql")
 *                                                              → % (Σ flag / γραμμές) ή Σ
 *   - ήδη-μετρημένα πλήθη (Num, total_calls, samples)          → SUM
 *   - ήδη-μέσοι όροι / ποσοστά (avg_rsrp, bad_call_pct)        → σταθμισμένος μέσος με το
 *                                                                πλήθος της ίδιας γραμμής
 *   - αθροίσματα-για-μέσο: το alev "Avg" είναι AVG(x)*COUNT(x) (= Σx) και ζευγαρώνει με
 *     το "Num"· ίδια λογική τα SumLQ/NumLQ του "LQStatisticData.sql"   → Σ Avg / Σ Num
 *
 * Ένα απλό AVG πάνω σε ήδη-μέσους όρους ή ένα SUM πάνω σε dBm βγάζει λάθος νούμερο — ίδιο
 * λάθος με το AVG(TOTAL_SCORE) χωρίς στάθμιση που εξηγεί το backend/routers/historic.py.
 * Εδώ αναγνωρίζουμε το είδος από όνομα + τιμές, δίνουμε σε κάθε στήλη τη σωστή default
 * συνάρτηση και μόνο τις συναρτήσεις που έχουν νόημα γι' αυτήν.
 *
 * Τα "splits" ακολουθούν τα A-LEVEL reports: operator + mode βγαίνουν από το ASideLocation
 * ("Cosmote Free A" → COSMOTE / FREE, ίδιοι κανόνες με το attachmentC.ts) και scope +
 * κατηγορία περιοχής από το CollectionName ("…_MAJOR CITIES_2026H2", ίδιο PARSENAME split
 * με το historic.py).
 *
 * Όλα εδώ είναι pure functions — το ResultCharts μόνο τα καλεί και ζωγραφίζει.
 */
import { resolveMode, resolveOperator } from "@/lib/attachmentC";

/* ────────────────────────── Τύποι ────────────────────────── */

export type ColumnRole =
  | "id" // SessionId, TestId… — μόνο πλήθος διακριτών
  | "time" // timestamps
  | "dimension" // κείμενο ή κωδικοί (PCI, EARFCN, BCCH) — X / split, όχι μέτρο
  | "flag" // 0/1
  | "count" // ήδη-μετρημένο πλήθος
  | "sum" // ήδη-αθροισμένο μέγεθος (ίσως με παρονομαστή → μέσος)
  | "mean" // ήδη-μέσος όρος
  | "percent" // ήδη-ποσοστό
  | "min"
  | "max"
  | "spread" // STDEV — δεν συνδυάζεται σωστά
  | "coord" // lat/lon/altitude
  | "measure"; // raw αριθμητικό δείγμα

export type AggKind =
  | "avg"
  | "wavg" // σταθμισμένος μέσος με weightCol
  | "sum"
  | "count" // πλήθος μη-κενών τιμών (γραμμών για ROWS_COL)
  | "distinct"
  | "rate" // % γραμμών όπου το flag = 1
  | "ratio" // Σ col / Σ denomCol (× scale)
  | "min"
  | "max"
  | "median"
  | "p10"
  | "p90";

/** Ψευδο-στήλη "πλήθος γραμμών". */
export const ROWS_COL = "@rows";
export const OPERATOR_COL = "@operator";
export const MODE_COL = "@mode";
export const SCOPE_COL = "@scope";
export const CATEGORY_COL = "@category";

export const OTHER_LABEL = "Άλλα";
export const BLANK_LABEL = "(κενό)";
export const TOTAL_LABEL = "Σύνολο";

export type Row = Record<string, unknown>;
export type Accessor = (row: Row, col: string) => unknown;

export interface ColumnProfile {
  col: string;
  label: string;
  role: ColumnRole;
  derived: boolean;
  numeric: boolean;
  integer: boolean;
  /** Διακριτές τιμές στο δείγμα (έως DISTINCT_CAP). */
  distinct: number;
  nonNull: number;
  min: number | null;
  max: number | null;
  /** Στήλη πλήθους που σταθμίζει έναν ήδη-μέσο όρο (avg_rsrp ← samples). */
  weightCol?: string;
  /** Παρονομαστής για Σ/Σ (alev "Avg" ← "Num", SumLQ ← NumLQ). */
  denomCol?: string;
  unit?: string;
  /** Φυσικό πλάτος bin για κατανομή (MOS 0.1, RSRP 2 dB…). */
  binWidth?: number;
}

export interface DerivedDim {
  key: string;
  label: string;
  source: string;
  get: (row: Row) => string | null;
}

export interface MeasureSpec {
  /** Σταθερό κλειδί σειράς — επιτρέπει την ίδια στήλη με δύο συναρτήσεις (RSRP avg + P10). */
  id: string;
  col: string;
  agg: AggKind;
  weightCol?: string;
  denomCol?: string;
  /** 100 για ποσοστό σε ratio. */
  scale?: number;
  label?: string;
}

/* ────────────────────────── Τιμές ────────────────────────── */

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
// CONVERT(varchar, x, 104) των alev queries: "26.09.2026" (+ προαιρετική ώρα)
const DMY_RE = /^(\d{2})[./](\d{2})[./](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** ISO (όπως τα στέλνει το FastAPI) ή dd.mm.yyyy → epoch ms σε τοπική ώρα. */
export function parseTime(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (ISO_RE.test(s)) {
    const ms = Date.parse(s.length > 10 ? s.replace(" ", "T") : `${s}T00:00:00`);
    return Number.isFinite(ms) ? ms : null;
  }
  const m = DMY_RE.exec(s);
  if (m) {
    return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
  }
  return null;
}

const norm = (col: string) => col.toLowerCase().replace(/[^a-z0-9]/g, "");

export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, "el", { numeric: true, sensitivity: "base" });

/* ────────────────────────── Ρόλοι στηλών ────────────────────────── */

// Κωδικοί που μοιάζουν αριθμοί αλλά είναι ταυτότητες κυψέλης/καναλιού — X/split, ποτέ AVG.
const CODE_RE =
  /^(earfcn|arfcn|uarfcn|nrarfcn|absfreqssb|pci|phycellid|psc|sc\d|nisc\d|bcch|nibcch|btsbcch|bsic|btsbsic|lac|tac|cid|ci|nci|nrcellid|enbid|cellid|mcc|mnc|band|nband|rfband|codecrate|errorcode|kpiid|code|qualitycode|appl|jtid|speedcategory|carrierindex|carrierindexname)$/;
const COORD_RE = /^(lat|lon|lng|latitude|longitude|latitudea|longitudea|altitude|direction|positiondirection|heading)$/;
const ID_RE = /(^|[a-z])id[ab]?$|^dmnid|^(seqnumber|sequencenumber|binid|rowid|rownum)$/;
const SPREAD_RE = /stdev|stddev|stdval|^std/;
const MIN_RE = /^min|min$/;
const MAX_RE = /^max|max$/;
const PERCENT_RE = /pct|percent|percentage|ratio|rate$|^(cssr|csr|dcr|afr|srr)$/;
const NOT_PERCENT_RE = /bitrate|codecrate|framerate|datarate|samplerate/;
const MEAN_RE = /^(avg|mean|average)|(avg|mean|average)$/;
const SUM_RE = /^sum|sum$|^total(mb|kb|gb|bytes|duration)|bytes|kbyte|transferred|testduration/;
const COUNT_EXACT_RE = /^(gsum|num|cnt|count|n)$/;
const COUNT_RE =
  /^(num|cnt|count|total|samples?|measurements|calls|tests|attempts|sessions)|(count|calls|tests|samples?|attempts|sessions|measurements)$|^(dropfail|badcalls)$/;

// Προτεραιότητα για τη στήλη που σταθμίζει ήδη-μέσους όρους: η "βάση" του group, όχι
// υποσύνολο (bad_calls / failed_tests μετράνε μόνο ένα κομμάτι των γραμμών).
const WEIGHT_PRIORITY = [
  "samples", "samplecount", "samplestotal", "measurements", "num", "numlq", "countlq", "count",
  "calls", "totalcalls", "tests", "sessions", "attempts", "gsum", "total",
];
const SUBSET_COUNT_RE = /bad|fail|drop|success|silence|complete/;

function unitOf(n: string, col: string): { unit?: string; binWidth?: number } {
  if (/rsrp|rssi|rxlev|rscp|txpwr|rxpwr|txpower/.test(n)) return { unit: "dBm", binWidth: 2 };
  if (/rsrq|sinr|ecio|snr|ecno/.test(n)) return { unit: "dB", binWidth: 1 };
  if (/rxqual/.test(n)) return { binWidth: 1 };
  if (/mos|optionalwb|optionalnb|lqwb|lqnb|^lq|avgsq|minsq|visualquality|sessionquality/.test(n)) {
    return { unit: "MOS", binWidth: 0.1 };
  }
  if (/mbps/.test(n)) return { unit: "Mbps" };
  if (/kbps/.test(n)) return { unit: "kbps" };
  if (col.includes("%") || /pct|percent|percentage/.test(n)) return { unit: "%" };
  if (/ms$|rtt|latency|ping/.test(n)) return { unit: "ms" };
  return {};
}

interface RawStats {
  nonNull: number;
  numeric: number;
  time: number;
  integer: boolean;
  binary: boolean;
  min: number | null;
  max: number | null;
  distinct: Set<string>;
}

const DISTINCT_CAP = 2000;
const PROFILE_SAMPLE = 2000;

/** Ομοιόμορφο δείγμα — τα rows έρχονται συχνά ταξινομημένα, τα πρώτα N δεν είναι αντιπροσωπευτικά. */
export function evenSample<T>(rows: T[], size = PROFILE_SAMPLE): T[] {
  if (rows.length <= size) return rows;
  const step = rows.length / size;
  const out: T[] = [];
  for (let i = 0; i < size; i++) out.push(rows[Math.floor(i * step)]);
  return out;
}

function scanColumn(sample: Row[], get: (row: Row) => unknown): RawStats {
  const s: RawStats = { nonNull: 0, numeric: 0, time: 0, integer: true, binary: true, min: null, max: null, distinct: new Set() };
  for (const row of sample) {
    const v = get(row);
    if (v === null || v === undefined || v === "") continue;
    s.nonNull++;
    if (s.distinct.size < DISTINCT_CAP) s.distinct.add(String(v));
    const n = toNum(v);
    if (n !== null) {
      s.numeric++;
      if (!Number.isInteger(n)) s.integer = false;
      if (n !== 0 && n !== 1) s.binary = false;
      if (s.min === null || n < s.min) s.min = n;
      if (s.max === null || n > s.max) s.max = n;
    } else if (parseTime(v) !== null) {
      s.time++;
    }
  }
  return s;
}

function detectRole(col: string, s: RawStats): ColumnRole {
  const n = norm(col);
  const numeric = s.nonNull > 0 && s.numeric >= 0.9 * s.nonNull;
  if (!numeric) return s.nonNull > 0 && s.time >= 0.9 * s.nonNull ? "time" : "dimension";
  if (CODE_RE.test(n)) return "dimension";
  if (COORD_RE.test(n)) return "coord";
  if (s.binary) return "flag";
  if (ID_RE.test(n)) return "id";
  if (SPREAD_RE.test(n)) return "spread";
  if (COUNT_EXACT_RE.test(n) && s.integer) return "count";
  if (MIN_RE.test(n)) return "min";
  if (MAX_RE.test(n)) return "max";
  if ((PERCENT_RE.test(n) && !NOT_PERCENT_RE.test(n)) || col.includes("%")) return "percent";
  if (SUM_RE.test(n)) return "sum";
  if (MEAN_RE.test(n)) return "mean";
  if (COUNT_RE.test(n) && s.integer && (s.min ?? 0) >= 0) return "count";
  return "measure";
}

/* ────────────────────────── Παράγωγα splits ────────────────────────── */

const LOCATION_SOURCES = ["asidelocation", "location", "operator", "servingoperator", "homeoperator"];
const COLLECTION_SOURCES = ["collectionname", "collections"];
const SCOPE_SEGMENT_RE = /^\d{4}H[12]$/i;
const KNOWN_OPERATOR_RE = /cosmote|vodafone|nova|wind/i;

function cached(fn: (v: string) => string | null) {
  const cache = new Map<string, string | null>();
  return (v: unknown): string | null => {
    if (v === null || v === undefined || v === "") return null;
    const key = String(v);
    let out = cache.get(key);
    if (out === undefined) {
      out = fn(key);
      cache.set(key, out);
    }
    return out;
  };
}

const collectionSegments = (v: string) => v.split("_").map((part) => part.trim()).filter(Boolean);
const lastSegment = (v: string) => {
  const parts = collectionSegments(v);
  return parts[parts.length - 1] ?? "";
};

/**
 * Operator / Mode από το ASideLocation, Scope / Κατηγορία από το CollectionName — τα
 * splits των A-LEVEL πινάκων, διαθέσιμα σαν στήλες ακόμα κι όταν το query δεν τα φέρνει.
 */
export function deriveDimensions(columns: string[], rows: Row[]): DerivedDim[] {
  const sample = evenSample(rows, 500);
  const out: DerivedDim[] = [];
  const share = (col: string, test: (v: string) => boolean) => {
    let hit = 0;
    let total = 0;
    for (const row of sample) {
      const v = row[col];
      if (v === null || v === undefined || v === "") continue;
      total++;
      if (test(String(v))) hit++;
    }
    return total === 0 ? 0 : hit / total;
  };

  const locationCol = LOCATION_SOURCES.map((key) => columns.find((c) => norm(c) === key)).find(
    (c): c is string => c != null && share(c, (v) => KNOWN_OPERATOR_RE.test(v)) >= 0.6,
  );
  if (locationCol) {
    // Μόνο όταν προσθέτει κάτι: αν η στήλη είναι ήδη σκέτο "COSMOTE"/"VODAFONE", δεν ξαναβγαίνει.
    const redundant = share(locationCol, (v) => resolveOperator(v).key === v.trim().toUpperCase()) >= 0.99;
    if (!redundant) {
      const get = cached((v) => resolveOperator(v).key);
      out.push({ key: OPERATOR_COL, label: `Operator ← ${locationCol}`, source: locationCol, get: (row) => get(row[locationCol]) });
    }
    if (share(locationCol, (v) => resolveMode(v) !== "OTHER") >= 0.6) {
      const get = cached((v) => resolveMode(v));
      out.push({ key: MODE_COL, label: `Mode (GSM/FREE/DATA) ← ${locationCol}`, source: locationCol, get: (row) => get(row[locationCol]) });
    }
  }

  const collectionCol = COLLECTION_SOURCES.map((key) => columns.find((c) => norm(c) === key)).find(
    (c): c is string =>
      c != null && share(c, (v) => SCOPE_SEGMENT_RE.test(lastSegment(v))) >= 0.6,
  );
  if (collectionCol) {
    const getScope = cached((v) => {
      const last = lastSegment(v);
      return SCOPE_SEGMENT_RE.test(last) ? last.toUpperCase() : null;
    });
    out.push({ key: SCOPE_COL, label: `Scope ← ${collectionCol}`, source: collectionCol, get: (row) => getScope(row[collectionCol]) });
    const getCategory = cached((v) => {
      const parts = collectionSegments(v);
      return parts.length >= 3 && SCOPE_SEGMENT_RE.test(parts[parts.length - 1]) ? parts[parts.length - 2].toUpperCase() : null;
    });
    if (share(collectionCol, (v) => getCategory(v) !== null) >= 0.6) {
      out.push({ key: CATEGORY_COL, label: `Κατηγορία περιοχής ← ${collectionCol}`, source: collectionCol, get: (row) => getCategory(row[collectionCol]) });
    }
  }
  return out;
}

export function makeAccessor(derived: DerivedDim[]): Accessor {
  if (derived.length === 0) return (row, col) => row[col];
  const map = new Map(derived.map((d) => [d.key, d]));
  return (row, col) => {
    const d = map.get(col);
    return d ? d.get(row) : row[col];
  };
}

/* ────────────────────────── Profiling ────────────────────────── */

export function profileColumns(columns: string[], rows: Row[], derived: DerivedDim[] = []): ColumnProfile[] {
  const sample = evenSample(rows);
  const profiles: ColumnProfile[] = [];

  for (const d of derived) {
    const s = scanColumn(sample, d.get);
    profiles.push({
      col: d.key, label: d.label, role: "dimension", derived: true, numeric: false, integer: false,
      distinct: s.distinct.size, nonNull: s.nonNull, min: null, max: null,
    });
  }

  for (const col of columns) {
    const s = scanColumn(sample, (row) => row[col]);
    const role = detectRole(col, s);
    const numeric = role !== "dimension" && role !== "time";
    profiles.push({
      col, label: col, role, derived: false, numeric,
      integer: s.integer, distinct: s.distinct.size, nonNull: s.nonNull, min: s.min, max: s.max,
      ...(numeric ? unitOf(norm(col), col) : {}),
    });
  }

  // Ζευγάρια Σ/πλήθος: alev "Avg" (= AVG*COUNT) ↔ "Num", SumLQ ↔ NumLQ, SumX ↔ CountX.
  const byNorm = new Map(profiles.filter((p) => !p.derived).map((p) => [norm(p.col), p]));
  const counts = profiles.filter((p) => p.role === "count");
  for (const p of profiles) {
    if (p.derived || !p.numeric) continue;
    const n = norm(p.col);
    if ((n === "avg" || n === "cavg") && byNorm.get("num")?.role === "count") {
      p.role = "sum";
      p.denomCol = byNorm.get("num")!.col;
      continue;
    }
    if (p.role === "sum" && n.startsWith("sum") && n.length > 3) {
      const suffix = n.slice(3);
      const denom = [`num${suffix}`, `count${suffix}`, `${suffix}count`].map((k) => byNorm.get(k)).find((c) => c?.role === "count");
      if (denom) p.denomCol = denom.col;
    }
    if ((p.role === "mean" || p.role === "percent") && counts.length > 0) {
      const preferred = WEIGHT_PRIORITY.map((k) => counts.find((c) => norm(c.col) === k)).find(Boolean);
      const fallback = counts.find((c) => !SUBSET_COUNT_RE.test(norm(c.col)));
      const weight = preferred ?? fallback;
      if (weight) p.weightCol = weight.col;
    }
  }
  return profiles;
}

/* ────────────────────────── Συναρτήσεις ανά ρόλο ────────────────────────── */

const NON_ADDITIVE_UNITS = new Set(["dBm", "dB", "MOS", "%"]);

export function defaultAgg(p: ColumnProfile): AggKind {
  switch (p.role) {
    case "mean":
    case "percent":
      return p.weightCol ? "wavg" : "avg";
    case "count":
      return "sum";
    case "sum":
      return p.denomCol ? "ratio" : "sum";
    case "flag":
      return "rate";
    case "min":
      return "min";
    case "max":
      return "max";
    case "id":
      return "distinct";
    case "dimension":
    case "time":
      return "distinct";
    default:
      return "avg";
  }
}

/** Μόνο οι συναρτήσεις που βγάζουν νούμερο με νόημα — π.χ. ποτέ SUM σε dBm ή σε avg_mos. */
export function allowedAggs(p: ColumnProfile | undefined): AggKind[] {
  if (!p) return ["count"];
  switch (p.role) {
    case "measure": {
      const additive = !NON_ADDITIVE_UNITS.has(p.unit ?? "") && (p.min ?? 0) >= 0;
      return additive
        ? ["avg", "median", "p10", "p90", "min", "max", "sum", "count"]
        : ["avg", "median", "p10", "p90", "min", "max", "count"];
    }
    case "mean":
    case "percent":
      return p.weightCol ? ["wavg", "avg", "min", "max"] : ["avg", "min", "max"];
    case "count":
      return ["sum", "avg", "min", "max"];
    case "sum":
      return p.denomCol ? ["ratio", "sum", "avg"] : ["sum", "avg", "min", "max"];
    case "flag":
      return ["rate", "sum", "count", "avg"];
    case "min":
      return ["min", "avg"];
    case "max":
      return ["max", "avg"];
    case "spread":
      return ["avg", "max"];
    case "coord":
      return ["avg", "min", "max"];
    default:
      return ["distinct", "count"];
  }
}

/** Αθροιστικές συναρτήσεις — μόνο αυτές βγάζουν "κομμάτια ενός όλου" (pie, 100% stack). */
export const isAdditive = (m: Pick<MeasureSpec, "agg">) => m.agg === "sum" || m.agg === "count";

export const AGG_LABEL: Record<AggKind, string> = {
  avg: "AVG",
  wavg: "AVG σταθμ.",
  sum: "SUM",
  count: "COUNT",
  distinct: "DISTINCT",
  rate: "%",
  ratio: "Σ/Σ",
  min: "MIN",
  max: "MAX",
  median: "MEDIAN",
  p10: "P10",
  p90: "P90",
};

export function measureFromColumn(p: ColumnProfile, agg: AggKind = defaultAgg(p), id?: string): MeasureSpec {
  return {
    id: id ?? `${p.col}|${agg}`,
    col: p.col,
    agg,
    ...(agg === "wavg" && p.weightCol ? { weightCol: p.weightCol } : {}),
    ...(agg === "ratio" && p.denomCol ? { denomCol: p.denomCol } : {}),
  };
}

export const rowsMeasure = (): MeasureSpec => ({ id: `${ROWS_COL}|count`, col: ROWS_COL, agg: "count", label: "Πλήθος γραμμών" });

export function measureLabel(m: MeasureSpec, labelOf: (col: string) => string = (c) => c): string {
  if (m.label) return m.label;
  if (m.col === ROWS_COL) return "Πλήθος γραμμών";
  if (m.agg === "ratio" && m.denomCol) {
    return `Σ ${labelOf(m.col)} / Σ ${labelOf(m.denomCol)}${m.scale === 100 ? " %" : ""}`;
  }
  return `${labelOf(m.col)} · ${AGG_LABEL[m.agg]}`;
}

/** Μία πρόταση που εξηγεί ΠΩΣ βγαίνει η τιμή — εμφανίζεται κάτω από το chart. */
export function describeMeasure(m: MeasureSpec, labelOf: (col: string) => string = (c) => c): string {
  const c = labelOf(m.col);
  switch (m.agg) {
    case "avg":
      return `μέσος όρος του ${c}`;
    case "wavg":
      return `σταθμισμένος μέσος του ${c} με βάρος ${m.weightCol ? labelOf(m.weightCol) : "—"}`;
    case "sum":
      return `άθροισμα Σ ${c}`;
    case "count":
      return m.col === ROWS_COL ? "πλήθος γραμμών" : `πλήθος μη-κενών τιμών του ${c}`;
    case "distinct":
      return `πλήθος διακριτών ${c}`;
    case "rate":
      return `% γραμμών με ${c} = 1 (Σ ${c} / γραμμές)`;
    case "ratio":
      return `Σ ${c} / Σ ${m.denomCol ? labelOf(m.denomCol) : "—"}${m.scale && m.scale !== 1 ? ` × ${m.scale}` : ""}`;
    case "min":
      return `ελάχιστο ${c}`;
    case "max":
      return `μέγιστο ${c}`;
    case "median":
      return `διάμεσος (P50) του ${c}`;
    case "p10":
      return `10ο εκατοστημόριο του ${c}`;
    case "p90":
      return `90ο εκατοστημόριο του ${c}`;
  }
}

/* ────────────────────────── Accumulators ────────────────────────── */

interface Acc {
  rows: number;
  n: number;
  sum: number;
  w: number;
  wsum: number;
  den: number;
  min: number;
  max: number;
  vals: number[] | null;
  set: Set<string> | null;
}

const newAcc = (m: MeasureSpec): Acc => ({
  rows: 0, n: 0, sum: 0, w: 0, wsum: 0, den: 0, min: Infinity, max: -Infinity,
  vals: m.agg === "median" || m.agg === "p10" || m.agg === "p90" ? [] : null,
  set: m.agg === "distinct" ? new Set() : null,
});

function accumulate(acc: Acc, row: Row, m: MeasureSpec, get: Accessor) {
  acc.rows++;
  if (m.col === ROWS_COL) {
    acc.n++;
    return;
  }
  if (acc.set) {
    const v = get(row, m.col);
    if (v !== null && v !== undefined && v !== "") acc.set.add(String(v));
    return;
  }
  const y = toNum(get(row, m.col));
  if (y === null) return;
  acc.n++;
  acc.sum += y;
  if (y < acc.min) acc.min = y;
  if (y > acc.max) acc.max = y;
  if (m.agg === "ratio" && m.denomCol) {
    // Ο παρονομαστής μετράει μόνο όπου υπάρχει αριθμητής: στο alev browsing ένα Failed
    // group έχει Num αλλά κενό Avg — δεν πρέπει να "αραιώνει" τον μέσο όρο των επιτυχημένων.
    const d = toNum(get(row, m.denomCol));
    if (d !== null) acc.den += d;
  } else if (m.agg === "wavg" && m.weightCol) {
    const w = toNum(get(row, m.weightCol));
    if (w !== null && w > 0) {
      acc.w += w;
      acc.wsum += y * w;
    }
  }
  acc.vals?.push(y);
}

export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function finalize(acc: Acc, m: MeasureSpec): number | null {
  switch (m.agg) {
    case "count":
      return acc.n;
    case "distinct":
      return acc.set?.size ?? 0;
    case "sum":
      return acc.n ? acc.sum : null;
    case "avg":
      return acc.n ? acc.sum / acc.n : null;
    case "wavg":
      return acc.w > 0 ? acc.wsum / acc.w : acc.n ? acc.sum / acc.n : null;
    case "rate":
      return acc.n ? (100 * acc.sum) / acc.n : null;
    case "ratio":
      return acc.den > 0 ? (acc.sum / acc.den) * (m.scale ?? 1) : null;
    case "min":
      return acc.n ? acc.min : null;
    case "max":
      return acc.n ? acc.max : null;
    case "median":
    case "p10":
    case "p90": {
      const sorted = (acc.vals ?? []).sort((a, b) => a - b);
      return quantile(sorted, m.agg === "median" ? 0.5 : m.agg === "p10" ? 0.1 : 0.9);
    }
  }
}

/* ────────────────────────── Ταξινόμηση κατηγοριών ────────────────────────── */

const OPERATOR_ORDER = ["COSMOTE", "VODAFONE", "NOVA"];

const scopeRank = (s: string) => {
  const m = /^(\d{4})H([12])$/i.exec(s);
  return m ? Number(m[1]) * 2 + Number(m[2]) : null;
};

/** Τιμές που ΟΛΕΣ αντιστοιχούν σε διαφορετικό γνωστό operator (π.χ. "Cosmote Free A", "Vodafone Free A"). */
export function operatorKeysOf(values: string[]): Map<string, string> | null {
  const real = values.filter((v) => v !== OTHER_LABEL && v !== BLANK_LABEL);
  if (real.length === 0) return null;
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const v of real) {
    const key = resolveOperator(v).key;
    if (!OPERATOR_ORDER.includes(key) || used.has(key)) return null;
    used.add(key);
    map.set(v, key);
  }
  return map;
}

export type CategorySort = "value" | "label" | "none" | "operator" | "scope";

function orderKeys(keys: string[], sort: CategorySort, valueOf: (k: string) => number | null): string[] {
  const tail = keys.filter((k) => k === OTHER_LABEL);
  const body = keys.filter((k) => k !== OTHER_LABEL);
  switch (sort) {
    case "operator": {
      const ops = operatorKeysOf(body);
      const rank = (k: string) => {
        const idx = OPERATOR_ORDER.indexOf(ops?.get(k) ?? resolveOperator(k).key);
        return idx === -1 ? OPERATOR_ORDER.length : idx;
      };
      body.sort((a, b) => rank(a) - rank(b) || naturalCompare(a, b));
      break;
    }
    case "scope":
      body.sort((a, b) => (scopeRank(a) ?? Infinity) - (scopeRank(b) ?? Infinity) || naturalCompare(a, b));
      break;
    case "label":
      body.sort(naturalCompare);
      break;
    case "value":
      body.sort((a, b) => (valueOf(b) ?? -Infinity) - (valueOf(a) ?? -Infinity));
      break;
    default:
      break;
  }
  return [...body, ...tail];
}

/** Η "φυσική" σειρά μιας διάστασης: operators με brand σειρά, scopes χρονολογικά, αλλιώς null. */
export function naturalSortFor(col: string, values: string[]): CategorySort | null {
  if (col === OPERATOR_COL || operatorKeysOf(values)) return "operator";
  if (col === SCOPE_COL || (values.length > 0 && values.every((v) => v === OTHER_LABEL || scopeRank(v) !== null))) return "scope";
  return null;
}

/** Groups ενός split με σταθερή σειρά (από ΟΛΑ τα rows, ώστε ένα φίλτρο να μην αλλάζει χρώματα). */
export function orderGroups(rows: Row[], get: Accessor, split: string, maxGroups = 8): { groups: string[]; folded: Set<string> } {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = get(row, split);
    const k = v === null || v === undefined || v === "" ? BLANK_LABEL : String(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const byCount = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
  const natural = naturalSortFor(split, byCount);
  const kept = byCount.slice(0, byCount.length > maxGroups ? maxGroups - 1 : maxGroups);
  const folded = new Set(byCount.slice(kept.length));
  const ordered = natural ? orderKeys(kept, natural, () => null) : kept;
  return { groups: folded.size ? [...ordered, OTHER_LABEL] : ordered, folded };
}

/* ────────────────────────── Aggregation ────────────────────────── */

export type XMode = "category" | "time" | "numeric" | "total";

export interface AggregateOptions {
  x: string;
  xMode: XMode;
  split?: string;
  measures: MeasureSpec[];
  get: Accessor;
  /** ms· 0 = ακριβείς χρόνοι. */
  timeGrainMs?: number;
  /** 0 = ακριβείς αριθμητικές τιμές. */
  numericBins?: number;
  maxCategories?: number;
  /** Προκαθορισμένα groups (από orderGroups)· ό,τι λείπει πάει στο "Άλλα". */
  groups?: string[];
  sort?: CategorySort;
}

export interface SeriesDef {
  key: string;
  measureId: string;
  group: string | null;
}

export interface AggregateResult {
  rows: Row[];
  series: SeriesDef[];
  groups: string[];
  /** Πόσες κατηγορίες του X μπήκαν στο "Άλλα". */
  foldedCategories: number;
  binWidth?: number;
}

export const seriesKey = (measureId: string, group: string | null) => (group === null ? measureId : `${measureId}‖${group}`);
export const countKey = (key: string) => `__n‖${key}`;

/** Στρογγυλό βήμα 1 / 2 / 2.5 / 5 × 10^k. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  const step = r > 5 ? 10 : r > 2.5 ? 5 : r > 2 ? 2.5 : r > 1 ? 2 : 1;
  return step * mag;
}

const tzOffset = (t: number) => new Date(t).getTimezoneOffset() * 60_000;

/** Bucket σε τοπική ώρα — ένα 1d bucket ξεκινάει στα μεσάνυχτα Ελλάδας, όχι UTC. */
export function bucketTime(t: number, grainMs: number): number {
  if (!grainMs) return t;
  const off = tzOffset(t);
  return Math.floor((t - off) / grainMs) * grainMs + off;
}

export function aggregate(rows: Row[], opts: AggregateOptions): AggregateResult {
  const { x, xMode, split, measures, get } = opts;
  const maxCategories = opts.maxCategories ?? 30;

  let binStart = 0;
  let binWidth = 0;
  if (xMode === "numeric" && opts.numericBins) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of rows) {
      const v = toNum(get(row, x));
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (Number.isFinite(lo) && hi > lo) {
      binWidth = niceStep((hi - lo) / opts.numericBins);
      binStart = Math.floor(lo / binWidth) * binWidth;
    }
  }

  const xKeyOf = (row: Row): string | number | null => {
    if (xMode === "total") return TOTAL_LABEL;
    const v = get(row, x);
    if (xMode === "category") return v === null || v === undefined || v === "" ? BLANK_LABEL : String(v);
    if (xMode === "time") {
      const t = parseTime(v) ?? toNum(v);
      return t === null ? null : bucketTime(t, opts.timeGrainMs ?? 0);
    }
    const n = toNum(v);
    if (n === null) return null;
    if (!binWidth) return n;
    return +(binStart + (Math.floor((n - binStart) / binWidth) + 0.5) * binWidth).toFixed(6);
  };

  // Πέρασμα 1: ποιες κατηγορίες του X μένουν (top-N κατά πλήθος γραμμών)
  let keepX: Set<string> | null = null;
  let foldedCategories = 0;
  if (xMode === "category") {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const k = xKeyOf(row) as string;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (counts.size > maxCategories) {
      const top = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!).slice(0, maxCategories - 1);
      keepX = new Set(top);
      foldedCategories = counts.size - top.length;
    }
  }

  const groups = split ? opts.groups ?? orderGroups(rows, get, split).groups : [];
  const groupSet = new Set(groups);
  const groupOf = (row: Row): string | null => {
    if (!split) return null;
    const v = get(row, split);
    const k = v === null || v === undefined || v === "" ? BLANK_LABEL : String(v);
    return groupSet.has(k) ? k : OTHER_LABEL;
  };

  // Πέρασμα 2: accumulate
  const cells = new Map<string | number, Map<string | null, Acc[]>>();
  for (const row of rows) {
    let xk = xKeyOf(row);
    if (xk === null) continue;
    if (keepX && !keepX.has(xk as string)) xk = OTHER_LABEL;
    const g = groupOf(row);
    if (g === OTHER_LABEL && !groupSet.has(OTHER_LABEL)) continue;
    let byGroup = cells.get(xk);
    if (!byGroup) cells.set(xk, (byGroup = new Map()));
    let accs = byGroup.get(g);
    if (!accs) byGroup.set(g, (accs = measures.map(newAcc)));
    measures.forEach((m, i) => accumulate(accs![i], row, m, get));
  }

  const series: SeriesDef[] = split
    ? measures.flatMap((m) => groups.map((g) => ({ key: seriesKey(m.id, g), measureId: m.id, group: g })))
    : measures.map((m) => ({ key: m.id, measureId: m.id, group: null }));

  const out = new Map<string | number, Row>();
  for (const [xk, byGroup] of cells) {
    const row: Row = { __x: xk };
    for (const [g, accs] of byGroup) {
      measures.forEach((m, i) => {
        const key = seriesKey(m.id, g);
        row[key] = finalize(accs[i], m);
        row[countKey(key)] = accs[i].n;
      });
    }
    out.set(xk, row);
  }

  let keys = [...out.keys()];
  if (xMode === "category") {
    const first = series[0]?.key;
    const valueOf = (k: string) => {
      if (!first) return null;
      const row = out.get(k)!;
      // Με split: σύνολο/μέσος των groups του πρώτου μέτρου, ώστε η σειρά να μη μένει στον 1ο group.
      const vals = series.filter((s) => s.measureId === series[0].measureId).map((s) => toNum(row[s.key])).filter((v): v is number => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    keys = orderKeys(keys as string[], opts.sort ?? "none", valueOf);
  } else if (xMode !== "total") {
    keys = (keys as number[]).sort((a, b) => a - b);
  }

  return {
    rows: keys.map((k) => out.get(k)!),
    series: series.filter((s) => keys.some((k) => out.get(k)![s.key] !== undefined)),
    groups: split ? groups.filter((g) => keys.some((k) => measures.some((m) => out.get(k)![seriesKey(m.id, g)] !== undefined))) : [],
    foldedCategories,
    ...(binWidth ? { binWidth } : {}),
  };
}

/** 100% stack: μέσα σε κάθε X, τα groups ενός μέτρου γίνονται μερίδια που αθροίζουν 100. */
export function toShares(result: AggregateResult): Row[] {
  const byMeasure = new Map<string, SeriesDef[]>();
  for (const s of result.series) {
    const list = byMeasure.get(s.measureId) ?? [];
    list.push(s);
    byMeasure.set(s.measureId, list);
  }
  return result.rows.map((row) => {
    const out: Row = { ...row };
    for (const list of byMeasure.values()) {
      const total = list.reduce((acc, s) => acc + (toNum(row[s.key]) ?? 0), 0);
      for (const s of list) {
        const v = toNum(row[s.key]);
        out[s.key] = v === null || total <= 0 ? null : (100 * v) / total;
      }
    }
    return out;
  });
}

/* ────────────────────────── Κατανομή (PDF / CDF) ────────────────────────── */

export interface GroupDistStats {
  n: number;
  avg: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

export interface DistributionResult {
  /** PDF: ένα row ανά bin, __x = αρχή του bin. */
  rows: Row[];
  /**
   * CDF: __x = ΤΕΛΟΣ του bin (P(X ≤ x) ισχύει στο άνω όριο) + αρχικό σημείο 0% στην αρχή
   * του 1ου bin — αλλιώς η καμπύλη βγαίνει μετατοπισμένη ένα bin αριστερά.
   */
  cdfRows: Row[];
  groups: string[];
  binWidth: number;
  stats: Map<string, GroupDistStats>;
}

export const cdfKey = (group: string) => `cdf‖${group}`;

/**
 * PDF / CDF ενός raw μέτρου ανά group — η μορφή των A-LEVEL "LQPDFData" / "HTTPSThrptData"
 * (bins σταθερού πλάτους, % δειγμάτων ανά bin), εδώ υπολογισμένη client-side.
 */
export function distribution(
  rows: Row[],
  get: Accessor,
  col: string,
  opts: { split?: string; groups?: string[]; binWidth?: number | null; allLabel?: string } = {},
): DistributionResult {
  const allLabel = opts.allLabel ?? col;
  const groups = opts.split ? opts.groups ?? orderGroups(rows, get, opts.split).groups : [allLabel];
  const groupSet = new Set(groups);
  const values = new Map<string, number[]>(groups.map((g) => [g, []]));
  const all: number[] = [];

  for (const row of rows) {
    const y = toNum(get(row, col));
    if (y === null) continue;
    let g = allLabel;
    if (opts.split) {
      const v = get(row, opts.split);
      const k = v === null || v === undefined || v === "" ? BLANK_LABEL : String(v);
      g = groupSet.has(k) ? k : OTHER_LABEL;
      if (!groupSet.has(g)) continue;
    }
    values.get(g)!.push(y);
    all.push(y);
  }

  const stats = new Map<string, GroupDistStats>();
  for (const [g, list] of values) {
    list.sort((a, b) => a - b);
    stats.set(g, {
      n: list.length,
      avg: list.length ? list.reduce((a, b) => a + b, 0) / list.length : null,
      p10: quantile(list, 0.1),
      p50: quantile(list, 0.5),
      p90: quantile(list, 0.9),
    });
  }

  if (all.length === 0) return { rows: [], cdfRows: [], groups: [], binWidth: opts.binWidth ?? 1, stats };

  all.sort((a, b) => a - b);
  const lo = all[0];
  const hi = all[all.length - 1];
  let bw = opts.binWidth && opts.binWidth > 0 ? opts.binWidth : niceStep((quantile(all, 0.99)! - quantile(all, 0.01)!) / 40 || 1);
  while ((hi - lo) / bw > 150) bw = niceStep(bw * 1.5);
  const start = Math.floor(lo / bw) * bw;
  const nBins = Math.max(1, Math.floor((hi - start) / bw) + 1);

  const present = groups.filter((g) => (values.get(g)?.length ?? 0) > 0);
  const hist = new Map(present.map((g) => [g, new Array<number>(nBins).fill(0)]));
  for (const g of present) {
    const h = hist.get(g)!;
    for (const y of values.get(g)!) h[Math.min(nBins - 1, Math.floor((y - start) / bw))]++;
  }

  const cum = new Map(present.map((g) => [g, 0]));
  const out: Row[] = [];
  const cdfOut: Row[] = [Object.fromEntries([["__x", +start.toFixed(6)], ...present.flatMap((g) => [[cdfKey(g), 0], [countKey(g), 0]])])];
  for (let i = 0; i < nBins; i++) {
    const row: Row = { __x: +(start + i * bw).toFixed(6) };
    const cdfRow: Row = { __x: +(start + (i + 1) * bw).toFixed(6) };
    for (const g of present) {
      const n = values.get(g)!.length;
      const c = hist.get(g)![i];
      cum.set(g, cum.get(g)! + c);
      row[g] = (100 * c) / n;
      row[countKey(g)] = c;
      cdfRow[cdfKey(g)] = (100 * cum.get(g)!) / n;
      cdfRow[countKey(g)] = cum.get(g)!;
    }
    out.push(row);
    cdfOut.push(cdfRow);
  }
  return { rows: out, cdfRows: cdfOut, groups: present, binWidth: bw, stats };
}

/* ────────────────────────── Προτάσεις charts ────────────────────────── */

export type SuggestedChartType = "bar" | "line" | "area" | "pie" | "scatter" | "dist";

export interface ChartSuggestion {
  id: string;
  title: string;
  type: SuggestedChartType;
  x: string;
  split: string;
  measures: MeasureSpec[];
  stack?: "none" | "stack" | "percent";
  distCol?: string;
  distMode?: "pdf" | "cdf";
  filters?: { col: string; vals: string[] }[];
}

const STATUS_RE = /status|state|result$|outcome|errorstatus|hostatus/;
const CODEC_RE = /^(codecrate|codecname|codec)$/;
const LOCATION_DIM_RE = /^(asidelocation|location|operator|servingoperator|homeoperator)$/;
const SUCCESS_VALUE_RE = /^(success|successful|completed?|ok|a)$/i;

// Τα "κλειδιά" μέτρα ενός drive test με τη σειρά που τα κοιτάζει ένα A-LEVEL report.
const KEY_MEASURES: RegExp[] = [
  /mos|optionalwb|avgsq|^lqspeech|visualquality|sessionquality/,
  /throughput|thrpt|kbps|mbps/,
  /rsrp|rxlev|rscp/,
  /sinr|rsrq|rxqual|ecio/,
  /rtt|latency|ping/,
  /setup|timetofirst/,
  /duration/,
];

const keyMeasureRank = (p: ColumnProfile) => {
  const n = norm(p.col);
  const idx = KEY_MEASURES.findIndex((re) => re.test(n));
  return idx === -1 ? KEY_MEASURES.length : idx;
};

/** Η καλύτερη διάσταση για τον X: Operator > location > collection/scope > μικρή διάσταση. */
export function bestDimension(profiles: ColumnProfile[]): string {
  const dims = profiles.filter((p) => p.role === "dimension" && p.nonNull > 0);
  const byKey = (key: string) => dims.find((p) => p.col === key);
  const location = dims.find((p) => LOCATION_DIM_RE.test(norm(p.col)));
  const candidates = [
    byKey(OPERATOR_COL),
    location,
    dims.find((p) => /^(collectionname|testname|technology|calltype|callmode|direction)$/.test(norm(p.col)) && p.distinct <= 40),
    byKey(SCOPE_COL),
    dims.find((p) => !p.derived && p.distinct >= 2 && p.distinct <= 30 && !STATUS_RE.test(norm(p.col))),
    dims.find((p) => p.distinct >= 2 && p.distinct <= 60),
  ];
  return candidates.find(Boolean)?.col ?? "";
}

export function suggestCharts(profiles: ColumnProfile[], rows: Row[], get: Accessor): ChartSuggestion[] {
  const out: ChartSuggestion[] = [];
  const add = (s: ChartSuggestion) => {
    if (!out.some((o) => o.id === s.id)) out.push(s);
  };
  const find = (re: RegExp, role?: ColumnRole) => profiles.find((p) => (!role || p.role === role) && re.test(norm(p.col)));
  const x = bestDimension(profiles);
  const xLabel = profiles.find((p) => p.col === x)?.label.split(" ←")[0] ?? x;
  const byX = x ? ` ανά ${xLabel}` : "";
  const smallDim = (col: string) => {
    const p = profiles.find((q) => q.col === col);
    return p != null && p.distinct >= 2 && p.distinct <= 8;
  };
  const splitForDist = x && smallDim(x) ? x : "";
  const ratio = (id: string, num: ColumnProfile, den: ColumnProfile, label: string, scale = 100): MeasureSpec => ({
    id, col: num.col, agg: "ratio", denomCol: den.col, scale, label,
  });

  // 1. Voice KPIs από 0/1 flags — ίδιοι ορισμοί με attachmentC.buildVoiceStats (CSR/DCR/AFR).
  const attempts = find(/^(callattemps|callattempts|attempts)$/, "flag");
  const completed = find(/^callcompleted$/, "flag");
  const dropped = find(/^calldropped$/, "flag");
  const failed = find(/^callfailed$/, "flag");
  const connected = find(/^callconnected$/, "flag");
  if (attempts && completed) {
    add({ id: "voice-csr", title: `Call Success Rate %${byX}`, type: "bar", x, split: "", measures: [ratio("csr", completed, attempts, "CSR %")] });
  }
  const failureRates = [
    ...(dropped && (connected || attempts) ? [ratio("dcr", dropped, (connected ?? attempts)!, "DCR %")] : []),
    ...(failed && attempts ? [ratio("afr", failed, attempts, "Access Fail %")] : []),
  ];
  if (failureRates.length > 0) {
    add({ id: "voice-dcr-afr", title: `${failureRates.map((m) => m.label).join(" & ")}${byX}`, type: "bar", x, split: "", measures: failureRates });
  }

  // 2. SRVCC / HO status → επιτυχία %
  const hoStatus = find(/^hostatus$/, "dimension");
  if (hoStatus) {
    add({ id: "ho-status", title: `SRVCC HO Success/Fail${byX}`, type: "bar", x, split: hoStatus.col, measures: [rowsMeasure()], stack: "percent" });
  }

  // 3. MOS από Σ/Σ ζευγάρια (SumLQ/NumLQ, DL/UL) — alev "LQStatisticData.sql"
  const lqPairs = profiles.filter((p) => p.role === "sum" && p.denomCol && /lq|mos/.test(norm(p.col)));
  if (lqPairs.length > 0) {
    add({
      id: "lq-ratio", title: `MOS (Σ SumLQ / Σ NumLQ)${byX}`, type: "bar", x, split: "",
      measures: lqPairs.slice(0, 3).map((p) => ({ ...measureFromColumn(p, "ratio"), label: `MOS ${norm(p.col).replace(/^sumlq/, "").toUpperCase() || "ALL"}` })),
    });
  }
  const badCall = find(/^badcall$/, "flag");
  if (badCall) add({ id: "bad-call", title: `Low quality calls % (BadCall)${byX}`, type: "bar", x, split: "", measures: [measureFromColumn(badCall, "rate")] });

  // 4. alev "Avg" (= AVG*COUNT) με "Num" + KPIStatus: μέσος μόνο στα επιτυχημένα + success %
  const alevAvg = profiles.find((p) => p.role === "sum" && p.denomCol && /^c?avg$/.test(norm(p.col)));
  const status = profiles.find((p) => p.role === "dimension" && !p.derived && STATUS_RE.test(norm(p.col)) && p.distinct >= 1 && p.distinct <= 12);
  if (alevAvg) {
    const successValue = status ? [...new Set(rows.slice(0, 5000).map((r) => String(get(r, status.col) ?? "")))].find((v) => SUCCESS_VALUE_RE.test(v)) : undefined;
    add({
      id: "alev-avg", title: `Μέσος όρος (Σ ${alevAvg.col} / Σ ${alevAvg.denomCol})${byX}`, type: "bar", x, split: "",
      measures: [measureFromColumn(alevAvg, "ratio")],
      ...(status && successValue ? { filters: [{ col: status.col, vals: [successValue] }] } : {}),
    });
    const num = profiles.find((p) => p.col === alevAvg.denomCol);
    if (status && num) {
      add({ id: "alev-status", title: `${status.col} μερίδιο (Σ ${num.col})${byX}`, type: "bar", x, split: status.col, measures: [measureFromColumn(num, "sum")], stack: "percent" });
    }
  }

  // 5. Γενικά success/fail flags (PING, Capacity, HTTP, YouTube: Success/Complete/Ok)
  const successFlag = find(/^(success|complete|completed|ok|successful)$/, "flag");
  const failFlag = find(/^(failed|fail|failure)$/, "flag");
  if (successFlag) add({ id: "success-rate", title: `Success rate %${byX}`, type: "bar", x, split: "", measures: [measureFromColumn(successFlag, "rate")] });
  else if (failFlag && !attempts) add({ id: "fail-rate", title: `Failure rate %${byX}`, type: "bar", x, split: "", measures: [measureFromColumn(failFlag, "rate")] });

  // 6. Κατηγορική κατάσταση (callStatus, ActionStatus…) → 100% stacked ανά X
  if (status && x && status.col !== x && !alevAvg && !hoStatus) {
    add({ id: "status-mix", title: `Κατανομή ${status.col}${byX}`, type: "bar", x, split: status.col, measures: [rowsMeasure()], stack: "percent" });
  }

  // 7. Codec usage — ίδιο με A-LEVEL "CallCodecTypeUsageGSM.sql" (μερίδιο διάρκειας)
  const codec = profiles.find((p) => p.role === "dimension" && CODEC_RE.test(norm(p.col)));
  if (codec && x && codec.col !== x) {
    const duration = find(/^testduration$/, "sum");
    add({
      id: "codec-mix", title: `Codec usage %${byX}${duration ? " (σε διάρκεια)" : ""}`, type: "bar", x, split: codec.col,
      measures: [duration ? measureFromColumn(duration, "sum") : rowsMeasure()], stack: "percent",
    });
  }

  // 8. Ήδη-αθροισμένο αποτέλεσμα (count + avg_* / *_pct): σταθμισμένοι μέσοι, ένα chart ανά
  //    μονάδα (MOS δίπλα σε δευτερόλεπτα θα ήθελε δεύτερο άξονα). Για ποσοστό με βάρος τον
  //    παρονομαστή του (bad_call_pct ← total_calls) το Σ(pct·w)/Σw είναι ακριβώς Σ bad / Σ total.
  const means = profiles.filter((p) => (p.role === "mean" || p.role === "percent") && p.weightCol).sort((a, b) => keyMeasureRank(a) - keyMeasureRank(b));
  const byUnit = new Map<string, ColumnProfile[]>();
  for (const p of means) {
    const list = byUnit.get(p.unit ?? "") ?? [];
    list.push(p);
    byUnit.set(p.unit ?? "", list);
  }
  [...byUnit.values()].slice(0, 3).forEach((same) => {
    const picked = same.slice(0, 3);
    add({
      id: `weighted-${picked[0].col}`, title: `${picked.map((p) => p.col).join(", ")} (σταθμ. με ${picked[0].weightCol})${byX}`, type: "bar", x, split: "",
      measures: picked.map((p) => measureFromColumn(p, "wavg")),
    });
  });
  const counts = profiles.filter((p) => p.role === "count");
  if (counts.length > 0 && means.length > 0) {
    const base = profiles.find((p) => p.col === means[0].weightCol) ?? counts[0];
    add({ id: "count-sum", title: `Σ ${base.col}${byX}`, type: "bar", x, split: "", measures: [measureFromColumn(base, "sum")] });
  }

  // 9. Raw κλειδί-μέτρα: μέσος + P10/P90 και CDF ανά operator
  const measures = profiles.filter((p) => p.role === "measure").sort((a, b) => keyMeasureRank(a) - keyMeasureRank(b));
  const key = measures.find((p) => keyMeasureRank(p) < KEY_MEASURES.length) ?? measures[0];
  if (key) {
    const spread = rows.length >= 30;
    add({
      id: `measure-${key.col}`, title: `${key.col}: μέσος${spread ? " & P10 / P90" : ""}${byX}`, type: "bar", x, split: "",
      measures: spread ? [measureFromColumn(key, "p10"), measureFromColumn(key, "avg"), measureFromColumn(key, "p90")] : [measureFromColumn(key, "avg")],
    });
    if (rows.length >= 20) {
      add({ id: `dist-${key.col}`, title: `Κατανομή ${key.col} (CDF)${splitForDist ? byX : ""}`, type: "dist", x, split: splitForDist, measures: [], distCol: key.col, distMode: "cdf" });
    }
  }

  // 10. Στο χρόνο
  const time = profiles.find((p) => p.role === "time");
  if (time) {
    const series = key ? [measureFromColumn(key, "avg")] : [rowsMeasure()];
    add({ id: `time-${time.col}`, title: `${key ? key.col : "Γραμμές"} στο χρόνο (${time.col})`, type: "line", x: time.col, split: splitForDist, measures: series });
  }

  // Fallback: πόσες γραμμές ανά διάσταση
  if (x) add({ id: "rows", title: `Πλήθος γραμμών${byX}`, type: "bar", x, split: "", measures: [rowsMeasure()] });

  return out.slice(0, 7);
}
