import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Database, FilterX, Loader2 } from "lucide-react";
import { useMap } from "react-leaflet";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { HistoricFilterCollection, HistoricFilterOptions, HistoricMixRow, HistoricPageFilters } from "@/lib/api";
import { AXIS_STYLE, GRID_STYLE, LEGEND_WRAPPER_STYLE } from "@/lib/chartStyles";

/**
 * Κοινά κομμάτια του Historic tab (snapshot + οι σελίδες GREECE MAP / GRADES / VOICE / RADIO
 * TECH-CODECS): operator ταυτότητα, formatters, KPI πίνακας με operator columns, slicer bar,
 * 100% stacked mix chart.
 */

// Ίδια χρώματα/σειρά operator με resolveOperator (src/lib/attachmentC.ts) — κρατάει την
// ταυτότητα κάθε operator σταθερή σε όλη την εφαρμογή. Εξαίρεση: το NOVA εδώ είναι πιο ανοιχτό
// (#6B7280 αντί για το #111318 του resolveOperator) γιατί εδώ τρέχει σαν stroke/fill σε
// line/bar charts πάνω στο σκούρο --card — το σκέτο μαύρο εξαφανίζεται στο recharts SVG χωρίς
// το λεπτό φωτεινό περίγραμμα που παίρνει το OperatorSwatch (ring) ή τα υπόλοιπα swatches/bars
// της εφαρμογής (βλ. σχόλιο στο attachmentC.ts). Επαληθεύτηκε contrast >=3:1 έναντι του
// --card (#15181E) με το dataviz palette validator.
export const OPERATORS = [
  { key: "COSMOTE", label: "COSMOTE", color: "#3ab54a" },
  { key: "VODAFONE", label: "VODAFONE", color: "#e60000" },
  { key: "NOVA", label: "NOVA", color: "#6B7280" },
] as const;

export type OperatorSpec = (typeof OPERATORS)[number];

export const operatorSpec = (key: string): OperatorSpec | undefined => OPERATORS.find((op) => op.key === key);

/** Κατηγορικά χρώματα για τα mix charts (codecs, bands, call modes) — dark steps της reference
 * palette του dataviz skill, ΣΤΑΘΕΡΗ σειρά (ποτέ cycled). Validated on --card #15181E: όλα τα
 * checks PASS (worst adjacent CVD ΔE 8.4, normal-vision 19.3, contrast ≥3:1). */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

/** Κλίμακα ποιότητας (bins throughput / RSRP): διαποικιλτική κόκκινο (κακό) ↔ γκρι ↔ μπλε (καλό),
 * πόλοι από τις red/blue ramps του dataviz skill. Validated on --card και σε λευκό: adjacent CVD
 * ΔE ≥ 14.6, normal-vision ≥ 15.6 — τα bins πάντα συνοδεύονται από label (legend/πίνακα). */
const QUALITY_7 = ["#a3221f", "#dd5a48", "#f4b8a5", "#8f8d88", "#86b6ef", "#3987e5", "#184f95"];

/** `n` χρώματα από το χειρότερο στο καλύτερο bin (n ≤ 7, συμμετρικά γύρω από το γκρι). */
export const qualityColors = (n: number): string[] => {
  if (n >= 7) return QUALITY_7;
  if (n === 6) return ["#a3221f", "#dd5a48", "#f4b8a5", "#86b6ef", "#3987e5", "#184f95"];
  if (n === 5) return ["#a3221f", "#dd5a48", "#8f8d88", "#3987e5", "#184f95"];
  if (n === 4) return ["#a3221f", "#dd5a48", "#3987e5", "#184f95"];
  return ["#a3221f", "#8f8d88", "#184f95"].slice(0, n);
};

/** Χρώμα επιφάνειας κάρτας — για τα 2px κενά ανάμεσα σε stacked segments. */
export const CARD_SURFACE = "hsl(var(--card))";

export const OperatorSwatch = ({ color }: { color: string }) => (
  <span
    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-white/25"
    style={{ backgroundColor: color }}
  />
);

export const fmtNum = (value: number | null | undefined, decimals = 2): string =>
  value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const fmtPct = (value: number | null | undefined, decimals = 1): string =>
  value == null ? "—" : `${value.toFixed(decimals)}%`;

export const fmtCount = (value: number | null | undefined): string => (value == null ? "—" : value.toLocaleString("en-US"));

/* ────────────────────────── Γενικός KPI πίνακας (operator columns) ────────────────────────── */

export interface Row<T> {
  label: string;
  emphasis?: boolean;
  /** null: δεν μπαίνει "best" badge σε αυτή τη γραμμή (π.χ. counts). */
  higherIsBetter: boolean | null;
  format: (row: T) => string;
  value: (row: T) => number | null;
}

export function HistoricKpiTable<T extends { operator: string }>({
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

/* ────────────────────────── Searchable dropdown ────────────────────────── */

/** Searchable-list dropdown (Area / Collection Name / Scope κ.λπ.). */
export const PartSelect = ({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  widthClass = "w-48",
  formatOption,
}: {
  label: string;
  placeholder: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  widthClass?: string;
  /** Κείμενο εμφάνισης ανά option (η τιμή που περνάει στο onChange μένει η ίδια). */
  formatOption?: (option: string) => string;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const display = (o: string) => (formatOption ? formatOption(o) : o);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = q ? options.filter((o) => display(o).toLowerCase().includes(q)) : options;
    return source.slice(0, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <span className="truncate">{value ? display(value) : placeholder}</span>
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
                  {opt ? display(opt) : "(none)"}
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

/* ────────────────────────── Slicer bar (Area / Category / Collection / Scope) ────────────────────────── */

const ALL = "All";

/** Οι slicers των σελίδων του .pbix, με σειρά Area → Category → Collection → Scope. Το
 * Collection εδώ είναι το collection ΧΩΡΙΣ scope (area + collection + category), και το Scope
 * δείχνει μόνο τις περιόδους όπου υπάρχει η τρέχουσα επιλογή. Το Scope ξεκινά κενό και
 * επιλέγεται τελευταίο· όταν μια αλλαγή το αφήνει χωρίς δεδομένα, αδειάζει ξανά.
 * Area / Category / Collection: "All" = χωρίς φίλτρο. */
const baseOf = (c: HistoricFilterCollection) => `${c.area}|${c.collection}|${c.category}`;

const uniqueSorted = (values: string[]) => Array.from(new Set(values)).sort();

export const HistoricFilterBar = ({
  options,
  filters,
  onChange,
  withScope = true,
}: {
  options: HistoricFilterOptions;
  filters: HistoricPageFilters;
  onChange: (next: HistoricPageFilters) => void;
  /** false: σελίδες «Comparison» — ο άξονας είναι το Scope, οπότε δεν υπάρχει Scope slicer. */
  withScope?: boolean;
}) => {
  const rows = options.collections;
  const selected = filters.collection ? rows.find((c) => c.name === filters.collection) : undefined;
  const base = filters.collectionBase || (selected ? baseOf(selected) : "");

  const matches = (c: HistoricFilterCollection, area?: string, category?: string, b?: string) =>
    (!area || c.area === area) && (!category || c.category === category) && (!b || baseOf(c) === b);

  const areas = useMemo(() => [ALL, ...uniqueSorted(rows.map((c) => c.area))], [rows]);
  const categories = useMemo(
    () => [ALL, ...uniqueSorted(rows.filter((c) => matches(c, filters.area)).map((c) => c.category))],
    [rows, filters.area],
  );
  const baseLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const c of rows) {
      if (matches(c, filters.area, filters.category)) {
        labels.set(baseOf(c), filters.category ? `${c.area} · ${c.collection}` : `${c.area} · ${c.collection} · ${c.category}`);
      }
    }
    return labels;
  }, [rows, filters.area, filters.category]);
  const bases = useMemo(
    () => [ALL, ...Array.from(baseLabels.keys()).sort((a, b) => baseLabels.get(a)!.localeCompare(baseLabels.get(b)!))],
    [baseLabels],
  );
  const scopesFor = (area?: string, category?: string, b?: string) => {
    const present = new Set(rows.filter((c) => matches(c, area, category, b)).map((c) => c.scope));
    return options.scopes.filter((scope) => present.has(scope));
  };
  const scopes = scopesFor(filters.area, filters.category, base || undefined);

  /** Εφαρμόζει μια επιλογή: κρατάει το scope μόνο αν έχει δεδομένα για τη νέα επιλογή (αλλιώς
   * κενό), και μεταφράζει το collection χωρίς scope στο πλήρες όνομα (STR_ID) του backend. */
  const apply = (area: string | undefined, category: string | undefined, b: string | undefined, scope: string) => {
    const nextScope = scope && scopesFor(area, category, b).includes(scope) ? scope : "";
    const collection = b && nextScope ? rows.find((c) => baseOf(c) === b && c.scope === nextScope)?.name : undefined;
    onChange({ scope: nextScope, area, category, collection, collectionBase: b });
  };

  const fromAll = (v: string) => (v === ALL ? undefined : v);
  /** Clear: όλα "All" και κενό scope — ίδιο με την αρχική κατάσταση της σελίδας. */
  const isCleared = !filters.area && !filters.category && !base && (!withScope || !filters.scope);
  const inScope = rows.filter((c) => c.scope === filters.scope);
  const selectedCount = filters.collection ? 1 : inScope.filter((c) => matches(c, filters.area, filters.category)).length;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <PartSelect
        label="Area"
        placeholder={ALL}
        options={areas}
        value={filters.area || ALL}
        onChange={(v) => apply(fromAll(v), undefined, undefined, filters.scope)}
        widthClass="w-32"
      />
      <PartSelect
        label="Category"
        placeholder={ALL}
        options={categories}
        value={filters.category || ALL}
        onChange={(v) => apply(filters.area, fromAll(v), undefined, filters.scope)}
        widthClass="w-44"
      />
      <PartSelect
        label="Collection"
        placeholder={ALL}
        options={bases}
        value={base || ALL}
        onChange={(v) => apply(filters.area, filters.category, fromAll(v), filters.scope)}
        widthClass="w-80"
        formatOption={(o) => (o === ALL ? ALL : (baseLabels.get(o) ?? o))}
      />
      {withScope && (
        <PartSelect
          label="Scope"
          placeholder="Select scope"
          options={scopes}
          value={filters.scope}
          onChange={(scope) => apply(filters.area, filters.category, base || undefined, scope)}
          widthClass="w-40"
        />
      )}
      <button
        type="button"
        onClick={() => onChange({ scope: withScope ? "" : filters.scope })}
        disabled={isCleared}
        className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-muted-foreground"
      >
        <FilterX className="h-4 w-4" />
        Clear filters
      </button>
      <p className="ml-auto pb-2 text-[11px] text-muted-foreground">
        {!withScope
          ? `${rows.filter((c) => matches(c, filters.area, filters.category, base || undefined)).length} collections across ${scopes.length} scopes`
          : filters.scope
          ? `${selectedCount} of ${inScope.length} collections in ${filters.scope}`
          : `${scopes.length} scope${scopes.length === 1 ? "" : "s"} available — pick one`}
      </p>
    </div>
  );
};

/* ────────────────────────── Data loading ────────────────────────── */

/** Φορτώνει `load()` κάθε φορά που αλλάζει το `key` — αγνοεί απαντήσεις που ήρθαν αργά. */
export function useHistoricLoad<T>(key: string | null, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (key == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading, error };
}

export const LoadState = ({ loading, error, hasData, children }: { loading: boolean; error: string | null; hasData: boolean; children: ReactNode }) => {
  if (error && !hasData) {
    return <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">Failed to load: {error}</div>;
  }
  if (!hasData) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card py-24 text-sm text-muted-foreground">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </>
        ) : (
          "No data for this selection."
        )}
      </div>
    );
  }
  return (
    <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      {children}
    </div>
  );
};

/* ────────────────────────── Panel ────────────────────────── */

export const Panel = ({
  title,
  subtitle,
  icon: Icon,
  right,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: typeof Database;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={`overflow-hidden rounded-xl border border-border bg-card shadow-sm ${className}`}>
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
      {Icon && <Icon className="h-4 w-4 text-primary" />}
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {right && <div className="ml-auto">{right}</div>}
    </header>
    <div className="p-3">{children}</div>
  </section>
);

/* ────────────────────────── 100% stacked mix ανά operator ────────────────────────── */

/** Τα «100% στοιβαγμένες μπάρες» visuals του .pbix: μία μπάρα ανά operator, segments = κατηγορίες
 * (codec, band, call mode) κανονικοποιημένες στο 100%. Χρώματα από SERIES_COLORS με τη ΣΕΙΡΑ του
 * `keys` (σταθερή ανά chart, ώστε ένα φίλτρο να μην ξαναβάφει τα segments). Tooltip: share,
 * samples και — όπου υπάρχει — MOS του segment. */
export const StackedMixChart = ({
  rows,
  keys,
  valueLabel = "samples",
  valueIsPercent = false,
  colors,
}: {
  rows: HistoricMixRow[];
  /** Σειρά/χρώμα των segments· όσα λείπουν από τα δεδομένα απλώς δεν εμφανίζονται. */
  keys: string[];
  valueLabel?: string;
  /** true όταν οι τιμές είναι ήδη ποσοστά (EVS rates) — δεν δείχνουμε "samples". */
  valueIsPercent?: boolean;
  /** Χρώμα ανά key (ίδια σειρά με `keys`) — π.χ. qualityColors για bins· default SERIES_COLORS. */
  colors?: string[];
}) => {
  const ordered = OPERATORS.filter((op) => rows.some((r) => r.operator === op.key));
  const presentKeys = keys.filter((k) => rows.some((r) => r.parts.some((p) => p.key === k && p.value > 0)));

  const data = ordered.map((op) => {
    const row = rows.find((r) => r.operator === op.key)!;
    const total = row.parts.reduce((s, p) => s + (p.value || 0), 0);
    const out: Record<string, string | number | null> = { operator: op.label, __total: total };
    presentKeys.forEach((k) => {
      const part = row.parts.find((p) => p.key === k);
      out[k] = total > 0 && part ? (100 * part.value) / total : 0;
      out[`${k}__raw`] = part?.value ?? 0;
      out[`${k}__mos`] = part?.mos ?? null;
    });
    return out;
  });

  if (data.length === 0 || presentKeys.length === 0) {
    return <p className="py-10 text-center text-xs text-muted-foreground">No samples for this selection.</p>;
  }

  const MixTooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; color: string; payload: Record<string, number | null> }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-semibold text-foreground">{label}</p>
        {payload
          .filter((e) => (row[e.dataKey] ?? 0) > 0)
          .map((entry) => {
            const raw = row[`${entry.dataKey}__raw`];
            const mos = row[`${entry.dataKey}__mos`];
            return (
              <p key={entry.dataKey} className="flex items-center gap-1.5 font-mono text-foreground/90">
                <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: entry.color }} />
                <span className="text-foreground">{entry.dataKey}</span>
                <span>{fmtPct(row[entry.dataKey], 1)}</span>
                {!valueIsPercent && <span className="text-muted-foreground">· {fmtCount(raw)} {valueLabel}</span>}
                {mos != null && <span className="text-muted-foreground">· MOS {fmtNum(mos, 2)}</span>}
              </p>
            );
          })}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={56 + ordered.length * 44}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid {...GRID_STYLE} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} {...AXIS_STYLE} />
        <YAxis type="category" dataKey="operator" width={78} {...AXIS_STYLE} tick={{ ...AXIS_STYLE.tick, fill: "hsl(var(--foreground))" }} />
        <Tooltip content={<MixTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
        <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} formatter={(value: string) => <span className="text-foreground">{value}</span>} />
        {presentKeys.map((k) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="mix"
            fill={colors ? colors[keys.indexOf(k)] : SERIES_COLORS[keys.indexOf(k) % SERIES_COLORS.length]}
            stroke={CARD_SURFACE}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
};

/** Μία τιμή ανά operator (π.χ. Inter HO SR, SRVCC duration) — οριζόντιες μπάρες στο χρώμα του
 * operator, με την τιμή γραμμένη δίπλα (ένα σημείο ανά μπάρα, όχι πυκνό). */
export const OperatorValueBars = ({
  values,
  format,
  domain,
}: {
  values: { operator: string; value: number | null }[];
  format: (v: number) => string;
  domain?: [number, number];
}) => {
  const rows = OPERATORS.map((op) => ({ op, value: values.find((v) => v.operator === op.key)?.value ?? null })).filter(
    (r) => values.some((v) => v.operator === r.op.key),
  );
  const max = domain ? domain[1] : Math.max(...rows.map((r) => r.value ?? 0), 0) * 1.1 || 1;
  const min = domain ? domain[0] : 0;
  if (rows.every((r) => r.value == null)) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No data for this selection.</p>;
  }
  return (
    <div className="space-y-2.5 py-1">
      {rows.map(({ op, value }) => {
        const pct = value == null ? 0 : Math.max(0, Math.min(100, (100 * (value - min)) / (max - min)));
        return (
          <div key={op.key} className="flex items-center gap-3">
            <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground">
              <OperatorSwatch color={op.color} />
              {op.label}
            </span>
            <div className="relative h-4 flex-1 rounded bg-muted/40" title={value == null ? "—" : format(value)}>
              <div className="h-4 rounded-r" style={{ width: `${pct}%`, backgroundColor: op.color, opacity: 0.9 }} />
            </div>
            <span className="w-24 shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums text-foreground">
              {value == null ? "—" : format(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/* ────────────────────────── Leaflet ────────────────────────── */

/** Zoom του χάρτη στα σημεία (ξανά μόνο όταν αλλάξει το σύνολο σημείων). */
export const FitToPoints = ({ points }: { points: [number, number][] }) => {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    // Ο χάρτης στήνεται πριν πάρει το τελικό μέγεθος του grid — χωρίς invalidateSize το
    // fitBounds υπολογίζει πάνω σε λάθος διαστάσεις και ζουμάρει πολύ μακριά.
    const timer = window.setTimeout(() => {
      map.invalidateSize();
      if (points.length === 1) map.setView(points[0], 10);
      else map.fitBounds(points, { padding: [24, 24], maxZoom: 11 });
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
};

/* ────────────────────────── Μικρά controls / grids ────────────────────────── */

/** Segmented toggle (DL/UL, 50 m/500 m, ανά Scope/μήνα, …). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>}
      <div role="radiogroup" aria-label={label} className="flex rounded-md border border-border bg-background p-0.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
              o.value === value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Ένα visual «τιμή ανά operator» του report (column / bar / funnel / donut με μία τιμή). */
export interface MetricSpec<T> {
  title: string;
  subtitle?: string;
  value: (row: T) => number | null | undefined;
  format: (v: number) => string;
  /** π.χ. [0, 100] για ποσοστά· default 0 → max × 1.1. */
  domain?: [number, number];
}

/** Grid από OperatorValueBars panels — ένα ανά visual του report. */
export function MetricBarsGrid<T extends { operator: string }>({
  metrics,
  data,
  icon,
  columns = 3,
}: {
  metrics: MetricSpec<T>[];
  data: T[];
  icon?: typeof Database;
  columns?: 2 | 3;
}) {
  return (
    <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${columns === 3 ? "xl:grid-cols-3" : ""}`}>
      {metrics.map((m) => (
        <Panel key={m.title} title={m.title} subtitle={m.subtitle} icon={icon}>
          <OperatorValueBars values={data.map((r) => ({ operator: r.operator, value: m.value(r) ?? null }))} format={m.format} domain={m.domain} />
        </Panel>
      ))}
    </div>
  );
}
