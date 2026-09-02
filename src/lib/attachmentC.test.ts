import { describe, it, expect } from "vitest";

import {
  bucketTechnology,
  buildCellBandCountTable,
  buildDataSections,
  buildDetailedTechnologyMix,
  buildDirectionalDataSections,
  buildFakeEventTable,
  buildHttpsSitesTotal,
  buildPingTotal,
  buildReportPeriod,
  excludeCdrPingDuplicates,
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
  mapCapacityLinkRowsToDataCallRows,
  mapDnsRowsToDataCallRows,
  mapInteractivityRowsToDataCallRows,
  mapOoklaRowsToDataCallRows,
  mapPing1000RowsToDataCallRows,
  pingPacketSizeBytes,
  resolveMode,
  resolveOperator,
  SECTION_GROUP_LABELS,
} from "@/lib/attachmentC";
import type { AllCallsRow, CapacityLinkRow, DataCallRow, DnsRow, InteractivityRow, OoklaRow, PingRow } from "@/lib/api";

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

  it("treats a 'Voice' location as an alias for the FREE table", () => {
    expect(resolveMode("Vodafone_Voice_A")).toBe("FREE");
    expect(resolveMode("Cosmote Voice B")).toBe("FREE");
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

  it("drops the 'Payload Ping BIDIRECTIONAL' section entirely — not a wanted Attachment C section", () => {
    const sections = buildDataSections([
      ...Array.from({ length: 50 }, () => dataTest({ testType: "Payload Ping BIDIRECTIONAL", direction: null, pingRttAvg: 20 })),
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
      dataTest({ testType: "Ping", direction: null, pingRttAvg: 30 }),
    ]);

    expect(sections.map((section) => section.key)).toEqual(["Capacity DL 10GB", "Ping"]);
    expect(sections.some((s) => s.key.toLowerCase().includes("bidirectional"))).toBe(false);
  });

  it("drops the 'Interactivity BIDIRECTIONAL' section entirely — not a wanted Attachment C section", () => {
    const sections = buildDataSections([
      ...Array.from({ length: 50 }, () => dataTest({ testType: "Interactivity BIDIRECTIONAL", direction: null })),
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
    ]);

    expect(sections.map((section) => section.key)).toEqual(["Capacity DL 10GB"]);
    expect(sections.some((s) => s.key.toLowerCase().includes("bidirectional"))).toBe(false);
  });

  it("pins Capacity DL, then Capacity UL, then Ookla at the top, in that order, regardless of test count", () => {
    const sections = buildDataSections([
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

  const pingRow = (overrides: Partial<PingRow>): PingRow => ({
    location: "Cosmote Data A",
    sessionId: "1",
    testId: 1,
    host: "8.8.8.8",
    rtt: 40,
    packetSize: 1000,
    errorCode: "ok",
    success: 1,
    failed: 0,
    sequenceNumber: 1,
    collectionName: null,
    aSideFileName: null,
    ...overrides,
  });

  it("mapPing1000RowsToDataCallRows turns raw ping packets into 'Ping 1000' DataCallRows, RTT only on success", () => {
    const mapped = mapPing1000RowsToDataCallRows([
      pingRow({ rtt: 35, success: 1, failed: 0 }),
      pingRow({ rtt: null, success: 0, failed: 1, sessionId: "2" }),
    ]);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({ testType: "Ping 1000", pingRttAvg: 35, scoringStatus: "success" });
    expect(mapped[1]).toMatchObject({ testType: "Ping 1000", pingRttAvg: null, scoringStatus: "failed" });
  });

  it("mapPing1000RowsToDataCallRows sets testType from row.packetSize — 40/800/1000 all go through the same mapping (2026-08-31: backend no longer filters to PacketSize=1000)", () => {
    const mapped = mapPing1000RowsToDataCallRows([
      pingRow({ packetSize: 40 }),
      pingRow({ packetSize: 800 }),
      pingRow({ packetSize: 1000 }),
      pingRow({ packetSize: null }),
    ]);

    expect(mapped.map((row) => row.testType)).toEqual(["Ping 40", "Ping 800", "Ping 1000", "Ping ? B"]);
  });

  it("feeds Ping 1000 rows through buildDataSections into a renamed 'Ping 1000 B' section, alongside plain Ping", () => {
    const rows = mapPing1000RowsToDataCallRows([
      pingRow({ rtt: 30, success: 1, failed: 0 }),
      pingRow({ rtt: 50, success: 1, failed: 0, sessionId: "2" }),
      pingRow({ rtt: null, success: 0, failed: 1, sessionId: "3" }),
    ]);

    const sections = buildDataSections([...rows, dataTest({ testType: "Ping", direction: null, pingRttAvg: 20 })]);

    // "Ping" (κανονικό rank 3) πριν το "Ping 1000 B" (rank 3.2, βλ. PING_B_RANK) —
    // ανεξάρτητα από το count, ίδιο σκεπτικό με το YouTube Service/Payload Ping tests.
    expect(sections.map((s) => s.key)).toEqual(["Ping", "Ping 1000 B"]);

    const ping1000 = sections.find((s) => s.key === "Ping 1000 B")!;
    expect(ping1000.total.total).toBe(3);
    expect(ping1000.total.success).toBe(2);
    expect(ping1000.total.failed).toBe(1);
    // Mean RTT: (30 + 50) / 2 — μόνο τα επιτυχημένα packets έχουν RTT.
    expect(ping1000.total.metrics[0]).toMatchObject({ label: "Mean RTT", unit: "ms", value: 40 });
  });

  it("renames ICMP Ping 40/800 and groups them with Ping 1000 B, one below the other in ascending size order (legacy CDRCombined-shaped rows — SECTION_LABEL_RENAMES still supports them even though the production pipeline no longer sources them this way, βλ. excludeCdrPingDuplicates)", () => {
    const ping1000Rows = mapPing1000RowsToDataCallRows([pingRow({ rtt: 60, success: 1, failed: 0 })]);

    const sections = buildDataSections([
      ...ping1000Rows,
      dataTest({ testType: "ICMP Ping 800", direction: null, pingRttAvg: 45 }),
      dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 15 }),
      dataTest({ testType: "Ping", direction: null, pingRttAvg: 20 }),
    ]);

    // "Ping" (κανονικό rank 3) μπαίνει πριν το Ping B group (rank 3.2) — μόνο μεταξύ
    // τους τα Ping 40/800/1000 B κρατάνε τη σειρά μεγέθους, μαζεμένα.
    expect(sections.map((s) => s.key)).toEqual(["Ping", "Ping 40 B", "Ping 800 B", "Ping 1000 B"]);
  });

  it("feeds Ping 40/800/1000 all from the SAME raw mapPing1000RowsToDataCallRows source into the three renamed 'Ping N B' sections (2026-08-31: the production path — /api/ping_1000 no longer needs the CDRCombined view for 40/800)", () => {
    const rows = mapPing1000RowsToDataCallRows([
      pingRow({ packetSize: 40, rtt: 15, success: 1, failed: 0 }),
      pingRow({ packetSize: 800, rtt: 45, success: 1, failed: 0, sessionId: "2" }),
      pingRow({ packetSize: 1000, rtt: 60, success: 1, failed: 0, sessionId: "3" }),
    ]);

    const sections = buildDataSections(rows);

    expect(sections.map((s) => s.key)).toEqual(["Ping 40 B", "Ping 800 B", "Ping 1000 B"]);
    expect(sections.map((s) => s.total.metrics[0].value)).toEqual([15, 45, 60]);
  });

  describe("excludeCdrPingDuplicates", () => {
    it("drops 'ICMP Ping 40'/'ICMP Ping 800' rows — now sourced exclusively from /api/ping_1000 — and keeps everything else", () => {
      const rows = [
        dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 15 }),
        dataTest({ testType: "ICMP Ping 800", direction: null, pingRttAvg: 45 }),
        dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
        dataTest({ testType: "Ping", direction: null, pingRttAvg: 20 }),
      ];

      expect(excludeCdrPingDuplicates(rows).map((row) => row.testType)).toEqual(["Capacity", "Ping"]);
    });

    it("returns an empty list unchanged", () => {
      expect(excludeCdrPingDuplicates([])).toEqual([]);
    });
  });

  const capacityLinkRow = (overrides: Partial<CapacityLinkRow>): CapacityLinkRow => ({
    location: "Cosmote Data A",
    sessionId: "1",
    testId: 1,
    direction: "DL",
    link: "grx",
    throughputKbps: 140500,
    success: 1,
    failed: 0,
    collectionName: null,
    aSideFileName: null,
    ...overrides,
  });

  describe("mapCapacityLinkRowsToDataCallRows", () => {
    it("turns raw Capacity+link rows into 'Capacity <link>' DataCallRows", () => {
      const mapped = mapCapacityLinkRowsToDataCallRows([
        capacityLinkRow({ direction: "DL", link: "grx", throughputKbps: 140500 }),
        capacityLinkRow({ direction: "UL", link: "akamai", throughputKbps: 22100, sessionId: "2", success: 0, failed: 1 }),
      ]);

      expect(mapped[0]).toMatchObject({
        testType: "Capacity grx",
        direction: "DL",
        capacityThroughputKbps: 140500,
        scoringStatus: "success",
      });
      expect(mapped[1]).toMatchObject({
        testType: "Capacity akamai",
        direction: "UL",
        capacityThroughputKbps: 22100,
        scoringStatus: "failed",
      });
    });

    it("feeds into buildDataSections as EXTRA 'Capacity DL 10GB (grx)'/'(akamai)' sections next to the main Capacity DL/UL, without touching the main totals — Full mode only (2026-08-31: 'θέλω να μου το σπάσεις Link grx και akamai')", () => {
      const rows = [
        dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
        dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
        ...mapCapacityLinkRowsToDataCallRows([
          capacityLinkRow({ direction: "DL", link: "grx", throughputKbps: 140500 }),
          capacityLinkRow({ direction: "DL", link: "akamai", throughputKbps: 130000, sessionId: "2" }),
          capacityLinkRow({ direction: "UL", link: "grx", throughputKbps: 22100, sessionId: "3" }),
          capacityLinkRow({ direction: "UL", link: "akamai", throughputKbps: 21000, sessionId: "4" }),
        ]),
      ];

      const sections = buildDataSections(rows);

      // subRank: κύριο section (χωρίς παρένθεση) πρώτο· "(akamai)" πριν "(grx)" σε ισοπαλία
      // total (1 test έκαστο) -> alphabetical tiebreak.
      expect(sections.map((s) => s.key)).toEqual([
        "Capacity DL 10GB",
        "Capacity DL 10GB (akamai)",
        "Capacity DL 10GB (grx)",
        "Capacity UL 1GB",
        "Capacity UL 1GB (akamai)",
        "Capacity UL 1GB (grx)",
      ]);
      expect(sections.every((s) => s.group === "Ε1 · Bulk throughput")).toBe(true);

      // Το κύριο "Capacity DL 10GB" (CDRCombined) ΔΕΝ επηρεάζεται από το breakdown.
      const mainDl = sections.find((s) => s.key === "Capacity DL 10GB")!;
      expect(mainDl.total.total).toBe(1);
      expect(mainDl.total.metrics[0].value).toBeCloseTo(400, 6);

      const grxDl = sections.find((s) => s.key === "Capacity DL 10GB (grx)")!;
      expect(grxDl.total.total).toBe(1);
      expect(grxDl.total.metrics[0].value).toBeCloseTo(140.5, 6);
    });
  });

  const interactivityRow = (overrides: Partial<InteractivityRow>): InteractivityRow => ({
    location: "Cosmote Data A",
    sessionId: "1",
    testId: 1,
    homeOperator: "Cosmote",
    technology: "LTE",
    status: "Successful",
    patternName: "Game A",
    connectivity: 0.98,
    packetsSent: 100,
    packetsNotSent: 0,
    packetsLost: 2,
    packetsLostRate: 0.02,
    throughput: 500,
    throughputKbps: 4000,
    rtt10thPercentile: 30,
    rttAverage: 25,
    packetDelayMedian: 5,
    duration: 60000,
    qualityIndex: 1,
    qoeScore: 4.2,
    collectionName: null,
    aSideFileName: null,
    ...overrides,
  });

  it("mapInteractivityRowsToDataCallRows turns raw interactivity tests into 'Interactivity' DataCallRows", () => {
    const mapped = mapInteractivityRowsToDataCallRows([
      interactivityRow({ qoeScore: 0.8, rttAverage: 25, packetsLostRate: 0.02, packetDelayMedian: 5, status: "Successful" }),
      interactivityRow({ qoeScore: 0.4, rttAverage: 40, packetsLostRate: 0.1, packetDelayMedian: 9, status: "Failed", sessionId: "2" }),
    ]);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({
      testType: "Interactivity",
      interactivityQoeScore: 0.8,
      interactivityRtt: 25,
      interactivityPacketsLostRate: 0.02,
      interactivityPacketDelay: 5,
      scoringStatus: "Successful",
      host: "Game A",
    });
    expect(mapped[1]).toMatchObject({ testType: "Interactivity", interactivityQoeScore: 0.4, scoringStatus: "Failed" });
  });

  it("feeds Interactivity rows through buildDataSections into its own 'Interactivity' section, with the 5 eGaming metrics", () => {
    const rows = mapInteractivityRowsToDataCallRows([
      interactivityRow({
        throughputKbps: 300,
        rttAverage: 20,
        packetsLostRate: 0.02,
        packetDelayMedian: 10,
        qoeScore: 0.8,
        status: "Successful",
      }),
      interactivityRow({
        throughputKbps: 280,
        rttAverage: 30,
        packetsLostRate: 0.04,
        packetDelayMedian: 14,
        qoeScore: 0.6,
        status: "Successful",
        sessionId: "2",
      }),
    ]);

    const sections = buildDataSections(rows);
    expect(sections.map((s) => s.key)).toEqual(["Interactivity (eGaming)"]);

    const [throughput, rtt, packetsLostRate, packetDelay, qoe] = sections[0].total.metrics;
    expect(throughput).toMatchObject({ label: "eGaming Average of ThroughputKbps", unit: "", value: 290 });
    expect(rtt).toMatchObject({ label: "eGaming Average of RTT", unit: "", value: 25 });
    // PacketsLostRate φτάνει ως raw fraction (0.02/0.04) — *100 για εμφάνιση ως ποσοστό: (0.02+0.04)/2 * 100 = 3.
    expect(packetsLostRate).toMatchObject({ label: "eGaming Average of PacketsLostRate", unit: "%", value: 3 });
    expect(packetDelay).toMatchObject({ label: "eGaming Average of PacketDelay", unit: "", value: 12 });
    // QoEScore ίδιο σκεπτικό: (0.8+0.6)/2 * 100 = 70.
    expect(qoe).toMatchObject({ label: "eGaming Avg QoEScore", unit: "%", value: 70 });
  });

  it("includes a PacketsLostRate of 0 (a perfect run) in the average, unlike the other metrics' >0 filter", () => {
    const rows = mapInteractivityRowsToDataCallRows([
      interactivityRow({ packetsLostRate: 0, sessionId: "1" }),
      interactivityRow({ packetsLostRate: 0.02, sessionId: "2" }),
    ]);

    const sections = buildDataSections(rows);
    const packetsLostRate = sections[0].total.metrics[2];
    // Αν το 0 φιλτραριζόταν έξω (σαν τα άλλα metrics) θα έβγαινε 0.02*100=2, όχι 1.
    expect(packetsLostRate).toMatchObject({ label: "eGaming Average of PacketsLostRate", value: 1 });
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

  const dnsRow = (overrides: Partial<DnsRow>): DnsRow => ({
    location: "Cosmote Data A",
    status: "Success",
    count: 1,
    avg: 20,
    minVal: 10,
    maxVal: 30,
    stdVal: 5,
    ...overrides,
  });

  it("mapDnsRowsToDataCallRows expands each aggregated (location, status, count) group into `count` DataCallRows", () => {
    const mapped = mapDnsRowsToDataCallRows([
      dnsRow({ status: "Success", count: 3, avg: 20 }),
      dnsRow({ status: "Failed", count: 1, avg: 100 }),
    ]);

    expect(mapped).toHaveLength(4);
    expect(mapped.filter((r) => r.scoringStatus === "Success")).toHaveLength(3);
    expect(mapped.filter((r) => r.scoringStatus === "Failed")).toHaveLength(1);
    expect(mapped.every((r) => r.testType === "DNS")).toBe(true);
    // Κάθε αντίγραφο ενός group κρατάει το group's avg σαν "duration" (πάνω στο pingRttAvg).
    expect(mapped.filter((r) => r.scoringStatus === "Success").every((r) => r.pingRttAvg === 20)).toBe(true);
  });

  it("feeds DNS rows through buildDataSections into its own 'DNS' section, weighted-averaging across (location, status) groups", () => {
    // 3 δείγματα με avg=20ms + 1 δείγμα με avg=100ms -> weighted mean = (3×20 + 1×100) / 4 = 40.
    const rows = mapDnsRowsToDataCallRows([
      dnsRow({ status: "Success", count: 3, avg: 20 }),
      dnsRow({ status: "Failed", count: 1, avg: 100 }),
    ]);

    const sections = buildDataSections(rows);
    expect(sections.map((s) => s.key)).toEqual(["DNS Resolution"]);

    const dns = sections[0];
    expect(dns.total.total).toBe(4);
    expect(dns.total.success).toBe(3);
    expect(dns.total.failed).toBe(1);
    expect(dns.total.metrics[0]).toMatchObject({ label: "Mean DNS Resolution Time", unit: "ms", value: 40 });
  });

  it("groups every HTTPS site test into Ε4 regardless of raw format (URL / 'Browser (site)' / bare domain)", () => {
    // Ο πελάτης ανέφερε ότι μόνο το "alpha" (HTTPS Browser (alpha)) έμπαινε στο Ε4 —
    // τα υπόλοιπα site tests δεν αναγνωρίζονταν επειδή httpsSiteKeyword απαιτούσε
    // πλήρες URL. Αυτό το test καλύπτει και τα 3 πιθανά raw formats μαζί.
    const sections = buildDataSections([
      dataTest({ testType: "HTTPS Browser (alpha)", direction: null }),
      dataTest({ testType: "https://www.amazon.com", direction: null }), // πλήρες URL
      dataTest({ testType: "HTTPS Browser (car.gr)", direction: null }), // "Browser (site)"
      dataTest({ testType: "ebay.com", direction: null }), // γυμνό domain
      dataTest({ testType: "google.com", direction: null }),
      dataTest({ testType: "m.imdb.com", direction: null }),
      dataTest({ testType: "in.gr", direction: null }),
      dataTest({ testType: "yahoo.com", direction: null }),
      dataTest({ testType: "youtube.com", direction: null }),
      // Δεν πρέπει να παρασυρθεί εδώ μέσα — ανήκει στο Ε5, όχι στο Ε4.
      dataTest({ testType: "YouTube Service", direction: null }),
    ]);

    expect(sections.map((s) => s.group)).toEqual([
      ...Array.from({ length: 9 }, () => "Ε4 · HTTPS sites"),
      "Ε5 · Video streaming",
    ]);
    expect(sections.map((s) => s.key)).toEqual([
      "HTTPS Browser (alpha)",
      "https://www.amazon.com",
      "HTTPS Browser (car.gr)",
      "ebay.com",
      "google.com",
      "m.imdb.com",
      "in.gr",
      "yahoo.com",
      "youtube.com",
      "YouTube Service",
    ]);
  });

  it("groups every Kepler/Kepler +30s Pause/Newton test into Ε3 regardless of raw format (bare / 'Browser (site)')", () => {
    // Ο πελάτης ανέφερε ότι το Ε3 · Browser engines έλειπε τελείως — ίδιο σκεπτικό με
    // το Ε4 bug: αν το raw TestName φτάνει τυλιγμένο σε "Browser (Kepler)" αντί για
    // γυμνό "Kepler", το ^kepler\b anchor δεν έπιανε τίποτα. parenOrWhole το διορθώνει.
    const sections = buildDataSections([
      dataTest({ testType: "Kepler", direction: null }), // γυμνό
      dataTest({ testType: "HTTP Browser (Kepler 2)", direction: null }), // τυλιγμένο, "+30s Pause" variant
      dataTest({ testType: "HTTPS Browser (Newton)", direction: null }), // τυλιγμένο
    ]);

    expect(sections.map((s) => s.group)).toEqual([
      "Ε3 · Browser engines",
      "Ε3 · Browser engines",
      "Ε3 · Browser engines",
    ]);
    expect(sections.map((s) => s.key)).toEqual(["Kepler", "Kepler +30s Pause", "HTTPS Browser (Newton)"]);
  });

  it("recognizes 'Kepler_2' (underscore instead of a space) as the +30s Pause variant too (2026-08-31: real raw TestName format that \\s* didn't match)", () => {
    const sections = buildDataSections([
      dataTest({ testType: "HTTP Browser (Kepler_2)", direction: null }),
      dataTest({ testType: "Kepler_2", direction: null }), // γυμνό, χωρίς "Browser (...)" wrapper
    ]);

    expect(sections.map((s) => s.key)).toEqual(["Kepler +30s Pause"]);
    expect(sections[0].group).toBe("Ε3 · Browser engines");
    expect(sections[0].total.total).toBe(2);
  });

  it("orders every PS Data Stats section into the 5 groups (Ε1..Ε5, ΣΕΙΡΑ ΠΟΥ ΘΕΛΩ 'QoS → QoE', 2026-08-26)", () => {
    const rows: DataCallRow[] = [
      // Δίνονται σκόπιμα σε ανάκατη σειρά — το test επαληθεύει ότι το sort τα βάζει στη σωστή.
      dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
      dataTest({ testType: "HTTP UL", direction: null, throughputKbps: 5000 }),
      dataTest({ testType: "HTTP Transfer (DL)", direction: null, throughputKbps: 10000 }),
      dataTest({ testType: "HTTPS Browser (alpha)", direction: null }),
      dataTest({ testType: "https://www.youtube.com", direction: null }),
      dataTest({ testType: "https://www.amazon.com", direction: null }),
      dataTest({ testType: "https://www.car.gr", direction: null }),
      dataTest({ testType: "NEWTON", direction: null }),
      // "KEPLER 2" -> renamed to "Kepler +30s Pause" by sectionLabel, βλ. σχόλιο εκεί.
      dataTest({ testType: "KEPLER 2", direction: null }),
      dataTest({ testType: "KEPLER", direction: null }),
      // Άγνωστο/ad-hoc test type — δεν είναι στη λίστα του πελάτη, πρέπει να καταλήξει
      // ακριβώς πριν το Ping 40/800/1000 group, όχι να χαθεί.
      dataTest({ testType: "FTP", direction: "DL", throughputKbps: 1000 }),
      dataTest({ testType: "Ping", direction: null, pingRttAvg: 20 }),
      dataTest({ testType: "ICMP Ping 800", direction: null, pingRttAvg: 45 }),
      dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 15 }),
      dataTest({ testType: "YouTube Service_Live", direction: null }),
      dataTest({ testType: "YouTube Service", direction: null }),
      dataTest({ testType: "YouTube Service_4K", direction: null }),
      ...mapOoklaRowsToDataCallRows([
        ooklaRow({ actionName: "Uplink Performance", sessionId: "ook-ul" }),
        ooklaRow({ actionName: "Downlink Performance", sessionId: "ook-dl" }),
      ]),
      ...mapPing1000RowsToDataCallRows([pingRow({ sessionId: "p1000" })]),
      ...mapInteractivityRowsToDataCallRows([interactivityRow({})]),
      ...mapDnsRowsToDataCallRows([dnsRow({})]),
    ];

    const sections = buildDataSections(rows);

    // Ε1 · Bulk throughput -> Ε2 · Latency/Responsiveness -> Ε3 · Browser engines ->
    // Ε4 · HTTPS sites (αλφαβητικά) -> Ε5 · Video streaming. Το Ookla μπαίνει ΜΕΤΑ το
    // HTTP Transfer μέσα στο Ε1 (όχι πριν, όπως στην παλιά επίπεδη λίστα).
    expect(sections.map((s) => s.key)).toEqual([
      "Capacity DL 10GB",
      "Capacity UL 1GB",
      "HTTP Transfer (DL) 10MB",
      "HTTP Transfer (UL) 5MB",
      "Ookla DL",
      "Ookla UL",
      "FTP DL",
      "Ping",
      "Ping 40 B",
      "Ping 800 B",
      "Ping 1000 B",
      "DNS Resolution",
      "Interactivity (eGaming)",
      "KEPLER",
      "Kepler +30s Pause",
      "NEWTON",
      "HTTPS Browser (alpha)",
      "https://www.amazon.com",
      "https://www.car.gr",
      "https://www.youtube.com",
      "YouTube Service",
      "YouTube Service 4K",
      "YouTube Service Live",
    ]);

    expect(sections.map((s) => s.group)).toEqual([
      "Ε1 · Bulk throughput",
      "Ε1 · Bulk throughput",
      "Ε1 · Bulk throughput",
      "Ε1 · Bulk throughput",
      "Ε1 · Bulk throughput",
      "Ε1 · Bulk throughput",
      "", // FTP DL — unmatched, καμία ενότητα
      "", // Ping — unmatched, καμία ενότητα
      "Ε2 · Latency / Responsiveness",
      "Ε2 · Latency / Responsiveness",
      "Ε2 · Latency / Responsiveness",
      "Ε2 · Latency / Responsiveness",
      "Ε2 · Latency / Responsiveness",
      "Ε3 · Browser engines",
      "Ε3 · Browser engines",
      "Ε3 · Browser engines",
      "Ε4 · HTTPS sites",
      "Ε4 · HTTPS sites",
      "Ε4 · HTTPS sites",
      "Ε4 · HTTPS sites",
      "Ε5 · Video streaming",
      "Ε5 · Video streaming",
      "Ε5 · Video streaming",
    ]);
  });

  describe("compact view — buildDirectionalDataSections", () => {
    it("merges the Ε1 DL/UL pairs (Capacity, Ookla) into one directional section each, leaving the rest (incl. HTTP Transfer) untouched", () => {
      const { merged, rest } = buildDirectionalDataSections(
        buildDataSections([
          dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
          dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
          dataTest({ testType: "HTTP Transfer (DL)", direction: null, throughputKbps: 10000 }),
          dataTest({ testType: "HTTP UL", direction: null, throughputKbps: 5000 }),
          ...mapOoklaRowsToDataCallRows([
            ooklaRow({ actionName: "Downlink Performance", sessionId: "ook-dl" }),
            ooklaRow({ actionName: "Uplink Performance", sessionId: "ook-ul" }),
          ]),
          dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 15 }),
          dataTest({ testType: "YouTube Service", direction: null, youtubeMos: 4.2 }),
        ]),
      );

      // HTTP Transfer (2026-08-31: αφαιρέθηκε από το compact merge) ΔΕΝ είναι εδώ.
      expect(merged.map((s) => s.key)).toEqual(["Capacity DL 10GB / Capacity UL 1GB", "Ookla DL / Ookla UL"]);
      expect(merged.every((s) => s.group === "Ε1 · Bulk throughput")).toBe(true);
      // Ό,τι δεν είχε (ή δεν έχει πια) DL/UL merge μένει ξεχωριστό section, ίδιο με το Full mode.
      expect(rest.map((s) => s.key)).toEqual(["HTTP Transfer (DL) 10MB", "HTTP Transfer (UL) 5MB", "Ping 40 B", "YouTube Service"]);
    });

    it("keeps DL and UL as separate totals instead of averaging them together", () => {
      const { merged } = buildDirectionalDataSections(
        buildDataSections([
          // Capacity DL: 3 tests × 400 Mbps.
          ...Array.from({ length: 3 }, () =>
            dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
          ),
          // Capacity UL: 1 test × 40 Mbps — δεν πρέπει να μπερδευτεί με το DL avg.
          dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
        ]),
      );

      const [capacity] = merged;
      expect(capacity.total.dl.total).toBe(3);
      expect(capacity.total.dl.metrics[0]).toMatchObject({ value: 400, samples: 3 });
      expect(capacity.total.ul.total).toBe(1);
      expect(capacity.total.ul.metrics[0]).toMatchObject({ value: 40, samples: 1 });
    });

    it("zeroes out the missing side instead of dropping the whole pair when only one direction has data", () => {
      const { merged } = buildDirectionalDataSections(
        buildDataSections([dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 })]),
      );

      expect(merged).toHaveLength(1);
      expect(merged[0].total.dl.total).toBe(1);
      expect(merged[0].total.ul).toMatchObject({ total: 0, successRate: null });
      expect(merged[0].total.ul.metrics).toEqual([]);
    });

    it("keeps operators separate within each direction", () => {
      const { merged } = buildDirectionalDataSections(
        buildDataSections([
          dataTest({ Location: "Cosmote Data A", testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
          dataTest({ Location: "Nova Data A", testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
        ]),
      );

      const [capacity] = merged;
      expect(capacity.byOperator.get("COSMOTE")?.dl.total).toBe(1);
      expect(capacity.byOperator.get("COSMOTE")?.ul.total).toBe(0);
      expect(capacity.byOperator.get("NOVA")?.dl.total).toBe(0);
      expect(capacity.byOperator.get("NOVA")?.ul.total).toBe(1);
    });

    it("has no merged sections at all for an empty section list", () => {
      expect(buildDirectionalDataSections([])).toEqual({ merged: [], rest: [] });
    });
  });

  describe("compact view — buildHttpsSitesTotal", () => {
    it("merges every Ε4 HTTPS site into one section at the group's original position, leaving other groups untouched", () => {
      const sections = buildDataSections([
        dataTest({ testType: "https://www.amazon.com", direction: null, throughputKbps: 6000 }),
        dataTest({ testType: "https://www.amazon.com", direction: null, throughputKbps: 6000 }),
        dataTest({ testType: "https://www.car.gr", direction: null, throughputKbps: 3000 }),
        dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 15 }),
      ]);

      const result = buildHttpsSitesTotal(sections);

      // Ping 40 B (Ε2) πριν, ΕΝΑ section στη θέση όπου ξεκινούσε το Ε4.
      expect(result.map((s) => s.key)).toEqual(["Ping 40 B", SECTION_GROUP_LABELS.httpsSites]);
      const [, sites] = result;
      expect(sites.group).toBe(SECTION_GROUP_LABELS.httpsSites);
      // amazon×2 (6 Mbps) + car.gr×1 (3 Mbps) -> weighted (6+6+3)/3 = 5, total 3.
      expect(sites.total.total).toBe(3);
      expect(sites.total.metrics[0]).toMatchObject({ unit: "Mbps", samples: 3 });
      expect(sites.total.metrics[0].value).toBeCloseTo(5, 6);
    });

    it("returns the sections unchanged when there is no Ε4 HTTPS site at all", () => {
      const sections = buildDataSections([dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 15 })]);
      expect(buildHttpsSitesTotal(sections)).toBe(sections);
    });

    it("returns an empty list for an empty section list", () => {
      expect(buildHttpsSitesTotal([])).toEqual([]);
    });
  });

  describe("compact view — buildPingTotal", () => {
    it("merges Ping 40 B/800 B/1000 B into one 'Ping (all sizes combined)' section at the first one's position, leaving other sections untouched", () => {
      const ping1000Rows = mapPing1000RowsToDataCallRows([pingRow({ packetSize: 1000, rtt: 60, success: 1, failed: 0 })]);
      const sections = buildDataSections([
        dataTest({ testType: "ICMP Ping 40", direction: null, pingRttAvg: 15 }),
        dataTest({ testType: "ICMP Ping 800", direction: null, pingRttAvg: 45 }),
        ...ping1000Rows,
        dataTest({ testType: "Ping", direction: null, pingRttAvg: 20 }),
        dataTest({ testType: "YouTube Service", direction: null, youtubeMos: 4.2 }),
      ]);

      const result = buildPingTotal(sections);

      // "Ping" (γυμνό, χωρίς μέγεθος) ΔΕΝ μπαίνει στο merge — μένει ξεχωριστό, στη θέση του.
      expect(result.map((s) => s.key)).toEqual(["Ping", "Ping (all sizes combined)", "YouTube Service"]);
      const pingTotal = result.find((s) => s.key === "Ping (all sizes combined)")!;
      expect(pingTotal.group).toBe(SECTION_GROUP_LABELS.latency);
      expect(pingTotal.total.total).toBe(3);
      // (15 + 45 + 60) / 3 = 40.
      expect(pingTotal.total.metrics[0]).toMatchObject({ unit: "ms", samples: 3 });
      expect(pingTotal.total.metrics[0].value).toBeCloseTo(40, 6);
    });

    it("returns the sections unchanged when there is no Ping B section at all", () => {
      const sections = buildDataSections([dataTest({ testType: "YouTube Service", direction: null, youtubeMos: 4.2 })]);
      expect(buildPingTotal(sections)).toBe(sections);
    });

    it("returns an empty list for an empty section list", () => {
      expect(buildPingTotal([])).toEqual([]);
    });
  });

  describe("pingPacketSizeBytes", () => {
    it("parses the byte count out of the Ping 40 B / 800 B / 1000 B section labels", () => {
      expect(pingPacketSizeBytes("Ping 40 B")).toBe(40);
      expect(pingPacketSizeBytes("Ping 800 B")).toBe(800);
      expect(pingPacketSizeBytes("Ping 1000 B")).toBe(1000);
    });

    it("returns null for anything that isn't one of the three Ping B sections", () => {
      expect(pingPacketSizeBytes("Ping")).toBeNull();
      expect(pingPacketSizeBytes("DNS Resolution")).toBeNull();
      expect(pingPacketSizeBytes("HTTPS sites (all sites combined)")).toBeNull();
    });
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

  it("buildFakeEventTable counts isValid=0 rows per operator, scoped to GSM/FREE mode", () => {
    const rows = [
      call({ Location: "Cosmote GSM", isValid: 0 }),
      call({ Location: "Cosmote GSM", isValid: 1 }),
      call({ Location: "Cosmote Free A", isValid: 0 }),
      call({ Location: "Vodafone Free A", isValid: 0 }),
      call({ Location: "Vodafone Free A", isValid: 0 }),
      // Valid rows and other-mode rows must not count.
      call({ Location: "Nova Data A", isValid: 0 }),
    ];

    const free = buildFakeEventTable(rows, "FREE");
    expect(free.byOperator.get("COSMOTE")).toBe(1);
    expect(free.byOperator.get("VODAFONE")).toBe(2);
    expect(free.byOperator.has("NOVA")).toBe(false);
    expect(free.total).toBe(3);

    const gsm = buildFakeEventTable(rows, "GSM");
    expect(gsm.byOperator.get("COSMOTE")).toBe(1);
    expect(gsm.total).toBe(1);
  });

  it("buildVoiceTable wires fakeEvents into BOTH GSM and FREE tables (unlike cellCount/srvcc)", () => {
    const validRows = [call({ Location: "Cosmote GSM" }), call({ Location: "Cosmote Free A" })];
    // Ξεχωριστό array, σαν το ΑΝΕΠΕΞΕΡΓΑΣΤΟ allCallsRows πριν το "Valid calls only" filter
    // του SummaryTab — περιέχει isValid=0 γραμμές που δεν είναι καν στο validRows.
    const rawRows = [
      ...validRows,
      call({ Location: "Cosmote GSM", isValid: 0 }),
      call({ Location: "Cosmote Free A", isValid: 0 }),
      call({ Location: "Cosmote Free A", isValid: 0 }),
    ];

    const gsm = buildVoiceTable(validRows, "GSM", [], [], rawRows);
    expect(gsm.byOperator.get("COSMOTE")?.fakeEvents).toBe(1);
    expect(gsm.total.fakeEvents).toBe(1);

    const free = buildVoiceTable(validRows, "FREE", [], [], rawRows);
    expect(free.byOperator.get("COSMOTE")?.fakeEvents).toBe(2);
    expect(free.total.fakeEvents).toBe(2);
  });

  it("buildVoiceTable leaves fakeEvents null when no fakeEventRows are passed", () => {
    const rows = [call({ Location: "Cosmote GSM" })];
    const gsm = buildVoiceTable(rows, "GSM");
    expect(gsm.byOperator.get("COSMOTE")?.fakeEvents).toBeNull();
    expect(gsm.total.fakeEvents).toBeNull();
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
    expect(period.weekTo).toBe(29);
    expect(period.from?.getDate()).toBe(13);
    expect(period.to?.getDate()).toBe(15);
  });

  it("exposes a separate weekTo when the selection spans more than one ISO week (e.g. multiple collections from different weeks)", () => {
    const period = buildReportPeriod(["2026-07-13T08:00:00", "2026-07-27T08:00:00"]);
    expect(period.week).toBe(29);
    expect(period.weekTo).toBe(31);
  });

  it("survives an empty dataset", () => {
    expect(buildReportPeriod([])).toEqual({ from: null, to: null, week: null, weekTo: null });
  });
});
