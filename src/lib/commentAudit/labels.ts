/**
 * Κανονικοποίηση των user comments σε σταθερές ετικέτες, ώστε να συγκρίνονται με
 * την ένδειξη που βγάζει το backend (βλ. evidence.ts / scoring.ts).
 *
 * Τα comments στη βάση είναι ελεύθερο κείμενο ("LC GSM", "LC LTE (B-SIDE)",
 * "CORE NETWORK (SIP 504)", "FAKE UE STUCK (UL DISCONNECT)" ...). Βλ. USER_COMMENTS_ANALYSIS.md.
 */

export const AUDIT_LABELS = [
  "LC_LTE",
  "LQ_LTE",
  "LC_GSM",
  "LQ_GSM",
  "CORE_SIP_5XX",
  "CORE_CHANNEL_RELEASE",
  "CORE_NO_PAGING",
  "CORE_BEARER",
  "CORE_DRB_RELEASE",
  "CORE_OTHER",
  "FAKE_EOF",
  "FAKE_NO_SYNC",
  "FAKE_UE_STUCK",
  "FAKE_UE_STUCK_UL_DISCONNECT",
  "FAKE_UE_STUCK_CC_DISC_MISSING",
  "FAKE_UE_STUCK_NO_CM",
  "FAKE_UE_STUCK_NO_PAGING_RESPONSE",
  "USER_SIDE",
  "TAU",
] as const;

export type AuditLabel = (typeof AUDIT_LABELS)[number];
export type CallSide = "A" | "B";

export interface ParsedComment {
  raw: string;
  /** null = το σχόλιο δεν αντιστοιχεί σε κατηγορία που μπορεί να ελεγχθεί από τα δεδομένα. */
  label: AuditLabel | null;
  /** Πλευρά που δήλωσε ο χρήστης (π.χ. "LC LTE (B-SIDE)"), αλλιώς null. */
  side: CallSide | null;
}

export const LABEL_TITLES: Record<AuditLabel, string> = {
  LC_LTE: "LC LTE",
  LQ_LTE: "LQ LTE",
  LC_GSM: "LC GSM",
  LQ_GSM: "LQ GSM",
  CORE_SIP_5XX: "CORE NETWORK (SIP 5xx)",
  CORE_CHANNEL_RELEASE: "CORE NETWORK (DL CHANNEL RELEASE)",
  CORE_NO_PAGING: "CORE NETWORK (NO PAGING)",
  CORE_BEARER: "CORE NETWORK (DEACTIVATE BEARER)",
  CORE_DRB_RELEASE: "CORE NETWORK (DRB RELEASE 3)",
  CORE_OTHER: "CORE NETWORK",
  FAKE_EOF: "FAKE EOF",
  FAKE_NO_SYNC: "FAKE NO SYNC",
  FAKE_UE_STUCK: "FAKE UE STUCK",
  FAKE_UE_STUCK_UL_DISCONNECT: "FAKE UE STUCK (UL DISCONNECT)",
  FAKE_UE_STUCK_CC_DISC_MISSING: "FAKE UE STUCK (CC DISCONNECT MISSING)",
  FAKE_UE_STUCK_NO_CM: "FAKE UE STUCK (NO CM SERVICE REQUEST)",
  FAKE_UE_STUCK_NO_PAGING_RESPONSE: "FAKE UE STUCK (NO RESPONSE AFTER PAGING)",
  USER_SIDE: "USER SIDE",
  TAU: "TAU",
};

/**
 * Γενικές ετικέτες που καλύπτουν υποκατηγορίες: ο χρήστης που γράφει "FAKE UE STUCK"
 * είναι σωστός αν τα δεδομένα δείχνουν οποιαδήποτε από τις υποκατηγορίες του.
 */
export const LABEL_CHILDREN: Readonly<Partial<Record<AuditLabel, readonly AuditLabel[]>>> = {
  FAKE_UE_STUCK: ["FAKE_UE_STUCK_UL_DISCONNECT", "FAKE_UE_STUCK_CC_DISC_MISSING", "FAKE_UE_STUCK_NO_CM", "FAKE_UE_STUCK_NO_PAGING_RESPONSE"],
  CORE_OTHER: ["CORE_SIP_5XX", "CORE_CHANNEL_RELEASE", "CORE_NO_PAGING", "CORE_BEARER", "CORE_DRB_RELEASE"],
};

export const isParentLabel = (l: AuditLabel) => Boolean(LABEL_CHILDREN[l]);

function parseSide(text: string): CallSide | null {
  if (/\bB[\s_-]?SIDE\b/.test(text)) return "B";
  if (/\bA[\s_-]?SIDE\b/.test(text)) return "A";
  return null;
}

function parseUeStuck(text: string): AuditLabel {
  if (/UL\s*DISCONNECT/.test(text)) return "FAKE_UE_STUCK_UL_DISCONNECT";
  if (/DISCONNECT\s*MISSING/.test(text)) return "FAKE_UE_STUCK_CC_DISC_MISSING";
  if (/CM\s*SERVICE/.test(text)) return "FAKE_UE_STUCK_NO_CM";
  if (/RESPONSE\s*AFTER\s*PAGING|NO\s*PAGING\s*RESPONSE/.test(text)) return "FAKE_UE_STUCK_NO_PAGING_RESPONSE";
  return "FAKE_UE_STUCK";
}

function parseFake(text: string): AuditLabel | null {
  if (text.includes("NO SYNC")) return "FAKE_NO_SYNC";
  if (text.includes("STUCK")) return parseUeStuck(text);
  if (text.includes("EOF") || text.includes("END OF FILE")) return "FAKE_EOF";
  return null;
}

function parseCore(text: string): AuditLabel {
  if (/DRB\s*(TO\s*)?RELEASE/.test(text)) return "CORE_DRB_RELEASE";
  if (/NO\s*PAGING/.test(text)) return "CORE_NO_PAGING";
  if (/SIP\s*5\d\d|\b5\d\d\b/.test(text)) return "CORE_SIP_5XX";
  if (/CHANNEL RELEASE|DL RELEASE/.test(text)) return "CORE_CHANNEL_RELEASE";
  if (text.includes("BEARER")) return "CORE_BEARER";
  return "CORE_OTHER";
}

function parseRadio(text: string): AuditLabel | null {
  const gsm = /\bGSM\b/.test(text);
  const lte = /\bLTE\b/.test(text);
  const lowCoverage = /\bLC\b|LOW COVERAGE/.test(text);
  const lowQuality = /\bLQ\b|LOW QUALITY/.test(text);
  if (lowCoverage && gsm) return "LC_GSM";
  if (lowCoverage && lte) return "LC_LTE";
  if (lowQuality && gsm) return "LQ_GSM";
  if (lowQuality && lte) return "LQ_LTE";
  return null;
}

export function parseComment(comment: string | null | undefined): ParsedComment | null {
  const raw = (comment ?? "").trim();
  if (!raw) return null;
  const text = raw.toUpperCase().replace(/_/g, " ");
  const side = parseSide(text);
  // Κανόνας χρήστη: «TAU» = Tracking Area Update Request σε καλό ράδιο (και «CORE NETWORK (TAU)»).
  if (/\bTAU\b|TRACKING AREA UPDATE/.test(text)) return { raw, label: "TAU", side };

  if (text.includes("FAKE")) return { raw, label: parseFake(text), side };
  if (text.includes("CORE")) return { raw, label: parseCore(text), side };
  const radio = parseRadio(text);
  if (radio) return { raw, label: radio, side };
  if (/DID NOT EXPECT|BUSY|DECLIN|NO ANSWER|USER/.test(text)) return { raw, label: "USER_SIDE", side };
  return { raw, label: null, side };
}
