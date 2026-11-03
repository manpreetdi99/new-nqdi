import { describe, expect, it } from "vitest";
import { historicKey, historicNarrative, historicPredict, historicScore, isTrained, type HistoricModel } from "./historic";
import { parseComment } from "./labels";

/** Δύο κατηγορίες: χαμηλό RxLev (σε GSM) → LC GSM, αλλιώς LC LTE. */
const model: HistoricModel = {
  version: 1,
  trainedAt: "2026-10-30T00:00:00+00:00",
  databases: ["THESSALONIKI_26H2", "MTWS_26H2"],
  rows: 100,
  classes: ["LC_GSM", "LC_LTE"],
  features: [
    { name: "a_rxlev_avg", mean: -90, std: 10 },
    { name: "technology=GSM", mean: 0.5, std: 0.5 },
    { name: "sip_5xx_code_present", mean: 0.1, std: 0.3 },
  ],
  coef: [
    [-2, 1, 0],
    [2, -1, 0],
  ],
  intercept: [0, 0],
  oof: { "THESSALONIKI_26H2:7": [0.2, 0.8] },
  cv: { accuracy: 0.8, folds: 5 },
};

describe("Historic model", () => {
  it("is not trained without classes/features", () => {
    expect(isTrained({ ...model, classes: [], features: [] })).toBe(false);
    expect(historicPredict({ ...model, classes: [] }, {}, "x")).toBeNull();
  });

  it("predicts from measurements and names the strongest KPIs", () => {
    const pred = historicPredict(model, { a_rxlev_avg: -105, technology: "GSM", sip_5xx_code: 503 }, "MTWS_26H2:1");
    expect(pred?.outOfFold).toBe(false);
    expect(pred?.probs[0]).toBeGreaterThan(0.9);
    expect(pred?.factors.map(([n]) => n)).toEqual(["a_rxlev_avg", "technology=GSM"]);
  });

  it("treats a missing measurement as the training average", () => {
    const missing = historicPredict(model, { technology: "GSM" }, "k");
    const average = historicPredict(model, { a_rxlev_avg: -90, technology: "GSM" }, "k");
    expect(missing?.probs[0]).toBeCloseTo(average?.probs[0] ?? NaN, 10);
  });

  it("uses out-of-fold probabilities for calls it was trained on", () => {
    const pred = historicPredict(model, { a_rxlev_avg: -120, technology: "GSM" }, historicKey("THESSALONIKI_26H2", "7"));
    expect(pred).toMatchObject({ outOfFold: true, probs: [0.2, 0.8] });
  });

  it("grades the user comment against the predicted causes", () => {
    const pred = historicPredict(model, { a_rxlev_avg: -105, technology: "GSM" }, "k");
    if (!pred) throw new Error("no prediction");
    expect(historicScore(model, "1", parseComment("LC GSM"), pred)).toMatchObject({ topLabel: "LC_GSM", verdict: "correct", grade: 100 });
    expect(historicScore(model, "1", parseComment("LC LTE"), pred).verdict).toBe("wrong");
    expect(historicScore(model, "1", parseComment("FAKE EOF"), pred).verdict).toBe("not_auditable");
    expect(historicScore(model, "1", null, pred).verdict).toBe("no_comment");
  });

  it("writes a summary with its source, the percentages and the main KPIs", () => {
    const pred = historicPredict(model, { a_rxlev_avg: -105, technology: "GSM" }, "k");
    if (!pred) throw new Error("no prediction");
    const comment = parseComment("LC GSM");
    const n = historicNarrative(model, comment, historicScore(model, "1", comment, pred), pred);
    expect(n.why).toMatch(/^Historic \[μοντέλο από 100 κλήσεις \(THESSALONIKI_26H2, MTWS_26H2\)\]: 100% LC GSM\.$/);
    expect(n.alternative).toContain("a_rxlev_avg = -105");
  });
});
