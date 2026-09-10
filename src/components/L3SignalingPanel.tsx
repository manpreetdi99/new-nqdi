/**
 * L3SignalingPanel.tsx
 * -----------------------------------------------------------------------------
 * Το L3 Signaling panel του CallDetail (RRC / NAS / SIP).
 *
 * Ό,τι έδειχνε πριν ο απλός πίνακας μέσα στο CallDetail, αλλά με:
 *   - toolbar φιλτραρίσματος (αναζήτηση, φάση, σοβαρότητα, απόκρυψη paging)
 *   - timeline strip με ένα tick ανά μήνυμα, χρωματισμένο κατά severity
 *   - badges για technology / layer / direction αντί για γυμνό κείμενο
 *   - expandable γραμμή που δείχνει ΟΛΟ το raw message αντί για truncate
 * -----------------------------------------------------------------------------
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Signal, ChevronLeft, ChevronRight, ArrowDown, ArrowUp, Search, X } from "lucide-react";
import type { CallL3MessagesResponse, L3MessageRow } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { nearestTimestampIndex, shouldSplitSignaling } from "@/lib/signalingNavigation";
import {
  useSignallingHighlights,
  SEV_ROW_CLASS,
  SEV_BADGE_CLASS,
  SEV_DOT_COLOR,
  SEV_LABEL,
  type Severity,
} from "@/lib/signallingHighlights";

interface L3SignalingPanelProps {
  l3Data: CallL3MessagesResponse | null;
  l3DataBSide: CallL3MessagesResponse | null;
  asideLocation?: string | null;
  /**
   * Κοινός cursor με το διάγραμμα σήματος: περνώντας το ποντίκι πάνω από ένα μήνυμα L3
   * δείχνει την ώρα του πάνω στην καμπύλη, ώστε να βλέπεις αμέσως τι έκανε το σήμα
   * τη στιγμή που στάλθηκε το μήνυμα.
   */
  onHoverTime?: (time: number | null) => void;
}

type Side = "A" | "B";
type ScrollAnchor = { side: Side; timestamp: number };
interface SignalingPaneProps extends L3SignalingPanelProps {
  fixedSide?: Side;
  syncTarget?: ScrollAnchor | null;
  onTimestamp?: (side: Side, timestamp: number) => void;
}

const EMPTY_ROWS: L3MessageRow[] = [];
const timeFormatter = new Intl.DateTimeFormat("el-GR", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
});

type PhaseFilter = "all" | "before" | "during" | "after";
type SevFilter = "all" | "issues" | Severity;

/** Χρωματικό pill ανά τεχνολογία — ίδια παλέτα με τα υπόλοιπα charts του CallDetail. */
function techClass(tech: string | null): string {
  const t = (tech || "").toUpperCase();
  if (t.includes("NR") || t.includes("5G")) return "bg-violet-500/10 text-violet-400 border-violet-500/30";
  if (t.includes("LTE")) return "bg-sky-500/10 text-sky-400 border-sky-500/30";
  if (t.includes("GSM")) return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  if (t.includes("WCDMA") || t.includes("UMTS")) return "bg-orange-500/10 text-orange-400 border-orange-500/30";
  if (t.includes("SIP") || t.includes("IMS") || t.includes("VOLTE")) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  return "bg-muted text-muted-foreground border-border";
}

/** Χρώμα φάσης — ίδια σύμβαση before/during/after με τα charts (amber / primary / orange). */
const PHASE_CLASS: Record<string, string> = {
  before: "text-amber-400",
  during: "text-primary",
  after: "text-orange-400",
};
const PHASE_DOT: Record<string, string> = {
  before: "bg-amber-400",
  during: "bg-primary",
  after: "bg-orange-400",
};

/** Το καλύτερο διαθέσιμο label του μηνύματος (SIP combined → simple → raw). */
function msgLabel(r: L3MessageRow): string {
  return r.CombinedMsgNameSIPResponse || r.SimpleMsgName || r.MsgName || "—";
}

function isPagingRow(r: L3MessageRow): boolean {
  return /paging/i.test(r.SimpleMsgName || r.MsgName || "");
}

function fmtTime(iso: string | null): string {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(time) ? timeFormatter.format(time) : "—";
}

function fmtOffset(sec: number | null): string {
  return sec != null ? `${sec > 0 ? "+" : ""}${sec.toFixed(1)}s` : "—";
}

/** Μικρό chip toolbar — ενεργό = γεμάτο, ανενεργό = διακριτικό outline. */
function FilterChip({
  active,
  onClick,
  disabled,
  className = "",
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
        disabled
          ? "border-border/40 text-muted-foreground/40 cursor-not-allowed"
          : active
          ? `border-transparent ${className || "bg-primary text-primary-foreground"}`
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
      }`}
    >
      {children}
    </button>
  );
}

function SignalingPane({ l3Data, l3DataBSide, fixedSide, syncTarget, onTimestamp, onHoverTime }: SignalingPaneProps) {
  const [selectedSide, setSide] = useState<Side>("A");
  const side = fixedSide ?? (selectedSide === "A" && !l3Data?.callWindow && l3DataBSide?.callWindow ? "B" : selectedSide);
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const [sevFilter, setSevFilter] = useState<SevFilter>("all");
  const [hidePaging, setHidePaging] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pendingJump, setPendingJump] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const expectedScroll = useRef<number | null>(null);
  const lastScrollTop = useRef(0);
  const scrollFrame = useRef<number | null>(null);

  const hasBSide = !!l3DataBSide?.callWindow;
  const activeData = side === "B" ? l3DataBSide : l3Data;
  const sourceRows = activeData?.l3Messages ?? EMPTY_ROWS;
  const allRows = useMemo(() => [...sourceRows].sort((a, b) => {
    const ta = a.MsgTime ? Date.parse(a.MsgTime) : NaN;
    const tb = b.MsgTime ? Date.parse(b.MsgTime) : NaN;
    return (Number.isFinite(ta) ? ta : Infinity) - (Number.isFinite(tb) ? tb : Infinity);
  }), [sourceRows]);
  const highlights = useSignallingHighlights(allRows);
  const indexedRows = useMemo(() => allRows.map((r, i) => ({
    r, i, h: highlights[i], timestamp: r.MsgTime ? Date.parse(r.MsgTime) : NaN,
    search: `${msgLabel(r)} ${r.MsgName ?? ""} ${r.Message ?? ""} ${r.Layer ?? ""} ${r.Technology ?? ""} ${r.SIPCallId ?? ""} ${r.SIPResponse ?? ""}`.toLowerCase(),
  })), [allRows, highlights]);

  /** Πλήθος ανά severity — τροφοδοτεί τα chips του toolbar. */
  const sevCounts = useMemo(() => {
    const c: Record<Severity, number> = { red: 0, orange: 0, yellow: 0, green: 0, none: 0 };
    highlights.forEach((h) => { c[h.severity] += 1; });
    return c;
  }, [highlights]);

  /** Τα φιλτραρισμένα rows, κρατώντας το αρχικό index ώστε να ταιριάζει με το highlights[]. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return indexedRows
      .filter(({ r, h, search }) => {
        if (phaseFilter !== "all" && r.Phase !== phaseFilter) return false;
        if (sevFilter === "issues" && h.severity === "none") return false;
        if (sevFilter !== "all" && sevFilter !== "issues" && h.severity !== sevFilter) return false;
        if (hidePaging && isPagingRow(r)) return false;
        if (q && !search.includes(q)) return false;
        return true;
      });
  }, [indexedRows, phaseFilter, sevFilter, hidePaging, query]);

  const timedVisible = useMemo(() => visible.filter(({ timestamp }) => Number.isFinite(timestamp)), [visible]);
  const visibleTimes = useMemo(() => timedVisible.map(({ timestamp }) => timestamp), [timedVisible]);
  const issues = useMemo(() => indexedRows.filter(({ h }) => h.severity === "red" || h.severity === "orange"), [indexedRows]);

  const scrollToRow = useCallback((index: number) => {
    const container = scrollRef.current;
    const row = rowRefs.current.get(index);
    if (!container || !row) return;
    const headerHeight = container.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const top = container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop - headerHeight;
    const clamped = Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight));
    expectedScroll.current = clamped;
    container.scrollTop = clamped;
    lastScrollTop.current = container.scrollTop;
  }, []);

  useEffect(() => {
    if (!syncTarget || syncTarget.side === side) return;
    const index = nearestTimestampIndex(visibleTimes, syncTarget.timestamp);
    if (index >= 0) scrollToRow(timedVisible[index].i);
  }, [syncTarget, side, visibleTimes, timedVisible, scrollToRow]);

  const reportScroll = () => {
    const container = scrollRef.current;
    if (!container || container.scrollTop === lastScrollTop.current) return;
    lastScrollTop.current = container.scrollTop;
    if (expectedScroll.current != null && Math.abs(container.scrollTop - expectedScroll.current) < 1) {
      expectedScroll.current = null;
      return;
    }
    expectedScroll.current = null;
    if (!onTimestamp || scrollFrame.current != null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const headerBottom = container.querySelector("thead")?.getBoundingClientRect().bottom ?? container.getBoundingClientRect().top;
      // Binary search row positions: expanded payloads need no fixed-height assumption.
      let low = 0;
      let high = timedVisible.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        const top = rowRefs.current.get(timedVisible[mid].i)?.getBoundingClientRect().top ?? Infinity;
        if (top <= headerBottom + 1) low = mid + 1;
        else high = mid;
      }
      const row = timedVisible[Math.max(0, low - 1)];
      if (row) onTimestamp(side, row.timestamp);
    });
  };

  useEffect(() => () => {
    if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
  }, [onTimestamp, side, timedVisible]);

  const jumpTo = (index: number) => {
    setPhaseFilter("all"); setSevFilter("all"); setHidePaging(false); setQuery("");
    setExpanded(index);
    setPendingJump(index);
  };

  useEffect(() => {
    if (pendingJump == null) return;
    scrollToRow(pendingJump);
    const timestamp = indexedRows[pendingJump]?.timestamp;
    if (Number.isFinite(timestamp)) onTimestamp?.(side, timestamp);
    setPendingJump(null);
  }, [pendingJump, indexedRows, onTimestamp, side, scrollToRow]);

  const jumpIssue = (direction: -1 | 1) => {
    const next = direction === 1
      ? issues.find(({ i }) => i > (expanded ?? -1)) ?? issues[0]
      : [...issues].reverse().find(({ i }) => i < (expanded ?? Infinity)) ?? issues[issues.length - 1];
    if (next) jumpTo(next.i);
  };
  const callEnd = Date.parse(activeData?.callWindow?.CallEnd ?? "");
  const timedRows = useMemo(() => indexedRows.filter(({ timestamp }) => Number.isFinite(timestamp)), [indexedRows]);
  const rowTimes = useMemo(() => timedRows.map(({ timestamp }) => timestamp), [timedRows]);
  const endIndex = nearestTimestampIndex(rowTimes, callEnd);

  /** Θέση κάθε μηνύματος στο timeline strip (0..1) με βάση το SecondsFromCallStart. */
  const timeline = useMemo(() => {
    const pts = allRows
      .map((r, i) => ({ i, t: r.SecondsFromCallStart, sev: highlights[i]?.severity ?? "none" }))
      .filter((p): p is { i: number; t: number; sev: Severity } => p.t != null);
    if (pts.length === 0) return null;
    const min = pts.reduce((v, p) => Math.min(v, p.t), Infinity);
    const max = pts.reduce((v, p) => Math.max(v, p.t), -Infinity);
    const span = max - min || 1;
    return {
      min,
      max,
      // το «during» ξεκινά στο 0s (call start) — δείχνουμε πού πέφτει μέσα στο strip
      zeroPct: ((0 - min) / span) * 100,
      ticks: pts.map((p) => ({ ...p, pct: ((p.t - min) / span) * 100 })),
    };
  }, [allRows, highlights]);

  if (!activeData || !activeData.callWindow) return fixedSide ? (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
      <h4 className="text-sm font-semibold">{side}-side · L3 Signaling</h4>
      <p className="mt-2 text-xs text-muted-foreground">Δεν υπάρχουν διαθέσιμα L3 δεδομένα για {side}-side.</p>
    </div>
  ) : null;

  const hasPci = allRows.some((r) => r.PCI != null);
  const hasArfcn = allRows.some((r) => r.ARFCN != null);
  const hasSip = allRows.some((r) => r.SIPResponse != null || r.SIPCallId != null);
  // +1 για τον chevron, +1 για το severity badge· χρησιμοποιείται από το expanded colSpan
  const colCount = 8 + (hasPci ? 1 : 0) + (hasArfcn ? 1 : 0) + (hasSip ? 1 : 0);
  const filtersActive = phaseFilter !== "all" || sevFilter !== "all" || hidePaging || query.trim() !== "";

  return (
    <div className="min-w-0 bg-card border border-border rounded-lg overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 border-b border-border bg-gradient-to-r from-primary/[0.07] to-transparent">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Signal className="h-4 w-4 text-primary" />
          {fixedSide ? `${side}-side · L3 Signaling` : "L3 Signaling"}
          <span className="text-[10px] font-normal text-muted-foreground">RRC / NAS / SIP</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold tracking-wide ${
              activeData.callWindow.callDir === "MO" ? "bg-primary/15 text-primary" : "bg-accent/15 text-accent"
            }`}
          >
            {activeData.callWindow.callDir ?? "—"}
          </span>
        </h3>

        <div className="flex items-center gap-2">
          {/* Φάσεις — ίδιο χρωματικό λεξιλόγιο με τα charts */}
          <div className="flex items-center gap-1.5 text-[10px]">
            {(["before", "during", "after"] as const).map((phase) => {
              const count = activeData.summary.byPhase[phase];
              return count > 0 ? (
                <span key={phase} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/60">
                  <span className={`h-1.5 w-1.5 rounded-full ${PHASE_DOT[phase]}`} />
                  <span className="text-muted-foreground">{phase}</span>
                  <b className="font-mono text-foreground">{count}</b>
                </span>
              ) : null;
            })}
          </div>

          {/* A / B side */}
          {!fixedSide && <div className="inline-flex rounded-md border border-border overflow-hidden">
            {(["A", "B"] as const).map((s) => {
              const enabled = s === "A" || hasBSide;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!enabled}
                  onClick={() => { if (enabled) { setSide(s); setExpanded(null); setPendingJump(null); } }}
                  className={`px-2 py-1 text-[10px] font-medium ${s === "B" ? "border-l border-border" : ""} ${
                    side === s
                      ? "bg-primary text-primary-foreground"
                      : enabled
                      ? "bg-muted text-foreground hover:bg-muted/80"
                      : "bg-muted text-muted-foreground/40 cursor-not-allowed"
                  }`}
                >
                  {s}-side
                </button>
              );
            })}
          </div>}
        </div>
      </div>

      {activeData.summary.total === 0 ? (
        <p className="text-xs text-muted-foreground px-3 py-4 text-center">
          Δεν βρέθηκαν L3 messages στο παράθυρο ±{activeData.summary.windowBeforeSec}s.
        </p>
      ) : (
        <>
          {/* ── Timeline strip — μια ματιά στο πού «σπάει» η κλήση ── */}
          {timeline && (
            <div className="px-3 pt-2.5">
              <div className="relative h-7 rounded bg-muted/40 border border-border/50 overflow-hidden">
                {/* call start (0s) */}
                {timeline.zeroPct >= 0 && timeline.zeroPct <= 100 && (
                  <div
                    className="absolute inset-y-0 w-px bg-primary/70"
                    style={{ left: `${timeline.zeroPct}%` }}
                    title="Call start (0s)"
                  />
                )}
                {timeline.ticks.map((t) => (
                  <button
                    key={t.i}
                    type="button"
                    onClick={() => jumpTo(t.i)}
                    title={`${fmtOffset(t.t)} · ${msgLabel(allRows[t.i])}`}
                    style={{ left: `${t.pct}%` }}
                    className={`absolute top-1 bottom-1 w-[3px] -translate-x-1/2 rounded-sm transition-transform hover:scale-y-110 ${
                      SEV_DOT_COLOR[t.sev]
                    } ${t.sev === "none" ? "opacity-40" : ""}`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[9px] text-muted-foreground font-mono mt-0.5">
                <span>{fmtOffset(timeline.min)}</span>
                <span className="text-primary">| 0s = έναρξη κλήσης</span>
                <span>{fmtOffset(timeline.max)}</span>
              </div>
            </div>
          )}

          {/* ── Toolbar φίλτρων ── */}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-2 px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                value={query}
                aria-label={`Αναζήτηση μηνύματος ${side}-side`}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Αναζήτηση μηνύματος…"
                className="h-6 w-44 pl-6 pr-2 rounded border border-border bg-background text-[11px] outline-none focus:border-primary/60"
              />
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">Φάση</span>
              {(["all", "before", "during", "after"] as const).map((p) => (
                <FilterChip
                  key={p}
                  active={phaseFilter === p}
                  onClick={() => setPhaseFilter(p)}
                  className={p === "before" ? "bg-amber-500 text-black" : p === "after" ? "bg-orange-500 text-black" : ""}
                >
                  {p === "all" ? "όλες" : p}
                </FilterChip>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">Σοβαρότητα</span>
              <FilterChip active={sevFilter === "all"} onClick={() => setSevFilter("all")}>όλα</FilterChip>
              <FilterChip
                active={sevFilter === "issues"}
                onClick={() => setSevFilter("issues")}
                disabled={sevCounts.red + sevCounts.orange + sevCounts.yellow + sevCounts.green === 0}
              >
                μόνο ευρήματα
              </FilterChip>
              <FilterChip
                active={sevFilter === "red"}
                onClick={() => setSevFilter("red")}
                disabled={sevCounts.red === 0}
                className="bg-destructive text-destructive-foreground"
              >
                DROP/FAIL {sevCounts.red}
              </FilterChip>
              <FilterChip
                active={sevFilter === "orange"}
                onClick={() => setSevFilter("orange")}
                disabled={sevCounts.orange === 0}
                className="bg-warning text-black"
              >
                ABNORMAL {sevCounts.orange}
              </FilterChip>
              <FilterChip
                active={sevFilter === "yellow"}
                onClick={() => setSevFilter("yellow")}
                disabled={sevCounts.yellow === 0}
                className="bg-amber-400 text-black"
              >
                WATCH {sevCounts.yellow}
              </FilterChip>
            </div>

            <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hidePaging}
                onChange={(e) => setHidePaging(e.target.checked)}
                className="h-3 w-3 accent-[hsl(var(--primary))]"
              />
              Απόκρυψη paging
            </label>

            <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
              <span>
                {visible.length} / {allRows.length}
              </span>
              {filtersActive && (
                <button
                  type="button"
                  onClick={() => { setPhaseFilter("all"); setSevFilter("all"); setHidePaging(false); setQuery(""); }}
                  className="inline-flex items-center gap-0.5 text-foreground hover:text-primary"
                >
                  <X className="h-3 w-3" /> καθαρισμός
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-[10px]">
            <span className="text-muted-foreground">Ύποπτα DROP/FAIL / ABNORMAL: {issues.length}</span>
            <button type="button" disabled={!issues.length} onClick={() => jumpIssue(-1)} className="inline-flex items-center rounded border border-border px-2 py-1 disabled:opacity-40">
              <ChevronLeft className="h-3 w-3" /> Προηγούμενο εύρημα
            </button>
            <button type="button" disabled={!issues.length} onClick={() => jumpIssue(1)} className="inline-flex items-center rounded border border-border px-2 py-1 disabled:opacity-40">
              Επόμενο εύρημα <ChevronRight className="h-3 w-3" />
            </button>
            <button type="button" disabled={endIndex < 0} onClick={() => jumpTo(timedRows[endIndex].i)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Τέλος κλήσης</button>
            <span className="text-muted-foreground">Η μετάβαση καθαρίζει τα φίλτρα ώστε να φαίνεται το context. Οι ενδείξεις χρειάζονται επιβεβαίωση.</span>
          </div>

          {/* ── Πίνακας μηνυμάτων ── */}
          <div ref={scrollRef} onScroll={reportScroll} role="region" aria-label={`Μηνύματα L3 ${side}-side`} tabIndex={0} className="relative overflow-x-auto max-h-[380px] overflow-y-auto overscroll-contain border-t border-border/60">
            <table className="w-full text-xs" aria-label={`L3 ${side}-side`}>
              <thead className="sticky top-0 bg-muted border-b border-border z-10">
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-6" />
                  <th className="px-2 py-1.5 font-semibold text-left">Φάση</th>
                  <th className="px-2 py-1.5 font-semibold text-left">Ώρα</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Δευτ.</th>
                  <th className="px-2 py-1.5 font-semibold text-left">Τεχν.</th>
                  <th className="px-2 py-1.5 font-semibold text-left">Layer</th>
                  <th className="px-2 py-1.5 font-semibold text-center">Dir</th>
                  <th className="px-2 py-1.5 font-semibold text-left">Μήνυμα</th>
                  {hasPci && <th className="px-2 py-1.5 font-semibold text-right">PCI</th>}
                  {hasArfcn && <th className="px-2 py-1.5 font-semibold text-right">ARFCN</th>}
                  {hasSip && <th className="px-2 py-1.5 font-semibold text-left">SIP</th>}
                  <th className="px-2 py-1.5 font-semibold text-right">Ειδοπ.</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ r, i, h, timestamp }) => {
                  const paging = isPagingRow(r);
                  const dir = (r.Direction || "").toUpperCase();
                  const isOpen = expanded === i;
                  return (
                    <Fragment key={i}>
                      <tr
                        ref={(element) => { if (element) rowRefs.current.set(i, element); else rowRefs.current.delete(i); }}
                        data-message-index={i}
                        onClick={() => setExpanded(isOpen ? null : i)}
                        onMouseEnter={() => onHoverTime?.(Number.isFinite(timestamp) ? timestamp : null)}
                        onMouseLeave={() => onHoverTime?.(null)}
                        title={h.reason || undefined}
                        className={`border-b border-border/40 cursor-pointer transition-colors hover:bg-muted/50 ${
                          SEV_ROW_CLASS[h.severity]
                        } ${isOpen ? "bg-muted/60" : ""} ${paging ? " opacity-50" : ""}`}
                      >
                        <td className="pl-1 align-middle">
                          <button type="button" aria-label={`Λεπτομέρειες ${msgLabel(r)}`} aria-expanded={isOpen} onClick={(event) => { event.stopPropagation(); setExpanded(isOpen ? null : i); }}>
                            <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                          </button>
                        </td>
                        <td className={`px-2 py-1 font-medium ${PHASE_CLASS[r.Phase] ?? ""}`}>
                          <span className="inline-flex items-center gap-1">
                            <span className={`h-1.5 w-1.5 rounded-full ${PHASE_DOT[r.Phase] ?? "bg-muted-foreground"}`} />
                            {r.Phase}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-mono whitespace-nowrap">{fmtTime(r.MsgTime)}</td>
                        <td
                          className={`px-2 py-1 font-mono text-right whitespace-nowrap ${
                            r.SecondsFromCallStart != null && r.SecondsFromCallStart < 0
                              ? "text-muted-foreground"
                              : "text-foreground"
                          }`}
                        >
                          {fmtOffset(r.SecondsFromCallStart)}
                        </td>
                        <td className="px-2 py-1">
                          <span className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold ${techClass(r.Technology)}`}>
                            {r.Technology ?? "—"}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">{r.Layer ?? "—"}</td>
                        <td className="px-2 py-1 text-center">
                          {dir === "D" ? (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-accent" title="Downlink">
                              <ArrowDown className="h-3 w-3" />DL
                            </span>
                          ) : dir === "U" ? (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-primary" title="Uplink">
                              <ArrowUp className="h-3 w-3" />UL
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{r.Direction ?? "—"}</span>
                          )}
                        </td>
                        <td className="px-2 py-1 max-w-[260px] truncate font-medium" title={r.MsgName ?? ""}>
                          {msgLabel(r)}
                        </td>
                        {hasPci && <td className="px-2 py-1 font-mono text-right">{r.PCI ?? "—"}</td>}
                        {hasArfcn && <td className="px-2 py-1 font-mono text-right">{r.ARFCN ?? "—"}</td>}
                        {hasSip && <td className="px-2 py-1 font-mono text-[10px]">{r.SIPResponse ?? "—"}</td>}
                        <td className="px-2 py-1 text-right whitespace-nowrap">
                          {SEV_LABEL[h.severity] ? (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${SEV_BADGE_CLASS[h.severity]}`}>
                              {SEV_LABEL[h.severity]}
                            </span>
                          ) : h.severity !== "none" ? (
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${SEV_DOT_COLOR[h.severity]}`} />
                          ) : null}
                        </td>
                      </tr>

                      {/* Expanded — ολόκληρο το raw message + τα πεδία που δεν χωρούν στη γραμμή */}
                      {isOpen && (
                        <tr className={`border-b border-border/40 ${SEV_ROW_CLASS[h.severity]}`}>
                          <td />
                          <td colSpan={colCount} className="px-2 pb-2 pt-0">
                            <div className="rounded border border-border/60 bg-muted/30 p-2 space-y-2">
                              {h.reason && (
                                <p className={`text-[11px] font-medium ${SEV_BADGE_CLASS[h.severity]} bg-transparent px-0`}>
                                  ⚠ {h.reason}
                                </p>
                              )}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[10px]">
                                {([
                                  ["MsgName", r.MsgName],
                                  ["SimpleMsgName", r.SimpleMsgName],
                                  ["Category", r.Category],
                                  ["Class", r.Class],
                                  ["SIP Response", r.SIPResponse],
                                  ["SIP Call-Id", r.SIPCallId],
                                  ["PCI", r.PCI != null ? String(r.PCI) : null],
                                  ["ARFCN", r.ARFCN != null ? String(r.ARFCN) : null],
                                ] as [string, string | null][])
                                  .filter(([, v]) => v != null && v !== "")
                                  .map(([label, v]) => (
                                    <div key={label} className="flex gap-1.5">
                                      <span className="text-muted-foreground shrink-0">{label}</span>
                                      <span className="font-mono text-foreground break-all">{v}</span>
                                    </div>
                                  ))}
                              </div>
                              {r.Message && (
                                <pre className="text-[10px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-foreground/90 border-t border-border/50 pt-2">
                                  {r.Message}
                                </pre>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {visible.length === 0 && (
                  <tr>
                    <td colSpan={colCount + 1} className="px-2 py-6 text-center text-xs text-muted-foreground">
                      Κανένα μήνυμα δεν ταιριάζει με τα φίλτρα.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function L3SignalingPanel({ l3Data, l3DataBSide, asideLocation, onHoverTime }: L3SignalingPanelProps) {
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [anchor, setAnchor] = useState<ScrollAnchor | null>(null);
  const onTimestamp = useCallback((side: Side, timestamp: number) => setAnchor({ side, timestamp }), []);
  const split = shouldSplitSignaling(asideLocation);
  if (!l3Data?.callWindow && !l3DataBSide?.callWindow) return null;
  if (!split) return <SignalingPane l3Data={l3Data} l3DataBSide={l3DataBSide} onHoverTime={onHoverTime} />;
  const canSync = !!l3Data?.l3Messages.some((row) => row.MsgTime && Number.isFinite(Date.parse(row.MsgTime)))
    && !!l3DataBSide?.l3Messages.some((row) => row.MsgTime && Number.isFinite(Date.parse(row.MsgTime)));
  return (
    <section className="space-y-2" aria-label="Σύγκριση L3 Signaling">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <Switch checked={syncEnabled} disabled={!canSync} onCheckedChange={setSyncEnabled} aria-label="Συγχρονισμός scroll βάσει timestamp" />
          Sync scroll βάσει timestamp {syncEnabled ? "ON" : "OFF"}
        </label>
        <span className="text-muted-foreground">{canSync ? "A-side ↔ B-side · πλησιέστερη ορατή ώρα · ανεξάρτητα φίλτρα" : "Ο συγχρονισμός απαιτεί μηνύματα με έγκυρη ώρα και στις δύο πλευρές."}</span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {(["A", "B"] as const).map((side) => (
          <SignalingPane key={side} fixedSide={side} l3Data={l3Data} l3DataBSide={l3DataBSide}
            syncTarget={syncEnabled && canSync ? anchor : null} onTimestamp={onTimestamp} onHoverTime={onHoverTime} />
        ))}
      </div>
    </section>
  );
}

export default L3SignalingPanel;
