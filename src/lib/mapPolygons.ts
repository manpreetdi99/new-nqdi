/**
 * Custom polygons του Query Map: γεωμετρία (σημείο μέσα σε polygon) και τα
 * στατιστικά throughput των σημείων ενός layer μέσα σε ένα polygon.
 */
import type { CellValue } from "@/types/benchmark";
import { computeAvgExcludingFailed, type AvgExcludingFailed, type ColorScheme } from "@/lib/mapColorSchemes";

export type LatLngTuple = [number, number];

export interface MapPolygon {
  id: number;
  name: string;
  color: string;
  points: LatLngTuple[];
  /** Ids των χαρτών (panels) στους οποίους εφαρμόζεται το polygon */
  panels: number[];
}

export const POLYGON_COLORS = ["#2563eb", "#db2777", "#0891b2", "#9333ea", "#ea580c", "#16a34a"];

/** Ray casting σε lat/lng — αρκετά ακριβές για polygons μεγέθους πόλης/νησιού. */
export function pointInPolygon(lat: number, lng: number, poly: LatLngTuple[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Οι γραμμές του layer που πέφτουν μέσα στο polygon (με έγκυρες συντεταγμένες). */
export function rowsInPolygon(
  rows: Record<string, CellValue>[],
  latCol: string,
  lngCol: string,
  poly: LatLngTuple[],
): Record<string, CellValue>[] {
  if (poly.length < 3) return [];
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [la, ln] of poly) {
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln; if (ln > maxLng) maxLng = ln;
  }
  return rows.filter((row) => {
    const lat = Number(row[latCol]), lng = Number(row[lngCol]);
    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return false;
    // Γρήγορο bounding-box reject πριν το ray casting
    if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return false;
    return pointInPolygon(lat, lng, poly);
  });
}

/** Οι γραμμές που πέφτουν μέσα σε ΤΟΥΛΑΧΙΣΤΟΝ ένα από τα polygons (ένωση, χωρίς διπλομέτρηση). */
export function rowsInAnyPolygon(
  rows: Record<string, CellValue>[],
  latCol: string,
  lngCol: string,
  polys: LatLngTuple[][],
): Record<string, CellValue>[] {
  if (polys.length === 1) return rowsInPolygon(rows, latCol, lngCol, polys[0]);
  const inside = new Set<Record<string, CellValue>>();
  for (const poly of polys) for (const row of rowsInPolygon(rows, latCol, lngCol, poly)) inside.add(row);
  // Φιλτράρισμα του αρχικού πίνακα ⇒ κρατιέται η σειρά των γραμμών
  return rows.filter((row) => inside.has(row));
}

/** Avg throughput (χωρίς failed) των σημείων ενός layer μέσα στο polygon. */
export function polygonAvg(
  rows: Record<string, CellValue>[],
  latCol: string,
  lngCol: string,
  valueCol: string,
  scheme: ColorScheme,
  poly: LatLngTuple[],
): AvgExcludingFailed | null {
  return computeAvgExcludingFailed(rowsInPolygon(rows, latCol, lngCol, poly), valueCol, scheme);
}
