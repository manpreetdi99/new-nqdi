import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import SummaryTab, { type SummaryLoading } from "./SummaryTab";
import type { AllCallsRow, DataCallRow, TechnologyMixRow } from "@/lib/api";

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
  testType: "Capacity",
  direction: "DL",
  status: "Success",
  scoringStatus: "A",
  host: null,
  pingRttAvg: null,
  throughputKbps: null,
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

describe("SummaryTab", () => {
  // Το compact toggle ζει σε localStorage — χωρίς reset, ένα test θα κληρονομούσε την
  // επιλογή του προηγούμενου. window.localStorage (πολυγεμισμένο στο test/setup.ts), όχι
  // το γυμνό global: σε Node 25 αυτό είναι δικό του άδειο stub χωρίς μεθόδους.
  beforeEach(() => window.localStorage.clear());

  it("renders a Technology mix row with the per-band shares, not just 2G/3G/4G/5G", () => {
    const rows: AllCallsRow[] = [
      ...Array.from({ length: 5 }, () => call({ technology: "GSM 900" })),
      ...Array.from({ length: 5 }, () => call({ technology: "GSM 1800" })),
    ];

    render(<SummaryTab allCallsRows={rows} dataCallsRows={[] as DataCallRow[]} />);

    expect(screen.getByText("Technology mix")).toBeInTheDocument();
    expect(screen.getAllByText(/GSM 900/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GSM 1800/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0);
  });

  it("prefers the real per-sample technologyMixRows over the coarse AllCallsRow.technology field", () => {
    // Χοντρικό technology στα calls — αν αυτό ήταν η πηγή, θα βλέπαμε "GSM" 100%.
    const rows: AllCallsRow[] = Array.from({ length: 3 }, () =>
      call({ Location: "Cosmote GSM A", technology: "GSM" }),
    );
    // Το πραγματικό per-sample mix (/api/technology_mix) λέει 99.9% / 0.1%.
    const technologyMixRows: TechnologyMixRow[] = [
      { location: "Cosmote GSM A", technology: "GSM 900", samples: 999 },
      { location: "Cosmote GSM A", technology: "GSM 1800", samples: 1 },
    ];

    render(<SummaryTab allCallsRows={rows} dataCallsRows={[] as DataCallRow[]} technologyMixRows={technologyMixRows} />);

    expect(screen.getAllByText(/GSM 900/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GSM 1800/).length).toBeGreaterThan(0);
    // 99.9% / 0.1% (the real per-sample split) — not the coarse-technology fallback,
    // which would have put every sample under a single "GSM" bucket at 100%.
    expect(screen.getAllByText("99.9%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.1%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^GSM$/)).not.toBeInTheDocument();
  });

  describe("compact mode", () => {
    const rows: AllCallsRow[] = [
      call({ Location: "Cosmote Free A", status: "completed", Avg_mos: 4.1 }),
      call({ Location: "Cosmote Free A", status: "Dropped", Avg_mos: 2.0 }),
    ];
    const dataRows: DataCallRow[] = [
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
      dataTest({ testType: "Ookla Speedtest", direction: null, throughputKbps: 100000 }),
      dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 20 }),
      dataTest({ testType: "YouTube Service", direction: null, youtubeMos: 4.3 }),
    ];

    it("collapses the PS Data sections into the Ε-groups with one AVG each", () => {
      render(<SummaryTab allCallsRows={rows} dataCallsRows={dataRows} />);

      // Full mode: κάθε test type έχει το δικό του section, με τη δική του μετρική.
      // (Τα "Ε1 · ..." υπάρχουν ήδη κι εδώ, σαν κεφαλίδες ομάδας πάνω από τα sections.)
      expect(screen.getByText("Capacity DL 10GB")).toBeInTheDocument();
      expect(screen.getAllByText(/Mean sustainable throughput/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/^Avg throughput/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Compact" }));

      // Compact: τα sections έγιναν group blocks με ένα "Avg ..." metric το καθένα.
      expect(screen.queryByText("Capacity DL 10GB")).not.toBeInTheDocument();
      expect(screen.queryByText(/Mean sustainable throughput/)).not.toBeInTheDocument();
      expect(screen.getByText("Ε1 · Bulk throughput")).toBeInTheDocument();
      expect(screen.getByText("Ε5 · Video streaming")).toBeInTheDocument();
      // Το unit μπαίνει στο label της γραμμής, όχι στο κελί — βλ. dataRows/cellText.
      expect(screen.getByText("Avg throughput (Mbps)")).toBeInTheDocument();
      // Capacity DL (400 Mbps, n=1) + Ookla (100 Mbps, n=1) -> σταθμισμένο 250,
      // με τα decimals του επικρατέστερου metric του group (Capacity, 1 δεκαδικό).
      expect(screen.getAllByText("250.0").length).toBeGreaterThan(0);
    });

    it("keeps only AVG MOS / Drop / Fail / Success in the voice tables", () => {
      render(<SummaryTab allCallsRows={rows} dataCallsRows={[] as DataCallRow[]} />);

      expect(screen.getAllByText("System Release Rate (%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Technology mix").length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("button", { name: "Compact" }));

      expect(screen.getAllByText("Call Success Rate (%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Dropped Call Rate (%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Access Failure Rate (%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("POLQA avg (Speech quality ITU P.863)").length).toBeGreaterThan(0);
      // Ό,τι δεν είναι στις 4 γραμμές φεύγει — counts, codec/technology mix, SRVCC.
      expect(screen.queryByText("System Release Rate (%)")).not.toBeInTheDocument();
      expect(screen.queryByText("Technology mix")).not.toBeInTheDocument();
      expect(screen.queryByText("Normal Releases")).not.toBeInTheDocument();
    });
  });

  describe("progressive loading", () => {
    it("shows the voice tables as skeletons instead of an empty-state while /api/calls is still running", () => {
      render(
        <SummaryTab
          allCallsRows={[] as AllCallsRow[]}
          dataCallsRows={[] as DataCallRow[]}
          loading={loadingState({ voice: true, data: true, done: 3 })}
        />,
      );

      // Το κέλυφος των καρτών υπάρχει ήδη — ο χρήστης βλέπει τι έρχεται.
      expect(screen.getByText("GSM Call Stats")).toBeInTheDocument();
      expect(screen.getByText("Free (2G-3G-LTE) Call Stats")).toBeInTheDocument();
      expect(screen.getByText("PS Data Stats")).toBeInTheDocument();
      expect(screen.getByText("3/10 sources")).toBeInTheDocument();
      // Πρόωρο "δεν υπάρχουν δεδομένα" ενώ ακόμα φορτώνει θα ήταν ψέμα.
      expect(screen.queryByText(/Δεν υπάρχουν δεδομένα/)).not.toBeInTheDocument();
    });

    it("paints the voice tables as soon as the calls land, without waiting for the data tests", () => {
      render(
        <SummaryTab
          allCallsRows={[call({ Location: "Cosmote Free A", status: "completed" })]}
          dataCallsRows={[] as DataCallRow[]}
          loading={loadingState({ voice: false, data: true, done: 6 })}
        />,
      );

      // Voice: πραγματικά νούμερα ήδη.
      expect(screen.getByText("1 call attempts")).toBeInTheDocument();
      expect(screen.getAllByText("Call Success Rate (%)").length).toBeGreaterThan(0);
      // Data: ακόμα σκελετός.
      expect(screen.getByText("PS Data Stats")).toBeInTheDocument();
      expect(screen.getAllByText("loading…").length).toBe(1);
    });

    it("falls back to no loading state at all when the prop is omitted", () => {
      render(<SummaryTab allCallsRows={[] as AllCallsRow[]} dataCallsRows={[] as DataCallRow[]} />);

      expect(screen.getByText(/Δεν υπάρχουν δεδομένα/)).toBeInTheDocument();
      expect(screen.queryByText(/sources/)).not.toBeInTheDocument();
    });
  });
});
