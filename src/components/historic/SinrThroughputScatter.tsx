import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { CartesianGrid, Label, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

import type { SinrThroughputData, SinrThroughputSeries } from "@/lib/api";
import { AXIS_STYLE, GRID_STYLE } from "@/lib/chartStyles";
import { CARD_SURFACE, OPERATORS, OperatorSwatch, Panel, fmtCount, fmtNum } from "./historicShared";

/**
 * Τα δύο scatter της σελίδας DATA-BANDWIDTH του .pbix (14.4 SINR → DL throughput, 14.6 SINR →
 * UL throughput, series = operator) από το BI_Capacity — βλ. SinrThroughputData στο api.ts.
 * Για την τρέχουσα βάση (π.χ. DOD_26H2) το ίδιο scatter βγαίνει από τα templates
 * "Capacity — SINR vs DL/UL throughput" του Queries tab.
 *
 * Πάνω από το σύννεφο μπαίνει η μέση throughput ανά dB SINR κάθε operator (γραμμή με halo
 * στο χρώμα της κάρτας ώστε να διαβάζεται πάνω από τα σημεία), και κάτω ένας πίνακας με
 * tests / μέσους όρους / Pearson r — η table view του chart.
 */

interface Point {
  x: number;
  y: number;
  operator: string;
  n?: number;
}

const Dot = (props: { cx?: number; cy?: number; fill?: string }) =>
  props.cx == null || props.cy == null ? null : <circle cx={props.cx} cy={props.cy} r={2.5} fill={props.fill} fillOpacity={0.35} />;

const NoShape = () => null;

const ScatterTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const op = OPERATORS.find((o) => o.key === p.operator);
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
        {op && <OperatorSwatch color={op.color} />}
        {op?.label ?? p.operator}
      </p>
      <p className="font-mono text-foreground">SINR: {fmtNum(p.x, 0)} dB</p>
      <p className="font-mono text-foreground">
        {p.n != null ? "Mean throughput" : "Throughput"}: {fmtNum(p.y, 1)} Mbps
      </p>
      {p.n != null && <p className="text-muted-foreground">{fmtCount(p.n)} tests in this dB</p>}
    </div>
  );
};

export const SinrThroughputChart = ({ series, height = 300 }: { series: SinrThroughputSeries[]; height?: number }) => {
  const operators = OPERATORS.filter((op) => series.some((s) => s.operator === op.key));
  const byOperator = new Map(series.map((s) => [s.operator, s]));

  if (operators.length === 0) {
    return <p className="py-16 text-center text-xs text-muted-foreground">No successful capacity tests with SINR for this selection.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {operators.map((op) => (
          <span key={op.key} className="flex items-center gap-1.5 text-foreground">
            <OperatorSwatch color={op.color} />
            {op.label}
          </span>
        ))}
        <span>· dots = one test · line = mean per dB SINR</span>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 22 }}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="x" type="number" domain={["dataMin - 1", "dataMax + 1"]} allowDecimals={false} {...AXIS_STYLE}>
            <Label value="SINR (dB)" offset={-12} position="insideBottom" fontSize={10} fill="hsl(var(--muted-foreground))" />
          </XAxis>
          <YAxis
            dataKey="y"
            type="number"
            domain={[0, "auto"]}
            {...AXIS_STYLE}
            width={56}
            label={{ value: "Throughput (Mbps)", angle: -90, position: "insideLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))", dx: 6, dy: 40 }}
          />
          <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3" }} isAnimationActive={false} />

          {operators.map((op) => (
            <Scatter
              key={`pts-${op.key}`}
              name={op.label}
              data={byOperator.get(op.key)!.points.map(([x, y]) => ({ x, y, operator: op.key }))}
              fill={op.color}
              shape={<Dot />}
              isAnimationActive={false}
            />
          ))}
          {/* Halo στο χρώμα της κάρτας κάτω από κάθε γραμμή μέσου όρου — ξεχωρίζει από τα σημεία. */}
          {operators.map((op) => (
            <Scatter
              key={`halo-${op.key}`}
              data={byOperator.get(op.key)!.bins.map(([x, y, n]) => ({ x, y, n, operator: op.key }))}
              line={{ stroke: CARD_SURFACE, strokeWidth: 5 }}
              shape={<NoShape />}
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          ))}
          {operators.map((op) => (
            <Scatter
              key={`mean-${op.key}`}
              name={`${op.label} mean`}
              data={byOperator.get(op.key)!.bins.map(([x, y, n]) => ({ x, y, n, operator: op.key }))}
              line={{ stroke: op.color, strokeWidth: 2 }}
              fill={op.color}
              shape={<NoShape />}
              legendType="none"
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-1.5 text-left font-semibold">Operator</th>
            <th className="py-1.5 text-right font-semibold">Tests</th>
            <th className="py-1.5 text-right font-semibold">Avg SINR (dB)</th>
            <th className="py-1.5 text-right font-semibold">Avg Thrp (Mbps)</th>
            <th className="py-1.5 text-right font-semibold" title="Pearson correlation SINR ↔ throughput">r</th>
          </tr>
        </thead>
        <tbody>
          {operators.map((op) => {
            const s = byOperator.get(op.key)!;
            return (
              <tr key={op.key} className="border-b border-border/60 last:border-b-0">
                <td className="py-1.5">
                  <span className="flex items-center gap-1.5 font-semibold text-foreground">
                    <OperatorSwatch color={op.color} />
                    {op.label}
                  </span>
                </td>
                <td className="py-1.5 text-right font-mono text-foreground">{fmtCount(s.n)}</td>
                <td className="py-1.5 text-right font-mono text-foreground">{fmtNum(s.avgSinr, 1)}</td>
                <td className="py-1.5 text-right font-mono text-foreground">{fmtNum(s.avgMbps, 1)}</td>
                <td className="py-1.5 text-right font-mono text-foreground">{fmtNum(s.r, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/** DL και UL δίπλα-δίπλα, μία Panel το καθένα. */
export const SinrThroughputGrid = ({ data, source }: { data: SinrThroughputData; source: string }) => (
  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
    <Panel title="SINR vs DL throughput" subtitle={`Capacity DL, successful tests · ${source}`} icon={ArrowDownToLine}>
      <SinrThroughputChart series={data.dl} />
    </Panel>
    <Panel title="SINR vs UL throughput" subtitle={`Capacity UL, successful tests · ${source}`} icon={ArrowUpFromLine}>
      <SinrThroughputChart series={data.ul} />
    </Panel>
  </div>
);
