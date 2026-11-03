/**
 * Κοινοί τύποι και όρια του comment audit.
 *
 * Τα όρια ακολουθούν το «Call Analysis.pptx» (παραδείγματα ανά περίπτωση) και τις αποφάσεις
 * του χρήστη: RxLevSub ≤ −93 dBm για LC GSM, RSRQ ≤ −15 dB για LQ LTE.
 */
import type { ScannerBundle } from "./scannerBundle";
import type { CallSide } from "./labels";

export const FEATURE_KEYS = [
  "lteLowRsrp",
  "lteLowQuality",
  "gsmLowRxLev",
  "gsmHighRxQual",
  "radioGood",
  "noRadio",
  "reestFailure",
  "cmReestablishment",
  "srvcc",
  "audioFailure",
  "sip5xx",
  "networkRelease",
  "ueDisconnect",
  "ccDisconnectMissing",
  "callFullDuration",
  "noCmServiceRequest",
  "noPaging",
  "noPagingResponse",
  "bearerDeactivation",
  "drbRelease3",
  "drbAfterBye",
  "tauRequest",
  "rtpTimeout",
  "fakeEof",
  "noSync",
  "ueStuck",
  "userSide",
  "nativeLowLte",
  "nativeLowGsm",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureVector = Readonly<Record<FeatureKey, number>>;

/** Τα χαρακτηριστικά "κακού ράδιο": όταν υπάρχουν, Core/Fake δεν στέκουν (pptx: πρώτα το ράδιο). */
export const BAD_RADIO_FEATURES = ["lteLowRsrp", "lteLowQuality", "gsmLowRxLev", "gsmHighRxQual"] as const satisfies readonly FeatureKey[];

export const RADIO_THRESHOLDS = {
  lteRsrpLow: -117,
  lteRsrqLow: -16,
  lteSinrLow: -3,
  /** LC LTE παίρνει πλήρες σκορ μόνο όταν μαζί με το RSRP είναι κακό και το RSRQ ή το SINR (pptx #2, #3). */
  lteSinrNegative: 0,
  uncorroboratedLteWeight: 0.6,
  /** RxLevSub (με DTX το Full είναι τεχνητά χαμηλό). */
  gsmRxLevLow: -93,
  gsmRxQualHigh: 5,
  /** Πόσα συνεχόμενα κακά δείγματα θεωρούνται "πλήρης" ένδειξη (τιμή 1). */
  fullRun: 5,
  goodRsrp: -110,
  /** Τα "acceptable" GSM παραδείγματα του pptx είναι −56…−88 dBm. */
  goodRxLev: -89,
  /** Scanner (καλύτερη κυψέλη του operator): αδύναμη GSM κυψέλη (όριο χρήστη). */
  scanGsmRxLevLow: -80,
  /** Scanner: αδύναμη LTE κυψέλη (όριο χρήστη). */
  scanLteRsrpLow: -115,
  /** Scanner: C/I κάτω από αυτό = παρεμβολή. */
  scanGsmCiLow: 9,
  /** Scanner: λιγότερα δείγματα ή μικρότερο ποσοστό κακών δειγμάτων = καμία ένδειξη. */
  scanMinSamples: 3,
  scanMinFraction: 0.2,
} as const;

/**
 * DRB 3 → CORE NETWORK (DRB RELEASE 3) όταν το drb-ToReleaseList { 3 } είναι στο 1ο ή 2ο
 * DL RRCConnectionReconfiguration μετά το «IMS SIP ACK: Request» (έστω σε ένα κινητό).
 * Ό,τι έρχεται μετά το πρώτο CallEnd από A και B είναι εκτός κλήσης.
 */
export const DRB_RELEASE_RULE = { drbId: 3, maxReconfigAfterAck: 2, afterEndSec: 0, confirmWithinSec: 2 } as const;

/**
 * Ένδειξη (όχι κανόνας του Standard): DRB 3 στο LTE drb-ToReleaseList Ή στο NR
 * IE-RadioBearerConfig, στο 1ο/2ο Reconfiguration μετά το πρώτο «IMS SIP BYE: Request» της κλήσης (A ή B).
 * Το NR IE και το LTE Reconfiguration που το μεταφέρει απέχουν λίγα ms: μετρούν ως ένα Reconfiguration.
 */
export const DRB_AFTER_BYE_RULE = { drbId: 3, maxReconfigAfterBye: 2, maxSecondsAfterBye: 5, mergeWithinMs: 50 } as const;

export interface LteSample {
  RSRP?: number | null;
  RSRQ?: number | null;
  SINR?: number | null;
  SINR0?: number | null;
  SINR1?: number | null;
  MsgTime?: string | null;
  PhyCellId?: number | null;
  EARFCN?: number | null;
  phase?: string | null;
}

export interface GsmSample {
  RxLevSub?: number | null;
  RxQualSub?: number | null;
  MsgTime?: string | null;
  phase?: string | null;
}

export interface L3SummaryRow {
  Technology?: string | null;
  Direction?: string | null;
  SimpleMsgName?: string | null;
  cnt?: number | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
}

export interface TraceRow {
  Info?: string | null;
  Side?: string | null;
}

export type AnalysisSide = Readonly<Record<string, unknown>>;

/** Ένα `drb-ToReleaseList { … }` σε RRC Reconfiguration, σχετικά με το τέλος της κλήσης. */
export interface DrbReleaseHit {
  side: CallSide;
  drbIds: readonly number[];
  /** Δευτερόλεπτα από το τέλος της κλήσης (αρνητικό = πριν το τέλος). */
  secondsFromEnd: number;
  /** Το UE απάντησε RRC Connection Reconfiguration Complete (pptx #10). */
  confirmed: boolean;
  /** Σειρά του Reconfiguration μετά το «IMS SIP ACK: Request» (1 = πρώτο), null αν δεν υπάρχει ACK πριν. */
  reconfigAfterAck: number | null;
  /** Σειρά του Reconfiguration μετά το πρώτο SIP BYE της κλήσης (A ή B), null αν δεν υπάρχει BYE πριν. */
  reconfigAfterBye?: number | null;
  /** Δευτερόλεπτα από το πρώτο SIP BYE της κλήσης. */
  secondsAfterBye?: number | null;
  /** Από ποιο layer ήρθε το drb-ToReleaseList. */
  layer?: "LTE" | "NR";
}

export interface L3MessageLike {
  MsgTime?: string | null;
  MsgName?: string | null;
  Direction?: string | null;
  SIPResponse?: string | null;
  Message?: string | null;
}

export interface CallEvidenceBundle {
  analysisA: AnalysisSide | null;
  analysisB: AnalysisSide | null;
  lteA: readonly LteSample[];
  lteB: readonly LteSample[];
  gsmA: readonly GsmSample[];
  gsmB: readonly GsmSample[];
  tracelog: readonly TraceRow[];
  l3A: readonly L3SummaryRow[];
  l3B: readonly L3SummaryRow[];
  /** Προαιρετικό: χωρίς τα RRC μηνύματα ο κανόνας DRB δεν ελέγχεται. */
  drbReleases?: readonly DrbReleaseHit[];
  /** Η κλήση είναι η τελευταία του αρχείου μέτρησης (pptx #14, Fake EOF). */
  isLastCallOfFile?: boolean;
  /** Καλύτερη κυψέλη του scanner κατά την κλήση (ένδειξη ράδιο του Standard και στήλες scan_* του CSV). */
  scanner?: ScannerBundle | null;
}

export interface EvidenceFact {
  feature: FeatureKey;
  side: CallSide | null;
  text: string;
  /** Από πού βγήκε το εύρημα, για την περίληψη (π.χ. «ράδιο LTE A», «tracelog B», «L3 A»). */
  source: string;
}

/** Πηγή ευρήματος: «ράδιο LTE A», «tracelog B», «L3» (χωρίς πλευρά όταν αφορά και τις δύο). */
export const sourceOf = (kind: string, side: CallSide | null) => (side ? `${kind} ${side}` : kind);

export interface CallEvidence {
  features: FeatureVector;
  facts: readonly EvidenceFact[];
  /** Πλευρά με την πιο έντονη ραδιο-ένδειξη (για έλεγχο του "(B-SIDE)" στα σχόλια). */
  worstRadioSide: CallSide | null;
}

export const sideName = (s: CallSide) => (s === "A" ? "A πλευρά" : "B πλευρά");
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const text = (v: unknown) => (v == null ? "" : String(v));
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
