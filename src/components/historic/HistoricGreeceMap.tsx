import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Calendar, Clock, HardDriveDownload, Map as MapIcon, Route, Table2, Trophy } from "lucide-react";

import { fetchHistoricGreeceMap, type HistoricMapCollection, type HistoricPageFilters } from "@/lib/api";
import { FitToPoints, LoadState, OPERATORS, OperatorSwatch, Panel, fmtCount, fmtNum, operatorSpec, useHistoricLoad } from "./historicShared";

/**
 * [01] GREECE MAP του .pbix: χάρτης με τον νικητή (BI_BEST_OP_SCORE) κάθε collection, πλήθος
 * νικών ανά operator (η πίτα 01.4), matrix Avg TOTAL_SCORE collection × operator (01.2) και
 * τα cards περιόδου / ωρών / GB / km (01.3, 01.5–01.8). Βλ. get_historic_greece_map στο
 * backend/routers/historic_pages.py — εκεί και η απόκλιση στις συντεταγμένες (κέντρο βάρους
 * των κλήσεων αντί για GIS.xlsx).
 */

type WinCategory = "TOTAL" | "VOICE" | "DATA";

const CATEGORIES: { key: WinCategory; label: string; score: "total" | "voice" | "data" }[] = [
  { key: "TOTAL", label: "Total", score: "total" },
  { key: "VOICE", label: "Voice", score: "voice" },
  { key: "DATA", label: "Data", score: "data" },
];

const TIE_COLOR = "#e5e7eb";

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Total_Hours_Minutes του μοντέλου: ROUNDDOWN(min/60) & ":" & MOD(min, 60). */
const fmtHoursMinutes = (minutes: number | null) =>
  minutes == null ? "—" : `${Math.floor(minutes / 60).toLocaleString("en-US")}:${String(minutes % 60).padStart(2, "0")}`;

const winnerColor = (operators: string[] | undefined) => {
  if (!operators?.length) return null;
  if (operators.length > 1) return TIE_COLOR;
  return operatorSpec(operators[0])?.color ?? null;
};

const StatTile = ({ icon: Icon, label, value, sub }: { icon: typeof Clock; label: string; value: string; sub?: string }) => (
  <div className="rounded-xl border border-border bg-card px-4 py-3">
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-foreground">{value}</div>
    {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
  </div>
);

const withUnit = (value: number | null | undefined, unit: string) => (value == null ? "—" : `${fmtNum(value, 0)} ${unit}`);

const shortLabel = (c: HistoricMapCollection) => `${c.area} · ${c.collection}`;

const HistoricGreeceMap = ({ filters }: { filters: HistoricPageFilters }) => {
  const key = JSON.stringify(filters);
  const { data, loading, error } = useHistoricLoad(key, () => fetchHistoricGreeceMap(filters));
  const [category, setCategory] = useState<WinCategory>("TOTAL");
  const scoreKey = CATEGORIES.find((c) => c.key === category)!.score;

  const collections = useMemo(() => data?.collections ?? [], [data]);
  // BI_KMS_DATA_HOURS υπάρχει μόνο από το 2023H1 και μετά.
  const kmsNote = data && data.kpis.minutes == null ? "not recorded for this scope" : undefined;
  const located = collections.filter((c) => c.lat != null && c.lon != null);

  const wins = useMemo(() => {
    const counts = new Map<string, number>();
    let ties = 0;
    let decided = 0;
    collections.forEach((c) => {
      const ops = c.winners[category]?.operators;
      if (!ops?.length) return;
      decided += 1;
      if (ops.length > 1) ties += 1;
      else counts.set(ops[0], (counts.get(ops[0]) ?? 0) + 1);
    });
    return { counts, ties, decided };
  }, [collections, category]);

  return (
    <LoadState loading={loading} error={error} hasData={collections.length > 0}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile icon={MapIcon} label="Collections" value={fmtCount(collections.length)} sub={`${located.length} on the map`} />
        <StatTile
          icon={Calendar}
          label="Measurement period"
          value={`${fmtDate(data?.kpis.firstDate ?? null)}`}
          sub={`to ${fmtDate(data?.kpis.lastDate ?? null)}`}
        />
        <StatTile icon={Clock} label="Drive time (h:mm)" value={fmtHoursMinutes(data?.kpis.minutes ?? null)} sub={kmsNote} />
        <StatTile icon={HardDriveDownload} label="Data transferred" value={withUnit(data?.kpis.dataGb, "GB")} sub={kmsNote} />
        <StatTile icon={Route} label="Distance" value={withUnit(data?.kpis.kms, "km")} sub={kmsNote} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Best operator by</span>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                category === c.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title={`Best operator per collection — ${CATEGORIES.find((c) => c.key === category)!.label} score`}
          subtitle="Each point sits at the centre of the collection's test calls. Hover for the scores."
          icon={MapIcon}
          className="xl:col-span-2"
        >
          <div className="h-[520px] overflow-hidden rounded-lg">
            <MapContainer center={[38.6, 23.8]} zoom={6} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitToPoints points={located.map((c) => [c.lat!, c.lon!] as [number, number])} />
              {located.map((c) => {
                const winner = c.winners[category];
                const color = winnerColor(winner?.operators) ?? "#94a3b8";
                return (
                  <CircleMarker
                    key={c.name}
                    center={[c.lat!, c.lon!]}
                    radius={8}
                    pathOptions={{ color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 0.95 }}
                  >
                    <LeafletTooltip direction="top" offset={[0, -6]}>
                      <div className="text-xs">
                        <div className="font-semibold">{c.name}</div>
                        <div className="mt-0.5">
                          Best: <b>{winner?.operators.join(" = ") || "—"}</b>
                          {winner?.operators.length ? ` (${fmtNum(winner.score, 0)})` : ""}
                        </div>
                        {OPERATORS.filter((op) => c.scores[op.key]).map((op) => (
                          <div key={op.key} className="font-mono">
                            {op.label}: {fmtNum(c.scores[op.key][scoreKey], 0)}
                          </div>
                        ))}
                      </div>
                    </LeafletTooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
            {OPERATORS.map((op) => (
              <span key={op.key} className="flex items-center gap-1.5">
                <OperatorSwatch color={op.color} /> {op.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <OperatorSwatch color={TIE_COLOR} /> Tie
            </span>
          </div>
        </Panel>

        <Panel title="Collections won" subtitle={`${wins.decided} collections with a ${category.toLowerCase()} winner`} icon={Trophy}>
          <div className="space-y-4 py-1">
            {OPERATORS.map((op) => {
              const n = wins.counts.get(op.key) ?? 0;
              const share = wins.decided ? (100 * n) / wins.decided : 0;
              return (
                <div key={op.key}>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-foreground">
                      <OperatorSwatch color={op.color} /> {op.label}
                    </span>
                    <span className="font-mono tabular-nums text-foreground">
                      {n} <span className="text-muted-foreground">({share.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="h-3 rounded bg-muted/40">
                    <div className="h-3 rounded-r" style={{ width: `${share}%`, backgroundColor: op.color }} />
                  </div>
                </div>
              );
            })}
            {wins.ties > 0 && <p className="text-[11px] text-muted-foreground">{wins.ties} tied collection(s) not counted for any operator.</p>}
          </div>
        </Panel>
      </div>

      <Panel title="Total score by collection" subtitle="Average TOTAL_SCORE per operator (BI_SCORES_TOTAL) — best in each row marked" icon={Table2}>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-foreground/80">Collection</th>
                <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-foreground/80">Category</th>
                {OPERATORS.map((op) => (
                  <th key={op.key} className="px-3 py-2 text-right text-xs font-bold text-foreground">
                    <span className="flex items-center justify-end gap-1.5">
                      <OperatorSwatch color={op.color} /> {op.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {collections.map((c) => {
                const values = OPERATORS.map((op) => c.scores[op.key]?.total ?? null);
                const numeric = values.filter((v): v is number => v != null);
                const best = numeric.length > 1 ? Math.max(...numeric) : null;
                return (
                  <tr key={c.name} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-medium text-foreground" title={c.name}>
                      {shortLabel(c)}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{c.category}</td>
                    {values.map((v, i) => (
                      <td key={OPERATORS[i].key} className="px-3 py-1.5 text-right font-mono tabular-nums">
                        <span className={v != null && v === best ? "font-bold text-foreground" : "text-foreground/80"}>{fmtNum(v, 0)}</span>
                        {v != null && v === best && <span className="ml-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">best</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </LoadState>
  );
};

export default HistoricGreeceMap;
