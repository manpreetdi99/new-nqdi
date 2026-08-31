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
    // "Technology mix" δεν είναι στο COMPACT_VOICE_ROW_ORDER — Full mode για να φανεί
    // (Compact είναι πλέον το default).
    fireEvent.click(screen.getByRole("button", { name: "Full" }));

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
    // "Technology mix" δεν είναι στο COMPACT_VOICE_ROW_ORDER — Full mode για να φανεί
    // (Compact είναι πλέον το default).
    fireEvent.click(screen.getByRole("button", { name: "Full" }));

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
      dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
      dataTest({ testType: "Ookla Speedtest", direction: null, throughputKbps: 100000 }),
      dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 20 }),
      dataTest({ testType: "YouTube Service", direction: null, youtubeMos: 4.3 }),
    ];

    it("merges Capacity DL/UL into one directional table, DL rows before UL (Compact is the default)", () => {
      render(<SummaryTab allCallsRows={rows} dataCallsRows={dataRows} />);

      // Compact is now the default — no click needed. Capacity DL 10GB + Capacity UL 1GB
      // ενώνονται σε ΕΝΑ table — βλ. "comapct_data .txt" (2026-08-31).
      expect(screen.queryByText("Capacity DL 10GB")).not.toBeInTheDocument();
      expect(screen.queryByText("Capacity UL 1GB")).not.toBeInTheDocument();
      expect(screen.getByText("Capacity DL 10GB / Capacity UL 1GB")).toBeInTheDocument();
      expect(screen.getAllByText("Test Success Rate (%) DL").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Test Success Rate (%) UL").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Mean sustainable throughput (Mbps) DL").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Mean sustainable throughput (Mbps) UL").length).toBeGreaterThan(0);
      expect(screen.getAllByText("400.0").length).toBeGreaterThan(0); // DL throughput
      expect(screen.getAllByText("40.0").length).toBeGreaterThan(0); // UL throughput
      // Total Tests / Successful tests ενώνονται σε ΕΝΑ row: "total / successful" cell.
      expect(screen.getAllByText("Total Tests DL").length).toBeGreaterThan(0);
      expect(screen.queryByText("Successful tests DL")).not.toBeInTheDocument();
      expect(screen.getAllByText("1 / 1").length).toBeGreaterThan(0); // 1 test, 1 success

      // "όλα πρώτα dl και μετά ul" — τα DL rows προηγούνται των UL rows στο DOM.
      const bodyText = document.body.textContent ?? "";
      expect(bodyText.indexOf("Test Success Rate (%) DL")).toBeLessThan(bodyText.indexOf("Test Success Rate (%) UL"));

      // Ό,τι δεν είχε DL/UL pair ΚΑΙ δεν είναι στο COMPACT_EXCLUDED_GROUPS/LABELS μένει
      // ξεχωριστό section (π.χ. Ookla Speedtest). Το YouTube Service (Ε5 · Video
      // streaming) καταργείται εντελώς στο compact (2026-08-31).
      expect(screen.getByText("Ookla Speedtest")).toBeInTheDocument();
      expect(screen.queryByText("YouTube Service")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      // Full mode: το merged table σπάει πίσω στα δύο ξεχωριστά sections. Χωρίς Capacity
      // (grx)/(akamai) breakdown data σε αυτό το fixture, το ΓΥΜΝΟ Capacity DL/UL ΜΕΝΕΙ
      // ορατό — βλ. FULL_BARE_CAPACITY_HIDDEN_WHEN_BROKEN_DOWN (η κατάργηση είναι
      // conditional στο breakdown να υπάρχει πραγματικά, "εφόσον", όχι unconditional). Το
      // Ε5 section ξαναφαίνεται κανονικά.
      expect(screen.getByText("Capacity DL 10GB")).toBeInTheDocument();
      expect(screen.getByText("Capacity UL 1GB")).toBeInTheDocument();
      expect(screen.queryByText("Capacity DL 10GB / Capacity UL 1GB")).not.toBeInTheDocument();
      expect(screen.getByText("YouTube Service")).toBeInTheDocument();
    });

    it("shows the Capacity (grx)/(akamai) link breakdown only in Full mode, next to the main Capacity DL/UL (2026-08-31: 'θέλω να μου το σπάσεις Link grx και akamai')", () => {
      const linkRows: DataCallRow[] = [
        dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
        dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
        dataTest({ testType: "Capacity grx", direction: "DL", capacityThroughputKbps: 140500 }),
        dataTest({ testType: "Capacity akamai", direction: "DL", capacityThroughputKbps: 130000 }),
        dataTest({ testType: "Capacity grx", direction: "UL", capacityThroughputKbps: 22100 }),
        dataTest({ testType: "Capacity akamai", direction: "UL", capacityThroughputKbps: 21000 }),
      ];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={linkRows} />);

      // Compact is now the default — no click needed. Το merged directional table
      // (Capacity DL 10GB / Capacity UL 1GB) φαίνεται όπως πάντα, αλλά ΧΩΡΙΣ το breakdown.
      expect(screen.getByText("Capacity DL 10GB / Capacity UL 1GB")).toBeInTheDocument();
      expect(screen.queryByText("Capacity DL 10GB (grx)")).not.toBeInTheDocument();
      expect(screen.queryByText("Capacity DL 10GB (akamai)")).not.toBeInTheDocument();
      expect(screen.queryByText("Capacity UL 1GB (grx)")).not.toBeInTheDocument();
      expect(screen.queryByText("Capacity UL 1GB (akamai)")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      // Full mode: τα 4 breakdown sections ορατά· το ΓΥΜΝΟ Capacity DL/UL κρύβεται εδώ
      // επειδή αυτή τη φορά το breakdown ΥΠΑΡΧΕΙ πραγματικά στα δεδομένα (2026-08-31:
      // "εφόσον το έσπασε Capacity DL 10GB το βγάζεις από το full αυτό").
      expect(screen.queryByText("Capacity DL 10GB")).not.toBeInTheDocument();
      expect(screen.queryByText("Capacity UL 1GB")).not.toBeInTheDocument();
      expect(screen.getByText("Capacity DL 10GB (grx)")).toBeInTheDocument();
      expect(screen.getByText("Capacity DL 10GB (akamai)")).toBeInTheDocument();
      expect(screen.getByText("Capacity UL 1GB (grx)")).toBeInTheDocument();
      expect(screen.getByText("Capacity UL 1GB (akamai)")).toBeInTheDocument();
      expect(screen.getAllByText("140.5").length).toBeGreaterThan(0);
    });

    it("shows 'rest' sections (no DL/UL pair) as a compact card — Success Rate/Total Tests/metric only, no Successful/Failed tests", () => {
      const ooklaRows: DataCallRow[] = [dataTest({ testType: "Ookla Speedtest", direction: null, throughputKbps: 100000 })];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={ooklaRows} />);

      // Compact is now the default — no click needed.
      expect(screen.getByText("Ookla Speedtest")).toBeInTheDocument();
      expect(screen.getAllByText("Test Success Rate (%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Total Tests").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Mean application throughput (Mbps)").length).toBeGreaterThan(0);
      expect(screen.queryByText("Successful tests")).not.toBeInTheDocument();
      expect(screen.queryByText("Failed Tests")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      // Full mode: το section ξαναπαίρνει τις Successful/Failed tests γραμμές.
      expect(screen.getAllByText("Successful tests").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Failed Tests").length).toBeGreaterThan(0);
    });

    it("drops HTTP Transfer DL/UL, DNS Resolution, Interactivity (eGaming) and all of Ε5 in compact — Full mode still shows them", () => {
      const rest: DataCallRow[] = [
        dataTest({ testType: "HTTP Transfer (DL)", direction: null, throughputKbps: 10000 }),
        dataTest({ testType: "HTTP UL", direction: null, throughputKbps: 5000 }),
        dataTest({ testType: "DNS", direction: null, pingRttAvg: 20 }),
        dataTest({ testType: "Interactivity", direction: null, throughputKbps: 300 }),
        dataTest({ testType: "YouTube Service", direction: null, youtubeMos: 4.3 }),
        // "HTTP Browser (Kepler_2)" — underscore raw format, βλ. sectionLabel fix (2026-08-31).
        dataTest({ testType: "HTTP Browser (Kepler_2)", direction: null, throughputKbps: 5000 }),
      ];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={rest} />);

      // Compact is now the default — no click needed.
      expect(screen.queryByText("HTTP Transfer (DL) 10MB")).not.toBeInTheDocument();
      expect(screen.queryByText("HTTP Transfer (UL) 5MB")).not.toBeInTheDocument();
      expect(screen.queryByText("DNS Resolution")).not.toBeInTheDocument();
      expect(screen.queryByText("Interactivity (eGaming)")).not.toBeInTheDocument();
      expect(screen.queryByText("YouTube Service")).not.toBeInTheDocument();
      // "Kepler_2" (underscore) πρέπει να αναγνωρίζεται σαν Kepler +30s Pause -> Ε3 -> έξω.
      expect(screen.queryByText("Kepler +30s Pause")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      expect(screen.getByText("HTTP Transfer (DL) 10MB")).toBeInTheDocument();
      expect(screen.getByText("HTTP Transfer (UL) 5MB")).toBeInTheDocument();
      expect(screen.getByText("DNS Resolution")).toBeInTheDocument();
      expect(screen.getByText("Interactivity (eGaming)")).toBeInTheDocument();
      expect(screen.getByText("YouTube Service")).toBeInTheDocument();
      expect(screen.getByText("Kepler +30s Pause")).toBeInTheDocument();
    });

    it("shows a 'Packet Size (bytes)' row for Ping 40/800/1000 B sections in Full mode — merged away in compact (βλ. buildPingTotal)", () => {
      const pingRows: DataCallRow[] = [
        dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 20 }),
        dataTest({ testType: "YouTube Service", direction: null, youtubeMos: 4.3 }),
      ];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={pingRows} />);

      // Compact is now the default — no click needed. Ping 40 B μπαίνει στο "Ping (all
      // sizes combined)" merge — δεν αντιστοιχεί πια σε ΕΝΑ μέγεθος, οπότε το Packet Size
      // row δεν εμφανίζεται (pingPacketSizeBytes δεν ταιριάζει με το merged label).
      expect(screen.queryByText("Ping 40 B")).not.toBeInTheDocument();
      expect(screen.getByText("Ping (all sizes combined)")).toBeInTheDocument();
      expect(screen.queryByText("Packet Size (bytes)")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      // Full mode: το section ξαναγίνεται ξεχωριστό "Ping 40 B", μαζί με το row.
      expect(screen.getByText("Ping 40 B")).toBeInTheDocument();
      expect(screen.getAllByText("Packet Size (bytes)").length).toBe(1);
      expect(screen.getAllByText("40").length).toBeGreaterThan(0);
    });

    it("gathers all Ε4 HTTPS sites into one total card in compact — Full mode keeps them separate", () => {
      const siteRows: DataCallRow[] = [
        dataTest({ testType: "https://www.amazon.com", direction: null, throughputKbps: 6000 }),
        dataTest({ testType: "https://www.car.gr", direction: null, throughputKbps: 3000 }),
      ];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={siteRows} />);

      // Compact is now the default — no click needed. Χωρίς group headers στο compact πια
      // (βλ. "μισο πλατος", 2026-08-31) — το section label μέσα στην κάρτα αρκεί.
      expect(screen.queryByText("https://www.amazon.com")).not.toBeInTheDocument();
      expect(screen.queryByText("https://www.car.gr")).not.toBeInTheDocument();
      expect(screen.getByText("HTTPS sites (all sites combined)")).toBeInTheDocument();
      expect(screen.queryByText("Ε4 · HTTPS sites")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      // Full mode: κάθε site ξαναπαίρνει το δικό του section, με το group header πίσω.
      expect(screen.getByText("https://www.amazon.com")).toBeInTheDocument();
      expect(screen.getByText("https://www.car.gr")).toBeInTheDocument();
      expect(screen.getByText("Ε4 · HTTPS sites")).toBeInTheDocument();
      expect(screen.queryByText("HTTPS sites (all sites combined)")).not.toBeInTheDocument();
    });

    it("drops Ε3 · Browser engines entirely in compact — Full mode still shows Kepler/Newton", () => {
      const browserRows: DataCallRow[] = [
        dataTest({ testType: "KEPLER", direction: null, throughputKbps: 5000 }),
        dataTest({ testType: "NEWTON", direction: null, throughputKbps: 5000 }),
      ];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={browserRows} />);

      // Compact is now the default — no click needed.
      expect(screen.queryByText("KEPLER")).not.toBeInTheDocument();
      expect(screen.queryByText("NEWTON")).not.toBeInTheDocument();
      expect(screen.queryByText("Ε3 · Browser engines")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      expect(screen.getByText("KEPLER")).toBeInTheDocument();
      expect(screen.getByText("NEWTON")).toBeInTheDocument();
      expect(screen.getByText("Ε3 · Browser engines")).toBeInTheDocument();
    });

    it("merges Ookla DL/UL the same way (same directionalDataRows, not Capacity-specific)", () => {
      const ooklaRows: DataCallRow[] = [
        dataTest({ testType: "Ookla", direction: "DL", throughputKbps: 100000 }),
        dataTest({ testType: "Ookla", direction: "UL", throughputKbps: 10000 }),
      ];
      render(<SummaryTab allCallsRows={rows} dataCallsRows={ooklaRows} />);

      // Compact is now the default — no click needed.
      expect(screen.queryByText("Ookla DL")).not.toBeInTheDocument();
      expect(screen.queryByText("Ookla UL")).not.toBeInTheDocument();
      expect(screen.getByText("Ookla DL / Ookla UL")).toBeInTheDocument();
      expect(screen.getAllByText("Test Success Rate (%) DL").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Test Success Rate (%) UL").length).toBeGreaterThan(0);
      // Total Tests / Successful tests ενώνονται σε ΕΝΑ row εδώ επίσης.
      expect(screen.getAllByText("Total Tests DL").length).toBeGreaterThan(0);
      expect(screen.queryByText("Successful tests DL")).not.toBeInTheDocument();
      expect(screen.getAllByText("1 / 1").length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      expect(screen.getByText("Ookla DL")).toBeInTheDocument();
      expect(screen.getByText("Ookla UL")).toBeInTheDocument();
      expect(screen.queryByText("Ookla DL / Ookla UL")).not.toBeInTheDocument();
    });

    it("hides the per-operator 'GSM+FREE call success rate' tiles in compact — Full brings them back", () => {
      render(<SummaryTab allCallsRows={rows} dataCallsRows={[] as DataCallRow[]} />);

      // Compact is now the default — no click needed. Ήδη καλύπτεται από τα GSM/FREE table
      // rows (Total Calls/Success/Drop/Fail).
      expect(screen.queryByText(/GSM\+FREE call success rate/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      expect(screen.getAllByText(/GSM\+FREE call success rate/).length).toBeGreaterThan(0);
    });

    it("keeps only Total Calls / Success / Drop / Fail rate (count folded in) / POLQA avg in the voice tables (Compact is the default)", () => {
      render(<SummaryTab allCallsRows={rows} dataCallsRows={[] as DataCallRow[]} />);

      // Compact is now the default — no click needed. excludeSysRelease defaults to true,
      // so "Total Calls" carries the "(excl. SR)" suffix — βλ. COMPACT_VOICE_ROW_ORDER.
      expect(screen.getAllByText("Total Calls (excl. SR)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Call Success Rate (%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Dropped Call Rate (%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Access Failure Rate (%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("POLQA avg (Speech quality ITU P.863)").length).toBeGreaterThan(0);
      // 1 completed + 1 dropped — το count είναι πλέον μέσα στο rate cell σαν "sum=...".
      expect(screen.getAllByText("sum=1").length).toBeGreaterThan(0);
      // Total Calls πρώτο (2026-08-31: μετακινήθηκε από προτελευταίο σε πρώτο) — βλ.
      // COMPACT_VOICE_ROW_ORDER. Στη σειρά εμφάνισης στο DOM, πρέπει να προηγείται
      // ακόμα και του πρώτου rate row.
      const bodyText = document.body.textContent ?? "";
      const totalCallsIndex = bodyText.indexOf("Total Calls (excl. SR)");
      const successRateIndex = bodyText.indexOf("Call Success Rate (%)");
      expect(totalCallsIndex).toBeGreaterThan(-1);
      expect(totalCallsIndex).toBeLessThan(successRateIndex);
      // Οι standalone count rows δεν χρειάζονται πια στο compact — merged μέσα στο rate.
      expect(screen.queryByText("Normal Releases")).not.toBeInTheDocument();
      expect(screen.queryByText("Dropped Calls")).not.toBeInTheDocument();
      expect(screen.queryByText("Unsuccessful Call Attempts")).not.toBeInTheDocument();
      // Ό,τι δεν είναι στο COMPACT_VOICE_ROW_ORDER φεύγει — Call Attempts, codec/technology mix, SRVCC.
      expect(screen.queryByText("System Release Rate (%)")).not.toBeInTheDocument();
      expect(screen.queryByText("Technology mix")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Full" }));

      // Full: οι standalone count rows ξαναφαίνονται (μαζί με το "sum=..." κάτω από το rate).
      expect(screen.getAllByText("System Release Rate (%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Technology mix").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Normal Releases").length).toBeGreaterThan(0);
    });
  });

  describe("incl. SR visibility", () => {
    const rows: AllCallsRow[] = [
      call({ Location: "Cosmote Free A", status: "completed" }),
      call({ Location: "Cosmote Free A", status: "completed" }),
      call({ Location: "Cosmote Free A", status: "System Release" }),
    ];

    it("hides the 'incl. SR' secondary line by default — unchecking the checkbox reveals it", () => {
      render(<SummaryTab allCallsRows={rows} dataCallsRows={[] as DataCallRow[]} />);

      // "Hide incl. SR" είναι checked (active) by default — ίδιο checkbox look με τα
      // "Valid calls"/"Avoid system release" (2026-08-31). Το regex θέλει ψηφίο μετά το
      // "incl. SR" ώστε να μην πιάνει το ίδιο το label του checkbox ή το footnote (που
      // αναφέρουν "incl. SR" σε εισαγωγικά ανεξάρτητα από το toggle).
      const toggle = screen.getByRole("checkbox", { name: "Hide incl. SR" });
      expect(toggle).toBeChecked();
      expect(screen.queryByText(/incl\. SR \d/)).not.toBeInTheDocument();
      expect(screen.queryByText(/incl\. system releases/)).not.toBeInTheDocument();

      fireEvent.click(toggle);

      expect(toggle).not.toBeChecked();
      expect(screen.getAllByText(/incl\. SR \d/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/incl\. system releases/).length).toBeGreaterThan(0);
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
