import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CsfbTransitionPanel } from "./CsfbTransitionPanel";
import type { CsfbEventRow, CsfbStepRow } from "@/lib/api";
import { mergeTransitionSeries, transitionLegStats } from "@/lib/signalSeries";

const base = Date.parse("2026-08-31T10:51:10.000Z");
const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString();

function event(overrides: Partial<CsfbEventRow> = {}): CsfbEventRow {
  return {
    Side: "A", SessionId: "1",
    FallbackStart: iso(0), FallbackEnd: iso(3200), RedirectTime: iso(160),
    ReturnStart: iso(84000), ReturnEnd: iso(85000),
    RadioRedirectMs: 164, RadioFallbackMs: 867, TechChangeMs: 1031,
    TelephonyFallbackMs: 611, CsFallbackDelayMs: null, TelephonyServiceMs: 3237, ReturnDelayMs: 988,
    ErrorCode: 0, ErrorMessage: "OK", Status: "Success", RadioGapMs: 855,
    SourceTime: iso(-7000), SourceTechnology: "LTE E-UTRA 28", SourceRFBand: 74,
    SourceCGI: "2861915-10-202", SourceCellId: 2861915, SourceLAC: 60550, SourceEARFCN: 9260, SourceOperator: "NOVA",
    TargetTime: iso(855), TargetTechnology: "GSM 900", TargetRFBand: 3, TargetCGI: "10207-30550-10-202",
    TargetCellId: 10207, TargetLAC: 30550, TargetRAC: null, TargetBCCH: 16, TargetBSIC: 42, TargetOperator: "NOVA",
    ReturnTime: iso(85000), ReturnTechnology: "LTE E-UTRA 3", ReturnCGI: "613388-10-202",
    SourceRadioTime: iso(-30), SourceRadioEARFCN: 9260, SourcePCI: 311, SourceRadioCGI: "202-10-2861915",
    SourceRSRP: -119.9, SourceRSRQ: -16, SourceSINR: -5.9,
    TargetRadioTime: iso(2400), TargetRadioBand: "GSM 900", TargetRadioCGI: "202-10-30550-10207",
    TargetRxLev: -87, TargetRxQual: 5,
    ...overrides,
  };
}

function step(overrides: Partial<CsfbStepRow> = {}): CsfbStepRow {
  return {
    Side: "A", SessionId: "1", KPIId: 10181, MsgId: 1, StepName: "Radio Redirect", Phase: "fallback",
    StartTime: iso(0), EndTime: iso(164), DurationMs: 164, ErrorCode: 0, ErrorMessage: "OK", Status: "Success",
    ...overrides,
  };
}

const lteRows = [
  { MsgTime: iso(-2000), RSRP: -118, RSRQ: -16, SINR: -5, EARFCN: 9260, PhyCellId: 311, CGI: "202-10-2861915" },
  { MsgTime: iso(-500), RSRP: -119.9, RSRQ: -16.2, SINR: -5.9, EARFCN: 9260, PhyCellId: 311, CGI: "202-10-2861915" },
];
const gsmRows = [
  { MsgTime: iso(2400), RxLevSub: -87, RxQualSub: 5, band: "GSM 900", CGI: "202-10-30550-10207" },
  { MsgTime: iso(5000), RxLevSub: -84, RxQualSub: 3, band: "GSM 900", CGI: "202-10-30550-10207" },
];

const defaults = {
  lteRows, gsmRows, lteRowsBSide: [], gsmRowsBSide: [],
  selectedSide: "A" as const, onSelectSide: vi.fn(), open: true, onOpenChange: vi.fn(),
  hoveredTime: null, onHoverTime: vi.fn(),
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("transition series helpers", () => {
  it("puts LTE and GSM samples on one timeline and keeps them apart", () => {
    const points = mergeTransitionSeries(lteRows, gsmRows);
    expect(points).toHaveLength(4);
    expect(points.map((p) => p.timestamp)).toEqual([...points.map((p) => p.timestamp)].sort((a, b) => a - b));
    expect(points[0].LTE_RSRP).toBe(-118);
    expect(points[0].GSM_RxLev).toBeUndefined();
    expect(points[3].GSM_RxLev).toBe(-84);
  });

  it("drops samples outside the window", () => {
    const points = mergeTransitionSeries(lteRows, gsmRows, { start: base, end: base + 3000 });
    expect(points.map((p) => p.timestamp)).toEqual([base + 2400]);
  });

  it("measures the radio gap around the transition, not the whole series", () => {
    const stats = transitionLegStats(mergeTransitionSeries(lteRows, gsmRows), base);
    // τελευταίο LTE πριν το cut (-500ms) → πρώτο GSM μετά (+2400ms)
    expect(stats?.radioGapMs).toBe(2900);
    expect(stats?.deltaDb).toBeCloseTo(32.9, 1);
    expect(stats?.lte?.samples).toBe(2);
    expect(stats?.gsm?.samples).toBe(2);
  });
});

describe("CsfbTransitionPanel", () => {
  it("renders nothing when the call has no CSFB leg", () => {
    const { container } = render(<CsfbTransitionPanel {...defaults} events={[]} steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the KPI durations of every phase instead of recomputing them", () => {
    render(<CsfbTransitionPanel {...defaults} events={[event()]} steps={[step()]} />);
    expect(screen.getByText(/LTE→GSM 900 Success/)).toBeInTheDocument();
    // 164ms μένει σε ms (πλακίδιο + γραμμή βήματος), 1031ms γράφεται σε δευτερόλεπτα
    expect(screen.getAllByText("164ms").length).toBeGreaterThan(0);
    expect(screen.getByText("1.03s")).toBeInTheDocument();
    expect(screen.getAllByText("3.24s").length).toBeGreaterThan(0);
  });

  it("names the failure instead of showing a bare error code", () => {
    render(<CsfbTransitionPanel {...defaults} events={[event({
      Status: "Fail", ErrorCode: 108005, ErrorMessage: "End Trigger missing",
      RadioRedirectMs: null, ReturnTime: null, ReturnDelayMs: null,
    })]} steps={[]} />);
    expect(screen.getByText("End Trigger missing")).toBeInTheDocument();
    expect(screen.getByText("Δεν καταγράφηκε")).toBeInTheDocument();
  });

  it("falls back to the side that actually did the CSFB", () => {
    // Κλήση περασμένη VoLTE: μόνο το B σκέλος έπεσε σε 2G, ενώ η σελίδα δείχνει A.
    render(<CsfbTransitionPanel
      {...defaults}
      selectedSide="A"
      events={[event({ Side: "B" })]}
      steps={[step({ Side: "B" })]}
      lteRows={[]}
      gsmRows={[]}
      lteRowsBSide={lteRows}
      gsmRowsBSide={gsmRows}
    />);
    expect(screen.getByText(/B-side · LTE E-UTRA 28/)).toBeInTheDocument();
    expect(screen.queryByText(/Δεν υπάρχουν radio δείγματα/)).not.toBeInTheDocument();
  });

  it("says so when the GSM leg has no samples rather than drawing half a chart", () => {
    render(<CsfbTransitionPanel {...defaults} events={[event()]} steps={[]} gsmRows={[]} />);
    expect(screen.getByText(/Δεν υπάρχουν GSM δείγματα/)).toBeInTheDocument();
  });

  it("lets the reader jump to the side that fell back", () => {
    const onSelectSide = vi.fn();
    render(<CsfbTransitionPanel
      {...defaults}
      onSelectSide={onSelectSide}
      events={[event(), event({ Side: "B" })]}
      steps={[]}
    />);
    fireEvent.click(screen.getByText(/B-side · LTE E-UTRA 28/));
    expect(onSelectSide).toHaveBeenCalledWith("B");
  });
});
