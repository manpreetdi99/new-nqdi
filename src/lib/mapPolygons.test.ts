import { describe, it, expect } from "vitest";
import { pointInPolygon, polygonAvg, rowsInAnyPolygon, rowsInPolygon, type LatLngTuple } from "@/lib/mapPolygons";
import { COLOR_SCHEMES } from "@/lib/mapColorSchemes";

// Τετράγωνο 35–36 lat, 27–28 lng (περίπου Κάρπαθος)
const SQUARE: LatLngTuple[] = [[35, 27], [35, 28], [36, 28], [36, 27]];

describe("pointInPolygon", () => {
  it("finds points inside and outside a square", () => {
    expect(pointInPolygon(35.5, 27.5, SQUARE)).toBe(true);
    expect(pointInPolygon(36.5, 27.5, SQUARE)).toBe(false);
    expect(pointInPolygon(35.5, 28.5, SQUARE)).toBe(false);
  });

  it("handles a concave polygon", () => {
    // Σχήμα «U»: η εσοχή στη μέση δεν ανήκει στο polygon
    const u: LatLngTuple[] = [[0, 0], [0, 3], [3, 3], [3, 2], [1, 2], [1, 1], [3, 1], [3, 0]];
    expect(pointInPolygon(0.5, 1.5, u)).toBe(true);
    expect(pointInPolygon(2, 1.5, u)).toBe(false);
  });
});

describe("polygonAvg", () => {
  const rows = [
    { latitude: 35.2, longitude: 27.2, dl_mbps: 100 },
    { latitude: 35.4, longitude: 27.4, dl_mbps: 300 },
    { latitude: 35.6, longitude: 27.6, dl_mbps: 0 },      // failed
    { latitude: 37.0, longitude: 27.5, dl_mbps: 999 },    // εκτός polygon
    { latitude: 0, longitude: 0, dl_mbps: 999 },           // χωρίς συντεταγμένες
  ];

  it("keeps only rows inside the polygon", () => {
    expect(rowsInPolygon(rows, "latitude", "longitude", SQUARE)).toHaveLength(3);
  });

  it("counts a row inside two overlapping polygons once", () => {
    const half: LatLngTuple[] = [[35, 27], [35, 27.5], [36, 27.5], [36, 27]];
    const far: LatLngTuple[] = [[36.9, 27.4], [36.9, 27.6], [37.1, 27.6], [37.1, 27.4]];
    expect(rowsInAnyPolygon(rows, "latitude", "longitude", [SQUARE, half, far])).toEqual([rows[0], rows[1], rows[2], rows[3]]);
  });

  it("averages without the failed points and counts them separately", () => {
    const s = polygonAvg(rows, "latitude", "longitude", "dl_mbps", COLOR_SCHEMES.ookla_dl, SQUARE);
    expect(s).toEqual({ avg: 200, unit: "Mbps", n: 2, failed: 1 });
  });

  it("returns null for schemes without a failed bucket", () => {
    expect(polygonAvg(rows, "latitude", "longitude", "dl_mbps", COLOR_SCHEMES.rsrp_data, SQUARE)).toBeNull();
  });
});
