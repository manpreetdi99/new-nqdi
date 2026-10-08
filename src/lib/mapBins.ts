/**
 * Binning του Query Map: τα δείγματα ομαδοποιούνται στα bins της DmnBinRegion
 * (Z9 / Z8 / Z7) και κάθε bin παίρνει ΕΝΑ χρώμα από την ίδια παλέτα με τα σημεία:
 * μέση τιμή στις range κλίμακες, η συχνότερη τιμή στις category (π.χ. NR band).
 * Το query πρέπει να δίνει τα όρια κάθε bin ως `<level>_MinLat`, `<level>_MaxLat`,
 * `<level>_MinLon`, `<level>_MaxLon`.
 */
import type { CellValue } from "@/types/benchmark";
import { bucketKeyForValue, colorForValue, type ColorScheme } from "@/lib/mapColorSchemes";

export interface BinCell {
  /** [[south, west], [north, east]] — όπως το θέλει το Leaflet Rectangle */
  bounds: [[number, number], [number, number]];
  /** Κέντρο του bin (για tooltip και fit bounds) */
  lat: number;
  lng: number;
  /** Μέση τιμή (range) ή η συχνότερη τιμή (category) */
  val: CellValue;
  color: string;
  bucketKey: string | null;
  samples: number;
  /** Μόνο σε category: πλήθος δειγμάτων ανά τιμή, από το συχνότερο στο σπανιότερο */
  breakdown: [string, number][];
}

export const binBoundsCols = (level: string) => ({
  minLat: `${level}_MinLat`,
  maxLat: `${level}_MaxLat`,
  minLon: `${level}_MinLon`,
  maxLon: `${level}_MaxLon`,
});

interface Acc {
  bounds: [[number, number], [number, number]];
  sum: number;
  n: number;
  counts: Map<string, number>;
}

export function buildBins(
  rows: Record<string, CellValue>[],
  level: string,
  valueCol: string,
  scheme: ColorScheme,
): BinCell[] {
  if (!level || !valueCol) return [];
  const c = binBoundsCols(level);
  const accs = new Map<string, Acc>();
  for (const row of rows) {
    // Number(null) = 0, οπότε το null ελέγχεται ρητά: δείγμα χωρίς bin δεν μετράει
    if (row[c.minLat] == null || row[c.maxLat] == null || row[c.minLon] == null || row[c.maxLon] == null) continue;
    const s = Number(row[c.minLat]), n = Number(row[c.maxLat]);
    const w = Number(row[c.minLon]), e = Number(row[c.maxLon]);
    if (![s, n, w, e].every(Number.isFinite)) continue;
    const raw = row[valueCol];
    if (raw == null || raw === "") continue;
    const key = `${s},${w},${n},${e}`;
    let acc = accs.get(key);
    if (!acc) {
      acc = { bounds: [[s, w], [n, e]], sum: 0, n: 0, counts: new Map() };
      accs.set(key, acc);
    }
    if (scheme.type === "range") {
      const v = Number(raw);
      if (isNaN(v)) continue;
      acc.sum += v; acc.n++;
    } else {
      const k = String(raw).trim();
      acc.counts.set(k, (acc.counts.get(k) ?? 0) + 1);
      acc.n++;
    }
  }

  const out: BinCell[] = [];
  for (const acc of accs.values()) {
    if (acc.n === 0) continue;
    // Ισοπαλία ⇒ κρατιέται η τιμή που εμφανίστηκε πρώτη (σταθερή σειρά του Map)
    const breakdown = [...acc.counts.entries()].sort((a, b) => b[1] - a[1]);
    const val: CellValue = scheme.type === "range" ? acc.sum / acc.n : breakdown[0][0];
    const [[s, w], [n, e]] = acc.bounds;
    out.push({
      bounds: acc.bounds,
      lat: (s + n) / 2,
      lng: (w + e) / 2,
      val,
      color: colorForValue(scheme, val),
      bucketKey: bucketKeyForValue(scheme, val),
      samples: acc.n,
      breakdown,
    });
  }
  return out;
}

/** Πλήθος bins ανά bucket / κατηγορία του legend. */
export function countBinsByBucket(bins: BinCell[], scheme: ColorScheme): Map<string, number> {
  const counters = new Map<string, number>();
  if (scheme.type === "range") for (const b of scheme.buckets) counters.set(b.label, 0);
  else for (const c of scheme.categories) counters.set(c.value, 0);
  for (const bin of bins) {
    if (bin.bucketKey === null) continue;
    counters.set(bin.bucketKey, (counters.get(bin.bucketKey) ?? 0) + 1);
  }
  return counters;
}
