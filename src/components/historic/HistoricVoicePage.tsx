import { useMemo } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Activity, MapPin, Phone, PhoneCall, Radio, Timer } from "lucide-react";

import {
  fetchHistoricVoicePage,
  type HistoricMixRow,
  type HistoricPageFilters,
  type HistoricVoiceKind,
  type HistoricVoicePageOperator,
} from "@/lib/api";
import {
  FitToPoints,
  HistoricKpiTable,
  LoadState,
  OPERATORS,
  OperatorSwatch,
  OperatorValueBars,
  Panel,
  StackedMixChart,
  fmtCount,
  fmtNum,
  fmtPct,
  operatorSpec,
  useHistoricLoad,
  type Row,
} from "./historicShared";

/**
 * [03] VOICE M->F και [04] VOICE M->M του .pbix — ίδια διάταξη, διαφορετικός πίνακας
 * (BI_VOICE_MtoF / BI_VOICE_MtoM). Τα cards ανά operator του report γίνονται ένας KPI πίνακας
 * με operator columns (ίδιο idiom με το snapshot)· τα υπόλοιπα visuals: call-mode mix (03.4 /
 * 04.4), CSFB 3G MO setup (03.27) ή SRVCC duration (04.23), low-MOS calls (03.32 / 04.37) και
 * χάρτης Dropped/Failed κλήσεων (03.28 / 04.24). Ορισμοί: get_historic_voice_page.
 */

const pct = (v: number | null | undefined) => fmtPct(v, 2);

const baseRows = (kind: HistoricVoiceKind): Row<HistoricVoicePageOperator>[] => [
  { label: "Call Attempts", higherIsBetter: null, value: (r) => r.attempts, format: (r) => fmtCount(r.attempts) },
  { label: "Success Rate (%)", emphasis: true, higherIsBetter: true, value: (r) => r.successRate, format: (r) => pct(r.successRate) },
  { label: "Failed Calls", higherIsBetter: null, value: (r) => r.failed, format: (r) => fmtCount(r.failed) },
  { label: "Access Failure Rate (%)", emphasis: true, higherIsBetter: false, value: (r) => r.afr, format: (r) => pct(r.afr) },
  { label: "Dropped Calls", higherIsBetter: null, value: (r) => r.dropped, format: (r) => fmtCount(r.dropped) },
  { label: "Dropped Call Rate (%)", emphasis: true, higherIsBetter: false, value: (r) => r.dcr, format: (r) => pct(r.dcr) },
  { label: "Average CST (s)", emphasis: true, higherIsBetter: false, value: (r) => r.avgCst, format: (r) => fmtNum(r.avgCst, 2) },
  { label: "P'90 CST (s)", higherIsBetter: false, value: (r) => r.p90Cst, format: (r) => fmtNum(r.p90Cst, 2) },
  ...(kind === "mtom"
    ? ([
        { label: "Average CST — KPI 11000, A→B (s)", higherIsBetter: false, value: (r) => r.avgCst11000 ?? null, format: (r) => fmtNum(r.avgCst11000, 2) },
        { label: "P'90 CST — KPI 11000, A→B (s)", higherIsBetter: false, value: (r) => r.p90Cst11000 ?? null, format: (r) => fmtNum(r.p90Cst11000, 2) },
      ] as Row<HistoricVoicePageOperator>[])
    : []),
  { label: "Average MOS", emphasis: true, higherIsBetter: true, value: (r) => r.mos, format: (r) => fmtNum(r.mos, 2) },
  { label: "P'10 MOS", higherIsBetter: true, value: (r) => r.p10Mos, format: (r) => fmtNum(r.p10Mos, 2) },
  { label: "Low-MOS calls (%)", higherIsBetter: false, value: (r) => r.lowMosPct, format: (r) => pct(r.lowMosPct) },
  ...(kind === "mtom"
    ? ([
        { label: "Inter-system HO Success Rate (%)", higherIsBetter: true, value: (r) => r.interHoSr ?? null, format: (r) => pct(r.interHoSr) },
        { label: "Intra-system HO Success Rate (%)", higherIsBetter: true, value: (r) => r.intraHoSr ?? null, format: (r) => pct(r.intraHoSr) },
      ] as Row<HistoricVoicePageOperator>[])
    : []),
];

const MODE_KEYS: Record<HistoricVoiceKind, string[]> = {
  mtof: ["CS", "CSFB"],
  mtom: ["VoLTE", "SRVCC", "CS", "CSFB"],
};

const HistoricVoicePage = ({ kind, filters }: { kind: HistoricVoiceKind; filters: HistoricPageFilters }) => {
  const key = `${kind}|${JSON.stringify(filters)}`;
  const { data, loading, error } = useHistoricLoad(key, () => fetchHistoricVoicePage(kind, filters));
  const operators = useMemo(() => data?.operators ?? [], [data]);
  const failures = useMemo(() => data?.failures ?? [], [data]);
  const failurePoints = useMemo(() => failures.map((f) => [f.lat, f.lon] as [number, number]), [failures]);

  const modeRows: HistoricMixRow[] = useMemo(() => {
    const keys = MODE_KEYS[kind];
    const extra = Array.from(new Set((data?.callModes ?? []).map((m) => m.mode))).filter((m) => !keys.includes(m));
    return OPERATORS.filter((op) => data?.callModes.some((m) => m.operator === op.key)).map((op) => ({
      operator: op.key,
      parts: [...keys, ...extra].map((mode) => ({
        key: mode,
        value: data!.callModes.find((m) => m.operator === op.key && m.mode === mode)?.count ?? 0,
        mos: null,
      })),
    }));
  }, [data, kind]);
  const modeKeys = useMemo(
    () => [...MODE_KEYS[kind], ...Array.from(new Set(modeRows.flatMap((r) => r.parts.map((p) => p.key)))).filter((m) => !MODE_KEYS[kind].includes(m))],
    [modeRows, kind],
  );

  const title = kind === "mtof" ? "Voice M→F (GSM / fixed line)" : "Voice M→M (Free)";
  const failureCounts = useMemo(() => {
    const m = new Map<string, { dropped: number; failed: number }>();
    failures.forEach((f) => {
      const c = m.get(f.operator) ?? { dropped: 0, failed: 0 };
      if (f.status === "Dropped") c.dropped += 1;
      else c.failed += 1;
      m.set(f.operator, c);
    });
    return m;
  }, [failures]);

  return (
    <LoadState loading={loading} error={error} hasData={operators.length > 0}>
      <HistoricKpiTable title={title} icon={kind === "mtof" ? PhoneCall : Phone} rows={baseRows(kind)} data={operators} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Call mode"
          subtitle={kind === "mtof" ? "Share of calls per CustomCallMode (CS / CSFB)" : "Share of calls per call mode (CallModeA)"}
          icon={Radio}
        >
          <StackedMixChart rows={modeRows} keys={modeKeys} valueLabel="calls" />
        </Panel>

        {kind === "mtof" ? (
          <Panel title="CSFB 3G MO setup time" subtitle="Average ThreeGMO (s) — CSFB calls only" icon={Timer}>
            <OperatorValueBars values={operators.map((o) => ({ operator: o.operator, value: o.threeGMo ?? null }))} format={(v) => `${fmtNum(v, 2)} s`} />
          </Panel>
        ) : (
          <Panel title="SRVCC duration" subtitle="Average A-side SRVCC duration (ms) — calls with a successful SRVCC" icon={Timer}>
            <OperatorValueBars
              values={operators.map((o) => ({ operator: o.operator, value: o.srvccDurationMs ?? null }))}
              format={(v) => `${fmtNum(v, 0)} ms`}
            />
          </Panel>
        )}

        <Panel title="Low-MOS calls" subtitle="Completed calls with two low-MOS (<1.29) or silent samples, as % of attempts" icon={Activity}>
          <OperatorValueBars values={operators.map((o) => ({ operator: o.operator, value: o.lowMosPct }))} format={(v) => fmtPct(v, 2)} />
        </Panel>

        <Panel
          className="xl:col-span-2"
          title="Dropped & failed calls"
          subtitle={`Call-end position · filled = dropped, ring = failed${failures.length >= 5000 ? " · first 5,000 shown" : ""}`}
          icon={MapPin}
        >
          <div className="h-[520px] overflow-hidden rounded-lg">
            <MapContainer center={[38.6, 23.8]} zoom={6} scrollWheelZoom preferCanvas style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitToPoints points={failurePoints} />
              {failures.map((f, i) => {
                const color = operatorSpec(f.operator)?.color ?? "#94a3b8";
                return (
                  <CircleMarker
                    key={i}
                    center={[f.lat, f.lon]}
                    radius={5}
                    pathOptions={{ color: f.status === "Dropped" ? "#ffffff" : color, weight: f.status === "Dropped" ? 1 : 2.5, fillColor: color, fillOpacity: f.status === "Dropped" ? 0.95 : 0 }}
                  >
                    <LeafletTooltip>
                      <span className="text-xs">
                        <b>{f.operator}</b> · {f.status}
                        <br />
                        {f.collection}
                      </span>
                    </LeafletTooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
            {OPERATORS.filter((op) => failureCounts.has(op.key)).map((op) => {
              const c = failureCounts.get(op.key)!;
              return (
                <span key={op.key} className="flex items-center gap-1.5">
                  <OperatorSwatch color={op.color} /> {op.label}: {c.dropped} dropped · {c.failed} failed
                </span>
              );
            })}
          </div>
        </Panel>
      </div>
    </LoadState>
  );
};

export default HistoricVoicePage;
