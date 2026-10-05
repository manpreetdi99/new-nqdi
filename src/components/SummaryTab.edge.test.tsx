import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import SummaryTab, { type SummaryLoading } from "./SummaryTab";
import type { AllCallsRow, DataCallRow } from "@/lib/api";

/**
 * Edge cases του SummaryTab — άδειες βάσεις, περίεργα status/Location, toggles σε ακραίες
 * καταστάσεις, controlled/uncontrolled compact, loading/failed chips. Μερικά tests
 * ΚΑΤΑΓΡΑΦΟΥΝ την τρέχουσα συμπεριφορά (σημειωμένα "documents current behavior") χωρίς να
 * σημαίνει ότι είναι απαραίτητα η επιθυμητή.
 */

const call = (overrides: Partial<AllCallsRow>): AllCallsRow => ({
  Location: "Cosmote Free A",
  SessionId: "1",
  callMode: null,
  callType: null,
  technology: "LTE E-UTRA 3",
  callDir: "A->B",
  status: "completed",
  setupTime: null,
  CollectionName: null,
  callDuration: null,
  callStartTimeStamp: null,
  Avg_mos: null,
  latitude: null,
  longitude: null,
  comment: null,
  ...overrides,
});

const dataTest = (overrides: Partial<DataCallRow>): DataCallRow => ({
  Location: "Cosmote Data A",
  SessionId: "1",
  TestId: 1,
  callStartTimeStamp: null,
  testType: "Ookla Speedtest",
  direction: null,
  status: "Success",
  scoringStatus: "A",
  host: null,
  pingRttAvg: null,
  throughputKbps: 100000,
  capacityThroughputKbps: null,
  youtubeMos: null,
  youtubeInterruptions: null,
  interactivityQoeScore: null,
  interactivityRtt: null,
  interactivityPacketsLostRate: null,
  interactivityPacketDelay: null,
  technology: "5G",
  startTechnology: null,
  CollectionName: null,
  ASideFileName: null,
  isValid: 1,
  comment: null,
  latitude: null,
  longitude: null,
  ...overrides,
});

const loadingState = (overrides: Partial<SummaryLoading>): SummaryLoading => ({
  voice: false,
  data: false,
  technologyMix: false,
  servingBandTech: false,
  done: 10,
  totalSources: 10,
  ...overrides,
});

const repeat = (count: number, overrides: Partial<AllCallsRow>) => Array.from({ length: count }, () => call(overrides));

/** Το μεγάλο νούμερο του hero (το div αμέσως μετά το "Overall call success rate" label). */
const hero = () => screen.getByText(/Overall call success rate/).nextElementSibling as HTMLElement;

const noData = [] as DataCallRow[];

describe("SummaryTab edge cases", () => {
  beforeEach(() => window.localStorage.clear());

  describe("voice status classification", () => {
    it("all calls are System Release → excl-SR base is empty: hero shows '—', never NaN/0%", () => {
      render(<SummaryTab allCallsRows={repeat(3, { status: "System Release" })} dataCallsRows={noData} />);

      expect(hero()).toHaveTextContent("—");
      expect(screen.getByText("0 normal releases / 0 attempts")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/NaN|Infinity/);

      // Χωρίς "Avoid system release" η βάση είναι 3 → 0.0%, όχι "—".
      fireEvent.click(screen.getByRole("checkbox", { name: "Avoid system release" }));
      expect(hero()).toHaveTextContent("0.0%");
      expect(screen.getByText("0 normal releases / 3 attempts")).toBeInTheDocument();
      expect(screen.queryByText(/\(excl\. SR\)/)).not.toBeInTheDocument();
    });

    it("recognises the 'System Realase' typo and is case-insensitive for DROPPED / FAILURE", () => {
      const rows = [
        call({ status: "Completed" }),
        call({ status: "System Realase" }),
        call({ status: "DROPPED CALL" }),
        call({ status: "Access FAILURE" }),
      ];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={noData} />);

      // excl. SR: 1 completed / 3 attempts (το typo SR βγαίνει από τη βάση).
      expect(hero()).toHaveTextContent("33.3%");
      expect(screen.getByText("1 normal releases / 3 attempts")).toBeInTheDocument();
    });

    it("documents current behavior: a null / empty / unknown status counts as a normal release", () => {
      const rows = [call({ status: null }), call({ status: "" }), call({ status: "weird-status" })];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={noData} />);

      expect(hero()).toHaveTextContent("100.0%");
      expect(screen.getByText("3 normal releases / 3 attempts")).toBeInTheDocument();
    });
  });

  describe("hero colour thresholds (>95 good, 90–95 warning, <90 critical)", () => {
    it.each([
      { completed: 20, dropped: 0, color: "#0ca30c", label: "100% → good" },
      { completed: 19, dropped: 1, color: "#fab219", label: "exactly 95% → warning (not good)" },
      { completed: 9, dropped: 1, color: "#fab219", label: "exactly 90% → warning" },
      { completed: 8, dropped: 2, color: "#d03b3b", label: "80% → critical" },
    ])("$label", ({ completed, dropped, color }) => {
      const rows = [...repeat(completed, { status: "completed" }), ...repeat(dropped, { status: "Dropped" })];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={noData} />);

      expect(hero()).toHaveStyle({ color });
    });

    it("drops the colour when 'Valid calls' is off (the number is no longer the official KPI)", () => {
      render(<SummaryTab allCallsRows={repeat(2, {})} dataCallsRows={noData} />);
      expect(hero().style.color).not.toBe("");

      fireEvent.click(screen.getByRole("checkbox", { name: "Valid calls" }));
      expect(hero().style.color).toBe("");
    });
  });

  describe("Valid calls filter", () => {
    it("shows the empty state when every row is isValid=0, and brings them back when unchecked", () => {
      render(<SummaryTab allCallsRows={repeat(2, { isValid: 0 })} dataCallsRows={noData} />);

      expect(screen.getByText(/Δεν υπάρχουν δεδομένα/)).toBeInTheDocument();
      expect(screen.queryByText("Free (2G-3G-LTE-VoNR) Call Stats")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("checkbox", { name: "Valid calls" }));

      expect(screen.queryByText(/Δεν υπάρχουν δεδομένα/)).not.toBeInTheDocument();
      expect(screen.getByText("2 call attempts")).toBeInTheDocument();
    });

    it("keeps isValid=null / undefined rows (only an explicit 0 is excluded)", () => {
      const rows = [call({ isValid: null }), call({ isValid: undefined }), call({ isValid: 1 }), call({ isValid: 0 })];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={noData} />);

      expect(screen.getByText("3 call attempts")).toBeInTheDocument();
    });

    it("applies to data tests too", () => {
      render(<SummaryTab allCallsRows={[]} dataCallsRows={[dataTest({}), dataTest({ isValid: 0 })]} />);

      expect(screen.getByText("1 data tests")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox", { name: "Valid calls" }));
      expect(screen.getByText("2 data tests")).toBeInTheDocument();
    });
  });

  describe("Location / operator resolution", () => {
    it("documents current behavior: a Location without GSM/Free/Voice/Data keyword feeds the hero but no table", () => {
      render(<SummaryTab allCallsRows={repeat(2, { Location: "Cosmote A" })} dataCallsRows={noData} />);

      expect(hero()).toHaveTextContent("100.0%");
      expect(screen.getAllByText("COSMOTE").length).toBeGreaterThan(0); // legend
      expect(screen.queryByText("GSM Call Stats")).not.toBeInTheDocument();
      expect(screen.queryByText("Free (2G-3G-LTE-VoNR) Call Stats")).not.toBeInTheDocument();
      // hasData = true → ούτε empty state: η σελίδα μένει "άδεια" χωρίς εξήγηση.
      expect(screen.queryByText(/Δεν υπάρχουν δεδομένα/)).not.toBeInTheDocument();
    });

    it("a null Location becomes the UNKNOWN operator without crashing", () => {
      render(<SummaryTab allCallsRows={[call({ Location: null as unknown as string })]} dataCallsRows={noData} />);

      expect(screen.getAllByText("UNKNOWN").length).toBeGreaterThan(0);
    });

    it("maps 'Wind' to NOVA and orders known operators before unknown ones", () => {
      const rows = [call({ Location: "Acme Free A" }), call({ Location: "Wind Free A" }), call({ Location: "Vodafone_Voice_A" })];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={noData} />);

      const text = document.body.textContent ?? "";
      expect(text.indexOf("VODAFONE")).toBeGreaterThan(-1);
      expect(text.indexOf("VODAFONE")).toBeLessThan(text.indexOf("NOVA"));
      expect(text.indexOf("NOVA")).toBeLessThan(text.indexOf("ACME"));
      // "Voice" = FREE table (βλ. resolveMode) → και οι 3 στο ίδιο table.
      expect(screen.getByText("3 call attempts")).toBeInTheDocument();
    });
  });

  describe("POLQA avg", () => {
    it("ignores zero / negative / null MOS values instead of dragging the average down", () => {
      const rows = [call({ Avg_mos: 0 }), call({ Avg_mos: -1 }), call({ Avg_mos: null }), call({ Avg_mos: 4 })];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={noData} />);

      expect(screen.getAllByText("4.00").length).toBeGreaterThan(0);
      expect(screen.getByText("n=1")).toBeInTheDocument();
      expect(screen.queryByText("1.00")).not.toBeInTheDocument();
      expect(screen.queryByText("2.00")).not.toBeInTheDocument();
    });

    it("shows '—' (not 0.00) when no call has a MOS", () => {
      render(<SummaryTab allCallsRows={repeat(2, { Avg_mos: null })} dataCallsRows={noData} />);

      expect(screen.queryByText("0.00")).not.toBeInTheDocument();
      expect(screen.queryByText(/^n=/)).not.toBeInTheDocument();
    });
  });

  describe("report period", () => {
    it("shows '—' for Week/Period when every timestamp is missing or unparsable", () => {
      render(
        <SummaryTab
          allCallsRows={[call({ callStartTimeStamp: "not-a-date" }), call({ callStartTimeStamp: null })]}
          dataCallsRows={noData}
        />,
      );

      expect(screen.getByText("— – —")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/NaN/);
    });

    it("skips bad timestamps and shows a week range when the data spans several ISO weeks", () => {
      const rows = [
        call({ callStartTimeStamp: "2026-01-05T12:00:00" }), // Δευτέρα, ISO week 2
        call({ callStartTimeStamp: "garbage" }),
        call({ callStartTimeStamp: "2026-01-20T12:00:00" }), // ISO week 4
      ];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={noData} />);

      expect(screen.getByText("2 – 4")).toBeInTheDocument();
      expect(screen.getByText("05/01/2026 – 20/01/2026")).toBeInTheDocument();
    });
  });

  describe("toggles", () => {
    it("turning off 'Avoid system release' disables 'Hide incl. SR' and removes the incl. SR lines", () => {
      const rows = [call({}), call({ status: "System Release" })];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={noData} />);

      const hideInclSr = screen.getByRole("checkbox", { name: "Hide incl. SR" });
      fireEvent.click(hideInclSr); // εμφάνισε τις incl. SR γραμμές
      expect(screen.getAllByText(/incl\. SR \d/).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("checkbox", { name: "Avoid system release" }));

      expect(hideInclSr).toBeDisabled();
      expect(screen.queryByText(/incl\. SR \d/)).not.toBeInTheDocument();
      expect(screen.getAllByText("Total Calls").length).toBeGreaterThan(0);
      expect(screen.queryByText("Total Calls (excl. SR)")).not.toBeInTheDocument();
    });

    it("marks 'best' only when operators differ — a tie gets no marker, and the toggle removes it", () => {
      const differing = [
        call({ Location: "Cosmote Free A" }),
        call({ Location: "Cosmote Free A" }),
        call({ Location: "Vodafone Free A" }),
        call({ Location: "Vodafone Free A", status: "Dropped" }),
      ];
      const { unmount } = render(<SummaryTab allCallsRows={differing} dataCallsRows={noData} />);
      expect(screen.getAllByText("best").length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("checkbox", { name: "Highlight best" }));
      expect(screen.queryByText("best")).not.toBeInTheDocument();
      unmount();

      const tie = [call({ Location: "Cosmote Free A" }), call({ Location: "Vodafone Free A" })];
      render(<SummaryTab allCallsRows={tie} dataCallsRows={noData} />);
      expect(screen.queryByText("best")).not.toBeInTheDocument();
    });

    it("a single operator never gets a 'best' marker (nothing to compare against)", () => {
      render(<SummaryTab allCallsRows={[call({}), call({ status: "Dropped" })]} dataCallsRows={noData} />);

      expect(screen.queryByText("best")).not.toBeInTheDocument();
    });

    it("'Hide empty rows' removes all-zero count rows in Full mode", () => {
      render(<SummaryTab allCallsRows={repeat(2, {})} dataCallsRows={noData} />);
      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      expect(screen.getAllByText("Dropped Calls").length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("checkbox", { name: "Hide empty rows" }));

      expect(screen.queryByText("Dropped Calls")).not.toBeInTheDocument();
      expect(screen.queryByText("System Releases")).not.toBeInTheDocument();
      expect(screen.getAllByText("Normal Releases").length).toBeGreaterThan(0);
    });
  });

  describe("compact mode state", () => {
    it("controlled: clicking Full only calls onCompactChange — the parent stays the source of truth", () => {
      const onCompactChange = vi.fn();
      render(<SummaryTab allCallsRows={repeat(2, {})} dataCallsRows={noData} compact onCompactChange={onCompactChange} />);

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      expect(onCompactChange).toHaveBeenCalledWith(false);
      expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByText("Normal Releases")).not.toBeInTheDocument();
      // Το controlled mode ΔΕΝ γράφει στο localStorage.
      expect(window.localStorage.getItem("perf-insights-summary-compact")).toBeNull();
    });

    it("uncontrolled: restores Full from localStorage and persists the next choice", () => {
      window.localStorage.setItem("perf-insights-summary-compact", "false");
      render(<SummaryTab allCallsRows={repeat(2, {})} dataCallsRows={noData} />);

      expect(screen.getByRole("button", { name: "Full" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getAllByText("Normal Releases").length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("button", { name: "Compact" }));
      expect(window.localStorage.getItem("perf-insights-summary-compact")).toBe("true");
    });

    it("a corrupt localStorage value falls back to the Compact default instead of crashing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      window.localStorage.setItem("perf-insights-summary-compact", "{not json");

      render(<SummaryTab allCallsRows={repeat(2, {})} dataCallsRows={noData} />);

      expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("loading / failed chips", () => {
    it("hides the Loading chip once every source has returned", () => {
      render(<SummaryTab allCallsRows={repeat(1, {})} dataCallsRows={noData} loading={loadingState({ done: 10 })} />);

      expect(screen.queryByText(/sources/)).not.toBeInTheDocument();
    });

    it("shows a Failed chip with a working Retry button when a callback is given", () => {
      const onRetry = vi.fn();
      render(
        <SummaryTab
          allCallsRows={repeat(1, {})}
          dataCallsRows={noData}
          loading={loadingState({ failed: 2 })}
          onRetryFailedSources={onRetry}
        />,
      );

      expect(screen.getByText("2/10 sources")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("shows the Failed chip without a Retry button when no callback is given", () => {
      render(<SummaryTab allCallsRows={repeat(1, {})} dataCallsRows={noData} loading={loadingState({ failed: 1 })} />);

      expect(screen.getByText("1/10 sources")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });

    it("does not flash stale numbers while voice is re-loading with old rows still in props", () => {
      render(
        <SummaryTab
          allCallsRows={repeat(3, {})}
          dataCallsRows={noData}
          loading={loadingState({ voice: true, done: 5 })}
        />,
      );

      expect(screen.queryByText("100.0%")).not.toBeInTheDocument();
      // GSM + FREE κάρτες σε skeleton· PS Data δεν φορτώνει και δεν έχει δεδομένα → καμία κάρτα.
      expect(screen.getAllByText("loading…")).toHaveLength(2);
      expect(screen.queryByText("PS Data Stats")).not.toBeInTheDocument();
    });
  });

  describe("collections header", () => {
    it("flags collections with an uncommented (or whitespace-commented) drop/fail — even isValid=0 rows", () => {
      const rows = [
        call({ CollectionName: "C1", status: "Dropped", comment: null }),
        call({ CollectionName: "C2", status: "Failed", comment: "   " }),
        call({ CollectionName: "C3", status: "Dropped", comment: "known coverage hole" }),
        call({ CollectionName: "C4", status: "completed", comment: null }),
        call({ CollectionName: "C5", status: "Dropped", comment: null, isValid: 0 }),
      ];
      render(
        <SummaryTab
          allCallsRows={rows}
          dataCallsRows={noData}
          collections={["C1", "C2", "C3", "C4", "C5"]}
        />,
      );

      expect(screen.getByText("C1")).toHaveClass("text-red-500");
      expect(screen.getByText("C2")).toHaveClass("text-red-500");
      expect(screen.getByText("C3")).not.toHaveClass("text-red-500");
      expect(screen.getByText("C4")).not.toHaveClass("text-red-500");
      // flaggedCollections διαβάζει allCallsRows, όχι το valid-filtered — documents current behavior.
      expect(screen.getByText("C5")).toHaveClass("text-red-500");
    });

    it("shows the collection picker messages for no database / loading / no collections", () => {
      const props = { allCallsRows: [], dataCallsRows: noData, onToggleCollection: vi.fn() };
      const { rerender } = render(<SummaryTab {...props} />);

      fireEvent.click(screen.getByText("Select collections"));
      expect(screen.getByText("Select database first.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();

      rerender(<SummaryTab {...props} database="DB1" collectionsLoading />);
      expect(screen.getByText("Loading...")).toBeInTheDocument();

      rerender(<SummaryTab {...props} database="DB1" />);
      expect(screen.getByText("No collections found.")).toBeInTheDocument();
    });
  });

  describe("data-only and scale", () => {
    it("data tests without any voice calls: no voice cards, hero '—', PS Data still rendered", () => {
      render(<SummaryTab allCallsRows={[]} dataCallsRows={[dataTest({})]} />);

      expect(hero()).toHaveTextContent("—");
      expect(screen.queryByText("GSM Call Stats")).not.toBeInTheDocument();
      expect(screen.queryByText("Free (2G-3G-LTE-VoNR) Call Stats")).not.toBeInTheDocument();
      expect(screen.getByText("PS Data Stats")).toBeInTheDocument();
      expect(screen.getByText("1 data tests")).toBeInTheDocument();
    });

    it("a data test with an unknown scoring status is neither success nor failure (rate stays defined)", () => {
      render(
        <SummaryTab
          allCallsRows={[]}
          dataCallsRows={[dataTest({}), dataTest({ scoringStatus: "?", status: "Aborted" })]}
        />,
      );

      // 1 success / (1 success + 0 failed) = 100% — το "other" δεν μπαίνει στη βάση.
      expect(screen.getAllByText("100.00%").length).toBeGreaterThan(0);
      expect(document.body.textContent).not.toMatch(/NaN/);
    });

    it("formats large counts with thousands separators", () => {
      render(<SummaryTab allCallsRows={repeat(1234, {})} dataCallsRows={noData} />);

      expect(screen.getByText("1,234 call attempts")).toBeInTheDocument();
      expect(screen.getByText("1,234 normal releases / 1,234 attempts")).toBeInTheDocument();
    });
  });
});
