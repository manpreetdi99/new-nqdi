import { describe, it, expect } from "vitest";

import {
  bucketTechnology,
  buildCellBandCountTable,
  buildDataSections,
  buildDetailedTechnologyMix,
  buildReportPeriod,
  buildServingBandTechTable,
  buildSrvccTable,
  buildTechnologyMix,
  buildTechnologyMixTable,
  buildVoiceStats,
  buildVoiceTable,
  classifyCallStatus,
  classifyCustomCallMode,
  collectOperators,
  isoWeek,
  mapOoklaRowsToDataCallRows,
  resolveMode,
  resolveOperator,
} from "@/lib/attachmentC";
import type { AllCallsRow, DataCallRow, OoklaRow } from "@/lib/api";

const call = (overrides: Partial<AllCallsRow>): AllCallsRow => ({
  Location: "Cosmote Free A",
  SessionId: "1",
  callMode: null,
  callType: null,
  technology: "LTE",
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

describe("operator & mode resolution", () => {
  it("maps A-side locations to operators with stable colors", () => {
    expect(resolveOperator("Cosmote Free A").key).toBe("COSMOTE");
    expect(resolveOperator("Vodafone GSM A").key).toBe("VODAFONE");
    expect(resolveOperator("Nova Data A").key).toBe("NOVA");
    expect(resolveOperator("Cosmote Free A").color).toBe(resolveOperator("Cosmote Data A").color);
  });

  it("falls back to a neutral colour for unknown operators", () => {
    const other = resolveOperator("Acme Free A");
    expect(other.key).toBe("ACME");
    expect(other.color).toBe("#898781");
  });

  it("detects the call mode from the location", () => {
    expect(resolveMode("Cosmote Free A")).toBe("FREE");
    expect(resolveMode("Vodafone GSM A")).toBe("GSM");
    expect(resolveMode("Nova Data A")).toBe("DATA");
    expect(resolveMode(null)).toBe("OTHER");
  });

  it("keeps a fixed operator order regardless of the order they appear in", () => {
    const operators = collectOperators(["Nova Free A", "Acme Free A", "Vodafone Free A", "Cosmote Free A"]);
    expect(operators.map((operator) => operator.key)).toEqual(["COSMOTE", "VODAFONE", "NOVA", "ACME"]);
  });
});

describe("call status classification", () => {
  it("handles the system release misspelling used in the DB", () => {
    expect(classifyCallStatus("System Realase")).toBe("sysRelease");
    expect(classifyCallStatus("System Release")).toBe("sysRelease");
    expect(classifyCallStatus("Dropped")).toBe("dropped");
    expect(classifyCallStatus("Failed")).toBe("failed");
    expect(classifyCallStatus(null)).toBe("completed");
  });
});

describe("voice KPIs", () => {
  // Ίδιο σενάριο με το "Vodafone Free A" του A-LEVEL_VERIA_2026H2 (week 29):
  // 86 attempts, 1 unsuccessful, 1 dropped, 84 normal releases.
  const rows: AllCallsRow[] = [
    ...Array.from({ length: 84 }, () => call({ Location: "Vodafone Free A", status: "completed" })),
    call({ Location: "Vodafone Free A", status: "Dropped" }),
    call({ Location: "Vodafone Free A", status: "Failed" }),
  ];

  it("reproduces the Attachment C rates", () => {
    const stats = buildVoiceStats(rows);

    expect(stats.attempts).toBe(86);
    expect(stats.completed).toBe(84);
    expect(stats.dropped).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.connections).toBe(85);
    expect(stats.csr).toBeCloseTo(0.9767441860465116, 12);
    expect(stats.dcr).toBeCloseTo(0.011764705882352941, 12);
    expect(stats.afr).toBeCloseTo(0.011627906976744186, 12);
  });

  it("recomputes the rates with the system releases out of the base", () => {
    // 84 normal + 1 dropped + 1 failed + 4 system releases = 90 attempts.
    const stats = buildVoiceStats([
      ...rows,
      ...Array.from({ length: 4 }, () => call({ Location: "Vodafone Free A", status: "System Realase" })),
    ]);

    expect(stats.attempts).toBe(90);
    expect(stats.sysRelease).toBe(4);
    expect(stats.csr).toBeCloseTo(84 / 90, 12);
    expect(stats.dcr).toBeCloseTo(1 / 89, 12);
    expect(stats.srr).toBeCloseTo(4 / 89, 12);

    // Χωρίς system releases: 86 attempts, 85 total calls — όπως το σκέτο σενάριο.
    expect(stats.withoutSysRelease.attempts).toBe(86);
    expect(stats.withoutSysRelease.connections).toBe(85);
    expect(stats.withoutSysRelease.csr).toBeCloseTo(84 / 86, 12);
    expect(stats.withoutSysRelease.dcr).toBeCloseTo(1 / 85, 12);
    expect(stats.withoutSysRelease.afr).toBeCloseTo(1 / 86, 12);
  });

  it("leaves the rates untouched when there are no system releases", () => {
    const stats = buildVoiceStats(rows);

    expect(stats.withoutSysRelease.csr).toBe(stats.csr);
    expect(stats.withoutSysRelease.dcr).toBe(stats.dcr);
    expect(stats.withoutSysRelease.afr).toBe(stats.afr);
  });

  it("splits setup time into MOC (A->B) and MTC (B->A)", () => {
    // Το backend στέλνει ήδη τα mocSetupTime/mtcSetupTime pre-filtered/split (βλ.
    // CASE στο calls.py, ίδιο κριτήριο με το A-LEVEL "LQCallDataGSM.sql" reference
    // query) — το buildVoiceStats απλά τα μαζεύει, δεν ξαναφιλτράρει με το callDir.
    const stats = buildVoiceStats([
      call({ setupTime: 3, mocSetupTime: 3 }),
      call({ setupTime: 5, mocSetupTime: 5 }),
      call({ setupTime: 2, mtcSetupTime: 2 }),
    ]);

    expect(stats.setupMoc).toEqual({ avg: 4, samples: 2, min: 3, max: 5 });
    expect(stats.setupMtc).toEqual({ avg: 2, samples: 1, min: 2, max: 2 });
    expect(stats.setupAll.avg).toBeCloseTo(10 / 3, 12);
  });

  it("splits setup time into VoLTE Call and CS Call", () => {
    // Ίδιο pattern με το MOC/MTC test: το backend στέλνει ήδη τα volteSetupTime/
    // csSetupTime pre-filtered/split (callMode VoLTE/SRVCC vs CSFB/CS, ίδιο κριτήριο
    // με το A-LEVEL "LQCallData.sql" reference query's CallSetupTimeVoLTE/CS).
    const stats = buildVoiceStats([
      call({ volteSetupTime: 4 }),
      call({ volteSetupTime: 6 }),
      call({ csSetupTime: 5 }),
    ]);

    expect(stats.volteSetup).toEqual({ avg: 5, samples: 2, min: 4, max: 6 });
    expect(stats.csSetup).toEqual({ avg: 5, samples: 1, min: 5, max: 5 });
  });

  it("counts low speech quality calls at the POLQA thresholds", () => {
    const stats = buildVoiceStats([
      call({ Avg_mos: 4.6 }),
      call({ Avg_mos: 2.1 }),
      call({ Avg_mos: 1.2 }),
      call({ Avg_mos: null }),
    ]);

    expect(stats.lowQualityCalls).toBe(2); // < 2.2
    expect(stats.badQualityCalls).toBe(1); // < 1.3
    expect(stats.mos.samples).toBe(3);
    expect(stats.mos.min).toBe(1.2);
    expect(stats.mos.max).toBe(4.6);
  });

  it("aggregates raw UL/DL MOS samples from the backend per-session stats, weighted by sample count", () => {
    // Κάθε γραμμή είναι μία κλήση (session) με ήδη υπολογισμένα avg/min/max/samples
    // από το backend πάνω σε raw ResultsLQ08Avg δείγματα — όχι ένα Avg_mos ανά κλήση.
    const stats = buildVoiceStats([
      call({ mosUlAvg: 4, mosUlMin: 3, mosUlMax: 5, mosUlSamples: 4 }), // 4 δείγματα, sum 16
      call({ mosUlAvg: 2, mosUlMin: 2, mosUlMax: 2, mosUlSamples: 1 }), // 1 δείγμα, sum 2
      call({ mosDlAvg: 3.5, mosDlMin: 3, mosDlMax: 4, mosDlSamples: 2 }),
    ]);

    // (16 + 2) / (4 + 1) = 3.6 — ο μέσος όρος σταθμισμένος με τα samples, όχι με τις κλήσεις.
    expect(stats.mosUl).toEqual({ avg: 3.6, samples: 5, min: 2, max: 5 });
    expect(stats.mosDl).toEqual({ avg: 3.5, samples: 2, min: 3, max: 4 });
  });

  it("counts more MOS samples than calls when each call carries several raw samples", () => {
    const stats = buildVoiceStats([
      call({ mosUlAvg: 3, mosUlMin: 1, mosUlMax: 5, mosUlSamples: 4 }),
      call({ mosUlAvg: 3, mosUlMin: 1, mosUlMax: 5, mosUlSamples: 4 }),
    ]);

    expect(stats.attempts).toBe(2);
    expect(stats.mosUl.samples).toBe(8); // calls × 4, not capped at 1 per call
  });

  it("groups a table by operator and keeps only the requested mode", () => {
    const table = buildVoiceTable(
      [
        call({ Location: "Cosmote GSM A", status: "completed" }),
        call({ Location: "Cosmote GSM A", status: "Dropped" }),
        call({ Location: "Vodafone GSM A", status: "completed" }),
        call({ Location: "Cosmote Free A", status: "completed" }),
      ],
      "GSM",
    );

    expect(table.total.attempts).toBe(3);
    expect(table.byOperator.get("COSMOTE")?.attempts).toBe(2);
    expect(table.byOperator.get("VODAFONE")?.attempts).toBe(1);
    expect(table.byOperator.get("COSMOTE")?.dropped).toBe(1);
  });
});

describe("custom call mode (VoLTE / CS) split — FREE table LQCallExtend_1PT", () => {
  it("classifies VoLTE / CS from callMode, with a '-' callMode falling back to technology", () => {
    expect(classifyCustomCallMode({ callMode: "VoLTE", technology: null })).toBe("volte");
    expect(classifyCustomCallMode({ callMode: "SRVCC", technology: null })).toBe("volte");
    expect(classifyCustomCallMode({ callMode: "CSFB", technology: null })).toBe("cs");
    expect(classifyCustomCallMode({ callMode: "CS", technology: null })).toBe("cs");
    expect(classifyCustomCallMode({ callMode: "-", technology: "LTE" })).toBe("volte");
    expect(classifyCustomCallMode({ callMode: "-", technology: "UMTS 2100" })).toBe("cs");
    expect(classifyCustomCallMode({ callMode: "-", technology: "GSM 900" })).toBe("cs");
    expect(classifyCustomCallMode({ callMode: "Unknown", technology: "5G NR" })).toBe("volte");
    // '-' callMode with no matching technology, or nothing at all -> unclassified.
    expect(classifyCustomCallMode({ callMode: "-", technology: "5G NR" })).toBeNull();
    expect(classifyCustomCallMode({ callMode: null, technology: null })).toBeNull();
  });

  it("splits attempts/dropped/unsuccessful by VoLTE vs CS call, same base as classifyCallStatus", () => {
    // Ίδιο σενάριο με το "Vodafone Free A" της οθόνης 66-73 του Summary Voice: 1 dropped
    // VoLTE call (γρ.72 "D" = 1) και 1 unsuccessful CS call.
    const stats = buildVoiceStats([
      call({ Location: "Vodafone Free A", status: "completed", callMode: "VoLTE" }),
      call({ Location: "Vodafone Free A", status: "completed", callMode: "CSFB" }),
      call({ Location: "Vodafone Free A", status: "Dropped", callMode: "VoLTE" }),
      call({ Location: "Vodafone Free A", status: "Failed", callMode: "CSFB" }),
      // System releases don't count toward either base, same as CallAttemps in the reference query.
      call({ Location: "Vodafone Free A", status: "System Realase", callMode: "VoLTE" }),
    ]);

    expect(stats.volte).toEqual({ attempts: 2, dropped: 1, failed: 0 });
    expect(stats.cs).toEqual({ attempts: 2, dropped: 0, failed: 1 });
  });
});

describe("PS data KPIs", () => {
  it("splits sections by test name + direction and scores them", () => {
    const sections = buildDataSections([
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 500000, scoringStatus: "F" }),
      dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
      dataTest({ testType: "Ping", direction: null, pingRttAvg: 30 }),
    ]);

    const capacityDl = sections.find((section) => section.key === "Capacity DL 10GB");
    expect(capacityDl?.total.total).toBe(2);
    expect(capacityDl?.total.success).toBe(1);
    expect(capacityDl?.total.failed).toBe(1);
    expect(capacityDl?.total.successRate).toBe(0.5);
    // Το throughput μετριέται σε Mbps και μπαίνουν και τα failed samples που έγραψαν ρυθμό.
    expect(capacityDl?.total.metrics[0].value).toBeCloseTo(450, 6);

    const ping = sections.find((section) => section.key === "Ping");
    expect(ping?.total.metrics[0]).toMatchObject({ label: "Mean RTT", unit: "ms", higherIsBetter: false, value: 30 });
  });

  it("always sorts Payload Ping BIDIRECTIONAL last in the PS Data Stats table, regardless of test count", () => {
    // Το bidirectional ping έχει συνήθως τα περισσότερα tests (τρέχει συνέχεια στο
    // background) — χωρίς το ειδικό κριτήριο θα έβγαινε πρώτο, όχι τελευταίο.
    const sections = buildDataSections([
      ...Array.from({ length: 50 }, () => dataTest({ testType: "Payload Ping BIDIRECTIONAL", direction: null, pingRttAvg: 20 })),
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
      dataTest({ testType: "Ping", direction: null, pingRttAvg: 30 }),
    ]);

    expect(sections.at(-1)?.key).toBe("Payload Ping BIDIRECTIONAL");
    expect(sections.map((section) => section.key)).toEqual(["Capacity DL 10GB", "Ping", "Payload Ping BIDIRECTIONAL"]);
  });

  it("pins Capacity DL, then Capacity UL, then Ookla at the top, in that order, regardless of test count", () => {
    // Ookla έχει σκόπιμα τα λιγότερα tests εδώ — χωρίς το σταθερό rank θα έβγαινε
    // τελευταίο (πριν το Payload Ping BIDIRECTIONAL), όχι αμέσως κάτω από Capacity UL.
    const sections = buildDataSections([
      ...Array.from({ length: 50 }, () => dataTest({ testType: "Payload Ping BIDIRECTIONAL", direction: null, pingRttAvg: 20 })),
      ...Array.from({ length: 20 }, () => dataTest({ testType: "FTP", direction: "DL", throughputKbps: 40000 })),
      dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
      dataTest({ testType: "Ookla Speedtest", direction: null, throughputKbps: 40000 }),
    ]);

    expect(sections.map((section) => section.key)).toEqual([
      "Capacity DL 10GB",
      "Capacity UL 1GB",
      "Ookla Speedtest",
      "FTP DL",
      "Payload Ping BIDIRECTIONAL",
    ]);
  });

  it("drops the 'Ookla(R) BIDIRECTIONAL' section entirely — superseded by the Ookla DL/UL split", () => {
    const sections = buildDataSections([
      ...Array.from({ length: 87 }, () => dataTest({ testType: "Ookla(R) BIDIRECTIONAL", direction: null, throughputKbps: 240690 })),
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
    ]);

    expect(sections.map((s) => s.key)).toEqual(["Capacity DL 10GB"]);
    expect(sections.some((s) => s.key.toLowerCase().includes("bidirectional") && s.key.toLowerCase().includes("ookla"))).toBe(false);
  });

  it("keeps the real Ookla DL/UL sections — the BIDIRECTIONAL exclusion doesn't match them", () => {
    const rows = mapOoklaRowsToDataCallRows([
      ooklaRow({ actionName: "Downlink Performance" }),
      ooklaRow({ actionName: "Uplink Performance", sessionId: "2" }),
    ]);

    expect(buildDataSections(rows).map((s) => s.key)).toEqual(["Ookla DL", "Ookla UL"]);
  });

  const ooklaRow = (overrides: Partial<OoklaRow>): OoklaRow => ({
    sessionId: "1",
    testId: 1,
    collectionName: null,
    aSideDevice: null,
    aSideFileName: null,
    location: "Cosmote Data A",
    homeOperator: null,
    technology: "5G",
    dataTechnology: null,
    endTime: null,
    app: "Ookla",
    profileName: null,
    actionId: 1,
    durationMs: 1000,
    throughputKbps: 50000,
    actionStatus: "Success",
    actionName: "Downlink Performance",
    latencyMs: null,
    packetLossPct: null,
    cgi: null,
    startTime: "2026-07-13T14:00:00",
    ...overrides,
  });

  it("mapOoklaRowsToDataCallRows turns Downlink/Uplink Performance rows into Ookla DL/UL DataCallRow rows", () => {
    const mapped = mapOoklaRowsToDataCallRows([
      ooklaRow({ actionName: "Downlink Performance", throughputKbps: 80000, actionStatus: "Success" }),
      ooklaRow({ actionName: "Uplink Performance", throughputKbps: 20000, actionStatus: "Failed", sessionId: "2" }),
      // Any other action (social media posts, messaging, ...) gets dropped — not an Ookla speedtest row.
      ooklaRow({ actionName: "Open Home" as OoklaRow["actionName"], sessionId: "3" }),
    ]);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({ testType: "Ookla", direction: "DL", throughputKbps: 80000, status: "Success", scoringStatus: "Success" });
    expect(mapped[1]).toMatchObject({ testType: "Ookla", direction: "UL", throughputKbps: 20000, status: "Failed", scoringStatus: "Failed" });
  });

  it("feeds Ookla DL/UL rows through buildDataSections into 'Ookla DL'/'Ookla UL' sections, scored and pinned right after Capacity UL", () => {
    const rows = mapOoklaRowsToDataCallRows([
      ooklaRow({ actionName: "Downlink Performance", throughputKbps: 80000, actionStatus: "Success" }),
      ooklaRow({ actionName: "Downlink Performance", throughputKbps: 40000, actionStatus: "Failed", sessionId: "2" }),
      ooklaRow({ actionName: "Uplink Performance", throughputKbps: 10000, actionStatus: "Success", sessionId: "3" }),
    ]);

    const sections = buildDataSections([...rows, dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 })]);

    expect(sections.map((s) => s.key)).toEqual(["Capacity UL 1GB", "Ookla DL", "Ookla UL"]);

    const ooklaDl = sections.find((s) => s.key === "Ookla DL")!;
    expect(ooklaDl.total.total).toBe(2);
    expect(ooklaDl.total.success).toBe(1);
    expect(ooklaDl.total.failed).toBe(1);
    // Mean application throughput: (80000 + 40000) / 2 kbps -> 60 Mbps.
    expect(ooklaDl.total.metrics[0]).toMatchObject({ label: "Mean application throughput", unit: "Mbps", value: 60 });
  });

  it("labels a bare Capacity DL/UL section with its fixed payload size, and doesn't double up the direction when testType already bakes it in", () => {
    // "Capacity" + direction (χωρίς ήδη ενσωματωμένο μέγεθος payload) -> σταθερό
    // Attachment C payload ανά κατεύθυνση: DL 10GB, UL 1GB (ασύμμετρο — το UL ανεβάζει
    // πολύ μικρότερο αρχείο απ' ό,τι κατεβάζει το DL).
    expect(
      buildDataSections([dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 })]).map(
        (s) => s.key,
      ),
    ).toEqual(["Capacity DL 10GB"]);
    expect(
      buildDataSections([dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 400000 })]).map(
        (s) => s.key,
      ),
    ).toEqual(["Capacity UL 1GB"]);

    // Real DB testType strings like "CAPACITY DL (Test Data Server) 10GB.bin" already
    // contain the direction — sectionLabel used to append it again, producing
    // "Capacity UL (Test Data Server) 10GB.bin UL". Not a "bare" Capacity DL/UL, so no
    // extra "10GB" gets appended on top of the one already in the name.
    expect(
      buildDataSections([
        dataTest({ testType: "CAPACITY DL (Test Data Server) 10GB.bin", direction: "DL", capacityThroughputKbps: 400000 }),
        dataTest({ testType: "Capacity UL (Test Data Server) 10GB.bin", direction: "UL", capacityThroughputKbps: 40000 }),
      ]).map((s) => s.key),
    ).toEqual(
      expect.arrayContaining(["CAPACITY DL (Test Data Server) 10GB.bin", "Capacity UL (Test Data Server) 10GB.bin"]),
    );
  });

  it("reports YouTube MOS and interruptions", () => {
    const [youtube] = buildDataSections([
      dataTest({ testType: "YouTube Video Streaming", direction: null, youtubeMos: 4.0, youtubeInterruptions: 0 }),
      dataTest({ testType: "YouTube Video Streaming", direction: null, youtubeMos: 4.4, youtubeInterruptions: 2 }),
    ]);

    expect(youtube.total.metrics[0].label).toBe("Mean video MOS");
    expect(youtube.total.metrics[0].value).toBeCloseTo(4.2, 6);
    expect(youtube.total.metrics[1].value).toBeCloseTo(1, 6);
  });

  it("keeps operators separate inside a section", () => {
    const [section] = buildDataSections([
      dataTest({ Location: "Cosmote Data A", capacityThroughputKbps: 400000 }),
      dataTest({ Location: "Nova Data A", capacityThroughputKbps: 200000, scoringStatus: "F" }),
    ]);

    expect(section.byOperator.get("COSMOTE")?.successRate).toBe(1);
    expect(section.byOperator.get("NOVA")?.successRate).toBe(0);
  });
});

describe("technology mix", () => {
  it("buckets vendor technology strings by generation", () => {
    expect(bucketTechnology("GSM900")).toBe("2G");
    expect(bucketTechnology("UMTS2100")).toBe("3G");
    expect(bucketTechnology("HSPA+")).toBe("3G");
    expect(bucketTechnology("LTE E-UTRA 3")).toBe("4G");
    expect(bucketTechnology("5G NR")).toBe("5G");
    // NSA: το LTE-5GNR μετράει ως 5G, όχι 4G.
    expect(bucketTechnology("LTE-5GNR")).toBe("5G");
    expect(bucketTechnology(null)).toBe("Other");
  });

  it("returns shares in generation order, skipping empty buckets", () => {
    const mix = buildTechnologyMix(["LTE", "LTE", "5G NR", "GSM900"]);

    expect(mix.map((entry) => entry.bucket)).toEqual(["2G", "4G", "5G"]);
    expect(mix.find((entry) => entry.bucket === "4G")?.share).toBe(0.5);
    expect(mix.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 12);
  });

  it("has no shares at all for an empty input", () => {
    expect(buildTechnologyMix([])).toEqual([]);
  });

  it("detailed mix keeps individual bands apart instead of collapsing by generation", () => {
    const mix = buildDetailedTechnologyMix(["GSM 900", "GSM 1800", "GSM 1800", "LTE E-UTRA 3", "LTE E-UTRA 20", "5G NR"]);

    // Γενιά πρώτα (2G πριν 4G πριν 5G), μετά πλήθος φθίνουσα μέσα στην ίδια γενιά.
    expect(mix.map((entry) => entry.bucket)).toEqual([
      "GSM 1800",
      "GSM 900",
      "LTE E-UTRA 3",
      "LTE E-UTRA 20",
      "5G NR",
    ]);
    expect(mix.find((entry) => entry.bucket === "GSM 1800")?.share).toBeCloseTo(2 / 6, 12);
    expect(mix.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 12);
  });

  it("detailed mix normalizes empty/whitespace-only labels into Other", () => {
    const mix = buildDetailedTechnologyMix(["LTE E-UTRA 3", null, "  ", undefined]);

    expect(mix.map((entry) => entry.bucket)).toEqual(["LTE E-UTRA 3", "Other"]);
  });

  it("buildTechnologyMixTable aggregates per-sample rows from /api/technology_mix, split by mode and operator", () => {
    // Ίδιο σχήμα με τα rows του /api/technology_mix: (location, technology, samples).
    // "Cosmote GSM A" / "Vodafone GSM A" -> mode GSM· "Cosmote Free A" -> mode FREE.
    const rows = [
      { location: "Cosmote GSM A", technology: "GSM 900", samples: 999 },
      { location: "Cosmote GSM A", technology: "GSM 1800", samples: 1 },
      { location: "Vodafone GSM A", technology: "GSM 1800", samples: 10 },
      { location: "Cosmote Free A", technology: "LTE E-UTRA 3", samples: 5 },
    ];

    const gsm = buildTechnologyMixTable(rows, "GSM");
    expect(gsm.byOperator.get("COSMOTE")?.map((e) => e.bucket)).toEqual(["GSM 900", "GSM 1800"]);
    expect(gsm.byOperator.get("COSMOTE")?.find((e) => e.bucket === "GSM 900")?.share).toBeCloseTo(999 / 1000, 12);
    expect(gsm.byOperator.get("VODAFONE")?.map((e) => e.bucket)).toEqual(["GSM 1800"]);
    // Total is across both operators, in the same mode — Free rows never leak in.
    expect(gsm.total.map((e) => e.bucket)).toEqual(["GSM 900", "GSM 1800"]);
    expect(gsm.total.find((e) => e.bucket === "GSM 1800")?.count).toBe(11);

    const free = buildTechnologyMixTable(rows, "FREE");
    expect(free.total.map((e) => e.bucket)).toEqual(["LTE E-UTRA 3"]);
  });

  it("buildTechnologyMixTable ignores zero/negative sample rows", () => {
    const rows = [
      { location: "Cosmote GSM A", technology: "GSM 900", samples: 0 },
      { location: "Cosmote GSM A", technology: "GSM 1800", samples: 3 },
    ];

    const gsm = buildTechnologyMixTable(rows, "GSM");
    expect(gsm.total.map((e) => e.bucket)).toEqual(["GSM 1800"]);
  });

  it("buildCellBandCountTable sums distinct-CID counts per operator, ignoring non-900/1800 rows", () => {
    // Ίδιο σχήμα με τα rows του /api/cell_band_count: (location, technology, cellCount).
    // Ground truth επαληθευμένο 1:1 στο STR_EVIA SOUTH_TOURISTIC AREAS_2026H2.
    const rows = [
      { location: "Cosmote GSM", technology: "GSM 1800", cellCount: 1 },
      { location: "Cosmote GSM", technology: "GSM 900", cellCount: 70 },
      { location: "Vodafone GSM", technology: "GSM 1800", cellCount: 24 },
      { location: "Vodafone GSM", technology: "GSM 900", cellCount: 66 },
      { location: "Nova GSM", technology: "GSM 1800", cellCount: 8 },
      { location: "Nova GSM", technology: "GSM 900", cellCount: 72 },
      // Άσχετο band/mode — δεν πρέπει να μπει στα totals.
      { location: "Cosmote GSM", technology: "GSM 1900", cellCount: 999 },
      { location: "Cosmote Free A", technology: "GSM 900", cellCount: 999 },
    ];

    const { byOperator, total } = buildCellBandCountTable(rows);

    expect(byOperator.get("COSMOTE")).toEqual({ band900: 70, band1800: 1 });
    expect(byOperator.get("VODAFONE")).toEqual({ band900: 66, band1800: 24 });
    expect(byOperator.get("NOVA")).toEqual({ band900: 72, band1800: 8 });
    expect(total).toEqual({ band900: 208, band1800: 33 });
  });

  it("buildVoiceTable only wires cellCount900/1800 into the GSM table, not FREE", () => {
    const rows = [
      { Location: "Cosmote GSM", SessionId: "1", callMode: null, callType: null, technology: "GSM", callDir: "A->B", status: "completed", setupTime: null, CollectionName: null, callDuration: null, callStartTimeStamp: null, Avg_mos: null, latitude: null, longitude: null, comment: null } as AllCallsRow,
      { Location: "Cosmote Free A", SessionId: "2", callMode: null, callType: null, technology: "LTE", callDir: "A->B", status: "completed", setupTime: null, CollectionName: null, callDuration: null, callStartTimeStamp: null, Avg_mos: null, latitude: null, longitude: null, comment: null } as AllCallsRow,
    ];
    const cellBandCountRows = [{ location: "Cosmote GSM", technology: "GSM 900", cellCount: 70 }];

    const gsm = buildVoiceTable(rows, "GSM", cellBandCountRows);
    expect(gsm.byOperator.get("COSMOTE")?.cellCount900).toBe(70);
    expect(gsm.byOperator.get("COSMOTE")?.cellCount1800).toBe(0);
    expect(gsm.total.cellCount900).toBe(70);

    const free = buildVoiceTable(rows, "FREE", cellBandCountRows);
    expect(free.byOperator.get("COSMOTE")?.cellCount900).toBeNull();
    expect(free.total.cellCount900).toBeNull();
  });

  it("buildSrvccTable sums attempts/successful/failed per operator from pre-aggregated (location, status, count) rows", () => {
    // Ίδιο σενάριο με το "3 γραμμές στο τέλος του FREE table": Cosmote 4/4/0, Vodafone
    // 0/0/0, Nova 12/12/0.
    const rows = [
      { location: "Cosmote Free A", status: "success" as const, count: 4 },
      { location: "Nova Free A", status: "success" as const, count: 10 },
      { location: "Nova Free A", status: "success" as const, count: 2 },
      // 'other' (unclassified ErrorCode) counts toward attempts but not failed.
      { location: "Nova Free A", status: "other" as const, count: 0 },
      { location: "Vodafone Free A", status: "fail" as const, count: 0 },
    ];

    const { byOperator, total } = buildSrvccTable(rows);

    expect(byOperator.get("COSMOTE")).toEqual({ attempts: 4, successful: 4, failed: 0 });
    expect(byOperator.get("NOVA")).toEqual({ attempts: 12, successful: 12, failed: 0 });
    expect(byOperator.get("VODAFONE")).toBeUndefined(); // zero-count row is skipped entirely.
    expect(total).toEqual({ attempts: 16, successful: 16, failed: 0 });
  });

  it("buildSrvccTable counts 'other' ErrorCode rows toward attempts but not failed", () => {
    const rows = [
      { location: "Cosmote Free A", status: "success" as const, count: 5 },
      { location: "Cosmote Free A", status: "fail" as const, count: 1 },
      { location: "Cosmote Free A", status: "other" as const, count: 2 },
    ];

    const { total } = buildSrvccTable(rows);
    expect(total).toEqual({ attempts: 8, successful: 5, failed: 1 });
  });

  it("buildVoiceTable only wires srvcc into the FREE table, not GSM", () => {
    const rows = [
      { Location: "Cosmote GSM", SessionId: "1", callMode: null, callType: null, technology: "GSM", callDir: "A->B", status: "completed", setupTime: null, CollectionName: null, callDuration: null, callStartTimeStamp: null, Avg_mos: null, latitude: null, longitude: null, comment: null } as AllCallsRow,
      { Location: "Cosmote Free A", SessionId: "2", callMode: null, callType: null, technology: "LTE", callDir: "A->B", status: "completed", setupTime: null, CollectionName: null, callDuration: null, callStartTimeStamp: null, Avg_mos: null, latitude: null, longitude: null, comment: null } as AllCallsRow,
    ];
    const srvccRows = [{ location: "Cosmote Free A", status: "success" as const, count: 4 }];

    const free = buildVoiceTable(rows, "FREE", [], srvccRows);
    expect(free.byOperator.get("COSMOTE")?.srvcc).toEqual({ attempts: 4, successful: 4, failed: 0 });
    expect(free.total.srvcc).toEqual({ attempts: 4, successful: 4, failed: 0 });

    const gsm = buildVoiceTable(rows, "GSM", [], srvccRows);
    expect(gsm.byOperator.get("COSMOTE")?.srvcc).toBeNull();
    expect(gsm.total.srvcc).toBeNull();
  });

  it("buildServingBandTechTable computes per-kind percentages (BAND / TECH have separate totals) per operator", () => {
    // Ίδιο σχήμα με τα rows του /api/serving_band_tech: (location, kind, code, samples).
    const rows = [
      { location: "Cosmote Data A", kind: "TECH" as const, code: "LTE-5GNR", samples: 90 },
      { location: "Cosmote Data A", kind: "TECH" as const, code: "LTE", samples: 10 },
      { location: "Cosmote Data A", kind: "BAND" as const, code: "NR28", samples: 60 },
      { location: "Cosmote Data A", kind: "BAND" as const, code: "NR78", samples: 40 },
      { location: "Vodafone Data A", kind: "TECH" as const, code: "#NODATA", samples: 5 },
      { location: "Vodafone Data A", kind: "TECH" as const, code: "LTE", samples: 15 },
    ];

    const table = buildServingBandTechTable(rows);

    const cosmote = table.byOperator.get("COSMOTE")!;
    // BAND % is over the BAND total (100), TECH % is over the TECH total (100) — independent bases.
    expect(cosmote.find((s) => s.label.includes("NR28"))?.pct).toBeCloseTo(60 / 100, 12);
    expect(cosmote.find((s) => s.label.includes("NR78"))?.pct).toBeCloseTo(40 / 100, 12);
    expect(cosmote.find((s) => s.label.includes("LTE-5GNR"))?.pct).toBeCloseTo(90 / 100, 12);
    // No NR1 samples for Cosmote -> 0, not null (band total > 0).
    expect(cosmote.find((s) => s.label.includes("NR1 ("))?.pct).toBe(0);

    const vodafone = table.byOperator.get("VODAFONE")!;
    // No BAND rows at all for Vodafone -> band total is 0 -> pct null (not 0).
    expect(vodafone.find((s) => s.label.includes("NR28"))?.pct).toBeNull();
    expect(vodafone.find((s) => s.label === "No data transfer (%)")?.pct).toBeCloseTo(5 / 20, 12);

    // Total combines both operators' TECH counts (LTE: 10 + 15 = 25 out of 120).
    expect(table.total.find((s) => s.label.includes("Serving Technology (per Time) LTE (%)"))?.pct).toBeCloseTo(25 / 120, 12);
  });

  it("buildServingBandTechTable ignores zero/negative-sample and blank-code rows", () => {
    const rows = [
      { location: "Cosmote Data A", kind: "TECH" as const, code: "LTE", samples: 0 },
      { location: "Cosmote Data A", kind: "TECH" as const, code: "", samples: 5 },
      { location: "Cosmote Data A", kind: "TECH" as const, code: "GPRS", samples: 3 },
    ];

    const table = buildServingBandTechTable(rows);
    expect(table.total.find((s) => s.label.includes("GPRS"))?.pct).toBe(1);
    expect(table.total.find((s) => s.label.includes("LTE ("))?.pct).toBe(0);
  });
});

describe("report period", () => {
  it("returns the ISO week of the first measurement", () => {
    // 2026-07-13 is a Monday in ISO week 29 — the week of the reference workbook.
    expect(isoWeek(new Date(2026, 6, 13))).toBe(29);

    const period = buildReportPeriod(["2026-07-15T10:00:00", "2026-07-13T08:00:00", null, "not-a-date"]);
    expect(period.week).toBe(29);
    expect(period.from?.getDate()).toBe(13);
    expect(period.to?.getDate()).toBe(15);
  });

  it("survives an empty dataset", () => {
    expect(buildReportPeriod([])).toEqual({ from: null, to: null, week: null });
  });
});
