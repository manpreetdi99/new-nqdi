import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  Area,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Label,
  LabelList,
} from "recharts";
import {
  BarChart2,
  LineChart as LineIcon,
  PieChart as PieIcon,
  Activity,
  Crosshair,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  BarChart,
  SlidersHorizontal,
  Sparkles,
  Waves,
  Table2,
  Info,
  Sigma,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { CHART_PALETTE, AXIS_STYLE, GRID_STYLE, DEFAULTS, STATUS_COLORS } from "@/lib/chartStyles";
import { resolveOperator, UNKNOWN_OPERATOR_COLOR } from "@/lib/attachmentC";
import {
  AGG_LABEL,
  BLANK_LABEL,
  OTHER_LABEL,
  ROWS_COL,
  aggregate,
  allowedAggs,
  bestDimension,
  cdfKey,
  countKey,
  defaultAgg,
  deriveDimensions,
  describeMeasure,
  distribution,
  evenSample,
  isAdditive,
  makeAccessor,
  measureFromColumn,
  measureLabel,
  naturalSortFor,
  operatorKeysOf,
  orderGroups,
  parseTime,
  profileColumns,
  rowsMeasure,
  seriesKey,
  suggestCharts,
  toNum,
  toShares,
  type AggKind,
  type CategorySort,
  type ChartSuggestion,
  type ColumnProfile,
  type MeasureSpec,
  type Row,
  type XMode,
} from "@/lib/chartSemantics";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChartType = "line" | "bar" | "area" | "scatter" | "pie" | "dist";
type YSide = "left" | "right";
type LegacyAggFn = "count" | "sum" | "avg" | "min" | "max";
type StackMode = "none" | "stack" | "percent";
type SortMode = "auto" | "value" | "label" | "none";
/** "compact": τα timestamps σαν κατηγορίες με τη σειρά του αποτελέσματος — διαδοχικές κλήσεις κολλητά, χωρίς κενά. */
type TimeGrain = "auto" | "exact" | "compact" | "1m" | "5m" | "15m" | "1h" | "1d";
type BinsMode = "auto" | "exact" | "20" | "40" | "80";

interface ChartMeasure extends MeasureSpec {
  side: YSide;
  color: string;
}

interface ChartConfig {
  type: ChartType;
  /** "" = ένα σημείο "Σύνολο". */
  x: string;
  split: string;
  measures: ChartMeasure[];
  stack: StackMode;
  sort: SortMode;
  timeGrain: TimeGrain;
  bins: BinsMode;
  distCol: string;
  distMode: "pdf" | "cdf";
  binWidth: number | null;
}

interface FilterDef {
  col: string;
  vals: string[];
}

interface ResultChartsProps {
  columns: string[];
  data: Record<string, unknown>[];
  defaultChartType?: ChartType;
  defaultXCol?: string;
  defaultYCols?: string[];
  defaultRightCols?: string[];
  defaultAxisOverrides?: Record<string, { domain: [number, number]; reversed?: boolean }>;
  defaultAggFn?: LegacyAggFn;
  defaultAggEnabled?: boolean;
  defaultGroupCol?: string;
}

// ─── Constants & formatting ───────────────────────────────────────────────────

const H = 340;
const MAX_SCATTER_POINTS = 4000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const GRAIN_MS: Record<Exclude<TimeGrain, "auto" | "exact" | "compact">, number> = {
  "1m": MINUTE, "5m": 5 * MINUTE, "15m": 15 * MINUTE, "1h": HOUR, "1d": DAY,
};
const GRAIN_LABEL: Record<TimeGrain, string> = {
  auto: "Αυτόματα", exact: "Ακριβείς χρόνοι", compact: "Χωρίς κενά (σειρά αποτελεσμάτων)", "1m": "1 λεπτό", "5m": "5 λεπτά", "15m": "15 λεπτά", "1h": "1 ώρα", "1d": "1 ημέρα",
};

/**
 * Brand χρώματα operator (attachmentC). Η NOVA είναι μαύρη στο brand, αλλά μια 2px γραμμή
 * σε #111318 χάνεται στο σκούρο surface της εφαρμογής — εδώ ζωγραφίζεται ανοιχτό ουδέτερο,
 * ώστε bars, γραμμές και pie να διαβάζονται με το ίδιο χρώμα.
 */
const NOVA_CHART_COLOR = "#d4d7dd";
const operatorColor = (key: string) => (key === "NOVA" ? NOVA_CHART_COLOR : resolveOperator(key).color);

// Ίδια σημασιολογία με τα OUTCOME_SEGMENTS του SummaryTab (normal / system release / drop / fail).
const STATUS_RULES: { re: RegExp; color: string }[] = [
  { re: /complet|success|^ok$|^a$|normal/i, color: STATUS_COLORS.good },
  { re: /system\s*rel/i, color: "#9085e9" },
  { re: /drop/i, color: STATUS_COLORS.serious },
  { re: /fail|error/i, color: STATUS_COLORS.critical },
  { re: /^(n\/?a|--|-|unknown)$/i, color: UNKNOWN_OPERATOR_COLOR },
];

function statusColorsOf(groups: string[]): Map<string, string> | null {
  const real = groups.filter((g) => g !== OTHER_LABEL && g !== BLANK_LABEL);
  if (real.length < 2) return null;
  const map = new Map<string, string>();
  for (const g of real) {
    const rule = STATUS_RULES.find((r) => r.re.test(g.trim()));
    if (!rule) return null;
    map.set(g, rule.color);
  }
  return map;
}

/** Χρώμα ανά group: ακολουθεί την οντότητα (operator/status/σειρά στα ΑΦΙΛΤΡΑΡΙΣΤΑ δεδομένα), ποτέ την κατάταξη. */
function buildGroupColors(groups: string[]): Map<string, string> {
  const ops = operatorKeysOf(groups);
  const statuses = ops ? null : statusColorsOf(groups);
  const map = new Map<string, string>();
  let slot = 0;
  for (const g of groups) {
    if (g === OTHER_LABEL || g === BLANK_LABEL) map.set(g, UNKNOWN_OPERATOR_COLOR);
    else if (ops) map.set(g, operatorColor(ops.get(g)!));
    else if (statuses) map.set(g, statuses.get(g)!);
    else map.set(g, CHART_PALETTE[slot++ % CHART_PALETTE.length]);
  }
  return map;
}

function fmtNum(v: number): string {
  const a = Math.abs(v);
  const digits = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 3;
  return v.toLocaleString("el-GR", { maximumFractionDigits: digits });
}

// Σταθερά δεκαδικά για τις μονάδες των KPIs, ώστε "96,67%" και "94,00%" να στοιχίζονται.
const FIXED_DIGITS: Record<string, number> = { "%": 2, MOS: 2, dBm: 1, dB: 1 };

const fmtValue = (v: unknown, unit = ""): string => {
  const n = toNum(v);
  if (n === null) return "—";
  const digits = FIXED_DIGITS[unit];
  const txt = digits === undefined ? fmtNum(n) : n.toLocaleString("el-GR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${txt}${unit ? (unit === "%" ? "%" : ` ${unit}`) : ""}`;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

function timeTickFormatter(spanMs: number) {
  return (v: unknown) => {
    const d = new Date(Number(v));
    if (Number.isNaN(d.getTime())) return "";
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const dm = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
    if (spanMs <= 10 * MINUTE) return `${hm}:${pad2(d.getSeconds())}`;
    if (spanMs <= DAY) return hm;
    if (spanMs <= 7 * DAY) return `${dm} ${hm}`;
    return `${dm}/${String(d.getFullYear()).slice(2)}`;
  };
}

const fmtFullTime = (v: unknown) => {
  const d = new Date(Number(v));
  if (Number.isNaN(d.getTime())) return String(v ?? "");
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

const shortLabel = (p: ColumnProfile | undefined, col: string) =>
  col === ROWS_COL ? "Πλήθος γραμμών" : p ? p.label.split(" ←")[0] : col;

/** Round, evenly-spaced ticks (60, 65, 70…) — ίδια λογική με πριν. */
function niceTicks(min: number, max: number, targetCount = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [];
  const rawStep = (max - min) / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const step = residual > 5 ? 10 * magnitude : residual > 2 ? 5 * magnitude : residual > 1 ? 2 * magnitude : magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = niceMin; t <= niceMax + step / 2; t += step) ticks.push(Math.round((t + Number.EPSILON) * 1e6) / 1e6);
  return ticks;
}

/**
 * Domain ενός άξονα τιμών. Bars/areas με θετικές τιμές ξεκινούν ΠΑΝΤΑ από το 0 — ένα bar
 * που ξεκινάει στο 96% κάνει ένα CSR 97% να μοιάζει διπλάσιο από ένα 96.5%.
 */
function valueAxis(rows: Row[], keys: string[], fromZero: boolean) {
  if (keys.length === 0) return undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min)) return undefined;
  if (fromZero && min >= 0) min = 0;
  if (min === max) max = min + 1;
  const ticks = niceTicks(min, max);
  return ticks.length ? { domain: [ticks[0], ticks[ticks.length - 1]] as [number, number], ticks } : undefined;
}

function measureUnit(m: MeasureSpec, pmap: Map<string, ColumnProfile>): string {
  if (m.agg === "rate" || (m.agg === "ratio" && m.scale === 100)) return "%";
  if (m.col === ROWS_COL || m.agg === "count" || m.agg === "distinct") return "";
  return pmap.get(m.col)?.unit ?? "";
}

/**
 * Κενά στο χρόνο (π.χ. διαδοχικές κλήσεις με μία ώρα απόσταση) σπάνε τη γραμμή: ένα row
 * χωρίς τιμές στη μέση κάθε κενού > 5× το τυπικό βήμα. Αλλιώς η γραμμή "εφευρίσκει" τιμές
 * εκεί όπου δεν μετρήθηκε τίποτα.
 */
function breakTimeGaps(rows: Row[]): Row[] {
  if (rows.length < 3) return rows;
  const diffs: number[] = [];
  for (let i = 1; i < rows.length; i++) diffs.push((rows[i].__x as number) - (rows[i - 1].__x as number));
  const median = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
  if (!(median > 0)) return rows;
  const out: Row[] = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    if (diffs[i - 1] > 5 * median) out.push({ __x: ((rows[i].__x as number) + (rows[i - 1].__x as number)) / 2, __gap: true });
    out.push(rows[i]);
  }
  return out;
}

const nextColor = (measures: ChartMeasure[]) =>
  CHART_PALETTE.find((c) => !measures.some((m) => m.color === c)) ?? CHART_PALETTE[measures.length % CHART_PALETTE.length];

const withLook = (measures: MeasureSpec[]): ChartMeasure[] =>
  measures.map((m, i) => ({ ...m, side: "left" as YSide, color: CHART_PALETTE[i % CHART_PALETTE.length] }));

// ─── Config builders ──────────────────────────────────────────────────────────

function baseConfig(profiles: ColumnProfile[]): ChartConfig {
  const firstRaw = profiles.find((p) => p.role === "measure") ?? profiles.find((p) => p.numeric && p.role !== "id");
  return {
    type: "bar", x: "", split: "", measures: [], stack: "none", sort: "auto",
    timeGrain: "auto", bins: "auto", distCol: firstRaw?.col ?? "", distMode: "cdf", binWidth: null,
  };
}

function configFromSuggestion(s: ChartSuggestion, base: ChartConfig): ChartConfig {
  return {
    ...base,
    type: s.type,
    x: s.x,
    split: s.split,
    measures: withLook(s.measures),
    stack: s.stack ?? "none",
    sort: "auto",
    distCol: s.distCol ?? base.distCol,
    distMode: s.distMode ?? base.distMode,
    binWidth: null,
  };
}

/**
 * Τα defaultChart των templates (QueryEditor) γράφτηκαν για τον παλιό μηχανισμό με ΜΙΑ
 * συνάρτηση για όλο το chart. Εδώ μεταφράζονται: κάθε στήλη παίρνει τη σωστή δική της
 * συνάρτηση, εκτός αν το template ζήτησε ρητά μια που επιτρέπεται για αυτήν.
 */
function configFromLegacy(props: ResultChartsProps, profiles: ColumnProfile[], pmap: Map<string, ColumnProfile>): ChartConfig | null {
  if (!props.defaultXCol && !props.defaultYCols?.length && !props.defaultChartType) return null;
  const type = props.defaultChartType ?? "bar";
  const x = props.defaultXCol && pmap.has(props.defaultXCol) ? props.defaultXCol : bestDimension(profiles);
  const ys = (props.defaultYCols ?? []).filter((c) => pmap.has(c) && c !== x);
  const categoricalY = ys.filter((c) => !pmap.get(c)!.numeric);
  const numericY = ys.filter((c) => pmap.get(c)!.numeric);
  // Ο παλιός μηχανισμός εφάρμοζε το groupCol μόνο σε bar charts· στο scatter είναι το χρώμα
  // ανά ομάδα (π.χ. ένα σύννεφο ανά operator στα "Capacity — SINR vs …" templates).
  const legacySplit =
    (type === "bar" || type === "scatter") && props.defaultGroupCol && pmap.has(props.defaultGroupCol) ? props.defaultGroupCol : "";

  const measures: ChartMeasure[] = numericY.map((col, i) => {
    const p = pmap.get(col)!;
    const allowed = allowedAggs(p);
    let agg: AggKind = defaultAgg(p);
    if (props.defaultAggEnabled === false && p.role === "flag") {
      agg = "avg"; // 0/1 ανά γραμμή → κρατάει τον δικό του [0,1] άξονα
    } else if (props.defaultAggEnabled !== false && props.defaultAggFn) {
      const wanted: AggKind = props.defaultAggFn === "avg" && p.weightCol ? "wavg" : props.defaultAggFn;
      if (allowed.includes(wanted)) agg = wanted;
    }
    return {
      ...measureFromColumn(p, agg),
      side: props.defaultRightCols?.includes(col) ? "right" : "left",
      color: CHART_PALETTE[i % CHART_PALETTE.length],
    };
  });
  if (measures.length === 0) measures.push({ ...rowsMeasure(), side: "left", color: CHART_PALETTE[0] });

  return {
    ...baseConfig(profiles),
    type,
    x,
    split: legacySplit || categoricalY[0] || "",
    measures,
    stack: categoricalY.length > 0 && !legacySplit ? "stack" : "none",
    // Τα templates με χρόνο στον X (π.χ. GSM 30s buckets ανά κλήση) σχεδιάστηκαν με τις κλήσεις
    // κολλητά η μία μετά την άλλη — σε πραγματικό άξονα χρόνου θα χάνονταν ανάμεσα σε ώρες κενού.
    timeGrain: pmap.get(x)?.role === "time" ? "compact" : "auto",
  };
}

function fallbackConfig(profiles: ColumnProfile[], columns: string[]): ChartConfig {
  const x = bestDimension(profiles) || columns[0] || "";
  const nums = profiles.filter((p) => p.numeric && p.col !== x && !["id", "coord"].includes(p.role)).slice(0, 2);
  return {
    ...baseConfig(profiles),
    x,
    measures: nums.length ? withLook(nums.map((p) => measureFromColumn(p))) : withLook([rowsMeasure()]),
  };
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

const CHART_TYPES: { type: ChartType; label: string; icon: React.ReactNode }[] = [
  { type: "bar", label: "Bar", icon: <BarChart2 className="h-3.5 w-3.5" /> },
  { type: "line", label: "Line", icon: <LineIcon className="h-3.5 w-3.5" /> },
  { type: "area", label: "Area", icon: <Activity className="h-3.5 w-3.5" /> },
  { type: "dist", label: "Κατανομή", icon: <Waves className="h-3.5 w-3.5" /> },
  { type: "scatter", label: "Scatter", icon: <Crosshair className="h-3.5 w-3.5" /> },
  { type: "pie", label: "Pie", icon: <PieIcon className="h-3.5 w-3.5" /> },
];

function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md bg-muted/60 border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          disabled={o.disabled}
          title={o.title}
          className={[
            "px-2 py-0.5 rounded text-[10px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed",
            value === o.value
              ? "bg-background text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChartTypeBar({ value, onChange }: { value: ChartType; onChange: (t: ChartType) => void }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted/60 border border-border p-0.5">
      {CHART_TYPES.map(({ type, label, icon }) => (
        <button
          key={type}
          onClick={() => onChange(type)}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all",
            value === type
              ? "bg-background text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          ].join(" ")}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}

function ConfigCard({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-md bg-muted/30 border border-border/60 p-2.5 space-y-1.5 ${className}`}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">{label}</p>
      {children}
    </div>
  );
}

function FieldSelect({ value, onChange, children, title }: { value: string; onChange: (v: string) => void; children: React.ReactNode; title?: string }) {
  return (
    <select
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-0 bg-background border border-border rounded-md px-2 py-1.5 text-[11px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
    >
      {children}
    </select>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-muted-foreground">
      <BarChart className="h-8 w-8 opacity-20" />
      <p className="text-xs text-center max-w-[300px]">{message}</p>
    </div>
  );
}

const ROLE_GROUPS: { label: string; roles: ColumnProfile["role"][] }[] = [
  { label: "Μετρήσεις (raw δείγματα)", roles: ["measure"] },
  { label: "Flags 0/1", roles: ["flag"] },
  { label: "Ήδη μέσοι όροι / ποσοστά", roles: ["mean", "percent"] },
  { label: "Πλήθη / αθροίσματα", roles: ["count", "sum"] },
  { label: "Min / Max / Stdev", roles: ["min", "max", "spread"] },
  { label: "Συντεταγμένες", roles: ["coord"] },
  { label: "Πλήθος διακριτών", roles: ["id", "dimension"] },
];

/** Όλες οι στήλες ομαδοποιημένες ανά είδος — ώστε ο χρήστης να βλέπει ΤΙ είναι η κάθε μία. */
function ColumnOptions({ profiles, include }: { profiles: ColumnProfile[]; include: (p: ColumnProfile) => boolean }) {
  return (
    <>
      {ROLE_GROUPS.map((g) => {
        const items = profiles.filter((p) => g.roles.includes(p.role) && include(p));
        if (items.length === 0) return null;
        return (
          <optgroup key={g.label} label={g.label}>
            {items.map((p) => <option key={p.col} value={p.col}>{p.label}</option>)}
          </optgroup>
        );
      })}
    </>
  );
}

function DimensionOptions({ profiles, exclude = [] }: { profiles: ColumnProfile[]; exclude?: string[] }) {
  const derived = profiles.filter((p) => p.derived && !exclude.includes(p.col));
  const dims = profiles.filter((p) => !p.derived && p.role === "dimension" && !exclude.includes(p.col));
  return (
    <>
      {derived.length > 0 && (
        <optgroup label="Splits A-LEVEL (αυτόματα)">
          {derived.map((p) => <option key={p.col} value={p.col}>{p.label}</option>)}
        </optgroup>
      )}
      {dims.length > 0 && (
        <optgroup label="Διαστάσεις">
          {dims.map((p) => <option key={p.col} value={p.col}>{p.label} ({p.distinct >= 2000 ? "2000+" : p.distinct})</option>)}
        </optgroup>
      )}
    </>
  );
}

function MeasurePill({ m, label, aggOptions, showSide, onAgg, onSide, onRemove }: {
  m: ChartMeasure;
  label: string;
  aggOptions: AggKind[];
  showSide: boolean;
  onAgg: (a: AggKind) => void;
  onSide: () => void;
  onRemove: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full border text-[11px] font-mono max-w-full"
      style={{ backgroundColor: m.color + "18", borderColor: m.color + "70" }}
    >
      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
      <span className="max-w-[160px] truncate text-foreground" title={label}>{m.label ?? (m.col === ROWS_COL ? "Πλήθος γραμμών" : m.col)}</span>
      {aggOptions.length > 1 ? (
        <select
          value={m.agg}
          onChange={(e) => onAgg(e.target.value as AggKind)}
          title="Συνάρτηση — μόνο όσες έχουν νόημα για αυτή τη στήλη"
          className="bg-background/70 border border-border/60 rounded-full px-1.5 py-0 text-[10px] text-foreground focus:outline-none cursor-pointer"
        >
          {aggOptions.map((a) => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}
        </select>
      ) : (
        <span className="px-1.5 rounded-full border border-border/60 text-[10px] text-muted-foreground">{AGG_LABEL[m.agg]}</span>
      )}
      {showSide && (
        <button
          onClick={onSide}
          title="Αριστερός / δεξιός άξονας — χρησιμοποίησέ τον μόνο όταν οι μονάδες διαφέρουν"
          className="flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-bold leading-4 border border-border/60 text-muted-foreground hover:text-foreground"
        >
          {m.side === "left" ? <><ChevronLeft className="h-2.5 w-2.5" />L</> : <>R<ChevronRight className="h-2.5 w-2.5" /></>}
        </button>
      )}
      <button onClick={onRemove} className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity p-0.5 rounded-full hover:bg-black/10" title="Αφαίρεση">
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

interface TooltipEntry {
  name?: string;
  value?: unknown;
  color?: string;
  fill?: string;
  dataKey?: string | number;
  payload?: Row;
}

function makeTooltip(opts: { labelFormatter: (v: unknown) => string; unitOf: (dataKey: string) => string; countOf?: (dataKey: string) => string }) {
  return function XYTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: unknown }) {
    const entries = (payload ?? []).filter((e) => e.value !== null && e.value !== undefined);
    if (!active || entries.length === 0) return null;
    return (
      <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-xl text-xs space-y-0.5 max-w-sm">
        <p className="font-semibold text-foreground mb-1.5 truncate border-b border-border pb-1">{opts.labelFormatter(label)}</p>
        {entries.map((e, i) => {
          const key = String(e.dataKey ?? "");
          const n = e.payload?.[opts.countOf ? opts.countOf(key) : countKey(key)];
          return (
            <p key={i} className="font-mono truncate flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: e.color ?? e.fill }} />
              <span className="text-muted-foreground">{e.name}:</span>
              <span className="text-foreground">{fmtValue(e.value, opts.unitOf(key))}</span>
              {typeof n === "number" && <span className="text-muted-foreground/70">n={n.toLocaleString("el-GR")}</span>}
            </p>
          );
        })}
      </div>
    );
  };
}

const fmtLegend = (v: string) => <span className="text-xs text-foreground">{v}</span>;
// Legend πάνω δεξιά: κάτω θα έπεφτε πάνω στον τίτλο του X άξονα.
const LEGEND_TOP = { verticalAlign: "top" as const, align: "right" as const, iconSize: 10, wrapperStyle: { paddingBottom: 8 }, formatter: fmtLegend };

/** Ticks για αριθμητικό X (bins, κατανομή) — στρογγυλά αντί για dataMin … dataMax. */
function numericXAxis(rows: Row[]) {
  const xs = rows.map((r) => r.__x).filter((v): v is number => typeof v === "number");
  if (xs.length === 0) return {};
  const ticks = niceTicks(Math.min(...xs), Math.max(...xs), 8);
  return ticks.length ? { domain: [ticks[0], ticks[ticks.length - 1]] as [number, number], ticks } : {};
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ResultCharts(props: ResultChartsProps) {
  const { columns, data, defaultAxisOverrides } = props;

  // ── Σημασιολογία των στηλών ──────────────────────────────────────────────
  const derived = useMemo(() => deriveDimensions(columns, data), [columns, data]);
  const get = useMemo(() => makeAccessor(derived), [derived]);
  const profiles = useMemo(() => profileColumns(columns, data, derived), [columns, data, derived]);
  const pmap = useMemo(() => new Map(profiles.map((p) => [p.col, p])), [profiles]);
  const suggestions = useMemo(() => suggestCharts(profiles, data, get), [profiles, data, get]);
  const labelOf = useCallback((col: string) => shortLabel(pmap.get(col), col), [pmap]);

  const initial = useMemo(() => {
    const legacy = configFromLegacy(props, profiles, pmap);
    if (legacy) return { config: legacy, filters: [] as FilterDef[], suggestion: null as string | null };
    const first = suggestions[0];
    if (first) return { config: configFromSuggestion(first, baseConfig(profiles)), filters: first.filters ?? [], suggestion: first.id };
    return { config: fallbackConfig(profiles, columns), filters: [] as FilterDef[], suggestion: null as string | null };
    // Μόνο στο πρώτο render / σε νέο αποτέλεσμα — το QueryEditor ξανα-mountάρει ανά εκτέλεση.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, suggestions]);

  const [config, setConfig] = useState<ChartConfig>(initial.config);
  const [filters, setFilters] = useState<FilterDef[]>(initial.filters);
  const [activeSuggestion, setActiveSuggestion] = useState<string | null>(initial.suggestion);
  const [showConfig, setShowConfig] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [addCol, setAddCol] = useState("");
  const [ratioDraft, setRatioDraft] = useState<{ num: string; den: string; pct: boolean } | null>(null);

  // Νέα δεδομένα χωρίς remount (π.χ. DemoCharts): αν οι στήλες του config χάθηκαν, ξεκινάμε από την αρχή.
  useEffect(() => {
    const known = (c: string) => !c || c === ROWS_COL || pmap.has(c);
    const valid = known(config.x) && known(config.split) && config.measures.every((m) => known(m.col) && known(m.denomCol ?? "") && known(m.weightCol ?? ""));
    if (!valid) {
      setConfig(initial.config);
      setFilters(initial.filters);
      setActiveSuggestion(initial.suggestion);
    }
  }, [pmap, initial, config]);

  const update = useCallback((patch: Partial<ChartConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setActiveSuggestion(null);
  }, []);

  const applySuggestion = (s: ChartSuggestion) => {
    setConfig((c) => configFromSuggestion(s, c));
    setFilters(s.filters ?? []);
    setActiveSuggestion(s.id);
  };

  // ── Φίλτρα (δουλεύουν και στα παράγωγα splits: π.χ. μόνο NOVA) ─────────
  const filteredRows = useMemo(() => {
    const active = filters.filter((f) => f.vals.length > 0);
    if (active.length === 0) return data;
    return data.filter((row) => active.every((f) => f.vals.includes(String(get(row, f.col) ?? ""))));
  }, [data, filters, get]);

  const uniqueVals = useCallback(
    (col: string) => {
      const seen = new Set<string>();
      for (const row of data) {
        seen.add(String(get(row, col) ?? ""));
        if (seen.size >= 200) break;
      }
      return [...seen].sort((a, b) => a.localeCompare(b, "el", { numeric: true }));
    },
    [data, get],
  );

  // ── X ────────────────────────────────────────────────────────────────────
  const xProfile = pmap.get(config.x);
  const xIsTime = xProfile?.role === "time";
  const compactTime = xIsTime && config.timeGrain === "compact";
  const xMode: XMode = !config.x ? "total" : xIsTime && !compactTime ? "time" : xProfile?.numeric ? "numeric" : "category";

  const timeInfo = useMemo(() => {
    if (!xIsTime) return { grainMs: 0, grain: "exact" as TimeGrain, span: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    const distinct = new Set<number>();
    for (const row of filteredRows) {
      const t = parseTime(get(row, config.x));
      if (t === null) continue;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
      if (distinct.size <= 400) distinct.add(t);
    }
    const span = Number.isFinite(lo) ? hi - lo : 0;
    if (config.timeGrain !== "auto") {
      const grainMs = config.timeGrain === "exact" || config.timeGrain === "compact" ? 0 : GRAIN_MS[config.timeGrain];
      return { grainMs, grain: config.timeGrain, span };
    }
    // Λίγοι διακριτοί χρόνοι (π.χ. ήδη 30s buckets από το SQL) → ακριβώς όπως ήρθαν.
    if (distinct.size <= 400) return { grainMs: 0, grain: "exact" as TimeGrain, span };
    const grain = (["1m", "5m", "15m", "1h", "1d"] as const).find((g) => span / GRAIN_MS[g] <= 240) ?? "1d";
    return { grainMs: GRAIN_MS[grain], grain, span };
  }, [xIsTime, filteredRows, get, config.x, config.timeGrain]);

  const numericBins = xMode !== "numeric" ? 0
    : config.bins === "exact" ? 0
    : config.bins === "auto" ? ((xProfile?.distinct ?? 0) <= 60 ? 0 : 40)
    : Number(config.bins);

  // ── Split groups: σειρά & χρώματα από ΟΛΑ τα δεδομένα (ένα φίλτρο δεν ξαναβάφει) ──
  // Στην κατανομή / στο scatter ο X δεν είναι διάσταση — το split μετράει ακόμα κι αν είναι ίδιο με τον X.
  const splitCol = config.split && (config.type === "dist" || config.type === "scatter" || config.split !== config.x) ? config.split : "";
  const groupInfo = useMemo(() => {
    if (!splitCol) return { groups: [] as string[], colors: new Map<string, string>() };
    const { groups } = orderGroups(data, get, splitCol);
    return { groups, colors: buildGroupColors(groups) };
  }, [data, get, splitCol]);

  const resolvedSort: CategorySort = useMemo(() => {
    if (config.sort !== "auto") return config.sort;
    if (xMode !== "category" || compactTime) return "none";
    const values = [...new Set(evenSample(data, 400).map((r) => String(get(r, config.x) ?? "")))];
    const natural = naturalSortFor(config.x, values);
    if (natural) return natural;
    if (values.every((v) => v === "" || Number.isFinite(Number(v)))) return "label";
    return config.type === "bar" || config.type === "pie" ? "value" : "label";
  }, [config.sort, config.x, config.type, xMode, compactTime, data, get]);

  // ── Aggregation (bar / line / area) ──────────────────────────────────────
  const isXY = config.type === "bar" || config.type === "line" || config.type === "area";
  const agg = useMemo(() => {
    if (!isXY || config.measures.length === 0) return null;
    return aggregate(filteredRows, {
      x: config.x, xMode, split: splitCol || undefined, groups: splitCol ? groupInfo.groups : undefined,
      measures: config.measures, get, timeGrainMs: timeInfo.grainMs, numericBins, sort: resolvedSort,
      maxCategories: compactTime ? 20_000 : 30,
    });
  }, [isXY, filteredRows, config.x, config.measures, xMode, splitCol, groupInfo.groups, get, timeInfo.grainMs, numericBins, resolvedSort, compactTime]);

  const allAdditive = config.measures.length > 0 && config.measures.every(isAdditive);
  const stackMode: StackMode = splitCol && (config.type === "bar" || config.type === "area")
    ? (config.stack === "percent" && !allAdditive ? "stack" : config.stack)
    : "none";
  // Χωρίς split κάθε row έχει όλες τις σειρές → τα κενά στο χρόνο σπάνε τη γραμμή. Με split
  // τα groups δεν μοιράζονται timestamps και οι γραμμές ΠΡΕΠΕΙ να ενώνουν τα δικά τους σημεία.
  const breakGaps = xMode === "time" && !splitCol;
  const chartRows = useMemo(() => {
    if (!agg) return [];
    const rows = stackMode === "percent" ? toShares(agg) : agg.rows;
    return breakGaps ? breakTimeGaps(rows) : rows;
  }, [agg, stackMode, breakGaps]);

  const measureById = useMemo(() => new Map(config.measures.map((m) => [m.id, m])), [config.measures]);
  const unitOfMeasure = useCallback((m: MeasureSpec) => (stackMode === "percent" ? "%" : measureUnit(m, pmap)), [stackMode, pmap]);

  const seriesList = useMemo(() => {
    if (!agg) return [];
    const multi = config.measures.length > 1;
    return agg.series.map((s) => {
      const m = measureById.get(s.measureId)!;
      const mi = config.measures.indexOf(m);
      const mLabel = measureLabel(m, labelOf);
      return {
        key: s.key,
        measure: m,
        name: s.group === null ? mLabel : multi ? `${s.group} · ${mLabel}` : s.group,
        color: s.group === null ? m.color : groupInfo.colors.get(s.group) ?? UNKNOWN_OPERATOR_COLOR,
        dash: s.group !== null && multi ? ["", "6 3", "2 3", "8 3 2 3"][mi % 4] : "",
      };
    });
  }, [agg, config.measures, measureById, labelOf, groupInfo.colors]);

  // 0/1 flags (π.χ. OutcomeFlag δίπλα σε RxLev) και template overrides (RxQual 0–7 ανάποδα)
  // παίρνουν δικό τους κρυφό άξονα, ώστε να μην "πατάνε" πάνω στην κλίμακα του κύριου μέτρου.
  const dedicatedAxis = useMemo(() => {
    const map = new Map<string, { id: string; domain: [number, number]; reversed: boolean }>();
    for (const s of seriesList) {
      const override = defaultAxisOverrides?.[s.measure.col];
      if (override) {
        map.set(s.key, { id: `axis-${s.measure.col}`, domain: override.domain, reversed: override.reversed ?? false });
        continue;
      }
      if (pmap.get(s.measure.col)?.role !== "flag" || stackMode === "percent") continue;
      let saw = false;
      let binary = true;
      for (const row of chartRows) {
        const v = row[s.key];
        if (typeof v !== "number") continue;
        saw = true;
        if (v !== 0 && v !== 1) { binary = false; break; }
      }
      if (saw && binary) map.set(s.key, { id: "flag", domain: [0, 1], reversed: false });
    }
    return map;
  }, [seriesList, defaultAxisOverrides, pmap, chartRows, stackMode]);

  const dedicatedAxes = useMemo(() => {
    const seen = new Map<string, { id: string; domain: [number, number]; reversed: boolean }>();
    for (const cfg of dedicatedAxis.values()) if (!seen.has(cfg.id)) seen.set(cfg.id, cfg);
    return [...seen.values()];
  }, [dedicatedAxis]);

  // ── Pie (μόνο αθροιστικά μεγέθη: μέρη ενός όλου, ≤ 6 κομμάτια + «Άλλα») ──
  const pieMeasure = config.measures[0];
  const pie = useMemo(() => {
    if (config.type !== "pie" || !pieMeasure || !isAdditive(pieMeasure) || xMode !== "category") return null;
    const res = aggregate(filteredRows, { x: config.x, xMode: "category", measures: [pieMeasure], get, sort: "value", maxCategories: 7 });
    const colorsFor = buildGroupColors(orderGroups(data, get, config.x, 7).groups);
    const slices = res.rows
      .map((r) => ({ name: String(r.__x), value: toNum(r[pieMeasure.id]) ?? 0 }))
      .filter((s) => s.value > 0);
    const total = slices.reduce((a, s) => a + s.value, 0);
    return {
      slices: slices.map((s, i) => ({ ...s, pct: total ? s.value / total : 0, color: colorsFor.get(s.name) ?? CHART_PALETTE[i % CHART_PALETTE.length] })),
      total,
    };
  }, [config.type, config.x, pieMeasure, xMode, filteredRows, get, data]);

  // ── Κατανομή (PDF / CDF) ─────────────────────────────────────────────────
  const distProfile = pmap.get(config.distCol);
  const dist = useMemo(() => {
    if (config.type !== "dist" || !distProfile?.numeric) return null;
    return distribution(filteredRows, get, config.distCol, {
      split: splitCol || undefined,
      groups: splitCol ? groupInfo.groups : undefined,
      binWidth: config.binWidth ?? distProfile.binWidth ?? null,
      allLabel: labelOf(config.distCol),
    });
  }, [config.type, config.distCol, config.binWidth, distProfile, filteredRows, get, splitCol, groupInfo.groups, labelOf]);

  // ── Scatter ──────────────────────────────────────────────────────────────
  const scatter = useMemo(() => {
    if (config.type !== "scatter") return null;
    const yCol = config.measures[0]?.col;
    if (!xProfile?.numeric || !yCol || !pmap.get(yCol)?.numeric) return null;
    const stride = Math.max(1, Math.ceil(filteredRows.length / MAX_SCATTER_POINTS));
    const byGroup = new Map<string, { x: number; y: number }[]>();
    const groupSet = new Set(groupInfo.groups);
    for (let i = 0; i < filteredRows.length; i += stride) {
      const row = filteredRows[i];
      const x = toNum(get(row, config.x));
      const y = toNum(get(row, yCol));
      if (x === null || y === null) continue;
      let g = "";
      if (splitCol) {
        const v = get(row, splitCol);
        const k = v === null || v === undefined || v === "" ? BLANK_LABEL : String(v);
        g = groupSet.has(k) ? k : OTHER_LABEL;
      }
      const list = byGroup.get(g) ?? [];
      list.push({ x, y });
      byGroup.set(g, list);
    }
    return { yCol, groups: [...byGroup.entries()], sampled: stride > 1 };
  }, [config.type, config.x, config.measures, xProfile, pmap, filteredRows, get, splitCol, groupInfo.groups]);

  // ── KPI tiles: η ίδια συνάρτηση πάνω σε ΟΛΕΣ τις (φιλτραρισμένες) γραμμές ──
  const tiles = useMemo(() => {
    if (!isXY && config.type !== "pie") return null;
    const measures = config.type === "pie" ? (pieMeasure ? [pieMeasure] : []) : config.measures;
    if (measures.length === 0) return null;
    const total = aggregate(filteredRows, { x: "", xMode: "total", measures, get }).rows[0];
    const perGroup = splitCol && config.type !== "pie"
      ? aggregate(filteredRows, { x: "", xMode: "total", split: splitCol, groups: groupInfo.groups, measures, get }).rows[0]
      : undefined;
    return measures.map((m) => ({
      m,
      value: total?.[m.id],
      n: total?.[countKey(m.id)],
      groups: perGroup ? groupInfo.groups.map((g) => ({ g, value: perGroup[seriesKey(m.id, g)] })).filter((x) => x.value !== undefined) : [],
    }));
  }, [isXY, config.type, config.measures, pieMeasure, filteredRows, get, splitCol, groupInfo.groups]);

  // ── Measure handlers ─────────────────────────────────────────────────────
  const setMeasures = (fn: (prev: ChartMeasure[]) => ChartMeasure[]) => {
    setConfig((c) => ({ ...c, measures: fn(c.measures) }));
    setActiveSuggestion(null);
  };

  const addMeasure = () => {
    if (!addCol) return;
    const p = pmap.get(addCol);
    const spec = addCol === ROWS_COL ? rowsMeasure() : p ? measureFromColumn(p) : null;
    if (!spec) return;
    setMeasures((prev) => {
      const id = prev.some((m) => m.id === spec.id) ? `${spec.id}#${prev.length}` : spec.id;
      return [...prev, { ...spec, id, side: "left", color: nextColor(prev) }];
    });
    setAddCol("");
  };

  const addRatio = () => {
    if (!ratioDraft?.num || !ratioDraft.den) return;
    const { num, den, pct } = ratioDraft;
    setMeasures((prev) => [
      ...prev,
      {
        id: `ratio:${num}/${den}#${prev.length}`, col: num, agg: "ratio", denomCol: den, scale: pct ? 100 : 1,
        label: `${labelOf(num)} / ${labelOf(den)}${pct ? " %" : ""}`, side: "left", color: nextColor(prev),
      },
    ]);
    setRatioDraft(null);
  };

  const changeAgg = (id: string, a: AggKind) =>
    setMeasures((prev) => prev.map((m) => {
      if (m.id !== id) return m;
      const p = pmap.get(m.col);
      return { ...(p ? measureFromColumn(p, a, m.id) : { ...m, agg: a }), side: m.side, color: m.color };
    }));

  const switchType = (type: ChartType) => {
    setActiveSuggestion(null);
    setConfig((c) => {
      const next: ChartConfig = { ...c, type };
      const firstNumeric = profiles.find((p) => p.role === "measure") ?? profiles.find((p) => p.numeric && p.role !== "id");
      if (type === "pie") {
        const additive = c.measures.find(isAdditive);
        next.measures = additive ? [additive] : withLook([rowsMeasure()]);
        if (!pmap.get(c.x) || pmap.get(c.x)!.numeric || pmap.get(c.x)!.role === "time") next.x = bestDimension(profiles);
      }
      if (type === "dist") {
        const fromMeasure = c.measures.find((m) => pmap.get(m.col)?.numeric)?.col;
        if (!pmap.get(c.distCol)?.numeric) next.distCol = fromMeasure ?? firstNumeric?.col ?? "";
        if (!c.split && c.x && (pmap.get(c.x)?.distinct ?? 99) <= 8 && !pmap.get(c.x)?.numeric) next.split = c.x;
      }
      if (type === "scatter") {
        const nums = profiles.filter((p) => p.numeric && !["id", "flag"].includes(p.role));
        if (!pmap.get(c.x)?.numeric) next.x = nums[0]?.col ?? c.x;
        const y = c.measures.find((m) => pmap.get(m.col)?.numeric && m.col !== next.x)?.col ?? nums.find((p) => p.col !== next.x)?.col;
        next.measures = y ? withLook([measureFromColumn(pmap.get(y)!, "avg")]) : [];
      }
      if ((type === "bar" || type === "line" || type === "area") && c.type === "scatter") {
        next.x = bestDimension(profiles) || c.x;
      }
      if ((type === "bar" || type === "line" || type === "area") && c.measures.length === 0) {
        next.measures = withLook([rowsMeasure()]);
      }
      return next;
    });
  };

  // ── Κείμενο "πώς υπολογίζεται" ───────────────────────────────────────────
  const explanation = useMemo(() => {
    const rowsTxt = `${filteredRows.length.toLocaleString("el-GR")} γραμμές${filteredRows.length < data.length ? ` (από ${data.length.toLocaleString("el-GR")}, με φίλτρα)` : ""}`;
    const splitTxt = splitCol ? ` · σειρές ανά ${pmap.get(splitCol)?.label ?? splitCol}${groupInfo.groups.includes(OTHER_LABEL) ? " (top 7 + «Άλλα»)" : ""}` : "";
    if (config.type === "dist") {
      if (!dist) return "";
      return `% δειγμάτων ${labelOf(config.distCol)} ανά bin πλάτους ${fmtNum(dist.binWidth)}${distProfile?.unit ? ` ${distProfile.unit}` : ""}${config.distMode === "cdf" ? " — αθροιστικά (CDF: % δειγμάτων ≤ τιμή)" : ""}${splitTxt} · ${rowsTxt}`;
    }
    if (config.type === "scatter") return `κάθε σημείο = μία γραμμή${scatter?.sampled ? ` (δείγμα έως ${MAX_SCATTER_POINTS.toLocaleString("el-GR")})` : ""}${splitTxt} · ${rowsTxt}`;
    const measures = config.type === "pie" ? (pieMeasure ? [pieMeasure] : []) : config.measures;
    // Το custom label (π.χ. "CSR %") χρειάζεται τον ορισμό του· το αυτόματο είναι ήδη ο ορισμός.
    const mTxt = measures.map((m) => (m.label ? `${m.label} = ${describeMeasure(m, labelOf)}` : describeMeasure(m, labelOf))).join(" · ");
    let xTxt = "";
    if (xMode === "total") xTxt = "σύνολο";
    else if (xMode === "time") xTxt = `${config.x} (${timeInfo.grain === "exact" ? "ακριβείς χρόνοι" : `buckets ${GRAIN_LABEL[timeInfo.grain]}`})`;
    else if (xMode === "numeric") xTxt = `${config.x}${agg?.binWidth ? ` (bins πλάτους ${fmtNum(agg.binWidth)})` : ""}`;
    else if (compactTime) xTxt = `${config.x} (χωρίς κενά: τα σημεία κολλητά με τη σειρά του αποτελέσματος — ο άξονας ΔΕΝ είναι γραμμικός χρόνος)`;
    else xTxt = `${pmap.get(config.x)?.label ?? config.x}${agg?.foldedCategories ? ` (${agg.foldedCategories} μικρές κατηγορίες στο «Άλλα»)` : ""}`;
    const stackTxt = stackMode === "percent" ? " · 100%: μερίδιο κάθε σειράς μέσα στο X" : "";
    return `${mTxt} · ανά ${xTxt}${splitTxt}${stackTxt} · ${rowsTxt}`;
  }, [config, filteredRows.length, data.length, splitCol, pmap, groupInfo.groups, dist, distProfile, labelOf, scatter, pieMeasure, xMode, compactTime, timeInfo.grain, agg, stackMode]);

  // ── Πίνακας τιμών (η table-view του chart) ───────────────────────────────
  const table = useMemo((): { headers: string[]; rows: string[][] } | null => {
    const xFmt = (v: unknown) => (xMode === "time" ? fmtFullTime(v) : compactTime ? fmtFullTime(parseTime(v)) : typeof v === "number" ? fmtNum(v) : String(v ?? ""));
    if (isXY && agg) {
      return {
        headers: [xMode === "total" ? "" : labelOf(config.x), ...seriesList.map((s) => s.name)],
        rows: chartRows.filter((r) => !r.__gap).map((r) => [
          xFmt(r.__x),
          ...seriesList.map((s) => {
            const n = r[countKey(s.key)];
            return `${fmtValue(r[s.key], unitOfMeasure(s.measure))}${typeof n === "number" ? ` (n=${n.toLocaleString("el-GR")})` : ""}`;
          }),
        ]),
      };
    }
    if (config.type === "pie" && pie) {
      return {
        headers: [labelOf(config.x), measureLabel(pieMeasure, labelOf), "%"],
        rows: pie.slices.map((s) => [s.name, fmtValue(s.value), `${fmtNum(s.pct * 100)}%`]),
      };
    }
    if (config.type === "dist" && dist) {
      const cdf = config.distMode === "cdf";
      return {
        headers: [`${labelOf(config.distCol)} ${cdf ? "(≤ τιμή)" : "(bin από)"}`, ...dist.groups],
        rows: (cdf ? dist.cdfRows.slice(1) : dist.rows).map((r) => [
          fmtNum(r.__x as number),
          ...dist.groups.map((g) => `${fmtValue(r[cdf ? cdfKey(g) : g], "%")} (n=${r[countKey(g)] as number})`),
        ]),
      };
    }
    return null;
  }, [isXY, agg, xMode, compactTime, labelOf, config.x, config.type, config.distCol, config.distMode, seriesList, chartRows, unitOfMeasure, pie, pieMeasure, dist]);

  // ── Chart render ─────────────────────────────────────────────────────────
  const chart = useMemo(() => {
    /* ── Pie ── */
    if (config.type === "pie") {
      if (xMode !== "category") return <ChartEmpty message="Το pie θέλει κατηγορία στον X (π.χ. Operator, callStatus) — όχι χρόνο ή αριθμό." />;
      if (!pieMeasure || !isAdditive(pieMeasure)) {
        return <ChartEmpty message="Το pie δείχνει μέρη ενός όλου: μόνο πλήθος ή άθροισμα (COUNT / SUM). Για μέσους όρους ή ποσοστά χρησιμοποίησε Bar." />;
      }
      if (!pie || pie.slices.length === 0) return <ChartEmpty message="Δεν υπάρχουν θετικές τιμές για pie." />;
      if (pie.slices.length < 2) return <ChartEmpty message="Μόνο μία κατηγορία — το νούμερο φαίνεται στην κάρτα πάνω." />;
      return (
        <ResponsiveContainer width="100%" height={H + 20}>
          <PieChart>
            <Pie data={pie.slices} dataKey="value" nameKey="name" cx="50%" cy="46%" outerRadius={110} innerRadius={0}
              stroke="hsl(var(--background))" strokeWidth={2}
              label={({ pct }: { pct: number }) => (pct >= 0.04 ? `${(pct * 100).toFixed(1)}%` : "")} labelLine={false}>
              {pie.slices.map((s) => <Cell key={s.name} fill={s.color} />)}
            </Pie>
            <Tooltip
              content={({ active, payload }: { active?: boolean; payload?: { payload: { name: string; value: number; pct: number; color: string } }[] }) => {
                if (!active || !payload?.length) return null;
                const s = payload[0].payload;
                return (
                  <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
                    <p className="font-semibold truncate mb-0.5 text-foreground">{s.name}</p>
                    <p className="font-mono text-foreground">{fmtValue(s.value)} <span className="text-muted-foreground">({(s.pct * 100).toFixed(1)}%)</span></p>
                  </div>
                );
              }}
            />
            <Legend formatter={fmtLegend} />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    /* ── Κατανομή PDF / CDF ── */
    if (config.type === "dist") {
      if (!distProfile?.numeric) return <ChartEmpty message="Διάλεξε αριθμητική στήλη για κατανομή (π.χ. MOS, RSRP, Throughput)." />;
      if (!dist || dist.rows.length === 0) return <ChartEmpty message="Δεν υπάρχουν τιμές για κατανομή." />;
      const cdf = config.distMode === "cdf";
      const unit = distProfile.unit ?? "";
      const colorOf = (g: string) => (splitCol ? groupInfo.colors.get(g) ?? UNKNOWN_OPERATOR_COLOR : CHART_PALETTE[0]);
      const single = dist.groups.length === 1;
      const Tip = makeTooltip({
        labelFormatter: (v) => (cdf ? `≤ ${fmtNum(Number(v))}` : `${fmtNum(Number(v))} – ${fmtNum(Number(v) + dist.binWidth)}`) + (unit ? ` ${unit}` : ""),
        unitOf: () => "%",
        countOf: (k) => countKey(k.replace(/^cdf‖/, "")),
      });
      return (
        <ResponsiveContainer width="100%" height={H}>
          <ComposedChart data={cdf ? dist.cdfRows : dist.rows} margin={{ top: 8, right: 20, left: 0, bottom: 28 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="__x" type="number" domain={["dataMin", "dataMax"]} {...numericXAxis(cdf ? dist.cdfRows : dist.rows)} {...AXIS_STYLE} tickFormatter={(v) => fmtNum(Number(v))}>
              <Label value={`${labelOf(config.distCol)}${unit ? ` (${unit})` : ""}`} offset={-14} position="insideBottom" fontSize={10} fill="hsl(var(--muted-foreground))" />
            </XAxis>
            <YAxis {...AXIS_STYLE} width={48} domain={cdf ? [0, 100] : [0, "auto"]} ticks={cdf ? [0, 25, 50, 75, 100] : undefined}
              tickFormatter={(v) => `${v}%`} />
            <Tooltip content={<Tip />} />
            {!single && <Legend {...LEGEND_TOP} />}
            {dist.groups.map((g) =>
              !cdf && single ? (
                <Bar key={g} dataKey={g} name={g} fill={colorOf(g)} fillOpacity={DEFAULTS.barFillOpacity} radius={[2, 2, 0, 0]} />
              ) : (
                <Line key={g} dataKey={cdf ? cdfKey(g) : g} name={g} stroke={colorOf(g)} type={cdf ? "linear" : "monotone"}
                  dot={false} strokeWidth={2} isAnimationActive={false} />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    /* ── Scatter ── */
    if (config.type === "scatter") {
      if (!scatter) return <ChartEmpty message="Το scatter θέλει αριθμητικό X και αριθμητικό Y (π.χ. RSRP → MOS)." />;
      const yUnit = pmap.get(scatter.yCol)?.unit;
      return (
        <ResponsiveContainer width="100%" height={H}>
          <ScatterChart margin={{ top: 8, right: 24, left: 0, bottom: 28 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="x" type="number" name={config.x} domain={["auto", "auto"]} {...AXIS_STYLE} tickFormatter={(v) => fmtNum(Number(v))}>
              <Label value={`${config.x}${xProfile?.unit ? ` (${xProfile.unit})` : ""}`} offset={-14} position="insideBottom" fontSize={10} fill="hsl(var(--muted-foreground))" />
            </XAxis>
            <YAxis dataKey="y" type="number" name={scatter.yCol} domain={["auto", "auto"]} {...AXIS_STYLE} width={56}
              tickFormatter={(v) => fmtNum(Number(v))}
              label={{ value: `${scatter.yCol}${yUnit ? ` (${yUnit})` : ""}`, angle: -90, position: "insideLeft", fontSize: 9, fill: "hsl(var(--muted-foreground))", dx: 4 }} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }: { active?: boolean; payload?: { payload: { x: number; y: number } }[] }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload;
                return (
                  <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono text-foreground">
                    {config.x}: {fmtValue(p.x, xProfile?.unit)}<br />{scatter.yCol}: {fmtValue(p.y, yUnit)}
                  </div>
                );
              }} />
            {scatter.groups.length > 1 && <Legend {...LEGEND_TOP} />}
            {scatter.groups.map(([g, pts]) => (
              <Scatter key={g || "all"} name={g || scatter.yCol} data={pts}
                fill={g ? groupInfo.colors.get(g) ?? UNKNOWN_OPERATOR_COLOR : config.measures[0]?.color ?? CHART_PALETTE[0]}
                fillOpacity={0.6} isAnimationActive={false} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    /* ── Bar / Line / Area ── */
    if (config.measures.length === 0) return <ChartEmpty message="Πρόσθεσε τουλάχιστον ένα μέτρο (Y) από τις Ρυθμίσεις." />;
    if (!agg || chartRows.length === 0) return <ChartEmpty message="Καμία γραμμή με τιμές για αυτόν τον συνδυασμό X / Y." />;

    const labels = chartRows.map((r) => String(r.__x ?? ""));
    const maxLabel = labels.reduce((a, l) => Math.max(a, l.length), 0);
    const horizontal = config.type === "bar" && xMode === "category" && !compactTime && (chartRows.length > 14 || maxLabel > 18);
    const stacked = stackMode !== "none";
    const multiSeries = seriesList.length > 1;
    const Tip = makeTooltip({
      labelFormatter: (v) => (xMode === "time" ? fmtFullTime(v) : compactTime ? fmtFullTime(parseTime(v)) : typeof v === "number" ? fmtNum(v) : String(v ?? "")),
      unitOf: (k) => {
        const s = seriesList.find((x) => x.key === k);
        return s ? unitOfMeasure(s.measure) : "";
      },
    });

    const sideKeys = (side: YSide) => seriesList.filter((s) => s.measure.side === side && !dedicatedAxis.has(s.key)).map((s) => s.key);
    const axisLabel = (side: YSide) => {
      const list = seriesList.filter((s) => s.measure.side === side && !dedicatedAxis.has(s.key));
      const units = [...new Set(list.map((s) => unitOfMeasure(s.measure)))];
      if (units.length === 1 && units[0]) return units[0];
      return [...new Set(list.map((s) => measureLabel(s.measure, labelOf)))].join(", ").slice(0, 28);
    };
    const fromZero = config.type !== "line";
    const leftAxis = stackMode === "percent" ? { domain: [0, 100] as [number, number], ticks: [0, 25, 50, 75, 100] } : stacked ? undefined : valueAxis(chartRows, horizontal ? seriesList.map((s) => s.key) : sideKeys("left"), fromZero);
    const hasRight = !horizontal && sideKeys("right").length > 0;
    const rightAxis = hasRight && !stacked ? valueAxis(chartRows, sideKeys("right"), fromZero) : undefined;
    const tickFmt = (v: unknown) => fmtNum(Number(v));

    // Μία σειρά πάνω σε operators / call status: κάθε bar με το χρώμα της οντότητάς του
    // (brand / status). Αυθαίρετες κατηγορίες μένουν μονόχρωμες — χρώμα ανά bar εκεί δεν σημαίνει τίποτα.
    const xColors = config.type === "bar" && !splitCol && seriesList.length === 1 && xMode === "category"
      ? (() => {
          const colors = buildGroupColors(labels);
          return operatorKeysOf(labels) || statusColorsOf(labels) ? colors : null;
        })()
      : null;
    // Επιλεκτικά direct labels: μόνο σε λίγα, μη-στοιβαγμένα bars — ποτέ αριθμός σε κάθε σημείο.
    const valueLabels = config.type === "bar" && !stacked && !compactTime && chartRows.length * seriesList.length <= 24;

    const renderSeries = (s: (typeof seriesList)[number]) => {
      const dedicated = dedicatedAxis.get(s.key);
      const axisId = horizontal ? undefined : dedicated ? dedicated.id : s.measure.side;
      const common = { dataKey: s.key, name: s.name, isAnimationActive: chartRows.length < 400 };
      if (config.type === "bar") {
        return (
          <Bar key={s.key} {...common} yAxisId={axisId} fill={s.color} fillOpacity={DEFAULTS.barFillOpacity}
            stackId={stacked ? s.measure.id : undefined}
            stroke={stacked ? "hsl(var(--background))" : undefined} strokeWidth={stacked ? 2 : 0}
            radius={stacked ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
            maxBarSize={horizontal ? 22 : 36}>
            {xColors && chartRows.map((r) => <Cell key={String(r.__x)} fill={xColors.get(String(r.__x)) ?? s.color} />)}
            {valueLabels && (
              <LabelList dataKey={s.key} position={horizontal ? "right" : "top"} fontSize={10} fill="hsl(var(--foreground))"
                formatter={(v: unknown) => fmtValue(v, unitOfMeasure(s.measure))} />
            )}
          </Bar>
        );
      }
      if (config.type === "area") {
        return (
          <Area key={s.key} {...common} yAxisId={axisId} stroke={s.color} fill={s.color} fillOpacity={DEFAULTS.areaFillOpacity}
            type={xMode === "category" ? "linear" : "monotone"} stackId={stacked ? s.measure.id : undefined}
            dot={false} strokeWidth={1.8} strokeDasharray={s.dash} connectNulls={xMode !== "category" && !breakGaps} />
        );
      }
      return (
        <Line key={s.key} {...common} yAxisId={axisId} stroke={s.color} type={xMode === "category" ? "linear" : "monotone"}
          dot={chartRows.length <= 40 ? { r: 2.5, strokeWidth: 0, fill: s.color } : false} activeDot={{ r: 4 }}
          strokeWidth={2} strokeDasharray={s.dash} connectNulls={xMode !== "category" && !breakGaps} />
      );
    };

    if (horizontal) {
      const perRow = config.type === "bar" && !stacked ? Math.max(1, seriesList.length) : 1;
      const height = Math.min(1600, Math.max(H, chartRows.length * (perRow * 14 + 12) + 70));
      return (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={chartRows} layout="vertical" margin={{ top: 8, right: valueLabels ? 64 : 24, left: 8, bottom: 8 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis type="number" {...AXIS_STYLE} domain={leftAxis?.domain} ticks={leftAxis?.ticks} tickFormatter={tickFmt} />
            <YAxis type="category" dataKey="__x" {...AXIS_STYLE} width={Math.min(240, Math.max(80, maxLabel * 6.2))}
              interval={0} tickFormatter={(v) => String(v ?? "").slice(0, 38)} />
            <Tooltip content={<Tip />} cursor={{ fill: "hsl(var(--muted) / 0.35)" }} />
            {multiSeries && <Legend {...LEGEND_TOP} />}
            {seriesList.map(renderSeries)}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    const tilted = xMode === "category" && !compactTime && chartRows.length > 6 && maxLabel > 8;
    const xAxisProps = xMode === "time"
      ? { type: "number" as const, scale: "time" as const, domain: ["dataMin", "dataMax"] as [string, string], minTickGap: 28, tickFormatter: timeTickFormatter(timeInfo.span) }
      : xMode === "numeric"
        ? { type: "number" as const, domain: ["dataMin", "dataMax"] as [number | string, number | string], ...numericXAxis(chartRows), tickFormatter: tickFmt }
        : compactTime
          ? { interval: "preserveStartEnd" as const, minTickGap: 24, tickFormatter: (v: unknown) => timeTickFormatter(timeInfo.span)(parseTime(v)) }
          : { interval: 0 as const, tickFormatter: (v: unknown) => String(v ?? "").slice(0, 22) };

    return (
      <ResponsiveContainer width="100%" height={tilted ? H + 50 : H}>
        <ComposedChart data={chartRows} margin={{ top: valueLabels ? 20 : 8, right: hasRight ? 12 : 20, left: 0, bottom: tilted ? 70 : 28 }}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="__x" {...AXIS_STYLE} {...xAxisProps} angle={tilted ? -35 : 0} textAnchor={tilted ? "end" : "middle"}>
            {xMode !== "total" && (
              <Label value={labelOf(config.x)} offset={tilted ? -62 : -14} position="insideBottom" fontSize={10} fill="hsl(var(--muted-foreground))" />
            )}
          </XAxis>
          <YAxis yAxisId="left" orientation="left" {...AXIS_STYLE} width={60} domain={leftAxis?.domain} ticks={leftAxis?.ticks} tickFormatter={tickFmt}
            label={{ value: stackMode === "percent" ? "%" : axisLabel("left"), angle: -90, position: "insideLeft", fontSize: 9, fill: "hsl(var(--muted-foreground))", dx: 4 }} />
          {hasRight && (
            <YAxis yAxisId="right" orientation="right" {...AXIS_STYLE} width={60} domain={rightAxis?.domain} ticks={rightAxis?.ticks} tickFormatter={tickFmt}
              label={{ value: axisLabel("right"), angle: 90, position: "insideRight", fontSize: 9, fill: "hsl(var(--muted-foreground))", dx: -4 }} />
          )}
          {dedicatedAxes.map((ax) => <YAxis key={ax.id} yAxisId={ax.id} domain={ax.domain} reversed={ax.reversed} hide />)}
          <Tooltip content={<Tip />} cursor={config.type === "bar" ? { fill: "hsl(var(--muted) / 0.35)" } : { stroke: "hsl(var(--border))" }} />
          {multiSeries && <Legend {...LEGEND_TOP} />}
          {seriesList.map(renderSeries)}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }, [config, xMode, pieMeasure, pie, distProfile, dist, splitCol, groupInfo.colors, labelOf, scatter, pmap, xProfile, agg, chartRows, stackMode, seriesList, unitOfMeasure, dedicatedAxis, dedicatedAxes, timeInfo.span, breakGaps, compactTime]);

  // ─────────────────────────────────────────────────────────────────────────

  const showSides = config.type === "line" || config.type === "area" || (config.type === "bar" && !splitCol);
  const numericCols = profiles.filter((p) => p.numeric && !p.derived);
  const xOptions = (
    <>
      <option value="">— Σύνολο (χωρίς X) —</option>
      <DimensionOptions profiles={profiles} />
      {profiles.some((p) => p.role === "time") && (
        <optgroup label="Χρόνος">
          {profiles.filter((p) => p.role === "time").map((p) => <option key={p.col} value={p.col}>{p.label}</option>)}
        </optgroup>
      )}
      <optgroup label="Αριθμητικά (σε bins)">
        {numericCols.filter((p) => !["id", "flag"].includes(p.role)).map((p) => <option key={p.col} value={p.col}>{p.label}</option>)}
      </optgroup>
    </>
  );
  const splitOptions = (
    <>
      <option value="">— καμία (μία σειρά ανά μέτρο) —</option>
      <DimensionOptions profiles={profiles.filter((p) => p.distinct <= 200)} exclude={[config.x]} />
    </>
  );

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3 pb-2.5 border-b border-border/60 bg-muted/20">
        <ChartTypeBar value={config.type} onChange={switchType} />
        <div className="ml-auto flex items-center gap-2">
          {filters.some((f) => f.vals.length > 0) && (
            <span className="text-[10px] text-amber-500 font-medium bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
              {filters.filter((f) => f.vals.length > 0).length} φίλτρο{filters.filter((f) => f.vals.length > 0).length > 1 ? "α" : ""}
            </span>
          )}
          {filteredRows.length < data.length && (
            <span className="text-[10px] text-muted-foreground bg-muted/50 border border-border rounded px-1.5 py-0.5 font-mono">
              {filteredRows.length.toLocaleString("el-GR")} / {data.length.toLocaleString("el-GR")} γρ.
            </span>
          )}
          <button
            onClick={() => setShowConfig((v) => !v)}
            className={[
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[10px] font-medium transition-all",
              showConfig ? "bg-primary/15 border-primary/40 text-primary" : "bg-muted/40 border-border text-muted-foreground hover:text-foreground hover:bg-muted/60",
            ].join(" ")}
          >
            <SlidersHorizontal className="h-3 w-3" />
            Ρυθμίσεις
          </button>
        </div>
      </div>

      {/* ── Προτάσεις ── */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border/40 bg-muted/5">
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70 mr-1">
            <Sparkles className="h-3 w-3" /> Προτάσεις
          </span>
          {suggestions.map((s) => (
            <button
              key={s.id}
              data-suggestion={s.id}
              onClick={() => applySuggestion(s)}
              title={s.measures.map((m) => describeMeasure(m, labelOf)).join(" · ") || s.title}
              className={[
                "px-2 py-0.5 rounded-full border text-[10px] transition-all max-w-[320px] truncate",
                activeSuggestion === s.id
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-muted/30 border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
              ].join(" ")}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}

      {/* ── Ρυθμίσεις ── */}
      <AnimatePresence initial={false}>
        {showConfig && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden border-b border-border/60"
          >
            <div className="px-4 py-3 border-b border-border/40 bg-muted/10 grid gap-3 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
              {/* X */}
              {(isXY || config.type === "pie" || config.type === "scatter") && (
                <ConfigCard label={config.type === "pie" ? "Κομμάτια (κατηγορία)" : config.type === "scatter" ? "X (αριθμητικό)" : "X άξονας"}>
                  <FieldSelect value={config.x} onChange={(v) => update({ x: v })}>
                    {config.type === "scatter"
                      ? numericCols.filter((p) => !["id", "flag"].includes(p.role)).map((p) => <option key={p.col} value={p.col}>{p.label}</option>)
                      : xOptions}
                  </FieldSelect>
                  {isXY && xMode === "category" && !compactTime && (
                    <FieldSelect value={config.sort} onChange={(v) => update({ sort: v as SortMode })} title="Σειρά κατηγοριών">
                      <option value="auto">Σειρά: αυτόματη ({resolvedSort === "operator" ? "operators" : resolvedSort === "scope" ? "χρονολογικά" : resolvedSort === "value" ? "τιμή" : resolvedSort === "label" ? "Α→Ω" : "όπως ήρθαν"})</option>
                      <option value="value">Σειρά: τιμή ↓</option>
                      <option value="label">Σειρά: Α→Ω</option>
                      <option value="none">Σειρά: όπως ήρθαν</option>
                    </FieldSelect>
                  )}
                  {isXY && xIsTime && (
                    <FieldSelect value={config.timeGrain} onChange={(v) => update({ timeGrain: v as TimeGrain })} title="Ομαδοποίηση χρόνου">
                      {(Object.keys(GRAIN_LABEL) as TimeGrain[]).map((g) => (
                        <option key={g} value={g}>{g === "auto" ? `Χρόνος: αυτόματα (${GRAIN_LABEL[timeInfo.grain]})` : `Χρόνος: ${GRAIN_LABEL[g]}`}</option>
                      ))}
                    </FieldSelect>
                  )}
                  {isXY && xMode === "numeric" && (
                    <FieldSelect value={config.bins} onChange={(v) => update({ bins: v as BinsMode })} title="Bins στον αριθμητικό X">
                      <option value="auto">Bins: αυτόματα ({numericBins ? `${numericBins}` : "ακριβείς τιμές"})</option>
                      <option value="exact">Ακριβείς τιμές</option>
                      <option value="20">20 bins</option>
                      <option value="40">40 bins</option>
                      <option value="80">80 bins</option>
                    </FieldSelect>
                  )}
                </ConfigCard>
              )}

              {config.type === "dist" && (
                <ConfigCard label="Μέτρο κατανομής">
                  <FieldSelect value={config.distCol} onChange={(v) => update({ distCol: v, binWidth: null })}>
                    <ColumnOptions profiles={profiles} include={(p) => p.numeric && !["id", "flag", "count"].includes(p.role)} />
                  </FieldSelect>
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented value={config.distMode} onChange={(v) => update({ distMode: v })}
                      options={[{ value: "pdf", label: "PDF %" }, { value: "cdf", label: "CDF %" }]} />
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      bin
                      <input
                        type="number" min={0} step="any"
                        value={config.binWidth ?? ""}
                        placeholder={dist ? fmtNum(dist.binWidth) : "auto"}
                        onChange={(e) => update({ binWidth: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) || null })}
                        className="w-16 bg-background border border-border rounded px-1.5 py-0.5 text-[10px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                      />
                    </label>
                  </div>
                </ConfigCard>
              )}

              {/* Split */}
              {config.type !== "pie" && (
                <ConfigCard label="Σειρές ανά (split)">
                  <FieldSelect value={config.split} onChange={(v) => update({ split: v })}>{splitOptions}</FieldSelect>
                  {splitCol && (config.type === "bar" || config.type === "area") && (
                    <Segmented
                      value={stackMode}
                      onChange={(v) => update({ stack: v })}
                      options={[
                        { value: "none", label: "Δίπλα" },
                        { value: "stack", label: "Στοίβα" },
                        { value: "percent", label: "100%", disabled: !allAdditive, title: allAdditive ? "Μερίδιο κάθε σειράς μέσα στο X" : "Μόνο για πλήθη / αθροίσματα — μερίδια μέσων όρων δεν έχουν νόημα" },
                      ]}
                    />
                  )}
                  {splitCol && groupInfo.groups.includes(OTHER_LABEL) && (
                    <p className="text-[10px] text-muted-foreground">Top 7 τιμές + «Άλλα» — περισσότερα χρώματα δεν ξεχωρίζουν.</p>
                  )}
                </ConfigCard>
              )}

              {/* Μέτρα */}
              {(isXY || config.type === "pie" || config.type === "scatter") && (
                <ConfigCard
                  label={config.type === "scatter" ? "Y (αριθμητικό)" : config.type === "pie" ? "Μέγεθος (COUNT / SUM)" : `Μέτρα Y — κάθε στήλη με τη δική της συνάρτηση (${config.measures.length})`}
                  className="md:col-span-2 xl:col-span-1"
                >
                  {config.type === "scatter" ? (
                    <FieldSelect value={config.measures[0]?.col ?? ""} onChange={(v) => update({ measures: v ? withLook([measureFromColumn(pmap.get(v)!, "avg")]) : [] })}>
                      <option value="">— επιλογή —</option>
                      {numericCols.filter((p) => p.col !== config.x && !["id", "flag"].includes(p.role)).map((p) => <option key={p.col} value={p.col}>{p.label}</option>)}
                    </FieldSelect>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1.5 min-h-[26px]">
                        {config.measures.length === 0 && <span className="text-[10px] text-muted-foreground italic self-center">Κανένα μέτρο</span>}
                        {config.measures.map((m) => {
                          const p = pmap.get(m.col);
                          const custom = m.agg === "ratio" && (!p || p.denomCol !== m.denomCol || m.scale);
                          let options = custom || m.col === ROWS_COL ? [m.agg] : allowedAggs(p);
                          if (config.type === "pie") options = options.filter((a) => a === "sum" || a === "count");
                          if (!options.includes(m.agg)) options = [m.agg, ...options];
                          return (
                            <MeasurePill
                              key={m.id}
                              m={m}
                              label={`${measureLabel(m, labelOf)} — ${describeMeasure(m, labelOf)}`}
                              aggOptions={options}
                              showSide={showSides && config.type !== "pie"}
                              onAgg={(a) => changeAgg(m.id, a)}
                              onSide={() => setMeasures((prev) => prev.map((x) => (x.id === m.id ? { ...x, side: x.side === "left" ? "right" : "left" } : x)))}
                              onRemove={() => setMeasures((prev) => prev.filter((x) => x.id !== m.id))}
                            />
                          );
                        })}
                      </div>
                      {config.type !== "pie" && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <select value={addCol} onChange={(e) => setAddCol(e.target.value)}
                            className="flex-1 min-w-[160px] bg-background border border-border rounded-md px-2 py-1.5 text-[11px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40">
                            <option value="">— προσθήκη μέτρου —</option>
                            <option value={ROWS_COL}>Πλήθος γραμμών (COUNT)</option>
                            <ColumnOptions profiles={profiles} include={(p) => !p.derived} />
                          </select>
                          <button onClick={addMeasure} disabled={!addCol}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 text-primary text-[11px] font-medium hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0">
                            <Plus className="h-3 w-3" /> Μέτρο
                          </button>
                          <button onClick={() => setRatioDraft((d) => (d ? null : { num: "", den: "", pct: true }))}
                            title="KPI ως λόγος αθροισμάτων, π.χ. Σ CallDropped / Σ Callconnected × 100"
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-dashed border-border text-muted-foreground text-[11px] font-medium hover:text-foreground transition-colors shrink-0">
                            <Sigma className="h-3 w-3" /> Λόγος Σ/Σ
                          </button>
                        </div>
                      )}
                      {ratioDraft && (
                        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-background/40 p-2">
                          <span className="text-[10px] text-muted-foreground">Σ</span>
                          <select value={ratioDraft.num} onChange={(e) => setRatioDraft({ ...ratioDraft, num: e.target.value })}
                            className="flex-1 min-w-[120px] bg-background border border-border rounded px-1.5 py-1 text-[10px] font-mono text-foreground">
                            <option value="">αριθμητής</option>
                            {numericCols.filter((p) => p.role !== "id").map((p) => <option key={p.col} value={p.col}>{p.col}</option>)}
                          </select>
                          <span className="text-[10px] text-muted-foreground">/ Σ</span>
                          <select value={ratioDraft.den} onChange={(e) => setRatioDraft({ ...ratioDraft, den: e.target.value })}
                            className="flex-1 min-w-[120px] bg-background border border-border rounded px-1.5 py-1 text-[10px] font-mono text-foreground">
                            <option value="">παρονομαστής</option>
                            {numericCols.filter((p) => p.role !== "id").map((p) => <option key={p.col} value={p.col}>{p.col}</option>)}
                          </select>
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <input type="checkbox" checked={ratioDraft.pct} onChange={(e) => setRatioDraft({ ...ratioDraft, pct: e.target.checked })} className="accent-primary" />
                            × 100 (%)
                          </label>
                          <button onClick={addRatio} disabled={!ratioDraft.num || !ratioDraft.den}
                            className="px-2 py-1 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] font-medium disabled:opacity-30">
                            Προσθήκη
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </ConfigCard>
              )}
            </div>

            {/* Φίλτρα */}
            <div className="px-4 py-2.5 bg-muted/5 space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Φίλτρα</p>
                <button
                  onClick={() => setFilters((f) => [...f, { col: profiles.find((p) => p.role === "dimension")?.col ?? columns[0] ?? "", vals: [] }])}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-dashed border-primary/40 bg-primary/5 text-primary text-[10px] font-medium hover:bg-primary/10 transition-colors"
                >
                  <Plus className="h-3 w-3" /> Προσθήκη
                </button>
                {filters.length > 0 && (
                  <button onClick={() => setFilters([])} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    Καθαρισμός όλων
                  </button>
                )}
              </div>
              {filters.map((f, fi) => (
                <div key={fi} className="rounded-md border border-border/60 bg-muted/20 p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <select value={f.col}
                      onChange={(e) => setFilters((prev) => prev.map((x, i) => (i === fi ? { col: e.target.value, vals: [] } : x)))}
                      className="flex-1 bg-background border border-border rounded-md px-2 py-1 text-[11px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40">
                      <DimensionOptions profiles={profiles} />
                      <optgroup label="Άλλες στήλες">
                        {profiles.filter((p) => !p.derived && p.role !== "dimension").map((p) => <option key={p.col} value={p.col}>{p.col}</option>)}
                      </optgroup>
                    </select>
                    <button onClick={() => setFilters((prev) => prev.filter((_, i) => i !== fi))}
                      className="opacity-50 hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                    {uniqueVals(f.col).map((v) => {
                      const selected = f.vals.includes(v);
                      return (
                        <button key={v}
                          onClick={() => setFilters((prev) => prev.map((x, i) => {
                            if (i !== fi) return x;
                            return { ...x, vals: x.vals.includes(v) ? x.vals.filter((s) => s !== v) : [...x.vals, v] };
                          }))}
                          className={[
                            "px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all",
                            selected ? "bg-primary/15 border-primary/40 text-primary" : "bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground hover:border-border",
                          ].join(" ")}
                        >
                          {v === "" ? BLANK_LABEL : v.slice(0, 28)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── KPI κάρτες: η ίδια συνάρτηση πάνω σε όλες τις γραμμές ── */}
      {tiles && tiles.length > 0 && (
        <div className="px-4 py-2.5 border-b border-border/40 bg-muted/5 flex flex-wrap gap-2.5">
          {tiles.map(({ m, value, n, groups }) => {
            const unit = measureUnit(m, pmap);
            return (
              <div key={m.id} className="flex items-stretch rounded-lg border border-border/60 overflow-hidden min-w-0">
                <div className="w-1 shrink-0" style={{ backgroundColor: m.color }} />
                <div className="px-2.5 py-1.5 space-y-0.5 min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground truncate max-w-[260px]" title={describeMeasure(m, labelOf)}>
                    {measureLabel(m, labelOf)}
                  </p>
                  <p className="flex items-baseline gap-2">
                    <span className="text-[15px] font-semibold text-foreground leading-tight">{fmtValue(value, unit)}</span>
                    {typeof n === "number" && <span className="text-[10px] text-muted-foreground font-mono">n={n.toLocaleString("el-GR")}</span>}
                  </p>
                  {groups.length > 0 && (
                    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                      {groups.map(({ g, value: gv }) => (
                        <span key={g} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: groupInfo.colors.get(g) ?? UNKNOWN_OPERATOR_COLOR }} />
                          {g.slice(0, 18)} <span className="font-mono text-foreground/85">{fmtValue(gv, unit)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {config.type === "dist" && dist && dist.groups.length > 0 && (
        <div className="px-4 py-2.5 border-b border-border/40 bg-muted/5 flex flex-wrap gap-2.5">
          {dist.groups.map((g) => {
            const s = dist.stats.get(g);
            const color = splitCol ? groupInfo.colors.get(g) ?? UNKNOWN_OPERATOR_COLOR : CHART_PALETTE[0];
            const unit = distProfile?.unit ?? "";
            return (
              <div key={g} className="flex items-stretch rounded-lg border border-border/60 overflow-hidden">
                <div className="w-1 shrink-0" style={{ backgroundColor: color }} />
                <div className="px-2.5 py-1.5">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</p>
                  <div className="flex gap-3 text-[11px] font-mono">
                    {[["AVG", s?.avg], ["P10", s?.p10], ["P50", s?.p50], ["P90", s?.p90]].map(([label, v]) => (
                      <span key={label as string} className="flex flex-col">
                        <span className="text-[8px] font-bold text-muted-foreground/60">{label as string}</span>
                        <span className="text-foreground">{fmtValue(v, unit)}</span>
                      </span>
                    ))}
                    <span className="flex flex-col">
                      <span className="text-[8px] font-bold text-muted-foreground/60">N</span>
                      <span className="text-muted-foreground">{(s?.n ?? 0).toLocaleString("el-GR")}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Chart ── */}
      <div className="px-2 pt-4 pb-2">{chart}</div>

      {/* ── Πώς υπολογίζεται + πίνακας τιμών ── */}
      <div className="px-4 pb-3 space-y-2">
        {explanation && (
          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{explanation}</span>
          </p>
        )}
        {table && table.rows.length > 0 && (
          <div>
            <button
              onClick={() => setShowTable((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Table2 className="h-3 w-3" />
              {showTable ? "Απόκρυψη" : "Εμφάνιση"} πίνακα τιμών ({table.rows.length})
            </button>
            {showTable && (
              <div className="mt-1.5 max-h-80 overflow-auto rounded-md border border-border">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="text-left text-muted-foreground">
                      {table.headers.map((h, i) => <th key={i} className="px-2.5 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r, i) => (
                      <tr key={i} className="border-t border-border/50 hover:bg-muted/20">
                        {r.map((c, j) => <td key={j} className={`px-2.5 py-1 whitespace-nowrap ${j === 0 ? "text-foreground" : "font-mono tabular-nums text-foreground/90"}`}>{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
