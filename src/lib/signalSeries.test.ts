import { describe, it, expect } from "vitest";

import {
  attachNearest,
  findMeasurementGaps,
  labelMeasurementGaps,
  layoutEventLanes,
  mergeSignalSamples,
  nearestIndex,
  percentOfTime,
  sampleDomain,
  toNumber,
  toTimestamp,
  type SignalSample,
} from "./signalSeries";

const T0 = Date.parse("2026-09-10T12:00:00.000Z");
const at = (offsetMs: number) => T0 + offsetMs;

describe("signal series", () => {
  it("keeps null and empty apart from a real zero", () => {
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber("")).toBeUndefined();
    expect(toNumber("not a number")).toBeUndefined();
    expect(toNumber(0)).toBe(0);
    expect(toNumber("-97.5")).toBe(-97.5);
    expect(toTimestamp(null)).toBeNaN();
    expect(toTimestamp("2026-09-10T12:00:00.000Z")).toBe(T0);
  });

  it("merges series on the timestamp, filling fields instead of clobbering rows", () => {
    const merged = mergeSignalSamples([
      [{ t: at(1000), RSRP: -100 }, { t: at(0), RSRP: -95 }],
      [{ t: at(0), RxLev: -80 }, { t: at(500), RxLev: -82 }],
      [{ t: Number.NaN, RSRP: -1 }],
    ]);
    expect(merged.map((s) => s.t)).toEqual([at(0), at(500), at(1000)]);
    // Το ίδιο timestamp από δύο δίκτυα δίνει ΕΝΑ row με δύο σειρές, όχι δύο rows.
    expect(merged[0]).toEqual({ t: at(0), RSRP: -95, RxLev: -80 });
    expect(merged[1]).toEqual({ t: at(500), RxLev: -82 });
  });

  it("lets a later group overwrite, but never with undefined", () => {
    const merged = mergeSignalSamples([
      [{ t: at(0), RSRP: -95, RSRQ: -12 }],
      [{ t: at(0), RSRP: -90, RSRQ: undefined }],
    ]);
    expect(merged).toEqual([{ t: at(0), RSRP: -90, RSRQ: -12 }]);
  });

  it("reports a domain only when there is something to span", () => {
    expect(sampleDomain([])).toBeNull();
    expect(sampleDomain([{ t: at(0) }])).toBeNull();
    expect(sampleDomain([{ t: at(0) }, { t: at(0) }])).toBeNull();
    expect(sampleDomain([{ t: at(0) }, { t: at(2000) }])).toEqual({ start: at(0), end: at(2000) });
  });

  it("maps time to width percent and clamps outside the domain", () => {
    const domain = { start: at(0), end: at(1000) };
    expect(percentOfTime(at(0), domain)).toBe(0);
    expect(percentOfTime(at(250), domain)).toBe(25);
    expect(percentOfTime(at(1000), domain)).toBe(100);
    expect(percentOfTime(at(-500), domain)).toBe(0);
    expect(percentOfTime(at(9999), domain)).toBe(100);
    expect(percentOfTime(at(0), { start: at(0), end: at(0) })).toBe(0);
  });

  it("stacks event labels into lanes by horizontal distance, not by count", () => {
    const laid = layoutEventLanes(
      [
        { timestamp: at(5000), label: "late" },
        { timestamp: at(0), label: "first" },
        { timestamp: at(100), label: "crowding first" },
        { timestamp: at(200), label: "crowding more" },
        { timestamp: at(300), label: "no lane left" },
      ],
      { start: at(0), end: at(10000) },
      3,
      12,
    );
    expect(laid.map((e) => e.label)).toEqual(["first", "crowding first", "crowding more", "no lane left", "late"]);
    // Τα τρία πρώτα απέχουν 1% το ένα από το άλλο → τρεις διαφορετικές λωρίδες.
    expect(laid.slice(0, 3).map((e) => e.lane)).toEqual([0, 1, 2]);
    // Το τέταρτο δεν χωράει πουθενά — πάει στη λωρίδα με τον περισσότερο χώρο.
    expect(laid[3].lane).toBe(0);
    // Το "late" στο 50% έχει χώρο ξανά στη λωρίδα 0.
    expect(laid[4]).toMatchObject({ lane: 0, percent: 50 });
  });

  it("attaches scanner readings to the closest sample within tolerance", () => {
    const samples: SignalSample[] = [{ t: at(0) }, { t: at(1000) }, { t: at(5000) }];
    attachNearest(samples, [
      { t: at(120), values: { ScannerStrength: -101 } },   // 120ms από το πρώτο → κολλάει εκεί
      { t: at(1400), values: { ScannerStrength: -103 } },  // 400ms από το δεύτερο → κολλάει εκεί
      { t: at(3000), values: { ScannerStrength: -104 } },  // 2s από το πλησιέστερο → αγνοείται
      { t: Number.NaN, values: { ScannerStrength: -1 } },
    ], 1000);
    expect(samples[0].ScannerStrength).toBe(-101);
    expect(samples[1].ScannerStrength).toBe(-103);
    expect(samples[2].ScannerStrength).toBeUndefined();
  });

  it("attaches only to samples of the scanner's own technology when asked (SRVCC)", () => {
    // LTE κομμάτι (RSRP) και μετά GSM (RxLev): ένα GSM scanner δείγμα κοντά στο LTE κομμάτι
    // (padding πριν το handover) ΔΕΝ πρέπει να κολλήσει εκεί — μόνο στο πλησιέστερο GSM δείγμα.
    const samples: SignalSample[] = [
      { t: at(0), RSRP: -100 }, { t: at(1000), RSRP: -101 },
      { t: at(2000), RxLev: -80 }, { t: at(3000), RxLev: -81 },
    ];
    attachNearest(samples, [
      { t: at(900), values: { GsmScannerStrength: -70 } },   // κοντά στο LTE, 1.1s από το πρώτο GSM
      { t: at(2900), values: { GsmScannerStrength: -72 } },
    ], 1000, (s) => s.RxLev != null);
    expect(samples[1].GsmScannerStrength).toBeUndefined();
    expect(samples[2].GsmScannerStrength).toBeUndefined(); // 1.1s > ανοχή 1s
    expect(samples[3].GsmScannerStrength).toBe(-72);
  });

  it("finds the stretches without UE measurements, including at the window edges", () => {
    // Παράθυρο 0–60s· μετρήσεις 10–20s και 22–30s· μετά τίποτα (η κλήση έληξε πριν το «μετά»).
    const samples: SignalSample[] = [
      ...[10, 12, 14, 16, 18, 20].map((s) => ({ t: at(s * 1000), RSRP: -100 })),
      ...[22, 24, 26, 28, 30].map((s) => ({ t: at(s * 1000), RxLev: -80 })),
      { t: at(45_000), ScannerStrength: -90 },   // μόνο scanner — δεν μετράει ως μέτρηση κινητού
    ];
    expect(findMeasurementGaps(samples, { start: at(0), end: at(60_000) }, 5000)).toEqual([
      { from: at(0), to: at(10_000) },        // αρχή: 10s χωρίς μετρήσεις
      { from: at(30_000), to: at(60_000) },   // τέλος: το «μετά» χωρίς μετρήσεις
    ]);
    // Κενό 2s ανάμεσα σε LTE και GSM < 5s → όχι «No measurements»
    expect(findMeasurementGaps(samples, { start: at(10_000), end: at(30_000) }, 5000)).toEqual([]);
  });

  it("labels a gap 'no-service' only when a No-service period covers at least half of it", () => {
    const gaps = [
      { from: at(0), to: at(10_000) },
      { from: at(20_000), to: at(30_000) },
      { from: at(40_000), to: at(50_000) },
    ];
    const noService = [
      { from: at(1_000), to: at(9_000) },     // 8/10 του πρώτου κενού
      { from: at(28_000), to: at(31_000) },   // 2/10 του δεύτερου
    ];
    expect(labelMeasurementGaps(gaps, noService).map((g) => g.reason)).toEqual([
      "no-service", "no-measurements", "no-measurements",
    ]);
    expect(labelMeasurementGaps(gaps, []).every((g) => g.reason === "no-measurements")).toBe(true);
  });

  it("finds the nearest index, preferring the earlier row on a tie", () => {
    expect(nearestIndex([], 1)).toBe(-1);
    expect(nearestIndex([1, 4], Number.NaN)).toBe(-1);
    expect(nearestIndex([0, 10, 20], 15)).toBe(1);
    expect(nearestIndex([0, 10, 20], 16)).toBe(2);
    expect(nearestIndex([0, 10, 20], -5)).toBe(0);
    expect(nearestIndex([0, 10, 20], 99)).toBe(2);
  });
});
