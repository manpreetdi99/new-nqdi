import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallEventsPanel, NativeCallPanels, PcapButtons } from "./NativeCallPanels";
import * as api from "@/lib/api";
import type { CallDeviceInfo, CallEventRow } from "@/lib/api";

function event(overrides: Partial<CallEventRow>): CallEventRow {
  return {
    FactId: 1, FullDate: "2026-09-21T08:37:24.204000", SessionId: 42949673010, Side: "A", TestId: null, KPIId: null,
    EventTopGroup: "Voice Service", EventGroup: "Call Marker", EventFullName: "Voice Service - Call Marker - Start Dial",
    EventShortName: null, EventSubType: null, SummaryInfo: "Start Dial, Called Party: 69…", EventSource: null,
    L3Content: null, SCellsLTE: null, SCells5GNR: null, SignalStrengthBefore: null, SignalQualityAfter: null,
    FactIdLayer3Messages: null, L3Technology: null, L3Layer: null, L3Direction: null, L3MsgName: null, L3MsgInfo: null,
    Latitude: null, Longitude: null, ...overrides,
  };
}

const events: CallEventRow[] = [
  event({}),
  event({ FactId: 2, FullDate: "2026-09-21T08:37:25.755000", EventTopGroup: "RRM", EventGroup: "LTE",
    EventFullName: "LTE IF Handover Attempt LTE PCell", EventShortName: "IF Handover Attempt LTE PCell",
    L3MsgName: "RRCConnectionReconfiguration", L3Direction: "D" }),
  event({ FactId: 3, FullDate: "2026-09-21T08:37:45.727000", EventGroup: "Call Status",
    EventFullName: "Voice Service - Call Status - Call Failed", SummaryInfo: "Call Failed, Call Duration: 17,364 s" }),
  event({ FactId: 4, Side: "B", SessionId: 47244640306, EventTopGroup: "Data Service", EventGroup: "Test Border",
    EventFullName: "Data Service - Test Border - Test Start" }),
];

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(api, "fetchCallCdr").mockResolvedValue({
    pairSource: "FactCallSession",
    call: { CallStatus: "Failed", CallType: "Phone", Valid: "Valid", InvalidReason: null },
    a: { CallMode: "VoLTE", StartCellId: 2820867, StartRsrpRscpRxLev: -122.5, CsfbStatus: null },
    b: { CallMode: "CSFB", StartCellId: null, StartRsrpRscpRxLev: null, CsfbStatus: "Successful" },
  });
  vi.spyOn(api, "fetchCallEvents").mockResolvedValue({ pairSource: "FactCallSession", events });
  vi.spyOn(api, "fetchCallRtp").mockResolvedValue({
    pairSource: "FactCallSession", samples: [],
    summary: { a: { SampleCount: 0, streams: [] } as unknown as api.RtpSummary, b: { SampleCount: 0, streams: [] } as unknown as api.RtpSummary },
  });
  vi.spyOn(api, "fetchCallMarkersV2").mockResolvedValue({ pairSource: "FactCallSession", markers: [] });
  vi.spyOn(api, "fetchUeCapability").mockResolvedValue({ pairSource: "FactCallSession", a: null, b: null });
  vi.spyOn(api, "fetchCallSystemTrace").mockResolvedValue({ pairSource: "FactCallSession", limit: 500, offset: 0, system: { total: 0, rows: [] } });
  vi.spyOn(api, "fetchSyncDevices").mockResolvedValue({ at: "", devices: [] });
  vi.spyOn(api, "fetchCallAnalysis").mockResolvedValue(callAnalysis);
  vi.spyOn(api, "fetchCallSessionsNative").mockResolvedValue(sceneSessions);
  vi.spyOn(api, "fetchMosTestDetail").mockResolvedValue({ mosTests: [] });
  vi.spyOn(api, "fetchSpeechSamples").mockResolvedValue({
    pairSource: "FactCallSession", samples: [],
    summary: { A: { SampleCount: 0 } as api.SpeechSummary, B: { SampleCount: 0 } as api.SpeechSummary },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const window0 = { rsrp: null, rsrq: null, sinr: null, n: null };
const callAnalysis: api.CallAnalysisResponse = {
  pairSource: "FactCallSession",
  groups: [
    { title: "Ταξινόμηση", keys: ["callStatus", "code"], hideZero: false },
    { title: "Μετρητές SIP", keys: ["numSIPBYERequest"], hideZero: true },
  ],
  a: {
    SessionId: 519691042840, Side: "A", callStatus: "Dropped", code: "C2.111", numSIPBYERequest: 0,
    Description: "Dropped, RTP timeout/ ", DescriptionGroup: "Others", UnclassifiedReason: null,
    SetupTime_s: 3.2, SetupTimeSentinel: false,
    radioWindow: {
      applies: true, outsideCall: true, overshootMs: 43242,
      disconnectNative: "2026-09-22T19:26:05.721000", disconnectFixed: "2026-09-22T19:25:22.479000",
      native: window0, fixed: { rsrp: -131, rsrq: -20, sinr: -14, n: 8 },
    },
  },
  b: {
    SessionId: 523986010136, Side: "B", callStatus: "Completed", code: "I", numSIPBYERequest: 0,
    Description: null, DescriptionGroup: null, UnclassifiedReason: "B-side είναι Landunit: ο native classifier ταξινομεί μόνο Phone",
    SetupTime_s: null, SetupTimeSentinel: false,
    radioWindow: { applies: false, outsideCall: false, overshootMs: null, disconnectNative: null, disconnectFixed: null, native: window0, fixed: null },
  },
};

function sceneSession(overrides: Partial<api.NativeSessionRow>): api.NativeSessionRow {
  return {
    Side: "A", session_session_id: 85899345934, session_session_id_formatted: "20-14", session_session_type: "CALL",
    session_session_status: "Dropped", session_side: "A", session_invalid: "Valid", session_invalid_reason: null,
    file_valid: "Valid", sceneValid: true, file_file_id: 20, file_file_name: "a.mf", file_collection_name: "DOD_KOS",
    device_location: "Nova GSM", device_model: "SM-S918B", device_imei: "350000000000001", device_device_type: "UE",
    home_operator_provider: "NOVA", operator_provider: "Cosmote", roaming: true, analysiscomment_analysis_comment: null,
    StartTime: "2026-09-21T08:00:00.000000", EndTime: "2026-09-21T08:01:30.000000", Duration: 90000, Distance: 2.9,
    ServingCellCount: 3, RelatedSessionId: 90194313230, technologies: ["GSM"], ...overrides,
  };
}

const sceneSessions: api.CallSessionsNativeResponse = {
  pairSource: "FactCallSession",
  a: sceneSession({}),
  b: sceneSession({ Side: "B", session_session_id: 90194313230, session_session_id_formatted: "21-14", sceneValid: false,
    session_invalid: "Invalid", device_location: "LU01-2YM6422", device_device_type: "LU",
    home_operator_provider: "Unknown", operator_provider: "Unknown", roaming: false, technologies: [] }),
  callInfo: {
    session_session_id: 85899345934, call_information_callid: "20-14 A->B", call_information_direction: "A->B",
    call_information_call_mode: "CS", call_information_call_mode_b: "-", call_information_status: "Dropped",
    call_information_type: "M->L", call_information_description_a: "Dropped, Low RxLev", call_information_description_b: null,
  },
  tests: [{
    Side: "A", session_session_id: 85899345934, test_test_id: 1, test_test_id_formatted: "20-1", test_test_name: "Wind GSM",
    test_service: "Speech WB POLQA", test_service_category: null, test_service_class: null, test_test_type: "Speech",
    test_direction: "A->B", test_status: "System Release", test_quality_indicatior: null, test_invalid: "Valid",
    StartTime: "2026-09-21T08:00:10.000000", EndTime: "2026-09-21T08:00:15.500000", Duration: 5500,
  }],
};

const deviceInfo = {
  fileInfo: {
    ASideDevice: "SM-S918B", BSideDevice: null, ASideNumber: "6900000001", BSideNumber: "6900000002",
    IMEI: "350000000000001", FirmwareV: null, IMSI: null, ProductVersion: null, MFVersion: null, SWVersion: "25.3",
    ASideFileName: "a.mf", BSideFileName: "b.mf", ASideLocation: "LU01 A", BSideLocation: "LU01 B",
  },
  aSideDevice: null,
  bSideDevice: null,
} as unknown as CallDeviceInfo;

function renderPanels(onVoiceEvents = vi.fn(), onCallAnalysis = vi.fn()) {
  render(
    <>
      <CallEventsPanel
        database="DOD_26H2" sessionId="42949673010"
        hoveredTime={null} onHoverTime={vi.fn()} onVoiceEvents={onVoiceEvents}
      />
      <NativeCallPanels
        database="DOD_26H2" sessionId="42949673010"
        callStart="2026-09-21T05:37:24.000Z" callEnd="2026-09-21T05:37:45.000Z"
        hoveredTime={null} onHoverTime={vi.fn()} deviceInfo={deviceInfo} onCallAnalysis={onCallAnalysis}
      />
    </>,
  );
  return onVoiceEvents;
}

describe("NativeCallPanels", () => {
  it("keeps every collapsible panel closed by default, in the requested order", async () => {
    renderPanels();
    const titles = screen.getAllByRole("button", { expanded: false }).map((b) => b.textContent ?? "");
    const order = ["Event timeline", "Call Analysis", "Session & tests (Scene)", "Markers", "MOS ανά test & Speech samples", "RTP / VoLTE", "UE Capability", "Συσκευές την ίδια στιγμή"];
    const positions = order.map((t) => titles.findIndex((x) => x.startsWith(t)));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(screen.queryByRole("button", { expanded: true })).toBeNull();
    expect(screen.queryByText("CDR κλήσης")).toBeNull();
  });

  it("always shows device & file cards, with the rest of the CDR behind More details", async () => {
    renderPanels();
    // Το Scanner & Κινητό δεν κλείνει· συσκευή και αρχείο φαίνονται χωρίς κλικ
    expect(screen.queryByRole("button", { name: /Scanner & Κινητό/ })).toBeNull();
    expect(screen.getByText("SM-S918B")).toBeTruthy();
    expect(screen.getByText("6900000001")).toBeTruthy();
    expect(screen.getByText("a.mf")).toBeTruthy();
    expect(screen.getByText("LU01 B")).toBeTruthy();
    // Οι δύο κάρτες έχουν τις ίδιες γραμμές, μία ανά πληροφορία
    expect(screen.getAllByText("IMEI")).toHaveLength(2);
    expect(screen.queryByText("Model")).toBeNull();
    expect(screen.queryByText("Imei")).toBeNull();

    // Τα υπόλοιπα του CDR μόνο μετά το «More details»
    const more = await screen.findByRole("button", { name: /More details/ });
    expect(screen.queryByText("CallMode")).toBeNull();
    fireEvent.click(more);
    const callModeRow = screen.getByText("CallMode").closest("tr") as HTMLElement;
    expect([...callModeRow.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["CallMode", "VoLTE", "CSFB"]);
    expect(screen.getByText("2820867")).toBeTruthy();
    expect(screen.getByText("Successful")).toBeTruthy();
    expect(screen.queryByText("Start cell NR")).toBeNull();
    // Ό,τι δείχνει ήδη ο header δεν επαναλαμβάνεται
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("filters events by group and side without refetching", async () => {
    renderPanels();
    fireEvent.click(screen.getByRole("button", { name: /Event timeline/ }));
    expect(await screen.findByText("Start Dial")).toBeTruthy();
    expect(screen.getByText("Call Failed")).toBeTruthy();
    expect(screen.getByText("IF Handover Attempt LTE PCell")).toBeTruthy();
    expect(screen.getByText("D RRCConnectionReconfiguration")).toBeTruthy();
    // Data Service εκτός default φίλτρου
    expect(screen.queryByText("Test Start")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Data Service/ }));
    expect(screen.getByText("Test Start")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "B" })[0]);
    expect(screen.queryByText("Start Dial")).toBeNull();
    expect(screen.getByText("Test Start")).toBeTruthy();

    expect(api.fetchCallEvents).toHaveBeenCalledTimes(1);
  });

  it("reports only Voice Service events for the signal chart", async () => {
    const onVoiceEvents = renderPanels();
    await waitFor(() => expect(onVoiceEvents).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ FactId: 1 }), expect.objectContaining({ FactId: 3 })]),
    ));
    const last = onVoiceEvents.mock.calls.at(-1)?.[0] as CallEventRow[];
    expect(last.every((e) => e.EventTopGroup === "Voice Service")).toBe(true);
  });

  it("loads sync only when its panel opens, and has no TraceLog panel of its own", async () => {
    renderPanels();
    await waitFor(() => expect(api.fetchCallEvents).toHaveBeenCalled());
    expect(api.fetchSyncDevices).not.toHaveBeenCalled();
    expect(api.fetchCallSystemTrace).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /TraceLog/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Συσκευές την ίδια στιγμή/ }));
    await waitFor(() => expect(api.fetchSyncDevices).toHaveBeenCalledTimes(1));
  });

  it("shows the classifier output, unclassified reason and the radio window outside the call", async () => {
    const onCallAnalysis = vi.fn();
    renderPanels(vi.fn(), onCallAnalysis);
    // Φορτώνει χωρίς να ανοίξει (το disconnect πάει στο signal chart)
    await waitFor(() => expect(onCallAnalysis).toHaveBeenLastCalledWith(callAnalysis));
    expect(await screen.findByText(/παράθυρο radio εκτός κλήσης/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Call Analysis/ }));
    expect(screen.getByText("Dropped, RTP timeout")).toBeTruthy();
    expect(screen.getByText(/B-side είναι Landunit/)).toBeTruthy();
    expect(screen.getByText(/43\.2 s μετά το τέλος του session/)).toBeTruthy();
    const fixedRow = screen.getByText("Διορθωμένο").closest("tr") as HTMLElement;
    expect([...fixedRow.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Διορθωμένο", "-131.0", "-20.0", "-14.0", "8"]);
    // Μετρητής 0 και στις δύο πλευρές κρύβεται, η ομάδα μαζί
    expect(screen.queryByText("numSIPBYERequest")).toBeNull();
    expect(screen.queryByText("Μετρητές SIP")).toBeNull();
  });

  it("loads the Scene sessions lazily and flags roaming and Scene validity", async () => {
    renderPanels();
    await waitFor(() => expect(api.fetchCallEvents).toHaveBeenCalled());
    expect(api.fetchCallSessionsNative).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Session & tests \(Scene\)/ }));
    expect(await screen.findByText("20-14 A->B")).toBeTruthy();
    expect(screen.getByText(/Serving ≠ home operator/)).toBeTruthy();
    const serving = screen.getByText("Serving operator").closest("tr") as HTMLElement;
    expect([...serving.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Serving operator", "Cosmote", "Unknown"]);
    expect(screen.getByText("A valid")).toBeTruthy();
    expect(screen.getByText("B invalid")).toBeTruthy();
    expect(screen.getByText("Speech WB POLQA")).toBeTruthy();
    expect(screen.getByText("5.50")).toBeTruthy();
  });

  it("loads MOS per test and speech samples only when the panel opens", async () => {
    renderPanels();
    await waitFor(() => expect(api.fetchCallEvents).toHaveBeenCalled());
    expect(api.fetchSpeechSamples).not.toHaveBeenCalled();
    expect(api.fetchMosTestDetail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /MOS ανά test & Speech samples/ }));
    await waitFor(() => expect(api.fetchSpeechSamples).toHaveBeenCalledTimes(1));
    expect(api.fetchMosTestDetail).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Δεν υπάρχουν speech δείγματα/)).toBeTruthy();
  });

  it("shows one row block per test with codec rows and the joined speech sample", async () => {
    const mos = (o: Partial<api.MosTestRow>): api.MosTestRow => ({
      TestId: 42949672961, Direction: "B->A", FullDate: "2026-09-21T07:47:41.236000", MOS: 4.72, Status: "Completed",
      CodecName: "EVS", CodecRate: 13.2, CodecDirection: "DL", Duration: 5000, DirectionStatus: "Active",
      CodecPerTestRatio: 1, CodecRatePerTestRatio: 0.75, CodecRateUsageRank: 1,
      EARFCN: 1850, PCI: 101, RSRP: -95.5, RSRQ: -11, SINR: 12, ...o,
    });
    vi.mocked(api.fetchMosTestDetail).mockResolvedValue({ mosTests: [mos({}), mos({ CodecDirection: "UL", CodecName: "AMR-WB" })] });
    vi.mocked(api.fetchSpeechSamples).mockResolvedValue({
      pairSource: "FactCallSession",
      samples: [{ FactId: 1, FullDate: "2026-09-21T07:47:41.236000", SessionId: 42949673010, TestId: 42949672961, Side: "A",
        Direction: "B->A", LQ: 4.72, LQIsBad: 0, IPAudioRTT: 312, QualityCategory: "Excellent" } as api.SpeechSampleRow],
      summary: { A: { SampleCount: 1 } as api.SpeechSummary, B: { SampleCount: 0 } as api.SpeechSummary },
    });
    renderPanels();
    fireEvent.click(screen.getByRole("button", { name: /MOS ανά test & Speech samples/ }));
    expect(await screen.findByText("42949672961")).toBeTruthy();
    const testCell = screen.getByText("42949672961");
    expect(testCell.getAttribute("rowspan")).toBe("2");
    expect(screen.getByText("Excellent")).toBeTruthy();
    expect(screen.getByText("312")).toBeTruthy();
    // ο codec της κατεύθυνσης του MOS (B->A = DL) με έντονα
    expect(screen.getByText("DL EVS").className).toContain("font-bold");
    expect(screen.getByText("UL AMR-WB").className).not.toContain("font-bold");
    expect(screen.getAllByText("75.0 %")).toHaveLength(2);
    expect(screen.getByText(/1 tests/)).toBeTruthy();
  });
});

describe("PcapButtons", () => {
  it("renders a download link only for sides that have a PCAP", async () => {
    vi.spyOn(api, "fetchCallPcapInfo").mockResolvedValue({
      pairSource: "FactCallSession",
      a: { available: false, sessionId: 1, fileName: null, bytes: null },
      b: { available: true, sessionId: 2, fileName: "x.pcap", bytes: 22000 },
    });
    render(<PcapButtons database="DOD_26H2" sessionId="1" />);
    const link = await screen.findByRole("link", { name: /PCAP B/ });
    expect(link.getAttribute("href")).toContain("/api/call_pcap?database=DOD_26H2&session_id=2");
    expect(screen.queryByRole("link", { name: /PCAP A/ })).toBeNull();
  });

  it("renders nothing when neither side has a PCAP", async () => {
    vi.spyOn(api, "fetchCallPcapInfo").mockResolvedValue({
      pairSource: "FactCallSession",
      a: { available: false, sessionId: 1, fileName: null, bytes: null },
      b: { available: false, sessionId: 2, fileName: null, bytes: null },
    });
    const { container } = render(<PcapButtons database="DOD_26H2" sessionId="1" />);
    await waitFor(() => expect(api.fetchCallPcapInfo).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
