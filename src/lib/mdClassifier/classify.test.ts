import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CallEvidenceBundle, L3SummaryRow } from "@/lib/commentAudit/evidence";
import { classifyMd, sipErrorCodes } from "./classify";
import { mdFamily } from "./families";

/** Pairwise περιπτώσεις από τα μοντέλα PICT (src/lib/mdClassifier/pict, βλ. generate.py). */
const cases = <T,>(model: string): T[] =>
  JSON.parse(readFileSync(path.resolve(process.cwd(), `src/lib/mdClassifier/pict/${model}.cases.json`), "utf8"));

type DropCase = { Technology: string; Vendor: string; Cause: string; Band: string; Mobility: string };
type FailCase = { Direction: string; Technology: string; Vendor: string; Stage: string; SipCode: string; Band: string };

const END = "2026-10-16T10:10:12.000";
const row = (Direction: string, SimpleMsgName: string, lastSeen = "2026-10-16T10:09:40.000"): L3SummaryRow => ({
  Technology: "LTE",
  Direction,
  SimpleMsgName,
  cnt: 1,
  firstSeen: "2026-10-16T10:09:30.000",
  lastSeen,
});
const ORIGINATING = [row("U", "RRCConnectionRequest"), row("D", "RRCConnectionSetup"), row("U", "Service request"), row("U", "IMS SIP INVITE"), row("D", "Activate dedicated EPS bearer context request")];
const TERMINATING = [row("U", "RRCConnectionRequest"), row("D", "RRCConnectionSetup"), row("U", "Service request"), row("D", "IMS SIP INVITE"), row("D", "Activate dedicated EPS bearer context request")];

function bundle(over: Partial<CallEvidenceBundle> & { a?: Record<string, unknown>; b?: Record<string, unknown> } = {}): CallEvidenceBundle {
  const { a = {}, b = {}, ...rest } = over;
  return {
    analysisA: { technology: "LTE", callDir: "A->B", callEndTimeStamp: END, ...a },
    analysisB: { technology: "LTE", callEndTimeStamp: END, ...b },
    lteA: [],
    lteB: [],
    gsmA: [],
    gsmB: [],
    tracelog: [],
    l3A: ORIGINATING,
    l3B: TERMINATING,
    ...rest,
  };
}

/** Συνθετική κλήση με την υπογραφή της αιτίας drop (md §1.3). */
function dropCall(c: DropCase): CallEvidenceBundle {
  const technology = c.Technology;
  switch (c.Cause) {
    case "SRVCC_FAIL":
      return bundle({ a: { technology }, l3A: [...ORIGINATING, row("D", "MobilityFromEUTRACommand", "2026-10-16T10:10:10.000")] });
    case "HO_FAIL":
      return bundle({ a: { technology, LastHoType: "HO_FAIL" } });
    case "RLF":
      return bundle({ a: { technology, num4GReestablishment: 1 } });
    case "RTP_TIMEOUT":
      return bundle({ a: { technology, SIPBYEReason: "RTP timeout", SIPBYEInitDirection: "U" } });
    default:
      return bundle({ a: { technology, SIPBYEReason: "Server Internal Error", SIPBYEInitDirection: "D" } });
  }
}

/** Συνθετική κλήση που σταματά στο στάδιο του fail (md §1.4). */
function failCall(c: FailCase): CallEvidenceBundle {
  const mt = c.Direction === "MT";
  const a = { technology: c.Technology, callDir: mt ? "B->A" : "A->B" };
  const orig = mt ? "l3B" : "l3A";
  const term = mt ? "l3A" : "l3B";
  const trace = c.SipCode === "NONE" ? [] : [{ Side: "A", Info: `IMS SIP INVITE Error ${c.SipCode}` }];
  const base = { [orig]: ORIGINATING, [term]: TERMINATING, tracelog: trace } as Partial<CallEvidenceBundle>;
  switch (c.Stage) {
    case "RRC":
      return bundle({ a, ...base, [orig]: [row("U", "RRCConnectionRequest"), row("D", "RRCConnectionReject")] });
    case "PAGING":
      return bundle({ a, ...base, [term]: [row("D", "SystemInformationBlockType1")] });
    case "IMS_REG":
      return bundle({ a: { ...a, FailedRegistration: 1 }, ...base });
    case "BEARER": {
      const noBearer = (rows: L3SummaryRow[]) => rows.filter((r) => !/Activate dedicated/.test(String(r.SimpleMsgName)));
      return bundle({ a, ...base, [orig]: noBearer(ORIGINATING), [term]: noBearer(TERMINATING) });
    }
    case "PRECONDITION":
      return bundle({ a: { ...a, SIPINVITECode: "Session Progress", SIPCANCELInitDirection: "D" }, ...base });
    case "RINGING":
      return bundle({ a: { ...a, SIPCANCELInitDirection: "U" }, ...base });
    default:
      return bundle({ a, ...base });
  }
}

describe("md classifier — pairwise drop model (§4.1)", () => {
  it.each(cases<DropCase>("drop").map((c, i) => [i + 1, c] as const))("case %i: %o", (_, c) => {
    const r = classifyMd(dropCall(c), "Dropped");
    expect(r.kind).toBe("drop");
    expect(r.category).toBe(c.Cause);
    expect(r.confidence).toBe("high");
  });
});

describe("md classifier — pairwise fail model (§4.2)", () => {
  it.each(cases<FailCase>("fail").map((c, i) => [i + 1, c] as const))("case %i: %o", (_, c) => {
    const r = classifyMd(failCall(c), "Failed");
    expect(r.kind).toBe("fail");
    const userCode = c.SipCode === "486" || c.SipCode === "603";
    if (userCode) {
      // §4.3: 486/603 → user, όχι network fail (το στάδιο δεν μετράει στο CSSR).
      expect(r.networkOrUser).toBe("user");
      expect(mdFamily(r)).toBe("USER");
      return;
    }
    expect(r.category).toBe(c.Stage);
  });
});

describe("md classifier — special cases (§4.3)", () => {
  it("a drop with an empty log is UNKNOWN_LOG_GAP with low confidence", () => {
    expect(classifyMd(bundle(), "Dropped")).toMatchObject({ category: "UNKNOWN_LOG_GAP", confidence: "low" });
  });

  it("a drop with only a radio pattern in the last 5 s is RLF with medium confidence", () => {
    const lteA = [{ RSRP: -120, SINR0: -6, MsgTime: "2026-10-16T10:10:09.000", phase: "during" }];
    expect(classifyMd(bundle({ lteA }), "Dropped")).toMatchObject({ category: "RLF", confidence: "medium" });
  });

  it("ignores radio samples older than the last 5 s", () => {
    const lteA = [{ RSRP: -125, MsgTime: "2026-10-16T10:09:50.000", phase: "during" }];
    expect(classifyMd(bundle({ lteA }), "Dropped").category).toBe("UNKNOWN_LOG_GAP");
  });

  it("a network-initiated CANCEL (487) is a network fail", () => {
    const call = bundle({ b: { SIPCANCELInitDirection: "D" }, tracelog: [{ Side: "A", Info: "IMS SIP INVITE Error 487" }] });
    expect(classifyMd(call, "Failed").networkOrUser).toBe("network");
  });

  it("a GSM/LTE (CSFB) fail is FALLBACK and a pure CS-GSM call is out of scope", () => {
    expect(classifyMd(bundle({ a: { technology: "GSM/LTE" } }), "Failed").category).toBe("FALLBACK");
    expect(classifyMd(bundle({ a: { technology: "GSM" } }), "Dropped")).toMatchObject({ kind: "out_of_scope", category: "OUT_OF_SCOPE" });
  });

  it("reads the final SIP codes from the tracelog", () => {
    expect(sipErrorCodes([{ Info: "IMS SIP INVITE Error 504" }, { Info: "IMS SIP PRACK: OK" }, { Info: "IMS SIP INVITE Error 487" }])).toEqual([504, 487]);
  });
});
