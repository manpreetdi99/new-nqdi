/**
 * Expert profiles ανά ετικέτα (content-based prior) και κανόνες που υπερισχύουν.
 *
 * Αρχή από το «Call Analysis.pptx»: πρώτα το ράδιο. Με κακό ράδιο η κλήση είναι LC/LQ·
 * μόνο με αποδεκτό ράδιο κρίνεται ποιος τύπος Core / Fake είναι, από τη σηματοδοσία.
 * Γι' αυτό όλα τα Core / Fake UE stuck / Fake No Sync προφίλ τιμωρούνται από το κακό ράδιο.
 */
import { AUDIT_LABELS, LABEL_CHILDREN, type AuditLabel } from "./labels";
import { BAD_RADIO_FEATURES, clamp01, type FeatureKey, type FeatureVector } from "./types";

export type Profile = Readonly<Partial<Record<FeatureKey, number>>>;

const BAD_RADIO: Profile = { lteLowRsrp: -0.8, lteLowQuality: -0.6, gsmLowRxLev: -0.8, gsmHighRxQual: -0.6 };
/** Αποδεκτό ράδιο: ενισχύει Core/Fake, το κακό τα αποκλείει. */
const NEEDS_GOOD_RADIO = (radioGood: number): Profile => ({ ...BAD_RADIO, radioGood });

/** Expert prior ανά ετικέτα. Αρνητικό βάρος = ένδειξη που ΑΝΤΙΚΡΟΥΕΙ την ετικέτα. */
export const PRIOR_PROFILES: Readonly<Record<AuditLabel, Profile>> = {
  // pptx #2/#3: RSRP −123…−133, RSRQ −19…−22, SINR αρνητικό, RRC re-establishment πριν το drop.
  LC_LTE: { lteLowRsrp: 1, reestFailure: 0.4, nativeLowLte: 0.4, radioGood: -0.8, fakeEof: -0.5, noSync: -0.3 },
  // pptx #4/#5: RSRQ κακό με RSRP όχι πολύ χαμηλό, POLQA-WB error −10 πριν το drop.
  LQ_LTE: { lteLowQuality: 1, nativeLowLte: 0.4, audioFailure: 0.4, lteLowRsrp: -0.3, radioGood: -0.5 },
  // pptx #7: SRVCC σε αδύναμο GSM (−108/−109) → CM Re-Establishment Request → drop.
  LC_GSM: { gsmLowRxLev: 1, nativeLowGsm: 0.4, cmReestablishment: 0.4, audioFailure: 0.2, radioGood: -0.8, fakeEof: -0.5 },
  LQ_GSM: { gsmHighRxQual: 1, nativeLowGsm: 0.4, audioFailure: 0.4, gsmLowRxLev: 0.2, radioGood: -0.5 },
  // pptx #13: INVITE Error 503 με καλό ράδιο, μετά Deactivate EPS Bearer.
  CORE_SIP_5XX: { sip5xx: 1, bearerDeactivation: 0.3, ...NEEDS_GOOD_RADIO(0.4) },
  // pptx #11: DL CC Release από το δίκτυο με αποδεκτό GSM (−75…−88).
  CORE_CHANNEL_RELEASE: { networkRelease: 1, ccDisconnectMissing: 0.3, callFullDuration: -0.8, fakeEof: -0.5, ...NEEDS_GOOD_RADIO(0.6) },
  // pptx #12: η καλούμενη πλευρά δεν παίρνει Paging Request, καλό ράδιο.
  CORE_NO_PAGING: { noPaging: 1, ...NEEDS_GOOD_RADIO(0.5) },
  CORE_BEARER: { bearerDeactivation: 1, rtpTimeout: 0.6, ...NEEDS_GOOD_RADIO(0.5) },
  // pptx #10: DRB 3 + Reconfiguration Complete, αποδεκτό ράδιο, χωρίς HO/RLF.
  CORE_DRB_RELEASE: { drbRelease3: 1, reestFailure: -0.6, ...NEEDS_GOOD_RADIO(0.4) },
  CORE_OTHER: {},
  // pptx #14: Test aborted / Job stopped / User stop, τελευταία κλήση του αρχείου.
  FAKE_EOF: { fakeEof: 1 },
  // pptx #17: «No Sync found» με καλό ράδιο και κανονική απελευθέρωση.
  FAKE_NO_SYNC: { noSync: 1, ...NEEDS_GOOD_RADIO(0.3) },
  FAKE_UE_STUCK: { ueStuck: 1, noRadio: 0.3 },
  // pptx #15: UL CC Disconnect από το UE, καλό ράδιο.
  FAKE_UE_STUCK_UL_DISCONNECT: { ueDisconnect: 1, ...NEEDS_GOOD_RADIO(0.5) },
  // pptx #16: CC Release χωρίς UL Disconnect, ενώ η κλήση έφτασε τη ρυθμισμένη διάρκεια.
  FAKE_UE_STUCK_CC_DISC_MISSING: { ccDisconnectMissing: 1, callFullDuration: 0.8, ...NEEDS_GOOD_RADIO(0.4) },
  // pptx #18: A→B GSM χωρίς UL CM Service Request, Connect Failed, καλό ράδιο.
  FAKE_UE_STUCK_NO_CM: { noCmServiceRequest: 1, ...NEEDS_GOOD_RADIO(0.5) },
  // pptx #19 (χωρίς slide): Paging Request χωρίς Paging Response, καλό ράδιο.
  FAKE_UE_STUCK_NO_PAGING_RESPONSE: { noPagingResponse: 1, ...NEEDS_GOOD_RADIO(0.5) },
  USER_SIDE: { userSide: 1 },
  // Κανόνας χρήστη: Tracking Area Update Request (A ή B) με καλό ράδιο.
  TAU: { tauRequest: 1, ...NEEDS_GOOD_RADIO(0.5) },
};

/** Κατηγορίες που δεν είναι στο pptx: κρατιούνται, με χαμηλότερη προτεραιότητα. */
const LABEL_PRIORITY: Readonly<Partial<Record<AuditLabel, number>>> = { CORE_BEARER: 0.85, CORE_OTHER: 0.85 };

function ownScore(profile: Profile, x: FeatureVector): number {
  const keys = Object.keys(profile) as FeatureKey[];
  const positive = keys.reduce((s, k) => s + Math.max(0, profile[k] ?? 0), 0);
  if (positive === 0) return 0;
  return clamp01(keys.reduce((s, k) => s + (profile[k] ?? 0) * x[k], 0) / positive);
}

/** Γενική ετικέτα = το καλύτερο από το δικό της προφίλ και των υποκατηγοριών της. */
export function priorScore(label: AuditLabel, x: FeatureVector): number {
  const children = LABEL_CHILDREN[label] ?? [];
  const best = Math.max(ownScore(PRIOR_PROFILES[label], x), ...children.map((c) => ownScore(PRIOR_PROFILES[c], x)));
  return best * (LABEL_PRIORITY[label] ?? 1);
}

/** Το "ενεργό" προφίλ μιας ετικέτας (για γενικές: το μέγιστο βάρος από τις υποκατηγορίες). */
export function profileFor(label: AuditLabel): Profile {
  const all = [PRIOR_PROFILES[label], ...(LABEL_CHILDREN[label] ?? []).map((c) => PRIOR_PROFILES[c])];
  const keys = [...new Set(all.flatMap((p) => Object.keys(p) as FeatureKey[]))];
  return Object.fromEntries(keys.map((k) => [k, Math.max(...all.map((p) => p[k] ?? -Infinity))]));
}

/** Πόσο υπάρχει η ΚΥΡΙΑ ένδειξη της ετικέτας (τα χαρακτηριστικά με βάρος 1, π.χ. RxLev για LC GSM). */
export function primaryEvidence(label: AuditLabel, x: FeatureVector): number {
  const profile = profileFor(label);
  const primary = (Object.keys(profile) as FeatureKey[]).filter((k) => (profile[k] ?? 0) >= 1);
  return primary.length ? Math.max(...primary.map((k) => x[k])) : 0;
}

/** Αποδεκτό ράδιο κατά το pptx: κανένα κακό δείγμα και χωρίς αποτυχημένο re-establishment. */
/** Καλές μετρήσεις ράδιο (κινητό και scanner), χωρίς άλλον έλεγχο. */
export const radioMeasurementsGood = (x: FeatureVector) => BAD_RADIO_FEATURES.every((k) => x[k] === 0) && x.noRadio === 0;
export const radioAcceptable = (x: FeatureVector) => radioMeasurementsGood(x) && x.reestFailure < 1;

export interface HardRule {
  label: AuditLabel;
  description: string;
  applies: (x: FeatureVector) => boolean;
  /** Η ετικέτα βγαίνει ΜΟΝΟ από τον κανόνα (όχι από τα σκορ) — ισχύει για το DRB. */
  exclusive?: boolean;
}

/**
 * "strict" = pptx #10 (Reconfiguration Complete + αποδεκτό ράδιο).
 * "unconditional" = κουμπί «DRB without rules»: κάθε DRB 3 στο 1ο/2ο Reconfiguration μετά το SIP ACK, χωρίς άλλον έλεγχο.
 */
export type DrbRuleMode = "strict" | "unconditional";

const DRB_RULES: Readonly<Record<DrbRuleMode, HardRule>> = {
  strict: {
    label: "CORE_DRB_RELEASE",
    description: "drb-ToReleaseList { 3 } στο 1ο/2ο RRC Reconfiguration μετά το IMS SIP ACK (A ή B), με Reconfiguration Complete και αποδεκτό ράδιο → CORE NETWORK (DRB RELEASE 3)",
    applies: (x) => x.drbRelease3 === 1 && radioAcceptable(x),
    exclusive: true,
  },
  unconditional: {
    label: "CORE_DRB_RELEASE",
    description: "drb-ToReleaseList { 3 } στο 1ο/2ο RRC Reconfiguration μετά το IMS SIP ACK (A ή B), χωρίς έλεγχο ράδιο → CORE NETWORK (DRB RELEASE 3)",
    applies: (x) => x.drbRelease3 > 0,
    exclusive: true,
  },
};

/** Κανόνας χρήστη: UL Tracking Area Update Request στο L3 έστω ενός κινητού, με καλό ράδιο → TAU. */
const TAU_RULE: HardRule = {
  label: "TAU",
  description: "UL Tracking Area Update Request στο L3 (A ή B) με καλές μετρήσεις ράδιο → TAU",
  applies: (x) => x.tauRequest === 1 && radioMeasurementsGood(x),
  exclusive: true,
};

/** Κανόνες του Standard (pptx + κανόνες DRB και TAU του χρήστη) που ορίζουν το σωστό σχόλιο ανεξάρτητα από τα σκορ. */
export const hardRules = (drbMode: DrbRuleMode = "strict"): readonly HardRule[] => [DRB_RULES[drbMode], TAU_RULE];

export const HARD_RULES = hardRules("strict");

/** Η ετικέτα του χρήστη ταιριάζει με την αναμενόμενη, ή είναι η γενική κατηγορία της. */
export const labelMatches = (user: AuditLabel, expected: AuditLabel) => user === expected || (LABEL_CHILDREN[user] ?? []).includes(expected);

export const SPECIFIC_LABELS = AUDIT_LABELS.filter((l) => !LABEL_CHILDREN[l]);
