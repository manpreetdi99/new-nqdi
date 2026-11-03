/**
 * Σηματοδοσία / tracelog / native classifier μιας κλήσης. Οι κανόνες GSM call control
 * ακολουθούν το «Call Analysis.pptx» (#8–#19).
 */
import type { CallSide } from "./labels";
import { sideName, sourceOf, text, type AnalysisSide, type CallEvidenceBundle, type EvidenceFact, type L3SummaryRow } from "./types";

type SideData = readonly [CallSide, AnalysisSide | null, readonly L3SummaryRow[]];
type Trace = { side: CallSide; info: string };

const msgIs = (r: L3SummaryRow, dir: string, name: RegExp) => text(r.Direction).toUpperCase() === dir && name.test(text(r.SimpleMsgName).trim());
const l3Has = (rows: readonly L3SummaryRow[], dir: string, name: RegExp) => rows.some((r) => msgIs(r, dir, name));
const firstSeen = (rows: readonly L3SummaryRow[], dir: string, name: RegExp) =>
  rows.filter((r) => msgIs(r, dir, name) && r.firstSeen).map((r) => Date.parse(text(r.firstSeen))).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b)[0] ?? null;
const analysisText = (a: AnalysisSide | null, keys: readonly string[]) => (a ? keys.map((k) => text(a[k])).join(" ") : "");

const LOW_LTE_NATIVE = /low (rsrp|rsrq|sinr)/i;
const LOW_GSM_NATIVE = /low rxlev|high rxqual/i;
const FAKE_EOF_TRACE = /test aborted|file ended|close engine|stop measuring|job stopped|user stop|closing current database/i;
/** Πόσα δευτερόλεπτα πριν τη ρυθμισμένη διάρκεια θεωρούμε ότι η κλήση "έφτασε" τη διάρκεια. */
const FULL_DURATION_TOLERANCE_S = 5;

/** "Low RSRQ, Low SINR Failed, Low RSRQ, Low SINR" → "Low RSRQ, Low SINR". */
function nativePhrases(desc: string, re: RegExp): string {
  const all = desc.match(new RegExp(re.source, "gi")) ?? [];
  return [...new Set(all.map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Rsrp|Rsrq|Sinr/g, (m) => m.toUpperCase())))].join(", ");
}

/** SIP / native classifier / LTE re-establishment / bearer. */
function sipAndNative(sides: readonly SideData[], traceHit: (re: RegExp) => Trace | null) {
  const facts: EvidenceFact[] = [];
  const reestFail = sides.find(([, a, l3]) => (a && Number(a.num4GReestablishment) > Number(a.num4GReestablishmentSuccess ?? 0)) || l3Has(l3, "D", /ReestablishmentReject/i));
  const reestReq = sides.find(([, , l3]) => l3Has(l3, "U", /RRCConnectionReestablishmentRequest/i));
  if (reestFail) facts.push({ feature: "reestFailure", side: reestFail[0], source: sourceOf(l3Has(reestFail[2], "D", /ReestablishmentReject/i) ? "L3" : "call analysis", reestFail[0]), text: `αποτυχημένο RRC re-establishment στην ${sideName(reestFail[0])}` });
  else if (reestReq) facts.push({ feature: "reestFailure", side: reestReq[0], source: sourceOf("L3", reestReq[0]), text: `RRC Connection Reestablishment Request στην ${sideName(reestReq[0])}` });

  const sipTrace = traceHit(/SIP .*Error 5\d\d/i);
  const sipNative = sides.find(([, a]) => /Server Internal Error|Service Unavailable|Server Time-?out|Bad Gateway/i.test(analysisText(a, ["SIPINVITECode", "SIPBYECode"])));
  if (sipTrace) facts.push({ feature: "sip5xx", side: sipTrace.side, source: sourceOf("tracelog", sipTrace.side), text: `«${sipTrace.info}»` });
  else if (sipNative) facts.push({ feature: "sip5xx", side: sipNative[0], source: sourceOf("call analysis", sipNative[0]), text: `SIP 5xx απάντηση στην ${sideName(sipNative[0])}` });

  // Κανόνας χρήστη (TAU): UL Tracking Area Update Request στο L3 έστω ενός κινητού.
  const tau = sides.find(([, , l3]) => l3Has(l3, "U", /Tracking area update request/i));
  if (tau) facts.push({ feature: "tauRequest", side: tau[0], source: sourceOf("L3", tau[0]), text: `UL Tracking Area Update Request στην ${sideName(tau[0])}` });

  const deact = sides.find(([, , l3]) => l3Has(l3, "D", /Deactivate EPS bearer context request/i));
  if (deact) facts.push({ feature: "bearerDeactivation", side: deact[0], source: sourceOf("L3", deact[0]), text: `DL Deactivate EPS bearer context request στην ${sideName(deact[0])}` });

  const rtp = sides.find(([, a]) => /rtp\s*timeout/i.test(analysisText(a, ["SIPBYEReason", "SIPCANCELReason", "Description", "codeDescription"])));
  if (rtp) facts.push({ feature: "rtpTimeout", side: rtp[0], source: sourceOf("call analysis", rtp[0]), text: `SIP BYE με RTP timeout στην ${sideName(rtp[0])}` });

  const user = traceHit(/SIP .*Error (486|603)/i);
  const userNative = sides.find(([, a]) => /Busy Here|Decline/i.test(analysisText(a, ["SIPINVITECode", "Description"])));
  if (user) facts.push({ feature: "userSide", side: user.side, source: sourceOf("tracelog", user.side), text: `«${user.info}» (απόρριψη από χρήστη)` });
  else if (userNative) facts.push({ feature: "userSide", side: userNative[0], source: sourceOf("call analysis", userNative[0]), text: "SIP Busy/Decline από τον χρήστη" });

  const nativeDesc = sides.map(([s, a]) => [s, analysisText(a, ["Description", "codeDescription"])] as const);
  const lowLte = nativeDesc.find(([, d]) => LOW_LTE_NATIVE.test(d));
  const lowGsm = nativeDesc.find(([, d]) => LOW_GSM_NATIVE.test(d));
  if (lowLte) facts.push({ feature: "nativeLowLte", side: lowLte[0], source: sourceOf("native classifier", lowLte[0]), text: `«${nativePhrases(lowLte[1], LOW_LTE_NATIVE)}»` });
  if (lowGsm) facts.push({ feature: "nativeLowGsm", side: lowGsm[0], source: sourceOf("native classifier", lowGsm[0]), text: `«${nativePhrases(lowGsm[1], LOW_GSM_NATIVE)}»` });

  return {
    values: {
      reestFailure: reestFail ? 1 : reestReq ? 0.5 : 0,
      sip5xx: sipTrace || sipNative ? 1 : 0,
      bearerDeactivation: deact ? 0.5 : 0,
      tauRequest: tau ? 1 : 0,
      rtpTimeout: rtp ? 1 : 0,
      userSide: user || userNative ? 1 : 0,
      nativeLowLte: lowLte ? 1 : 0,
      nativeLowGsm: lowGsm ? 1 : 0,
    },
    facts,
    notReached: nativeDesc.some(([, d]) => /called party not reached/i.test(d)),
  };
}

/** Ποιος ξεκίνησε τον τερματισμό CC: πρώτο DL Disconnect/Release = δίκτυο, πρώτο UL Disconnect = UE (pptx #11, #15, #16). */
function releaseInitiator(l3: readonly L3SummaryRow[]): "network" | "ue" | "release-only" | null {
  const DL_CLEARING = /^(Disconnect|Release)$/i;
  const UL_CLEARING = /^Disconnect$/i;
  const hasDl = l3Has(l3, "D", DL_CLEARING);
  const hasUl = l3Has(l3, "U", UL_CLEARING);
  const anyDisconnect = l3Has(l3, "D", /^Disconnect$/i) || hasUl;
  if (!anyDisconnect && hasDl) return "release-only";
  if (!hasDl && !hasUl) return null;
  if (hasUl !== hasDl) return hasUl ? "ue" : "network";
  const dl = firstSeen(l3, "D", DL_CLEARING);
  const ul = firstSeen(l3, "U", UL_CLEARING);
  return ul != null && dl != null && ul <= dl ? "ue" : "network";
}

/** Ποια πλευρά καλεί: callDir "A->B" → A καλεί, B δέχεται. */
function callRoles(a: AnalysisSide | null): { originating: CallSide; terminating: CallSide } | null {
  const dir = text(a?.callDir).replace(/\s/g, "").toUpperCase();
  if (dir.startsWith("A->B")) return { originating: "A", terminating: "B" };
  if (dir.startsWith("B->A")) return { originating: "B", terminating: "A" };
  return null;
}

const gsmRows = (l3: readonly L3SummaryRow[]) => l3.filter((r) => /GSM/i.test(text(r.Technology)));

/** GSM call control: release, CM Service Request, paging, CM re-establishment, SRVCC. */
function gsmCallControl(b: CallEvidenceBundle, sides: readonly SideData[], connectFailed: boolean) {
  const facts: EvidenceFact[] = [];
  const l3Of = (s: CallSide) => (s === "A" ? b.l3A : b.l3B);
  const initiators = sides.map(([s, , l3]) => [s, releaseInitiator(l3)] as const);
  const network = initiators.find(([, w]) => w === "network");
  const ue = initiators.find(([, w]) => w === "ue");
  const releaseOnly = initiators.find(([, w]) => w === "release-only");
  const cause = text(b.analysisA?.disconCause);
  if (network) facts.push({ feature: "networkRelease", side: network[0], source: sourceOf("L3", network[0]), text: `το δίκτυο ξεκίνησε τον τερματισμό (πρώτο μήνυμα DL Disconnect/Release) στην ${sideName(network[0])}${cause ? ` (αιτία: ${cause})` : ""}` });
  if (ue) facts.push({ feature: "ueDisconnect", side: ue[0], source: sourceOf("L3", ue[0]), text: `το UE έστειλε πρώτο UL CC Disconnect στην ${sideName(ue[0])}` });
  if (releaseOnly) facts.push({ feature: "ccDisconnectMissing", side: releaseOnly[0], source: sourceOf("L3", releaseOnly[0]), text: `CC Release χωρίς κανένα CC Disconnect στην ${sideName(releaseOnly[0])}` });

  const roles = callRoles(b.analysisA);
  // Μόνο καθαρές CS-GSM κλήσεις (pptx #12, #18)· στις GSM/LTE (CSFB) η ροή είναι άλλη.
  const isGsmCall = text(b.analysisA?.technology).trim().toUpperCase() === "GSM";
  let noCm = 0;
  let noPaging = 0;
  let noPagingResponse = 0;
  if (roles && isGsmCall) {
    const orig = gsmRows(l3Of(roles.originating));
    const term = gsmRows(l3Of(roles.terminating));
    if (orig.length && !l3Has(orig, "U", /^CM Service Request$/i)) {
      noCm = connectFailed ? 1 : 0.5;
      facts.push({ feature: "noCmServiceRequest", side: roles.originating, source: sourceOf("L3", roles.originating), text: `η καλούσα ${sideName(roles.originating)} δεν έστειλε UL CM Service Request${connectFailed ? " και η κλήση έληξε με Connect Failed" : ""}` });
    }
    const pagingRequest = l3Has(term, "D", /^Paging Request/i);
    const pagingResponse = l3Has(term, "U", /^Paging Response$/i);
    if (term.length && !pagingRequest && !pagingResponse) {
      noPaging = 1;
      facts.push({ feature: "noPaging", side: roles.terminating, source: sourceOf("L3", roles.terminating), text: `η καλούμενη ${sideName(roles.terminating)} δεν έλαβε κανένα Paging Request (μόνο broadcast/system information)` });
    } else if (pagingRequest && !pagingResponse && !l3Has(term, "D", /^Setup$/i)) {
      noPagingResponse = 1;
      facts.push({ feature: "noPagingResponse", side: roles.terminating, source: sourceOf("L3", roles.terminating), text: `η καλούμενη ${sideName(roles.terminating)} έλαβε Paging Request αλλά δεν απάντησε Paging Response` });
    }
  }

  const cmReest = sides.find(([, , l3]) => l3Has(l3, "U", /^CM Re-Establishment Request$/i));
  if (cmReest) facts.push({ feature: "cmReestablishment", side: cmReest[0], source: sourceOf("L3", cmReest[0]), text: `MM CM Re-Establishment Request στην ${sideName(cmReest[0])} (απόπειρα ανάκτησης της κλήσης)` });
  const srvcc = sides.find(([, , l3]) => l3Has(l3, "D", /^MobilityFromEUTRACommand$/i));
  if (srvcc) facts.push({ feature: "srvcc", side: srvcc[0], source: sourceOf("L3", srvcc[0]), text: `SRVCC: Mobility From EUTRA Command (LTE → GSM) στην ${sideName(srvcc[0])}` });

  return {
    values: {
      networkRelease: network ? 1 : 0,
      ueDisconnect: ue ? 1 : 0,
      ccDisconnectMissing: releaseOnly ? 1 : 0,
      noCmServiceRequest: noCm,
      noPaging,
      noPagingResponse,
      cmReestablishment: cmReest ? 1 : 0,
      srvcc: srvcc ? 1 : 0,
    },
    facts,
  };
}

/** Tracelog: Fake EOF / No Sync, POLQA σιωπή, αν η κλήση έφτασε τη ρυθμισμένη διάρκεια. */
function traceMarkers(b: CallEvidenceBundle, traceHit: (re: RegExp) => Trace | null) {
  const facts: EvidenceFact[] = [];
  const eof = traceHit(FAKE_EOF_TRACE);
  if (eof) facts.push({ feature: "fakeEof", side: eof.side, source: sourceOf("tracelog", eof.side), text: `«${eof.info}»` });
  if (b.isLastCallOfFile) facts.push({ feature: "fakeEof", side: null, source: "λίστα κλήσεων", text: "είναι η τελευταία κλήση του αρχείου μέτρησης" });

  const sync = traceHit(/no sync/i);
  if (sync) facts.push({ feature: "noSync", side: sync.side, source: sourceOf("tracelog", sync.side), text: `«${sync.info}»` });

  const audio = traceHit(/POLQA-WB error -10|Failed - No speech/i);
  if (audio) facts.push({ feature: "audioFailure", side: audio.side, source: sourceOf("tracelog", audio.side), text: `«${audio.info}»` });

  const reached = traceHit(/call duration reached/i);
  const configured = Number(traceHit(/Start call duration \(\d+s\)/i)?.info.match(/\((\d+)s\)/)?.[1] ?? NaN);
  const actual = Number(b.analysisA?.CallDuration_s ?? NaN);
  const fullDuration = Boolean(reached) || (Number.isFinite(configured) && Number.isFinite(actual) && actual >= configured - FULL_DURATION_TOLERANCE_S);
  if (fullDuration) facts.push({ feature: "callFullDuration", side: reached?.side ?? null, source: reached ? sourceOf("tracelog", reached.side) : "call analysis + tracelog", text: reached ? "«Call duration reached»" : `η κλήση κράτησε ${actual.toFixed(0)} s από τα ρυθμισμένα ${configured} s` });

  return {
    values: {
      fakeEof: eof ? 1 : b.isLastCallOfFile ? 0.4 : 0,
      noSync: sync ? 1 : 0,
      audioFailure: audio ? 1 : 0,
      callFullDuration: fullDuration ? 1 : 0,
    },
    facts,
  };
}

export function signallingEvidence(b: CallEvidenceBundle) {
  const sides: readonly SideData[] = [["A", b.analysisA, b.l3A], ["B", b.analysisB, b.l3B]];
  const trace: Trace[] = b.tracelog.map((t) => ({ side: text(t.Side).toUpperCase() === "B" ? "B" : "A", info: text(t.Info) }));
  const traceHit = (re: RegExp) => trace.find((t) => re.test(t.info)) ?? null;
  const sip = sipAndNative(sides, traceHit);
  const gsm = gsmCallControl(b, sides, Boolean(traceHit(/connect failed/i)));
  const marks = traceMarkers(b, traceHit);
  return {
    values: { ...sip.values, ...gsm.values, ...marks.values },
    facts: [...sip.facts, ...gsm.facts, ...marks.facts],
    notReached: sip.notReached,
  };
}
