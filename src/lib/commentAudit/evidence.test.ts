import { describe, expect, it } from "vitest";
import { drbReleasesForCall, firstSipAck } from "./drbRelease";
import { extractEvidence, findDrbReleases, longestRun, type CallEvidenceBundle } from "./evidence";

const empty: CallEvidenceBundle = {
  analysisA: null,
  analysisB: null,
  lteA: [],
  lteB: [],
  gsmA: [],
  gsmB: [],
  tracelog: [],
  l3A: [],
  l3B: [],
};

const lte = (rsrp: number, phase = "during", rsrq = -10, sinr = 5) => ({ RSRP: rsrp, RSRQ: rsrq, SINR0: sinr, SINR1: sinr, phase });
const gsm = (rxLev: number, rxQual = 0, phase = "during") => ({ RxLevSub: rxLev, RxQualSub: rxQual, phase });

describe("longestRun", () => {
  it("finds the longest consecutive bad run and its worst value", () => {
    const run = longestRun([-110, -118, -120, -100, -118, -119, -125], (v) => v, (v) => v <= -117);
    expect(run).toEqual({ length: 3, worst: -125 });
  });

  it("returns zero length when nothing is bad", () => {
    expect(longestRun([-90, -95], (v) => v, (v) => v <= -117)).toEqual({ length: 0, worst: null });
  });
});

describe("DRB release after IMS SIP ACK", () => {
  const reconfig = (time: string, drb = false) => ({
    MsgTime: `2026-10-07T16:26:${time}`,
    MsgName: "DCCH-RRCConnectionReconfiguration",
    Direction: "D",
    Message: drb ? "rrcConnectionReconfiguration-r8 {\n  drb-ToReleaseList {\n          3\n        },\n}" : "measConfig {}",
  });
  const complete = (time: string) => ({ MsgTime: `2026-10-07T16:26:${time}`, MsgName: "DCCH-RRCConnectionReconfigurationComplete", Direction: "U" });
  const ack = { MsgTime: "2026-10-07T16:26:16.703", MsgName: "IMS SIP ACK", SIPResponse: "Request", Direction: "D" };
  const prack = { MsgTime: "2026-10-07T16:26:10.000", MsgName: "IMS SIP PRACK", SIPResponse: "Request", Direction: "U" };
  const END = "2026-10-07T16:26:25.683";

  it("numbers the Reconfigurations after the SIP ACK and finds DRB 3 in the 1st (781684047906)", () => {
    const hits = findDrbReleases([reconfig("10.000"), reconfig("16.852", true), complete("16.870")], END, "B", firstSipAck([prack, ack]));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ side: "B", drbIds: [3], confirmed: true, reconfigAfterAck: 1 });
    expect(hits[0].secondsFromEnd).toBeCloseTo(-8.831);
  });

  it("ignores PRACK when looking for the SIP ACK", () => {
    expect(firstSipAck([prack])).toBeNull();
  });

  it("has no position when there is no SIP ACK", () => {
    expect(findDrbReleases([reconfig("16.852", true)], END, "B", null)[0].reconfigAfterAck).toBeNull();
  });

  it("accepts DRB 3 in the 2nd Reconfiguration after the ACK but not in the 3rd", () => {
    const second = drbReleasesForCall([{ side: "A", messages: [reconfig("17.000"), reconfig("18.000", true), complete("18.010")], sipMessages: [ack], callEnd: END }]);
    expect(second[0].reconfigAfterAck).toBe(2);
    expect(extractEvidence({ ...empty, drbReleases: second }).features.drbRelease3).toBe(1);
    const third = drbReleasesForCall([{ side: "A", messages: [reconfig("17.000"), reconfig("18.000"), reconfig("19.000", true), complete("19.010")], sipMessages: [ack], callEnd: END }]);
    expect(third[0].reconfigAfterAck).toBe(3);
    expect(extractEvidence({ ...empty, drbReleases: third }).features.drbRelease3).toBe(0);
  });

  it("measures from the first side that ended: a B-side DRB release after A dropped is outside the call (1520418422822)", () => {
    const drb = { MsgTime: "2026-10-16T10:10:15.619000", MsgName: "DCCH-RRCConnectionReconfiguration", Direction: "D", Message: "drb-ToReleaseList {\n 3\n }" };
    const bAck = { MsgTime: "2026-10-16T10:10:15.000000", MsgName: "IMS SIP ACK", SIPResponse: "Request" };
    const hits = drbReleasesForCall([
      { side: "A", messages: [], callEnd: "2026-10-16T10:10:12.472000" },
      { side: "B", messages: [drb], sipMessages: [bAck], callEnd: "2026-10-16T10:10:15.158000" },
    ]);
    expect(hits[0]).toMatchObject({ reconfigAfterAck: 1 });
    expect(hits[0].secondsFromEnd).toBeCloseTo(3.147);
    expect(extractEvidence({ ...empty, drbReleases: hits }).features.drbRelease3).toBe(0);
  });

  it("returns nothing without a call end", () => {
    expect(findDrbReleases([{ MsgTime: "2026-10-05T13:17:13", Message: "drb-ToReleaseList { 3 }" }], null, "B")).toEqual([]);
  });
});

describe("extractEvidence", () => {
  it("detects 5 consecutive RSRP samples below -117 on the B side, with bad RSRQ", () => {
    const ev = extractEvidence({ ...empty, lteA: [lte(-95), lte(-96)], lteB: [-118, -119, -121, -124, -130].map((r) => lte(r, "during", -19, -10)) });
    expect(ev.features.lteLowRsrp).toBe(1);
    expect(ev.features.radioGood).toBe(0);
    expect(ev.worstRadioSide).toBe("B");
    expect(ev.facts.find((f) => f.feature === "lteLowRsrp")?.text).toBe("5 συνεχόμενα δείγματα RSRP ≤ -117 dBm (χειρότερο -130 dBm) μαζί με κακό RSRQ/SINR στην B πλευρά");
  });

  it("gives low RSRP only partial strength when RSRQ and SINR stay acceptable", () => {
    const ev = extractEvidence({ ...empty, lteA: [-118, -119, -121, -124, -130].map((r) => lte(r)) });
    expect(ev.features.lteLowRsrp).toBeCloseTo(0.6);
  });

  it("ignores samples before the call starts", () => {
    const ev = extractEvidence({ ...empty, lteA: [lte(-130, "before"), lte(-130, "before"), lte(-100)] });
    expect(ev.features.lteLowRsrp).toBe(0);
  });

  it("uses RxLev Sub <= -93 dBm for GSM low coverage and scales partial runs", () => {
    const ev = extractEvidence({ ...empty, gsmA: [gsm(-93), gsm(-104), gsm(-92)] });
    expect(ev.features.gsmLowRxLev).toBeCloseTo(0.4);
  });

  it("treats GSM between -89 and -92 dBm as neither low nor clearly good", () => {
    const ev = extractEvidence({ ...empty, gsmA: [gsm(-90), gsm(-92)] });
    expect(ev.features.gsmLowRxLev).toBe(0);
    expect(ev.features.radioGood).toBe(0.5);
  });

  it("separates low quality from low coverage", () => {
    const ev = extractEvidence({ ...empty, lteA: [lte(-100, "during", -17, -6), lte(-101, "during", -18, -7)] });
    expect(ev.features.lteLowQuality).toBeCloseTo(0.4);
    expect(ev.features.lteLowRsrp).toBe(0);
  });

  it("flags good radio when every sample is strong", () => {
    const ev = extractEvidence({ ...empty, gsmA: [gsm(-60), gsm(-70)] });
    expect(ev.features.radioGood).toBe(1);
    expect(ev.facts.find((f) => f.feature === "radioGood")?.text).toContain("min RxLev -70 dBm");
  });

  it("reads tracelog markers for fake calls and SIP 5xx", () => {
    const ev = extractEvidence({
      ...empty,
      gsmA: [gsm(-70)],
      tracelog: [
        { Side: "B", Info: "B file ended; abort active CALL session" },
        { Side: "A", Info: "No sync signal found." },
        { Side: "A", Info: "IMS SIP INVITE Error 504" },
      ],
    });
    expect(ev.features.fakeEof).toBe(1);
    expect(ev.features.noSync).toBe(1);
    expect(ev.features.sip5xx).toBe(1);
  });

  describe("GSM call clearing (pptx #11, #15, #16)", () => {
    const at = (s: number) => `2026-10-05T13:17:${String(s).padStart(2, "0")}.000`;

    it("marks a network-initiated release when DL Disconnect comes first", () => {
      const ev = extractEvidence({
        ...empty,
        gsmA: [gsm(-70)],
        analysisA: { disconCause: "Recovery on timer expiry" },
        l3A: [
          { Direction: "D", SimpleMsgName: "Disconnect", firstSeen: at(10) },
          { Direction: "U", SimpleMsgName: "Release", firstSeen: at(11) },
          { Direction: "D", SimpleMsgName: "Channel Release", firstSeen: at(12) },
        ],
      });
      expect(ev.features.networkRelease).toBe(1);
      expect(ev.features.ueDisconnect).toBe(0);
      expect(ev.facts.find((f) => f.feature === "networkRelease")?.text).toContain("Recovery on timer expiry");
    });

    it("marks a UE-initiated release when UL Disconnect comes before the DL Release", () => {
      const ev = extractEvidence({
        ...empty,
        l3A: [
          { Direction: "U", SimpleMsgName: "Disconnect", firstSeen: at(10) },
          { Direction: "D", SimpleMsgName: "Release", firstSeen: at(11) },
        ],
      });
      expect(ev.features.ueDisconnect).toBe(1);
      expect(ev.features.networkRelease).toBe(0);
    });

    it("flags a CC Release without any Disconnect", () => {
      const ev = extractEvidence({ ...empty, l3A: [{ Direction: "D", SimpleMsgName: "Release", firstSeen: at(10) }] });
      expect(ev.features.ccDisconnectMissing).toBe(1);
    });
  });

  describe("GSM call setup (pptx #12, #18, #19)", () => {
    const gsmCall = (dir: string) => ({ callDir: dir, technology: "GSM" });
    const row = (Direction: string, SimpleMsgName: string) => ({ Technology: "GSM", Direction, SimpleMsgName });

    it("flags an originating side that never sent CM Service Request", () => {
      const ev = extractEvidence({
        ...empty,
        analysisA: gsmCall("A->B"),
        l3A: [row("D", "System Information Type 3")],
        tracelog: [{ Side: "A", Info: "Connect Failed" }],
      });
      expect(ev.features.noCmServiceRequest).toBe(1);
    });

    it("flags a terminating side without any Paging Request", () => {
      const ev = extractEvidence({ ...empty, analysisA: gsmCall("B->A"), l3A: [row("D", "System Information Type 5")], l3B: [row("U", "CM Service Request")] });
      expect(ev.features.noPaging).toBe(1);
      expect(ev.features.noCmServiceRequest).toBe(0);
    });

    it("flags a terminating side that got paged but did not answer", () => {
      const ev = extractEvidence({ ...empty, analysisA: gsmCall("A->B"), l3A: [row("U", "CM Service Request")], l3B: [row("D", "Paging Request Type 1")] });
      expect(ev.features.noPagingResponse).toBe(1);
      expect(ev.features.noPaging).toBe(0);
    });

    it("does not judge setup for non-GSM calls", () => {
      const ev = extractEvidence({ ...empty, analysisA: { callDir: "A->B", technology: "LTE" }, l3A: [row("D", "x")] });
      expect(ev.features.noCmServiceRequest).toBe(0);
    });
  });

  it("reads SRVCC, CM re-establishment and POLQA silence", () => {
    const ev = extractEvidence({
      ...empty,
      l3A: [{ Direction: "D", SimpleMsgName: "MobilityFromEUTRACommand" }, { Direction: "U", SimpleMsgName: "CM Re-Establishment Request" }],
      tracelog: [{ Side: "A", Info: "POLQA-WB error -10 (Silence or very high loss of signal)" }],
    });
    expect(ev.features.srvcc).toBe(1);
    expect(ev.features.cmReestablishment).toBe(1);
    expect(ev.features.audioFailure).toBe(1);
  });

  it("knows when the call reached its configured duration", () => {
    const ev = extractEvidence({ ...empty, analysisA: { CallDuration_s: 88 }, tracelog: [{ Side: "A", Info: "Start call duration (90s)" }] });
    expect(ev.features.callFullDuration).toBe(1);
    expect(extractEvidence({ ...empty, analysisA: { CallDuration_s: 40 }, tracelog: [{ Side: "A", Info: "Start call duration (90s)" }] }).features.callFullDuration).toBe(0);
  });

  it("reads the extra Fake EOF markers and the last call of the file", () => {
    expect(extractEvidence({ ...empty, tracelog: [{ Side: "A", Info: "Closing current database" }] }).features.fakeEof).toBe(1);
    expect(extractEvidence({ ...empty, isLastCallOfFile: true }).features.fakeEof).toBeCloseTo(0.4);
  });

  it("marks a stuck UE when there is no radio and no L3 at all", () => {
    const ev = extractEvidence(empty);
    expect(ev.features.noRadio).toBe(1);
    expect(ev.features.ueStuck).toBe(1);
  });

  it("de-duplicates native classifier phrases", () => {
    const ev = extractEvidence({ ...empty, lteA: [lte(-90)], analysisA: { Description: "Failed, Low RSRQ, Low SINR", codeDescription: "Failed, Low RSRQ, Low SINR" } });
    expect(ev.facts.find((f) => f.feature === "nativeLowLte")?.text).toContain("«Low RSRQ, Low SINR»");
  });

  it("flags DRB 3 in the 1st Reconfiguration after the SIP ACK on either side", () => {
    const ev = extractEvidence({ ...empty, drbReleases: [{ side: "B", drbIds: [1, 3], secondsFromEnd: -2.3, confirmed: true, reconfigAfterAck: 1 }] });
    expect(ev.features.drbRelease3).toBe(1);
    expect(ev.facts[0].text).toBe(
      "drb-ToReleaseList { 1, 3 } στο 1ο RRC Connection Reconfiguration μετά το IMS SIP ACK στην B πλευρά, 2.3 s πριν το τέλος της κλήσης, το UE απάντησε Reconfiguration Complete",
    );
  });

  it("gives half strength to a DRB 3 release the UE did not confirm", () => {
    expect(extractEvidence({ ...empty, drbReleases: [{ side: "A", drbIds: [3], secondsFromEnd: -1, confirmed: false, reconfigAfterAck: 2 }] }).features.drbRelease3).toBe(0.5);
  });

  it.each([
    ["another DRB", { side: "A" as const, drbIds: [4], secondsFromEnd: -1, confirmed: true, reconfigAfterAck: 1 }],
    ["in the 3rd Reconfiguration after the ACK", { side: "A" as const, drbIds: [3], secondsFromEnd: -5, confirmed: true, reconfigAfterAck: 3 }],
    ["without a SIP ACK before it", { side: "A" as const, drbIds: [3], secondsFromEnd: -1, confirmed: true, reconfigAfterAck: null }],
    ["after the call ended", { side: "B" as const, drbIds: [3], secondsFromEnd: 0.5, confirmed: true, reconfigAfterAck: 1 }],
  ])("ignores DRB releases that are %s", (_, hit) => {
    expect(extractEvidence({ ...empty, drbReleases: [hit] }).features.drbRelease3).toBe(0);
  });

  it("detects failed re-establishment from native counters", () => {
    const ev = extractEvidence({ ...empty, analysisA: { num4GReestablishment: 1, num4GReestablishmentSuccess: 0 } });
    expect(ev.features.reestFailure).toBe(1);
  });
});
