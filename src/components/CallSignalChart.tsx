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
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from "recharts";
import { Activity, Pin, PinOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SessionOverview, type OverviewLane } from "@/components/SessionOverview";
import { findMeasurementGaps, labelMeasurementGaps, layoutEventLanes, nearestIndex, type SignalSample } from "@/lib/signalSeries";

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
  /**
   * Το πεδίο Technology της κλήσης, όπως είναι περασμένο στη βάση: "LTE", "GSM",
   * "GSM/LTE", "LTE/5G NR". Κρίνει αν οι NR σειρές ξεκινούν ανοιχτές — σε κλήση
   * περασμένη σκέτα ως LTE μένουν κλειστές (βλ. nrShownByDefault).
   */
  technology?: string | null;
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
  /**
   * Η ώρα του cursor ήρθε από ΑΛΛΗ πλευρά απ' ό,τι δείχνει η καμπύλη (π.χ. κυλάς τον
   * πίνακα L3 του B-side ενώ το διάγραμμα δείχνει A-side). Το σημείο εξακολουθεί να
   * δείχνει την ίδια στιγμή στον απόλυτο χρόνο, αλλά ΔΕΝ είναι μέτρηση του ίδιου κινητού:
   * οι κουκκίδες και η γραμμή σβήνουν, ώστε το έντονο σημάδι να σημαίνει πάντα A→A / B→B.
   */
  hoverFromOtherSide?: boolean;
  /** Καρφιτσωμένο στην κορυφή κατά το scroll (το sticky wrapper είναι του γονέα). */
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  /** Επιλογείς παραθύρου / πλευράς — μπαίνουν στην κεφαλίδα του διαγράμματος. */
  controls?: ReactNode;
  subtitle?: ReactNode;
  /**
   * Περίοδοι "No service" της πλευράς που δείχνει η σελίδα (FactRadioTechnology.NetworkStatus):
   * ένα κενό μετρήσεων που καλύπτεται κυρίως από τέτοια περίοδο γράφει «No service» αντί για
   * «No measurements» — το κινητό δεν είχε δίκτυο, δεν είναι απλή απουσία καταγραφής.
   */
  noServicePeriods?: readonly { from: number; to: number }[];
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

/**
 * Σειρές ποιότητας — κάθε μία με δικό της checkbox, όπως και οι σειρές ισχύος. Το
 * SS-RSRQ έχει ΞΕΧΩΡΙΣΤΟ χρώμα από το RSRQ: πέφτουν στον ίδιο άξονα dB και με το ίδιο
 * κίτρινο ήταν αδύνατο να ξεχωρίσουν όταν είναι και τα δύο ανοιχτά (EN-DC).
 */
const QUALITY_SERIES = [
  { key: "RSRQ", name: "RSRQ", color: "hsl(45, 93%, 58%)" },
  { key: "RxQual", name: "RxQual", color: "hsl(45, 93%, 58%)" },
  { key: "NrRSRQ", name: "SS-RSRQ", color: "#f472b6" },
] as const;

/**
 * Σειρές scanner — μία ανά τεχνολογία × (κοινό / best), ΑΝΕΞΑΡΤΗΤΑ από το σκέλος που δείχνει η
 * σελίδα: σε SRVCC/CSFB η καμπύλη έχει και LTE και GSM κομμάτι, οπότε θέλει LTE scanner στο ένα
 * και GSM scanner στο άλλο ταυτόχρονα. Όλες στον άξονα ισχύος, κλειστές από προεπιλογή.
 */
// `best`: Top 1 του operator, με δικά του δείγματα — σχεδιάζεται ΠΑΝΩ από τις ζώνες «No measurements»
// (το scanner μετράει και όταν το κινητό όχι). Τα κοινά μένουν κάτω, όπως οι καμπύλες του κινητού.
const SCANNER_SERIES: readonly { key: string; name: string; color: string; dash: string; best?: boolean; title: string }[] = [
  { key: "ScannerStrength", name: "LTE scanner", color: "hsl(45, 93%, 58%)", dash: "4 3",
    title: "Ο LTE scanner στην ίδια κυψέλη με το κινητό (CGI, αλλιώς EARFCN/PCI) — σύγκριση RSRP κινητού vs scanner." },
  { key: "BestScannerStrength", name: "Best LTE scanner", color: "hsl(280, 65%, 60%)", dash: "2 2", best: true,
    title: "Top 1 RSRP του LTE scanner για τον operator της κλήσης, ανεξαρτήτως κυψέλης του κινητού." },
  { key: "GsmScannerStrength", name: "GSM scanner", color: "hsl(160, 70%, 48%)", dash: "4 3",
    title: "Ο GSM scanner στο ίδιο CGI με το κινητό — σύγκριση RxLev κινητού vs scanner." },
  { key: "GsmBestScannerStrength", name: "Best GSM scanner", color: "hsl(95, 60%, 55%)", dash: "2 2", best: true,
    title: "Top 1 RxLev του GSM scanner για τον operator της κλήσης, ανεξαρτήτως κυψέλης του κινητού." },
  { key: "NrScannerStrength", name: "5G scanner", color: "hsl(195, 85%, 60%)", dash: "4 3",
    title: "Ο 5G scanner στην ίδια κυψέλη με το κινητό (CID ή NR-ARFCN + PCI, ισχυρότερο beam) — σύγκριση SS-RSRP κινητού vs scanner." },
  { key: "NrBestScannerStrength", name: "Best 5G scanner", color: "hsl(330, 80%, 62%)", dash: "6 2 1 2", best: true,
    title: "Top 1 SS-RSRP του 5G scanner (FactNR5GScannerBeam) για τον operator της κλήσης, ανεξαρτήτως κυψέλης του κινητού." },
];

/**
 * Κενό μετρήσεων κινητού πάνω από τόσο → ζώνη «No measurements». Τα measurement reports έρχονται
 * ανά ~0.5–1.3s (και σε idle), οπότε 5s σημαίνει ότι πραγματικά δεν υπάρχουν δεδομένα.
 */
const NO_MEASUREMENTS_GAP_MS = 5_000;
// Σταθερό default, ώστε το useMemo των κενών να μην ξανατρέχει σε κάθε render
const NO_PERIODS: readonly { from: number; to: number }[] = [];

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
  network, technology, samples, domain, callBounds, overviewTimes, overviewLanes, events,
  hoveredTime, onHoverTime, hoverFromOtherSide = false, pinned, onPinnedChange, controls, subtitle,
  noServicePeriods = NO_PERIODS,
}: CallSignalChartProps) {
  // Κάθε σειρά (RSRP / SS-RSRP / RSRQ / SS-RSRQ …) έχει δικό της checkbox. Κρατάμε ΜΟΝΟ
  // όσες πείραξε ρητά ο χρήστης· οι υπόλοιπες ακολουθούν την προεπιλογή, ώστε μια σειρά
  // που εμφανίζεται αργότερα (π.χ. SS-RSRP όταν ανοίξει EN-DC) να μη θέλει αρχικοποίηση.
  const [seriesOverride, setSeriesOverride] = useState<Record<string, boolean>>({});
  // Ποιες σειρές scanner έχει ανοίξει ο χρήστης (key → true)· όλες κλειστές από προεπιλογή
  const [shownScanners, setShownScanners] = useState<Record<string, boolean>>({});
  const [showEvents, setShowEvents] = useState(true);

  /**
   * Άγγιξε η κλήση 5G NR; Σε μια κλήση περασμένη σκέτα ως "LTE" το EN-DC μπορεί να δίνει
   * SS-RSRP/SS-RSRQ δείγματα, αλλά δεν είναι αυτό που κοιτά ο αναλυτής — οι δύο επιπλέον
   * καμπύλες φορτώνουν το διάγραμμα. Μένουν διαθέσιμες με ένα κλικ.
   */
  const callTouchesNr = network === "NR"
    || (technology ?? "").toUpperCase().split(/[^A-Z0-9]+/).some((token) => token === "NR" || token === "5G");
  const shownByDefault = (key: string) =>
    callTouchesNr || (key !== "NrRSRP" && key !== "NrRSRQ");

  const isShown = (key: string) => seriesOverride[key] ?? shownByDefault(key);
  const setShown = (key: string, shown: boolean) =>
    setSeriesOverride((prev) => ({ ...prev, [key]: shown }));

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
  const qualityKeys: readonly string[] = isGsmQuality ? ["RxQual"] : ["RSRQ", "NrRSRQ"];
  // Η "βασική" σειρά του δικτύου δείχνει checkbox ακόμη κι όταν λείπουν δείγματα (απλώς
  // απενεργοποιημένο) — οι NR σειρές μπαίνουν μόνο όταν όντως υπάρχουν, ώστε μια LTE
  // κλήση χωρίς EN-DC να μη γεμίζει με νεκρά SS-RSRP/SS-RSRQ κουτάκια.
  const primaryStrengthKey = isGsmQuality ? "RxLev" : network === "NR" ? "NrRSRP" : "RSRP";
  const primaryQualityKey = isGsmQuality ? "RxQual" : network === "NR" ? "NrRSRQ" : "RSRQ";
  const strengthSeries = STRENGTH_SERIES.filter(
    (series) => present.has(series.key) || series.key === primaryStrengthKey,
  ).map((series) => ({ ...series, missing: !present.has(series.key) }));
  const qualitySeries = QUALITY_SERIES.filter(
    (series) => qualityKeys.includes(series.key) && (present.has(series.key) || series.key === primaryQualityKey),
  ).map((series) => ({ ...series, missing: !present.has(series.key) }));
  // Μόνο οι σειρές scanner που έχουν όντως δεδομένα παίρνουν checkbox
  const scannerSeries = SCANNER_SERIES.filter((series) => present.has(series.key));
  const visibleScanners = scannerSeries.filter((series) => shownScanners[series.key]);
  const scannerLine = (series: (typeof SCANNER_SERIES)[number]) => (
    <Line
      key={series.key}
      yAxisId="strength"
      type="monotone"
      dataKey={series.key}
      stroke={series.color}
      strokeDasharray={series.dash}
      dot={false}
      activeDot={false}
      strokeWidth={2}
      connectNulls
      name={series.name}
    />
  );

  // Διαστήματα του domain χωρίς μετρήσεις κινητού (και στην αρχή/στο τέλος): ο άξονας δείχνει
  // ΟΛΟ το παράθυρο ±Ns, οπότε τα κενά μένουν κενά με ένδειξη αντί να «μαζεύει» το διάγραμμα.
  const measurementGaps = useMemo(
    () => (domain ? labelMeasurementGaps(findMeasurementGaps(samples, domain, NO_MEASUREMENTS_GAP_MS), noServicePeriods) : []),
    [samples, domain, noServicePeriods],
  );

  const laidOutEvents = useMemo(
    () => (domain ? layoutEventLanes(events, domain, EVENT_LANES) : []),
    [events, domain],
  );

  // Τα κατώφλια εμφανίζονται μόνο με ΜΙΑ ενεργή σειρά, αλλιώς το διάγραμμα γεμίζει γραμμές.
  const visibleStrength = strengthSeries.filter((series) => !series.missing && isShown(series.key));
  const visibleQuality = qualitySeries.filter((series) => !series.missing && isShown(series.key));
  const activeSeriesCount =
    visibleStrength.length +
    visibleQuality.length +
    visibleScanners.length;
  const showStrengthAxis = visibleStrength.length > 0 || visibleScanners.length > 0;
  const showQualityAxis = visibleQuality.length > 0;
  const showStrengthThresholds = activeSeriesCount === 1 && showStrengthAxis;
  const showQualityThresholds = activeSeriesCount === 1 && showQualityAxis;

  const eventsVisible = showEvents && laidOutEvents.length > 0;
  const topMargin = eventsVisible ? EVENT_LANES * LANE_HEIGHT + 6 : 4;
  // Ύψος καμπύλης: το recharts Legend έχει αφαιρεθεί (διπλότυπο των checkbox από πάνω),
  // οπότε αυτά τα px είναι όλα καμπύλη — μικρότερο συνολικό block, ίδια ή μεγαλύτερη
  // ορατή καμπύλη, ώστε να χωρούν διάγραμμα + πίνακες L3 μαζί στην οθόνη.
  const plotHeight = (pinned ? 180 : 250) + topMargin;
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
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-1 border-b border-border bg-gradient-to-r from-primary/[0.07] to-transparent">
        {/* Τίτλος και υπότιτλος στην ΙΔΙΑ γραμμή — ο υπότιτλος από κάτω κόστιζε μια ολόκληρη σειρά */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-primary" />
            Σήμα κλήσης · {strengthLabel} / {qualityLabel}
          </h3>
          {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1 text-[10px] border-b border-border/60">
        {[...strengthSeries, ...qualitySeries].map((series) => (
          <label
            key={series.key}
            className={`inline-flex items-center gap-1 ${series.missing ? "opacity-40" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              disabled={series.missing}
              checked={!series.missing && isShown(series.key)}
              onChange={(e) => setShown(series.key, e.target.checked)}
              className="h-3 w-3"
              style={{ accentColor: series.color }}
            />
            {series.name}
          </label>
        ))}
        {scannerSeries.map((series) => (
          <label key={series.key} className="inline-flex items-center gap-1 cursor-pointer" title={series.title}>
            <input
              type="checkbox"
              checked={Boolean(shownScanners[series.key])}
              onChange={(e) => setShownScanners((prev) => ({ ...prev, [series.key]: e.target.checked }))}
              className="h-3 w-3"
            />
            {series.name}
          </label>
        ))}
        {laidOutEvents.length > 0 && (
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} className="h-3 w-3" />
            Signaling events ({laidOutEvents.length})
          </label>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-amber-400/30 border border-amber-400/50" />Πριν</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-blue-500/20 border border-blue-500/50" />Κατά</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-orange-400/30 border border-orange-400/50" />Μετά</span>
          {/* Το υπόμνημα του Session Overview ανέβηκε εδώ· η λεζάντα κάτω από τις λωρίδες
              έτρωγε μια ακόμη σειρά χωρίς να προσθέτει πληροφορία. */}
          {overviewLanes.length > 0 && (
            <span className="flex items-center gap-1 border-l border-border/60 pl-2" title="Session Overview · 1η λωρίδα: IDLE / CALL · 2η λωρίδα: τεχνολογία / band">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#4b5563" }} />IDLE
              <span className="ml-1 inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#dc2626" }} />CALL
            </span>
          )}
        </span>
      </div>

      {/* ── Καμπύλη ── */}
      <div className="relative px-3 pb-1" style={{ height: plotHeight }}>
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
            {visibleStrength.map((series) => (
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
                    ? <circle key={series.key} cx={props.cx} cy={props.cy} r={hoverFromOtherSide ? 3.5 : 4.5} fill={series.color} stroke="white" strokeWidth={1.5} opacity={hoverFromOtherSide ? 0.35 : 1} />
                    : <g key={`${series.key}-${props.index}`} />}
              />
            ))}
            {visibleScanners.filter((series) => !series.best).map(scannerLine)}
            {visibleQuality.map((series) => (
              <Line
                key={series.key}
                yAxisId={qualityAxisId}
                type="monotone"
                dataKey={series.key}
                stroke={series.color}
                strokeWidth={1.5}
                connectNulls
                name={series.name}
                activeDot={false}
                dot={(props: { index?: number; cx?: number; cy?: number }) =>
                  props.index === highlightIndex && props.cx != null && props.cy != null
                    ? <circle key={series.key} cx={props.cx} cy={props.cy} r={hoverFromOtherSide ? 3.5 : 4.5} fill={series.color} stroke="white" strokeWidth={1.5} opacity={hoverFromOtherSide ? 0.35 : 1} />
                    : <g key={`${series.key}-${props.index}`} />}
              />
            ))}

            {/* «No measurements»: ΠΑΝΩ από τις καμπύλες (σειρά στο SVG), ώστε η γραμμή που τα
                connectNulls ενώνουν πάνω από ένα κενό να μη φαίνεται — το κενό μένει κενό */}
            {(showStrengthAxis || showQualityAxis) && measurementGaps.map((gap) => {
              const noService = gap.reason === "no-service";
              return (
                <ReferenceArea
                  key={`gap-${gap.from}`}
                  yAxisId={showStrengthAxis ? "strength" : qualityAxisId}
                  x1={gap.from}
                  x2={gap.to}
                  fill="hsl(var(--card))"
                  fillOpacity={0.92}
                  stroke={noService ? "#ef4444" : "hsl(var(--border))"}
                  strokeOpacity={noService ? 0.7 : 1}
                  strokeDasharray="3 3"
                  label={{
                    value: noService ? "No service" : "No measurements",
                    position: "center",
                    fill: noService ? "#f87171" : "hsl(var(--muted-foreground))",
                    fontSize: 10,
                    fontWeight: noService ? 600 : 400,
                  }}
                />
              );
            })}

            {/* Best scanner ΠΑΝΩ από τις ζώνες «No measurements»: έχει δικά του δείγματα, οπότε
                δείχνει τι έβλεπε το δίκτυο όσο το κινητό δεν μετρούσε */}
            {visibleScanners.filter((series) => series.best).map(scannerLine)}

            {/* Κοινός cursor: δείχνει το δείγμα που αντιστοιχεί σε ό,τι έχει το ποντίκι από πάνω */}
            {highlightTime != null && (showStrengthAxis || showQualityAxis) && (
              <ReferenceLine
                x={highlightTime}
                yAxisId={showStrengthAxis ? "strength" : qualityAxisId}
                stroke="hsl(180, 90%, 55%)"
                strokeWidth={2}
                strokeOpacity={hoverFromOtherSide ? 0.35 : 1}
                strokeDasharray={hoverFromOtherSide ? "3 3" : undefined}
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

      {/* ── Session Overview: κάτω από την καμπύλη, στο ίδιο domain και plot area ── */}
      {overviewLanes.length > 0 && (
        <div className="px-3 pb-1.5" title="Session Overview · 1η λωρίδα: IDLE / CALL · 2η λωρίδα: τεχνολογία / band">
          <SessionOverview
            times={overviewTimes}
            lanes={overviewLanes}
            callStart={callBounds?.start ?? null}
            callEnd={callBounds?.end ?? null}
            padLeft={padLeft}
            padRight={padRight}
            hoverTime={hoveredTime}
            onHoverTime={onHoverTime}
            compact
            showTicks={false}
          />
        </div>
      )}
    </div>
  );
}

export default CallSignalChart;
