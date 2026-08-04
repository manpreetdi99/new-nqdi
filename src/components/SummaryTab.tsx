import { useMemo, useState, type ReactNode } from "react";
import { Database, MapPin, Phone, Radio, Wifi } from "lucide-react";

import type { AllCallsRow, DataCallRow } from "@/lib/api";
import {
  BAD_QUALITY_MOS,
  buildDataSections,
  buildReportPeriod,
  buildVoiceStats,
  buildVoiceTable,
  collectOperators,
  EMPTY_VOICE_STATS,
  formatCount,
  formatMetric,
  formatNumber,
  formatPercent,
  LOW_QUALITY_MOS,
  resolveOperator,
  type DataTestSection,
  type DataTestStats,
  type OperatorMeta,
  type VoiceRates,
  type VoiceStats,
  type VoiceTable,
} from "@/lib/attachmentC";

interface SummaryTabProps {
  allCallsRows: AllCallsRow[];
  dataCallsRows: DataCallRow[];
  database?: string;
  collections?: string[];
}

/* ────────────────────────── Χρώματα & κατώφλια ────────────────────────── */

/**
 * Status palette (σταθερή, ποτέ δεν χρησιμοποιείται για ταυτότητα operator).
 * Τα χρώματα των operators ζουν στο attachmentC.ts και δένονται στην οντότητα.
 */
const STATUS_COLORS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

type Severity = keyof typeof STATUS_COLORS;

/** Κατώφλια A-LEVEL για τα rate KPIs — άλλαξέ τα εδώ αν αλλάξει το target. */
const rateSeverity = (value: number | null, higherIsBetter: boolean): Severity | null => {
  if (value == null) return null;
  const pct = value * 100;

  if (higherIsBetter) {
    if (pct >= 98) return "good";
    if (pct >= 95) return "warning";
    if (pct >= 90) return "serious";
    return "critical";
  }

  if (pct <= 1) return "good";
  if (pct <= 2) return "warning";
  if (pct <= 5) return "serious";
  return "critical";
};

/** Το mix των outcomes είναι κατάσταση, όχι ταυτότητα → status χρώματα. */
const OUTCOME_SEGMENTS = [
  { key: "completed", label: "Normal release", color: STATUS_COLORS.good },
  { key: "sysRelease", label: "System release", color: "#9085e9" },
  { key: "dropped", label: "Dropped", color: STATUS_COLORS.serious },
  { key: "failed", label: "Access fail", color: STATUS_COLORS.critical },
] as const;

/* ────────────────────────── Μικρά building blocks ────────────────────────── */

/** Το περίγραμμα κρατάει ορατό το μαύρο της NOVA πάνω στο dark surface. */
const OperatorSwatch = ({ color }: { color: string }) => (
  <span
    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-white/25"
    style={{ backgroundColor: color }}
  />
);

/** Meter: ένα ποσοστό απέναντι σε όριο. Το fill κουβαλάει τη σοβαρότητα. */
const RateMeter = ({ value, higherIsBetter }: { value: number | null; higherIsBetter: boolean }) => {
  const severity = rateSeverity(value, higherIsBetter);
  const color = severity ? STATUS_COLORS[severity] : "hsl(var(--muted-foreground))";
  const width = value == null ? 0 : Math.max(Math.min(value, 1), 0) * 100;

  return (
    <div className="h-1 w-full rounded-full" style={{ backgroundColor: `${color}26` }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${width}%`, backgroundColor: color }} />
    </div>
  );
};

/** Μέγεθος σε σχέση με το max της γραμμής — χρώμα του operator (ταυτότητα). */
const MagnitudeBar = ({ value, max, color }: { value: number; max: number; color: string }) => (
  <div className="h-1 w-full rounded-full bg-foreground/[0.08]">
    <div
      className="h-full rounded-full ring-1 ring-inset ring-white/20 transition-[width] duration-500"
      style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, backgroundColor: color }}
    />
  </div>
);

/** Part-to-whole: πώς έκλεισαν οι κλήσεις. 2px κενά αντί για περιγράμματα. */
const OutcomeMixBar = ({ stats }: { stats: VoiceStats }) => {
  if (stats.attempts === 0) return <span className="text-muted-foreground/40">—</span>;

  return (
    <div className="flex h-2 w-full gap-[2px]">
      {OUTCOME_SEGMENTS.map((segment) => {
        const count = stats[segment.key];
        if (count === 0) return null;
        const share = count / stats.attempts;
        return (
          <div
            key={segment.key}
            className="first:rounded-l-full last:rounded-r-full"
            style={{ width: `${share * 100}%`, backgroundColor: segment.color }}
            title={`${segment.label}: ${formatCount(count)} (${formatPercent(share, 1)})`}
          />
        );
      })}
    </div>
  );
};

const MetaChip = ({ icon: Icon, label, value }: { icon?: typeof Database; label: string; value: string }) => (
  <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/40 px-2.5 py-1.5">
    {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    <span className="text-xs font-medium text-foreground">{value}</span>
  </div>
);

/* ────────────────────────── Γραμμές των KPI πινάκων ────────────────────────── */

/** `alt`: η ίδια μέτρηση στο άλλο σενάριο (με ↔ χωρίς system releases). */
type Cell =
  | { kind: "rate"; value: number | null; higherIsBetter: boolean; alt?: string }
  | { kind: "count"; value: number; alt?: string }
  | { kind: "value"; value: number | null; decimals: number; unit?: string; samples?: number; higherIsBetter?: boolean }
  | { kind: "mix"; stats: VoiceStats };

interface KpiRowSpec<T> {
  label: string;
  hint?: string;
  emphasis?: boolean;
  cell: (stats: T) => Cell;
}

const cellNumber = (cell: Cell): number | null => {
  if (cell.kind === "rate" || cell.kind === "value") return cell.value;
  if (cell.kind === "count") return cell.value;
  return null;
};

const cellHigherIsBetter = (cell: Cell): boolean | null => {
  if (cell.kind === "rate") return cell.higherIsBetter;
  if (cell.kind === "value") return cell.higherIsBetter ?? null;
  return null;
};

const cellText = (cell: Cell): string => {
  if (cell.kind === "rate") return formatPercent(cell.value);
  if (cell.kind === "count") return cell.value === 0 ? "0" : formatCount(cell.value);
  if (cell.kind === "value") {
    if (cell.value == null) return "—";
    return `${formatNumber(cell.value, cell.decimals)}${cell.unit ? ` ${cell.unit}` : ""}`;
  }
  return "";
};

/** Ποιο σενάριο βάσης διαβάζουμε — το VoiceStats έχει ήδη το σχήμα του VoiceRates. */
const ratesOf = (stats: VoiceStats, excludeSysRelease: boolean): VoiceRates =>
  excludeSysRelease ? stats.withoutSysRelease : stats;

/** Το δεύτερο, μικρό νούμερο κάτω από το κύριο: το άλλο σενάριο. */
const altPercent = (value: number | null, excludeSysRelease: boolean): string | undefined =>
  excludeSysRelease && value != null ? `incl. SR ${formatPercent(value, 2)}` : undefined;

const altCount = (value: number, excludeSysRelease: boolean): string | undefined =>
  excludeSysRelease ? `incl. SR ${formatCount(value)}` : undefined;

const voiceRows = (excludeSysRelease: boolean): KpiRowSpec<VoiceStats>[] => [
  {
    label: "Call Success Rate (%)",
    hint: excludeSysRelease ? "Normal releases / attempts excl. system releases" : "Normal releases / call attempts",
    emphasis: true,
    cell: (s) => ({
      kind: "rate",
      value: ratesOf(s, excludeSysRelease).csr,
      higherIsBetter: true,
      alt: altPercent(s.csr, excludeSysRelease),
    }),
  },
  {
    label: "Dropped Call Rate (%)",
    hint: excludeSysRelease ? "Dropped calls / total calls excl. system releases" : "Dropped calls / total calls",
    emphasis: true,
    cell: (s) => ({
      kind: "rate",
      value: ratesOf(s, excludeSysRelease).dcr,
      higherIsBetter: false,
      alt: altPercent(s.dcr, excludeSysRelease),
    }),
  },
  {
    label: "Access Failure Rate (%)",
    hint: excludeSysRelease ? "Unsuccessful attempts / attempts excl. system releases" : "Unsuccessful attempts / call attempts",
    emphasis: true,
    cell: (s) => ({
      kind: "rate",
      value: ratesOf(s, excludeSysRelease).afr,
      higherIsBetter: false,
      alt: altPercent(s.afr, excludeSysRelease),
    }),
  },
  {
    // Πάντα στην πλήρη βάση — αλλιώς ο δείκτης δεν θα είχε νόημα.
    label: "System Release Rate (%)",
    hint: "System releases / total calls (πάντα incl.)",
    cell: (s) => ({ kind: "rate", value: s.srr, higherIsBetter: false }),
  },
  {
    label: excludeSysRelease ? "Call Attempts (excl. SR)" : "Call Attempts",
    cell: (s) => ({
      kind: "count",
      value: ratesOf(s, excludeSysRelease).attempts,
      alt: altCount(s.attempts, excludeSysRelease),
    }),
  },
  {
    label: excludeSysRelease ? "Total Calls (excl. SR)" : "Total Calls",
    hint: "Attempts − unsuccessful attempts",
    cell: (s) => ({
      kind: "count",
      value: ratesOf(s, excludeSysRelease).connections,
      alt: altCount(s.connections, excludeSysRelease),
    }),
  },
  { label: "Unsuccessful Call Attempts", cell: (s) => ({ kind: "count", value: s.failed }) },
  { label: "Normal Releases", cell: (s) => ({ kind: "count", value: s.completed }) },
  { label: "Dropped Calls", cell: (s) => ({ kind: "count", value: s.dropped }) },
  { label: "System Releases", cell: (s) => ({ kind: "count", value: s.sysRelease }) },
  {
    label: `Low Speech Quality Calls (POLQA < ${LOW_QUALITY_MOS})`,
    cell: (s) => ({ kind: "count", value: s.lowQualityCalls }),
  },
  {
    label: `Low Speech Quality Calls (POLQA < ${BAD_QUALITY_MOS})`,
    cell: (s) => ({ kind: "count", value: s.badQualityCalls }),
  },
  {
    label: "POLQA avg (Speech quality ITU P.863)",
    emphasis: true,
    cell: (s) => ({ kind: "value", value: s.mos.avg, decimals: 2, samples: s.mos.samples, higherIsBetter: true }),
  },
  {
    label: "MOC Call Setup Time (sec)",
    hint: "callDir A→B",
    cell: (s) => ({ kind: "value", value: s.setupMoc.avg, decimals: 2, samples: s.setupMoc.samples, higherIsBetter: false }),
  },
  {
    label: "MTC Call Setup Time (sec)",
    hint: "callDir B→A",
    cell: (s) => ({ kind: "value", value: s.setupMtc.avg, decimals: 2, samples: s.setupMtc.samples, higherIsBetter: false }),
  },
  {
    label: "Avg Call Duration (sec)",
    cell: (s) => ({ kind: "value", value: s.duration.avg, decimals: 1, samples: s.duration.samples }),
  },
  { label: "Call outcome mix", cell: (s) => ({ kind: "mix", stats: s }) },
];

const dataRows = (stats: DataTestStats): KpiRowSpec<DataTestStats>[] => [
  {
    label: "Test Success Rate (%)",
    hint: "Successful / scored tests",
    emphasis: true,
    cell: (s) => ({ kind: "rate", value: s.successRate, higherIsBetter: true }),
  },
  { label: "Total Tests", cell: (s) => ({ kind: "count", value: s.total }) },
  { label: "Successful tests", cell: (s) => ({ kind: "count", value: s.success }) },
  { label: "Failed Tests", cell: (s) => ({ kind: "count", value: s.failed }) },
  ...stats.metrics.map((metric, index) => ({
    label: metric.unit ? `${metric.label} (${metric.unit})` : metric.label,
    emphasis: index === 0,
    cell: (s: DataTestStats): Cell => {
      const match = s.metrics[index];
      return {
        kind: "value",
        value: match?.value ?? null,
        decimals: match?.decimals ?? 2,
        samples: match?.samples,
        higherIsBetter: match?.higherIsBetter,
      };
    },
  })),
];

/* ────────────────────────── Ο γενικός πίνακας KPI ────────────────────────── */

interface KpiTableProps<T> {
  operators: OperatorMeta[];
  rows: KpiRowSpec<T>[];
  statsFor: (operatorKey: string) => T;
  total: T;
  hideEmptyRows: boolean;
  markBest: boolean;
}

function KpiTable<T>({ operators, rows, statsFor, total, hideEmptyRows, markBest }: KpiTableProps<T>) {
  const columns = operators.map((operator) => ({ operator, stats: statsFor(operator.key) }));

  // Πλάτος ανά στήλη ώστε η στήλη με τα ονόματα των KPI να μη στριμώχνεται.
  const minWidth = 260 + columns.length * 190 + 90;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-border bg-muted">
            <th className="sticky left-0 z-10 min-w-[15rem] bg-muted px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              KPI
            </th>
            {columns.map(({ operator }) => (
              <th key={operator.key} className="px-4 py-2.5 text-right font-semibold">
                <span className="flex items-center justify-end gap-1.5">
                  <OperatorSwatch color={operator.color} />
                  <span className="text-[11px] tracking-wide text-foreground">{operator.label}</span>
                </span>
              </th>
            ))}
            <th className="border-l border-border/60 px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cells = columns.map(({ stats }) => row.cell(stats));
            const totalCell = row.cell(total);
            const numbers = cells.map(cellNumber).filter((value): value is number => value != null);

            if (hideEmptyRows && numbers.length > 0 && numbers.every((value) => value === 0)) return null;
            if (hideEmptyRows && numbers.length === 0 && totalCell.kind !== "mix") return null;

            // "best" μόνο στις headline γραμμές — αλλιώς γεμίζει ο πίνακας σημάδια.
            const higherIsBetter = cellHigherIsBetter(cells[0] ?? totalCell);
            const bestValue =
              markBest && row.emphasis && higherIsBetter != null && numbers.length > 1 && new Set(numbers).size > 1
                ? higherIsBetter
                  ? Math.max(...numbers)
                  : Math.min(...numbers)
                : null;
            const rowMax = numbers.length > 0 ? Math.max(...numbers) : 0;

            return (
              <tr key={row.label} className="border-b border-border/40 last:border-b-0 hover:bg-muted/15">
                <td className="sticky left-0 z-10 min-w-[15rem] bg-card px-4 py-2 align-middle">
                  <div className={row.emphasis ? "font-medium text-foreground" : "text-foreground/80"}>{row.label}</div>
                  {row.hint && <div className="text-[10px] text-muted-foreground">{row.hint}</div>}
                </td>

                {cells.map((cell, index) => {
                  const { operator } = columns[index];
                  const value = cellNumber(cell);
                  const isBest = bestValue != null && value === bestValue;

                  return (
                    <td key={operator.key} className="px-4 py-1.5 align-middle">
                      {cell.kind === "mix" ? (
                        <OutcomeMixBar stats={(cell as Extract<Cell, { kind: "mix" }>).stats} />
                      ) : (
                        <div className="flex items-center justify-end gap-2.5">
                          <span
                            className="w-7 shrink-0 text-right text-[9px] uppercase tracking-wider text-muted-foreground"
                            title={isBest ? "Best value in this row" : undefined}
                          >
                            {isBest ? "best" : ""}
                          </span>

                          {/* Σταθερή θέση για τη ράβδο ώστε να ευθυγραμμίζονται οι αριθμοί. */}
                          <span className="w-14 shrink-0">
                            {cell.kind === "rate" && <RateMeter value={cell.value} higherIsBetter={cell.higherIsBetter} />}
                            {cell.kind === "count" && rowMax > 0 && (
                              <MagnitudeBar value={cell.value} max={rowMax} color={operator.color} />
                            )}
                          </span>

                          <span className="w-[4.75rem] text-right">
                            <span
                              className={`block font-mono tabular-nums ${
                                row.emphasis ? "text-[13px] font-semibold text-foreground" : "text-foreground/90"
                              } ${value === 0 && cell.kind === "count" ? "text-muted-foreground/40" : ""}`}
                            >
                              {cellText(cell)}
                            </span>
                            {cell.kind === "value" && cell.samples != null && cell.samples > 0 && (
                              <span className="block text-[10px] leading-tight text-muted-foreground">
                                n={formatCount(cell.samples)}
                              </span>
                            )}
                            {(cell.kind === "rate" || cell.kind === "count") && cell.alt && (
                              <span
                                className="block text-[10px] leading-tight text-muted-foreground"
                                title="Ίδιο KPI με τα system releases μέσα στη βάση"
                              >
                                {cell.alt}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}

                <td className="border-l border-border/60 px-4 py-1.5 text-right align-middle">
                  {totalCell.kind === "mix" ? (
                    <OutcomeMixBar stats={(totalCell as Extract<Cell, { kind: "mix" }>).stats} />
                  ) : (
                    <span className="font-mono text-xs tabular-nums text-foreground/60">{cellText(totalCell)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────── Κάρτες ────────────────────────── */

const ReportCard = ({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon: typeof Phone;
  footer?: ReactNode;
  children: ReactNode;
}) => (
  <section className="overflow-hidden rounded-xl border border-border bg-card">
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {subtitle && <p className="ml-auto text-[11px] text-muted-foreground">{subtitle}</p>}
    </header>
    {children}
    {footer && <div className="border-t border-border/60 px-4 py-2">{footer}</div>}
  </section>
);

/** Legend για το "Call outcome mix" — τα segments δεν έχουν inline labels. */
const OutcomeLegend = () => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Call outcome mix</span>
    {OUTCOME_SEGMENTS.map((segment) => (
      <span key={segment.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
        {segment.label}
      </span>
    ))}
  </div>
);

const OperatorTile = ({
  operator,
  stats,
  excludeSysRelease,
}: {
  operator: OperatorMeta;
  stats: VoiceStats;
  excludeSysRelease: boolean;
}) => {
  const hasQualityData = stats.mos.samples > 0 || stats.setupAll.samples > 0;
  const rates = ratesOf(stats, excludeSysRelease);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <OperatorSwatch color={operator.color} />
        <span className="text-xs font-semibold tracking-wide text-foreground">{operator.label}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          Call success rate{excludeSysRelease && " (excl. SR)"}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="text-3xl font-semibold leading-none text-foreground">{formatPercent(rates.csr, 1)}</span>
        <span className="pb-0.5 text-[11px] text-muted-foreground">{formatCount(rates.attempts)} attempts</span>
      </div>

      <div className="mt-3">
        <RateMeter value={rates.csr} higherIsBetter={true} />
      </div>

      {excludeSysRelease && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          incl. system releases {formatPercent(stats.csr, 1)} · {formatCount(stats.attempts)} attempts
        </p>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3">
        {[
          { label: "Dropped", value: stats.dropped, color: STATUS_COLORS.serious },
          { label: "Access fail", value: stats.failed, color: STATUS_COLORS.critical },
          { label: "Sys release", value: stats.sysRelease, color: "#9085e9" },
        ].map((item) => (
          <div key={item.label}>
            <dt className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </dt>
            <dd className="font-mono text-sm tabular-nums text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>

      {hasQualityData && (
        <p className="mt-3 text-[10px] text-muted-foreground">
          POLQA avg {formatNumber(stats.mos.avg, 2)} · setup {formatNumber(stats.setupAll.avg, 2)} s
        </p>
      )}
    </div>
  );
};

const EmptyState = ({ message }: { message: string }) => (
  <p className="px-4 py-8 text-center text-xs text-muted-foreground">{message}</p>
);

/* ────────────────────────── Το tab ────────────────────────── */

const SummaryTab = ({ allCallsRows, dataCallsRows, database, collections = [] }: SummaryTabProps) => {
  const [hideEmptyRows, setHideEmptyRows] = useState(false);
  const [markBest, setMarkBest] = useState(true);
  /** "Avoid system release": τα ποσοστά υπολογίζονται χωρίς τις κλήσεις που έκλεισε το σύστημα. */
  const [excludeSysRelease, setExcludeSysRelease] = useState(false);

  const rows = useMemo(() => voiceRows(excludeSysRelease), [excludeSysRelease]);

  const operators = useMemo(
    () => collectOperators([...allCallsRows.map((row) => row.Location), ...dataCallsRows.map((row) => row.Location)]),
    [allCallsRows, dataCallsRows],
  );

  const gsmTable = useMemo(() => buildVoiceTable(allCallsRows, "GSM"), [allCallsRows]);
  const freeTable = useMemo(() => buildVoiceTable(allCallsRows, "FREE"), [allCallsRows]);
  const dataSections = useMemo(() => buildDataSections(dataCallsRows), [dataCallsRows]);

  const overallStats = useMemo(() => buildVoiceStats(allCallsRows), [allCallsRows]);

  /** GSM + FREE μαζί ανά operator — αυτό δείχνουν τα tiles. */
  const voiceByOperator = useMemo(() => {
    const grouped = new Map<string, AllCallsRow[]>();
    for (const row of allCallsRows) {
      const key = resolveOperator(row.Location).key;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(row);
      else grouped.set(key, [row]);
    }
    return new Map(Array.from(grouped, ([key, rows]) => [key, buildVoiceStats(rows)]));
  }, [allCallsRows]);

  const period = useMemo(
    () =>
      buildReportPeriod([
        ...allCallsRows.map((row) => row.callStartTimeStamp),
        ...dataCallsRows.map((row) => row.callStartTimeStamp),
      ]),
    [allCallsRows, dataCallsRows],
  );

  const locations = useMemo(
    () =>
      Array.from(
        new Set([...allCallsRows.map((row) => row.Location), ...dataCallsRows.map((row) => row.Location)].filter(Boolean)),
      ) as string[],
    [allCallsRows, dataCallsRows],
  );

  const hasData = allCallsRows.length > 0 || dataCallsRows.length > 0;

  const formatDate = (date: Date | null) =>
    date
      ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`
      : "—";

  const voiceTableFor = (table: VoiceTable) => ({
    statsFor: (operatorKey: string) => table.byOperator.get(operatorKey) ?? EMPTY_VOICE_STATS,
    total: table.total,
  });

  return (
    <div className="space-y-4">
      {/* ── Κεφαλίδα αναφοράς ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start gap-6 bg-gradient-to-r from-primary/[0.07] via-accent/[0.04] to-transparent px-5 py-5">
          <div className="min-w-[260px] flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">A-Level Analysis</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Attachment C — Call Statistics Tables</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Παράγεται live από την τρέχουσα επιλογή database / collections / φίλτρων.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <MetaChip icon={Database} label="Route" value={database || "—"} />
              <MetaChip icon={MapPin} label="Subroutes" value={locations.length > 0 ? `${locations.length}` : "—"} />
              <MetaChip label="Week" value={period.week != null ? String(period.week) : "—"} />
              <MetaChip label="Period" value={`${formatDate(period.from)} – ${formatDate(period.to)}`} />
              {collections.length > 0 && <MetaChip label="Collections" value={String(collections.length)} />}
            </div>
          </div>

          {/* Hero: το ένα νούμερο που οδηγεί την αναφορά. */}
          <div className="min-w-[180px] text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Overall call success rate{excludeSysRelease && " (excl. SR)"}
            </div>
            <div className="mt-1 text-5xl font-semibold leading-none tracking-tight text-foreground">
              {formatPercent(ratesOf(overallStats, excludeSysRelease).csr, 1)}
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {formatCount(overallStats.completed)} normal releases /{" "}
              {formatCount(ratesOf(overallStats, excludeSysRelease).attempts)} attempts
            </div>
            {excludeSysRelease && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                incl. system releases {formatPercent(overallStats.csr, 1)} · {formatCount(overallStats.sysRelease)} system
                releases
              </div>
            )}
            <div className="mt-1 text-[11px] text-muted-foreground">{formatCount(dataCallsRows.length)} data tests</div>
          </div>
        </div>

        {/* Legend + controls: μία σειρά πάνω απ' όλα όσα ορίζει. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-5 py-2.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Operators</span>
          {operators.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
          {operators.map((operator) => (
            <span key={operator.key} className="flex items-center gap-1.5 text-xs text-foreground">
              <OperatorSwatch color={operator.color} />
              {operator.label}
            </span>
          ))}

          <div className="ml-auto flex items-center gap-4">
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
              title="Τα ποσοστά υπολογίζονται χωρίς τις system release κλήσεις· η τιμή με αυτές μένει ορατή κάτω από κάθε νούμερο."
            >
              <input
                type="checkbox"
                checked={excludeSysRelease}
                onChange={(event) => setExcludeSysRelease(event.target.checked)}
                className="h-3 w-3 accent-[hsl(var(--primary))]"
              />
              Avoid system release
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={markBest}
                onChange={(event) => setMarkBest(event.target.checked)}
                className="h-3 w-3 accent-[hsl(var(--primary))]"
              />
              Highlight best
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={hideEmptyRows}
                onChange={(event) => setHideEmptyRows(event.target.checked)}
                className="h-3 w-3 accent-[hsl(var(--primary))]"
              />
              Hide empty rows
            </label>
          </div>
        </div>
      </section>

      {!hasData && (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState message='Δεν υπάρχουν δεδομένα. Επιλέξτε database / collections από το tab "All Calls".' />
        </div>
      )}

      {/* ── KPI tiles ανά operator ── */}
      {operators.length > 0 && allCallsRows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {operators.map((operator) => {
            const stats = voiceByOperator.get(operator.key);
            if (!stats || stats.attempts === 0) return null;
            return (
              <OperatorTile
                key={operator.key}
                operator={operator}
                stats={stats}
                excludeSysRelease={excludeSysRelease}
              />
            );
          })}
        </div>
      )}

      {/* ── TABLE 20 — GSM ── */}
      {gsmTable.total.attempts > 0 && (
        <ReportCard
          eyebrow="Table 20 (*)"
          title="GSM Call Stats"
          subtitle={`${formatCount(gsmTable.total.attempts)} call attempts`}
          icon={Radio}
          footer={<OutcomeLegend />}
        >
          <KpiTable
            operators={operators.filter((operator) => (gsmTable.byOperator.get(operator.key)?.attempts ?? 0) > 0)}
            rows={rows}
            hideEmptyRows={hideEmptyRows}
            markBest={markBest}
            {...voiceTableFor(gsmTable)}
          />
        </ReportCard>
      )}

      {/* ── TABLE 21 — FREE ── */}
      {freeTable.total.attempts > 0 && (
        <ReportCard
          eyebrow="Table 21 (*)"
          title="Free (2G-3G-LTE) Call Stats"
          subtitle={`${formatCount(freeTable.total.attempts)} call attempts`}
          icon={Phone}
          footer={<OutcomeLegend />}
        >
          <KpiTable
            operators={operators.filter((operator) => (freeTable.byOperator.get(operator.key)?.attempts ?? 0) > 0)}
            rows={rows}
            hideEmptyRows={hideEmptyRows}
            markBest={markBest}
            {...voiceTableFor(freeTable)}
          />
        </ReportCard>
      )}

      {/* ── TABLE 22 — PS DATA ── */}
      {dataSections.length > 0 && (
        <ReportCard
          eyebrow="Table 22 (*)"
          title="PS Data Stats"
          subtitle={`${dataSections.length} test sections · ${formatCount(dataCallsRows.length)} tests`}
          icon={Wifi}
        >
          <div className="divide-y divide-border/60">
            {dataSections.map((section) => (
              <DataSectionBlock
                key={section.key}
                section={section}
                operators={operators}
                hideEmptyRows={hideEmptyRows}
                markBest={markBest}
              />
            ))}
          </div>
        </ReportCard>
      )}

      <p className="px-1 text-[10px] text-muted-foreground">
        (*) Τα KPIs ακολουθούν τους ορισμούς του Attachment B. Οι ράβδοι στα ποσοστά δείχνουν κατάσταση (πράσινο → κόκκινο),
        οι ράβδοι στα πλήθη δείχνουν μέγεθος στο χρώμα του operator. Κάθε τιμή υπάρχει και ως αριθμός στον πίνακα.
        {excludeSysRelease &&
          " Με το «Avoid system release» οι κλήσεις που έκλεισε το σύστημα βγαίνουν από τη βάση των ποσοστών· η τιμή με αυτές μέσα εμφανίζεται ως «incl. SR» κάτω από κάθε νούμερο."}
      </p>
    </div>
  );
};

/* ────────────────────────── Βοηθητικά sub-components ────────────────────────── */

const DataSectionBlock = ({
  section,
  operators,
  hideEmptyRows,
  markBest,
}: {
  section: DataTestSection;
  operators: OperatorMeta[];
  hideEmptyRows: boolean;
  markBest: boolean;
}) => {
  const present = operators.filter((operator) => (section.byOperator.get(operator.key)?.total ?? 0) > 0);
  const empty: DataTestStats = { total: 0, success: 0, failed: 0, successRate: null, metrics: section.total.metrics.map((metric) => ({ ...metric, value: null, samples: 0 })) };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 bg-muted/20 px-4 py-2">
        <h3 className="text-xs font-semibold text-foreground">{section.label}</h3>
        <span className="text-[10px] text-muted-foreground">
          {formatCount(section.total.total)} tests · {formatPercent(section.total.successRate, 1)} success
          {section.total.metrics[0]?.value != null && ` · ${formatMetric(section.total.metrics[0])}`}
        </span>
      </div>
      <KpiTable
        operators={present}
        rows={dataRows(section.total)}
        statsFor={(operatorKey) => section.byOperator.get(operatorKey) ?? empty}
        total={section.total}
        hideEmptyRows={hideEmptyRows}
        markBest={markBest}
      />
    </div>
  );
};

export default SummaryTab;
