import { describe, expect, it } from "vitest";
import { overrideFor, withOverride, type LabelOverrides } from "./overrides";

describe("label overrides", () => {
  it("stores, reads and clears a choice per database and session without mutating", () => {
    const empty: LabelOverrides = {};
    const one = withOverride(empty, "THESS", "123", "LC_LTE");
    expect(empty).toEqual({});
    expect(overrideFor(one, "THESS", "123")).toBe("LC_LTE");
    expect(overrideFor(one, "OTHER", "123")).toBeNull();
    const cleared = withOverride(one, "THESS", "123", null);
    expect(overrideFor(cleared, "THESS", "123")).toBeNull();
    expect(overrideFor(one, "THESS", "123")).toBe("LC_LTE");
  });

  it("ignores invalid stored values", () => {
    const bad = { THESS: { "1": "NOT_A_LABEL" } } as unknown as LabelOverrides;
    expect(overrideFor(bad, "THESS", "1")).toBeNull();
    expect(overrideFor(null as unknown as LabelOverrides, "THESS", "1")).toBeNull();
  });
});
