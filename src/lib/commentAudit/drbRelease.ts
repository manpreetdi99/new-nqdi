/**
 * pptx #10 «Core Network (DRB to Release)» με τον ορισμό του χρήστη: DRB 3 μετράει όταν το
 * drb-ToReleaseList { 3 } είναι στο 1ο ή 2ο DL DCCH-RRCConnectionReconfiguration μετά το
 * «IMS SIP ACK: Request», έστω σε ένα κινητό, και όχι μετά το τέλος της κλήσης.
 * Ο έλεγχος ράδιο (αυστηρός κανόνας) γίνεται στο scoring.
 */
import type { CallSide } from "./labels";
import { DRB_RELEASE_RULE, sideName, text, type DrbReleaseHit, type EvidenceFact, type L3MessageLike } from "./types";

const DRB_RELEASE_LIST = /drb-ToReleaseList\s*\{([^}]*)\}/g;
const isReconfigComplete = (m: L3MessageLike) => text(m.Direction).toUpperCase() === "U" && /ReconfigurationComplete/i.test(text(m.MsgName));
const isDlReconfig = (m: L3MessageLike) => text(m.Direction).toUpperCase() === "D" && /RRCConnectionReconfiguration$/i.test(text(m.MsgName).trim());
const isSipAck = (m: L3MessageLike) => /SIP ACK$/i.test(text(m.MsgName).trim()) && /^Request$/i.test(text(m.SIPResponse).trim());
const timeOf = (m: L3MessageLike) => (m.MsgTime ? Date.parse(m.MsgTime) : NaN);

/** Χρόνος του πρώτου «IMS SIP ACK: Request» της πλευράς, ή null. */
export function firstSipAck(sipMessages: readonly L3MessageLike[]): number | null {
  const acks = sipMessages.filter(isSipAck).map(timeOf).filter((t) => !Number.isNaN(t));
  return acks.length ? Math.min(...acks) : null;
}

/**
 * Όλα τα drb-ToReleaseList στα RRC μηνύματα μιας πλευράς: χρόνος σε σχέση με το CallEnd και
 * σειρά του Reconfiguration μετά το SIP ACK (1 = το πρώτο μετά το ACK).
 */
export function findDrbReleases(messages: readonly L3MessageLike[], callEnd: string | null | undefined, side: CallSide, sipAck: number | null = null): DrbReleaseHit[] {
  const end = callEnd ? Date.parse(callEnd) : NaN;
  if (Number.isNaN(end)) return [];
  const timed = messages.map((m) => ({ m, at: timeOf(m) })).filter((x) => !Number.isNaN(x.at)).sort((a, b) => a.at - b.at);
  const completes = timed.filter((x) => isReconfigComplete(x.m)).map((x) => x.at);
  const reconfigsAfterAck = sipAck == null ? [] : timed.filter((x) => isDlReconfig(x.m) && x.at >= sipAck);
  return timed.flatMap(({ m, at }) =>
    [...text(m.Message).matchAll(DRB_RELEASE_LIST)].map((match) => {
      const position = reconfigsAfterAck.findIndex((x) => x.m === m);
      return {
        side,
        drbIds: (match[1].match(/\d+/g) ?? []).map(Number),
        secondsFromEnd: (at - end) / 1000,
        confirmed: completes.some((c) => c >= at && c - at <= DRB_RELEASE_RULE.confirmWithinSec * 1000),
        reconfigAfterAck: position >= 0 ? position + 1 : null,
      };
    }),
  );
}

export interface SideRrcMessages {
  side: CallSide;
  messages: readonly L3MessageLike[];
  /** SIP μηνύματα της ίδιας πλευράς, για το «IMS SIP ACK: Request». */
  sipMessages?: readonly L3MessageLike[];
  callEnd: string | null | undefined;
}

/**
 * DRB releases και των δύο πλευρών, μετρημένα από το ΠΡΩΤΟ τέλος (A ή B): όταν η A πέφτει
 * πρώτη, ένα DRB release της B μετά από αυτό είναι εκτός κλήσης, ακόμη κι αν η B "τελειώνει" αργότερα.
 */
export function drbReleasesForCall(sides: readonly SideRrcMessages[]): DrbReleaseHit[] {
  const ends = sides.map((s) => (s.callEnd ? Date.parse(s.callEnd) : NaN)).filter((t) => !Number.isNaN(t));
  if (ends.length === 0) return [];
  const callEnd = new Date(Math.min(...ends)).toISOString();
  const ackBySide = new Map<CallSide, number | null>();
  for (const s of sides) {
    const ack = firstSipAck(s.sipMessages ?? []);
    const prev = ackBySide.get(s.side);
    ackBySide.set(s.side, prev == null ? ack : ack == null ? prev : Math.min(prev, ack));
  }
  return sides.flatMap((s) => findDrbReleases(s.messages, callEnd, s.side, ackBySide.get(s.side) ?? null));
}

const ordinal = (n: number) => `${n}ο`;

/** 1 = DRB 3 στο 1ο/2ο Reconfiguration μετά το SIP ACK + Reconfiguration Complete· 0.5 = χωρίς επιβεβαίωση από το UE. */
export function drbReleaseEvidence(hits: readonly DrbReleaseHit[]): { value: number; fact: EvidenceFact | null } {
  const R = DRB_RELEASE_RULE;
  const valid = hits
    .filter((h) => h.drbIds.includes(R.drbId) && h.secondsFromEnd <= R.afterEndSec && h.reconfigAfterAck != null && h.reconfigAfterAck <= R.maxReconfigAfterAck)
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || (a.reconfigAfterAck ?? 0) - (b.reconfigAfterAck ?? 0))[0];
  if (!valid) return { value: 0, fact: null };
  const before = `${Math.abs(valid.secondsFromEnd).toFixed(1)} s πριν το τέλος της κλήσης`;
  const ack = valid.confirmed ? ", το UE απάντησε Reconfiguration Complete" : ", χωρίς Reconfiguration Complete από το UE";
  return {
    value: valid.confirmed ? 1 : 0.5,
    fact: {
      feature: "drbRelease3",
      side: valid.side,
      text: `drb-ToReleaseList { ${valid.drbIds.join(", ")} } στο ${ordinal(valid.reconfigAfterAck ?? 0)} RRC Connection Reconfiguration μετά το IMS SIP ACK στην ${sideName(valid.side)}, ${before}${ack}`,
    },
  };
}
