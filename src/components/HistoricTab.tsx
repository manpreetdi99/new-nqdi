import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Database, History, Loader2, Phone, Wifi } from "lucide-react";

import {
  fetchHistoricCollections,
  fetchHistoricData,
  fetchHistoricScorecard,
  fetchHistoricVoice,
  type HistoricBestOperator,
  type HistoricDataRow,
  type HistoricScoreRow,
  type HistoricVoiceRow,
} from "@/lib/api";

/**
 * Historic tab: read-only KPI snapshot από το BI data warehouse (BI_VOICE/BI_DATA),
 * ΕΝΑ campaign (CollectionName) τη φορά — βλ. backend/routers/historic.py +
 * src/components/BI_DW_SYSTEM_PROMPT.md. Ίδιο visual idiom με το SummaryTab
 * (operator-column KPI tables, "best" badge, OperatorSwatch), αλλά αυτόνομο
 * component: το warehouse έχει τελείως άλλο σχήμα/dataset από το live swissqual-srvsa
 * που τροφοδοτεί το Summary/All Calls (βλ. σχόλιο στο api.ts), οπότε δεν έχει νόημα να
 * μοιράζεται state/queries μαζί τους.
 */

// Ίδια χρώματα/σειρά operator με resolveOperator (src/lib/attachmentC.ts) — κρατάει
// την ταυτότητα κάθε operator σταθερή σε όλη την εφαρμογή.
const OPERATORS = [
  { key: "COSMOTE", label: "COSMOTE", color: "#3ab54a" },
  { key: "VODAFONE", label: "VODAFONE", color: "#e60000" },
  { key: "NOVA", label: "NOVA", color: "#111318" },
] as const;

const OperatorSwatch = ({ color }: { color: string }) => (
  <span
    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-white/25"
    style={{ backgroundColor: color }}
  />
);

const fmtNum = (value: number | null | undefined, decimals = 2): string =>
  value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const fmtPct = (value: number | null | undefined, decimals = 1): string =>
  value == null ? "—" : `${value.toFixed(decimals)}%`;

const fmtCount = (value: number | null | undefined): string => (value == null ? "—" : value.toLocaleString("en-US"));

/* ────────────────────────── Γενικός KPI πίνακας (operator columns) ────────────────────────── */

interface Row<T> {
  label: string;
  emphasis?: boolean;
  /** null: δεν μπαίνει "best" badge σε αυτή τη γραμμή (π.χ. counts). */
  higherIsBetter: boolean | null;
  format: (row: T) => string;
  value: (row: T) => number | null;
}

function HistoricKpiTable<T extends { operator: string }>({
  title,
  icon: Icon,
  rows,
  data,
  winnerBadge,
}: {
  title: string;
  icon: typeof Database;
  rows: Row<T>[];
  data: T[];
  /** π.χ. Total Score winner από BI_BEST_OP_SCORE — δείχνεται δίπλα στο τίτλο. */
  winnerBadge?: { operator: string; score: number | null } | null;
}) {
  const byOperator = useMemo(() => new Map(data.map((row) => [row.operator, row])), [data]);
  const columns = OPERATORS.filter((op) => byOperator.has(op.key));

  if (columns.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border-2 border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-border bg-muted/30 px-4 py-3.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
          <Icon className="h-5 w-5 text-primary" />
        </span>
        <h2 className="min-w-0 text-lg font-bold tracking-tight text-foreground">{title}</h2>
        {winnerBadge && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-500">
            🏆 {winnerBadge.operator} — {fmtNum(winnerBadge.score, 0)}
          </span>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 260 + columns.length * 190 }}>
          <thead>
            <tr className="border-b-2 border-border bg-muted">
              <th className="sticky left-0 z-10 min-w-[15rem] bg-muted px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-foreground/80">
                KPI
              </th>
              {columns.map((op) => (
                <th key={op.key} className="px-4 py-3 text-right font-semibold">
                  <span className="flex items-center justify-end gap-1.5">
                    <OperatorSwatch color={op.color} />
                    <span className="text-xs font-bold tracking-wide text-foreground">{op.label}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const values = columns.map((op) => row.value(byOperator.get(op.key) as T));
              const numeric = values.filter((v): v is number => v != null);
              const bestValue =
                row.higherIsBetter != null && numeric.length > 1 && new Set(numeric).size > 1
                  ? row.higherIsBetter
                    ? Math.max(...numeric)
                    : Math.min(...numeric)
                  : null;

              return (
                <tr key={row.label} className="border-b border-border/70 last:border-b-0 hover:bg-muted/30">
                  <td className="sticky left-0 z-10 min-w-[15rem] bg-card px-4 py-2.5 align-middle">
                    <div className={row.emphasis ? "font-semibold text-foreground" : "font-medium text-foreground/80"}>
                      {row.label}
                    </div>
                  </td>
                  {columns.map((op, index) => {
                    const record = byOperator.get(op.key);
                    const value = values[index];
                    const isBest = bestValue != null && value === bestValue;
                    return (
                      <td key={op.key} className="px-4 py-2 align-middle">
                        <div className="flex items-center justify-end gap-2.5">
                          <span
                            className="w-7 shrink-0 text-right text-[9px] uppercase tracking-wider text-muted-foreground"
                            title={isBest ? "Best value in this row" : undefined}
                          >
                            {isBest ? "best" : ""}
                          </span>
                          <span
                            className={`font-mono tabular-nums ${row.emphasis ? "text-sm font-bold text-foreground" : "text-[13px] font-medium text-foreground/90"}`}
                          >
                            {record ? row.format(record) : "—"}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ────────────────────────── Row specs ────────────────────────── */

const scorecardRows: Row<HistoricScoreRow>[] = [
  { label: "Total Score", emphasis: true, higherIsBetter: true, value: (r) => r.totalScore, format: (r) => fmtNum(r.totalScore, 0) },
  { label: "Voice Score", emphasis: true, higherIsBetter: true, value: (r) => r.totalVoice, format: (r) => fmtNum(r.totalVoice, 0) },
  { label: "Voice Score — GSM table", higherIsBetter: true, value: (r) => r.voiceScoreGsm, format: (r) => fmtNum(r.voiceScoreGsm, 0) },
  { label: "Voice Score — FREE table", higherIsBetter: true, value: (r) => r.voiceScoreFree, format: (r) => fmtNum(r.voiceScoreFree, 0) },
  { label: "Data Score", emphasis: true, higherIsBetter: true, value: (r) => r.totalData, format: (r) => fmtNum(r.totalData, 0) },
  { label: "Score — Browsing", higherIsBetter: true, value: (r) => r.scoreBrowsing, format: (r) => fmtNum(r.scoreBrowsing, 0) },
  { label: "Score — HTTP", higherIsBetter: true, value: (r) => r.scoreHttp, format: (r) => fmtNum(r.scoreHttp, 0) },
  { label: "Score — Capacity", higherIsBetter: true, value: (r) => r.scoreCap, format: (r) => fmtNum(r.scoreCap, 0) },
  { label: "Score — Ping", higherIsBetter: true, value: (r) => r.scorePing, format: (r) => fmtNum(r.scorePing, 0) },
  { label: "Score — YouTube", higherIsBetter: true, value: (r) => r.scoreYt, format: (r) => fmtNum(r.scoreYt, 0) },
];

const voiceKpiRows: Row<HistoricVoiceRow>[] = [
  {
    label: "Call Success Rate (%)",
    emphasis: true,
    higherIsBetter: true,
    value: (r) => r.cssr,
    format: (r) => fmtPct(r.cssr),
  },
  {
    label: "Dropped Call Rate (%)",
    emphasis: true,
    higherIsBetter: false,
    value: (r) => r.dcr,
    format: (r) => fmtPct(r.dcr),
  },
  {
    label: "Call Completion Rate (%)",
    higherIsBetter: true,
    value: (r) => r.completionRate,
    format: (r) => fmtPct(r.completionRate),
  },
  {
    label: "POLQA avg (Speech quality)",
    emphasis: true,
    higherIsBetter: true,
    value: (r) => r.mos,
    format: (r) => fmtNum(r.mos, 2),
  },
  {
    label: "VoLTE Penetration (%)",
    higherIsBetter: true,
    value: (r) => r.voltePct,
    format: (r) => fmtPct(r.voltePct),
  },
  {
    label: "Call Attempts",
    higherIsBetter: null,
    value: (r) => r.attempts,
    format: (r) => fmtCount(r.attempts),
  },
];

const dataKpiRows: Row<HistoricDataRow>[] = [
  {
    label: "Avg Throughput DL (Mbps)",
    emphasis: true,
    higherIsBetter: true,
    value: (r) => r.avgThrpDlMbps,
    format: (r) => fmtNum(r.avgThrpDlMbps, 2),
  },
  {
    label: "Avg Throughput UL (Mbps)",
    emphasis: true,
    higherIsBetter: true,
    value: (r) => r.avgThrpUlMbps,
    format: (r) => fmtNum(r.avgThrpUlMbps, 2),
  },
  {
    label: "Capacity Task Success Rate (%)",
    higherIsBetter: true,
    value: (r) => r.taskSuccessRate,
    format: (r) => fmtPct(r.taskSuccessRate),
  },
  {
    label: "Total Capacity Tests",
    higherIsBetter: null,
    value: (r) => r.totalTests,
    format: (r) => fmtCount(r.totalTests),
  },
  {
    label: "Avg Ping RTT (ms)",
    emphasis: true,
    higherIsBetter: false,
    value: (r) => r.avgRttMs,
    format: (r) => fmtNum(r.avgRttMs, 1),
  },
  {
    label: "Ping Attempts / Successful",
    higherIsBetter: null,
    value: (r) => r.totalPingAttempts,
    format: (r) => `${fmtCount(r.totalPingAttempts)} / ${fmtCount(r.successPingTests)}`,
  },
];

const winnerFor = (winners: HistoricBestOperator[], category: string): HistoricBestOperator | null =>
  winners.find((w) => w.category === category) ?? null;

/* ────────────────────────── Collection picker (single-select, searchable) ────────────────────────── */

const CollectionPicker = ({
  collections,
  loading,
  value,
  onChange,
}: {
  collections: string[];
  loading: boolean;
  value: string;
  onChange: (name: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = q ? collections.filter((c) => c.toLowerCase().includes(q)) : collections;
    return source.slice(0, 300);
  }, [collections, search]);

  return (
    <div className="relative">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Campaign (CollectionName)</div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="mt-1 flex w-96 cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <span className="truncate">
          {loading ? "Loading campaigns…" : value || "Select a campaign"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 top-full z-30 mt-1.5 w-[28rem] -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-left shadow-lg">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search e.g. ATH, MOTORWAYS, 2025H2…"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="mt-2 max-h-80 space-y-0.5 overflow-y-auto">
              {filtered.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">No matching campaigns.</p>}
              {filtered.map((name) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50 ${
                    name === value ? "bg-primary/10 font-semibold text-primary" : "text-foreground"
                  }`}
                >
                  {name}
                </button>
              ))}
              {collections.length > filtered.length && filtered.length === 300 && (
                <p className="px-1 pt-1 text-[10px] text-muted-foreground">
                  Showing first 300 of {collections.length.toLocaleString("en-US")} — refine your search.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/* ────────────────────────── Historic tab ────────────────────────── */

const HistoricTab = () => {
  const [collections, setCollections] = useState<string[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState("");

  const [scores, setScores] = useState<HistoricScoreRow[]>([]);
  const [winners, setWinners] = useState<HistoricBestOperator[]>([]);
  const [voiceRows, setVoiceRows] = useState<HistoricVoiceRow[]>([]);
  const [dataRows, setDataRows] = useState<HistoricDataRow[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCollectionsLoading(true);
    setCollectionsError(null);

    fetchHistoricCollections()
      .then((names) => {
        if (cancelled) return;
        setCollections(names);
      })
      .catch((err) => {
        if (cancelled) return;
        setCollectionsError(err instanceof Error ? err.message : "Failed to load campaigns");
      })
      .finally(() => {
        if (!cancelled) setCollectionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedCollection) {
      setScores([]);
      setWinners([]);
      setVoiceRows([]);
      setDataRows([]);
      return;
    }

    let cancelled = false;
    setSnapshotLoading(true);
    setSnapshotError(null);

    Promise.allSettled([
      fetchHistoricScorecard(selectedCollection),
      fetchHistoricVoice(selectedCollection),
      fetchHistoricData(selectedCollection),
    ]).then(([scorecardResult, voiceResult, dataResult]) => {
      if (cancelled) return;

      if (scorecardResult.status === "fulfilled") {
        setScores(scorecardResult.value.scores);
        setWinners(scorecardResult.value.winners);
      } else {
        setScores([]);
        setWinners([]);
      }

      if (voiceResult.status === "fulfilled") {
        setVoiceRows(voiceResult.value);
      } else {
        setVoiceRows([]);
      }

      if (dataResult.status === "fulfilled") {
        setDataRows(dataResult.value);
      } else {
        setDataRows([]);
      }

      if (scorecardResult.status === "rejected" && voiceResult.status === "rejected" && dataResult.status === "rejected") {
        const reason = scorecardResult.reason;
        setSnapshotError(reason instanceof Error ? reason.message : "Failed to load campaign data");
      }

      setSnapshotLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedCollection]);

  const hasData = scores.length > 0 || voiceRows.length > 0 || dataRows.length > 0;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start gap-6 rounded-t-xl bg-gradient-to-r from-primary/[0.07] via-accent/[0.04] to-transparent px-5 py-5">
          <div className="min-w-[260px] flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">BI Data Warehouse</div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground">Historic</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Semi-annual national benchmarking campaigns (BI_VOICE / BI_DATA), 2019–σήμερα. Διάλεξε ένα campaign.
            </p>
            {collections.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {collections.length.toLocaleString("en-US")} campaigns διαθέσιμα.
              </p>
            )}
          </div>

          <div className="flex min-w-[320px] flex-1 items-center justify-center">
            <CollectionPicker
              collections={collections}
              loading={collectionsLoading}
              value={selectedCollection}
              onChange={setSelectedCollection}
            />
          </div>
        </div>
      </section>

      {collectionsError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load campaigns: {collectionsError}
        </div>
      )}

      {!selectedCollection && !collectionsError && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card py-24 text-center">
          <History className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Pick a campaign above</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Scorecard, Voice και Data KPI tables φορτώνουν αυτόματα μόλις διαλέξεις ένα CollectionName.
          </p>
        </div>
      )}

      {selectedCollection && snapshotLoading && !hasData && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card py-24 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {selectedCollection}…
        </div>
      )}

      {selectedCollection && snapshotError && !hasData && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load campaign data: {snapshotError}
        </div>
      )}

      {selectedCollection && hasData && (
        <>
          <HistoricKpiTable
            title="Scorecard"
            icon={Database}
            rows={scorecardRows}
            data={scores}
            winnerBadge={winnerFor(winners, "TOTAL")}
          />
          <HistoricKpiTable title="Voice KPIs" icon={Phone} rows={voiceKpiRows} data={voiceRows} />
          <HistoricKpiTable title="Data KPIs" icon={Wifi} rows={dataKpiRows} data={dataRows} />
        </>
      )}
    </div>
  );
};

export default HistoricTab;
