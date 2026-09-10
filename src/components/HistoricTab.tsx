import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Database, History, Loader2, Phone, PhoneCall, TrendingDown, TrendingUp, Video, Wifi } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchHistoricCollections,
  fetchHistoricData,
  fetchHistoricScorecard,
  fetchHistoricTrend,
  fetchHistoricVideo,
  fetchHistoricVoice,
  fetchHistoricVoiceGsm,
  type HistoricBestOperator,
  type HistoricDataRow,
  type HistoricScoreRow,
  type HistoricTrendOperatorRow,
  type HistoricTrendScope,
  type HistoricVideoRow,
  type HistoricVoiceGsmRow,
  type HistoricVoiceRow,
} from "@/lib/api";
import { AXIS_STYLE, DEFAULTS, GRID_STYLE, LEGEND_WRAPPER_STYLE } from "@/lib/chartStyles";

/**
 * Historic tab: read-only KPI snapshot από το BI data warehouse (BI_VOICE/BI_DATA),
 * ΕΝΑ campaign (CollectionName) τη φορά — βλ. backend/routers/historic.py +
 * src/components/BI_DW_SYSTEM_PROMPT.md. Ίδιο visual idiom με το SummaryTab
 * (operator-column KPI tables, "best" badge, OperatorSwatch), αλλά αυτόνομο
 * component: το warehouse έχει τελείως άλλο σχήμα/dataset από το live swissqual-srvsa
 * που τροφοδοτεί το Summary/All Calls (βλ. σχόλιο στο api.ts), οπότε δεν έχει νόημα να
 * μοιράζεται state/queries μαζί τους.
 */

// Ίδια χρώματα/σειρά operator με resolveOperator (src/lib/attachmentC.ts) — κρατάει την
// ταυτότητα κάθε operator σταθερή σε όλη την εφαρμογή. Εξαίρεση: το NOVA εδώ είναι πιο ανοιχτό
// (#6B7280 αντί για το #111318 του resolveOperator) γιατί εδώ τρέχει σαν stroke/fill σε
// line/bar charts πάνω στο σκούρο --card — το σκέτο μαύρο εξαφανίζεται στο recharts SVG χωρίς
// το λεπτό φωτεινό περίγραμμα που παίρνει το OperatorSwatch (ring) ή τα υπόλοιπα swatches/bars
// της εφαρμογής (βλ. σχόλιο στο attachmentC.ts). Επαληθεύτηκε contrast >=3:1 έναντι του
// --card (#15181E) με το dataviz palette validator.
const OPERATORS = [
  { key: "COSMOTE", label: "COSMOTE", color: "#3ab54a" },
  { key: "VODAFONE", label: "VODAFONE", color: "#e60000" },
  { key: "NOVA", label: "NOVA", color: "#6B7280" },
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

/** GSM voice (Mobile-to-Fixed) — ίδιο idiom με voiceKpiRows παραπάνω, χωρίς VoLTE% (μόνο
 * FREE/M→M axis) και με avgCallSetupTime αντ' αυτού. Βλ. HistoricVoiceGsmRow στο api.ts. */
const voiceGsmKpiRows: Row<HistoricVoiceGsmRow>[] = [
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
    label: "Avg Call Setup Time",
    higherIsBetter: false,
    value: (r) => r.avgCallSetupTime,
    format: (r) => fmtNum(r.avgCallSetupTime, 2),
  },
  {
    label: "Call Attempts",
    higherIsBetter: null,
    value: (r) => r.attempts,
    format: (r) => fmtCount(r.attempts),
  },
];

/** YouTube/video — §04 "Data — Latency, DNS, video, interactivity" + σελίδα DATA-VIDEO (§06).
 * freezingPct: χαμηλότερο = καλύτερο (λιγότερο freezing). */
const videoKpiRows: Row<HistoricVideoRow>[] = [
  {
    label: "Success Rate (%)",
    emphasis: true,
    higherIsBetter: true,
    value: (r) => r.successRate,
    format: (r) => fmtPct(r.successRate),
  },
  {
    label: "Freezing (%)",
    emphasis: true,
    higherIsBetter: false,
    value: (r) => r.freezingPct,
    format: (r) => fmtPct(r.freezingPct),
  },
  {
    label: "Avg VMOS",
    emphasis: true,
    higherIsBetter: true,
    value: (r) => r.avgVmos,
    format: (r) => fmtNum(r.avgVmos, 2),
  },
  {
    label: "Test Attempts",
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

/* ────────────────────────── Collection picker (3 cascading selects: Area / Collection Name / Scope) ────────────────────────── */

/** CollectionName naming convention: `<AREA>_..._<SCOPE>` (π.χ. "ATH_MOTORWAYS_2025H2_NATIONAL").
 * Σπάει το όνομα σε area (πριν το πρώτο underscore) / middle / scope (μετά το τελευταίο
 * underscore) για πιο ευανάγνωστο badge display. null όταν δεν υπάρχει underscore καν. */
interface ParsedCollectionName {
  area: string;
  middle: string;
  scope: string;
}

const splitCollectionName = (name: string): ParsedCollectionName | null => {
  const first = name.indexOf("_");
  const last = name.lastIndexOf("_");
  if (first === -1) return null;
  return { area: name.slice(0, first), middle: name.slice(first + 1, last), scope: name.slice(last + 1) };
};

/** Ένα από τα 3 dropdown κουμπιά (Area / Collection Name / Scope) — ίδιο searchable-list
 * idiom με το παλιό ενιαίο picker, αλλά πιο στενό και με δικό του label/placeholder. */
const PartSelect = ({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  widthClass = "w-48",
}: {
  label: string;
  placeholder: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  widthClass?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return source.slice(0, 300);
  }, [options, search]);

  const isOpen = open && !disabled;

  return (
    <div className="relative">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className={`mt-1 flex ${widthClass} items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-lg border border-border bg-popover p-3 text-left shadow-lg">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
              {filtered.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">No matches.</p>}
              {filtered.map((opt) => (
                <button
                  type="button"
                  key={opt}
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50 ${
                    opt === value ? "bg-primary/10 font-semibold text-primary" : "text-foreground"
                  }`}
                >
                  {opt || "(none)"}
                </button>
              ))}
              {options.length > filtered.length && filtered.length === 300 && (
                <p className="px-1 pt-1 text-[10px] text-muted-foreground">
                  Showing first 300 of {options.length.toLocaleString("en-US")} — refine your search.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/** 3 cascading κουμπιά (Area → Collection Name → Scope) αντί για ένα ενιαίο combobox με
 * ολόκληρο το CollectionName — βλ. splitCollectionName. Κάθε επόμενο φιλτράρεται από τα
 * προηγούμενα· μόλις διαλεχτούν και τα 3, βρίσκει το ακριβές CollectionName στο `collections`
 * και το προωθεί με onChange. Αλλαγή σε Area/Collection Name καθαρίζει ό,τι είναι μετά από
 * αυτό και ξανακαλεί onChange("") μέχρι να ξανακλείσει το triplet.
 * Το state (area/middle/scope) μένει τοπικό εδώ και ΔΕΝ συγχρονίζεται πίσω από το `value` —
 * το `value` χρησιμοποιείται μόνο για το confirmation label στο τέλος, γιατί ο μόνος
 * "writer" του `selectedCollection` στο HistoricTab είναι ακριβώς αυτό το component. */
const CollectionPickerGroup = ({
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
  const parsed = useMemo(
    () =>
      collections
        .map((name) => ({ name, parts: splitCollectionName(name) }))
        .filter((c): c is { name: string; parts: ParsedCollectionName } => c.parts !== null),
    [collections]
  );

  const [area, setArea] = useState("");
  const [middle, setMiddle] = useState("");
  const [scope, setScope] = useState("");

  const areas = useMemo(() => Array.from(new Set(parsed.map((c) => c.parts.area))).sort(), [parsed]);

  const middles = useMemo(
    () =>
      area ? Array.from(new Set(parsed.filter((c) => c.parts.area === area).map((c) => c.parts.middle))).sort() : [],
    [parsed, area]
  );

  const scopes = useMemo(
    () =>
      area && middle
        ? Array.from(
            new Set(parsed.filter((c) => c.parts.area === area && c.parts.middle === middle).map((c) => c.parts.scope)),
          ).sort()
        : [],
    [parsed, area, middle],
  );

  const handleArea = (next: string) => {
    setArea(next);
    setMiddle("");
    setScope("");
    onChange("");
  };

  const handleMiddle = (next: string) => {
    setMiddle(next);
    setScope("");
    onChange("");
  };

  const handleScope = (next: string) => {
    setScope(next);
    const match = parsed.find((c) => c.parts.area === area && c.parts.middle === middle && c.parts.scope === next);
    onChange(match?.name ?? "");
  };

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3">
        <PartSelect
          label="Area"
          placeholder={loading ? "Loading…" : "Select area"}
          options={areas}
          value={area}
          onChange={handleArea}
          disabled={loading || areas.length === 0}
          widthClass="w-40"
        />
        <PartSelect
          label="Collection Name"
          placeholder="Select collection"
          options={middles}
          value={middle}
          onChange={handleMiddle}
          disabled={!area}
          widthClass="w-56"
        />
        <PartSelect
          label="Scope"
          placeholder="Select scope"
          options={scopes}
          value={scope}
          onChange={handleScope}
          disabled={!middle}
          widthClass="w-40"
        />
      </div>
      {value && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Selected: <span className="font-mono text-foreground/80">{value}</span>
        </p>
      )}
    </div>
  );
};

/* ────────────────────────── Trend across campaigns (Scope χρονοσειρά) ──────────────────────────
 * SQL/Python ισοδύναμο του "Ποιότητα δεδομένων" + "Δ vs προηγούμενο scope" measure folder που
 * προστέθηκε στο μοντέλο στις 5 Σεπ 2026 (§09 του blueprint) — μία γραμμή ανά Scope (όχι ανά
 * CollectionName), coverage counts + Δ vs το προηγούμενο ΔΙΑΘΕΣΙΜΟ scope ανά operator. Ανεξάρτητο
 * από τον campaign picker παρακάτω· φορτώνει μία φορά, δείχνει την εικόνα πριν διαλέξεις ένα
 * συγκεκριμένο collection. */

interface TrendMetricSpec {
  key: string;
  label: string;
  value: (row: HistoricTrendOperatorRow) => number | null;
  delta: (row: HistoricTrendOperatorRow) => number | null;
  format: (value: number) => string;
  higherIsBetter: boolean;
}

const TREND_METRICS: TrendMetricSpec[] = [
  {
    key: "cssr",
    label: "Voice Success Rate (%)",
    value: (r) => r.cssr,
    delta: (r) => r.deltaCssr,
    format: (v) => fmtPct(v),
    higherIsBetter: true,
  },
  {
    key: "totalScore",
    label: "Total Score",
    value: (r) => r.totalScore,
    delta: (r) => r.deltaTotalScore,
    format: (v) => fmtNum(v, 0),
    higherIsBetter: true,
  },
  {
    key: "avgThrpDlMbps",
    label: "Avg Throughput DL (Mbps)",
    value: (r) => r.avgThrpDlMbps,
    delta: (r) => r.deltaAvgThrpDlMbps,
    format: (v) => fmtNum(v, 1),
    higherIsBetter: true,
  },
];

/** ▲/▼ badge δίπλα στο πιο πρόσφατο scope κάθε γραφήματος — πράσινο όταν η μεταβολή πάει προς τη
 * σωστή κατεύθυνση για το συγκεκριμένο metric (π.χ. +success rate καλό), κόκκινο αλλιώς. Τίποτα
 * όταν δεν υπάρχει προηγούμενο διαθέσιμο scope για σύγκριση (π.χ. το πρώτο scope της σειράς). */
const TrendDeltaBadge = ({
  delta,
  higherIsBetter,
  format,
}: {
  delta: number | null;
  higherIsBetter: boolean;
  format: (value: number) => string;
}) => {
  if (delta == null || Math.abs(delta) < 1e-9) return null;
  const isGood = higherIsBetter ? delta > 0 : delta < 0;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${isGood ? "text-emerald-500" : "text-red-500"}`}>
      <Icon className="h-3 w-3" />
      {delta > 0 ? "+" : "−"}
      {format(Math.abs(delta))}
    </span>
  );
};

/** Ένα line chart ανά metric, X = Scope (μόνο τα χρονολογικά, βλ. §09 ScopeRank idiom — τα
 * ορφανά/κενά scopes δεν έχουν θέση σε άξονα χρόνου) — ίδιο σχήμα με τις σελίδες "Comparison
 * Voice/Data/GRADES" (24-36) του blueprint: γραμμή ανά operator πάνω σε χρονοσειρά Scope. Reuse
 * του υπάρχοντος chartStyles.ts (AXIS_STYLE/GRID_STYLE/LEGEND_WRAPPER_STYLE/DEFAULTS) ώστε να
 * μοιάζει με τα υπόλοιπα charts της εφαρμογής (SummaryTab/ResultCharts/BenchmarkCharts). */
const TrendLineChart = ({
  metric,
  scopes,
  operatorKeys,
}: {
  metric: TrendMetricSpec;
  scopes: HistoricTrendScope[];
  operatorKeys: (typeof OPERATORS)[number][];
}) => {
  const chronological = useMemo(() => scopes.filter((s) => /^\d{4}H[12]$/.test(s.scope)), [scopes]);

  const data = useMemo(
    () =>
      chronological.map((s) => {
        const row: Record<string, string | number | null> = { scope: s.scope };
        operatorKeys.forEach((op) => {
          const opRow = s.operators.find((o) => o.operator === op.key);
          row[op.key] = opRow ? metric.value(opRow) : null;
        });
        return row;
      }),
    [chronological, metric, operatorKeys],
  );

  const latest = chronological[chronological.length - 1];

  const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { color: string; value: number | null }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-mono font-semibold text-foreground">{label}</p>
        {payload.map((entry, i) => {
          const op = operatorKeys[i];
          return (
            <p key={op?.key ?? i} className="flex items-center gap-1.5 font-mono" style={{ color: entry.color }}>
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
              {op?.label}: {entry.value == null ? "—" : metric.format(entry.value)}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-bold text-foreground">{metric.label}</h3>
        {latest && (
          <div className="flex flex-wrap items-center gap-2.5">
            {operatorKeys.map((op) => {
              const row = latest.operators.find((o) => o.operator === op.key);
              const delta = row ? metric.delta(row) : null;
              return (
                <span key={op.key} className="inline-flex items-center gap-1">
                  <OperatorSwatch color={op.color} />
                  <TrendDeltaBadge delta={delta} higherIsBetter={metric.higherIsBetter} format={metric.format} />
                </span>
              );
            })}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis dataKey="scope" {...AXIS_STYLE} />
          <YAxis {...AXIS_STYLE} width={52} tickFormatter={(v: number) => metric.format(v)} />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} formatter={(value: string) => <span className="text-foreground">{value}</span>} />
          {operatorKeys.map((op) => (
            <Line
              key={op.key}
              type="monotone"
              dataKey={op.key}
              name={op.label}
              stroke={op.color}
              strokeWidth={DEFAULTS.strokeWidth}
              dot={false}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const HistoricTrendSection = () => {
  const [scopes, setScopes] = useState<HistoricTrendScope[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchHistoricTrend()
      .then((data) => {
        if (!cancelled) setScopes(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load trend");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const operatorKeys = useMemo(() => {
    const seen = new Set<string>();
    scopes.forEach((s) => s.operators.forEach((o) => seen.add(o.operator)));
    return OPERATORS.filter((op) => seen.has(op.key));
  }, [scopes]);

  // Τα ορφανά/κενά scopes μπαίνουν στο τέλος από το backend (βλ. ordered_scopes στο
  // historic.py) — χρειάζεται ρητό φιλτράρισμα εδώ, αλλιώς το "latest" badge δείχνει
  // ένα ορφανό αντί για το πραγματικό πιο πρόσφατο εξάμηνο.
  const chronologicalScopes = useMemo(() => scopes.filter((s) => /^\d{4}H[12]$/.test(s.scope)), [scopes]);
  const latestScope = chronologicalScopes[chronologicalScopes.length - 1];
  const orphanCount = scopes.length - chronologicalScopes.length;

  if (loading && scopes.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading trend…
      </div>
    );
  }

  if (error && scopes.length === 0) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        Failed to load trend: {error}
      </div>
    );
  }

  if (scopes.length === 0 || operatorKeys.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border-2 border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-border bg-muted/30 px-4 py-3.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
          <TrendingUp className="h-5 w-5 text-primary" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-foreground">Trend across campaigns</h2>
          <p className="text-[11px] text-muted-foreground">
            Pooled ανά Scope · {scopes.length.toLocaleString("en-US")} semi-annual campaigns
            {orphanCount > 0 ? ` (${orphanCount} χωρίς αναγνωρίσιμο scope — εξαιρέθηκαν από τα γραφήματα)` : ""} · Δ = vs προηγούμενο
            διαθέσιμο scope
          </p>
        </div>
        {latestScope && (
          <div className="ml-auto flex flex-wrap gap-3 rounded-lg border border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>
              <b className="text-foreground">{fmtCount(latestScope.collections)}</b> collections
            </span>
            <span>
              <b className="text-foreground">{fmtCount(latestScope.voiceCollections)}</b> voice
            </span>
            <span>
              <b className="text-foreground">{fmtCount(latestScope.capacityCollections)}</b> capacity
            </span>
            <span className="text-foreground/70">(latest: {latestScope.scope})</span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-3">
        {TREND_METRICS.map((metric) => (
          <TrendLineChart key={metric.key} metric={metric} scopes={scopes} operatorKeys={operatorKeys} />
        ))}
      </div>
    </section>
  );
};

/* ────────────────────────── Scorecard grouped bar (GRADES page, §06) ──────────────────────────
 * Η σελίδα "GRADES" του blueprint (πίνακας σελίδων, #02) είναι το ίδιο το προϊόν του report —
 * gauges/column charts πάνω σε Visuals Total/Voice/Data Score ανά operator. Grouped bar εδώ αντί
 * για 3 gauges (βλ. §07 stack: ECharts καλύπτει bar/column εγγενώς, gauges όχι πάντα 1:1) — ίδιο
 * μήνυμα, απλούστερο component, reuse του recharts που ήδη υπάρχει στο project. */
const SCORE_BAR_METRICS: { key: keyof HistoricScoreRow; label: string }[] = [
  { key: "totalScore", label: "Total Score" },
  { key: "totalVoice", label: "Voice Score" },
  { key: "totalData", label: "Data Score" },
];

const ScorecardBarChart = ({ scores }: { scores: HistoricScoreRow[] }) => {
  const byOperator = useMemo(() => new Map(scores.map((row) => [row.operator, row])), [scores]);
  const operatorKeys = OPERATORS.filter((op) => byOperator.has(op.key));

  if (operatorKeys.length === 0) return null;

  const data = SCORE_BAR_METRICS.map(({ key, label }) => {
    const row: Record<string, string | number | null> = { metric: label };
    operatorKeys.forEach((op) => {
      const score = byOperator.get(op.key);
      row[op.key] = score ? (score[key] as number | null) : null;
    });
    return row;
  });

  const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { color: string; value: number | null }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-semibold text-foreground">{label}</p>
        {payload.map((entry, i) => {
          const op = operatorKeys[i];
          return (
            <p key={op?.key ?? i} className="flex items-center gap-1.5 font-mono" style={{ color: entry.color }}>
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
              {op?.label}: {entry.value == null ? "—" : fmtNum(entry.value, 0)}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis dataKey="metric" {...AXIS_STYLE} />
          <YAxis {...AXIS_STYLE} width={44} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
          <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} formatter={(value: string) => <span className="text-foreground">{value}</span>} />
          {operatorKeys.map((op) => (
            <Bar key={op.key} dataKey={op.key} name={op.label} fill={op.color} fillOpacity={DEFAULTS.barFillOpacity} radius={[3, 3, 0, 0]} maxBarSize={48} />
          ))}
        </BarChart>
      </ResponsiveContainer>
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
  const [voiceGsmRows, setVoiceGsmRows] = useState<HistoricVoiceGsmRow[]>([]);
  const [videoRows, setVideoRows] = useState<HistoricVideoRow[]>([]);
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
      setVoiceGsmRows([]);
      setVideoRows([]);
      setDataRows([]);
      return;
    }

    let cancelled = false;
    setSnapshotLoading(true);
    setSnapshotError(null);

    Promise.allSettled([
      fetchHistoricScorecard(selectedCollection),
      fetchHistoricVoice(selectedCollection),
      fetchHistoricVoiceGsm(selectedCollection),
      fetchHistoricVideo(selectedCollection),
      fetchHistoricData(selectedCollection),
    ]).then(([scorecardResult, voiceResult, voiceGsmResult, videoResult, dataResult]) => {
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

      if (voiceGsmResult.status === "fulfilled") {
        setVoiceGsmRows(voiceGsmResult.value);
      } else {
        setVoiceGsmRows([]);
      }

      if (videoResult.status === "fulfilled") {
        setVideoRows(videoResult.value);
      } else {
        setVideoRows([]);
      }

      if (dataResult.status === "fulfilled") {
        setDataRows(dataResult.value);
      } else {
        setDataRows([]);
      }

      const allRejected = [scorecardResult, voiceResult, voiceGsmResult, videoResult, dataResult].every(
        (r) => r.status === "rejected",
      );
      if (allRejected) {
        const reason = scorecardResult.status === "rejected" ? scorecardResult.reason : undefined;
        setSnapshotError(reason instanceof Error ? reason.message : "Failed to load campaign data");
      }

      setSnapshotLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedCollection]);

  const hasData =
    scores.length > 0 || voiceRows.length > 0 || voiceGsmRows.length > 0 || videoRows.length > 0 || dataRows.length > 0;

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
            <CollectionPickerGroup
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

      <HistoricTrendSection />

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
          {scores.length > 0 && <ScorecardBarChart scores={scores} />}
          <HistoricKpiTable
            title="Scorecard"
            icon={Database}
            rows={scorecardRows}
            data={scores}
            winnerBadge={winnerFor(winners, "TOTAL")}
          />
          <HistoricKpiTable title="Voice KPIs — Free (M→M)" icon={Phone} rows={voiceKpiRows} data={voiceRows} />
          <HistoricKpiTable title="Voice KPIs — GSM (M→F)" icon={PhoneCall} rows={voiceGsmKpiRows} data={voiceGsmRows} />
          <HistoricKpiTable title="Data KPIs" icon={Wifi} rows={dataKpiRows} data={dataRows} />
          <HistoricKpiTable title="Video (YouTube) KPIs" icon={Video} rows={videoKpiRows} data={videoRows} />
        </>
      )}
    </div>
  );
};

export default HistoricTab;
