import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  fetchHistoricComparison,
  fetchHistoricGradesAll,
  type HistoricComparisonKind,
  type HistoricComparisonPoint,
  type HistoricGradeKey,
  type HistoricPageFilters,
} from "@/lib/api";
import { AXIS_STYLE, DEFAULTS, GRID_STYLE, LEGEND_WRAPPER_STYLE } from "@/lib/chartStyles";
import { DEFAULT_SLIDERS, aggregate, serviceWeights, type OperatorGrade } from "./gradesModel";
import { LoadState, OPERATORS, Segmented, fmtNum, fmtPct, operatorSpec, useHistoricLoad } from "./historicShared";

/**
 * Οι σελίδες «Comparison» του .pbix — χρονοσειρές με X = Scope (ή μήνας στις «Monthly …»),
 * μία γραμμή ανά operator:
 *   [24]/[25] Voice GSM, [26]/[27]/[28]/[29] Voice Free (+MOS, +CST), [30]/[31]/[32] Data,
 *   [33]–[36] Voice / Data GRADES και GRADES Difference (COSMOTE − ανταγωνιστής).
 * Τα GRADES υπολογίζονται με τα default sliders (ίδια αριθμητική με τη σελίδα Grades, βλ.
 * gradesModel.ts). Backend: backend/routers/historic_comparison.py.
 */

interface LineMetric {
  key: string;
  label: string;
  format: (v: number) => string;
  /** μόνο ανά Scope (οι «Monthly» σελίδες δεν το έχουν). */
  scopeOnly?: boolean;
}

const pct = (v: number) => fmtPct(v, 2);
const sec = (v: number) => `${fmtNum(v, 2)} s`;
const mbps = (v: number) => `${fmtNum(v, 0)} Mbps`;
const ms = (v: number) => `${fmtNum(v, 0)} ms`;
const num2 = (v: number) => fmtNum(v, 2);

const VOICE_GSM: LineMetric[] = [
  { key: "successRate", label: "Success rate (%)", format: pct },
  { key: "dcr", label: "Dropped call rate (%)", format: pct, scopeOnly: true },
  { key: "afr", label: "Access failure rate (%)", format: pct, scopeOnly: true },
  { key: "mos", label: "Average MOS", format: num2 },
  { key: "cst", label: "Average call setup time (s)", format: sec },
];

const VOICE_FREE: LineMetric[] = [
  { key: "successRate", label: "Success rate (%)", format: pct },
  { key: "dcr", label: "Dropped call rate (%)", format: pct, scopeOnly: true },
  { key: "afr", label: "Access failure rate (%)", format: pct, scopeOnly: true },
  { key: "mos", label: "Average MOS", format: num2 },
  { key: "p10Mos", label: "P'10 MOS", format: num2, scopeOnly: true },
  { key: "cst", label: "Average call setup time (s)", format: sec },
  { key: "p90Cst", label: "P'90 call setup time (s)", format: sec, scopeOnly: true },
  { key: "cst11000", label: "Average CST — KPI 11000 (s)", format: sec, scopeOnly: true },
  { key: "p90Cst11000", label: "P'90 CST — KPI 11000 (s)", format: sec, scopeOnly: true },
];

const DATA: LineMetric[] = [
  { key: "capDl", label: "Capacity DL throughput (Mbps)", format: mbps },
  { key: "capUl", label: "Capacity UL throughput (Mbps)", format: mbps },
  { key: "ooklaDl", label: "Ookla DL throughput (Mbps)", format: mbps, scopeOnly: true },
  { key: "ooklaUl", label: "Ookla UL throughput (Mbps)", format: mbps, scopeOnly: true },
  { key: "pingRtt", label: "Ping RTT, weighted (ms)", format: ms },
  { key: "vmos", label: "YouTube VMOS", format: num2, scopeOnly: true },
  { key: "browsingSuccess", label: "Browsing success rate (%)", format: pct, scopeOnly: true },
  { key: "browsingDuration", label: "Browsing transfer duration (s)", format: sec },
  { key: "httpDlDuration", label: "HTTP DL transfer duration (s)", format: sec },
  { key: "httpUlDuration", label: "HTTP UL transfer duration (s)", format: sec },
  { key: "httpUlP10", label: "HTTP UL P'10 throughput (Mbps)", format: (v) => `${fmtNum(v, 1)} Mbps`, scopeOnly: true },
  { key: "n78Usage", label: "5G N78 usage (% of NR time)", format: (v) => fmtPct(v, 1), scopeOnly: true },
];

type Axis = "scope" | "month";

/** Μία γραμμή ανά operator πάνω σε X = Scope / μήνα. */
const ComparisonLine = ({
  title,
  points,
  format,
}: {
  title: string;
  points: { key: string; values: Record<string, number | null> }[];
  format: (v: number) => string;
}) => {
  const operators = OPERATORS.filter((o) => points.some((p) => p.values[o.key] != null));
  const data = points.map((p) => ({ key: p.key, ...p.values }));
  if (operators.length === 0) return null;

  const LineTooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; color: string; value: number | null }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-mono font-semibold text-foreground">{label}</p>
        {payload.map((e) => (
          <p key={e.dataKey} className="flex items-center gap-1.5 font-mono text-foreground/90">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
            {operatorSpec(e.dataKey)?.label ?? e.dataKey}: {e.value == null ? "—" : format(e.value)}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h3 className="mb-1 text-sm font-bold text-foreground">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis dataKey="key" {...AXIS_STYLE} minTickGap={12} />
          <YAxis {...AXIS_STYLE} width={60} tickFormatter={(v: number) => format(v)} domain={["auto", "auto"]} />
          <Tooltip content={<LineTooltip />} />
          <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} formatter={(v: string) => <span className="text-foreground">{v}</span>} />
          {operators.map((o) => (
            <Line
              key={o.key}
              type="linear"
              dataKey={o.key}
              name={o.label}
              stroke={o.color}
              strokeWidth={DEFAULTS.strokeWidth}
              dot={data.length <= 24 ? { r: 3, strokeWidth: 0, fill: o.color } : false}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const toLinePoints = (points: HistoricComparisonPoint[], metric: string) =>
  points.map((p) => ({
    key: p.key,
    values: Object.fromEntries(p.operators.map((o) => [o.operator, (o[metric] as number | null) ?? null])),
  }));

/* ────────────────────────── [24]–[32] Voice / Data ────────────────────────── */

export const HistoricComparison = ({ group, filters }: { group: "voice" | "data"; filters: HistoricPageFilters }) => {
  const [voiceKind, setVoiceKind] = useState<HistoricComparisonKind>("voice_free");
  const [axis, setAxis] = useState<Axis>("scope");
  const kind: HistoricComparisonKind = group === "data" ? "data" : voiceKind;
  const { data, loading, error } = useHistoricLoad(`comparison|${kind}|${JSON.stringify({ ...filters, scope: "" })}`, () => fetchHistoricComparison(kind, filters));

  const metrics = (kind === "voice_gsm" ? VOICE_GSM : kind === "voice_free" ? VOICE_FREE : DATA).filter((m) => axis === "scope" || !m.scopeOnly);
  const points = axis === "scope" ? data?.scopes ?? [] : data?.months ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        {group === "voice" && (
          <Segmented<HistoricComparisonKind>
            label="Service"
            value={voiceKind}
            onChange={setVoiceKind}
            options={[
              { value: "voice_free" as const, label: "Voice Free (M→M)" },
              { value: "voice_gsm" as const, label: "Voice GSM (M→F)" },
            ]}
          />
        )}
        <Segmented<Axis>
          label="X axis"
          value={axis}
          onChange={setAxis}
          options={[
            { value: "scope" as const, label: "By scope" },
            { value: "month" as const, label: "By month" },
          ]}
        />
        <p className="ml-auto text-[11px] text-muted-foreground">
          {axis === "scope" ? "Pooled over all matching collections per semi-annual campaign" : "Month of each collection's first capacity test"}
        </p>
      </div>
      <LoadState loading={loading} error={error} hasData={points.length > 0}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {metrics.map((m) => (
            <ComparisonLine key={m.key} title={m.label} points={toLinePoints(points, m.key)} format={m.format} />
          ))}
        </div>
      </LoadState>
    </>
  );
};

/* ────────────────────────── [33]–[36] GRADES ────────────────────────── */

interface GradeMetric {
  label: string;
  value: (g: OperatorGrade) => number;
}

const service = (key: HistoricGradeKey) => (g: OperatorGrade) => g.services[key];

const VOICE_GRADES: GradeMetric[] = [
  { label: "Voice score", value: (g) => g.voice },
  { label: "Voice GSM (M→F) grade", value: service("gsm") },
  { label: "Voice Free (M→M) grade", value: service("free") },
];

const DATA_GRADES: GradeMetric[] = [
  { label: "Data score", value: (g) => g.data },
  { label: "Capacity grade", value: service("cap") },
  { label: "HTTP grade", value: service("http") },
  { label: "Browsing grade", value: service("browsing") },
  { label: "YouTube grade", value: service("yt") },
  { label: "Ping grade", value: service("ping") },
];

/** COSMOTE − ανταγωνιστής ανά Scope (Diff … Grade Voda / NOVA) — clustered columns. */
const DifferenceChart = ({ title, rows }: { title: string; rows: { key: string; vsVODAFONE: number | null; vsNOVA: number | null }[] }) => {
  const DiffTooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; color: string; value: number | null; name: string }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-mono font-semibold text-foreground">{label}</p>
        {payload.map((e) => (
          <p key={e.dataKey} className="flex items-center gap-1.5 font-mono text-foreground/90">
            <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: e.color }} />
            {e.name}: {e.value == null ? "—" : `${e.value > 0 ? "+" : ""}${fmtNum(e.value, 1)}`}
          </p>
        ))}
      </div>
    );
  };
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h3 className="mb-1 text-sm font-bold text-foreground">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis dataKey="key" {...AXIS_STYLE} />
          <YAxis {...AXIS_STYLE} width={44} />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
          <Tooltip content={<DiffTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
          <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} formatter={(v: string) => <span className="text-foreground">{v}</span>} />
          <Bar dataKey="vsVODAFONE" name="COSMOTE − VODAFONE" fill={operatorSpec("VODAFONE")!.color} radius={3} maxBarSize={16} isAnimationActive={false} />
          <Bar dataKey="vsNOVA" name="COSMOTE − NOVA" fill={operatorSpec("NOVA")!.color} radius={3} maxBarSize={16} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const HistoricComparisonGrades = ({ filters }: { filters: HistoricPageFilters }) => {
  const [group, setGroup] = useState<"voice" | "data">("voice");
  const [view, setView] = useState<"score" | "diff">("score");
  const { data, loading, error } = useHistoricLoad(`grades_all|${JSON.stringify({ ...filters, scope: "" })}`, () => fetchHistoricGradesAll(filters));

  /** Scope -> operator -> OperatorGrade, στα default sliders. */
  const byScope = useMemo(() => {
    const weights = serviceWeights(DEFAULT_SLIDERS);
    const scopes = Array.from(new Set((data ?? []).map((r) => r.scope))).sort();
    return scopes.map((scope) => ({
      key: scope,
      grades: Object.fromEntries(
        OPERATORS.map((o) => [o.key, aggregate((data ?? []).filter((r) => r.scope === scope && r.operator === o.key), weights)]),
      ) as Record<string, OperatorGrade | null>,
    }));
  }, [data]);

  const metrics = group === "voice" ? VOICE_GRADES : DATA_GRADES;

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <Segmented<"voice" | "data">
          label="Grades"
          value={group}
          onChange={setGroup}
          options={[
            { value: "voice" as const, label: "Voice" },
            { value: "data" as const, label: "Data" },
          ]}
        />
        <Segmented<"score" | "diff">
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "score" as const, label: "Scores" },
            { value: "diff" as const, label: "COSMOTE lead" },
          ]}
        />
        <p className="ml-auto text-[11px] text-muted-foreground">Default weights (Voice 40 / Data 60) · weighted by area category</p>
      </div>
      <LoadState loading={loading} error={error} hasData={byScope.length > 0}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {metrics.map((m) =>
            view === "score" ? (
              <ComparisonLine
                key={m.label}
                title={m.label}
                format={(v) => fmtNum(v, 1)}
                points={byScope.map((s) => ({
                  key: s.key,
                  values: Object.fromEntries(OPERATORS.map((o) => [o.key, s.grades[o.key] ? m.value(s.grades[o.key]!) : null])),
                }))}
              />
            ) : (
              <DifferenceChart
                key={m.label}
                title={`${m.label} — COSMOTE lead`}
                rows={byScope.map((s) => {
                  const c = s.grades.COSMOTE;
                  const diff = (op: string) => (c && s.grades[op] ? m.value(c) - m.value(s.grades[op]!) : null);
                  return { key: s.key, vsVODAFONE: diff("VODAFONE"), vsNOVA: diff("NOVA") };
                })}
              />
            ),
          )}
        </div>
      </LoadState>
    </>
  );
};
