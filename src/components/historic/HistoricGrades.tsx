import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Gauge, RotateCcw, SlidersHorizontal, Trophy } from "lucide-react";

import { Slider } from "@/components/ui/slider";
import { fetchHistoricGrades, type HistoricGradeKey, type HistoricGradeRow, type HistoricPageFilters } from "@/lib/api";
import { AXIS_STYLE, GRID_STYLE, LEGEND_WRAPPER_STYLE } from "@/lib/chartStyles";
import { LoadState, OPERATORS, OperatorSwatch, Panel, fmtNum, operatorSpec, useHistoricLoad } from "./historicShared";

/**
 * [02] GRADES του .pbix. Τα 8 sliders (Voice_scores_total, Voice_Scores GSM / FREE, HTTP,
 * Capacity, Browsing, YouTube, Ping — GENERATESERIES(0, 100, 1)) ξαναζυγίζουν τα SUB_SCORE_*
 * του BI_SCORES_TOTAL. Αριθμητική ίδια με το DAX (βλ. get_historic_grades στο backend):
 *
 *   CF Voice = 10 × VoiceWeight / (GSM × 150 + FREE × 250)
 *   CF Data  = 10 × (100 − VoiceWeight) / (HTTP × 100 + CAP × 275 + Browsing × 100 + YT × 100 + Ping × 25)
 *   weight_X = base_X × slider_X × CF(group)            (μέγιστοι πόντοι της υπηρεσίας)
 *   Grade X  = SUB_SCORE_X × weight_X
 *   Visuals Total Score = Σ WEIGHT × Σ_X Grade X / Σ WEIGHT   (WEIGHT = βάρος κατηγορίας περιοχής)
 *
 * Στα defaults (Voice 40, όλα τα άλλα 50) το αποτέλεσμα == TOTAL_SCORE του warehouse.
 */

interface ServiceSpec {
  key: HistoricGradeKey;
  label: string;
  base: number;
  group: "voice" | "data";
}

const SERVICES: ServiceSpec[] = [
  { key: "gsm", label: "Voice GSM (M→F)", base: 150, group: "voice" },
  { key: "free", label: "Voice Free (M→M)", base: 250, group: "voice" },
  { key: "http", label: "HTTP", base: 100, group: "data" },
  { key: "cap", label: "Capacity", base: 275, group: "data" },
  { key: "browsing", label: "Browsing", base: 100, group: "data" },
  { key: "yt", label: "YouTube", base: 100, group: "data" },
  { key: "ping", label: "Ping", base: 25, group: "data" },
];

type Sliders = { voice: number } & Record<HistoricGradeKey, number>;

const DEFAULT_SLIDERS: Sliders = { voice: 40, gsm: 50, free: 50, http: 50, cap: 50, browsing: 50, yt: 50, ping: 50 };

/** Μέγιστοι πόντοι ανά υπηρεσία για τα τρέχοντα sliders (Σ = 1000). */
function serviceWeights(s: Sliders): Record<HistoricGradeKey, number> {
  const groupSum = (group: "voice" | "data") =>
    SERVICES.filter((x) => x.group === group).reduce((sum, x) => sum + x.base * s[x.key], 0);
  const cfVoice = groupSum("voice") ? (10 * s.voice) / groupSum("voice") : 0;
  const cfData = groupSum("data") ? (10 * (100 - s.voice)) / groupSum("data") : 0;
  const out = {} as Record<HistoricGradeKey, number>;
  SERVICES.forEach((x) => {
    out[x.key] = x.base * s[x.key] * (x.group === "voice" ? cfVoice : cfData);
  });
  return out;
}

interface OperatorGrade {
  operator: string;
  total: number;
  voice: number;
  data: number;
  services: Record<HistoricGradeKey, number>;
}

/** Grade X ανά γραμμή (BLANK SUB_SCORE -> 0, όπως το SUMX του DAX) σταθμισμένο με WEIGHT. */
function aggregate(rows: HistoricGradeRow[], weights: Record<HistoricGradeKey, number>): OperatorGrade | null {
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  if (!rows.length || !totalWeight) return null;
  const services = {} as Record<HistoricGradeKey, number>;
  SERVICES.forEach((x) => {
    services[x.key] = rows.reduce((s, r) => s + r.weight * (r.sub[x.key] ?? 0) * weights[x.key], 0) / totalWeight;
  });
  const voice = services.gsm + services.free;
  const data = services.http + services.cap + services.browsing + services.yt + services.ping;
  return { operator: rows[0].operator, total: voice + data, voice, data, services };
}

const shortName = (row: HistoricGradeRow) => `${row.name.split("_")[0]} · ${row.collection}`;

const WeightSlider = ({
  label,
  value,
  onChange,
  points,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  points: string;
}) => (
  <div>
    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
      <span className="font-medium text-foreground">{label}</span>
      <span className="font-mono tabular-nums text-muted-foreground">
        <b className="text-foreground">{value}</b> · {points}
      </span>
    </div>
    <Slider value={[value]} min={0} max={100} step={1} onValueChange={([v]) => onChange(v)} aria-label={label} />
  </div>
);

const OperatorScoreCard = ({ grade, isWinner }: { grade: OperatorGrade; isWinner: boolean }) => {
  const op = operatorSpec(grade.operator)!;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <OperatorSwatch color={op.color} />
        <span className="text-sm font-bold tracking-wide text-foreground">{op.label}</span>
        {isWinner && (
          <span className="ml-auto flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
            <Trophy className="h-3 w-3" /> Best
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-4xl font-extrabold tabular-nums text-foreground">{fmtNum(grade.total, 0)}</span>
        <span className="text-xs text-muted-foreground">/ 1000</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-muted/50">
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, grade.total / 10)}%`, backgroundColor: op.color }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Voice</div>
          <div className="font-mono text-base font-bold tabular-nums text-foreground">{fmtNum(grade.voice, 0)}</div>
        </div>
        <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Data</div>
          <div className="font-mono text-base font-bold tabular-nums text-foreground">{fmtNum(grade.data, 0)}</div>
        </div>
      </div>
      <dl className="mt-3 space-y-1 text-xs">
        {SERVICES.map((x) => (
          <div key={x.key} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{x.label}</dt>
            <dd className="font-mono tabular-nums text-foreground">{fmtNum(grade.services[x.key], 1)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

const HistoricGrades = ({ filters }: { filters: HistoricPageFilters }) => {
  const key = JSON.stringify(filters);
  const { data, loading, error } = useHistoricLoad(key, () => fetchHistoricGrades(filters));
  const [sliders, setSliders] = useState<Sliders>(DEFAULT_SLIDERS);
  const set = (k: keyof Sliders) => (v: number) => setSliders((s) => ({ ...s, [k]: v }));

  const rows = useMemo(() => data ?? [], [data]);
  const weights = useMemo(() => serviceWeights(sliders), [sliders]);

  const grades = useMemo(
    () =>
      OPERATORS.map((op) => aggregate(rows.filter((r) => r.operator === op.key), weights)).filter(
        (g): g is OperatorGrade => g != null,
      ),
    [rows, weights],
  );
  const bestTotal = grades.length > 1 ? Math.max(...grades.map((g) => g.total)) : null;

  /** 02.5 (Visuals Total Score ανά collection × operator) + 02.11 (Diff from Vodafone / Wind). */
  const byCollection = useMemo(() => {
    const names = Array.from(new Set(rows.map((r) => r.name))).sort();
    return names.map((name) => {
      const out: Record<string, string | number | null> = { name, label: shortName(rows.find((r) => r.name === name)!) };
      OPERATORS.forEach((op) => {
        const g = aggregate(rows.filter((r) => r.name === name && r.operator === op.key), weights);
        out[op.key] = g ? g.total : null;
      });
      const cosmote = out.COSMOTE as number | null;
      out.vsVODAFONE = cosmote != null && out.VODAFONE != null ? cosmote - (out.VODAFONE as number) : null;
      out.vsNOVA = cosmote != null && out.NOVA != null ? cosmote - (out.NOVA as number) : null;
      return out;
    });
  }, [rows, weights]);

  const isDefault = (Object.keys(DEFAULT_SLIDERS) as (keyof Sliders)[]).every((k) => sliders[k] === DEFAULT_SLIDERS[k]);
  const chartHeight = 60 + byCollection.length * 34;

  const ScoreTooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; color: string; value: number | null; name: string }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-semibold text-foreground">{label}</p>
        {payload.map((e) => (
          <p key={e.dataKey} className="flex items-center gap-1.5 font-mono text-foreground/90">
            <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: e.color }} />
            {e.name}: {e.value == null ? "—" : `${e.value > 0 && e.dataKey.startsWith("vs") ? "+" : ""}${fmtNum(e.value, 1)}`}
          </p>
        ))}
      </div>
    );
  };

  return (
    <LoadState loading={loading} error={error} hasData={rows.length > 0}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
        <Panel
          title="Weights"
          subtitle="Same 8 sliders as the report — max points per service shown"
          icon={SlidersHorizontal}
          right={
            <button
              type="button"
              onClick={() => setSliders(DEFAULT_SLIDERS)}
              disabled={isDefault}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          }
        >
          <div className="space-y-4">
            <WeightSlider
              label="Voice / Data split"
              value={sliders.voice}
              onChange={set("voice")}
              points={`${sliders.voice * 10} / ${(100 - sliders.voice) * 10} pts`}
            />
            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Voice</p>
              {SERVICES.filter((x) => x.group === "voice").map((x) => (
                <WeightSlider key={x.key} label={x.label} value={sliders[x.key]} onChange={set(x.key)} points={`${fmtNum(weights[x.key], 0)} pts`} />
              ))}
            </div>
            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Data</p>
              {SERVICES.filter((x) => x.group === "data").map((x) => (
                <WeightSlider key={x.key} label={x.label} value={sliders[x.key]} onChange={set(x.key)} points={`${fmtNum(weights[x.key], 0)} pts`} />
              ))}
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Total score"
            subtitle={`Weighted by area category over ${byCollection.length} collection(s)${isDefault ? " · default weights = warehouse TOTAL_SCORE" : " · custom weights"}`}
            icon={Gauge}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {grades.map((g) => (
                <OperatorScoreCard key={g.operator} grade={g} isWinner={bestTotal != null && g.total === bestTotal} />
              ))}
            </div>
          </Panel>

          <Panel title="Total score by collection" subtitle="Hover a row for exact scores" icon={BarChart3}>
            <div className="max-h-[560px] overflow-y-auto">
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={byCollection} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barCategoryGap="18%" barGap={2}>
                  <CartesianGrid {...GRID_STYLE} horizontal={false} />
                  <XAxis type="number" domain={[0, 1000]} {...AXIS_STYLE} />
                  <YAxis type="category" dataKey="label" width={250} interval={0} {...AXIS_STYLE} />
                  <Tooltip content={<ScoreTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                  <Legend verticalAlign="top" wrapperStyle={LEGEND_WRAPPER_STYLE} formatter={(value: string) => <span className="text-foreground">{value}</span>} />
                  {OPERATORS.map((op) => (
                    <Bar key={op.key} dataKey={op.key} name={op.label} fill={op.color} radius={[0, 4, 4, 0]} maxBarSize={9} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="COSMOTE lead by collection" subtitle="COSMOTE total score minus each competitor (positive = COSMOTE ahead)" icon={BarChart3}>
            <div className="max-h-[560px] overflow-y-auto">
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={byCollection} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barCategoryGap="22%" barGap={2}>
                  <CartesianGrid {...GRID_STYLE} horizontal={false} />
                  <XAxis type="number" {...AXIS_STYLE} />
                  <YAxis type="category" dataKey="label" width={250} interval={0} {...AXIS_STYLE} />
                  <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip content={<ScoreTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                  <Legend verticalAlign="top" wrapperStyle={LEGEND_WRAPPER_STYLE} formatter={(value: string) => <span className="text-foreground">{value}</span>} />
                  <Bar dataKey="vsVODAFONE" name="vs VODAFONE" fill={operatorSpec("VODAFONE")!.color} radius={4} maxBarSize={10} isAnimationActive={false} />
                  <Bar dataKey="vsNOVA" name="vs NOVA" fill={operatorSpec("NOVA")!.color} radius={4} maxBarSize={10} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      </div>
    </LoadState>
  );
};

export default HistoricGrades;
