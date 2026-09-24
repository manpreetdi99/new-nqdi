import { describe, expect, it } from "vitest";
import { isUnknownCallMode, resolveCallDetailMode } from "@/lib/callDetailMode";

describe("resolveCallDetailMode", () => {
  it("keeps known modes as-is", () => {
    for (const mode of ["CS", "SRVCC", "CSFB", "VoLTE", "VoNR/VoLTE N26 HO"]) {
      expect(resolveCallDetailMode(mode, "GSM 900")).toBe(mode);
    }
  });

  it("resolves '-' / N/A / Unknown / empty from technology, GSM first", () => {
    expect(resolveCallDetailMode("-", "GSM 900")).toBe("CS");
    expect(resolveCallDetailMode("-", "UMTS 2100")).toBe("CS");
    // GSM first (unlike the KPI split): "CS" + LTE in technology makes Call Detail load both legs
    expect(resolveCallDetailMode("-", "GSM/LTE")).toBe("CS");
    expect(resolveCallDetailMode("-", "LTE")).toBe("VoLTE");
    expect(resolveCallDetailMode("N/A", "GSM 1800")).toBe("CS");
    expect(resolveCallDetailMode(null, "LTE")).toBe("VoLTE");
    expect(resolveCallDetailMode("Unknown", "LTE")).toBe("VoLTE");
  });

  it("resolves anything mentioning 5G / NR to VoNR, unless GSM/UMTS is also there", () => {
    expect(resolveCallDetailMode("-", "5G NR")).toBe("VoNR");
    expect(resolveCallDetailMode("-", "NR")).toBe("VoNR");
    expect(resolveCallDetailMode("N/A", "LTE/5G")).toBe("VoNR");
    expect(resolveCallDetailMode("-", "GSM/5G")).toBe("CS");
    // "nr" only as a token — not inside other words
    expect(resolveCallDetailMode("-", "Unrelated")).toBe("UNKNOWN");
  });

  it("falls back to UNKNOWN (load everything) when technology gives nothing to go on", () => {
    expect(resolveCallDetailMode("-", null)).toBe("UNKNOWN");
    expect(resolveCallDetailMode("", "N/A")).toBe("UNKNOWN");
    expect(resolveCallDetailMode("-", "")).toBe("UNKNOWN");
  });

  it("recognises the unknown markers", () => {
    for (const mode of ["-", " - ", "N/A", "", null, undefined, "Unknown"]) expect(isUnknownCallMode(mode)).toBe(true);
    for (const mode of ["CS", "VoLTE", "SRVCC"]) expect(isUnknownCallMode(mode)).toBe(false);
  });
});
