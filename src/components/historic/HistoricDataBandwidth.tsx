import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge, Layers } from "lucide-react";

import { fetchHistoricBandwidthMix, fetchHistoricDataBandwidth, type HistoricMixRow, type HistoricPageFilters } from "@/lib/api";
import { AXIS_STYLE, DEFAULTS, GRID_STYLE, LEGEND_WRAPPER_STYLE } from "@/lib/chartStyles";
import { LoadState, OPERATORS, Panel, StackedMixChart, fmtCount, fmtNum, useHistoricLoad } from "./historicShared";
import { SinrThroughputGrid } from "./SinrThroughputScatter";

/**
 * [14] DATA-BANDWIDTH του .pbix — 14.1–14.3 κατανομή του συνολικού LTE bandwidth (TotalBwN) ανά
 * operator (πίτες στο report, εδώ 100% stacked μπάρα — μία ανά operator), 14.5 Avg(TotalThp) ανά
 * bandwidth × operator, και τα δύο scatter (14.4 SINR → DL, 14.6 SINR → UL) από το BI_Capacity.
 * Βλ. get_historic_bandwidth_mix (historic_data_pages.py) και get_historic_data_bandwidth.
 */
/** Το TotalBwN είναι μέγεθος (MHz), όχι κατηγορία: 7 διαδοχικές ζώνες σε μονόχρωμη μπλε κλίμακα
 * (steps 100→600 του dataviz skill — στο σκούρο --card καμία δεν σβήνει στην επιφάνεια). */
const BW_BANDS: { label: string; max: number }[] = [
  { label: "≤ 10 MHz", max: 10 },
  { label: "15–20 MHz", max: 20 },
  { label: "25–30 MHz", max: 30 },
  { label: "35–40 MHz", max: 40 },
  { label: "45–50 MHz", max: 50 },
  { label: "55–60 MHz", max: 60 },
  { label: "≥ 65 MHz", max: Infinity },
];
const BW_COLORS = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#1c5cab", "#184f95"];
const bwBand = (mhz: number) => BW_BANDS.find((b) => mhz <= b.max)!.label;

const HistoricDataBandwidth = ({ filters }: { filters: HistoricPageFilters }) => {
  const key = JSON.stringify(filters);
  const { data, loading, error } = useHistoricLoad(key, () => fetchHistoricDataBandwidth(filters));
  const { data: bw } = useHistoricLoad(`bw|${key}`, () => fetchHistoricBandwidthMix(filters));
  const hasData = !!data && (data.dl.length > 0 || data.ul.length > 0);

  const bwRows = useMemo(() => bw?.rows ?? [], [bw]);
  const bwKeys = useMemo(() => Array.from(new Set(bwRows.map((r) => r.bwMhz))).sort((a, b) => a - b), [bwRows]);
  const mixRows: HistoricMixRow[] = useMemo(
    () =>
      OPERATORS.filter((o) => bwRows.some((r) => r.operator === o.key)).map((o) => ({
        operator: o.key,
        parts: BW_BANDS.map((b) => ({
          key: b.label,
          value: bwRows.filter((r) => r.operator === o.key && bwBand(r.bwMhz) === b.label).reduce((sum, r) => sum + r.samples, 0),
          mos: null,
        })),
      })),
    [bwRows],
  );
  // Μόνο bandwidths με αρκετά samples για έναν σταθερό μέσο όρο ανά operator.
  const thpData = useMemo(
    () =>
      bwKeys
        .map((k) => {
          const row: Record<string, number | string | null> = { bw: `${k}` };
          let enough = false;
          OPERATORS.forEach((o) => {
            const r = bwRows.find((x) => x.operator === o.key && x.bwMhz === k);
            row[o.key] = r && r.samples >= 20 ? r.avgThpMbps : null;
            row[`${o.key}__n`] = r?.samples ?? 0;
            if (r && r.samples >= 20) enough = true;
          });
          return enough ? row : null;
        })
        .filter((r): r is Record<string, number | string | null> => r != null),
    [bwRows, bwKeys],
  );
  const operators = OPERATORS.filter((o) => bwRows.some((r) => r.operator === o.key));

  const ThpTooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; color: string; value: number | null; payload: Record<string, number> }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-semibold text-foreground">{label} MHz</p>
        {payload.map((e) => (
          <p key={e.dataKey} className="flex items-center gap-1.5 font-mono text-foreground/90">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: e.color }} />
            <span className="text-foreground">{e.dataKey}</span> {e.value == null ? "—" : `${fmtNum(e.value, 1)} Mbps`}
            <span className="text-muted-foreground">· {fmtCount(e.payload[`${e.dataKey}__n`])} samples</span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <LoadState loading={loading} error={error} hasData={hasData || bwRows.length > 0}>
      {bwRows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="LTE aggregated bandwidth" subtitle="Share of Capacity DL samples per total aggregated bandwidth (MHz)" icon={Layers}>
            <StackedMixChart rows={mixRows} keys={BW_BANDS.map((b) => b.label)} colors={BW_COLORS} />
          </Panel>
          <Panel title="LTE throughput per aggregated bandwidth" subtitle="Average LTE (all carriers) DL throughput per bandwidth (Mbps) — bandwidths with ≥ 20 samples" icon={Gauge}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={thpData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid {...GRID_STYLE} vertical={false} />
                <XAxis dataKey="bw" {...AXIS_STYLE} tickFormatter={(v: string) => `${v}`} />
                <YAxis {...AXIS_STYLE} width={44} />
                <Tooltip content={<ThpTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} formatter={(value: string) => <span className="text-foreground">{value}</span>} />
                {operators.map((o) => (
                  <Bar key={o.key} dataKey={o.key} name={o.label} fill={o.color} fillOpacity={DEFAULTS.barFillOpacity} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
      {data && hasData && <SinrThroughputGrid data={data} source="BI_Capacity" />}
    </LoadState>
  );
};

export default HistoricDataBandwidth;
