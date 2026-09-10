/**
 * Ενιαία σειρά σήματος για το διάγραμμα της κλήσης.
 *
 * Παλιά υπήρχαν δύο ξεχωριστά διαγράμματα: ένα με τα δείγματα της ίδιας της κλήσης
 * (categorical άξονας με time strings) και ένα με το context ±Ns γύρω της (χρονικός
 * άξονας). Εδώ όλα τα δείγματα —LTE, GSM, 5G NR, scanner— πέφτουν σε ΕΝΑΝ πίνακα
 * με κλειδί το absolute timestamp, ώστε να σχεδιάζονται σε έναν κοινό άξονα χρόνου
 * μαζί με το Session Overview και τα L3 events.
 */

/** Ένα σημείο του διαγράμματος: ό,τι μετρήθηκε σε ένα συγκεκριμένο timestamp. */
export interface SignalSample {
  /** epoch ms */
  t: number;
  RSRP?: number;
  RSRQ?: number;
  RxLev?: number;
  RxQual?: number;
  NrRSRP?: number;
  NrRSRQ?: number;
  ScannerStrength?: number;
  BestScannerStrength?: number;
}

/** Οι σειρές που μπορεί να σχεδιάσει το διάγραμμα, ανά άξονα. */
export const STRENGTH_KEYS = ["RSRP", "RxLev", "NrRSRP"] as const;
export const QUALITY_KEYS = ["RSRQ", "RxQual", "NrRSRQ"] as const;

/** null / "" / μη αριθμός → undefined, ώστε το Recharts να αφήνει κενό αντί να σχεδιάζει 0. */
export function toNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** ISO → epoch ms, ή NaN όταν λείπει/είναι άκυρο. */
export function toTimestamp(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : NaN;
}

/**
 * Συγχωνεύει πολλές σειρές σε μία, με ένα row ανά διακριτό timestamp.
 *
 * Τα πεδία που ορίζονται σε μια μεταγενέστερη ομάδα υπερισχύουν· οι ομάδες που φέρνουν
 * μόνο μερικά πεδία (π.χ. scanner) συμπληρώνουν χωρίς να σβήνουν τα υπόλοιπα. Δείγματα
 * χωρίς έγκυρο timestamp αγνοούνται.
 */
export function mergeSignalSamples(groups: SignalSample[][]): SignalSample[] {
  const byTime = new Map<number, SignalSample>();
  for (const group of groups) {
    for (const sample of group) {
      if (!Number.isFinite(sample.t)) continue;
      const existing = byTime.get(sample.t);
      if (!existing) {
        byTime.set(sample.t, { ...sample });
        continue;
      }
      for (const [key, value] of Object.entries(sample)) {
        if (key !== "t" && value !== undefined) (existing as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Το χρονικό εύρος των δειγμάτων — null όταν δεν υπάρχουν τουλάχιστον δύο. */
export function sampleDomain(samples: readonly SignalSample[]): { start: number; end: number } | null {
  if (samples.length < 2) return null;
  const start = samples[0].t;
  const end = samples[samples.length - 1].t;
  return end > start ? { start, end } : null;
}

/** Θέση ενός timestamp μέσα στο domain, ως ποσοστό πλάτους (0..100). */
export function percentOfTime(t: number, domain: { start: number; end: number }): number {
  const span = domain.end - domain.start;
  if (!(span > 0)) return 0;
  return Math.min(100, Math.max(0, ((t - domain.start) / span) * 100));
}

export interface LaneItem {
  timestamp: number;
}

/**
 * Μοιράζει τα labels των L3 events σε λωρίδες ώστε να μην πέφτουν το ένα πάνω στο άλλο.
 *
 * Η απόσταση μετριέται σε ΠΟΣΟΣΤΟ πλάτους (όχι σε αριθμό δειγμάτων, όπως πριν): με
 * χρονικό άξονα τα δείγματα δεν είναι ισαπέχοντα, οπότε το index δεν λέει τίποτα για
 * το πόσο μακριά τυπώνονται τελικά δύο ταμπέλες.
 */
export function layoutEventLanes<T extends LaneItem>(
  items: readonly T[],
  domain: { start: number; end: number },
  laneCount = 3,
  minGapPercent = 12,
): Array<T & { percent: number; lane: number }> {
  const laneLastPercent = Array.from({ length: Math.max(1, laneCount) }, () => -Infinity);
  return [...items]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item) => {
      const percent = percentOfTime(item.timestamp, domain);
      let lane = laneLastPercent.findIndex((last) => percent - last >= minGapPercent);
      if (lane === -1) lane = laneLastPercent.indexOf(Math.min(...laneLastPercent));
      laneLastPercent[lane] = percent;
      return { ...item, percent, lane };
    });
}

/**
 * Προσαρτά τιμές scanner στο πλησιέστερο δείγμα, μέσα σε ανοχή.
 *
 * Τα scanner rows έρχονται από χωριστό query και σπάνια πέφτουν ακριβώς στο ίδιο ms με
 * το measurement report του UE, οπότε το exact-match merge θα άφηνε ορφανά σημεία.
 */
export function attachNearest(
  samples: SignalSample[],
  points: readonly { t: number; values: Partial<SignalSample> }[],
  toleranceMs = 1000,
): SignalSample[] {
  if (samples.length === 0 || points.length === 0) return samples;
  const times = samples.map((s) => s.t);
  for (const point of points) {
    if (!Number.isFinite(point.t)) continue;
    const index = nearestIndex(times, point.t);
    if (index < 0 || Math.abs(times[index] - point.t) > toleranceMs) continue;
    for (const [key, value] of Object.entries(point.values)) {
      if (value !== undefined) (samples[index] as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return samples;
}

/**
 * Index του πλησιέστερου timestamp σε αύξουσα λίστα· ισοπαλία → το προηγούμενο.
 * (Ίδια σημασιολογία με το nearestTimestampIndex του signalingNavigation.)
 */
export function nearestIndex(times: readonly number[], target: number): number {
  if (!times.length || !Number.isFinite(target)) return -1;
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid] < target) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return 0;
  if (low === times.length) return low - 1;
  return target - times[low - 1] <= times[low] - target ? low - 1 : low;
}
