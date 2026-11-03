/**
 * DRB release και κανόνες CORE NETWORK (DRB RELEASE 3):
 *  - Standard (κανόνας χρήστη): drb-ToReleaseList { 3 } στο 1ο/2ο DL DCCH-RRCConnectionReconfiguration
 *    μετά το «IMS SIP ACK: Request», πριν το τέλος της κλήσης· ο έλεγχος ράδιο γίνεται στο scoring.
 *  - ένδειξη για το KPI export: DRB 3 στο LTE ή στο NR IE-RadioBearerConfig, στο 1ο/2ο
 *    Reconfiguration μετά το πρώτο SIP BYE της κλήσης (A ή B).
 */
import type { CallSide } from "./labels";
import { DRB_AFTER_BYE_RULE, DRB_RELEASE_RULE, sideName, sourceOf, text, type DrbReleaseHit, type EvidenceFact, type L3MessageLike } from "./types";

const DRB_RELEASE_LIST = /drb-ToReleaseList\s*\{([^}]*)\}/g;
const isDown = (m: L3MessageLike) => text(m.Direction).toUpperCase() === "D";
const isReconfigComplete = (m: L3MessageLike) => text(m.Direction).toUpperCase() === "U" && /ReconfigurationComplete/i.test(text(m.MsgName));
const isLteReconfig = (m: L3MessageLike) => isDown(m) && /RRCConnectionReconfiguration$/i.test(text(m.MsgName).trim());
const isNrBearerConfig = (m: L3MessageLike) => isDown(m) && /RadioBearerConfig$|RRCReconfiguration$/i.test(text(m.MsgName).trim());
const isSipRequest = (name: RegExp) => (m: L3MessageLike) => name.test(text(m.MsgName).trim()) && /^Request$/i.test(text(m.SIPResponse).trim());
const isSipAck = isSipRequest(/SIP ACK$/i);
const isSipBye = isSipRequest(/SIP BYE$/i);
const timeOf = (m: L3MessageLike) => (m.MsgTime ? Date.parse(m.MsgTime) : NaN);

function firstTime(messages: readonly L3MessageLike[], match: (m: L3MessageLike) => boolean): number | null {
  const times = messages.filter(match).map(timeOf).filter((t) => !Number.isNaN(t));
  return times.length ? Math.min(...times) : null;
}

/** Χρόνος του πρώτου «IMS SIP ACK: Request» της πλευράς, ή null. */
export const firstSipAck = (sipMessages: readonly L3MessageLike[]) => firstTime(sipMessages, isSipAck);
/** Χρόνος του πρώτου «IMS SIP BYE: Request», ή null. */
export const firstSipBye = (sipMessages: readonly L3MessageLike[]) => firstTime(sipMessages, isSipBye);

/** Χρόνοι έναρξης των Reconfiguration (LTE ή NR) μετά από μια στιγμή· NR+LTE σε λίγα ms = ένα. */
function reconfigEvents(timed: readonly { m: L3MessageLike; at: number }[], after: number | null): number[] {
  if (after == null) return [];
  const starts: number[] = [];
  for (const { m, at } of timed) {
    if (at < after || !(isLteReconfig(m) || isNrBearerConfig(m))) continue;
    const last = starts[starts.length - 1];
    if (last == null || at - last > DRB_AFTER_BYE_RULE.mergeWithinMs) starts.push(at);
  }
  return starts;
}

const positionIn = (events: readonly number[], at: number) => {
  const i = events.findIndex((start, k) => at >= start && (k + 1 === events.length || at < events[k + 1]));
  return i >= 0 && at - events[i] <= DRB_AFTER_BYE_RULE.mergeWithinMs ? i + 1 : null;
};

/**
 * Όλα τα drb-ToReleaseList στα RRC μηνύματα (LTE και NR) μιας πλευράς: χρόνος σε σχέση με το CallEnd,
 * σειρά του Reconfiguration μετά το SIP ACK και μετά το πρώτο SIP BYE της κλήσης.
 */
export function findDrbReleases(
  messages: readonly L3MessageLike[],
  callEnd: string | null | undefined,
  side: CallSide,
  sipAck: number | null = null,
  sipBye: number | null = null,
): DrbReleaseHit[] {
  const end = callEnd ? Date.parse(callEnd) : NaN;
  if (Number.isNaN(end)) return [];
  const timed = messages.map((m) => ({ m, at: timeOf(m) })).filter((x) => !Number.isNaN(x.at)).sort((a, b) => a.at - b.at);
  const completes = timed.filter((x) => isReconfigComplete(x.m)).map((x) => x.at);
  const afterAck = reconfigEvents(timed, sipAck);
  const afterBye = reconfigEvents(timed, sipBye);
  return timed.flatMap(({ m, at }) =>
    [...text(m.Message).matchAll(DRB_RELEASE_LIST)].map((match) => ({
      side,
      drbIds: (match[1].match(/\d+/g) ?? []).map(Number),
      secondsFromEnd: (at - end) / 1000,
      confirmed: completes.some((c) => c >= at && c - at <= DRB_RELEASE_RULE.confirmWithinSec * 1000),
      reconfigAfterAck: positionIn(afterAck, at),
      reconfigAfterBye: positionIn(afterBye, at),
      secondsAfterBye: sipBye == null ? null : (at - sipBye) / 1000,
      layer: isNrBearerConfig(m) ? ("NR" as const) : ("LTE" as const),
    })),
  );
}

export interface SideRrcMessages {
  side: CallSide;
  /** LTE-RRC και (προαιρετικά) 5GNR-RRC μηνύματα της πλευράς. */
  messages: readonly L3MessageLike[];
  /** SIP μηνύματα της ίδιας πλευράς, για το ACK και το BYE. */
  sipMessages?: readonly L3MessageLike[];
  callEnd: string | null | undefined;
}

/**
 * DRB releases και των δύο πλευρών, μετρημένα από το ΠΡΩΤΟ τέλος (A ή B) και από το ΠΡΩΤΟ SIP BYE
 * της κλήσης (όποια πλευρά κι αν το στείλει). Το ACK μετράει ανά πλευρά.
 */
export function drbReleasesForCall(sides: readonly SideRrcMessages[]): DrbReleaseHit[] {
  const ends = sides.map((s) => (s.callEnd ? Date.parse(s.callEnd) : NaN)).filter((t) => !Number.isNaN(t));
  if (ends.length === 0) return [];
  const callEnd = new Date(Math.min(...ends)).toISOString();
  const byes = sides.map((s) => firstSipBye(s.sipMessages ?? [])).filter((t): t is number => t != null);
  const firstBye = byes.length ? Math.min(...byes) : null;
  const ackBySide = new Map<CallSide, number | null>();
  for (const s of sides) {
    const ack = firstSipAck(s.sipMessages ?? []);
    const prev = ackBySide.get(s.side);
    ackBySide.set(s.side, prev == null ? ack : ack == null ? prev : Math.min(prev, ack));
  }
  return sides.flatMap((s) => findDrbReleases(s.messages, callEnd, s.side, ackBySide.get(s.side) ?? null, firstBye));
}

const ordinal = (n: number) => `${n}ο`;

/** Κανόνας audit: 1 = DRB 3 στο 1ο/2ο Reconfiguration μετά το SIP ACK + Reconfiguration Complete· 0.5 = χωρίς επιβεβαίωση. */
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
      source: `${sourceOf("RRC", valid.side)} + SIP`,
      text: `drb-ToReleaseList { ${valid.drbIds.join(", ")} } στο ${ordinal(valid.reconfigAfterAck ?? 0)} RRC Connection Reconfiguration μετά το IMS SIP ACK στην ${sideName(valid.side)}, ${before}${ack}`,
    },
  };
}

/** Ένδειξη: DRB 3 (LTE ή NR) στο 1ο/2ο Reconfiguration μετά το πρώτο SIP BYE της κλήσης. */
export function drbAfterByeEvidence(hits: readonly DrbReleaseHit[]): { value: number; fact: EvidenceFact | null } {
  const R = DRB_AFTER_BYE_RULE;
  const valid = hits
    .filter(
      (h) =>
        h.drbIds.includes(R.drbId) &&
        h.reconfigAfterBye != null &&
        h.reconfigAfterBye <= R.maxReconfigAfterBye &&
        (h.secondsAfterBye ?? Infinity) <= R.maxSecondsAfterBye,
    )
    .sort((a, b) => (a.reconfigAfterBye ?? 0) - (b.reconfigAfterBye ?? 0))[0];
  if (!valid) return { value: 0, fact: null };
  return {
    value: 1,
    fact: {
      feature: "drbAfterBye",
      side: valid.side,
      source: `${sourceOf(valid.layer === "NR" ? "NR RRC" : "RRC", valid.side)} + SIP`,
      text: `drb-ToReleaseList { ${valid.drbIds.join(", ")} } (${valid.layer ?? "LTE"}) στο ${ordinal(valid.reconfigAfterBye ?? 0)} Reconfiguration μετά το SIP BYE στην ${sideName(valid.side)}, ${(valid.secondsAfterBye ?? 0).toFixed(2)} s μετά το BYE`,
    },
  };
}
