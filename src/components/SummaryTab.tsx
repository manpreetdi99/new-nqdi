import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Database, Phone, Radio, Wifi } from "lucide-react";
import { Cell as PieCell, Legend as PieLegend, Pie, PieChart, ResponsiveContainer, Tooltip as PieRTooltip } from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import { useLocalStorage } from "@/hooks/use-local-storage";
import type { AllCallsRow, CellBandCountRow, DataCallRow, ServingBandTechRow, SrvccRow, TechnologyMixRow } from "@/lib/api";
import { CHART_PALETTE } from "@/lib/chartStyles";
import {
  BAD_QUALITY_MOS,
  buildDataSections,
  buildDirectionalDataSections,
  buildHttpsSitesTotal,
  buildPingTotal,
  buildReportPeriod,
  buildServingBandTechTable,
  buildTechnologyMixTable,
  buildVoiceStats,
  buildVoiceTable,
  classifyCallStatus,
  collectOperators,
  EMPTY_VOICE_STATS,
  emptyDataTestStatsLike,
  formatCount,
  formatMetric,
  formatNumber,
  formatPercent,
  LOW_QUALITY_MOS,
  pingPacketSizeBytes,
  resolveOperator,
  SECTION_GROUP_LABELS,
  type CodecShare,
  type DataTestSection,
  type DataTestStats,
  type DirectionalDataTestSection,
  type DirectionalDataTestStats,
  type OperatorMeta,
  type ServingBandTechShare,
  type TechnologyShare,
  type VoiceRates,
  type VoiceStats,
  type VoiceTable,
} from "@/lib/attachmentC";

/**
 * Ποιο κομμάτι της αναφοράς περιμένει ακόμα το δικό του fetch — βλ. summaryLoading στο
 * Index.tsx. Οι 10 πηγές του Summary γυρίζουν ανεξάρτητα, οπότε κάθε κάρτα δείχνει
 * skeleton μόνο όσο λείπουν ΤΑ ΔΙΚΑ ΤΗΣ δεδομένα αντί να περιμένουν όλες την πιο αργή.
 */
export interface SummaryLoading {
  /** /api/calls — GSM/FREE tables, KPI tiles, hero CSR. */
  voice: boolean;
  /** PS Data sections: data_calls + ookla + ping_1000 + interactivity + dns μαζί. */
  data: boolean;
  technologyMix: boolean;
  servingBandTech: boolean;
  /** Πόσες από τις πηγές έχουν φορτώσει — για το "Loaded n/10" chip. */
  done: number;
  totalSources: number;
}

const NOT_LOADING: SummaryLoading = {
  voice: false,
  data: false,
  technologyMix: false,
  servingBandTech: false,
  done: 0,
  totalSources: 0,
};

interface SummaryTabProps {
  allCallsRows: AllCallsRow[];
  dataCallsRows: DataCallRow[];
  /**
   * Πραγματικό ανά-band technology mix από /api/technology_mix (βλ.
   * buildTechnologyMixTable) — προτεραιότητα έναντι του χοντρικού
   * VoiceStats.technologyMix όταν υπάρχει. Optional/κενό: fallback στο χοντρικό.
   */
  technologyMixRows?: TechnologyMixRow[];
  /** Serving Band (NR) / Serving Technology (per Time) για PS Data DL tests — βλ. /api/serving_band_tech. */
  servingBandTechRows?: ServingBandTechRow[];
  /** "Number of 900/1800 band Cells" (μόνο GSM table) — βλ. /api/cell_band_count / buildCellBandCountTable. */
  cellBandCountRows?: CellBandCountRow[];
  /** "Total/Successful/Failed SRVCC attempts" (μόνο FREE table) — βλ. /api/srvcc / buildSrvccTable. */
  srvccRows?: SrvccRow[];
  /** Progressive load: ποιο κομμάτι δείχνει skeleton. Χωρίς αυτό, τίποτα δεν "φορτώνει". */
  loading?: SummaryLoading;
  /**
   * Controlled Compact/Full toggle (2026-08-31) — όταν δίνονται ΚΑΙ τα δύο μαζί, το γονικό
   * component γίνεται το source of truth (π.χ. το Index.tsx, που χρειάζεται να ξέρει αν
   * είναι compact ΠΡΙΝ κάνει fetch technology_mix/dns/interactivity/capacity_link, άχρηστα
   * σε compact — βλ. summaryCompact state εκεί). Χωρίς αυτά (π.χ. στα tests), το SummaryTab
   * κρατάει το δικό του localStorage state όπως πριν — βλ. compact/setCompact παρακάτω.
   */
  compact?: boolean;
  onCompactChange?: (value: boolean) => void;
  database?: string;
  collections?: string[];
  /** Για το dropdown επιλογής database μέσα στο banner· χωρίς αυτά, το banner δείχνει απλό κείμενο. */
  databases?: string[];
  onDatabaseChange?: (database: string) => void;
  /** Όλα τα διαθέσιμα collections της επιλεγμένης βάσης — για το dropdown επιλογής collections. */
  collectionNames?: string[];
  collectionsLoading?: boolean;
  onToggleCollection?: (name: string) => void;
  onSelectAllCollections?: () => void;
  onClearCollections?: () => void;
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

/** Κατώφλια του hero KPI (overall CSR excl. SR): >95% πράσινο, 90–95% πορτοκαλί, <90% κόκκινο. */
const heroCsrColor = (value: number | null): string | undefined => {
  if (value == null) return undefined;
  const pct = value * 100;
  if (pct > 95) return STATUS_COLORS.good;
  if (pct >= 90) return STATUS_COLORS.warning;
  return STATUS_COLORS.critical;
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

/** Part-to-whole: ίδιο look με το OutcomeMixBar, πάνω στα CodecShare buckets (βλ. buildCodecMix). */
const CodecMixBar = ({ mix }: { mix: CodecShare[] }) => {
  if (mix.length === 0) return <span className="text-muted-foreground/40">—</span>;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 w-full gap-[2px]">
        {mix.map((segment) => (
          <div
            key={segment.bucket}
            className="first:rounded-l-full last:rounded-r-full"
            style={{ width: `${segment.share * 100}%`, backgroundColor: segment.color }}
            title={`${segment.bucket}: ${formatCount(segment.count)} (${formatPercent(segment.share, 1)})`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {mix.map((segment) => (
          <span key={segment.bucket} className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
            {segment.bucket} <span className="font-mono tabular-nums text-foreground/80">{formatPercent(segment.share, 1)}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

/** Part-to-whole: ίδιο look με το CodecMixBar, πάνω στα 2G/3G/4G/5G buckets (βλ. buildTechnologyMix). */
const TechnologyMixBar = ({ mix }: { mix: TechnologyShare[] }) => {
  if (mix.length === 0) return <span className="text-muted-foreground/40">—</span>;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 w-full gap-[2px]">
        {mix.map((segment) => (
          <div
            key={segment.bucket}
            className="first:rounded-l-full last:rounded-r-full"
            style={{ width: `${segment.share * 100}%`, backgroundColor: segment.color }}
            title={`${segment.bucket}: ${formatCount(segment.count)} (${formatPercent(segment.share, 1)})`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {mix.map((segment) => (
          <span key={segment.bucket} className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
            {segment.bucket} <span className="font-mono tabular-nums text-foreground/80">{formatPercent(segment.share, 1)}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

/* ────────────────────────── Serving Band / Tech — 2 pies (5G mix + total tech mix) ────────────────────────── */

interface PieSlice {
  name: string;
  value: number;
  pct: number;
  color: string;
}

const pieSliceName = (label: string): string =>
  label.replace(/^Serving (Band|Technology) \(per Time\) /, "").replace(/ \(%\)$/, "");

/**
 * Το ποσοστό ζωγραφίζεται ΜΕΣΑ στη φέτα (όχι έξω με connector line) — έτσι μένει
 * εγγυημένα μέσα στα όρια του ίδιου του pie, που ήδη χωράει στο container: καμία
 * πιθανότητα να κοπεί στην άκρη του chart, όσο στενή κι αν είναι η στήλη.
 * Λευκό fill (σταθερά μεσαία/σκούρα χρώματα στο PIE_PALETTE, βλ. παρακάτω) + λεπτό
 * σκούρο περίγραμμα (paintOrder stroke) για αντίθεση ανεξαρτήτως χρώματος φέτας.
 * Πολύ μικρές φέτες (<6%) δεν παίρνουν label — δεν χωράει κείμενο, μένει στο legend.
 */
const PIE_LABEL_RADIAN = Math.PI / 180;
const renderPieLabel = (props: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; pct: number }) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, pct } = props;
  if (pct < 0.06) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.62;
  const x = cx + radius * Math.cos(-midAngle * PIE_LABEL_RADIAN);
  const y = cy + radius * Math.sin(-midAngle * PIE_LABEL_RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      stroke="rgba(0,0,0,0.55)"
      strokeWidth={3}
      paintOrder="stroke"
      fontSize={11}
      fontWeight={700}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {formatPercent(pct, 1)}
    </text>
  );
};

/** Legend entry: όνομα + ποσοστό — εδώ φαίνεται πάντα καθαρά, ό,τι κι αν κόβει το radial label πάνω στο pie. */
const fmtPieLegend = (value: string, entry: { payload?: PieSlice }) => (
  <span className="text-xs text-foreground">
    {value}
    {entry.payload ? ` — ${formatPercent(entry.payload.pct, 1)}` : ""}
  </span>
);

const PieSliceTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: PieSlice }[] }) => {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="mb-0.5 truncate font-semibold text-foreground">{slice.name}</p>
      <p className="font-mono" style={{ color: slice.color }}>
        {formatCount(slice.value)} <span className="text-muted-foreground">({formatPercent(slice.pct, 1)})</span>
      </p>
    </div>
  );
};

/** Ένα part-to-whole pie πάνω σε μη-μηδενικά slices — ίδιο look/tooltip σε όλη την εφαρμογή (βλ. ResultCharts). */
const MiniPie = ({ title, slices }: { title: string; slices: PieSlice[] }) => {
  if (slices.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col items-center">
      <div className="mb-1 text-xs font-semibold text-foreground">{title}</div>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="46%" outerRadius={72} label={renderPieLabel} labelLine={false}>
            {slices.map((slice, index) => (
              <PieCell key={slice.name ?? index} fill={slice.color} />
            ))}
          </Pie>
          <PieRTooltip content={<PieSliceTooltip />} />
          <PieLegend formatter={fmtPieLegend} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

/**
 * CHART_PALETTE χωρίς το amber (index 2) — αποτυγχάνει το lightness-band check του
 * dataviz validator (βλ. `node scripts/validate_palette.js`). Το "LTE"/"LTE CA" με
 * τα δύο μπλε του technologyColor() επίσης αποτυγχάνουν το normal-vision floor
 * (ΔE 13.9 < 15, δύσκολο να ξεχωρίσουν ακόμα και με πλήρη έγχρωμη όραση) — γι' αυτό
 * τα δύο pies εδώ παίρνουν χρώμα θέσης (fixed order πάνω στο SERVING_BAND_TECH_METRICS),
 * ΟΧΙ το semantic technologyColor.
 */
const PIE_PALETTE = CHART_PALETTE.filter((_, index) => index !== 2);
const NO_DATA_COLOR = "#64748b";

/** Φτιάχνει τα (μη-μηδενικά) BAND/TECH slices ενός operator, σταθερή σειρά χρωμάτων (βλ. PIE_PALETTE). */
const buildServingPieSlices = (shares: ServingBandTechShare[]): { bandSlices: PieSlice[]; techSlices: PieSlice[] } => {
  const bandSlices: PieSlice[] = shares
    .filter((share) => share.kind === "BAND" && share.samples > 0)
    .map((share, index) => ({
      name: pieSliceName(share.label),
      value: share.samples,
      pct: share.pct ?? 0,
      color: PIE_PALETTE[index % PIE_PALETTE.length],
    }));

  let techColorIndex = 0;
  const techSlices: PieSlice[] = shares
    .filter((share) => share.kind === "TECH" && share.samples > 0)
    .map((share) => {
      const name = pieSliceName(share.label);
      const color = name === "No data transfer" ? NO_DATA_COLOR : PIE_PALETTE[techColorIndex++ % PIE_PALETTE.length];
      return { name, value: share.samples, pct: share.pct ?? 0, color };
    });

  return { bandSlices, techSlices };
};

/** Μία στήλη operator: τα 2 pies του (5G band mix / total tech mix) το ένα κάτω απ' το άλλο. */
const ServingBandTechPieColumn = ({
  label,
  color,
  shares,
}: {
  label: string;
  color?: string;
  shares: ServingBandTechShare[];
}) => {
  const { bandSlices, techSlices } = buildServingPieSlices(shares);

  return (
    <div className="flex flex-col items-center gap-4 px-4 py-4">
      <div className="flex items-center gap-1.5 self-start">
        {color && <OperatorSwatch color={color} />}
        <span className="text-xs font-bold tracking-wide text-foreground">{label}</span>
      </div>
      {bandSlices.length > 0 ? (
        <MiniPie title="Serving Band (5G, per Time)" slices={bandSlices} />
      ) : (
        <span className="text-xs text-muted-foreground/40">Serving Band — —</span>
      )}
      {techSlices.length > 0 ? (
        <MiniPie title="Serving Technology (per Time)" slices={techSlices} />
      ) : (
        <span className="text-xs text-muted-foreground/40">Serving Technology — —</span>
      )}
    </div>
  );
};

/**
 * "5G pie" (Serving Band NR28/NR1/NR78) + "total tech pie" (Serving Technology,
 * incl. "No data transfer") ανά operator — μία στήλη ο καθένας, ίδιο layout με τις
 * στήλες operator των υπόλοιπων πινάκων. Χωρίς στήλη "Total" — μόνο οι operators.
 */
const ServingBandTechPies = ({
  operators,
  byOperator,
}: {
  operators: OperatorMeta[];
  byOperator: Map<string, ServingBandTechShare[]>;
}) => (
  <div className="grid" style={{ gridTemplateColumns: `repeat(${operators.length}, minmax(0, 1fr))` }}>
    {operators.map((operator) => (
      <ServingBandTechPieColumn key={operator.key} label={operator.label} color={operator.color} shares={byOperator.get(operator.key) ?? []} />
    ))}
  </div>
);

const MetaChip = ({ icon: Icon, label, value }: { icon?: typeof Database; label: string; value: ReactNode }) => (
  <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/40 px-2.5 py-1.5">
    {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    <span className="text-xs font-medium text-foreground">{value}</span>
  </div>
);

/* ────────────────────────── Γραμμές των KPI πινάκων ────────────────────────── */

/** `alt`: η ίδια μέτρηση στο άλλο σενάριο (με ↔ χωρίς system releases). */
type Cell =
  | {
      kind: "rate";
      value: number | null;
      higherIsBetter: boolean;
      alt?: string;
      /** Το count πίσω από το rate (π.χ. Normal Releases για το Call Success Rate) — βλ. compact voice rows. */
      count?: number;
    }
  | { kind: "count"; value: number; alt?: string }
  /** "total / part" σε ένα cell — π.χ. Total Tests DL προς Successful tests DL, βλ. directionalDataRows. */
  | { kind: "countRatio"; total: number; part: number }
  | {
      kind: "value";
      value: number | null;
      decimals: number;
      unit?: string;
      samples?: number;
      higherIsBetter?: boolean;
      /** Εύρος (min–max) κάτω από την κύρια τιμή — π.χ. MinMOS/MaxMOS. */
      range?: { min: number | null; max: number | null };
    }
  | { kind: "mix"; stats: VoiceStats }
  | { kind: "codecMix"; mix: CodecShare[] }
  | { kind: "technologyMix"; mix: TechnologyShare[] };

interface KpiRowSpec<T> {
  label: string;
  hint?: string;
  emphasis?: boolean;
  cell: (stats: T) => Cell;
}

const cellNumber = (cell: Cell): number | null => {
  if (cell.kind === "rate" || cell.kind === "value") return cell.value;
  if (cell.kind === "count") return cell.value;
  if (cell.kind === "countRatio") return cell.total;
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
  if (cell.kind === "countRatio") return `${formatCount(cell.total)} / ${formatCount(cell.part)}`;
  if (cell.kind === "value") {
    if (cell.value == null) return "—";
    // "%" κολλάει στην τιμή χωρίς κενό (π.χ. "0.668%") — κάθε άλλο unit έχει κενό πριν.
    const unitSuffix = cell.unit ? (cell.unit === "%" ? cell.unit : ` ${cell.unit}`) : "";
    return `${formatNumber(cell.value, cell.decimals)}${unitSuffix}`;
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
      // Normal Releases: το count δεν αλλάζει με το excludeSysRelease (μόνο η βάση/rate αλλάζει).
      count: s.completed,
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
      count: s.dropped,
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
      count: s.failed,
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
  {
    label: "Unsuccessful Call Attempts VoLTE",
    hint: "CustomCallMode VoLTE Call, μόνο FREE table — βλ. LQCallData.sql / LQCallExtend_1PT",
    cell: (s) => ({ kind: "count", value: s.volte.failed }),
  },
  {
    label: "Unsuccessful Call Attempts CS",
    hint: "CustomCallMode CS call, μόνο FREE table — βλ. LQCallData.sql / LQCallExtend_1PT",
    cell: (s) => ({ kind: "count", value: s.cs.failed }),
  },
  { label: "Normal Releases", emphasis: true, cell: (s) => ({ kind: "count", value: s.completed }) },
  { label: "Dropped Calls", cell: (s) => ({ kind: "count", value: s.dropped }) },
  {
    label: "Dropped Calls VoLTE",
    hint: "CustomCallMode VoLTE Call, μόνο FREE table — βλ. LQCallData.sql / LQCallExtend_1PT",
    cell: (s) => ({ kind: "count", value: s.volte.dropped }),
  },
  {
    label: "Dropped Calls CS",
    hint: "CustomCallMode CS call, μόνο FREE table — βλ. LQCallData.sql / LQCallExtend_1PT",
    cell: (s) => ({ kind: "count", value: s.cs.dropped }),
  },
  { label: "System Releases", cell: (s) => ({ kind: "count", value: s.sysRelease }) },
  {
    label: `Low Speech Quality Calls (POLQA < ${LOW_QUALITY_MOS})`,
    hint: "BadCall: >15% των δειγμάτων του session κάτω από 2.2 ή με Silence flag",
    cell: (s) => ({ kind: "count", value: s.lowQualityCalls }),
  },
  {
    label: `Low Speech Quality Calls (POLQA < ${BAD_QUALITY_MOS})`,
    hint: "2 από 3 διαδοχικά δείγματα κάτω από 1.3 ή με Silence flag, σε Completed κλήση",
    cell: (s) => ({ kind: "count", value: s.badQualityCalls }),
  },
  {
    label: "POLQA avg (Speech quality ITU P.863)",
    emphasis: true,
    cell: (s) => ({ kind: "value", value: s.mos.avg, decimals: 2, samples: s.mos.samples, higherIsBetter: true }),
  },
  {
    label: "MOS UL (avg, min–max)",
    hint: "TestInfo.direction A→B — raw δείγματα, όχι κλήσεις",
    cell: (s) => ({
      kind: "value",
      value: s.mosUl.avg,
      decimals: 2,
      higherIsBetter: true,
      range: { min: s.mosUl.min, max: s.mosUl.max },
    }),
  },
  {
    label: "MOS DL (avg, min–max)",
    hint: "TestInfo.direction B→A — raw δείγματα, όχι κλήσεις",
    cell: (s) => ({
      kind: "value",
      value: s.mosDl.avg,
      decimals: 2,
      higherIsBetter: true,
      range: { min: s.mosDl.min, max: s.mosDl.max },
    }),
  },
  {
    label: "MOS UL Count",
    hint: "TestInfo.direction A→B — πλήθος raw δειγμάτων",
    cell: (s) => ({ kind: "count", value: s.mosUl.samples }),
  },
  {
    label: "MOS DL Count",
    hint: "TestInfo.direction B→A — πλήθος raw δειγμάτων",
    cell: (s) => ({ kind: "count", value: s.mosDl.samples }),
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
    label: "CS Call Setup Time (sec)",
    hint: "callMode CSFB/CS — βλ. LQCallData.sql",
    cell: (s) => ({ kind: "value", value: s.csSetup.avg, decimals: 2, samples: s.csSetup.samples, higherIsBetter: false }),
  },
  {
    label: "Number of 900 band Cells",
    hint: "COUNT(DISTINCT CID), μόνο GSM table — βλ. CELL ID GSM.sql",
    cell: (s) => ({ kind: "value", value: s.cellCount900, decimals: 0 }),
  },
  {
    label: "Number of 1800 band Cells",
    hint: "COUNT(DISTINCT CID), μόνο GSM table — βλ. CELL ID GSM.sql",
    cell: (s) => ({ kind: "value", value: s.cellCount1800, decimals: 0 }),
  },
  // {
  //   label: "Avg Call Duration (sec)",
  //   cell: (s) => ({ kind: "value", value: s.duration.avg, decimals: 1, samples: s.duration.samples }),
  // },
  { label: "Call outcome mix", cell: (s) => ({ kind: "mix", stats: s }) },
  {
    label: "Codec Type Usage %",
    hint: "FR AMR WB / AMR HR / AMR / EFR / FR / HR — βλ. CallCodecTypeUsageGSM.sql",
    cell: (s) => ({ kind: "codecMix", mix: s.codecMix }),
  },
  {
    label: "Technology mix",
    hint: "Ανά band (GSM 900 / GSM 1800 / κάθε LTE E-UTRA band ξεχωριστά) — ένα δείγμα ανά θέση GPS, ίδια μεθοδολογία με bi queries/RadioTech_Voice_newDB.sql",
    cell: (s) => ({ kind: "technologyMix", mix: s.technologyMix }),
  },
  {
    label: "Total SRVCC attempts",
    emphasis: true,
    hint: "Distinct HO events, KPIId 38040/38050, μόνο FREE table — βλ. SRVCC RAW.sql",
    cell: (s) => ({ kind: "value", value: s.srvcc?.attempts ?? null, decimals: 0 }),
  },
  {
    label: "Successful SRVCC attempts",
    hint: "ErrorCode=0, μόνο FREE table — βλ. SRVCC RAW.sql",
    cell: (s) => ({ kind: "value", value: s.srvcc?.successful ?? null, decimals: 0 }),
  },
  {
    label: "Failed SRVCC attempts",
    hint: "ErrorCode=108003, μόνο FREE table — βλ. SRVCC RAW.sql",
    cell: (s) => ({ kind: "value", value: s.srvcc?.failed ?? null, decimals: 0 }),
  },
  {
    label: "Fake Event(s)",
    emphasis: true,
    hint: "Sessions με isValid=0 (Sessions.valid='0') — μετράει ανεξάρτητα από το 'Valid calls only' toggle, GSM ΚΑΙ FREE table — βλ. FAKE EVENT LIST reference query.",
    cell: (s) => ({ kind: "value", value: s.fakeEvents, decimals: 0 }),
  },
];

/**
 * Οι γραμμές ενός section's `metrics[]` (π.χ. "Mean RTT (ms)") — reused από dataRows και
 * compactDataRows. "%" εμφανίζεται κολλητό στην τιμή του κελιού (π.χ. "0.668%"), όχι σαν
 * "(%)" στο label — αντίθετα με τα άλλα units (ms/Mbps) που μπαίνουν μόνο στο label, βλ.
 * cellText.
 */
const dataMetricRows = (stats: DataTestStats): KpiRowSpec<DataTestStats>[] =>
  stats.metrics.map((metric, index) => ({
    label: metric.unit && metric.unit !== "%" ? `${metric.label} (${metric.unit})` : metric.label,
    emphasis: index === 0,
    cell: (s: DataTestStats): Cell => {
      const match = s.metrics[index];
      return {
        kind: "value",
        value: match?.value ?? null,
        decimals: match?.decimals ?? 2,
        unit: match?.unit === "%" ? "%" : undefined,
        samples: match?.samples,
        higherIsBetter: match?.higherIsBetter,
      };
    },
  }));

/**
 * "Packet Size (bytes)" row — μόνο για τα Ping 40 B/800 B/1000 B sections (βλ.
 * pingPacketSizeBytes). Τα τρία tables έχουν ΑΚΡΙΒΩΣ την ίδια δομή γραμμών· το μόνο που
 * διαφέρει είναι το packet size, οπότε αυτό το row το δείχνει ρητά μέσα στον πίνακα αντί
 * να χρειάζεται να διαβάσεις το section label για να τα ξεχωρίσεις. Σταθερή τιμή —
 * ανεξάρτητη από operator/total, άρα ο cell callback αγνοεί το `s`.
 */
const packetSizeRow = (bytes: number): KpiRowSpec<DataTestStats> => ({
  label: "Packet Size (bytes)",
  cell: () => ({ kind: "value", value: bytes, decimals: 0 }),
});

const dataRows = (stats: DataTestStats, packetSizeBytes?: number | null): KpiRowSpec<DataTestStats>[] => [
  {
    label: "Test Success Rate (%)",
    hint: "Successful / scored tests",
    emphasis: true,
    cell: (s) => ({ kind: "rate", value: s.successRate, higherIsBetter: true }),
  },
  { label: "Total Tests", cell: (s) => ({ kind: "count", value: s.total }) },
  { label: "Successful tests", cell: (s) => ({ kind: "count", value: s.success }) },
  { label: "Failed Tests", cell: (s) => ({ kind: "count", value: s.failed }) },
  ...(packetSizeBytes != null ? [packetSizeRow(packetSizeBytes)] : []),
  ...dataMetricRows(stats),
];

/**
 * Compact card version του dataRows για τα 'rest' PS Data sections (Ping/HTTP Browser/
 * DNS/Interactivity/Kepler/Newton/HTTPS sites/YouTube — ό,τι ΔΕΝ μπήκε σε directional
 * table) — βλ. reference φωτο (2026-08-31): μόνο Test Success Rate / Total Tests / το(α)
 * metric(s) του section, χωρίς τα ξεχωριστά Successful/Failed tests (ήδη καλύπτονται από
 * το rate) — ίδιο σκεπτικό με το directionalDataRows/COMPACT_VOICE_ROW_ORDER.
 */
const compactDataRows = (stats: DataTestStats, packetSizeBytes?: number | null): KpiRowSpec<DataTestStats>[] => [
  {
    label: "Test Success Rate (%)",
    hint: "Successful / scored tests",
    emphasis: true,
    cell: (s) => ({ kind: "rate", value: s.successRate, higherIsBetter: true }),
  },
  { label: "Total Tests", cell: (s) => ({ kind: "count", value: s.total }) },
  ...(packetSizeBytes != null ? [packetSizeRow(packetSizeBytes)] : []),
  ...dataMetricRows(stats),
];

/**
 * Rows για τα directional (DL/UL merged) compact PS Data tables — βλ.
 * buildDirectionalDataSections. "comapct_data .txt" (2026-08-31): Test Success Rate /
 * Total Tests (προς Successful tests, ένα cell "total / successful" — βλ. Cell
 * "countRatio") / το πρώτο metric του section (π.χ. "Mean sustainable throughput
 * (Mbps)"), ΟΛΑ τα DL rows πρώτα και μετά ΟΛΑ τα UL rows — ΟΧΙ interleaved ανά metric.
 * Χωρίς "Failed Tests" (δεν ζητήθηκε, ίδιο σκεπτικό με το COMPACT_VOICE_ROW_ORDER).
 *
 * `stats` (η τιμή που περνάει το DirectionalSectionBlock είναι πάντα το section.total)
 * χρησιμοποιείται ΜΟΝΟ για να διαβάσει το label/unit του metric μία φορά — οι πραγματικές
 * τιμές ανά operator/total έρχονται από το `s` που δίνει το KpiTable σε κάθε cell().
 */
const directionalDataRows = (stats: DirectionalDataTestStats): KpiRowSpec<DirectionalDataTestStats>[] => {
  const directionRows = (
    direction: "DL" | "UL",
    pick: (s: DirectionalDataTestStats) => DataTestStats,
  ): KpiRowSpec<DirectionalDataTestStats>[] => {
    const metric = pick(stats).metrics[0];
    const metricLabel = metric ? (metric.unit && metric.unit !== "%" ? `${metric.label} (${metric.unit})` : metric.label) : "Mean result";

    return [
      {
        label: `Test Success Rate (%) ${direction}`,
        hint: "Successful / scored tests",
        emphasis: true,
        cell: (s) => ({ kind: "rate", value: pick(s).successRate, higherIsBetter: true }),
      },
      {
        label: `Total Tests ${direction}`,
        hint: "Total προς Successful tests",
        cell: (s) => ({ kind: "countRatio", total: pick(s).total, part: pick(s).success }),
      },
      {
        label: `${metricLabel} ${direction}`,
        emphasis: true,
        cell: (s): Cell => {
          const match = pick(s).metrics[0];
          return {
            kind: "value",
            value: match?.value ?? null,
            decimals: match?.decimals ?? 2,
            unit: match?.unit === "%" ? "%" : undefined,
            samples: match?.samples,
            higherIsBetter: match?.higherIsBetter,
          };
        },
      },
    ];
  };

  return [...directionRows("DL", (s) => s.dl), ...directionRows("UL", (s) => s.ul)];
};

/* ────────────────────────── Ο γενικός πίνακας KPI ────────────────────────── */

interface KpiTableProps<T> {
  operators: OperatorMeta[];
  rows: KpiRowSpec<T>[];
  statsFor: (operatorKey: string) => T;
  total: T;
  hideEmptyRows: boolean;
  markBest: boolean;
  /** Κρύβει το cell.alt ("incl. SR ...") — βλ. hideInclSr στο SummaryTab. Άσχετο για τα PS Data rows (ποτέ δεν έχουν alt). */
  hideInclSr?: boolean;
  /** Αντικαθιστά το default "KPI" label στο πάνω-αριστερά κελί (π.χ. τίτλος section). */
  cornerLabel?: ReactNode;
  /**
   * Πυκνότερο layout (λιγότερο padding, χωρίς τα row.hint) — βλ. "πιο μαζεμένο ώστε να
   * χωρέσει σε μια σελίδα" (2026-08-31). Χρησιμοποιείται ΜΟΝΟ στο compact mode.
   */
  compact?: boolean;
}

function KpiTable<T>({
  operators,
  rows,
  statsFor,
  total,
  hideEmptyRows,
  markBest,
  hideInclSr = false,
  cornerLabel,
  compact = false,
}: KpiTableProps<T>) {
  const columns = operators.map((operator) => ({ operator, stats: statsFor(operator.key) }));

  // Πλάτος ανά στήλη ώστε η στήλη με τα ονόματα των KPI να μη στριμώχνεται. Compact:
  // στενότερες στήλες — τα cells έχουν λιγότερο περιεχόμενο (χωρίς hint/n=/incl. SR lines).
  const minWidth = (compact ? 190 : 260) + columns.length * (compact ? 130 : 190) + 90;
  const headPad = compact ? "px-3 py-1.5" : "px-4 py-3";
  const cellPad = compact ? "px-3 py-1" : "px-4 py-2";
  const labelPad = compact ? "px-3 py-1" : "px-4 py-2.5";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b-2 border-border bg-muted">
            <th
              className={`sticky left-0 z-10 ${compact ? "min-w-[11rem]" : "min-w-[15rem]"} bg-muted ${headPad} text-left text-[11px] font-bold uppercase tracking-wider text-foreground/80`}
            >
              {cornerLabel ?? "KPI"}
            </th>
            {columns.map(({ operator }) => (
              <th key={operator.key} className={`${headPad} text-right font-semibold`}>
                <span className="flex items-center justify-end gap-1.5">
                  <OperatorSwatch color={operator.color} />
                  <span className="text-xs font-bold tracking-wide text-foreground">{operator.label}</span>
                </span>
              </th>
            ))}
            <th className={`border-l-2 border-border/60 ${headPad} text-right text-[11px] font-bold uppercase tracking-wider text-foreground/80`}>
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
            if (
              hideEmptyRows &&
              numbers.length === 0 &&
              totalCell.kind !== "mix" &&
              totalCell.kind !== "codecMix" &&
              totalCell.kind !== "technologyMix"
            )
              return null;

            // "best" μόνο στις headline γραμμές — αλλιώς γεμίζει ο πίνακας σημάδια.
            const higherIsBetter = cellHigherIsBetter(cells[0] ?? totalCell);
            const bestValue =
              markBest && row.emphasis && higherIsBetter != null && numbers.length > 1 && new Set(numbers).size > 1
                ? higherIsBetter
                  ? Math.max(...numbers)
                  : Math.min(...numbers)
                : null;

            return (
              <tr key={row.label} className="border-b border-border/70 last:border-b-0 hover:bg-muted/30">
                <td
                  className={`sticky left-0 z-10 ${compact ? "min-w-[11rem]" : "min-w-[15rem]"} bg-card ${labelPad} align-middle`}
                >
                  <div
                    className={`${compact ? "text-xs" : ""} ${row.emphasis ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}
                  >
                    {row.label}
                  </div>
                  {/* Το hint φεύγει στο compact — λιγότερες γραμμές, βλ. "πιο μαζεμένο". */}
                  {row.hint && !compact && <div className="text-[10px] text-muted-foreground">{row.hint}</div>}
                </td>

                {cells.map((cell, index) => {
                  const { operator } = columns[index];
                  const value = cellNumber(cell);
                  const isBest = bestValue != null && value === bestValue;

                  return (
                    <td key={operator.key} className={`${cellPad} align-middle`}>
                      {cell.kind === "mix" ? (
                        <OutcomeMixBar stats={(cell as Extract<Cell, { kind: "mix" }>).stats} />
                      ) : cell.kind === "codecMix" ? (
                        <CodecMixBar mix={(cell as Extract<Cell, { kind: "codecMix" }>).mix} />
                      ) : cell.kind === "technologyMix" ? (
                        <TechnologyMixBar mix={(cell as Extract<Cell, { kind: "technologyMix" }>).mix} />
                      ) : (
                        <div className="flex items-center justify-end gap-2.5">
                          <span
                            className="w-7 shrink-0 text-right text-[9px] uppercase tracking-wider text-muted-foreground"
                            title={isBest ? "Best value in this row" : undefined}
                          >
                            {isBest ? "best" : ""}
                          </span>

                          {/* Σταθερή θέση για τη ράβδο ώστε να ευθυγραμμίζονται οι αριθμοί — μόνο τα ποσοστά παίρνουν μπάρα. */}
                          <span className="w-14 shrink-0">
                            {cell.kind === "rate" && <RateMeter value={cell.value} higherIsBetter={cell.higherIsBetter} />}
                          </span>

                          <span className="w-[4.75rem] text-right">
                            <span
                              className={`block font-mono tabular-nums ${
                                row.emphasis ? "text-sm font-bold text-foreground" : "text-[13px] font-medium text-foreground/90"
                              } ${value === 0 && (cell.kind === "count" || cell.kind === "countRatio") ? "text-muted-foreground/40" : ""}`}
                            >
                              {cellText(cell)}
                            </span>
                            {cell.kind === "value" &&
                              ((cell.samples != null && cell.samples > 0) ||
                                (cell.range && (cell.range.min != null || cell.range.max != null))) && (
                                <span className="block text-[10px] leading-tight text-muted-foreground">
                                  {cell.samples != null && cell.samples > 0 && <>n={formatCount(cell.samples)}</>}
                                  {cell.range && (cell.range.min != null || cell.range.max != null) && (
                                    <>
                                      {cell.samples != null && cell.samples > 0 ? " · " : ""}
                                      {formatNumber(cell.range.min, cell.decimals)}–{formatNumber(cell.range.max, cell.decimals)}
                                    </>
                                  )}
                                </span>
                              )}
                            {cell.kind === "rate" && cell.count != null && (
                              <span
                                className={`block font-mono tabular-nums ${
                                  row.emphasis ? "text-sm font-bold text-foreground" : "text-[13px] font-medium text-foreground/90"
                                } ${cell.count === 0 ? "text-muted-foreground/40" : ""}`}
                              >
                                sum={formatCount(cell.count)}
                              </span>
                            )}
                            {(cell.kind === "rate" || cell.kind === "count") && cell.alt && !hideInclSr && (
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

                <td className={`border-l border-border/60 ${compact ? "px-3 py-1" : "px-4 py-1.5"} text-right align-middle`}>
                  {totalCell.kind === "mix" ? (
                    <OutcomeMixBar stats={(totalCell as Extract<Cell, { kind: "mix" }>).stats} />
                  ) : totalCell.kind === "codecMix" ? (
                    <CodecMixBar mix={(totalCell as Extract<Cell, { kind: "codecMix" }>).mix} />
                  ) : totalCell.kind === "technologyMix" ? (
                    <TechnologyMixBar mix={(totalCell as Extract<Cell, { kind: "technologyMix" }>).mix} />
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
  title,
  subtitle,
  icon: Icon,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: typeof Phone;
  footer?: ReactNode;
  children: ReactNode;
}) => (
  <section className="overflow-hidden rounded-xl border-2 border-border bg-card shadow-sm">
    <header className="flex flex-wrap items-center gap-3 border-b-2 border-border bg-muted/30 px-4 py-3.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
        <Icon className="h-5 w-5 text-primary" />
      </span>
      <h2 className="min-w-0 text-lg font-bold tracking-tight text-foreground">{title}</h2>
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
  hideInclSr,
}: {
  operator: OperatorMeta;
  stats: VoiceStats;
  excludeSysRelease: boolean;
  /** Κρύβει το "incl. system releases ..." — βλ. hideInclSr στο SummaryTab. */
  hideInclSr: boolean;
}) => {
  const rates = ratesOf(stats, excludeSysRelease);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <OperatorSwatch color={operator.color} />
        <span className="text-xs font-semibold tracking-wide text-foreground">{operator.label}</span>
        <span className="ml-auto text-xs font-bold uppercase tracking-wider text-white">
          GSM+FREE call success rate{excludeSysRelease && " (excl. SR)"}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="text-3xl font-semibold leading-none text-foreground">{formatPercent(rates.csr, 1)}</span>
        <span className="pb-0.5 text-[11px] text-muted-foreground">{formatCount(rates.attempts)} attempts</span>
      </div>

      <div className="mt-3">
        <RateMeter value={rates.csr} higherIsBetter={true} />
      </div>

      {excludeSysRelease && !hideInclSr && (
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

    </div>
  );
};

const EmptyState = ({ message }: { message: string }) => (
  <p className="px-4 py-8 text-center text-xs text-muted-foreground">{message}</p>
);

/** Το κέλυφος ενός KpiTable όσο τρέχει ακόμα το fetch του — ίδιο ύψος γραμμής με τον πίνακα. */
const TableSkeleton = ({ rows = 6 }: { rows?: number }) => (
  <div className="space-y-2 px-4 py-4">
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="flex items-center gap-4">
        <Skeleton className="h-4 w-56 shrink-0" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-4 w-20 shrink-0" />
      </div>
    ))}
  </div>
);

/**
 * Οι γραμμές που επιβιώνουν στο compact mode των Voice tables, ΜΕ τη σειρά εμφάνισής
 * τους — βλ. "comapct_voice .txt": GSM calls/FREE calls total, success/drop/fail rate, και
 * POLQA avg MOS. Ίδιο set/σειρά και στα δύο tables (GSM ΚΑΙ FREE — βλ. gsmRows/freeRows
 * παρακάτω). Total Calls πρώτο (2026-08-31: μετακινήθηκε από προτελευταίο σε πρώτο — βλ.
 * τη σειρά του voiceRows παρακάτω, όπου είναι ΜΕΤΑ τα rates). Τα labels πρέπει να
 * ταιριάζουν ΑΚΡΙΒΩΣ με τα voiceRows παρακάτω· το "Total Calls" αλλάζει label με το
 * excludeSysRelease toggle (βλ. voiceRows), οπότε χρειάζονται εδώ και τα δύο variants
 * (μόνο ένα από τα δύο υπάρχει σε κάθε render, βλ. rows useMemo).
 *
 * "rate/count" του txt: ΔΕΝ είναι ξεχωριστή γραμμή — το count (Normal Releases/Dropped
 * Calls/Unsuccessful Call Attempts) μπαίνει ΜΕΣΑ στο rate cell σαν δεύτερη γραμμή "sum=..."
 * (βλ. Cell "rate".count / voiceRows), οπότε οι standalone count rows δεν χρειάζονται εδώ.
 */
const COMPACT_VOICE_ROW_ORDER = [
  "Total Calls",
  "Total Calls (excl. SR)",
  "Call Success Rate (%)",
  "Dropped Call Rate (%)",
  "Access Failure Rate (%)",
  "POLQA avg (Speech quality ITU P.863)",
];

/**
 * Ένα section του compact PS Data view: είτε κανονικό (ίδιο με το Full mode, όταν δεν είχε
 * DL/UL pair) είτε directional (Ε1 ζευγάρι DL/UL ενωμένο σε ένα table — βλ.
 * buildDirectionalDataSections). Discriminated union ώστε το render loop να ξέρει ποιο
 * KpiTable/rows builder να χρησιμοποιήσει για κάθε section.
 */
type DisplaySection =
  | { kind: "normal"; section: DataTestSection }
  | { kind: "directional"; section: DirectionalDataTestSection };

/**
 * Ε-groups που καταργούνται εντελώς στο compact PS Data view (2026-08-31) — μένουν μόνο
 * στο Full mode. Ε3 · Browser engines (Kepler/Kepler +30s Pause/Newton) και Ε5 · Video
 * streaming (YouTube Service/4K/Live) φεύγουν σαν σύνολο groups — ασφαλές να φιλτραριστούν
 * by `group` γιατί δεν έχουν κανένα merged section μέσα τους (αντίθετα με το Ε2, όπου το
 * merged "Ping (all sizes combined)" ΠΡΕΠΕΙ να μείνει — βλ. COMPACT_EXCLUDED_SECTION_LABELS
 * για τα μεμονωμένα Ε2 sections που φεύγουν χωρίς να πειράξουν το Ping merge).
 */
const COMPACT_EXCLUDED_GROUPS = new Set<string>([SECTION_GROUP_LABELS.browserEngines, SECTION_GROUP_LABELS.videoStreaming]);

/**
 * Μεμονωμένα sections που καταργούνται εντελώς στο compact (2026-08-31) — by label, όχι
 * by group, γιατί μοιράζονται group με κάτι που ΠΡΕΠΕΙ να μείνει: HTTP Transfer DL/UL
 * και τα Capacity ανά-link breakdowns είναι Ε1 · Bulk throughput (ίδιο group με
 * Capacity/Ookla, ήδη merged directional tables), DNS Resolution/Interactivity
 * (eGaming) είναι Ε2 · Latency (ίδιο group με το merged Ping total) — filter by group θα
 * έσβηνε και τα merges αυτά κατά λάθος. Capacity (grx)/(akamai): "στο full ... θέλω να
 * μου το σπάσεις Link grx και akamai" (2026-08-31) — ρητά Full-only, βλ.
 * mapCapacityLinkRowsToDataCallRows.
 */
const COMPACT_EXCLUDED_SECTION_LABELS = new Set([
  "HTTP Transfer (DL) 10MB",
  "HTTP Transfer (UL) 5MB",
  "DNS Resolution",
  "Interactivity (eGaming)",
  "Capacity DL 10GB (grx)",
  "Capacity DL 10GB (akamai)",
  "Capacity UL 1GB (grx)",
  "Capacity UL 1GB (akamai)",
]);

/**
 * Το γυμνό (χωρίς link) "Capacity DL 10GB"/"Capacity UL 1GB" καταργείται σαν ΞΕΧΩΡΙΣΤΟ
 * section στο Full mode ΜΟΝΟ όταν το breakdown του υπάρχει πραγματικά στα δεδομένα
 * (2026-08-31: "εφόσον το έσπασε Capacity DL 10GB το βγάζεις από το full αυτό" — «εφόσον»
 * = conditional, όχι unconditional· αν ποτέ αποτύχει/λείπει το /api/capacity_link endpoint,
 * το γυμνό ΜΕΝΕΙ ορατό αντί να εξαφανιστεί το Capacity εντελώς από το Full mode). Οι
 * υποκείμενες γραμμές (testType="Capacity") ΔΕΝ αγγίζονται — μένουν στο
 * fullDataSections/underlying data, τροφοδοτούν κανονικά το compact directional merge
 * (buildDirectionalDataSections), που ΔΕΝ έχει καν δει τα (grx)/(akamai) sections
 * (COMPACT_EXCLUDED_SECTION_LABELS τα κόβει πριν φτάσουν εκεί) — αυτό εδώ κόβει μόνο την
 * ΕΜΦΑΝΙΣΗ στο Full mode.
 */
const FULL_BARE_CAPACITY_HIDDEN_WHEN_BROKEN_DOWN: { bare: string; breakdowns: string[] }[] = [
  { bare: "Capacity DL 10GB", breakdowns: ["Capacity DL 10GB (grx)", "Capacity DL 10GB (akamai)"] },
  { bare: "Capacity UL 1GB", breakdowns: ["Capacity UL 1GB (grx)", "Capacity UL 1GB (akamai)"] },
];

/* ────────────────────────── Το tab ────────────────────────── */

const SummaryTab = ({
  allCallsRows,
  dataCallsRows,
  technologyMixRows = [],
  servingBandTechRows = [],
  cellBandCountRows = [],
  srvccRows = [],
  loading = NOT_LOADING,
  compact: compactProp,
  onCompactChange,
  database,
  collections = [],
  databases = [],
  onDatabaseChange,
  collectionNames = [],
  collectionsLoading = false,
  onToggleCollection,
  onSelectAllCollections,
  onClearCollections,
}: SummaryTabProps) => {
  const [hideEmptyRows, setHideEmptyRows] = useState(false);
  const [markBest, setMarkBest] = useState(true);
  /** "Avoid system release": τα ποσοστά υπολογίζονται χωρίς τις κλήσεις που έκλεισε το σύστημα. */
  const [excludeSysRelease, setExcludeSysRelease] = useState(true);
  /**
   * Κρύβει τη δευτερεύουσα "incl. SR" γραμμή κάτω από τα rate/count cells (βλ. altPercent/
   * altCount) — μόνο εμφάνιση, δεν αγγίζει το ίδιο το excludeSysRelease scenario. Active
   * (κρυμμένο) από προεπιλογή.
   */
  const [hideInclSr, setHideInclSr] = useState(true);
  /** "Valid calls": κρατάει έξω τις σειρές που έχουν ρητά σημαδευτεί isValid = 0. */
  const [onlyValidCalls, setOnlyValidCalls] = useState(true);
  /**
   * "Compact": πολύ λιγότερα δεδομένα στην οθόνη — τα PS Data sections συμπτύσσονται στα 5
   * Ε-groups με ένα AVG το καθένα, και τα Voice tables κρατάνε μόνο Total Calls, Success/
   * Drop/Fail rate (με το count σαν "sum=..." μέσα στο ίδιο cell), και POLQA avg MOS (βλ.
   * COMPACT_VOICE_ROW_ORDER). Default true — "by default επιλογή Compact" (2026-08-31).
   * Σε localStorage γιατί είναι προτίμηση προβολής, όχι κάτι που θέλεις να ξαναδιαλέγεις.
   *
   * Controlled/uncontrolled fallback (2026-08-31, βλ. compact/onCompactChange στο
   * SummaryTabProps): όταν το Index.tsx περνάει και τα δύο props, αυτά κερδίζουν —
   * ΧΡΕΙΑΖΕΤΑΙ το Index.tsx να ξέρει αν είμαστε compact ΠΡΙΝ αποφασίσει ποια summary
   * queries να τρέξει (technology_mix/dns/interactivity/capacity_link είναι άχρηστα σε
   * compact). Χωρίς αυτά τα props (π.χ. στα tests, που κάνουν render `<SummaryTab />`
   * χωρίς γονέα) πέφτει στο δικό του localStorage state, ίδιο key — ΙΔΙΟ behavior με πριν.
   */
  const [internalCompact, setInternalCompact] = useLocalStorage<boolean>("perf-insights-summary-compact", true);
  const compact = compactProp ?? internalCompact;
  const setCompact = onCompactChange ?? setInternalCompact;
  const [collectionsMenuOpen, setCollectionsMenuOpen] = useState(false);

  const validAllCallsRows = useMemo(
    () => (onlyValidCalls ? allCallsRows.filter((row) => row.isValid !== 0) : allCallsRows),
    [allCallsRows, onlyValidCalls],
  );
  const validDataCallsRows = useMemo(
    () => (onlyValidCalls ? dataCallsRows.filter((row) => row.isValid !== 0) : dataCallsRows),
    [dataCallsRows, onlyValidCalls],
  );

  const allRows = useMemo(() => voiceRows(excludeSysRelease), [excludeSysRelease]);
  /**
   * Compact: μόνο Total Calls (πρώτο) / Success / Drop / Fail rate (με το count σαν
   * "sum=..." μέσα στο ίδιο cell, βλ. voiceRows) / POLQA avg MOS — με τη σειρά του
   * COMPACT_VOICE_ROW_ORDER, όχι τη σειρά του voiceRows (εκεί το Total Calls είναι ΜΕΤΑ τα
   * rates). Το "Total Calls" αλλάζει label με το excludeSysRelease toggle (βλ. voiceRows) —
   * μόνο ένα από τα δύο variants ταιριάζει σε κάθε render, το άλλο απλά δεν βρίσκεται στο
   * byLabel και πέφτει έξω. Ό,τι άλλο (Call Attempts, standalone count rows, codec/
   * technology mix, SRVCC, setup times) φεύγει αυτόματα επειδή δεν είναι στο order list.
   */
  const rows = useMemo(() => {
    if (!compact) return allRows;
    const byLabel = new Map(allRows.map((row) => [row.label, row]));
    return COMPACT_VOICE_ROW_ORDER.map((label) => byLabel.get(label)).filter(
      (row): row is KpiRowSpec<VoiceStats> => row != null,
    );
  }, [allRows, compact]);
  /**
   * Ίδιο με rows, χωρίς τις 3 SRVCC γραμμές (μόνο FREE table — βλ. VoiceStats.srvcc) και τα
   * per-CustomCallMode VoLTE/CS attempts/dropped (μόνο FREE table — βλ. LQCallData.sql /
   * LQCallExtend_1PT hint).
   */
  const gsmRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          !row.label.includes("SRVCC") &&
          row.label !== "Unsuccessful Call Attempts VoLTE" &&
          row.label !== "Unsuccessful Call Attempts CS" &&
          row.label !== "Dropped Calls VoLTE" &&
          row.label !== "Dropped Calls CS",
      ),
    [rows],
  );
  /**
   * Ίδιο με rows, χωρίς MOC/MTC Call Setup Time (μόνο UMTS/GSM 900/1800 — βλ. σχόλιο στο
   * VoiceStats.setupMoc/setupMtc) και Number of 900/1800 band Cells (μόνο GSM table — βλ.
   * VoiceStats.cellCount900/1800). Πάντα "–" στο FREE table, οπότε τις βγάζουμε.
   */
  const freeRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          !row.label.startsWith("MOC Call Setup Time") &&
          !row.label.startsWith("MTC Call Setup Time") &&
          !row.label.includes("band Cells"),
      ),
    [rows],
  );

  const operators = useMemo(
    () =>
      collectOperators([
        ...validAllCallsRows.map((row) => row.Location),
        ...validDataCallsRows.map((row) => row.Location),
      ]),
    [validAllCallsRows, validDataCallsRows],
  );

  const gsmTable = useMemo(
    // allCallsRows (ΟΧΙ validAllCallsRows) για τα fake events: θέλουμε να φαίνονται ακόμα
    // κι όταν το "Valid calls only" toggle τα κρύβει από τα υπόλοιπα στατιστικά.
    () => buildVoiceTable(validAllCallsRows, "GSM", cellBandCountRows, [], allCallsRows),
    [validAllCallsRows, cellBandCountRows, allCallsRows],
  );
  const freeTable = useMemo(
    () => buildVoiceTable(validAllCallsRows, "FREE", [], srvccRows, allCallsRows),
    [validAllCallsRows, srvccRows, allCallsRows],
  );
  const fullDataSections = useMemo(() => buildDataSections(validDataCallsRows), [validDataCallsRows]);
  /**
   * Compact: τα Ε1 · Bulk throughput ζευγάρια DL/UL (Capacity, Ookla — ΧΩΡΙΣ HTTP Transfer,
   * αφαιρέθηκε 2026-08-31) ενώνονται σε ένα directional table το καθένα — βλ.
   * buildDirectionalDataSections. Τρέχει πάνω στο ήδη υπολογισμένο fullDataSections — δεν
   * ξαναδιαβάζει raw rows.
   */
  const directionalDataSections = useMemo(() => buildDirectionalDataSections(fullDataSections), [fullDataSections]);
  /**
   * Compact: το Ε4 · HTTPS sites group (9 site tests) μαζεύεται σε ΕΝΑ section (βλ.
   * buildHttpsSitesTotal, "όλα τα σάιτε μαζεμένα σε total στο compact", 2026-08-31), και
   * τα Ping 40 B/800 B/1000 B μαζεύονται σε ΕΝΑ ακόμα section (βλ. buildPingTotal, "τα ping
   * στο compact όλα μαζεμένα", 2026-08-31). Τρέχει πάνω στο `rest` του
   * directionalDataSections (ό,τι δεν μπήκε ήδη σε DL/UL merge).
   */
  const compactRestSections = useMemo(
    () => buildPingTotal(buildHttpsSitesTotal(directionalDataSections.rest)),
    [directionalDataSections],
  );
  /**
   * Compact: merged directional tables πρώτα, μετά το compactRestSections (Ε4/Ping
   * μαζεμένα, ό,τι άλλο δεν είχε DL/UL pair σαν ξεχωριστά sections) — ίδιο με το Full mode,
   * ΟΧΙ πια averaged σε κάθε Ε-group (βλ. "comapct_data .txt", 2026-08-31 — αντικατέστησε
   * το παλιό buildDataGroupSections). Ε3 · Browser engines/Ε5 · Video streaming (βλ.
   * COMPACT_EXCLUDED_GROUPS) και HTTP Transfer DL/UL/DNS Resolution/Interactivity
   * (eGaming) (βλ. COMPACT_EXCLUDED_SECTION_LABELS) καταργούνται εντελώς στο compact
   * (2026-08-31) — μένουν μόνο στο Full mode.
   */
  const dataSections = useMemo<DisplaySection[]>(() => {
    if (!compact) {
      const labels = new Set(fullDataSections.map((section) => section.label));
      const hiddenBare = new Set(
        FULL_BARE_CAPACITY_HIDDEN_WHEN_BROKEN_DOWN.filter(({ breakdowns }) => breakdowns.some((l) => labels.has(l))).map(
          ({ bare }) => bare,
        ),
      );
      return fullDataSections
        .filter((section) => !hiddenBare.has(section.label))
        .map((section) => ({ kind: "normal", section }) as const);
    }
    return [
      ...directionalDataSections.merged.map((section) => ({ kind: "directional", section }) as const),
      ...compactRestSections
        .filter((section) => !COMPACT_EXCLUDED_GROUPS.has(section.group) && !COMPACT_EXCLUDED_SECTION_LABELS.has(section.label))
        .map((section) => ({ kind: "normal", section }) as const),
    ];
  }, [compact, fullDataSections, directionalDataSections, compactRestSections]);

  // Πραγματικό ανά-band technology mix (βλ. σχόλιο στο SummaryTabProps.technologyMixRows) —
  // άδειο όταν δεν έχει φορτώσει ακόμα ή το schema δεν έχει CallSession, οπότε το
  // voiceTableFor πέφτει στο χοντρικό VoiceStats.technologyMix.
  const gsmTechMix = useMemo(() => buildTechnologyMixTable(technologyMixRows, "GSM"), [technologyMixRows]);
  const freeTechMix = useMemo(() => buildTechnologyMixTable(technologyMixRows, "FREE"), [technologyMixRows]);

  // "Serving Band (NR) / Serving Technology (per Time)" — κορυφή του "PS Data Stats" card.
  const servingBandTech = useMemo(() => buildServingBandTechTable(servingBandTechRows), [servingBandTechRows]);

  const overallStats = useMemo(() => buildVoiceStats(validAllCallsRows), [validAllCallsRows]);

  /** GSM + FREE μαζί ανά operator — αυτό δείχνουν τα tiles. */
  const voiceByOperator = useMemo(() => {
    const grouped = new Map<string, AllCallsRow[]>();
    for (const row of validAllCallsRows) {
      const key = resolveOperator(row.Location).key;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(row);
      else grouped.set(key, [row]);
    }
    return new Map(Array.from(grouped, ([key, rows]) => [key, buildVoiceStats(rows)]));
  }, [validAllCallsRows]);

  /** Collections με έστω μία dropped/failed κλήση χωρίς comment — γίνονται κόκκινες στην κεφαλίδα. */
  const flaggedCollections = useMemo(() => {
    const set = new Set<string>();
    for (const row of allCallsRows) {
      if (!row.CollectionName) continue;
      const outcome = classifyCallStatus(row.status);
      if ((outcome === "dropped" || outcome === "failed") && !row.comment?.trim()) {
        set.add(row.CollectionName);
      }
    }
    return set;
  }, [allCallsRows]);

  const period = useMemo(
    () =>
      buildReportPeriod([
        ...validAllCallsRows.map((row) => row.callStartTimeStamp),
        ...validDataCallsRows.map((row) => row.callStartTimeStamp),
      ]),
    [validAllCallsRows, validDataCallsRows],
  );

  const hasData = validAllCallsRows.length > 0 || validDataCallsRows.length > 0;
  /** Όσο τρέχει έστω μία πηγή, το "δεν υπάρχουν δεδομένα" θα ήταν πρόωρο ψέμα. */
  const anyLoading = loading.voice || loading.data || loading.technologyMix || loading.servingBandTech;

  const formatDate = (date: Date | null) =>
    date
      ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`
      : "—";

  const voiceTableFor = (
    table: VoiceTable,
    techMix: { byOperator: Map<string, TechnologyShare[]>; total: TechnologyShare[] },
  ) => {
    // Το πραγματικό ανά-band mix (techMix) κερδίζει το χοντρικό VoiceStats.technologyMix
    // όταν υπάρχει· άδειο techMix (δεν φόρτωσε ακόμα / schema χωρίς CallSession) → fallback.
    const withTechMix = (stats: VoiceStats, mix: TechnologyShare[]): VoiceStats =>
      mix.length > 0 ? { ...stats, technologyMix: mix } : stats;

    return {
      statsFor: (operatorKey: string) =>
        withTechMix(table.byOperator.get(operatorKey) ?? EMPTY_VOICE_STATS, techMix.byOperator.get(operatorKey) ?? []),
      total: withTechMix(table.total, techMix.total),
    };
  };

  return (
    <div className="space-y-4">
      {/* ── Κεφαλίδα αναφοράς ── */}
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start gap-6 rounded-t-xl bg-gradient-to-r from-primary/[0.07] via-accent/[0.04] to-transparent px-5 py-5">
          <div className="min-w-[260px] flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">A-Level Analysis</div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground">Statistics Tables</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Παράγεται live από την τρέχουσα επιλογή database / collections / φίλτρων.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {/* Εύρος "35–37" αντί για ένα (παραπλανητικό) νούμερο όταν η επιλογή — π.χ.
                  παραπάνω από ένα collection, το καθένα από άλλη εβδομάδα — καλύπτει
                  περισσότερες από μία ISO εβδομάδες. Βλ. period.weekTo/buildReportPeriod. */}
              <MetaChip
                label="Week"
                value={
                  period.week == null
                    ? "—"
                    : period.weekTo != null && period.weekTo !== period.week
                      ? `${period.week}–${period.weekTo}`
                      : String(period.week)
                }
              />
              <MetaChip label="Period" value={`${formatDate(period.from)} – ${formatDate(period.to)}`} />
              {/* Ρητή πρόοδος όσο οι 10 πηγές γυρίζουν μία-μία — αλλιώς η σταδιακή εμφάνιση
                  των καρτών μοιάζει με "τελείωσε, λείπουν κομμάτια". */}
              {loading.done < loading.totalSources && (
                <MetaChip
                  label="Loading"
                  value={
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                      {loading.done}/{loading.totalSources} sources
                    </span>
                  }
                />
              )}
            </div>
          </div>

          {/* Κέντρο: dropdown επιλογής database + collections, δίπλα-δίπλα στο κέντρο του banner. */}
          <div className="flex min-w-[320px] flex-1 flex-row flex-wrap items-center justify-center gap-4 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Database</div>
              {onDatabaseChange ? (
                <select
                  value={database || ""}
                  onChange={(event) => onDatabaseChange(event.target.value)}
                  className="mt-1 w-72 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Select database</option>
                  {databases.map((db) => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="mt-1 w-72 truncate rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                  {database || "—"}
                </div>
              )}
            </div>

            <div className="relative">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Collections</div>
              {onToggleCollection ? (
                <>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setCollectionsMenuOpen((open) => !open)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setCollectionsMenuOpen((open) => !open);
                      }
                    }}
                    className="mt-1 flex w-72 cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <span className="truncate">
                      {collections.length === 0
                        ? "Select collections"
                        : collections.length === 1
                          ? collections[0]
                          : `${collections.length} collections selected`}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>

                  {/* Και για ένα μόνο selected collection — πριν φαινόταν μόνο για 2+, οπότε
                      το flagged (κόκκινο) χρώμα δεν ήταν ποτέ ορατό όταν ήταν ένα μόνο
                      επιλεγμένο (το κουμπί πάνω δείχνει το όνομα πάντα σε text-foreground). */}
                  {collections.length > 0 && (
                    <div className="mt-1 flex max-w-[18rem] flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
                      {collections.map((name) => (
                        <span
                          key={name}
                          className={`text-[11px] ${flaggedCollections.has(name) ? "font-semibold text-red-500" : "text-muted-foreground"}`}
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  )}

                  {collectionsMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setCollectionsMenuOpen(false)} />
                      <div className="absolute left-1/2 top-full z-30 mt-1.5 w-96 -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-left shadow-lg">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs uppercase tracking-wider text-muted-foreground">
                            {collections.length}/{collectionNames.length} selected
                          </span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={onSelectAllCollections}
                              disabled={collectionNames.length === 0}
                              className="rounded border border-border bg-muted px-2 py-1 text-xs hover:bg-muted/70 disabled:opacity-50"
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              onClick={onClearCollections}
                              disabled={collectionNames.length === 0}
                              className="rounded border border-border bg-muted px-2 py-1 text-xs hover:bg-muted/70 disabled:opacity-50"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="max-h-80 space-y-1 overflow-y-auto">
                          {!database && <p className="px-1 py-1 text-xs text-muted-foreground">Select database first.</p>}
                          {database && collectionsLoading && <p className="px-1 py-1 text-xs text-muted-foreground">Loading...</p>}
                          {database && !collectionsLoading && collectionNames.length === 0 && (
                            <p className="px-1 py-1 text-xs text-muted-foreground">No collections found.</p>
                          )}
                          {database &&
                            !collectionsLoading &&
                            collectionNames.map((name) => (
                              <label
                                key={name}
                                className="flex cursor-pointer items-center gap-2.5 rounded-md p-2 text-sm text-foreground hover:bg-muted/50"
                              >
                                <input
                                  type="checkbox"
                                  checked={collections.includes(name)}
                                  onChange={() => onToggleCollection(name)}
                                  className="h-4 w-4 shrink-0 rounded-sm border-primary text-primary focus:ring-primary"
                                />
                                <span className={`truncate ${flaggedCollections.has(name) ? "text-red-500" : ""}`}>
                                  {name}
                                </span>
                              </label>
                            ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : collections.length > 0 ? (
                <div className="mt-1 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
                  {collections.map((name) => (
                    <span
                      key={name}
                      className={`text-sm font-semibold ${
                        flaggedCollections.has(name) ? "text-red-500" : "text-foreground"
                      }`}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-1 text-sm text-muted-foreground">—</div>
              )}
            </div>
          </div>

          {/* Hero: το ένα νούμερο που οδηγεί την αναφορά. */}
          <div className="min-w-[180px] text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Overall call success rate{excludeSysRelease && " (excl. SR)"}
            </div>
            {loading.voice ? (
              // Χωρίς αυτό, το hero θα έδειχνε ένα σίγουρο "0.0%" πριν καν έρθουν οι κλήσεις.
              <Skeleton className="mt-1 ml-auto h-12 w-40" />
            ) : (
              <div
                className="mt-1 text-5xl font-semibold leading-none tracking-tight text-foreground"
                style={
                  excludeSysRelease && onlyValidCalls
                    ? { color: heroCsrColor(ratesOf(overallStats, excludeSysRelease).csr) }
                    : undefined
                }
              >
                {formatPercent(ratesOf(overallStats, excludeSysRelease).csr, 1)}
              </div>
            )}
            <div className="mt-2 text-[11px] text-muted-foreground">
              {formatCount(overallStats.completed)} normal releases /{" "}
              {formatCount(ratesOf(overallStats, excludeSysRelease).attempts)} attempts
            </div>
            {excludeSysRelease && !hideInclSr && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                incl. system releases {formatPercent(overallStats.csr, 1)} · {formatCount(overallStats.sysRelease)} system
                releases
              </div>
            )}
            <div className="mt-1 text-[11px] text-muted-foreground">{formatCount(validDataCallsRows.length)} data tests</div>
          </div>
        </div>

        {/* Legend + controls: μία σειρά πάνω απ' όλα όσα ορίζει. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-b-xl border-t border-border px-5 py-2.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Operators</span>
          {operators.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
          {operators.map((operator) => (
            <span key={operator.key} className="flex items-center gap-1.5 text-xs text-foreground">
              <OperatorSwatch color={operator.color} />
              {operator.label}
            </span>
          ))}

          <div className="ml-auto flex items-center gap-4">
            {/* Segmented, όχι checkbox: αλλάζει το σχήμα ΟΛΗΣ της αναφοράς, όχι μία στήλη. */}
            <div
              className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
              title="Compact: τα PS Data tests συμπτύσσονται στα 5 groups με ένα AVG το καθένα, και τα Voice tables κρατάνε μόνο Total Calls / Success / Drop / Fail rate (με το count) / POLQA avg MOS."
            >
              {([false, true] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setCompact(value)}
                  aria-pressed={compact === value}
                  className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                    compact === value
                      ? "bg-primary/15 font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {value ? "Compact" : "Full"}
                </button>
              ))}
            </div>
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
              title="Κρατάει έξω τις σειρές που έχουν σημαδευτεί isValid = 0."
            >
              <input
                type="checkbox"
                checked={onlyValidCalls}
                onChange={(event) => setOnlyValidCalls(event.target.checked)}
                className="h-3 w-3 accent-[hsl(var(--primary))]"
              />
              Valid calls
            </label>
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
            {/* Ίδιο look με τα "Valid calls"/"Avoid system release" checkboxes — δεν αλλάζει
                καμία βάση υπολογισμού, μόνο εμφάνιση της "incl. SR" δευτερεύουσας γραμμής.
                Active (κρυμμένο) by default. */}
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40"
              title="Κρύβει τη δευτερεύουσα γραμμή «incl. SR» κάτω από κάθε rate/count. Ενεργό (κρυμμένο) από προεπιλογή."
            >
              <input
                type="checkbox"
                checked={hideInclSr}
                onChange={(event) => setHideInclSr(event.target.checked)}
                disabled={!excludeSysRelease}
                className="h-3 w-3 accent-[hsl(var(--primary))]"
              />
              Hide incl. SR
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

      {!hasData && !anyLoading && (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState message='Δεν υπάρχουν δεδομένα. Επιλέξτε database / collections από το tab "All Calls".' />
        </div>
      )}

      {/* ── KPI tiles ανά operator ── */}
      {/* Compact: οι κάρτες ("GSM+FREE call success rate" ανά operator) φεύγουν — ήδη
          καλύπτονται από τα Total Calls/Success/Drop/Fail rate rows στα GSM/FREE tables
          παρακάτω, βλ. COMPACT_VOICE_ROW_ORDER. Full μόνο. */}
      {!compact &&
        (loading.voice ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : (
          operators.length > 0 &&
          validAllCallsRows.length > 0 && (
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
                    hideInclSr={hideInclSr}
                  />
                );
              })}
            </div>
          )
        ))}

      {/* ── TABLE 20/21 — GSM + FREE ── */}
      {/* Compact: μισό πλάτος η καθεμιά, δίπλα-δίπλα (βλ. "μισο πλατος για gsm ... το αλλο
          μισο free", 2026-08-31) — αντικατέστησε το bar chart, που αφαιρέθηκε εντελώς. Full:
          η μία κάτω από την άλλη, όπως πάντα (ίδιο κενό με τα υπόλοιπα sections). */}
      <div className={compact ? "grid gap-3 lg:grid-cols-2" : "space-y-4"}>
        {(loading.voice || gsmTable.total.attempts > 0) && (
          <ReportCard
            title="GSM Call Stats"
            subtitle={loading.voice ? "loading…" : `${formatCount(gsmTable.total.attempts)} call attempts`}
            icon={Radio}
            footer={loading.voice || compact ? undefined : <OutcomeLegend />}
          >
            {loading.voice ? (
              <TableSkeleton />
            ) : (
              <KpiTable
                operators={operators.filter((operator) => (gsmTable.byOperator.get(operator.key)?.attempts ?? 0) > 0)}
                rows={gsmRows}
                hideEmptyRows={hideEmptyRows}
                markBest={markBest}
                hideInclSr={hideInclSr}
                compact={compact}
                {...voiceTableFor(gsmTable, gsmTechMix)}
              />
            )}
          </ReportCard>
        )}

        {(loading.voice || freeTable.total.attempts > 0) && (
          <ReportCard
            title="Free (2G-3G-LTE) Call Stats"
            subtitle={loading.voice ? "loading…" : `${formatCount(freeTable.total.attempts)} call attempts`}
            icon={Phone}
            footer={loading.voice || compact ? undefined : <OutcomeLegend />}
          >
            {loading.voice ? (
              <TableSkeleton />
            ) : (
              <KpiTable
                operators={operators.filter((operator) => (freeTable.byOperator.get(operator.key)?.attempts ?? 0) > 0)}
                rows={freeRows}
                hideEmptyRows={hideEmptyRows}
                markBest={markBest}
                hideInclSr={hideInclSr}
                compact={compact}
                {...voiceTableFor(freeTable, freeTechMix)}
              />
            )}
          </ReportCard>
        )}
      </div>

      {/* ── TABLE 22 — PS DATA ── */}
      {(loading.data || dataSections.length > 0) && (
        <ReportCard
          title="PS Data Stats"
          subtitle={
            loading.data
              ? "loading…"
              : `${dataSections.length} test sections · ${formatCount(validDataCallsRows.length)} tests`
          }
          icon={Wifi}
        >
          {loading.data && <TableSkeleton rows={8} />}
          {compact ? (
            // Compact: 2 στήλες, μισό πλάτος η καθεμιά (βλ. "Aντιστοιχα μισο Πλατος
            // Capacity ... / Ookla ... HTTPS sites ... μισο Ping ... μισο", 2026-08-31).
            // Χωρίς group headers (Ε1 · .../Ε2 · ...) — δεν έχει νόημα ένας τίτλος να
            // "μοιράζεται" πλάτος με ένα δίπλα section από άλλο group· κάθε κάρτα έχει ήδη
            // δικό της label μέσα στο KpiTable. Κάθε section παίρνει ένα λεπτό border ώστε
            // να ξεχωρίζει καθαρά μέσα στο grid, αφού δεν υπάρχει πια divide-y ανάμεσά τους.
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              {dataSections.map((entry) =>
                entry.kind === "directional" ? (
                  <div key={entry.section.key} className="overflow-hidden rounded-lg border border-border/70">
                    <DirectionalSectionBlock
                      section={entry.section}
                      operators={operators}
                      hideEmptyRows={hideEmptyRows}
                      markBest={markBest}
                    />
                  </div>
                ) : (
                  <div key={entry.section.key} className="overflow-hidden rounded-lg border border-border/70">
                    <DataSectionBlock
                      section={entry.section}
                      operators={operators}
                      hideEmptyRows={hideEmptyRows}
                      markBest={markBest}
                      compact
                    />
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {/* Οι πίτες είναι το πιο βαρύ οπτικά μπλοκ της κάρτας — έξω από το compact. */}
              {!loading.data && loading.servingBandTech && (
                <div className="px-4 py-4">
                  <Skeleton className="h-32 w-full" />
                </div>
              )}
              {servingBandTech.total.some((share) => share.total > 0) && (
                <div>
                  <div className="px-4 pt-4">
                    <div className="text-xs font-bold text-foreground">Serving Band / Serving Technology (per Time)</div>
                    <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">
                      FTP, HTTP, CAPACITY DL (Test Data Server) — ανά operator
                    </div>
                  </div>
                  <ServingBandTechPies
                    operators={operators.filter((operator) =>
                      (servingBandTech.byOperator.get(operator.key) ?? []).some((share) => share.total > 0),
                    )}
                    byOperator={servingBandTech.byOperator}
                  />
                </div>
              )}
              {dataSections.map((entry, index) => {
                const previousGroup = index > 0 ? dataSections[index - 1].section.group : "";
                return (
                  <Fragment key={entry.section.key}>
                    {entry.section.group && entry.section.group !== previousGroup && (
                      <div className="px-4 pt-4 pb-1">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-primary">{entry.section.group}</div>
                      </div>
                    )}
                    {entry.kind === "directional" ? (
                      <DirectionalSectionBlock
                        section={entry.section}
                        operators={operators}
                        hideEmptyRows={hideEmptyRows}
                        markBest={markBest}
                      />
                    ) : (
                      <DataSectionBlock section={entry.section} operators={operators} hideEmptyRows={hideEmptyRows} markBest={markBest} />
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
        </ReportCard>
      )}

      <p className="px-1 text-[10px] text-muted-foreground">
        (*) Τα KPIs ακολουθούν τους ορισμούς του Attachment B. Οι ράβδοι στα ποσοστά δείχνουν κατάσταση (πράσινο → κόκκινο),
        οι ράβδοι στα πλήθη δείχνουν μέγεθος στο χρώμα του operator. Κάθε τιμή υπάρχει και ως αριθμός στον πίνακα.
        {excludeSysRelease &&
          (hideInclSr
            ? " Με το «Avoid system release» οι κλήσεις που έκλεισε το σύστημα βγαίνουν από τη βάση των ποσοστών· η τιμή με αυτές μέσα («incl. SR») είναι κρυμμένη — σβήσε το «Hide incl. SR» για να τη δεις κάτω από κάθε νούμερο."
            : " Με το «Avoid system release» οι κλήσεις που έκλεισε το σύστημα βγαίνουν από τη βάση των ποσοστών· η τιμή με αυτές μέσα εμφανίζεται ως «incl. SR» κάτω από κάθε νούμερο.")}
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
  compact = false,
}: {
  section: DataTestSection;
  operators: OperatorMeta[];
  hideEmptyRows: boolean;
  markBest: boolean;
  /** Compact card: μόνο Success Rate / Total Tests / metric(s) — βλ. compactDataRows. */
  compact?: boolean;
}) => {
  const present = operators.filter((operator) => (section.byOperator.get(operator.key)?.total ?? 0) > 0);
  const empty = emptyDataTestStatsLike(section.total);
  // Ping 40 B/800 B/1000 B μόνο — βλ. pingPacketSizeBytes/packetSizeRow.
  const packetSizeBytes = pingPacketSizeBytes(section.label);

  return (
    <div>
      <KpiTable
        operators={present}
        rows={compact ? compactDataRows(section.total, packetSizeBytes) : dataRows(section.total, packetSizeBytes)}
        statsFor={(operatorKey) => section.byOperator.get(operatorKey) ?? empty}
        total={section.total}
        hideEmptyRows={hideEmptyRows}
        markBest={markBest}
        compact={compact}
        cornerLabel={
          <div>
            <div className="text-xs font-bold normal-case tracking-normal text-foreground">{section.label}</div>
            <div className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              {formatCount(section.total.total)} tests · {formatPercent(section.total.successRate, 1)} success
              {section.total.metrics[0]?.value != null && ` · ${formatMetric(section.total.metrics[0])}`}
            </div>
          </div>
        }
      />
    </div>
  );
};

/**
 * Compact directional table (DL/UL merged) — βλ. buildDirectionalDataSections/
 * directionalDataRows. Ίδιο σχήμα με DataSectionBlock, απλά με δύο πλευρές (dl/ul) αντί
 * για ένα DataTestStats.
 */
const DirectionalSectionBlock = ({
  section,
  operators,
  hideEmptyRows,
  markBest,
}: {
  section: DirectionalDataTestSection;
  operators: OperatorMeta[];
  hideEmptyRows: boolean;
  markBest: boolean;
}) => {
  const present = operators.filter((operator) => {
    const stats = section.byOperator.get(operator.key);
    return (stats?.dl.total ?? 0) > 0 || (stats?.ul.total ?? 0) > 0;
  });
  const empty: DirectionalDataTestStats = {
    dl: emptyDataTestStatsLike(section.total.dl),
    ul: emptyDataTestStatsLike(section.total.ul),
  };

  return (
    <div>
      <KpiTable
        operators={present}
        rows={directionalDataRows(section.total)}
        statsFor={(operatorKey) => section.byOperator.get(operatorKey) ?? empty}
        total={section.total}
        hideEmptyRows={hideEmptyRows}
        markBest={markBest}
        compact
        cornerLabel={<div className="text-xs font-bold normal-case tracking-normal text-foreground">{section.label}</div>}
      />
    </div>
  );
};

export default SummaryTab;
