import { describe, expect, it } from "vitest";
import { extractEvidence, type CallEvidenceBundle } from "./evidence";
import { parseComment } from "./labels";
import { auditComments } from "./scoring";

const tauRow = { Direction: "U", SimpleMsgName: "Tracking area update request", Technology: "LTE" };
const goodLte = Array.from({ length: 6 }, () => ({ RSRP: -90, RSRQ: -10, SINR0: 9, phase: "during" }));
const badLte = Array.from({ length: 6 }, () => ({ RSRP: -125, RSRQ: -18, SINR0: -5, phase: "during" }));
const call = (lteA: CallEvidenceBundle["lteA"], l3B: CallEvidenceBundle["l3B"] = [tauRow]): CallEvidenceBundle => ({
  analysisA: { technology: "LTE" },
  analysisB: null,
  lteA,
  lteB: [],
  gsmA: [],
  gsmB: [],
  tracelog: [],
  l3A: [{ Direction: "D", SimpleMsgName: "Paging" }],
  l3B,
});
const audit = (b: CallEvidenceBundle, comment: string) => {
  const ev = extractEvidence(b);
  return { ev, score: auditComments([{ id: "1", comment: parseComment(comment), features: ev.features }])[0] };
};

describe("TAU (κανόνας χρήστη)", () => {
  it("parses «TAU» and «CORE NETWORK (TAU)» as TAU", () => {
    expect(parseComment("TAU")?.label).toBe("TAU");
    expect(parseComment("CORE NETWORK (TAU)")?.label).toBe("TAU");
    expect(parseComment("Tracking Area Update")?.label).toBe("TAU");
  });

  it("691489734672: UL TAU request on B with good radio → TAU, the comment is correct", () => {
    const { ev, score } = audit(call(goodLte), "TAU");
    expect(ev.features.tauRequest).toBe(1);
    expect(ev.facts.find((f) => f.feature === "tauRequest")).toMatchObject({ source: "L3 B", text: "UL Tracking Area Update Request στην B πλευρά" });
    expect(score).toMatchObject({ topLabel: "TAU", verdict: "correct", grade: 100 });
    expect(score.rule).toContain("Tracking Area Update");
  });

  it("a failed RRC re-establishment does not block TAU when the radio measurements are good", () => {
    const b = { ...call(goodLte), analysisB: { num4GReestablishment: 1, num4GReestablishmentSuccess: 0 } };
    const { ev, score } = audit(b, "TAU");
    expect(ev.features.reestFailure).toBe(1);
    expect(score).toMatchObject({ topLabel: "TAU", verdict: "correct" });
  });

  it("with bad radio the TAU request does not count (coverage comes first)", () => {
    const { score } = audit(call(badLte), "TAU");
    expect(score.rule).toBeNull();
    expect(score.topLabel).not.toBe("TAU");
  });

  it("without a UL TAU request TAU is never the cause", () => {
    const { score } = audit(call(goodLte, [{ Direction: "D", SimpleMsgName: "Tracking area update accept" }]), "LC LTE");
    expect(score.topLabel).not.toBe("TAU");
  });
});
