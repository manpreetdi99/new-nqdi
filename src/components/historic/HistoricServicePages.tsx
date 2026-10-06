import { useState } from "react";
import { Activity, Gauge, Globe, Network, RadioTower, Server, Timer, Video, Wifi, Zap } from "lucide-react";

import {
  fetchHistoricBrowsing,
  fetchHistoricCapacity,
  fetchHistoricDns,
  fetchHistoricHttp,
  fetchHistoricInteractivity,
  fetchHistoricPingOokla,
  fetchHistoricVideoPage,
  type HistoricBrowsingOperator,
  type HistoricCapacityOperator,
  type HistoricDnsOperator,
  type HistoricHttpOperator,
  type HistoricInteractivityOperator,
  type HistoricMixRow,
  type HistoricOoklaOperator,
  type HistoricPageFilters,
  type HistoricPingOperator,
  type HistoricVideoPageOperator,
} from "@/lib/api";
import {
  HistoricKpiTable,
  LoadState,
  MetricBarsGrid,
  OperatorValueBars,
  Panel,
  PartSelect,
  StackedMixChart,
  fmtCount,
  fmtNum,
  fmtPct,
  useHistoricLoad,
  type MetricSpec,
  type Row,
} from "./historicShared";

/**
 * Οι σελίδες υπηρεσιών DATA του .pbix — [06] BROWSING, [07] DNS, [08] HTTP, [09] PING/OOKLA,
 * [10] INTERACTIVITY, [11] CAPACITY, [12] VIDEO. Κάθε visual «τιμή ανά operator» του report
 * (column / bar / funnel / donut) γίνεται ένα OperatorValueBars panel, τα cards ένας KPI πίνακας
 * με operator columns (και table view για όσα δείχνουν τα bars). Ορισμοί των measures:
 * backend/routers/historic_data_pages.py.
 */

const pct = (v: number) => fmtPct(v, 2);
const PCT_DOMAIN: [number, number] = [0, 100];
const mbps = (v: number) => `${fmtNum(v, 1)} Mbps`;
const ms = (v: number) => `${fmtNum(v, 0)} ms`;
const sec = (v: number) => `${fmtNum(v, 2)} s`;

/** Όταν μια σελίδα έχει πολλές ομάδες operators (π.χ. DL / UL), κάθε ομάδα φορτώνει τον δικό της
 * KPI πίνακα· το LoadState θέλει να ξέρει αν υπάρχει έστω ένα operator. */
const anyRows = (...groups: ({ operator: string }[] | undefined)[]) => groups.some((g) => (g?.length ?? 0) > 0);

const usePage = <T,>(name: string, filters: HistoricPageFilters, load: () => Promise<T>, extraKey = "") =>
  useHistoricLoad(`${name}|${extraKey}|${JSON.stringify(filters)}`, load);

/* ────────────────────────── [06] DATA-BROWSING ────────────────────────── */

const browsingRows = (withTtf500: boolean): Row<HistoricBrowsingOperator>[] => [
  { label: "Attempts", higherIsBetter: null, value: (r) => r.attempts, format: (r) => fmtCount(r.attempts) },
  { label: "Success Rate (%)", emphasis: true, higherIsBetter: true, value: (r) => r.successRate, format: (r) => fmtPct(r.successRate, 2) },
  { label: "Avg transfer duration (s)", emphasis: true, higherIsBetter: false, value: (r) => r.avgDurationS, format: (r) => fmtNum(r.avgDurationS, 2) },
  { label: "Avg time to first byte (ms)", higherIsBetter: false, value: (r) => r.avgTtfbMs, format: (r) => fmtNum(r.avgTtfbMs, 0) },
  ...(withTtf500
    ? [{ label: "Avg time to first 500 B (ms)", higherIsBetter: false, value: (r) => r.avgTtf500Ms, format: (r) => fmtNum(r.avgTtf500Ms, 0) } as Row<HistoricBrowsingOperator>]
    : []),
];

const browsingMetrics = (withTtf500: boolean): MetricSpec<HistoricBrowsingOperator>[] => [
  { title: "Success rate", subtitle: "Successful / attempted page loads", value: (r) => r.successRate, format: pct, domain: PCT_DOMAIN },
  { title: "Transfer duration", subtitle: "Average, successful loads (s)", value: (r) => r.avgDurationS, format: sec },
  withTtf500
    ? { title: "Time to first 500 B", subtitle: "Average, successful loads (ms)", value: (r) => r.avgTtf500Ms, format: ms }
    : { title: "Time to first byte", subtitle: "Average, successful loads (ms)", value: (r) => r.avgTtfbMs, format: ms },
];

export const HistoricBrowsing = ({ filters }: { filters: HistoricPageFilters }) => {
  const { data, loading, error } = usePage("browsing", filters, () => fetchHistoricBrowsing(filters));
  return (
    <LoadState loading={loading} error={error} hasData={anyRows(data?.kepler, data?.live)}>
      {data && (
        <>
          <HistoricKpiTable title="Browsing — Kepler reference page (Kepler, Kepler after 30 s, Newton)" icon={Globe} rows={browsingRows(false)} data={data.kepler} />
          {data.kepler.length > 0 && <MetricBarsGrid metrics={browsingMetrics(false)} data={data.kepler} icon={Globe} />}
          <HistoricKpiTable title="Browsing — live web pages" icon={Globe} rows={browsingRows(true)} data={data.live} />
          {data.live.length > 0 && <MetricBarsGrid metrics={browsingMetrics(true)} data={data.live} icon={Globe} />}
        </>
      )}
    </LoadState>
  );
};

/* ────────────────────────── [07] DNS ────────────────────────── */

const ALL_TESTS = "All tests";

const dnsRows: Row<HistoricDnsOperator>[] = [
  { label: "DNS attempts", higherIsBetter: null, value: (r) => r.attempts, format: (r) => fmtCount(r.attempts) },
  { label: "Successful (%)", emphasis: true, higherIsBetter: true, value: (r) => r.successPct, format: (r) => fmtPct(r.successPct, 2) },
  { label: "Failed (%)", higherIsBetter: false, value: (r) => r.failedPct, format: (r) => fmtPct(r.failedPct, 2) },
  { label: "Weighted avg DNS time (ms)", emphasis: true, higherIsBetter: false, value: (r) => r.avgTimeMs, format: (r) => fmtNum(r.avgTimeMs, 1) },
  { label: "Min DNS time (ms)", higherIsBetter: false, value: (r) => r.minTimeMs, format: (r) => fmtNum(r.minTimeMs, 0) },
  { label: "Max DNS time (ms)", higherIsBetter: false, value: (r) => r.maxTimeMs, format: (r) => fmtNum(r.maxTimeMs, 0) },
];

export const HistoricDns = ({ filters }: { filters: HistoricPageFilters }) => {
  const [test, setTest] = useState("");
  const { data, loading, error } = usePage("dns", filters, () => fetchHistoricDns(filters, test), test);
  const operators = data?.operators ?? [];
  const outcome: HistoricMixRow[] = operators.map((o) => ({
    operator: o.operator,
    parts: [
      { key: "Successful", value: o.successes, mos: null },
      { key: "Failed", value: Math.max(0, o.attempts - o.successes), mos: null },
    ],
  }));
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <PartSelect
          label="Test selection"
          placeholder={ALL_TESTS}
          options={[ALL_TESTS, ...(data?.tests ?? [])]}
          value={test || ALL_TESTS}
          onChange={(v) => setTest(v === ALL_TESTS ? "" : v)}
          widthClass="w-48"
        />
        <p className="pb-2 text-[11px] text-muted-foreground">DNS lookups made by the selected service's tests.</p>
      </div>
      <LoadState loading={loading} error={error} hasData={operators.length > 0}>
        <HistoricKpiTable title={`DNS — ${test || ALL_TESTS}`} icon={Server} rows={dnsRows} data={operators} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="DNS outcome" subtitle="Share of successful vs failed lookups" icon={Server}>
            <StackedMixChart rows={outcome} keys={["Successful", "Failed"]} colors={["#3987e5", "#dd5a48"]} valueLabel="lookups" />
          </Panel>
          <Panel title="Weighted average DNS time" subtitle="Σ(avg time × successful) / Σ successful (ms)" icon={Timer}>
            <OperatorValueBars values={operators.map((o) => ({ operator: o.operator, value: o.avgTimeMs }))} format={ms} />
          </Panel>
        </div>
        <MetricBarsGrid
          columns={2}
          icon={Timer}
          data={operators}
          metrics={[
            { title: "Minimum DNS time", subtitle: "Fastest lookup (ms)", value: (r) => r.minTimeMs, format: ms },
            { title: "Maximum DNS time", subtitle: "Slowest lookup (ms)", value: (r) => r.maxTimeMs, format: ms },
          ]}
        />
      </LoadState>
    </>
  );
};

/* ────────────────────────── [08] DATA-HTTP ────────────────────────── */

const httpRows = (dir: string): Row<HistoricHttpOperator>[] => [
  { label: `${dir} attempts`, higherIsBetter: null, value: (r) => r.attempts, format: (r) => fmtCount(r.attempts) },
  { label: `${dir} success rate (%)`, emphasis: true, higherIsBetter: true, value: (r) => r.successRate, format: (r) => fmtPct(r.successRate, 2) },
  { label: `${dir} avg throughput (Mbps)`, emphasis: true, higherIsBetter: true, value: (r) => r.avgThrpMbps, format: (r) => fmtNum(r.avgThrpMbps, 1) },
  { label: `${dir} P'10 throughput (Mbps)`, higherIsBetter: true, value: (r) => r.p10Mbps, format: (r) => fmtNum(r.p10Mbps, 1) },
  { label: `${dir} P'90 throughput (Mbps)`, higherIsBetter: true, value: (r) => r.p90Mbps, format: (r) => fmtNum(r.p90Mbps, 1) },
  { label: `${dir} max throughput (Mbps)`, higherIsBetter: true, value: (r) => r.maxMbps, format: (r) => fmtNum(r.maxMbps, 1) },
  { label: `${dir} avg transfer duration (s)`, higherIsBetter: false, value: (r) => r.avgDurationS, format: (r) => fmtNum(r.avgDurationS, 2) },
];

const httpMetrics = (dir: string): MetricSpec<HistoricHttpOperator>[] => [
  { title: `${dir} throughput`, subtitle: "Average, successful transfers (Mbps)", value: (r) => r.avgThrpMbps, format: mbps },
  { title: `${dir} transfer duration`, subtitle: "Average, successful transfers (s)", value: (r) => r.avgDurationS, format: sec },
  { title: `${dir} success rate`, subtitle: "Successful / attempted transfers", value: (r) => r.successRate, format: pct, domain: PCT_DOMAIN },
];

export const HistoricHttp = ({ filters }: { filters: HistoricPageFilters }) => {
  const { data, loading, error } = usePage("http", filters, () => fetchHistoricHttp(filters));
  return (
    <LoadState loading={loading} error={error} hasData={anyRows(data?.dl, data?.ul)}>
      {data && (
        <>
          <HistoricKpiTable title="HTTP transfer — Downlink" icon={Wifi} rows={httpRows("DL")} data={data.dl} />
          {data.dl.length > 0 && <MetricBarsGrid metrics={httpMetrics("DL")} data={data.dl} icon={Wifi} />}
          <HistoricKpiTable title="HTTP transfer — Uplink" icon={Wifi} rows={httpRows("UL")} data={data.ul} />
          {data.ul.length > 0 && <MetricBarsGrid metrics={httpMetrics("UL")} data={data.ul} icon={Wifi} />}
          <p className="text-[11px] text-muted-foreground">
            P'10 / P'90 / max are per A-side data location (all transfers); averages and success rate are per home operator.
          </p>
        </>
      )}
    </LoadState>
  );
};

/* ────────────────────────── [09] DATA-PING/OOKLA ────────────────────────── */

const pingRows = (size: string): Row<HistoricPingOperator>[] => [
  { label: `Ping attempts (${size})`, higherIsBetter: null, value: (r) => r.attempts, format: (r) => fmtCount(r.attempts) },
  { label: `Success rate (${size}) (%)`, higherIsBetter: true, value: (r) => r.successRate, format: (r) => fmtPct(r.successRate, 2) },
  { label: `Weighted avg RTT (${size}) (ms)`, emphasis: true, higherIsBetter: false, value: (r) => r.rttMs, format: (r) => fmtNum(r.rttMs, 1) },
  { label: `RTT on LTE-5G NR (${size}) (ms)`, higherIsBetter: false, value: (r) => r.rtt5gMs, format: (r) => fmtNum(r.rtt5gMs, 1) },
  { label: `RTT on LTE (${size}) (ms)`, higherIsBetter: false, value: (r) => r.rttLteMs, format: (r) => fmtNum(r.rttLteMs, 1) },
];

const ooklaRows: Row<HistoricOoklaOperator>[] = [
  { label: "Ookla DL throughput (Mbps)", emphasis: true, higherIsBetter: true, value: (r) => r.dlMbps, format: (r) => fmtNum(r.dlMbps, 1) },
  { label: "Ookla UL throughput (Mbps)", emphasis: true, higherIsBetter: true, value: (r) => r.ulMbps, format: (r) => fmtNum(r.ulMbps, 1) },
  { label: "Ookla latency (ms)", emphasis: true, higherIsBetter: false, value: (r) => r.latencyMs, format: (r) => fmtNum(r.latencyMs, 1) },
  { label: "Successful DL / UL tests", higherIsBetter: null, value: (r) => r.dlTests, format: (r) => `${fmtCount(r.dlTests)} / ${fmtCount(r.ulTests)}` },
];

export const HistoricPingOokla = ({ filters }: { filters: HistoricPageFilters }) => {
  const { data, loading, error } = usePage("ping_ookla", filters, () => fetchHistoricPingOokla(filters));
  return (
    <LoadState loading={loading} error={error} hasData={anyRows(data?.pingSmall, data?.pingLarge, data?.ookla)}>
      {data && (
        <>
          <HistoricKpiTable title="Ping — 32/40 B packets" icon={Zap} rows={pingRows("32/40 B")} data={data.pingSmall} />
          <HistoricKpiTable title="Ping — 800 B packets" icon={Zap} rows={pingRows("800 B")} data={data.pingLarge} />
          <MetricBarsGrid
            columns={2}
            icon={Zap}
            data={data.pingSmall.map((r) => ({ ...r, large: data.pingLarge.find((l) => l.operator === r.operator) }))}
            metrics={[
              { title: "RTT — 32/40 B", subtitle: "Σ(avg RTT × successful) / Σ successful (ms)", value: (r) => r.rttMs, format: ms },
              { title: "RTT — 800 B", subtitle: "Σ(avg RTT × successful) / Σ successful (ms)", value: (r) => r.large?.rttMs, format: ms },
              { title: "Ping success rate — 32/40 B", value: (r) => r.successRate, format: pct, domain: PCT_DOMAIN },
              { title: "Ping success rate — 800 B", value: (r) => r.large?.successRate, format: pct, domain: PCT_DOMAIN },
            ]}
          />
          <HistoricKpiTable title="Ookla speed test" icon={Gauge} rows={ooklaRows} data={data.ookla} />
          {data.ookla.length > 0 && (
            <MetricBarsGrid
              icon={Gauge}
              data={data.ookla}
              metrics={[
                { title: "Ookla DL throughput", subtitle: "Average, successful tests (Mbps)", value: (r) => r.dlMbps, format: mbps },
                { title: "Ookla UL throughput", subtitle: "Average, successful tests (Mbps)", value: (r) => r.ulMbps, format: mbps },
                { title: "Ookla latency", subtitle: "Average, successful tests (ms)", value: (r) => r.latencyMs, format: ms },
              ]}
            />
          )}
        </>
      )}
    </LoadState>
  );
};

/* ────────────────────────── [10] DATA-INTERACTIVITY ────────────────────────── */

const interactivityRows: Row<HistoricInteractivityOperator>[] = [
  { label: "Successful / failed tests", higherIsBetter: null, value: (r) => r.successes, format: (r) => `${fmtCount(r.successes)} / ${fmtCount(r.failures)}` },
  { label: "Success rate (%)", emphasis: true, higherIsBetter: true, value: (r) => r.successRate, format: (r) => fmtPct(r.successRate, 2) },
  { label: "Avg QoE score", emphasis: true, higherIsBetter: true, value: (r) => r.qoeScore, format: (r) => fmtNum(r.qoeScore, 3) },
  { label: "Weighted avg RTT (ms)", higherIsBetter: false, value: (r) => r.rttMs, format: (r) => fmtNum(r.rttMs, 1) },
  { label: "Weighted avg one-way delay (ms)", higherIsBetter: false, value: (r) => r.delayMs, format: (r) => fmtNum(r.delayMs, 1) },
  { label: "Weighted avg packet loss (%)", higherIsBetter: false, value: (r) => r.packetLossPct, format: (r) => fmtNum(r.packetLossPct, 3) },
  { label: "Weighted avg throughput (kbps)", higherIsBetter: true, value: (r) => r.thrpKbps, format: (r) => fmtNum(r.thrpKbps, 0) },
  { label: "Packets lost / sent", higherIsBetter: null, value: (r) => r.packetsLost, format: (r) => `${fmtCount(r.packetsLost)} / ${fmtCount(r.packetsSent)}` },
];

export const HistoricInteractivity = ({ filters }: { filters: HistoricPageFilters }) => {
  const { data, loading, error } = usePage("interactivity", filters, () => fetchHistoricInteractivity(filters));
  const operators = data?.operators ?? [];
  return (
    <LoadState loading={loading} error={error} hasData={operators.length > 0}>
      <HistoricKpiTable title="Interactivity" icon={Activity} rows={interactivityRows} data={operators} />
      <MetricBarsGrid
        icon={Activity}
        data={operators}
        metrics={[
          { title: "QoE score", subtitle: "Average interactivity score", value: (r) => r.qoeScore, format: (v) => fmtNum(v, 3) },
          { title: "Success rate", subtitle: "Successful / (successful + failed)", value: (r) => r.successRate, format: pct, domain: PCT_DOMAIN },
          { title: "Round-trip time", subtitle: "Weighted by successful tests (ms)", value: (r) => r.rttMs, format: ms },
          { title: "One-way delay", subtitle: "Weighted by successful tests (ms)", value: (r) => r.delayMs, format: ms },
          { title: "Packet loss", subtitle: "Weighted by successful tests (%)", value: (r) => r.packetLossPct, format: (v) => `${fmtNum(v, 3)}%` },
          { title: "Throughput", subtitle: "Weighted by successful tests (kbps)", value: (r) => r.thrpKbps, format: (v) => `${fmtNum(v, 0)} kbps` },
        ]}
      />
      <p className="text-[11px] text-muted-foreground">RTT, delay, packet loss and throughput use only patterns with no failed tests, as in the report.</p>
    </LoadState>
  );
};

/* ────────────────────────── [11] DATA-CAPACITY ────────────────────────── */

const capacityRows: Row<HistoricCapacityOperator>[] = [
  { label: "DL tests (successful / attempts)", higherIsBetter: null, value: (r) => r.dlAttempts, format: (r) => `${fmtCount(r.dlSuccesses)} / ${fmtCount(r.dlAttempts)}` },
  { label: "DL success rate (%)", higherIsBetter: true, value: (r) => r.dlSuccessRate, format: (r) => fmtPct(r.dlSuccessRate, 2) },
  { label: "DL avg throughput (Mbps)", emphasis: true, higherIsBetter: true, value: (r) => r.dlAvgMbps, format: (r) => fmtNum(r.dlAvgMbps, 1) },
  { label: "DL P'10 throughput (Mbps)", higherIsBetter: true, value: (r) => r.dlP10Mbps, format: (r) => fmtNum(r.dlP10Mbps, 1) },
  { label: "DL P'90 throughput (Mbps)", higherIsBetter: true, value: (r) => r.dlP90Mbps, format: (r) => fmtNum(r.dlP90Mbps, 1) },
  { label: "DL max throughput (Mbps)", higherIsBetter: true, value: (r) => r.dlMaxMbps, format: (r) => fmtNum(r.dlMaxMbps, 1) },
  { label: "UL tests (successful / attempts)", higherIsBetter: null, value: (r) => r.ulAttempts, format: (r) => `${fmtCount(r.ulSuccesses)} / ${fmtCount(r.ulAttempts)}` },
  { label: "UL success rate (%)", higherIsBetter: true, value: (r) => r.ulSuccessRate, format: (r) => fmtPct(r.ulSuccessRate, 2) },
  { label: "UL avg throughput (Mbps)", emphasis: true, higherIsBetter: true, value: (r) => r.ulAvgMbps, format: (r) => fmtNum(r.ulAvgMbps, 1) },
  { label: "UL P'10 throughput (Mbps)", higherIsBetter: true, value: (r) => r.ulP10Mbps, format: (r) => fmtNum(r.ulP10Mbps, 1) },
  { label: "UL P'90 throughput (Mbps)", higherIsBetter: true, value: (r) => r.ulP90Mbps, format: (r) => fmtNum(r.ulP90Mbps, 1) },
  { label: "UL max throughput (Mbps)", higherIsBetter: true, value: (r) => r.ulMaxMbps, format: (r) => fmtNum(r.ulMaxMbps, 1) },
];

const CA_KEYS = ["LTE 5CA", "LTE 4CA", "LTE 3CA", "LTE 2CA", "LTE", "Non LTE", "(Blank)"];
const NR_BAND_KEYS = ["N78", "N1", "N28", "Other"];

export const HistoricCapacity = ({ filters }: { filters: HistoricPageFilters }) => {
  const { data, loading, error } = usePage("capacity", filters, () => fetchHistoricCapacity(filters));
  const operators = data?.operators ?? [];
  return (
    <LoadState loading={loading} error={error} hasData={operators.length > 0}>
      {data && (
        <>
          <HistoricKpiTable title="Capacity (max throughput test)" icon={Gauge} rows={capacityRows} data={operators} />
          <MetricBarsGrid
            columns={2}
            icon={Gauge}
            data={operators}
            metrics={[
              { title: "DL throughput", subtitle: "Average, successful Capacity DL tests (Mbps)", value: (r) => r.dlAvgMbps, format: mbps },
              { title: "UL throughput", subtitle: "Average, successful Capacity UL tests (Mbps)", value: (r) => r.ulAvgMbps, format: mbps },
              { title: "DL success rate", value: (r) => r.dlSuccessRate, format: pct, domain: PCT_DOMAIN },
              { title: "UL success rate", value: (r) => r.ulSuccessRate, format: pct, domain: PCT_DOMAIN },
            ]}
          />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="LTE carrier aggregation" subtitle="Share of Capacity DL tests per active CA level" icon={RadioTower}>
              <StackedMixChart rows={data.caMix} keys={CA_KEYS} valueLabel="tests" />
            </Panel>
            <Panel title="5G NR band usage" subtitle="Share of Capacity DL time on each NR band (DL NR-ARFCN)" icon={Network}>
              <StackedMixChart rows={data.nrBands} keys={NR_BAND_KEYS} valueLabel="ms" />
            </Panel>
          </div>
          <p className="text-[11px] text-muted-foreground">
            P'10 / P'90 / max follow the serving network of each successful test; the rest follow the home operator.
          </p>
        </>
      )}
    </LoadState>
  );
};

/* ────────────────────────── [12] DATA-VIDEO ────────────────────────── */

const videoRows: Row<HistoricVideoPageOperator>[] = [
  { label: "Attempts", higherIsBetter: null, value: (r) => r.attempts, format: (r) => fmtCount(r.attempts) },
  { label: "Success rate (%)", emphasis: true, higherIsBetter: true, value: (r) => r.successRate, format: (r) => fmtPct(r.successRate, 2) },
  { label: "Avg VMOS", emphasis: true, higherIsBetter: true, value: (r) => r.vmos, format: (r) => fmtNum(r.vmos, 2) },
  { label: "Freezing time (%)", higherIsBetter: false, value: (r) => r.freezingPct, format: (r) => fmtPct(r.freezingPct, 2) },
  { label: "Time to first picture (s)", higherIsBetter: false, value: (r) => r.ttfpS, format: (r) => fmtNum(r.ttfpS, 2) },
  { label: "Avg resolution (lines)", higherIsBetter: true, value: (r) => r.avgResolution, format: (r) => fmtNum(r.avgResolution, 0) },
];

export const HistoricVideo = ({ filters }: { filters: HistoricPageFilters }) => {
  const { data, loading, error } = usePage("video", filters, () => fetchHistoricVideoPage(filters));
  const operators = data?.operators ?? [];
  return (
    <LoadState loading={loading} error={error} hasData={operators.length > 0}>
      <HistoricKpiTable title="Video (YouTube)" icon={Video} rows={videoRows} data={operators} />
      <MetricBarsGrid
        icon={Video}
        data={operators}
        metrics={[
          { title: "VMOS", subtitle: "Average video MOS, completed sessions (1–5)", value: (r) => r.vmos, format: (v) => fmtNum(v, 2), domain: [0, 5] },
          { title: "Success rate", subtitle: "Completed / attempted sessions", value: (r) => r.successRate, format: pct, domain: PCT_DOMAIN },
          { title: "Freezing time", subtitle: "Average share of play time frozen", value: (r) => r.freezingPct, format: pct },
          { title: "Time to first picture", subtitle: "Average, completed + dropped (s)", value: (r) => r.ttfpS, format: sec },
          { title: "Resolution", subtitle: "Average vertical resolution (lines)", value: (r) => r.avgResolution, format: (v) => `${fmtNum(v, 0)}p` },
        ]}
      />
    </LoadState>
  );
};
