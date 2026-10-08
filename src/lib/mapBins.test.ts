import { describe, it, expect } from "vitest";
import { buildBins, countBinsByBucket } from "@/lib/mapBins";
import { COLOR_SCHEMES } from "@/lib/mapColorSchemes";

const bin = (minLat: number, minLon: number, extra: Record<string, unknown>) => ({
  Z9_MinLat: minLat, Z9_MaxLat: minLat + 0.01, Z9_MinLon: minLon, Z9_MaxLon: minLon + 0.01, ...extra,
});

describe("buildBins", () => {
  it("colors a category bin by its most frequent value", () => {
    const rows = [
      bin(35, 25, { NR_Band: "n78" }),
      bin(35, 25, { NR_Band: "n1" }),
      bin(35, 25, { NR_Band: "n78" }),
      bin(36, 25, { NR_Band: "n28" }),
    ];
    const bins = buildBins(rows as never, "Z9", "NR_Band", COLOR_SCHEMES.nr5g_band);
    expect(bins).toHaveLength(2);
    const first = bins.find((b) => b.lat < 35.5)!;
    expect(first.val).toBe("n78");
    expect(first.samples).toBe(3);
    expect(first.breakdown).toEqual([["n78", 2], ["n1", 1]]);
    expect(first.color).toBe("#ff0000");
    expect(countBinsByBucket(bins, COLOR_SCHEMES.nr5g_band).get("n78")).toBe(1);
    expect(countBinsByBucket(bins, COLOR_SCHEMES.nr5g_band).get("n28")).toBe(1);
  });

  it("averages a range value per bin", () => {
    const rows = [bin(35, 25, { "SS-RSRP": -80 }), bin(35, 25, { "SS-RSRP": -90 })];
    const [b] = buildBins(rows as never, "Z9", "SS-RSRP", COLOR_SCHEMES.nr5g_ssrsrp);
    expect(b.val).toBe(-85);
    expect(b.bucketKey).toBe("-90 to -80");
  });

  it("skips rows without a bin or a value", () => {
    const rows = [
      { Z9_MinLat: null, Z9_MaxLat: null, Z9_MinLon: null, Z9_MaxLon: null, NR_Band: "n1" },
      bin(35, 25, { NR_Band: null }),
    ];
    expect(buildBins(rows as never, "Z9", "NR_Band", COLOR_SCHEMES.nr5g_band)).toEqual([]);
  });
});
