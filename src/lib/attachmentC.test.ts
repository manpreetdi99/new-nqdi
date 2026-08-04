import { describe, it, expect } from "vitest";

import {
  bucketTechnology,
  buildDataSections,
  buildReportPeriod,
  buildTechnologyMix,
  buildVoiceStats,
  buildVoiceTable,
  classifyCallStatus,
  collectOperators,
  isoWeek,
  resolveMode,
  resolveOperator,
} from "@/lib/attachmentC";
import type { AllCallsRow, DataCallRow } from "@/lib/api";

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
    const stats = buildVoiceStats([
      call({ callDir: "A->B", setupTime: 3 }),
      call({ callDir: "A->B", setupTime: 5 }),
      call({ callDir: "B->A", setupTime: 2 }),
    ]);

    expect(stats.setupMoc).toEqual({ avg: 4, samples: 2 });
    expect(stats.setupMtc).toEqual({ avg: 2, samples: 1 });
    expect(stats.setupAll.avg).toBeCloseTo(10 / 3, 12);
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

describe("PS data KPIs", () => {
  it("splits sections by test name + direction and scores them", () => {
    const sections = buildDataSections([
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 400000 }),
      dataTest({ testType: "Capacity", direction: "DL", capacityThroughputKbps: 500000, scoringStatus: "F" }),
      dataTest({ testType: "Capacity", direction: "UL", capacityThroughputKbps: 40000 }),
      dataTest({ testType: "Ping", direction: null, pingRttAvg: 30 }),
    ]);

    const capacityDl = sections.find((section) => section.key === "Capacity DL");
    expect(capacityDl?.total.total).toBe(2);
    expect(capacityDl?.total.success).toBe(1);
    expect(capacityDl?.total.failed).toBe(1);
    expect(capacityDl?.total.successRate).toBe(0.5);
    // Το throughput μετριέται σε Mbps και μπαίνουν και τα failed samples που έγραψαν ρυθμό.
    expect(capacityDl?.total.metrics[0].value).toBeCloseTo(450, 6);

    const ping = sections.find((section) => section.key === "Ping");
    expect(ping?.total.metrics[0]).toMatchObject({ label: "Mean RTT", unit: "ms", higherIsBetter: false, value: 30 });
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
