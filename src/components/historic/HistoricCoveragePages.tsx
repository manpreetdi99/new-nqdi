import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Antenna, Gauge, Layers, MapPin, Network, RadioTower, Signal } from "lucide-react";

import {
  fetchHistoricDataMap,
  fetchHistoricNrMap,
  fetchHistoricNrScannerMap,
  fetchHistoricNrTech,
  fetchHistoricScanner,
  type HistoricDataMap as HistoricDataMapData,
  type HistoricDirection,
  type HistoricMixRow,
  type HistoricPageFilters,
  type HistoricScannerChannel,
} from "@/lib/api";
import { AXIS_STYLE, GRID_STYLE, LEGEND_WRAPPER_STYLE } from "@/lib/chartStyles";
import {
  CARD_SURFACE,
  HistoricKpiTable,
  LoadState,
  MetricBarsGrid,
  OPERATORS,
  OperatorSwatch,
  Panel,
  Segmented,
  StackedMixChart,
  fmtCount,
  fmtNum,
  fmtPct,
  operatorSpec,
  qualityColors,
  useHistoricLoad,
  type Row,
} from "./historicShared";
import { HistoricPointsMap, type MapPoint } from "./HistoricPointsMap";

/**
 * Οι σελίδες χαρτών / 5G / scanner του .pbix — [13]+[23] DATA-MAP DL/UL, [15] DATA-MAP NR,
 * [16]+[17] NR DATA TECH (+ CA/BW), [18]+[19] NR SCANNER MAP 50 m / 500 m, [20] SCANNER 4G-5G.
 * Τα bins (throughput, RSRP, SS-RSRP, scanner κλάσεις) χρωματίζονται με το qualityColors (κόκκινο =
 * κακό … μπλε = καλό) και σε χάρτη ΚΑΙ σε stacked bars, ώστε το ίδιο bin να έχει παντού το ίδιο χρώμα.
 * Ορισμοί: backend/routers/historic_data_pages.py.
 */

const ALL = "ALL";
type OperatorFilter = typeof ALL | (typeof OPERATORS)[number]["key"];

const OperatorFilterToggle = ({ value, onChange, present }: { value: OperatorFilter; onChange: (v: OperatorFilter) => void; present: string[] }) => (
  <Segmented<OperatorFilter>
    label="Operator"
    value={value}
    onChange={onChange}
    options={[{ value: ALL as OperatorFilter, label: "All" }, ...OPERATORS.filter((o) => present.includes(o.key)).map((o) => ({ value: o.key as OperatorFilter, label: o.label }))]}
  />
);

/** Bin counts ανά operator -> HistoricMixRow για το StackedMixChart. */
const binRows = (rows: { operator: string; counts: number[] }[], bins: string[]): HistoricMixRow[] =>
  rows.map((r) => ({ operator: r.operator, parts: bins.map((b, i) => ({ key: b, value: r.counts[i] ?? 0, mos: null })) }));

const legendFor = (bins: string[], colors: string[], points: { bin: number }[]) =>
  bins.map((label, i) => ({ label, color: colors[i], count: points.filter((p) => p.bin === i).length }));

const sampleNote = (shown: number, total: number) =>
  total > shown ? `${fmtCount(shown)} of ${fmtCount(total)} points shown (even sample)` : `${fmtCount(total)} points`;

/* ────────────────────────── [13] / [23] DATA-MAP ────────────────────────── */

const TECH_KEYS = ["LTE-5GNR", "LTE CA", "LTE/LTE CA", "LTE", "UMTS", "GSM", "Mixed"];

const radioRows: Row<HistoricDataMapData["operators"][number]>[] = [
  { label: "Tests", higherIsBetter: null, value: (r) => r.tests, format: (r) => fmtCount(r.tests) },
  { label: "Avg throughput (Mbps)", emphasis: true, higherIsBetter: true, value: (r) => r.avgMbps, format: (r) => fmtNum(r.avgMbps, 1) },
  { label: "Max throughput (Mbps)", higherIsBetter: true, value: (r) => r.maxMbps, format: (r) => fmtNum(r.maxMbps, 1) },
  { label: "Avg RSRP (dBm)", higherIsBetter: true, value: (r) => r.rsrp, format: (r) => fmtNum(r.rsrp, 1) },
  { label: "Avg SINR (dB)", higherIsBetter: true, value: (r) => r.sinr, format: (r) => fmtNum(r.sinr, 1) },
  { label: "Avg RSCP (dBm)", higherIsBetter: true, value: (r) => r.rscp, format: (r) => fmtNum(r.rscp, 1) },
  { label: "Avg Ec/No (dB)", higherIsBetter: true, value: (r) => r.ecno, format: (r) => fmtNum(r.ecno, 1) },
];

export const HistoricDataMap = ({ filters }: { filters: HistoricPageFilters }) => {
  const [direction, setDirection] = useState<HistoricDirection>("dl");
  const [operator, setOperator] = useState<OperatorFilter>(ALL);
  const { data, loading, error } = useHistoricLoad(`data_map|${direction}|${JSON.stringify(filters)}`, () => fetchHistoricDataMap(filters, direction));

  const colors = qualityColors(data?.bins.length ?? 7);
  const points = useMemo(
    () =>
      (data?.points ?? [])
        .filter((p) => operator === ALL || p[2] === operator)
        .map(([lat, lon, op, bin, value]) => ({ lat, lon, bin, color: colors[bin], tooltip: `${op} · ${fmtNum(value, 1)} Mbps · ${data!.bins[bin]} kbps` })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, operator],
  );
  const dir = direction.toUpperCase();

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <Segmented<HistoricDirection>
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "dl", label: "Downlink" },
            { value: "ul", label: "Uplink" },
          ]}
        />
        <OperatorFilterToggle value={operator} onChange={setOperator} present={(data?.operators ?? []).map((o) => o.operator)} />
        <p className="ml-auto text-[11px] text-muted-foreground">
          {direction === "dl" ? "Capacity DL tests (all outcomes)" : "Capacity UL tests, successful only"} · position = test end
        </p>
      </div>
      <LoadState loading={loading} error={error} hasData={(data?.operators.length ?? 0) > 0}>
        {data && (
          <>
            <Panel title={`${dir} throughput map`} subtitle="Each dot is one Capacity test, coloured by its average throughput bin (kbps)" icon={MapPin}>
              <HistoricPointsMap points={points as MapPoint[]} legend={legendFor(data.bins, colors, points)} footnote={sampleNote(data.points.length, data.totalPoints)} />
            </Panel>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Panel title={`${dir} throughput bins`} subtitle="Share of tests per throughput bin (kbps)" icon={Gauge}>
                <StackedMixChart rows={binRows(data.operators.map((o) => ({ operator: o.operator, counts: o.binCounts })), data.bins)} keys={data.bins} colors={colors} valueLabel="tests" />
              </Panel>
              <Panel title="Data technology" subtitle="Share of tests per reported data technology" icon={Layers}>
                <StackedMixChart rows={data.techMix} keys={TECH_KEYS} valueLabel="tests" />
              </Panel>
            </div>
            <MetricBarsGrid
              columns={2}
              icon={Gauge}
              data={data.operators}
              metrics={[
                { title: `${dir} average throughput`, subtitle: "Mbps", value: (r) => r.avgMbps, format: (v) => `${fmtNum(v, 1)} Mbps` },
                { title: `${dir} maximum throughput`, subtitle: "Best single test (Mbps)", value: (r) => r.maxMbps, format: (v) => `${fmtNum(v, 1)} Mbps` },
              ]}
            />
            <HistoricKpiTable title={`${dir} throughput & radio conditions`} icon={Signal} rows={radioRows} data={data.operators} />
          </>
        )}
      </LoadState>
    </>
  );
};

/* ────────────────────────── [15] DATA-MAP NR ────────────────────────── */

const ChannelTable = ({ rows, direction }: { rows: { group: string; operator: string; avgMbps: number; samples: number }[]; direction: string }) => {
  const groups = Array.from(new Set(rows.map((r) => r.group))).sort((a, b) => {
    const rank = (g: string) => (g === "LTE Channels" ? 1e7 : g === "Other" ? 1e8 : Number(g));
    return rank(a) - rank(b);
  });
  const ops = OPERATORS.filter((o) => rows.some((r) => r.operator === o.key));
  if (groups.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">No {direction} samples.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-border bg-muted">
            <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-foreground/80">EARFCN / NR-ARFCN</th>
            {ops.map((o) => (
              <th key={o.key} className="px-3 py-2 text-right">
                <span className="flex items-center justify-end gap-1.5 text-xs font-bold">
                  <OperatorSwatch color={o.color} /> {o.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g} className="border-b border-border/70 last:border-b-0 hover:bg-muted/30">
              <td className="px-3 py-1.5 font-mono text-[13px] text-foreground/90">{g}</td>
              {ops.map((o) => {
                const r = rows.find((x) => x.group === g && x.operator === o.key);
                return (
                  <td key={o.key} className="px-3 py-1.5 text-right font-mono text-[13px] tabular-nums text-foreground">
                    {r ? (
                      <>
                        {fmtNum(r.avgMbps, 1)} <span className="text-[11px] text-muted-foreground">Mbps · {fmtCount(r.samples)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const HistoricNrMap = ({ filters }: { filters: HistoricPageFilters }) => {
  const [operator, setOperator] = useState<OperatorFilter>(ALL);
  const { data, loading, error } = useHistoricLoad(`nr_map|${JSON.stringify(filters)}`, () => fetchHistoricNrMap(filters));
  // Τα RSRP bins έρχονται από το καλύτερο στο χειρότερο — τα χρώματα αντίστροφα.
  const colors = useMemo(() => [...qualityColors(data?.bins.length ?? 5)].reverse(), [data]);
  const points = useMemo(
    () =>
      (data?.points ?? [])
        .filter((p) => operator === ALL || p[2] === operator)
        .map(([lat, lon, op, bin, rsrp, sinr, earfcn]) => ({
          lat,
          lon,
          bin,
          color: colors[bin],
          tooltip: `${op} · NR RSRP ${fmtNum(rsrp, 1)} dBm · SINR ${sinr == null ? "—" : fmtNum(sinr, 1)} dB · ${earfcn}`,
        })),
    [data, operator, colors],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <OperatorFilterToggle value={operator} onChange={setOperator} present={(data?.binCounts ?? []).map((o) => o.operator)} />
        <p className="ml-auto text-[11px] text-muted-foreground">Capacity DL + UL samples with an NR RSRP reading</p>
      </div>
      <LoadState loading={loading} error={error} hasData={(data?.binCounts.length ?? 0) > 0 || (data?.channels.length ?? 0) > 0}>
        {data && (
          <>
            <Panel title="5G NR RSRP map" subtitle="Each dot is one Capacity sample, coloured by NR RSRP (dBm)" icon={MapPin}>
              <HistoricPointsMap points={points as MapPoint[]} legend={legendFor(data.bins, colors, points)} radius={3} footnote={sampleNote(data.points.length, data.totalPoints)} />
            </Panel>
            <Panel title="NR RSRP distribution" subtitle="Share of samples per RSRP bin" icon={Signal}>
              <StackedMixChart rows={binRows(data.binCounts, data.bins)} keys={data.bins} colors={colors} />
            </Panel>
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <Panel title="DL throughput per channel" subtitle="Average Capacity DL throughput and sample count per EARFCN / NR-ARFCN" icon={Antenna}>
                <ChannelTable rows={data.channels.filter((c) => c.direction === "dl")} direction="DL" />
              </Panel>
              <Panel title="UL throughput per channel" subtitle="Average Capacity UL throughput and sample count per EARFCN / NR-ARFCN" icon={Antenna}>
                <ChannelTable rows={data.channels.filter((c) => c.direction === "ul")} direction="UL" />
              </Panel>
            </div>
          </>
        )}
      </LoadState>
    </>
  );
};

/* ────────────────────────── [16] / [17] NR DATA TECH ────────────────────────── */

const NR_TECH_KEYS = ["5G NR-LTE", "LTE 5CCA", "LTE 4CCA", "LTE 3CCA", "LTE 2CCA", "LTE", "UMTS", "(Blank)"];
const BAND_KEYS = ["N78", "N1", "N28", "LTE"];

/** Σειρά/χρώμα των band / bandwidth λιστών: ταξινομημένες, σταθερές ανά απάντηση. */
const keysOf = (rows: HistoricMixRow[]) => Array.from(new Set(rows.flatMap((r) => r.parts.map((p) => p.key)))).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

export const HistoricNrTech = ({ filters }: { filters: HistoricPageFilters }) => {
  const { data, loading, error } = useHistoricLoad(`nr_tech|${JSON.stringify(filters)}`, () => fetchHistoricNrTech(filters));
  const hasCaBw = (data?.bandList.length ?? 0) > 0;
  return (
    <LoadState loading={loading} error={error} hasData={(data?.techMix.length ?? 0) > 0}>
      {data && (
        <>
          <Panel title="Data technology — DL services" subtitle="Share of time per technology: Capacity DL, HTTP DL, Ookla, YouTube" icon={Layers}>
            <StackedMixChart rows={data.techMix} keys={NR_TECH_KEYS} valueLabel="ms" />
          </Panel>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Band usage — DL services" subtitle="Share of time on N78 / N1 / N28 / LTE (N28 shown for COSMOTE only, as in the report)" icon={RadioTower}>
              <StackedMixChart rows={data.bandsDl} keys={BAND_KEYS} valueLabel="ms" />
            </Panel>
            <Panel title="Band usage — UL services" subtitle="Share of time on N78 / N1 / N28 / LTE: Capacity UL, HTTP UL" icon={RadioTower}>
              <StackedMixChart rows={data.bandsUl} keys={BAND_KEYS} valueLabel="ms" />
            </Panel>
          </div>
          {hasCaBw ? (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Panel title="NR bands in use (5G EN-DC / NR)" subtitle="Share of 5G time per used NR band combination" icon={Network}>
                  <StackedMixChart rows={data.bandList} keys={keysOf(data.bandList)} valueLabel="ms" />
                </Panel>
                <Panel title="NR bandwidth in use (MHz)" subtitle="Share of 5G time per used NR bandwidth combination" icon={Network}>
                  <StackedMixChart rows={data.bwList} keys={keysOf(data.bwList)} valueLabel="ms" />
                </Panel>
              </div>
              <MetricBarsGrid
                columns={2}
                icon={Network}
                data={data.usageBw}
                metrics={[
                  { title: "Average NR bandwidth used", subtitle: "MHz, 5G EN-DC / NR samples of DL services", value: (r) => r.usageBwMhz, format: (v) => `${fmtNum(v, 1)} MHz` },
                  { title: "Average NR bandwidth configured", subtitle: "MHz", value: (r) => r.configBwMhz, format: (v) => `${fmtNum(v, 1)} MHz` },
                ]}
              />
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
              NR band / bandwidth lists (page “NR DATA TECH/CA/BW”) are recorded from 2026H1 onward — none for this selection.
            </p>
          )}
        </>
      )}
    </LoadState>
  );
};

/* ────────────────────────── [18] / [19] NR SCANNER MAP ────────────────────────── */

export const HistoricNrScannerMap = ({ filters }: { filters: HistoricPageFilters }) => {
  const [bin, setBin] = useState<50 | 500>(50);
  const [operator, setOperator] = useState<string>("COSMOTE");
  const { data, loading, error } = useHistoricLoad(`nr_scanner|${bin}|${JSON.stringify(filters)}`, () => fetchHistoricNrScannerMap(filters, bin));
  const colors = useMemo(() => [...qualityColors(data?.bins.length ?? 7)].reverse(), [data]);
  const current = data?.operators.find((o) => o.operator === operator) ?? data?.operators[0];
  const points = useMemo(
    () =>
      (current?.points ?? []).map(([lat, lon, b, rsrp]) => ({
        lat,
        lon,
        bin: b,
        color: colors[b],
        tooltip: `${current!.operator} N78 · SS-RSRP ${fmtNum(rsrp, 1)} dBm`,
      })),
    [current, colors],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <Segmented<50 | 500>
          label="Bin size"
          value={bin}
          onChange={setBin}
          options={[
            { value: 50 as const, label: "50 m" },
            { value: 500 as const, label: "500 m" },
          ]}
        />
        <Segmented<string>
          label="Operator"
          value={current?.operator ?? operator}
          onChange={setOperator}
          options={(data?.operators ?? []).map((o) => ({ value: o.operator, label: operatorSpec(o.operator)?.label ?? o.operator }))}
        />
        <p className="ml-auto text-[11px] text-muted-foreground">Scanner N78 SSB, average SS-RSRP per bin</p>
      </div>
      <LoadState loading={loading} error={error} hasData={(data?.operators.length ?? 0) > 0}>
        {data && current && (
          <>
            <Panel title={`${operatorSpec(current.operator)?.label ?? current.operator} N78 — SS-RSRP, ${bin} m bins`} subtitle="Each dot is one scanner bin centre, coloured by average SS-RSRP (dBm)" icon={MapPin}>
              <HistoricPointsMap
                points={points as MapPoint[]}
                legend={legendFor(data.bins, colors, points)}
                radius={bin === 50 ? 3 : 5}
                footnote={sampleNote(current.points.length, current.totalPoints)}
              />
            </Panel>
            <Panel title="SS-RSRP distribution" subtitle="Share of scanner samples per SS-RSRP bin (dBm)" icon={Signal}>
              <StackedMixChart rows={binRows(data.operators.map((o) => ({ operator: o.operator, counts: o.binSamples })), data.bins)} keys={data.bins} colors={colors} />
            </Panel>
          </>
        )}
      </LoadState>
    </>
  );
};

/* ────────────────────────── [20] SCANNER 4G-5G ────────────────────────── */

/** 100% stacked μπάρες ανά κανάλι (operator + EARFCN / SSB) — οι κλάσεις του scanner. */
const ChannelClassChart = ({ rows, classes, metric }: { rows: HistoricScannerChannel[]; classes: string[]; metric: "rsrp" | "sinr" }) => {
  const colors = [...qualityColors(classes.length)].reverse();
  const data = rows.map((r) => {
    const values = r[metric];
    const total = values.reduce((s, v) => s + v, 0);
    const out: Record<string, string | number> = { channel: `${operatorSpec(r.operator)?.label ?? r.operator} ${r.channel}` };
    classes.forEach((c, i) => {
      out[c] = total ? (100 * values[i]) / total : 0;
      out[`${c}__raw`] = values[i];
    });
    return out;
  });
  if (data.length === 0) return <p className="py-10 text-center text-xs text-muted-foreground">No scanner samples for this selection.</p>;

  const ClassTooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; color: string; payload: Record<string, number> }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-semibold text-foreground">{label}</p>
        {payload.map((e) => (
          <p key={e.dataKey} className="flex items-center gap-1.5 font-mono text-foreground/90">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: e.color }} />
            <span className="text-foreground">{e.dataKey}</span> {fmtPct(row[e.dataKey], 1)}
            <span className="text-muted-foreground">· {fmtCount(row[`${e.dataKey}__raw`])} samples</span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={56 + data.length * 26}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barCategoryGap="18%">
        <CartesianGrid {...GRID_STYLE} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} {...AXIS_STYLE} />
        <YAxis type="category" dataKey="channel" width={150} {...AXIS_STYLE} tick={{ ...AXIS_STYLE.tick, fill: "hsl(var(--foreground))" }} />
        <Tooltip content={<ClassTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
        <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} formatter={(value: string) => <span className="text-foreground">{value}</span>} />
        {classes.map((c, i) => (
          <Bar key={c} dataKey={c} stackId="cls" fill={colors[i]} stroke={CARD_SURFACE} strokeWidth={2} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
};

export const HistoricScanner = ({ filters }: { filters: HistoricPageFilters }) => {
  const [operator, setOperator] = useState<OperatorFilter>(ALL);
  const { data, loading, error } = useHistoricLoad(`scanner|${JSON.stringify(filters)}`, () => fetchHistoricScanner(filters));
  const pick = (rows: HistoricScannerChannel[]) => rows.filter((r) => operator === ALL || r.operator === operator);
  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <OperatorFilterToggle value={operator} onChange={setOperator} present={Array.from(new Set([...(data?.lte ?? []), ...(data?.nr ?? [])].map((r) => r.operator)))} />
        <p className="ml-auto text-[11px] text-muted-foreground">Scanner samples per coverage / quality class</p>
      </div>
      <LoadState loading={loading} error={error} hasData={(data?.lte.length ?? 0) + (data?.nr.length ?? 0) > 0}>
        {data && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="LTE RSRP per EARFCN" subtitle="Share of scanner samples per RSRP class" icon={Signal}>
              <ChannelClassChart rows={pick(data.lte)} classes={data.classes} metric="rsrp" />
            </Panel>
            <Panel title="LTE SINR per EARFCN" subtitle="Share of scanner samples per SINR class" icon={Signal}>
              <ChannelClassChart rows={pick(data.lte)} classes={data.classes} metric="sinr" />
            </Panel>
            <Panel title="5G NR SS-RSRP per SSB channel" subtitle="Share of scanner samples per RSRP class" icon={Antenna}>
              <ChannelClassChart rows={pick(data.nr)} classes={data.classes} metric="rsrp" />
            </Panel>
            <Panel title="5G NR SS-SINR per SSB channel" subtitle="Share of scanner samples per SINR class" icon={Antenna}>
              <ChannelClassChart rows={pick(data.nr)} classes={data.classes} metric="sinr" />
            </Panel>
          </div>
        )}
      </LoadState>
    </>
  );
};
