import { describe, expect, it } from "vitest";
import { extractEvidence, type CallEvidenceBundle } from "./evidence";
import { parseComment } from "./labels";
import { buildNarrative, narrativeText } from "./narrative";
import { auditComments } from "./scoring";

const empty: CallEvidenceBundle = { analysisA: null, analysisB: null, lteA: [], lteB: [], gsmA: [], gsmB: [], tracelog: [], l3A: [], l3B: [] };
const lowLte = Array.from({ length: 6 }, (_, i) => ({ RSRP: -118 - i, RSRQ: -12, phase: "during" }));

function narrate(comment: string, bundle: CallEvidenceBundle) {
  const parsed = parseComment(comment);
  const evidence = extractEvidence(bundle);
  const [score] = auditComments([{ id: "1", comment: parsed, features: evidence.features }]);
  return buildNarrative(parsed, evidence, score);
}

describe("buildNarrative", () => {
  it("explains a supported comment with the radio evidence", () => {
    const n = narrate("LC LTE", { ...empty, lteA: lowLte });
    expect(n.why).toContain("Ο χρήστης έγραψε «LC LTE» πιθανότατα επειδή είδε: 6 συνεχόμενα δείγματα RSRP ≤ -117 dBm");
    expect(n.verdict).toMatch(/^Τα δεδομένα στηρίζουν το σχόλιο — βαθμός \d+\/100\.$/);
    expect(n.against).toBeNull();
  });

  it("names the contradicting evidence and the likelier cause", () => {
    const n = narrate("LC GSM", {
      ...empty,
      gsmA: [{ RxLevSub: -60, phase: "during" }],
      l3A: [{ Direction: "D", SimpleMsgName: "Channel Release" }, { Direction: "D", SimpleMsgName: "Disconnect" }],
    });
    expect(n.against).toContain("καλό ράδιο σε όλη την κλήση (min RxLev -60 dBm)");
    expect(n.verdict).toContain("«CORE NETWORK (DL CHANNEL RELEASE)»");
    expect(n.alternative).toBe("Για «CORE NETWORK (DL CHANNEL RELEASE)» μιλούν: το δίκτυο ξεκίνησε τον τερματισμό (πρώτο μήνυμα DL Disconnect/Release) στην A πλευρά [L3 A].");
  });

  it("warns when the declared side differs from the worst radio side", () => {
    const n = narrate("LC LTE (A-SIDE)", { ...empty, lteB: lowLte });
    expect(n.sideNote).toBe("Ο χρήστης έγραψε A-SIDE, αλλά τα χειρότερα δείγματα ράδιο είναι στη B πλευρά.");
  });

  it("explains the DRB rule when it overrides the user's comment", () => {
    const goodLte = Array.from({ length: 6 }, () => ({ RSRP: -95, RSRQ: -9, phase: "during" }));
    const n = narrate("LC LTE", { ...empty, lteA: goodLte, drbReleases: [{ side: "B", drbIds: [3], secondsFromEnd: -0.2, confirmed: true, reconfigAfterAck: 1 }] });
    expect(n.alternative).toBe(
      "Για «CORE NETWORK (DRB RELEASE 3)» μιλούν: drb-ToReleaseList { 3 } στο 1ο RRC Connection Reconfiguration μετά το IMS SIP ACK στην B πλευρά, 0.2 s πριν το τέλος της κλήσης, το UE απάντησε Reconfiguration Complete [RRC B + SIP].",
    );
    expect(n.verdict).toBe(
      "Κανόνας: drb-ToReleaseList { 3 } στο 1ο/2ο RRC Reconfiguration μετά το IMS SIP ACK (A ή B), με Reconfiguration Complete και αποδεκτό ράδιο → CORE NETWORK (DRB RELEASE 3). Το σχόλιο έπρεπε να είναι «CORE NETWORK (DRB RELEASE 3)» — βαθμός 0/100.",
    );
  });

  it("describes a call without a user comment", () => {
    const evidence = extractEvidence({ ...empty, lteA: lowLte });
    const [score] = auditComments([{ id: "1", comment: null, features: evidence.features }]);
    const n = buildNarrative(null, evidence, score);
    expect(n.why.startsWith("Χωρίς σχόλιο χρήστη. Είδα: 6 συνεχόμενα δείγματα RSRP")).toBe(true);
    expect(n.verdict).toBe("Χωρίς σχόλιο χρήστη· κατά τα δεδομένα: «LC LTE».");
  });

  it("joins the parts into one paragraph", () => {
    const text = narrativeText(narrate("LC LTE", { ...empty, lteA: lowLte }));
    expect(text.startsWith("Ο χρήστης έγραψε «LC LTE»")).toBe(true);
    expect(text).toContain("βαθμός");
  });
});
