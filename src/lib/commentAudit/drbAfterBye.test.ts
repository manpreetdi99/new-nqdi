import { describe, expect, it } from "vitest";
import { drbReleasesForCall } from "./drbRelease";
import { FEATURE_KEYS, extractEvidence, type CallEvidenceBundle, type FeatureKey, type FeatureVector } from "./evidence";
import { parseComment } from "./labels";
import { auditComments, type AuditItem } from "./scoring";

const empty: CallEvidenceBundle = { analysisA: null, analysisB: null, lteA: [], lteB: [], gsmA: [], gsmB: [], tracelog: [], l3A: [], l3B: [] };
const at = (s: string) => `2026-10-06T14:05:${s}`;
const lteReconfig = (time: string, drb = false) => ({
  MsgTime: at(time),
  MsgName: "DCCH-RRCConnectionReconfiguration",
  Direction: "D",
  Message: drb ? "rrcConnectionReconfiguration-r8 { drb-ToReleaseList {\n 3\n } }" : "measConfig {}",
});
const nrBearer = (time: string, drb = false) => ({ MsgTime: at(time), MsgName: "IE-RadioBearerConfig", Direction: "D", Message: drb ? "drb-ToReleaseList {\n 3\n }" : "drb-ToAddModList {}" });
const bye = (time: string) => ({ MsgTime: at(time), MsgName: "IMS SIP BYE", SIPResponse: "Request" });

describe("DRB 3 after SIP BYE (verified THESSALONIKI_26H2)", () => {
  it("LTE, both sides: 261993005082 pattern", () => {
    const hits = drbReleasesForCall([
      { side: "A", messages: [lteReconfig("40.987"), lteReconfig("50.196", true)], sipMessages: [bye("49.919")], callEnd: at("50.309") },
      { side: "B", messages: [lteReconfig("50.091", true)], sipMessages: [bye("49.663")], callEnd: at("50.044") },
    ]);
    const ev = extractEvidence({ ...empty, drbReleases: hits });
    expect(ev.features.drbAfterBye).toBe(1);
    expect(ev.facts.find((f) => f.feature === "drbAfterBye")?.text).toContain("(LTE) στο 1ο Reconfiguration μετά το SIP BYE στην A πλευρά, 0.53 s μετά το BYE");
  });

  it("NR IE-RadioBearerConfig merged with its LTE Reconfiguration, BYE from the other side: 966367641682 pattern", () => {
    const hits = drbReleasesForCall([
      { side: "A", messages: [nrBearer("48.610", true), lteReconfig("48.616")], sipMessages: [], callEnd: at("48.187") },
      { side: "B", messages: [lteReconfig("49.096")], sipMessages: [bye("47.981")], callEnd: at("48.151") },
    ]);
    const hit = hits.find((h) => h.drbIds.includes(3))!;
    expect(hit).toMatchObject({ side: "A", layer: "NR", reconfigAfterBye: 1 });
    expect(extractEvidence({ ...empty, drbReleases: hits }).features.drbAfterBye).toBe(1);
  });

  it("ignores DRB 3 in the 3rd Reconfiguration after the BYE", () => {
    const hits = drbReleasesForCall([
      { side: "A", messages: [lteReconfig("50.000"), lteReconfig("50.500"), lteReconfig("51.000", true)], sipMessages: [bye("49.900")], callEnd: at("51.500") },
    ]);
    expect(extractEvidence({ ...empty, drbReleases: hits }).features.drbAfterBye).toBe(0);
  });

  it("ignores calls without a SIP BYE", () => {
    const hits = drbReleasesForCall([{ side: "A", messages: [lteReconfig("50.196", true)], sipMessages: [], callEnd: at("50.309") }]);
    expect(extractEvidence({ ...empty, drbReleases: hits }).features.drbAfterBye).toBe(0);
  });
});

const features = (set: Partial<Record<FeatureKey, number>>): FeatureVector =>
  Object.fromEntries(FEATURE_KEYS.map((k) => [k, set[k] ?? 0])) as Record<FeatureKey, number>;
const item = (id: string, comment: string, set: Partial<Record<FeatureKey, number>>): AuditItem => ({ id, comment: parseComment(comment), features: features(set) });
const badLte = { lteLowRsrp: 1, nativeLowLte: 1 };
