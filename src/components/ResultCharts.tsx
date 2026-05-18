import { useCallback, useMemo, useState } from "react";
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
  Layers2,
} from "lucide-react";

// ─── Module-level constants ───────────────────────────────────────────────────

const PALETTE = [
  "hsl(162, 72%, 46%)",
  "hsl(200, 80%, 55%)",
  "hsl(45,  93%, 58%)",
  "hsl(280, 65%, 60%)",
  "hsl(0,   72%, 55%)",
  "hsl(30,  90%, 55%)",
  "hsl(340, 75%, 58%)",
  "hsl(120, 55%, 48%)",
];

const MAX_POINTS = 600;
const GROUPING_THRESHOLD = 200; // auto-bin when slice has more rows than this
const DEFAULT_BINS = 80;

const AXIS_STYLE = {
  tick: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
} as const;

const GRID_STYLE = {
  strokeDasharray: "3 3",
  stroke: "hsl(var(--border))",
  opacity: 0.4,
} as const;

const fmtXTick   = (v: unknown) => String(v ?? "").slice(0, 14);
const fmtLegend  = (v: string) => <span className="text-xs text-foreground">{v}</span>;
const fmtPieLabel = ({ name, percent }: { name: string; percent: number }) =>
  `${String(name).slice(0, 16)} ${(percent * 100).toFixed(1)}%`;

// ─── Types ────────────────────────────────────────────────────────────────────

type ChartType = "line" | "bar" | "area" | "scatter" | "pie";
type YSide = "left" | "right";

interface YSeries {
  col: string;
  side: YSide;
  color: string;
}

interface ResultChartsProps {
  columns: string[];
  data: Record<string, unknown>[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function isNumericCol(col: string, sample: Record<string, unknown>[]): boolean {
  return sample.some((r) => toNum(r[col]) !== null);
}

// Prefer operator/categorical columns as the default X axis.
// Priority: exact known operator columns first, then any string-valued column.
const OPERATOR_COL_PRIORITY = [
  "ASideLocation", "Location", "location",
  "CollectionName", "collection",
  "operator", "Operator",
  "technology", "Technology",
  "callStatus", "status", "Status",
  "callType", "callMode",
];

function pickDefaultXCol(columns: string[], sample: Record<string, unknown>[]): string {
  for (const preferred of OPERATOR_COL_PRIORITY) {
    if (columns.includes(preferred)) return preferred;
  }
  // Fall back to first non-numeric column
  const strCol = columns.find((c) => !isNumericCol(c, sample));
  return strCol ?? columns[0] ?? "";
}

// For the pie value, avoid count/total columns and prefer avg/mos/rate columns.
const COUNT_COL_PATTERN = /^(count|total|calls|cnt|num|n_|rows)/i;
const AVG_COL_PATTERN   = /^(avg|mean|mos|rate|pct|percent|ratio|score|throughput|rsrp|rsrq|sinr|setup|duration)/i;

function pickDefaultPieValue(numericCols: string[]): string {
  const avgCol = numericCols.find((c) => AVG_COL_PATTERN.test(c));
  if (avgCol) return avgCol;
  const nonCount = numericCols.find((c) => !COUNT_COL_PATTERN.test(c));
  return nonCount ?? numericCols[0] ?? "";
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-xl text-xs space-y-0.5 max-w-xs">
      {label !== undefined && (
        <p className="font-semibold text-foreground mb-1.5 truncate border-b border-border pb-1">
          {String(label)}
        </p>
      )}
      {payload.map((e: any, i: number) => (
        <p key={i} style={{ color: e.color ?? e.fill }} className="font-mono truncate flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: e.color ?? e.fill }} />
          <span className="text-muted-foreground">{e.name}:</span>{" "}
          <span>
            {typeof e.value === "number"
              ? e.value.toLocaleString("el-GR", { maximumFractionDigits: 3 })
              : String(e.value ?? "")}
          </span>
        </p>
      ))}
    </div>
  );
};

const PieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const e = payload[0];
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold truncate mb-0.5">{String(e.name)}</p>
      <p className="font-mono" style={{ color: e.payload.fill }}>
        {typeof e.value === "number"
          ? e.value.toLocaleString("el-GR", { maximumFractionDigits: 3 })
          : e.value}{" "}
        <span className="text-muted-foreground">({((e.payload.percent ?? 0) * 100).toFixed(1)}%)</span>
      </p>
    </div>
  );
};

// ─── Chart type descriptors ───────────────────────────────────────────────────

const CHART_TYPES: { type: ChartType; label: string; icon: React.ReactNode }[] = [
  { type: "line",    label: "Line",    icon: <LineIcon  className="h-3.5 w-3.5" /> },
  { type: "bar",     label: "Bar",     icon: <BarChart2 className="h-3.5 w-3.5" /> },
  { type: "area",    label: "Area",    icon: <Activity  className="h-3.5 w-3.5" /> },
  { type: "scatter", label: "Scatter", icon: <Crosshair className="h-3.5 w-3.5" /> },
  { type: "pie",     label: "Pie",     icon: <PieIcon   className="h-3.5 w-3.5" /> },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Segmented chart-type selector */
function ChartTypeBar({
  value,
  onChange,
}: {
  value: ChartType;
  onChange: (t: ChartType) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 border border-border p-0.5">
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

/** Improved Y series pill */
const YPill = ({
  series,
  onToggleSide,
  onRemove,
}: {
  series: YSeries;
  onToggleSide: () => void;
  onRemove: () => void;
}) => (
  <span
    className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full border text-[11px] font-mono"
    style={{
      backgroundColor: series.color + "18",
      borderColor: series.color + "70",
      color: series.color,
    }}
  >
    <span
      className="h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: series.color }}
    />
    <span className="max-w-[120px] truncate">{series.col}</span>
    <button
      onClick={onToggleSide}
      title="Toggle left/right axis"
      className="ml-0.5 flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-bold leading-4 border transition-colors"
      style={{
        borderColor: series.color + "70",
        backgroundColor: series.color + "25",
        color: series.color,
      }}
    >
      {series.side === "left"
        ? <><ChevronLeft className="h-2.5 w-2.5" />L</>
        : <>R<ChevronRight className="h-2.5 w-2.5" /></>}
    </button>
    <button
      onClick={onRemove}
      className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity p-0.5 rounded-full hover:bg-black/10"
      title="Remove"
    >
      <X className="h-2.5 w-2.5" />
    </button>
  </span>
);

/** Config card wrapper */
function ConfigCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md bg-muted/30 border border-border/60 p-2.5 space-y-1.5">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
        {label}
      </p>
      {children}
    </div>
  );
}

/** Styled select */
function FieldSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-[11px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
    >
      {children}
    </select>
  );
}

/** Empty chart state */
function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-muted-foreground">
      <BarChart className="h-8 w-8 opacity-20" />
      <p className="text-xs text-center max-w-[220px]">{message}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ResultCharts({ columns, data }: ResultChartsProps) {
  // ── Derived from props ──────────────────────────────────────────────────

  const slice  = useMemo(
    () => (data.length > MAX_POINTS ? data.slice(0, MAX_POINTS) : data),
    [data],
  );
  const sample = useMemo(() => slice.slice(0, 40), [slice]);

  const numericCols = useMemo(
    () => columns.filter((c) => isNumericCol(c, sample)),
    [columns, sample],
  );

  // ── State ───────────────────────────────────────────────────────────────

  const [chartType, setChartType] = useState<ChartType>("bar");
  const [xCol,      setXCol]      = useState(() => pickDefaultXCol(columns, sample));
  const [addYCol,   setAddYCol]   = useState("");
  const [pieLabel,  setPieLabel]  = useState(columns[0] ?? "");
  const [pieValue,  setPieValue]  = useState(() => pickDefaultPieValue(numericCols));

  const [ySeries, setYSeries] = useState<YSeries[]>(() =>
    numericCols.slice(0, 2).map((col, i) => ({
      col,
      side: "left" as YSide,
      color: PALETTE[i % PALETTE.length],
    })),
  );

  const [grouping,  setGrouping]  = useState(true);
  const [numBins,   setNumBins]   = useState(DEFAULT_BINS);

  // ── Y series handlers ───────────────────────────────────────────────────

  const addY = useCallback(() => {
    if (!addYCol) return;
    setYSeries((prev) => {
      if (prev.some((s) => s.col === addYCol)) return prev;
      return [...prev, { col: addYCol, side: "left", color: PALETTE[prev.length % PALETTE.length] }];
    });
    setAddYCol("");
  }, [addYCol]);

  const removeY     = useCallback((col: string) => setYSeries((p) => p.filter((s) => s.col !== col)), []);
  const toggleSide  = useCallback(
    (col: string) =>
      setYSeries((p) =>
        p.map((s) => (s.col === col ? { ...s, side: s.side === "left" ? "right" : "left" } : s)),
      ),
    [],
  );

  // ── Derived memos ───────────────────────────────────────────────────────

  const availableToAdd = useMemo(
    () => columns.filter((c) => !ySeries.some((s) => s.col === c)),
    [columns, ySeries],
  );

  const xIsNumeric = useMemo(() => numericCols.includes(xCol), [numericCols, xCol]);

  const shouldGroup = useMemo(
    () => grouping && xIsNumeric && slice.length > GROUPING_THRESHOLD,
    [grouping, xIsNumeric, slice.length],
  );

  // Bin slice into numBins buckets along X, aggregate Y as mean
  const binnedData = useMemo((): Record<string, unknown>[] | null => {
    if (!shouldGroup || ySeries.length === 0) return null;
    const xVals = slice.map((r) => toNum(r[xCol])).filter((v): v is number => v !== null);
    if (xVals.length === 0) return null;
    const xMin = Math.min(...xVals);
    const xMax = Math.max(...xVals);
    if (xMin === xMax) return null;

    const binSize = (xMax - xMin) / numBins;
    const sums:   Record<number, Record<string, number>> = {};
    const counts: Record<number, Record<string, number>> = {};

    for (const row of slice) {
      const x = toNum(row[xCol]);
      if (x === null) continue;
      const bi = Math.min(Math.floor((x - xMin) / binSize), numBins - 1);
      if (!sums[bi])   { sums[bi]   = {}; counts[bi] = {}; }
      for (const s of ySeries) {
        const y = toNum(row[s.col]);
        if (y !== null) {
          sums[bi][s.col]   = (sums[bi][s.col]   ?? 0) + y;
          counts[bi][s.col] = (counts[bi][s.col] ?? 0) + 1;
        }
      }
    }

    return Array.from({ length: numBins }, (_, i) => {
      const cx = +(xMin + (i + 0.5) * binSize).toFixed(4);
      const out: Record<string, unknown> = { __x: cx };
      let hasData = false;
      for (const s of ySeries) {
        const c = counts[i]?.[s.col];
        if (c) { out[s.col] = +(sums[i][s.col] / c).toFixed(4); hasData = true; }
      }
      return hasData ? out : null;
    }).filter((d): d is Record<string, unknown> => d !== null);
  }, [shouldGroup, slice, xCol, ySeries, numBins]);

  // ── Categorical / pivot mode ────────────────────────────────────────────
  // When the first Y series is a non-numeric column, we pivot:
  //   group rows by X, count occurrences of each unique Y value → stacked bar

  const yIsCategorical = useMemo(
    () => ySeries.length > 0 && !numericCols.includes(ySeries[0].col),
    [ySeries, numericCols],
  );

  // Top-N unique values of the categorical Y column (by total count)
  const pivotSeries = useMemo((): string[] => {
    if (!yIsCategorical || ySeries.length === 0) return [];
    const ycol = ySeries[0].col;
    const totals: Record<string, number> = {};
    for (const row of slice) {
      const v = String(row[ycol] ?? "(blank)");
      totals[v] = (totals[v] ?? 0) + 1;
    }
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([v]) => v);
  }, [yIsCategorical, ySeries, slice]);

  // Pivot table: { __x, [yVal]: count, ... } sorted by total desc, top 40 X values
  const pivotData = useMemo((): Record<string, unknown>[] => {
    if (!yIsCategorical || ySeries.length === 0 || pivotSeries.length === 0) return [];
    const ycol = ySeries[0].col;
    const agg: Record<string, Record<string, number>> = {};
    for (const row of slice) {
      const x = String(row[xCol] ?? "(blank)");
      const y = String(row[ycol] ?? "(blank)");
      if (!agg[x]) agg[x] = {};
      if (pivotSeries.includes(y)) agg[x][y] = (agg[x][y] ?? 0) + 1;
    }
    return Object.entries(agg)
      .map(([x, counts]) => {
        const out: Record<string, unknown> = { __x: x };
        for (const v of pivotSeries) out[v] = counts[v] ?? 0;
        return out;
      })
      .sort((a, b) => {
        const sa = pivotSeries.reduce((s, v) => s + ((a[v] as number) ?? 0), 0);
        const sb = pivotSeries.reduce((s, v) => s + ((b[v] as number) ?? 0), 0);
        return sb - sa;
      })
      .slice(0, 40);
  }, [yIsCategorical, ySeries, slice, xCol, pivotSeries]);

  const hasRight  = useMemo(() => ySeries.some((s) => s.side === "right"), [ySeries]);
  const leftLabel = useMemo(
    () => ySeries.filter((s) => s.side === "left").map((s) => s.col).join(", ").slice(0, 24),
    [ySeries],
  );
  const rightLabel = useMemo(
    () => ySeries.filter((s) => s.side === "right").map((s) => s.col).join(", ").slice(0, 24),
    [ySeries],
  );

  const rawChartData = useMemo(
    () =>
      slice.map((row) => {
        const out: Record<string, unknown> = { __x: row[xCol] ?? "" };
        for (const s of ySeries) out[s.col] = toNum(row[s.col]);
        return out;
      }),
    [slice, xCol, ySeries],
  );

  const chartData = useMemo(
    () => (shouldGroup && binnedData ? binnedData : rawChartData),
    [shouldGroup, binnedData, rawChartData],
  );

  const scatterData = useMemo(() => {
    const y0 = ySeries[0];
    if (!y0) return [];
    return slice
      .map((row) => ({ x: toNum(row[xCol]), y: toNum(row[y0.col]) }))
      .filter((p): p is { x: number; y: number } => p.x !== null && p.y !== null);
  }, [slice, xCol, ySeries]);

  const pieData = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const row of slice) {
      const k = String(row[pieLabel] ?? "(blank)");
      agg[k] = (agg[k] ?? 0) + (toNum(row[pieValue]) ?? 0);
    }
    return Object.entries(agg)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
  }, [slice, pieLabel, pieValue]);

  // ── Series renderer ─────────────────────────────────────────────────────

  const renderSeries = useCallback(
    (s: YSeries) => {
      const shared = {
        key:     s.col,
        dataKey: s.col,
        yAxisId: s.side,
        stroke:  s.color,
        fill:    s.color,
        name:    `${s.col} (${s.side === "left" ? "L" : "R"})`,
      };
      if (chartType === "bar")
        return <Bar  {...shared} radius={[3, 3, 0, 0]} maxBarSize={36} fillOpacity={0.82} />;
      if (chartType === "area")
        return <Area {...shared} type="monotone" dot={false} strokeWidth={1.8} fillOpacity={0.1} />;
      return      <Line {...shared} type="monotone" dot={false} strokeWidth={2} activeDot={{ r: 4 }} />;
    },
    [chartType],
  );

  // ── Chart render ────────────────────────────────────────────────────────

  const chart = useMemo(() => {
    const H = 320;

    if (chartType === "pie") {
      if (!pieValue || pieData.length === 0)
        return <ChartEmpty message="Επίλεξε label column και αριθμητικό value column." />;
      return (
        <ResponsiveContainer width="100%" height={H + 40}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="48%"
              outerRadius={110} label={fmtPieLabel} labelLine>
              {pieData.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<PieTooltip />} />
            <Legend formatter={fmtLegend} />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === "scatter") {
      if (!ySeries[0]) return <ChartEmpty message="Πρόσθεσε τουλάχιστον ένα Y column." />;
      return (
        <ResponsiveContainer width="100%" height={H}>
          <ScatterChart margin={{ top: 8, right: 32, left: 0, bottom: 36 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="x" type="number" name={xCol} {...AXIS_STYLE}>
              <Label value={xCol} offset={-12} position="insideBottom" fontSize={10} fill="hsl(var(--muted-foreground))" />
            </XAxis>
            <YAxis dataKey="y" type="number" name={ySeries[0].col} {...AXIS_STYLE} width={56} />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={scatterData as any} fill={ySeries[0].color} fillOpacity={0.65} name={ySeries[0].col} />
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    /* ── Categorical pivot (non-numeric Y) ── */
    if (yIsCategorical) {
      if (pivotData.length === 0)
        return <ChartEmpty message="Επίλεξε X column (κατηγορία) και Y column (κατηγορία για ομαδοποίηση)." />;
      return (
        <ResponsiveContainer width="100%" height={H + 60}>
          <ComposedChart data={pivotData} margin={{ top: 8, right: 20, left: 0, bottom: 90 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="__x"
              {...AXIS_STYLE}
              angle={-35}
              textAnchor="end"
              interval={0}
              tickFormatter={(v) => String(v ?? "").slice(0, 22)}
            >
              <Label value={xCol} offset={-75} position="insideBottom" fontSize={10} fill="hsl(var(--muted-foreground))" />
            </XAxis>
            <YAxis yAxisId="left" orientation="left" {...AXIS_STYLE} width={40}
              label={{ value: "Count", angle: -90, position: "insideLeft", fontSize: 9, fill: "hsl(var(--muted-foreground))", dx: -4 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend formatter={fmtLegend} wrapperStyle={{ paddingTop: 8 }} />
            {pivotSeries.map((val, i) => (
              <Bar key={val} dataKey={val} yAxisId="left"
                fill={PALETTE[i % PALETTE.length]} stackId="stack"
                name={val} maxBarSize={60} fillOpacity={0.85}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    if (ySeries.length === 0) return <ChartEmpty message="Πρόσθεσε τουλάχιστον ένα Y column." />;

    return (
      <ResponsiveContainer width="100%" height={H}>
        <ComposedChart
          data={chartData}
          margin={{ top: 8, right: hasRight ? 64 : 20, left: 0, bottom: 36 }}
        >
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="__x" {...AXIS_STYLE} tickFormatter={fmtXTick} interval="preserveStartEnd">
            <Label value={xCol} offset={-12} position="insideBottom" fontSize={10} fill="hsl(var(--muted-foreground))" />
          </XAxis>
          <YAxis yAxisId="left" orientation="left" {...AXIS_STYLE} width={56}
            label={leftLabel ? { value: leftLabel, angle: -90, position: "insideLeft", fontSize: 9, fill: "hsl(var(--muted-foreground))", dx: -4 } : undefined}
          />
          {hasRight && (
            <YAxis yAxisId="right" orientation="right" {...AXIS_STYLE} width={60}
              label={{ value: rightLabel, angle: 90, position: "insideRight", fontSize: 9, fill: "hsl(var(--muted-foreground))", dx: 4 }}
            />
          )}
          <Tooltip content={<CustomTooltip />} />
          <Legend formatter={fmtLegend} wrapperStyle={{ paddingTop: 8 }} />
          {ySeries.map(renderSeries)}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }, [chartType, pieValue, pieData, ySeries, xCol, scatterData, chartData, hasRight, leftLabel, rightLabel, renderSeries, yIsCategorical, pivotData, pivotSeries]);

  // ─────────────────────────────────────────────────────────────────────────

  const isXY      = chartType !== "pie" && chartType !== "scatter";
  const isScatter = chartType === "scatter";
  const isPie     = chartType === "pie";

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">

      {/* ── Header: chart type ── */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2.5 border-b border-border/60 bg-muted/20">
        <ChartTypeBar value={chartType} onChange={setChartType} />
        {data.length > MAX_POINTS && (
          <span className="ml-auto text-[10px] text-muted-foreground bg-muted/50 border border-border rounded px-1.5 py-0.5">
            Πρώτες {MAX_POINTS.toLocaleString()} γραμμές
          </span>
        )}
      </div>

      {/* ── Axis config ── */}
      <div className="px-4 py-3 border-b border-border/60 bg-muted/10">

        {/* Line / Bar / Area */}
        {isXY && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-[160px_1fr]">

            {/* X axis */}
            <ConfigCard label="X άξονας">
              <FieldSelect value={xCol} onChange={setXCol}>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </FieldSelect>

              {/* Grouping controls — only when X is numeric */}
              {xIsNumeric && (
                <div className="pt-1 space-y-1.5">
                  <button
                    onClick={() => setGrouping((v) => !v)}
                    className={[
                      "flex items-center gap-1.5 text-[10px] font-medium transition-colors w-full",
                      grouping
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    <Layers2 className="h-3 w-3 shrink-0" />
                    {grouping ? "Ομαδοποίηση ενεργή" : "Ομαδοποίηση ανενεργή"}
                    {shouldGroup && binnedData && (
                      <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                        {binnedData.length} bins · avg
                      </span>
                    )}
                    {grouping && !shouldGroup && (
                      <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                        &lt;{GROUPING_THRESHOLD + 1} γρ.
                      </span>
                    )}
                  </button>

                  {grouping && (
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={10}
                        max={200}
                        step={5}
                        value={numBins}
                        onChange={(e) => setNumBins(Number(e.target.value))}
                        className="flex-1 h-1 accent-primary cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                        {numBins}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </ConfigCard>

            {/* Y series */}
            <ConfigCard label={
              yIsCategorical
                ? `Y ομαδοποίηση · Count mode (${pivotSeries.length} κατηγορίες)`
                : `Y άξονας — L αριστερά · R δεξιά (${ySeries.length} series)`
            }>

              {/* Active pills */}
              <div className="flex flex-wrap gap-1.5 min-h-[26px]">
                {ySeries.length === 0
                  ? <span className="text-[10px] text-muted-foreground italic self-center">Κανένα Y column επιλεγμένο</span>
                  : ySeries.map((s) => (
                      <YPill
                        key={s.col}
                        series={s}
                        onToggleSide={() => toggleSide(s.col)}
                        onRemove={() => removeY(s.col)}
                      />
                    ))}
              </div>

              {/* Add Y row */}
              {availableToAdd.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1">
                  <select
                    value={addYCol}
                    onChange={(e) => setAddYCol(e.target.value)}
                    className="flex-1 min-w-0 bg-background border border-border rounded-md px-2 py-1.5 text-[11px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    <option value="">— προσθήκη column —</option>
                    {availableToAdd.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button
                    onClick={addY}
                    disabled={!addYCol}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 text-primary text-[11px] font-medium hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    <Plus className="h-3 w-3" />
                    Προσθήκη
                  </button>
                </div>
              )}
            </ConfigCard>
          </div>
        )}

        {/* Scatter config */}
        {isScatter && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <ConfigCard label="X (αριθμητικό)">
              <FieldSelect value={xCol} onChange={setXCol}>
                {numericCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </FieldSelect>
            </ConfigCard>
            <ConfigCard label="Y (αριθμητικό)">
              <FieldSelect
                value={ySeries[0]?.col ?? ""}
                onChange={(v) =>
                  setYSeries(v ? [{ col: v, side: "left", color: PALETTE[0] }] : [])
                }
              >
                <option value="">— επιλογή —</option>
                {numericCols.filter((c) => c !== xCol).map((c) => <option key={c} value={c}>{c}</option>)}
              </FieldSelect>
            </ConfigCard>
          </div>
        )}

        {/* Pie config */}
        {isPie && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <ConfigCard label="Label column">
              <FieldSelect value={pieLabel} onChange={setPieLabel}>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </FieldSelect>
            </ConfigCard>
            <ConfigCard label="Value column (αριθμητικό)">
              <FieldSelect value={pieValue} onChange={setPieValue}>
                <option value="">— επιλογή —</option>
                {numericCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </FieldSelect>
            </ConfigCard>
          </div>
        )}
      </div>

      {/* ── Chart canvas ── */}
      <div className="px-2 py-3">
        {chart}
      </div>
    </div>
  );
}
