import { describe, expect, it } from "vitest";
import { blendMix, formatBlend, formatWeights } from "./blend";

describe("blend Historic / Standard", () => {
  it("multiplies each model's percentages by the bar weight (default 65% Historic)", () => {
    const blend = blendMix([{ label: "LC_GSM", pct: 100 }], [{ label: "LC_GSM", pct: 60 }, { label: "LQ_GSM", pct: 40 }]);
    // LC GSM: 0.65·60 + 0.35·100 = 74 · LQ GSM: 0.65·40 = 26
    expect(blend).toEqual([
      { label: "LC_GSM", pct: 74, standardPct: 100, historicPct: 60 },
      { label: "LQ_GSM", pct: 26, standardPct: 0, historicPct: 40 },
    ]);
    expect(formatBlend(blend)).toBe("74% LC GSM · 26% LQ GSM");
  });

  it("follows the bar: 0% = only Standard, 100% = only Historic", () => {
    const std = [{ label: "TAU" as const, pct: 100 }];
    const his = [{ label: "CORE_OTHER" as const, pct: 100 }];
    expect(blendMix(std, his, 0)[0]).toMatchObject({ label: "TAU", pct: 100 });
    expect(blendMix(std, his, 1)[0]).toMatchObject({ label: "CORE_OTHER", pct: 100 });
    expect(blendMix(std, his, 0.5).map((c) => c.pct)).toEqual([50, 50]);
  });

  it("uses only Standard when there is no Historic, and always sums to 100", () => {
    expect(blendMix([{ label: "LC_LTE", pct: 63 }, { label: "LQ_LTE", pct: 37 }], null)).toMatchObject([{ label: "LC_LTE", pct: 63 }, { label: "LQ_LTE", pct: 37 }]);
    const blend = blendMix([{ label: "LC_LTE", pct: 34 }, { label: "LQ_LTE", pct: 33 }, { label: "FAKE_EOF", pct: 33 }], [{ label: "LC_GSM", pct: 100 }], 0.33);
    expect(blend.reduce((t, c) => t + c.pct, 0)).toBe(100);
  });

  it("formats the weights", () => {
    expect(formatWeights(0.65)).toBe("Historic 65% · Standard 35%");
    expect(formatWeights(2)).toBe("Historic 100% · Standard 0%");
  });
});
