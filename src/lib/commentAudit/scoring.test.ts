import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, type FeatureKey, type FeatureVector } from "./evidence";
import { parseComment } from "./labels";
import { auditComments, collaborativeScores, cosine, priorScore, verdictFor, type AuditItem } from "./scoring";

const features = (set: Partial<Record<FeatureKey, number>>): FeatureVector =>
  Object.fromEntries(FEATURE_KEYS.map((k) => [k, set[k] ?? 0])) as Record<FeatureKey, number>;

const item = (id: string, comment: string | null, set: Partial<Record<FeatureKey, number>>): AuditItem => ({
  id,
  comment: parseComment(comment),
  features: features(set),
});

const lcLte = { lteLowRsrp: 1, nativeLowLte: 1 };
const lcGsm = { gsmLowRxLev: 1, nativeLowGsm: 1 };
const core = { networkRelease: 1, radioGood: 1 };

/** 12 κλήσεις ανά τύπο, για να έχει το MF αρκετές ετικέτες. */
function dataset(): AuditItem[] {
  return Array.from({ length: 12 }, (_, i) => [
    item(`lte${i}`, "LC LTE", lcLte),
    item(`gsm${i}`, "LC GSM", lcGsm),
    item(`core${i}`, "CORE NETWORK (DL CHANNEL RELEASE)", core),
  ]).flat();
}

describe("priorScore", () => {
  it("is 1 when all expected evidence is present", () => {
    expect(priorScore("FAKE_EOF", features({ fakeEof: 1 }))).toBe(1);
  });

  it("is reduced by contradicting evidence", () => {
    expect(priorScore("LC_LTE", features({ lteLowRsrp: 1, radioGood: 1 }))).toBeLessThan(priorScore("LC_LTE", features({ lteLowRsrp: 1 })));
  });

  it("never goes below zero", () => {
    expect(priorScore("LC_GSM", features({ radioGood: 1 }))).toBe(0);
  });
});

describe("cosine", () => {
  it("handles zero vectors", () => {
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
  });
});

describe("verdictFor", () => {
  it.each([
    [0.8, 0.8, true, 0, "correct"],
    [0.76, 0.8, false, 0, "correct"],
    [0.5, 0.8, false, 0, "partial"],
    [0.1, 0.8, false, 0, "wrong"],
    [0.3, 0.8, false, 0.9, "partial"],
    [0.1, 0.15, true, 0, "insufficient"],
  ] as const)("user %s vs top %s (own evidence %s) → %s", (user, top, isTop, own, expected) => {
    expect(verdictFor(user, top, isTop, own)).toBe(expected);
  });
});

describe("collaborativeScores", () => {
  it("predicts the hidden label from similar calls", () => {
    const scores = collaborativeScores(dataset());
    const gsmRow = scores[1];
    expect(gsmRow.LC_GSM).toBeGreaterThan(gsmRow.LC_LTE);
    expect(gsmRow.LC_GSM).toBeGreaterThan(gsmRow.CORE_CHANNEL_RELEASE);
  });

  it("is deterministic for the same input", () => {
    expect(collaborativeScores(dataset())).toEqual(collaborativeScores(dataset()));
  });
});

describe("auditComments", () => {
  it("confirms comments that match the evidence", () => {
    const res = auditComments(dataset());
    expect(res.every((r) => r.verdict === "correct")).toBe(true);
    expect(res[0].collaborative).not.toBeNull();
  });

  it("flags a coverage comment on a call with good radio and suggests the real cause", () => {
    const res = auditComments([...dataset(), item("bad", "LC GSM", core)]);
    const bad = res.find((r) => r.id === "bad")!;
    expect(bad.verdict).toBe("wrong");
    expect(bad.topLabel).toBe("CORE_CHANNEL_RELEASE");
    expect(bad.grade).toBeLessThan(40);
  });

  it("keeps a comment with strong own evidence at least partial when another cause ranks first", () => {
    const res = auditComments([...dataset(), item("both", "LC GSM", { gsmLowRxLev: 1, lteLowRsrp: 1, nativeLowLte: 1, reestFailure: 1 })]);
    expect(["correct", "partial"]).toContain(res.find((r) => r.id === "both")!.verdict);
  });

  it("does not judge a coverage comment when there is no radio data", () => {
    const res = auditComments([...dataset(), item("nr", "LC GSM", { noRadio: 1, ueStuck: 0.5 })]);
    expect(res.find((r) => r.id === "nr")!.verdict).toBe("insufficient");
  });

  it("still judges a coverage comment without samples when the native classifier reports low RxLev", () => {
    const res = auditComments([...dataset(), item("nat", "LC GSM", { noRadio: 1, ueStuck: 0.5, nativeLowGsm: 1 })]);
    expect(res.find((r) => r.id === "nat")!.verdict).not.toBe("insufficient");
  });

  describe("DRB release rule (pptx #10: only with acceptable radio)", () => {
    it("marks CORE NETWORK (DRB RELEASE 3) as correct when DRB 3 is released near the end with good radio", () => {
      const res = auditComments([...dataset(), item("drb", "CORE NETWORK (DRB RELEASE 3)", { drbRelease3: 1, radioGood: 1 })]);
      const r = res.find((x) => x.id === "drb")!;
      expect(r).toMatchObject({ verdict: "correct", grade: 100, topLabel: "CORE_DRB_RELEASE" });
      expect(r.rule).toContain("αποδεκτό ράδιο");
    });

    it("overrides a coverage comment when the radio was acceptable", () => {
      const res = auditComments([...dataset(), item("lte", "LC LTE", { drbRelease3: 1, radioGood: 1 })]);
      expect(res.find((x) => x.id === "lte")).toMatchObject({ verdict: "wrong", grade: 0, topLabel: "CORE_DRB_RELEASE" });
    });

    it("does not apply when the radio is bad: the coverage comment stands", () => {
      const res = auditComments([...dataset(), item("lte", "LC LTE", { drbRelease3: 1, ...lcLte })]);
      const r = res.find((x) => x.id === "lte")!;
      expect(r.rule).toBeNull();
      expect(r.verdict).toBe("correct");
    });

    it("«DRB without rules» applies even with bad radio and no Reconfiguration Complete", () => {
      const res = auditComments([...dataset(), item("lte", "LC LTE", { drbRelease3: 0.5, ...lcLte })], undefined, { drbRule: "unconditional" });
      const r = res.find((x) => x.id === "lte")!;
      expect(r).toMatchObject({ verdict: "wrong", grade: 0, topLabel: "CORE_DRB_RELEASE" });
      expect(r.rule).toContain("χωρίς έλεγχο ράδιο");
    });

    it("«DRB without rules» leaves calls without a DRB 3 release untouched", () => {
      const strict = auditComments(dataset());
      const unconditional = auditComments(dataset(), undefined, { drbRule: "unconditional" });
      expect(unconditional.map((r) => r.verdict)).toEqual(strict.map((r) => r.verdict));
    });

    it("does not apply when the UE did not confirm the reconfiguration", () => {
      const res = auditComments([...dataset(), item("u", "CORE NETWORK (DRB RELEASE 3)", { drbRelease3: 0.5, radioGood: 1 })]);
      expect(res.find((x) => x.id === "u")!.rule).toBeNull();
    });

    it("rejects the DRB comment when no DRB 3 release was found", () => {
      const res = auditComments([...dataset(), item("no", "CORE NETWORK (DRB RELEASE 3)", lcLte)]);
      const r = res.find((x) => x.id === "no")!;
      expect(r.verdict).toBe("wrong");
      expect(r.topLabel).toBe("LC_LTE");
      expect(r.rule).toBeNull();
    });
  });

  describe("radio first (pptx)", () => {
    it("does not confirm a core comment when the radio was bad", () => {
      const res = auditComments([...dataset(), item("c", "CORE NETWORK (DL CHANNEL RELEASE)", { networkRelease: 1, ...lcGsm })]);
      const r = res.find((x) => x.id === "c")!;
      expect(r.verdict).not.toBe("correct");
      expect(r.topLabel).toBe("LC_GSM");
    });

    it("prefers Fake UE stuck (UL Disconnect) over core when the UE disconnected with good radio", () => {
      const res = auditComments([...dataset(), item("ul", "FAKE UE STUCK (UL DISCONNECT)", { ueDisconnect: 1, radioGood: 1 })]);
      expect(res.find((x) => x.id === "ul")).toMatchObject({ verdict: "correct", topLabel: "FAKE_UE_STUCK_UL_DISCONNECT" });
    });
  });

  it("accepts a generic FAKE UE STUCK comment when a sub-type is found", () => {
    const res = auditComments([...dataset(), item("g", "FAKE UE STUCK", { noCmServiceRequest: 1, radioGood: 1 })]);
    expect(res.find((x) => x.id === "g")).toMatchObject({ verdict: "correct", topLabel: "FAKE_UE_STUCK_NO_CM" });
  });

  it("classifies calls without a comment but gives no grade", () => {
    const res = auditComments([...dataset(), item("nc", null, lcGsm)]);
    expect(res.find((x) => x.id === "nc")).toMatchObject({ verdict: "no_comment", grade: null, topLabel: "LC_GSM" });
  });

  it("marks unknown comments as not auditable", () => {
    const res = auditComments([item("x", "check later", lcLte)]);
    expect(res[0].verdict).toBe("not_auditable");
    expect(res[0].grade).toBeNull();
  });

  it("uses content only when there are too few labelled calls", () => {
    const res = auditComments([item("a", "LC LTE", lcLte)]);
    expect(res[0].collaborative).toBeNull();
    expect(res[0].verdict).toBe("correct");
  });
});
