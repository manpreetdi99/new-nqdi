/**
 * -----------------------------------------------------------------------------
 * CallSignalChart — ΕΝΑ διάγραμμα σήματος για ολόκληρη την κλήση
 * -----------------------------------------------------------------------------
 * Αντικαθιστά τα δύο ξεχωριστά διαγράμματα που υπήρχαν πριν (το «LTE (RSRP/RSRQ)»
 * της κάρτας και το «Συμπεριφορά δικτύου ±Ns» παρακάτω), ενώνοντάς τα σε έναν κοινό
 * ΑΠΟΛΥΤΟ άξονα χρόνου. Πάνω από την καμπύλη κάθονται:
 *
 *   · το Session Overview (IDLE/CALL + τεχνολογία/band), ευθυγραμμισμένο στο ίδιο domain
 *   · οι ταμπέλες των L3/SIP/NAS events
 *   · οι ζώνες πριν / κατά / μετά την κλήση
 *
 * Οι σειρές προσαρμόζονται στο δίκτυο της κλήσης: LTE (RSRP/RSRQ), GSM (RxLev/RxQual)
 * ή 5G NR (SS-RSRP/SS-RSRQ). Σε SRVCC σχεδιάζονται και τα δύο σκέλη ισχύος στον ίδιο
 * άξονα dBm, οπότε το «σκαλοπάτι» του handover φαίνεται σε μία γραμμή.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from "recharts";
import { Activity, Pin, PinOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SessionOverview, type OverviewLane } from "@/components/SessionOverview";
import { layoutEventLanes, nearestIndex, type SignalSample } from "@/lib/signalSeries";

export type SignalNetwork = "LTE" | "GSM" | "NR";

/** Ένα L3/SIP/NAS/handover event που σημειώνεται πάνω στην καμπύλη. */
export interface SignalEvent {
  timestamp: number;
  label: string;
  detail: string;
  technology: string | null;
  layer: string | null;
  direction: string | null;
  color: string;
}

interface CallSignalChartProps {
  /** Ποιο δίκτυο ορίζει τον άξονα ποιότητας και τα κατώφλια. */
  network: SignalNetwork;
  samples: SignalSample[];
  domain: { start: number; end: number } | null;
  /** Όρια κλήσης σε epoch ms — σκιάζουν το «κατά» και χωρίζουν πριν/μετά. */
  callBounds: { start: number; end: number } | null;
  overviewTimes: number[];
  overviewLanes: OverviewLane[];
  events: SignalEvent[];
  /** Κοινός cursor: το timestamp κάτω από το ποντίκι, από οπουδήποτε στη σελίδα. */
  hoveredTime: number | null;
  onHoverTime: (time: number | null) => void;
  /** Καρφιτσωμένο στην κορυφή κατά το scroll (το sticky wrapper είναι του γονέα). */
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  /** Επιλογείς παραθύρου / πλευράς — μπαίνουν στην κεφαλίδα του διαγράμματος. */
  controls?: ReactNode;
  subtitle?: ReactNode;
}

const LANE_HEIGHT = 17;
const EVENT_LANES = 3;
const STRENGTH_AXIS_WIDTH = 38;
const QUALITY_AXIS_WIDTH = 34;
const CHART_MARGIN_RIGHT = 8;

const STRENGTH_SERIES = [
  { key: "RSRP", name: "RSRP", color: "hsl(200, 80%, 55%)" },
  { key: "RxLev", name: "RxLev", color: "#22c55e" },
  { key: "NrRSRP", name: "SS-RSRP", color: "#a855f7" },
] as const;

const SCANNER_SERIES = [
  { key: "ScannerStrength", name: "Scanner", dash: "4 3" },
  { key: "BestScannerStrength", name: "Best scanner", dash: "2 2" },
] as const;

/** Κατώφλια ανά δίκτυο — ίδιες τιμές με τις χρωματικές κλίμακες του χάρτη. */
const THRESHOLDS: Record<SignalNetwork, { strength: [number, number]; quality: [number, number] }> = {
  LTE: { strength: [-115, -120], quality: [-16, -18] },
  GSM: { strength: [-88, -92], quality: [5, 6] },
  NR: { strength: [-100, -110], quality: [-16, -18] },
};

function clock(ms: number, withMillis = false): string {
  return new Date(ms).toLocaleTimeString("el-GR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    ...(withMillis ? { fractionalSecondDigits: 3 as const } : {}),
  });
}

export function CallSignalChart({
  network, samples, domain, callBounds, overviewTimes, overviewLanes, events,
  hoveredTime, onHoverTime, pinned, onPinnedChange, controls, subtitle,
}: CallSignalChartProps) {
  const [showStrength, setShowStrength] = useState(true);
  const [showQuality, setShowQuality] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [showBScanner, setShowBScanner] = useState(false);
  const [showEvents, setShowEvents] = useState(true);

  const times = useMemo(() => samples.map((s) => s.t), [samples]);
  const highlightIndex = hoveredTime != null ? nearestIndex(times, hoveredTime) : -1;
  const highlightTime = highlightIndex >= 0 ? times[highlightIndex] : null;

  /** Ποιες σειρές έχουν έστω μία τιμή — οι υπόλοιπες δεν μπαίνουν καν στο legend. */
  const present = useMemo(() => {
    const found = new Set<string>();
    for (const sample of samples) {
      for (const key of Object.keys(sample)) {
        if (key !== "t" && sample[key as keyof SignalSample] != null) found.add(key);
      }
    }
    return found;
  }, [samples]);

  const isGsmQuality = network === "GSM";
  const qualityKeys = isGsmQuality ? (["RxQual"] as const) : (["RSRQ", "NrRSRQ"] as const);
  const hasQuality = qualityKeys.some((key) => present.has(key));
  const hasScanner = present.has("ScannerStrength");
  const hasBestScanner = present.has("BestScannerStrength");

  const laidOutEvents = useMemo(
    () => (domain ? layoutEventLanes(events, domain, EVENT_LANES) : []),
    [events, domain],
  );

  // Τα κατώφλια εμφανίζονται μόνο με ΜΙΑ ενεργή σειρά, αλλιώς το διάγραμμα γεμίζει γραμμές.
  const activeSeriesCount = [showStrength, showQuality && hasQuality, showScanner && hasScanner, showBScanner && hasBestScanner].filter(Boolean).length;
  const showStrengthAxis = showStrength || (showScanner && hasScanner) || (showBScanner && hasBestScanner);
  const showQualityAxis = showQuality && hasQuality;
  const showStrengthThresholds = activeSeriesCount === 1 && showStrengthAxis;
  const showQualityThresholds = activeSeriesCount === 1 && showQualityAxis;

  const eventsVisible = showEvents && laidOutEvents.length > 0;
  const topMargin = eventsVisible ? EVENT_LANES * LANE_HEIGHT + 6 : 4;
  const plotHeight = (pinned ? 150 : 230) + topMargin;
  // Το overview και το overlay των events πρέπει να πέφτουν πάνω στο ίδιο plot area με
  // την καμπύλη, οπότε ακολουθούν το πλάτος των αξόνων που όντως σχεδιάζονται.
  const padLeft = showStrengthAxis ? STRENGTH_AXIS_WIDTH : 0;
  const padRight = CHART_MARGIN_RIGHT + (showQualityAxis ? QUALITY_AXIS_WIDTH : 0);

  if (!domain || samples.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Σήμα κλήσης
        </h3>
        <p className="mt-2 text-xs text-muted-foreground">Δεν υπάρχουν αρκετά δείγματα σήματος για διάγραμμα.</p>
      </div>
    );
  }

  const thresholds = THRESHOLDS[network];
  const strengthLabel = network === "GSM" ? "RxLev" : network === "NR" ? "SS-RSRP" : "RSRP";
  const qualityLabel = network === "GSM" ? "RxQual" : network === "NR" ? "SS-RSRQ" : "RSRQ";
  const qualityAxisId = "quality";

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* ── Κεφαλίδα: τίτλος, επιλογείς, σειρές ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border bg-gradient-to-r from-primary/[0.07] to-transparent">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Σήμα κλήσης · {strengthLabel} / {qualityLabel}
          </h3>
          {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          <button
            type="button"
            aria-pressed={pinned}
            onClick={() => onPinnedChange(!pinned)}
            title={pinned ? "Ξεκαρφίτσωμα διαγράμματος" : "Καρφίτσωμα στην κορυφή κατά το scroll"}
            className={`inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] ${
              pinned ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"
            }`}
          >
            {pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
            {pinned ? "Καρφιτσωμένο" : "Ελεύθερο"}
          </button>
        </div>
      </div>

      {/* ── Σειρές & ζώνες ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[10px] border-b border-border/60">
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={showStrength} onChange={(e) => setShowStrength(e.target.checked)} className="h-3 w-3" />
          {strengthLabel}
        </label>
        <label className={`inline-flex items-center gap-1 ${hasQuality ? "cursor-pointer" : "opacity-40"}`}>
          <input type="checkbox" disabled={!hasQuality} checked={showQuality && hasQuality} onChange={(e) => setShowQuality(e.target.checked)} className="h-3 w-3" />
          {qualityLabel}
        </label>
        {hasScanner && (
          <label
            className="inline-flex items-center gap-1 cursor-pointer"
            title={network === "GSM"
              ? "Ο scanner στο ίδιο CGI με το κινητό — σύγκριση RxLev κινητού vs scanner στο κοινό serving CGI."
              : "Ο scanner στο ίδιο EARFCN/PCI με το κινητό — σύγκριση RSRP κινητού vs scanner στο κοινό serving cell."}
          >
            <input type="checkbox" checked={showScanner} onChange={(e) => setShowScanner(e.target.checked)} className="h-3 w-3" />
            Scanner
          </label>
        )}
        {hasBestScanner && (
          <label
            className="inline-flex items-center gap-1 cursor-pointer"
            title={network === "GSM"
              ? "Top 1 RxLev του scanner για τον operator της κλήσης."
              : "Top 1 RSRP του scanner για τον operator της κλήσης, ανεξαρτήτως EARFCN/PCI του κινητού."}
          >
            <input type="checkbox" checked={showBScanner} onChange={(e) => setShowBScanner(e.target.checked)} className="h-3 w-3" />
            Best scanner
          </label>
        )}
        {laidOutEvents.length > 0 && (
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} className="h-3 w-3" />
            Signaling events ({laidOutEvents.length})
          </label>
        )}
        <span className="ml-auto flex items-center gap-2 text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-amber-400/30 border border-amber-400/50" />Πριν</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-primary/20 border border-primary/40" />Κατά</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-orange-400/30 border border-orange-400/50" />Μετά</span>
        </span>
      </div>

      {/* ── Session Overview: ίδιο domain, ίδιο plot area ── */}
      {overviewLanes.length > 0 && (
        <div className="px-3 pt-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">Session Overview</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#4b5563" }} />IDLE</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#dc2626" }} />CALL</span>
            <span className="text-muted-foreground">· 2η λωρίδα: τεχνολογία / band</span>
          </div>
          <SessionOverview
            times={overviewTimes}
            lanes={overviewLanes}
            callStart={callBounds?.start ?? null}
            callEnd={callBounds?.end ?? null}
            padLeft={padLeft}
            padRight={padRight}
            hoverTime={hoveredTime}
            onHoverTime={onHoverTime}
          />
        </div>
      )}

      {/* ── Καμπύλη ── */}
      <div className="relative px-3 pb-2" style={{ height: plotHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={samples}
            margin={{ top: topMargin, right: CHART_MARGIN_RIGHT, left: 0, bottom: 0 }}
            onMouseMove={(state: { activeLabel?: string | number }) => {
              const value = Number(state?.activeLabel);
              if (Number.isFinite(value)) onHoverTime(value);
            }}
            onMouseLeave={() => onHoverTime(null)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[domain.start, domain.end]}
              allowDataOverflow
              tickFormatter={(value: number) => clock(value)}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              interval="preserveStartEnd"
              // Χωρίς ελάχιστο κενό το recharts τυπώνει ώρα σε κάθε tick και οι ταμπέλες
              // («03:00:07 μ.μ.») κολλάνε η μία πάνω στην άλλη σε μια καμπύλη 180 δειγμάτων.
              minTickGap={70}
            />
            {showStrengthAxis && (
              <YAxis
                yAxisId="strength"
                width={STRENGTH_AXIS_WIDTH}
                domain={[(dataMin: number) => Math.min(dataMin, network === "GSM" ? -105 : -140), (dataMax: number) => Math.max(dataMax, -60)]}
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
            )}
            {showQualityAxis && (
              <YAxis
                yAxisId={qualityAxisId}
                orientation="right"
                width={QUALITY_AXIS_WIDTH}
                reversed={isGsmQuality}
                domain={isGsmQuality ? [0, 7] : [-25, 0]}
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
            )}

            {/* Ζώνες πριν / κατά / μετά — σε απόλυτο χρόνο, ίδια θέση με το overview */}
            {callBounds && showStrengthAxis && (
              <>
                {callBounds.start > domain.start && (
                  <ReferenceArea yAxisId="strength" x1={domain.start} x2={callBounds.start} fill="#f59e0b" fillOpacity={0.18} stroke="#f59e0b" strokeOpacity={0.35} />
                )}
                <ReferenceArea yAxisId="strength" x1={Math.max(callBounds.start, domain.start)} x2={Math.min(callBounds.end, domain.end)} fill="#3b82f6" fillOpacity={0.16} stroke="#3b82f6" strokeOpacity={0.45} />
                {domain.end > callBounds.end && (
                  <ReferenceArea yAxisId="strength" x1={callBounds.end} x2={domain.end} fill="#f97316" fillOpacity={0.18} stroke="#f97316" strokeOpacity={0.35} />
                )}
              </>
            )}

            {showStrengthThresholds && thresholds.strength.map((value, i) => (
              <ReferenceLine key={`st-${value}`} y={value} yAxisId="strength" stroke={i === 0 ? "hsl(var(--warning, 45 93% 58%))" : "hsl(var(--destructive, 0 72% 51%))"} strokeDasharray="3 3" />
            ))}
            {showQualityThresholds && thresholds.quality.map((value, i) => (
              <ReferenceLine key={`ql-${value}`} y={value} yAxisId={qualityAxisId} stroke={i === 0 ? "hsl(var(--warning, 45 93% 58%))" : "hsl(var(--destructive, 0 72% 51%))"} strokeDasharray="3 3" />
            ))}

            <RechartsTooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
              itemStyle={{ color: "hsl(var(--foreground))" }}
              labelFormatter={(value: number) => clock(value, true)}
              formatter={(value: number | string, name: string) => [value != null ? Number(value).toFixed(1) : "—", name]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />

            {showStrength && STRENGTH_SERIES.filter((series) => present.has(series.key)).map((series) => (
              <Line
                key={series.key}
                yAxisId="strength"
                type="monotone"
                dataKey={series.key}
                stroke={series.color}
                strokeWidth={2}
                connectNulls
                name={series.name}
                activeDot={false}
                dot={(props: { index?: number; cx?: number; cy?: number }) =>
                  props.index === highlightIndex && props.cx != null && props.cy != null
                    ? <circle key={series.key} cx={props.cx} cy={props.cy} r={4.5} fill={series.color} stroke="white" strokeWidth={1.5} />
                    : <g key={`${series.key}-${props.index}`} />}
              />
            ))}
            {showScanner && hasScanner && (
              <Line yAxisId="strength" type="monotone" dataKey="ScannerStrength" stroke="hsl(45, 93%, 58%)" strokeDasharray={SCANNER_SERIES[0].dash} dot={false} activeDot={false} strokeWidth={2} connectNulls name="Scanner" />
            )}
            {showBScanner && hasBestScanner && (
              <Line yAxisId="strength" type="monotone" dataKey="BestScannerStrength" stroke="hsl(280, 65%, 60%)" strokeDasharray={SCANNER_SERIES[1].dash} dot={false} activeDot={false} strokeWidth={2} connectNulls name="Best scanner" />
            )}
            {showQualityAxis && qualityKeys.filter((key) => present.has(key)).map((key) => (
              <Line
                key={key}
                yAxisId={qualityAxisId}
                type="monotone"
                dataKey={key}
                stroke="hsl(45, 93%, 58%)"
                strokeWidth={1.5}
                connectNulls
                name={key === "RxQual" ? "RxQual" : key === "NrRSRQ" ? "SS-RSRQ" : "RSRQ"}
                activeDot={false}
                dot={(props: { index?: number; cx?: number; cy?: number }) =>
                  props.index === highlightIndex && props.cx != null && props.cy != null
                    ? <circle key={key} cx={props.cx} cy={props.cy} r={4.5} fill="hsl(45, 93%, 58%)" stroke="white" strokeWidth={1.5} />
                    : <g key={`${key}-${props.index}`} />}
              />
            ))}

            {/* Κοινός cursor: δείχνει το δείγμα που αντιστοιχεί σε ό,τι έχει το ποντίκι από πάνω */}
            {highlightTime != null && (showStrengthAxis || showQualityAxis) && (
              <ReferenceLine
                x={highlightTime}
                yAxisId={showStrengthAxis ? "strength" : qualityAxisId}
                stroke="hsl(180, 90%, 55%)"
                strokeWidth={2}
              />
            )}
          </LineChart>
        </ResponsiveContainer>

        {/* ── Ταμπέλες L3 events ── */}
        {eventsVisible && (
          <TooltipProvider delayDuration={120}>
            <div className="absolute pointer-events-none" style={{ left: 12 + padLeft, right: 12 + padRight, top: 0, bottom: 22 }}>
              {laidOutEvents.map((event) => {
                const translate = event.percent < 8 ? "translateX(0)" : event.percent > 92 ? "translateX(-100%)" : "translateX(-50%)";
                const labelTop = event.lane * LANE_HEIGHT;
                return (
                  <div key={`event-${event.timestamp}-${event.label}`}>
                    <span
                      className="absolute w-px opacity-80"
                      style={{ left: `${event.percent}%`, top: labelTop + 15, bottom: 0, backgroundColor: event.color }}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onMouseEnter={() => onHoverTime(event.timestamp)}
                          onMouseLeave={() => onHoverTime(null)}
                          className="absolute pointer-events-auto h-[15px] max-w-[140px] truncate rounded-sm border bg-card/95 px-1.5 text-[10px] font-semibold leading-[13px] text-foreground shadow-sm hover:z-20 hover:max-w-none"
                          style={{ left: `${event.percent}%`, top: labelTop, transform: translate, borderColor: event.color }}
                        >
                          {event.label}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[360px] text-xs">
                        <div className="font-semibold" style={{ color: event.color }}>{event.label}</div>
                        <div className="mt-1 text-muted-foreground">{clock(event.timestamp, true)}</div>
                        <div>{event.detail}</div>
                        <div className="mt-1 text-muted-foreground">
                          {[event.technology, event.layer, event.direction].filter(Boolean).join(" · ")}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

export default CallSignalChart;
