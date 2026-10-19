import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CallSignalChart, type SignalEvent, type SignalNetwork } from "./CallSignalChart";
import type { SignalSample } from "@/lib/signalSeries";

const T0 = Date.parse("2026-09-10T12:00:00.000Z");
const at = (seconds: number) => T0 + seconds * 1000;

const lteSamples: SignalSample[] = Array.from({ length: 20 }, (_, i) => ({
  t: at(i), RSRP: -100 - i, RSRQ: -12 - i / 10,
}));
const gsmSamples: SignalSample[] = Array.from({ length: 20 }, (_, i) => ({
  t: at(i), RxLev: -80 - i, RxQual: i % 8,
}));
const nrSamples: SignalSample[] = Array.from({ length: 20 }, (_, i) => ({
  t: at(i), NrRSRP: -90 - i, NrRSRQ: -11 - i / 10,
}));

const event = (seconds: number, label: string): SignalEvent => ({
  timestamp: at(seconds), label, detail: `${label} detail`,
  technology: "LTE", layer: "RRC", direction: "DL", color: "#06b6d4",
});

function renderChart(overrides: Partial<Parameters<typeof CallSignalChart>[0]> = {}) {
  const onHoverTime = vi.fn();
  const onPinnedChange = vi.fn();
  const props = {
    network: "LTE" as SignalNetwork,
    samples: lteSamples,
    domain: { start: at(0), end: at(19) },
    callBounds: { start: at(5), end: at(15) },
    overviewTimes: [],
    overviewLanes: [],
    events: [] as SignalEvent[],
    hoveredTime: null as number | null,
    onHoverTime,
    pinned: true,
    onPinnedChange,
    ...overrides,
  };
  const view = render(<CallSignalChart {...props} />);
  return { ...view, onHoverTime, onPinnedChange };
}

describe("CallSignalChart", () => {
  it("names the series of the call's own network", () => {
    const { unmount } = renderChart();
    expect(screen.getByRole("heading", { name: /RSRP \/ RSRQ/ })).toBeInTheDocument();
    unmount();

    const gsm = render(<CallSignalChart {...{
      network: "GSM" as SignalNetwork, samples: gsmSamples, domain: { start: at(0), end: at(19) },
      callBounds: null, overviewTimes: [], overviewLanes: [], events: [], hoveredTime: null,
      onHoverTime: vi.fn(), pinned: false, onPinnedChange: vi.fn(),
    }} />);
    expect(screen.getByRole("heading", { name: /RxLev \/ RxQual/ })).toBeInTheDocument();
    expect(screen.getByLabelText("RxQual")).toBeEnabled();
    gsm.unmount();

    render(<CallSignalChart {...{
      network: "NR" as SignalNetwork, samples: nrSamples, domain: { start: at(0), end: at(19) },
      callBounds: null, overviewTimes: [], overviewLanes: [], events: [], hoveredTime: null,
      onHoverTime: vi.fn(), pinned: false, onPinnedChange: vi.fn(),
    }} />);
    expect(screen.getByRole("heading", { name: /SS-RSRP \/ SS-RSRQ/ })).toBeInTheDocument();
  });

  it("only offers the series that actually carry data", () => {
    // Χωρίς RSRQ το checkbox ποιότητας μένει απενεργοποιημένο αντί να δείχνει άδειο άξονα.
    renderChart({ samples: lteSamples.map(({ t, RSRP }) => ({ t, RSRP })) });
    expect(screen.getByLabelText("RSRQ")).toBeDisabled();
    expect(screen.queryByLabelText(/scanner/i)).not.toBeInTheDocument();
  });

  it("keeps the NR series off by default on a call filed as plain LTE", () => {
    // Το EN-DC δίνει SS-RSRP/SS-RSRQ ακόμη και σε κλήση περασμένη ως σκέτο "LTE" στο
    // Technology. Εκεί δεν είναι το ζητούμενο, οπότε ξεκινούν κλειστές — διαθέσιμες όμως.
    // "GSM/LTE" είναι το Technology ενός SRVCC — ούτε εκεί αφορά το NR.
    for (const technology of ["LTE", "GSM/LTE"]) {
      const view = renderChart({
        technology,
        samples: lteSamples.map((sample, i) => ({ ...sample, NrRSRP: -92 - i, NrRSRQ: -11 - i / 10 })),
      });

      expect(screen.getByLabelText("RSRP")).toBeChecked();
      expect(screen.getByLabelText("RSRQ")).toBeChecked();
      for (const name of ["SS-RSRP", "SS-RSRQ"]) {
        expect(screen.getByLabelText(name)).toBeEnabled();
        expect(screen.getByLabelText(name)).not.toBeChecked();
      }

      // Κλειστές από προεπιλογή, όχι κλειδωμένες.
      fireEvent.click(screen.getByLabelText("SS-RSRP"));
      expect(screen.getByLabelText("SS-RSRP")).toBeChecked();
      view.unmount();
    }
  });

  it("starts the NR series on when the call itself touched 5G NR", () => {
    for (const technology of ["LTE/5G NR", "5G NR"]) {
      const view = renderChart({
        technology,
        samples: lteSamples.map((sample, i) => ({ ...sample, NrRSRP: -92 - i, NrRSRQ: -11 - i / 10 })),
      });
      expect(screen.getByLabelText("SS-RSRP")).toBeChecked();
      expect(screen.getByLabelText("SS-RSRQ")).toBeChecked();
      view.unmount();
    }
  });

  it("toggles the NR series independently of the LTE ones in EN-DC", () => {
    // EN-DC: το κινητό δίνει LTE RSRP/RSRQ ΚΑΙ NR SS-RSRP/SS-RSRQ στο ίδιο δείγμα — το
    // καθένα πρέπει να σβήνει μόνο του, αλλιώς δεν ξεχωρίζει ποια καμπύλη είναι ποια.
    renderChart({
      technology: "LTE/5G NR",
      samples: lteSamples.map((sample, i) => ({ ...sample, NrRSRP: -92 - i, NrRSRQ: -11 - i / 10 })),
    });

    for (const name of ["RSRP", "SS-RSRP", "RSRQ", "SS-RSRQ"]) {
      expect(screen.getByLabelText(name)).toBeEnabled();
      expect(screen.getByLabelText(name)).toBeChecked();
    }

    fireEvent.click(screen.getByLabelText("SS-RSRP"));
    expect(screen.getByLabelText("SS-RSRP")).not.toBeChecked();
    expect(screen.getByLabelText("RSRP")).toBeChecked();

    fireEvent.click(screen.getByLabelText("RSRQ"));
    expect(screen.getByLabelText("RSRQ")).not.toBeChecked();
    expect(screen.getByLabelText("SS-RSRQ")).toBeChecked();
  });

  it("offers the scanner overlay once scanner readings are present", () => {
    renderChart({ samples: lteSamples.map((s, i) => ({ ...s, ScannerStrength: -102 - i })) });
    expect(screen.getByLabelText("LTE scanner")).toBeEnabled();
    expect(screen.queryByLabelText("Best LTE scanner")).not.toBeInTheDocument();
  });

  it("offers LTE and GSM scanner side by side, whatever leg is on screen (SRVCC)", () => {
    // Σε SRVCC η καμπύλη έχει LTE και GSM κομμάτι μαζί: κάθε scanner έχει δική του σειρά,
    // ώστε να φαίνεται GSM scanner στο GSM κομμάτι ακόμα κι όταν η σελίδα δείχνει το LTE σκέλος.
    const srvcc: SignalSample[] = [
      ...lteSamples.slice(0, 10).map((s, i) => ({ ...s, ScannerStrength: -95 - i, BestScannerStrength: -90 - i })),
      ...gsmSamples.slice(10).map((s, i) => ({ ...s, GsmScannerStrength: -78 - i, GsmBestScannerStrength: -74 - i })),
    ];
    for (const network of ["LTE", "GSM"] as SignalNetwork[]) {
      const view = renderChart({ network, samples: srvcc });
      for (const name of ["LTE scanner", "Best LTE scanner", "GSM scanner", "Best GSM scanner"]) {
        expect(screen.getByLabelText(name)).not.toBeChecked();
      }
      fireEvent.click(screen.getByLabelText("GSM scanner"));
      expect(screen.getByLabelText("GSM scanner")).toBeChecked();
      expect(screen.getByLabelText("LTE scanner")).not.toBeChecked();
      view.unmount();
    }
  });

  it("labels signalling events and points the shared cursor at them on hover", () => {
    const { onHoverTime } = renderChart({ events: [event(2, "SIP INVITE"), event(12, "RRCReject")] });
    const reject = screen.getByRole("button", { name: "RRCReject" });
    expect(screen.getByRole("button", { name: "SIP INVITE" })).toBeInTheDocument();

    fireEvent.mouseEnter(reject);
    expect(onHoverTime).toHaveBeenCalledWith(at(12));
    fireEvent.mouseLeave(reject);
    expect(onHoverTime).toHaveBeenLastCalledWith(null);
  });

  it("places event labels by time, so the same second lands at the same width percent", () => {
    renderChart({ events: [event(0, "start"), event(19, "end")] });
    expect(screen.getByRole("button", { name: "start" })).toHaveStyle({ left: "0%" });
    expect(screen.getByRole("button", { name: "end" })).toHaveStyle({ left: "100%" });
  });

  it("hides the event labels when the reader turns them off", () => {
    renderChart({ events: [event(2, "SIP INVITE")] });
    const toggle = screen.getByLabelText(/Signaling events/);
    expect(screen.getByRole("button", { name: "SIP INVITE" })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "SIP INVITE" })).not.toBeInTheDocument();
  });

  it("reports pin changes so the page can stop sticking the chart to the top", () => {
    const { onPinnedChange } = renderChart({ pinned: true });
    fireEvent.click(screen.getByRole("button", { name: /Καρφιτσωμένο/ }));
    expect(onPinnedChange).toHaveBeenCalledWith(false);
  });

  it("says so plainly when there is nothing to draw", () => {
    renderChart({ samples: [{ t: at(0) }], domain: null });
    expect(screen.getByText(/Δεν υπάρχουν αρκετά δείγματα/)).toBeInTheDocument();
    expect(screen.queryByLabelText("RSRP")).not.toBeInTheDocument();
  });
});
