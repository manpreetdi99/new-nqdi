/**
 * CsfbTransitionPanel.tsx
 * -----------------------------------------------------------------------------
 * Το CSFB ανάλογο του «SRVCC Transition» panel του CallDetail.
 *
 * Σε μια CSFB κλήση το κινητό κάθεται σε LTE, δεν μπορεί να κάνει VoLTE, οπότε το
 * δίκτυο το ρίχνει σε 2G/3G (RRCConnectionRelease με redirect), η κλήση στήνεται
 * εκεί και στο τέλος το κινητό γυρίζει σε LTE. Το panel δείχνει αυτή τη διαδρομή
 * με τα ίδια εργαλεία που δείχνει το SRVCC τη δική του:
 *
 *   · κάρτες ανά πλευρά (A/B) με αποτέλεσμα και συνολικό χρόνο υπηρεσίας
 *   · πλακίδια ανά φάση (redirect, radio fallback, technology change, service, return)
 *   · μία καμπύλη LTE RSRP → GSM RxLev σε κοινό άξονα απόλυτου χρόνου
 *   · κάρτες source (LTE cell) / target (GSM cell) και στατιστικά ανά σκέλος
 *
 * Οι διάρκειες ΔΕΝ υπολογίζονται εδώ: έρχονται από τα "Voice(LTE CSFB)" KPIs του
 * ResultsKPI (βλ. /api/call_csfb_detail), ώστε το panel να λέει ό,τι λέει και το
 * KPI reporting, όχι μια δική μας εκδοχή.
 */

import { useMemo, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from "recharts";
import { ChevronRight, Signal } from "lucide-react";
import type { CsfbEventRow, CsfbStepRow } from "@/lib/api";
import { mergeTransitionSeries, transitionLegStats, toTimestamp } from "@/lib/signalSeries";

type Side = "A" | "B";
/** Οι γραμμές των radio πινάκων διαβάζονται χαλαρά — κάθε πηγή έχει δικά της πεδία. */
type RadioRow = Record<string, unknown> & { MsgTime?: string | null };

interface CsfbTransitionPanelProps {
  events: CsfbEventRow[];
  steps: CsfbStepRow[];
  /** Τα radio δείγματα και των δύο πλευρών· το panel διαλέγει βάσει selectedSide. */
  lteRows: readonly RadioRow[];
  gsmRows: readonly RadioRow[];
  lteRowsBSide: readonly RadioRow[];
  gsmRowsBSide: readonly RadioRow[];
  selectedSide: Side;
  onSelectSide: (side: Side) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
  error?: string | null;
  /** Κοινός cursor με τα υπόλοιπα διαγράμματα/πίνακες της σελίδας. */
  hoveredTime: number | null;
  onHoverTime: (time: number | null) => void;
}

const WINDOW_OPTIONS = ["all", 10, 30, 60] as const;
type WindowOption = (typeof WINDOW_OPTIONS)[number];

function clock(ms: number, withMillis = false): string {
  return new Date(ms).toLocaleTimeString("el-GR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    ...(withMillis ? { fractionalSecondDigits: 3 as const } : {}),
  });
}

/** ms → «1.03s» / «164ms» — οι φάσεις του CSFB κινούνται και στις δύο κλίμακες. */
function fmtMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const ms = Number(value);
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function statusClass(status: string): string {
  if (status === "Success") return "bg-success/10 text-success";
  if (status === "Fail") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

export function CsfbTransitionPanel({
  events, steps, lteRows, gsmRows, lteRowsBSide, gsmRowsBSide,
  selectedSide, onSelectSide, open, onOpenChange, loading, error,
  hoveredTime, onHoverTime,
}: CsfbTransitionPanelProps) {
  const [windowSec, setWindowSec] = useState<WindowOption>("all");
  const [showQuality, setShowQuality] = useState(false);
  const [showThresholds, setShowThresholds] = useState(true);
  const [showDots, setShowDots] = useState(false);

  const sidesWithEvents = useMemo(
    () => new Set(events.map((event) => event.Side).filter(Boolean)),
    [events],
  );
  // Η πλευρά που δείχνει η σελίδα, αν έχει CSFB· αλλιώς η πρώτη που έχει, ώστε το
  // panel να μη γίνεται άδειο επειδή η άλλη πλευρά έμεινε σε VoLTE.
  const activeEvent = useMemo(
    () => events.find((event) => (event.Side ?? "A") === selectedSide) ?? events[0] ?? null,
    [events, selectedSide],
  );
  const eventSide: Side = (activeEvent?.Side === "B" ? "B" : "A");

  const activeSteps = useMemo(
    () => steps.filter((step) => (step.Side ?? "A") === eventSide),
    [steps, eventSide],
  );

  /** Τα χρονικά σημεία της μετάβασης — και σημάδια πάνω στην καμπύλη. */
  const markers = useMemo(() => {
    if (!activeEvent) return [];
    return [
      { time: toTimestamp(activeEvent.FallbackStart), label: "Fallback start", color: "#38bdf8" },
      { time: toTimestamp(activeEvent.RedirectTime), label: "Redirect", color: "#a855f7" },
      { time: toTimestamp(activeEvent.TargetTime), label: "Camp 2G/3G", color: "#fbbf24" },
      { time: toTimestamp(activeEvent.ReturnTime), label: "Return LTE", color: "#22c55e" },
    ].filter((marker) => Number.isFinite(marker.time));
  }, [activeEvent]);

  /** Παράθυρο γύρω από τη μετάβαση — «all» = όλη η κλήση. */
  const window = useMemo(() => {
    const times = markers.map((marker) => marker.time);
    if (times.length === 0) return null;
    const first = Math.min(...times);
    const last = Math.max(...times);
    return windowSec === "all"
      ? { first, last, start: -Infinity, end: Infinity }
      : { first, last, start: first - windowSec * 1000, end: last + windowSec * 1000 };
  }, [markers, windowSec]);

  const points = useMemo(
    () => mergeTransitionSeries(
      eventSide === "B" ? lteRowsBSide : lteRows,
      eventSide === "B" ? gsmRowsBSide : gsmRows,
      window,
    ),
    [eventSide, lteRows, gsmRows, lteRowsBSide, gsmRowsBSide, window],
  );
  const legStats = useMemo(
    () => transitionLegStats(points, window?.first ?? null),
    [points, window],
  );

  const gsmMissing = points.every((point) => point.GSM_RxLev == null);

  /**
   * Ποια markers παίρνουν ταμπέλα πάνω στην καμπύλη: μόνο όσα απέχουν αρκετά από το
   * προηγούμενο ώστε να μην πέφτουν οι λέξεις η μία πάνω στην άλλη. Σε ένα τυπικό CSFB
   * οι τρεις πρώτες φάσεις τελειώνουν μέσα σε ~1s, οπότε χωράει μία ταμπέλα εκεί.
   */
  const labelledMarkers = useMemo(() => {
    if (points.length === 0) return new Set<string>();
    const span = points[points.length - 1].timestamp - points[0].timestamp;
    const minGap = span > 0 ? span * 0.08 : 0;
    const kept = new Set<string>();
    let lastLabelled: number | null = null;
    for (const marker of markers) {
      if (lastLabelled == null || marker.time - lastLabelled >= minGap) {
        kept.add(marker.label);
        lastLabelled = marker.time;
      }
    }
    return kept;
  }, [markers, points]);

  if (events.length === 0 && !loading && !error) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-2 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          className="min-w-0 text-left"
        >
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
            <Signal className="h-4 w-4 text-primary" />
            CSFB Transition
            {activeEvent && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(activeEvent.Status)}`}>
                LTE→{activeEvent.TargetTechnology ?? "2G/3G"} {activeEvent.Status}
                {activeEvent.TelephonyServiceMs != null ? ` · ${fmtMs(activeEvent.TelephonyServiceMs)}` : ""}
              </span>
            )}
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            KPI 10175/10178/10180/10181/10182/30180 · κοινός χρόνος LTE → 2G/3G ·{" "}
            {windowSec === "all" ? "όλη η κλήση" : `παράθυρο ±${windowSec}s`} · {points.length} δείγματα
          </p>
        </button>
        {sidesWithEvents.size > 1 && (
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {(["A", "B"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => onSelectSide(side)}
                className={`px-2 py-1 text-xs ${side === "B" ? "border-l border-border" : ""} ${selectedSide === side ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
              >
                {side}-side
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (loading ? (
        <p className="text-xs text-muted-foreground">Φόρτωση CSFB diagnostics...</p>
      ) : error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : (
        <>
          {/* ── Κάρτες ανά πλευρά ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {events.map((event, idx) => {
              const side = event.Side === "B" ? "B" : "A";
              const isSelected = side === eventSide;
              return (
                <button
                  key={`${event.SessionId ?? "csfb"}-${idx}`}
                  type="button"
                  onClick={() => onSelectSide(side)}
                  className={`text-left rounded border p-2 transition-colors ${isSelected ? "border-primary/70 bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold font-mono">
                      {side}-side · {event.SourceTechnology ?? "LTE"} → {event.TargetTechnology ?? "2G/3G"}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${statusClass(event.Status)}`}>
                      {event.Status}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                    <span>{event.FallbackStart ? clock(toTimestamp(event.FallbackStart), true) : "Χωρίς χρόνο"}</span>
                    <span>service <b className="font-mono text-foreground">{fmtMs(event.TelephonyServiceMs)}</b></span>
                    <span>radio gap <b className="font-mono text-foreground">{fmtMs(event.RadioGapMs)}</b></span>
                    {event.ErrorMessage && event.Status !== "Success" && (
                      <span className="text-destructive">{event.ErrorMessage}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Πλακίδια ανά φάση: πού πήγε ο χρόνος της μετάβασης ── */}
          {activeEvent && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-1.5">
              {([
                ["Radio redirect", activeEvent.RadioRedirectMs, "RRCConnectionRelease με redirect (KPI 10181)"],
                ["Radio fallback", activeEvent.RadioFallbackMs, "Redirect → camp στο 2G/3G (KPI 10180)"],
                ["Technology change", activeEvent.TechChangeMs, "Συνολική αλλαγή τεχνολογίας (KPI 10182)"],
                ["Telephony fallback", activeEvent.TelephonyFallbackMs, "Extended Service Request → πρώτο CS μήνυμα (KPI 10175)"],
                ["Telephony service", activeEvent.TelephonyServiceMs, "Extended Service Request → έτοιμη CS υπηρεσία (KPI 10178)"],
                ["Return σε LTE", activeEvent.ReturnDelayMs, "Επιστροφή σε LTE μετά την κλήση (KPI 30180)"],
              ] as const).map(([label, value, title]) => (
                <div key={label} title={title} className="rounded border border-border/60 bg-muted/20 px-2 py-1">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
                  <div className={`text-xs font-bold font-mono ${value == null ? "text-muted-foreground" : "text-foreground"}`}>
                    {fmtMs(value)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Καμπύλη μετάβασης ── */}
          {points.length > 0 ? (
            <div className="rounded border border-border/60 bg-muted/10 p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap bg-muted/40 px-2 py-0.5 rounded border border-border/50">
                  {([
                    ["Ποιότητα (RSRQ/RxQual)", showQuality, setShowQuality],
                    ["Κατώφλια", showThresholds, setShowThresholds],
                    ["Δείγματα", showDots, setShowDots],
                  ] as const).map(([label, checked, setChecked]) => (
                    <label key={label} className="flex items-center gap-1.5 text-[10px] font-medium text-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                        className="h-3 w-3 rounded-sm border-primary text-primary focus:ring-primary"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span>Παράθυρο</span>
                  <div className="inline-flex rounded border border-border overflow-hidden">
                    {WINDOW_OPTIONS.map((value, idx) => (
                      <button
                        key={String(value)}
                        type="button"
                        onClick={() => setWindowSec(value)}
                        className={`px-1.5 py-0.5 font-mono ${idx > 0 ? "border-l border-border" : ""} ${windowSec === value ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                      >
                        {value === "all" ? "όλη" : `±${value}s`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground mb-1">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-green-500" />LTE RSRP (dBm)</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-amber-400" />GSM RxLev (dBm)</span>
                {showQuality && <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-sky-400" />LTE RSRQ (dB)</span>}
                {showQuality && <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-slate-200" />GSM RxQual (0-7)</span>}
                {markers.map((marker) => (
                  <span key={marker.label} className="flex items-center gap-1">
                    <span className="inline-block w-0.5 h-3" style={{ backgroundColor: marker.color }} />
                    {marker.label}
                  </span>
                ))}
              </div>

              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={points}
                  margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                  onMouseMove={(state: { activeLabel?: string | number }) => {
                    const value = Number(state?.activeLabel);
                    if (Number.isFinite(value)) onHoverTime(value);
                  }}
                  onMouseLeave={() => onHoverTime(null)}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(value: number) => clock(value)}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    minTickGap={60}
                  />
                  <YAxis
                    yAxisId="strength"
                    width={38}
                    domain={[(min: number) => Math.min(min, -120), (max: number) => Math.max(max, -60)]}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  {showQuality && (
                    <YAxis yAxisId="db" orientation="right" width={32} domain={[-25, 0]}
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  )}
                  {showQuality && (
                    <YAxis yAxisId="rxqual" orientation="right" width={22} domain={[0, 7]} reversed hide />
                  )}

                  {/* Η ζώνη της ίδιας της μετάβασης: από την αρχή του fallback μέχρι το camp σε 2G/3G */}
                  {activeEvent && Number.isFinite(toTimestamp(activeEvent.FallbackStart)) && Number.isFinite(toTimestamp(activeEvent.TargetTime)) && (
                    <ReferenceArea
                      yAxisId="strength"
                      x1={toTimestamp(activeEvent.FallbackStart)}
                      x2={toTimestamp(activeEvent.TargetTime)}
                      fill="#f59e0b"
                      fillOpacity={0.14}
                      stroke="#f59e0b"
                      strokeOpacity={0.35}
                    />
                  )}

                  {showThresholds && (
                    <>
                      <ReferenceLine yAxisId="strength" y={-110} stroke="hsl(var(--warning, 45 93% 58%))" strokeDasharray="3 3" />
                      <ReferenceLine yAxisId="strength" y={-120} stroke="hsl(var(--destructive, 0 72% 51%))" strokeDasharray="3 3" />
                    </>
                  )}

                  {markers.map((marker) => (
                    <ReferenceLine
                      key={marker.label}
                      yAxisId="strength"
                      x={marker.time}
                      stroke={marker.color}
                      strokeWidth={1.5}
                      // Ετικέτα μόνο όταν η γραμμή δεν κολλάει στην προηγούμενη: οι τρεις
                      // πρώτες φάσεις πέφτουν συχνά μέσα σε ένα δευτερόλεπτο και οι ταμπέλες
                      // γράφονταν η μία πάνω στην άλλη. Το υπόμνημα από πάνω τις ονομάζει ούτως ή άλλως.
                      label={labelledMarkers.has(marker.label)
                        ? { value: marker.label, position: "top", fontSize: 9, fill: marker.color }
                        : undefined}
                    />
                  ))}

                  {hoveredTime != null && (
                    <ReferenceLine yAxisId="strength" x={hoveredTime} stroke="hsl(180, 90%, 55%)" strokeWidth={2} />
                  )}

                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(value: number) => clock(value, true)}
                    formatter={(value: number | string, name: string) => [value != null ? Number(value).toFixed(1) : "—", name]}
                  />

                  <Line isAnimationActive={false} yAxisId="strength" type="monotone" dataKey="LTE_RSRP" stroke="#22c55e" strokeWidth={2} connectNulls={false}
                    dot={showDots ? { r: 1.5, fill: "#22c55e" } : false} activeDot={false} name="LTE RSRP" />
                  <Line isAnimationActive={false} yAxisId="strength" type="monotone" dataKey="GSM_RxLev" stroke="#fbbf24" strokeWidth={2} connectNulls={false}
                    dot={showDots ? { r: 1.5, fill: "#fbbf24" } : false} activeDot={false} name="GSM RxLev" />
                  {showQuality && (
                    <Line isAnimationActive={false} yAxisId="db" type="monotone" dataKey="LTE_RSRQ" stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="4 2"
                      dot={false} activeDot={false} name="LTE RSRQ" />
                  )}
                  {showQuality && (
                    <Line isAnimationActive={false} yAxisId="rxqual" type="monotone" dataKey="GSM_RxQual" stroke="#e2e8f0" strokeWidth={1.5} strokeDasharray="4 2"
                      dot={false} activeDot={false} name="GSM RxQual" />
                  )}
                </LineChart>
              </ResponsiveContainer>

              {gsmMissing && (
                <p className="mt-1 text-[10px] text-amber-400">
                  Δεν υπάρχουν GSM δείγματα για την πλευρά {eventSide} — φαίνεται μόνο το LTE σκέλος.
                </p>
              )}

              {/* ── Στατιστικά ανά σκέλος ── */}
              {legStats && (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]">
                  <div className="rounded border border-border/60 bg-muted/20 p-2">
                    <div className="text-[9px] uppercase tracking-wider text-green-400 font-semibold mb-1">LTE σκέλος (RSRP)</div>
                    {legStats.lte ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                        <span>n <b className="text-foreground font-mono">{legStats.lte.samples}</b></span>
                        <span>avg <b className="text-foreground font-mono">{legStats.lte.avg.toFixed(1)}</b></span>
                        <span>min <b className="text-foreground font-mono">{legStats.lte.min.toFixed(1)}</b></span>
                        <span>max <b className="text-foreground font-mono">{legStats.lte.max.toFixed(1)}</b></span>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </div>
                  <div className="rounded border border-border/60 bg-muted/20 p-2">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Μετάβαση</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                      <span>KPI radio gap <b className="text-foreground font-mono">{fmtMs(activeEvent?.RadioGapMs)}</b></span>
                      <span>ραδιο-κενό <b className="text-foreground font-mono">{fmtMs(legStats.radioGapMs)}</b></span>
                      <span>Δ ισχύος <b className="text-foreground font-mono">{legStats.deltaDb != null ? `${legStats.deltaDb > 0 ? "+" : ""}${legStats.deltaDb.toFixed(1)} dB` : "—"}</b></span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      τελευταίο RSRP <b className="text-foreground font-mono">{legStats.lastLte?.LTE_RSRP != null ? `${legStats.lastLte.LTE_RSRP.toFixed(1)} dBm` : "—"}</b>
                      {" · "}
                      πρώτο RxLev <b className="text-foreground font-mono">{legStats.firstGsm?.GSM_RxLev != null ? `${legStats.firstGsm.GSM_RxLev.toFixed(1)} dBm` : "—"}</b>
                    </div>
                  </div>
                  <div className="rounded border border-border/60 bg-muted/20 p-2">
                    <div className="text-[9px] uppercase tracking-wider text-amber-400 font-semibold mb-1">GSM σκέλος (RxLev)</div>
                    {legStats.gsm ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                        <span>n <b className="text-foreground font-mono">{legStats.gsm.samples}</b></span>
                        <span>avg <b className="text-foreground font-mono">{legStats.gsm.avg.toFixed(1)}</b></span>
                        <span>min <b className="text-foreground font-mono">{legStats.gsm.min.toFixed(1)}</b></span>
                        <span>max <b className="text-foreground font-mono">{legStats.gsm.max.toFixed(1)}</b></span>
                        {legStats.gsmRxQual && <span>RxQual avg <b className="text-foreground font-mono">{legStats.gsmRxQual.avg.toFixed(1)}</b></span>}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              Δεν υπάρχουν radio δείγματα για την πλευρά {eventSide} στο παράθυρο της μετάβασης.
            </div>
          )}

          {/* ── Source / Target κυψέλες ── */}
          {activeEvent && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="rounded border border-border/60 bg-muted/20 p-2">
                <div className="text-[10px] uppercase tracking-wider text-green-400 font-semibold mb-1">Source LTE</div>
                <div className="text-xs font-bold">{activeEvent.SourceTechnology ?? "LTE"}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>EARFCN <b className="text-foreground">{activeEvent.SourceRadioEARFCN ?? activeEvent.SourceEARFCN ?? "—"}</b></span>
                  <span>PCI <b className="text-foreground">{activeEvent.SourcePCI ?? "—"}</b></span>
                  <span>RSRP <b className="text-foreground">{activeEvent.SourceRSRP != null ? `${activeEvent.SourceRSRP} dBm` : "—"}</b></span>
                  <span>RSRQ <b className="text-foreground">{activeEvent.SourceRSRQ != null ? `${activeEvent.SourceRSRQ} dB` : "—"}</b></span>
                  <span>SINR <b className="text-foreground">{activeEvent.SourceSINR != null ? `${activeEvent.SourceSINR} dB` : "—"}</b></span>
                  <span className="col-span-2">CGI <b className="text-foreground break-all">{activeEvent.SourceRadioCGI ?? activeEvent.SourceCGI ?? "—"}</b></span>
                </div>
              </div>

              <div className="rounded border border-border/60 bg-muted/20 p-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold mb-1">
                  Target {activeEvent.TargetTechnology ?? "2G/3G"}
                </div>
                <div className="text-xs font-bold">
                  {activeEvent.TargetTime ? clock(toTimestamp(activeEvent.TargetTime), true) : "—"}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>Cell ID <b className="text-foreground">{activeEvent.TargetCellId ?? "—"}</b></span>
                  <span>LAC <b className="text-foreground">{activeEvent.TargetLAC ?? "—"}</b></span>
                  <span>BCCH <b className="text-foreground">{activeEvent.TargetBCCH ?? "—"}</b></span>
                  <span>BSIC <b className="text-foreground">{activeEvent.TargetBSIC ?? "—"}</b></span>
                  <span>RxLev <b className="text-foreground">{activeEvent.TargetRxLev != null ? `${activeEvent.TargetRxLev} dBm` : "—"}</b></span>
                  <span>RxQual <b className="text-foreground">{activeEvent.TargetRxQual ?? "—"}</b></span>
                  <span className="col-span-2">CGI <b className="text-foreground break-all">{activeEvent.TargetRadioCGI ?? activeEvent.TargetCGI ?? "—"}</b></span>
                </div>
              </div>

              <div className="rounded border border-border/60 bg-muted/20 p-2">
                <div className="text-[10px] uppercase tracking-wider text-sky-400 font-semibold mb-1">Return σε LTE</div>
                <div className="text-xs font-bold">
                  {activeEvent.ReturnTime ? clock(toTimestamp(activeEvent.ReturnTime), true) : "Δεν καταγράφηκε"}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>Τεχνολογία <b className="text-foreground">{activeEvent.ReturnTechnology ?? "—"}</b></span>
                  <span>Καθυστέρηση <b className="text-foreground">{fmtMs(activeEvent.ReturnDelayMs)}</b></span>
                  <span className="col-span-2">CGI <b className="text-foreground break-all">{activeEvent.ReturnCGI ?? "—"}</b></span>
                  <span className="col-span-2">Operator <b className="text-foreground">{activeEvent.TargetOperator ?? activeEvent.SourceOperator ?? "—"}</b></span>
                </div>
              </div>
            </div>
          )}

          {/* ── Οι φάσεις όπως τις έγραψε το KPI, μία γραμμή η καθεμία ── */}
          {activeSteps.length > 0 && (
            <div className="overflow-x-auto rounded border border-border/50">
              <table className="w-full text-[10px] text-left">
                <thead className="bg-muted border-b border-border">
                  <tr className="uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1 font-semibold">Φάση</th>
                    <th className="px-2 py-1 font-semibold">KPI</th>
                    <th className="px-2 py-1 font-semibold">Έναρξη</th>
                    <th className="px-2 py-1 font-semibold">Λήξη</th>
                    <th className="px-2 py-1 font-semibold text-right">Διάρκεια</th>
                    <th className="px-2 py-1 font-semibold">Αποτέλεσμα</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {activeSteps.map((step, idx) => (
                    <tr
                      key={`${step.KPIId}-${step.MsgId ?? idx}`}
                      onMouseEnter={() => onHoverTime(toTimestamp(step.StartTime) || null)}
                      onMouseLeave={() => onHoverTime(null)}
                      className="hover:bg-muted/40"
                    >
                      <td className="px-2 py-0.5">
                        <span className={step.Phase === "return" ? "text-sky-400" : "text-foreground"}>{step.StepName}</span>
                      </td>
                      <td className="px-2 py-0.5 font-mono text-muted-foreground">{step.KPIId}</td>
                      <td className="px-2 py-0.5 font-mono">{step.StartTime ? clock(toTimestamp(step.StartTime), true) : "—"}</td>
                      <td className="px-2 py-0.5 font-mono">{step.EndTime ? clock(toTimestamp(step.EndTime), true) : "—"}</td>
                      <td className="px-2 py-0.5 font-mono text-right">{fmtMs(step.DurationMs)}</td>
                      <td className="px-2 py-0.5">
                        <span className={`px-1.5 py-0.5 rounded font-semibold ${statusClass(step.Status)}`}>
                          {step.Status}
                        </span>
                        {step.ErrorMessage && step.Status !== "Success" && (
                          <span className="ml-1 text-muted-foreground">{step.ErrorMessage}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ))}
    </div>
  );
}

export default CsfbTransitionPanel;
