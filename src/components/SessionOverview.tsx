import { useMemo, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Ένα μπλοκ (bar) μιας λωρίδας του Session Overview — π.χ. "IDLE", "CALL",
 * "LTE E-UTRA 20". Τα όρια δίνονται σε epoch ms.
 */
export interface OverviewSegment {
  from: number;
  to: number;
  label: string;
  /** CSS χρώμα του μπλοκ */
  color: string;
  /** Προαιρετική επιπλέον γραμμή στο tooltip */
  detail?: string;
  /**
   * Προαιρετικό διακριτικό (π.χ. CGI κυψέλης): μπλοκ με ίδια ταμπέλα αλλά
   * διαφορετικό key μένουν χωριστά αντί να συγχωνευθούν.
   */
  key?: string;
}

/** Μια οριζόντια λωρίδα (lane) του Session Overview, π.χ. "Κατάσταση" ή "Τεχνολογία". */
export interface OverviewLane {
  name: string;
  segments: OverviewSegment[];
}

interface SessionOverviewProps {
  /**
   * Epoch ms ανά index των δειγμάτων του chart από κάτω. Η θέση κάθε segment
   * υπολογίζεται πάνω σε ΑΥΤΟ το domain (index-based, όπως ο X άξονας του
   * LineChart) ώστε οι μπάρες να πέφτουν ακριβώς πάνω από το αντίστοιχο σημείο
   * της καμπύλης RSRP/RxLev, ακόμη κι όταν τα δείγματα δεν είναι ισαπέχοντα.
   */
  times: number[];
  lanes: OverviewLane[];
  /** Padding σε px για ευθυγράμμιση με το plot area του chart (πλάτος αξόνων). */
  padLeft?: number;
  padRight?: number;
  /** Όρια κλήσης σε epoch ms — σχεδιάζονται ως κάθετες διακεκομμένες γραμμές. */
  callStart?: number | null;
  callEnd?: number | null;
}

const TICK_COUNT = 8;
const LANE_HEIGHT = 17;

function formatClock(ms: number, withMillis = false): string {
  return new Date(ms).toLocaleTimeString("el-GR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(withMillis ? { fractionalSecondDigits: 3 as const } : {}),
  });
}

/**
 * Οριζόντια χρονική επισκόπηση της συνεδρίας (τύπου Gantt) που μπαίνει πάνω από
 * το διάγραμμα RSRP/RxLev: μία λωρίδα με IDLE/CALL και μία με τις τεχνολογίες,
 * με χρονική ράγα και cursor που δείχνει την ακριβή ώρα κάτω από το ποντίκι.
 */
export function SessionOverview({
  times,
  lanes,
  padLeft = 32,
  padRight = 36,
  callStart,
  callEnd,
}: SessionOverviewProps) {
  const [cursor, setCursor] = useState<{ percent: number; time: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // epoch ms → ποσοστό πλάτους. Binary search στο πλησιέστερο δείγμα και γραμμική
  // παρεμβολή ανάμεσα στα δύο γειτονικά index, ώστε να ταιριάζει με τον X άξονα του chart.
  const percentOf = useMemo(() => {
    const n = times.length;
    return (t: number): number => {
      if (n < 2) return 0;
      if (t <= times[0]) return 0;
      if (t >= times[n - 1]) return 100;
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) lo = mid;
        else hi = mid;
      }
      const span = times[hi] - times[lo];
      const frac = span > 0 ? (t - times[lo]) / span : 0;
      return ((lo + frac) / (n - 1)) * 100;
    };
  }, [times]);

  // Η αντίστροφη πράξη του percentOf, για το readout του cursor.
  const timeAt = (percent: number): number => {
    const n = times.length;
    if (n === 0) return 0;
    if (n === 1) return times[0];
    const pos = Math.min(n - 1, Math.max(0, (percent / 100) * (n - 1)));
    const i = Math.floor(pos);
    if (i >= n - 1) return times[n - 1];
    return times[i] + (pos - i) * (times[i + 1] - times[i]);
  };

  const ticks = useMemo(() => {
    const n = times.length;
    if (n < 2) return [];
    const count = Math.min(TICK_COUNT, n);
    return Array.from({ length: count }, (_, i) => {
      const idx = Math.round((i * (n - 1)) / (count - 1));
      return { percent: (idx / (n - 1)) * 100, label: formatClock(times[idx]) };
    });
  }, [times]);

  if (times.length < 2 || lanes.every((lane) => lane.segments.length === 0)) return null;

  const boundaries = [
    { t: callStart, label: "Έναρξη κλήσης" },
    { t: callEnd, label: "Λήξη κλήσης" },
  ].filter((b): b is { t: number; label: string } => b.t != null);

  return (
    <div className="select-none pt-3.5" style={{ paddingLeft: padLeft, paddingRight: padRight }}>
      <div
        ref={trackRef}
        className="relative"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width === 0) return;
          const percent = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
          setCursor({ percent, time: timeAt(percent) });
        }}
        onMouseLeave={() => setCursor(null)}
      >
        <TooltipProvider delayDuration={120}>
          {lanes.map((lane) => (
            <div
              key={lane.name}
              className="relative mb-[2px] overflow-hidden rounded-sm bg-muted/30"
              style={{ height: LANE_HEIGHT }}
            >
              {lane.segments.map((seg, i) => {
                const left = percentOf(seg.from);
                // Ελάχιστο πλάτος ώστε πολύ σύντομα segments να παραμένουν ορατά
                const width = Math.max(percentOf(seg.to) - left, 0.4);
                return (
                  <Tooltip key={`${lane.name}-${i}-${seg.from}`}>
                    <TooltipTrigger asChild>
                      <div
                        className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-r border-black/40 text-[9px] font-semibold leading-none text-white/95"
                        style={{ left: `${left}%`, width: `${width}%`, backgroundColor: seg.color }}
                      >
                        <span className="truncate px-1">{seg.label}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[300px] text-xs">
                      <div className="font-semibold" style={{ color: seg.color }}>{seg.label}</div>
                      <div className="text-muted-foreground">{lane.name}</div>
                      <div className="font-mono">
                        {formatClock(seg.from)} → {formatClock(seg.to)} · {((seg.to - seg.from) / 1000).toFixed(1)}s
                      </div>
                      {seg.detail && <div className="text-muted-foreground">{seg.detail}</div>}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </TooltipProvider>

        {/* Όρια κλήσης — ίδια θέση με το shaded "κατά την κλήση" area του chart από κάτω */}
        {boundaries.map((b) => (
          <span
            key={b.label}
            title={`${b.label} · ${formatClock(b.t)}`}
            className="pointer-events-none absolute inset-y-0 w-px bg-primary/70"
            style={{ left: `${percentOf(b.t)}%` }}
          />
        ))}

        {/* Cursor: κάθετη γραμμή + ακριβής ώρα (ms) πάνω από τη λωρίδα */}
        {cursor && (
          <>
            <span
              className="pointer-events-none absolute inset-y-0 w-px bg-yellow-300"
              style={{ left: `${cursor.percent}%` }}
            />
            <span
              className="pointer-events-none absolute -top-[14px] whitespace-nowrap rounded-sm bg-yellow-300/90 px-1 font-mono text-[9px] font-bold leading-[13px] text-black"
              style={{
                left: `${cursor.percent}%`,
                transform: cursor.percent < 8 ? "translateX(0)" : cursor.percent > 92 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {formatClock(cursor.time, true)}
            </span>
          </>
        )}
      </div>

      {/* Χρονική ράγα */}
      <div className="relative mt-[1px] h-[13px]">
        {ticks.map((tick, i) => (
          <span key={`${tick.percent}-${i}`}>
            <span className="absolute top-0 h-[3px] w-px bg-border" style={{ left: `${tick.percent}%` }} />
            <span
              className="absolute top-[3px] font-mono text-[9px] leading-none text-muted-foreground"
              style={{
                left: `${tick.percent}%`,
                transform: i === 0 ? "translateX(0)" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {tick.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
