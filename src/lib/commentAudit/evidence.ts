/**
 * Από τα δεδομένα του backend για μία κλήση (call_analysis, σήμα LTE/GSM A/B,
 * tracelog, L3 summary, RRC μηνύματα) βγάζει:
 *  - ένα διάνυσμα χαρακτηριστικών 0..1 (για το content-based / collaborative scoring),
 *  - "facts": ανθρώπινες περιγραφές του τι είδαμε (για την περίληψη ανά κλήση).
 *
 * Οι κανόνες ακολουθούν το «Call Analysis.pptx»· τα όρια είναι στο types.ts.
 */
import { drbReleaseEvidence } from "./drbRelease";
import { radioEvidence } from "./radioEvidence";
import { signallingEvidence } from "./signallingEvidence";
import type { CallEvidence, CallEvidenceBundle, EvidenceFact } from "./types";

export * from "./types";
export { findDrbReleases } from "./drbRelease";
export { longestRun } from "./radioEvidence";

export function extractEvidence(bundle: CallEvidenceBundle): CallEvidence {
  const radio = radioEvidence(bundle.lteA, bundle.gsmA, bundle.lteB, bundle.gsmB);
  const sig = signallingEvidence(bundle);
  const drb = drbReleaseEvidence(bundle.drbReleases ?? []);
  const noL3 = bundle.l3A.length === 0;
  // Παλιά ένδειξη "κολλημένου" UE: ούτε ράδιο ούτε σηματοδοσία (γενικό FAKE UE STUCK).
  const ueStuck = radio.values.noRadio === 1 ? (noL3 || sig.notReached ? 1 : 0.5) : 0;
  const facts: EvidenceFact[] = [...(drb.fact ? [drb.fact] : []), ...radio.facts, ...sig.facts];
  if (ueStuck === 1) facts.push({ feature: "ueStuck", side: "A", text: `το UE δεν έστειλε${noL3 ? " καμία σηματοδοσία L3" : " τίποτα"}${sig.notReached ? " και ο native γράφει «Called Party not reached»" : ""}` });
  return {
    features: { ...radio.values, ...sig.values, drbRelease3: drb.value, ueStuck },
    facts,
    worstRadioSide: radio.worstRadioSide,
  };
}
