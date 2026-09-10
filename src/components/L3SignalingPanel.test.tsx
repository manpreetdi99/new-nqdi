import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { L3SignalingPanel } from "./L3SignalingPanel";
import type { CallL3MessagesResponse, L3MessageRow } from "@/lib/api";
import { nearestTimestampIndex, shouldSplitSignaling } from "@/lib/signalingNavigation";

const base = Date.parse("2026-09-10T12:00:00Z");
function row(seconds: number, name = `Message ${seconds}`, overrides: Partial<L3MessageRow> = {}): L3MessageRow {
  return {
    Phase: "during", SecondsFromCallStart: seconds, MsgTime: new Date(base + seconds * 1000).toISOString(),
    SessionId: "1", Technology: "LTE", Direction: "D", Layer: "RRC", MsgName: name,
    SimpleMsgName: name, Category: null, Class: null, SIPResponse: null, CombinedMsgNameSIPResponse: null,
    SIPCallId: null, PCI: null, ARFCN: null, Message: `Payload for ${name}`, ...overrides,
  };
}
function data(rows: L3MessageRow[]): CallL3MessagesResponse {
  return {
    callWindow: { CallStart: new Date(base).toISOString(), CallEnd: new Date(base + 11000).toISOString(), callDir: "MO" },
    l3Messages: rows,
    summary: { total: rows.length, byPhase: { before: 0, during: rows.length, after: 0 }, windowBeforeSec: 10, windowAfterSec: 10 },
  };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("L3 navigation", () => {
  it("splits only a known non-GSM ASideLocation, ignoring case", () => {
    expect(shouldSplitSignaling("Cosmote Free A")).toBe(true);
    for (const location of [null, undefined, "", "  ", "Cosmote GsM A", "GSM900"]) expect(shouldSplitSignaling(location)).toBe(false);
  });

  it("finds nearest timestamps including boundaries, duplicates and invalid targets", () => {
    expect(nearestTimestampIndex([], 1)).toBe(-1);
    expect(nearestTimestampIndex([1, 4], NaN)).toBe(-1);
    expect(nearestTimestampIndex([1, 4, 4, 10], 4)).toBe(1);
    expect(nearestTimestampIndex([1, 4, 10], 7)).toBe(1);
    expect(nearestTimestampIndex([1, 4, 10], -1)).toBe(0);
    expect(nearestTimestampIndex([1, 4, 10], 50)).toBe(2);
  });

  it("shows two tables for non-GSM and the side selector for GSM", () => {
    const props = { l3Data: data([row(0)]), l3DataBSide: data([row(1)]) };
    const { rerender } = render(<L3SignalingPanel {...props} asideLocation="Free A" />);
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.getByRole("switch")).toBeChecked();
    rerender(<L3SignalingPanel {...props} asideLocation="GSM A" />);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "B-side" }));
    expect(screen.getByRole("table", { name: "L3 B-side" })).toBeInTheDocument();
  });

  it("keeps A-side usable and disables sync when B-side is unavailable", () => {
    render(<L3SignalingPanel l3Data={data([row(0)])} l3DataBSide={null} asideLocation="Free A" />);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText(/Δεν υπάρχουν διαθέσιμα L3 δεδομένα/)).toBeInTheDocument();
  });

  it("jumps to findings with context, cycles, and jumps to call end", () => {
    render(<L3SignalingPanel l3Data={data([row(0), row(4, "RRCReject"), row(8, "CANCEL"), row(11)])} l3DataBSide={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Επόμενο εύρημα" }));
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Λεπτομέρειες RRCReject" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Payload for RRCReject")).toBeInTheDocument();
    expect(screen.getByText("Message 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Επόμενο εύρημα" }));
    expect(screen.getByRole("button", { name: "Λεπτομέρειες CANCEL" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Επόμενο εύρημα" }));
    expect(screen.getByRole("button", { name: "Λεπτομέρειες RRCReject" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Τέλος κλήσης" }));
    expect(screen.getByRole("button", { name: "Λεπτομέρειες Message 11" })).toHaveAttribute("aria-expanded", "true");
  });

  it("timeline clicks reveal messages hidden by filters", () => {
    render(<L3SignalingPanel l3Data={data([row(0), row(4, "RRCReject")])} l3DataBSide={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "missing" } });
    fireEvent.click(screen.getByTitle("+4.0s · RRCReject"));
    expect(screen.getByText("Payload for RRCReject")).toBeInTheDocument();
  });

  it("syncs absolute timestamps bidirectionally, ignores feedback, and supports disabling and re-enabling", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { frame = undefined; });
    const flushFrame = () => act(() => { const cb = frame; frame = undefined; cb?.(0); });
    render(<L3SignalingPanel asideLocation="Free A"
      l3Data={data([row(0), row(10), row(20), row(30)])}
      l3DataBSide={data([row(1), row(4), row(9, "B near ten", { SecondsFromCallStart: 200 }), row(21), row(29)])} />);
    const a = screen.getByRole("region", { name: "Μηνύματα L3 A-side" });
    const b = screen.getByRole("region", { name: "Μηνύματα L3 B-side" });
    // jsdom has no layout; model a sticky 24px header and 30px message rows.
    for (const region of [a, b]) {
      Object.defineProperties(region, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
      vi.spyOn(region, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
      vi.spyOn(region.querySelector("thead")!, "getBoundingClientRect").mockReturnValue({ height: 24, bottom: 24 } as DOMRect);
      region.querySelectorAll<HTMLTableRowElement>("tr[data-message-index]").forEach((element, index) => {
        vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => ({ top: 24 + index * 30 - region.scrollTop }) as DOMRect);
      });
    }
    a.scrollTop = 30;
    fireEvent.scroll(a); flushFrame();
    expect(b.scrollTop).toBe(60); // A 10s matches B 9s, not B's index or relative offset.
    fireEvent.scroll(b); flushFrame();
    expect(a.scrollTop).toBe(30); // Programmatic target scrolling must not bounce back.
    b.scrollTop = 90;
    fireEvent.scroll(b); flushFrame();
    expect(a.scrollTop).toBe(60); // B 21s matches A 20s.
    fireEvent.click(screen.getByRole("switch"));
    a.scrollTop = 0;
    fireEvent.scroll(a); flushFrame();
    expect(b.scrollTop).toBe(90);
    fireEvent.click(screen.getByRole("switch"));
    expect(b.scrollTop).toBe(0);
    expect(within(b).getByText("B near ten")).toBeInTheDocument();
  });
});
