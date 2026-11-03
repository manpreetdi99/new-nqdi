import { describe, expect, it } from "vitest";
import { extractEvidence, type CallEvidenceBundle } from "./evidence";
import { scannerEvidence } from "./scannerEvidence";

const base: CallEvidenceBundle = { analysisA: { technology: "GSM" }, analysisB: null, lteA: [], lteB: [], gsmA: [], gsmB: [], tracelog: [], l3A: [], l3B: [] };
const gsm = (...lev: number[]) => lev.map((RxLev) => ({ RxLev, CoverI: 12 }));
const withScanner = (gsmBest: { RxLev: number; CoverI: number | null }[], lteBest: { RSRP: number }[] = [], tech = "GSM"): CallEvidenceBundle => ({
  ...base,
  analysisA: { technology: tech },
  scanner: { gsmBest, lteBest, nrBest: [], servingVsScanner: null },
});

describe("scanner as radio evidence (Standard)", () => {
  it("1322849927204: phone without samples, scanner best GSM ≤ −80 → bad GSM coverage", () => {
    const b = withScanner(gsm(-83, -64, -74, -81, -86, -82, -80, -85, -79, -84));
    const scan = scannerEvidence(b);
    expect(scan.gsmLow).toBeCloseTo(0.7, 5);
    const ev = extractEvidence(b);
    expect(ev.features.gsmLowRxLev).toBeCloseTo(0.7, 5);
    expect(ev.features.radioGood).toBe(0);
    expect(ev.facts.find((f) => f.source === "scanner GSM")?.text).toContain("70% των δειγμάτων της καλύτερης GSM κυψέλης ≤ -80 dBm");
  });

  it("ignores a few weak samples (below 20%) and too few samples", () => {
    expect(scannerEvidence(withScanner(gsm(-60, -62, -65, -58, -61, -81))).gsmLow).toBe(0);
    expect(scannerEvidence(withScanner(gsm(-90, -91))).gsmLow).toBe(0);
  });

  it("counts C/I < 9 dB as interference only when the level is acceptable", () => {
    const scan = scannerEvidence(withScanner([{ RxLev: -60, CoverI: 3 }, { RxLev: -62, CoverI: 4 }, { RxLev: -85, CoverI: 2 }, { RxLev: -61, CoverI: 15 }]));
    expect(scan.gsmInterference).toBe(0.5);
  });

  it("uses only the scanner of the technology the call used", () => {
    const lteCall = withScanner(gsm(-90, -91, -92), [{ RSRP: -118 }, { RSRP: -120 }, { RSRP: -100 }], "LTE");
    const scan = scannerEvidence(lteCall);
    expect(scan.gsmLow).toBe(0);
    expect(scan.lteLow).toBeCloseTo(2 / 3, 5);
  });

  it("keeps the phone's evidence when it is worse than the scanner", () => {
    const b = { ...withScanner(gsm(-60, -61, -62)), gsmA: Array.from({ length: 5 }, () => ({ RxLevSub: -100, phase: "during" })) };
    expect(extractEvidence(b).features.gsmLowRxLev).toBe(1);
  });
});
