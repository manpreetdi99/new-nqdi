import { describe, expect, it } from "vitest";
import type { MosTestRow, SpeechSampleRow } from "@/lib/api";
import { buildCallAnalysisGroups, buildDeviceCdrGroups, buildMosSpeechTests, CDR_SIDE_KEYS, cleanDescription, fmtPercent, callMidpoint, eventName, fmtCell, isNearTime, isoClock, syncNavigateTarget, toLocalNaiveIso, traceLogInfo } from "./nativeCallData";

describe("nativeCallData", () => {
  it("formats naive ISO clocks without timezone conversion", () => {
    expect(isoClock("2026-09-21T08:37:24.204000")).toBe("08:37:24.204");
    expect(isoClock("2026-09-21T08:37:24")).toBe("08:37:24.000");
    expect(isoClock("2026-09-21T08:37:24.2")).toBe("08:37:24.200");
    expect(isoClock(null)).toBe("—");
    expect(isoClock("not a date")).toBe("not a date");
  });

  it("formats cells", () => {
    expect(fmtCell(null)).toBe("—");
    expect(fmtCell("")).toBe("—");
    expect(fmtCell(2820867)).toBe("2820867");
    expect(fmtCell(-122.5)).toBe("-122.5");
    expect(fmtCell(17.36400032043457)).toBe("17.364");
    expect(fmtCell("2026-09-21T08:37:45.727000")).toBe("08:37:45.727");
    expect(fmtCell("VoLTE")).toBe("VoLTE");
  });

  it("strips the top-group/group prefix from event names", () => {
    const base = { EventShortName: null, EventTopGroup: "Voice Service", EventGroup: "Call Marker" };
    expect(eventName({ ...base, EventFullName: "Voice Service - Call Marker - Start Dial" })).toBe("Start Dial");
    expect(eventName({ ...base, EventFullName: "Something else" })).toBe("Something else");
    expect(eventName({ ...base, EventShortName: "IF Handover", EventFullName: "LTE IF Handover" })).toBe("IF Handover");
    expect(eventName({ ...base, EventFullName: null })).toBe("—");
  });

  it("navigates B call sessions to their A session", () => {
    expect(syncNavigateTarget({ SessionType: "CALL", SessionSide: "A", SessionId: 42949673010, RelatedSessionId: 47244640306 })).toBe("42949673010");
    expect(syncNavigateTarget({ SessionType: "CALL", SessionSide: "B", SessionId: 47244640306, RelatedSessionId: 42949673010 })).toBe("42949673010");
    expect(syncNavigateTarget({ SessionType: "CALL", SessionSide: "B", SessionId: 1, RelatedSessionId: null })).toBeNull();
    expect(syncNavigateTarget({ SessionType: "IDLE", SessionSide: "A", SessionId: 1, RelatedSessionId: null })).toBeNull();
  });

  it("builds naive local timestamps for the sync instant", () => {
    const start = new Date(2026, 8, 21, 8, 37, 24);
    const end = new Date(2026, 8, 21, 8, 37, 44);
    expect(toLocalNaiveIso(start)).toBe("2026-09-21T08:37:24");
    expect(callMidpoint(start.toISOString(), end.toISOString())).toBe("2026-09-21T08:37:34");
    expect(callMidpoint(start.toISOString(), "bad")).toBe("2026-09-21T08:37:24");
    expect(callMidpoint("bad", end.toISOString())).toBeNull();
  });

  it("matches rows to the shared cursor", () => {
    const t = new Date("2026-09-21T08:37:24.204").getTime();
    expect(isNearTime("2026-09-21T08:37:25.000", t)).toBe(true);
    expect(isNearTime("2026-09-21T08:37:30.000", t)).toBe(false);
    expect(isNearTime("2026-09-21T08:37:25.000", null)).toBe(false);
  });

  it("renders TraceLog info, building it from IP trace fields for fallback rows", () => {
    const none = { Info: null, Source: null, Destination: null, Direction: null, Protocol: null, Message: null };
    expect(traceLogInfo({ ...none, TraceSource: "TraceLog", Info: "Dial started" })).toBe("Dial started");
    expect(traceLogInfo({ ...none, TraceSource: "IP", Protocol: "SIP", Direction: "UL", Source: "10.0.0.1", Destination: "10.0.0.2", Message: "INVITE" }))
      .toBe("SIP · UL · 10.0.0.1 → 10.0.0.2 · INVITE");
    expect(traceLogInfo({ ...none, TraceSource: "IP", Protocol: "DNS", Destination: "8.8.8.8" })).toBe("DNS · ? → 8.8.8.8");
    expect(traceLogInfo({ ...none, TraceSource: "IP" })).toBeNull();
  });

  it("shows every CDR side value exactly once in the merged device table", () => {
    const a = Object.fromEntries(CDR_SIDE_KEYS.map((k) => [k, `a:${k}`]));
    const b = Object.fromEntries(CDR_SIDE_KEYS.map((k) => [k, `b:${k}`]));
    const rows = buildDeviceCdrGroups(null, a, b).flatMap((g) => g.rows);
    const values = rows.flatMap((r) => [r.a, r.b]).filter((v) => v != null);
    expect([...values].sort()).toEqual([...Object.values(a), ...Object.values(b)].sort());
    const labels = rows.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("prefers device info over CDR for shared fields, keeping one row each", () => {
    const info = {
      fileInfo: { ASideDevice: "FL-A", BSideDevice: null, ASideNumber: null, BSideNumber: null, IMEI: "IMEI-FL", FirmwareV: null, IMSI: null,
        ProductVersion: null, MFVersion: null, SWVersion: null, ASideFileName: "a.mf", BSideFileName: null, ASideLocation: null, BSideLocation: null },
      aSideDevice: { Model: "DM-A", IMEI: null, IMSI: null, Firmware: null, Number: null, Side: "A", DeviceType: null, RFManufacturer: null, RFModel: null, SerialNumber: null, OS: null, BaseBand: null },
      bSideDevice: null,
    } as unknown as Parameters<typeof buildDeviceCdrGroups>[0];
    const rows = buildDeviceCdrGroups(info, { Model: "CDR-A", Imei: "IMEI-CDR", FileName: "cdr-a" }, { Model: "CDR-B", FileName: "cdr-b" })
      .flatMap((g) => g.rows);
    const row = (label: string) => rows.find((r) => r.label === label);
    expect(row("Device")).toEqual({ label: "Device", a: "DM-A", b: "CDR-B" });
    expect(row("IMEI")).toEqual({ label: "IMEI", a: "IMEI-FL", b: null });
    expect(row("File")).toEqual({ label: "File", a: "a.mf", b: "cdr-b" });
    expect(rows.some((r) => ["Model", "Imei", "FileName"].includes(r.label))).toBe(false);
  });

  it("hides rows and groups without values", () => {
    expect(buildDeviceCdrGroups(null, null, null)).toEqual([]);
    const groups = buildDeviceCdrGroups(null, { CallMode: "VoLTE" }, null);
    expect(groups).toEqual([{ title: "Δίκτυο & κλήση", rows: [{ label: "CallMode", a: "VoLTE", b: null }] }]);
  });
  it("builds call analysis groups, hiding empty rows and zero counters", () => {
    const groups = [
      { title: "Ταξινόμηση", keys: ["code", "UnclassifiedReason"], hideZero: false },
      { title: "Μετρητές SIP", keys: ["numSIPBYERequest", "numSIPINVITERequest"], hideZero: true },
      { title: "Radio NR", keys: ["avgNR5GRSRP"], hideZero: false },
    ];
    const a = { code: "C3.120", UnclassifiedReason: null, numSIPBYERequest: 0, numSIPINVITERequest: 1, avgNR5GRSRP: null };
    const b = { code: "I", UnclassifiedReason: "B-side είναι Landunit", numSIPBYERequest: 0, numSIPINVITERequest: 0 };
    expect(buildCallAnalysisGroups(groups, a, b)).toEqual([
      { title: "Ταξινόμηση", rows: [
        { key: "code", a: "C3.120", b: "I" },
        { key: "UnclassifiedReason", a: null, b: "B-side είναι Landunit" },
      ] },
      { title: "Μετρητές SIP", rows: [{ key: "numSIPINVITERequest", a: 1, b: 0 }] },
    ]);
    // Εκτός μετρητών το 0 είναι τιμή και μένει.
    expect(buildCallAnalysisGroups([{ title: "G", keys: ["noL3Duration"], hideZero: false }], { noL3Duration: 0 }, null))
      .toEqual([{ title: "G", rows: [{ key: "noL3Duration", a: 0, b: null }] }]);
    expect(buildCallAnalysisGroups(groups, null, null)).toEqual([]);
  });

  it("cleans Scene descriptions and formats fractions", () => {
    expect(cleanDescription("Failed, SIP CANCEL Request sent, Low RSRQ, Low SINR/  ")).toBe("Failed, SIP CANCEL Request sent, Low RSRQ, Low SINR");
    expect(cleanDescription("Failed, Low SINR;  ")).toBe("Failed, Low SINR");
    expect(cleanDescription("  ")).toBeNull();
    expect(cleanDescription(null)).toBeNull();
    expect(fmtPercent(0.246)).toBe("24.6 %");
    expect(fmtPercent(null)).toBe("—");
  });

  it("joins MOS per test with speech samples by TestId (full outer, ordered by time)", () => {
    const mosRow = (o: Partial<MosTestRow>): MosTestRow => ({
      TestId: 1, Direction: "B->A", FullDate: "2026-09-21T07:47:41.236000", MOS: 4.72, Status: "Completed",
      CodecName: "EVS", CodecRate: 13.2, CodecDirection: "DL", Duration: 5000, DirectionStatus: "Active",
      CodecPerTestRatio: 1, CodecRatePerTestRatio: 1, CodecRateUsageRank: 1,
      EARFCN: 1850, PCI: 101, RSRP: -95.5, RSRQ: -11, SINR: 12, ...o,
    });
    const sample = (o: Partial<SpeechSampleRow>): SpeechSampleRow => ({
      FactId: 1, FullDate: "2026-09-21T07:47:41.236000", SessionId: 10, TestId: 1, Side: "A", Direction: "B->A",
      LQ: 4.7199997, LQIsBad: 0, IPAudioRTT: 310, ...o,
    } as SpeechSampleRow);

    const tests = buildMosSpeechTests(
      [mosRow({}), mosRow({ CodecDirection: "UL", CodecName: "AMR-WB" }),
        mosRow({ TestId: 4, Direction: "A->B", FullDate: "2026-09-21T07:48:00.000000", MOS: null })],
      [sample({ FactId: 9, TestId: 4, Side: "B", Direction: "A->B", FullDate: "2026-09-21T07:48:00.000000", LQ: 3.1 }),
        sample({}),
        sample({ FactId: 7, TestId: 2, FullDate: "2026-09-21T07:47:50.000000", LQ: 2.5 })],
    );
    expect(tests.map((t) => t.testId)).toEqual([1, 2, 4]);
    expect(tests[0]).toMatchObject({ side: "A", mos: 4.72, status: "Completed", lte: { EARFCN: 1850, PCI: 101 } });
    expect(tests[0].codecs.map((c) => c.CodecDirection)).toEqual(["DL", "UL"]);
    expect(tests[0].sample?.FactId).toBe(1);
    // μόνο FactSpeech: χωρίς codecs/LTE, MOS από το LQ
    expect(tests[1]).toMatchObject({ side: "A", mos: 2.5, status: null, codecs: [], lte: null });
    // POLQA χωρίς MOS -> το LQ του δείγματος
    expect(tests[2]).toMatchObject({ side: "B", mos: 3.1, direction: "A->B" });
    expect(buildMosSpeechTests([], [])).toEqual([]);
  });
});
