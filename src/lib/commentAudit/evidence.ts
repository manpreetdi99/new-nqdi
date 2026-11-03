/**
 * Από τα δεδομένα του backend για μία κλήση (call_analysis, σήμα LTE/GSM A/B,
 * tracelog, L3 summary, RRC μηνύματα) βγάζει:
 *  - ένα διάνυσμα χαρακτηριστικών 0..1 (για το content-based / collaborative scoring),
 *  - "facts": ανθρώπινες περιγραφές του τι είδαμε (για την περίληψη ανά κλήση).
 *
 * Οι κανόνες ακολουθούν το «Call Analysis.pptx»· τα όρια είναι στο types.ts.
 * Ο scanner μπαίνει στο ράδιο: κακή καλύτερη κυψέλη = κακή κάλυψη, ακόμη κι αν το κινητό δεν έχει δείγματα.
 */
import { drbAfterByeEvidence, drbReleaseEvidence } from "./drbRelease";
import { radioEvidence } from "./radioEvidence";
import { scannerEvidence } from "./scannerEvidence";
import { signallingEvidence } from "./signallingEvidence";
import type { CallEvidence, CallEvidenceBundle, EvidenceFact } from "./types";

export * from "./types";
export { findDrbReleases } from "./drbRelease";
export { longestRun } from "./radioEvidence";

export function extractEvidence(bundle: CallEvidenceBundle): CallEvidence {
  const phone = radioEvidence(bundle.lteA, bundle.gsmA, bundle.lteB, bundle.gsmB);
  const scan = scannerEvidence(bundle);
  const scanBad = scan.gsmLow > 0 || scan.lteLow > 0 || scan.gsmInterference > 0;
  // Ράδιο = κινητό ή scanner (το χειρότερο από τα δύο)· με κακό scanner το ράδιο δεν είναι «καλό».
  const radio = {
    values: {
      ...phone.values,
      gsmLowRxLev: Math.max(phone.values.gsmLowRxLev, scan.gsmLow),
      gsmHighRxQual: Math.max(phone.values.gsmHighRxQual, scan.gsmInterference),
      lteLowRsrp: Math.max(phone.values.lteLowRsrp, scan.lteLow),
      radioGood: scanBad ? 0 : phone.values.radioGood,
    },
    facts: [...phone.facts.filter((f) => !(scanBad && f.feature === "radioGood")), ...scan.facts],
    worstRadioSide: phone.worstRadioSide,
  };
  const sig = signallingEvidence(bundle);
  const drb = drbReleaseEvidence(bundle.drbReleases ?? []);
  const drbBye = drbAfterByeEvidence(bundle.drbReleases ?? []);
  const noL3 = bundle.l3A.length === 0;
  // Παλιά ένδειξη "κολλημένου" UE: ούτε ράδιο ούτε σηματοδοσία (γενικό FAKE UE STUCK).
  const ueStuck = radio.values.noRadio === 1 ? (noL3 || sig.notReached ? 1 : 0.5) : 0;
  const facts: EvidenceFact[] = [...(drb.fact ? [drb.fact] : []), ...(drbBye.fact ? [drbBye.fact] : []), ...radio.facts, ...sig.facts];
  if (ueStuck === 1) facts.push({ feature: "ueStuck", side: "A", source: "L3 + native A", text: `το UE δεν έστειλε${noL3 ? " καμία σηματοδοσία L3" : " τίποτα"}${sig.notReached ? " και ο native γράφει «Called Party not reached»" : ""}` });
  return {
    features: { ...radio.values, ...sig.values, drbRelease3: drb.value, drbAfterBye: drbBye.value, ueStuck },
    facts,
    worstRadioSide: radio.worstRadioSide,
  };
}
