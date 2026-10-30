/**
 * Ταξινομητής που ακολουθεί ΜΟΝΟ το volte-drop-fail-analysis.md (§1.3–1.6), ώστε να
 * συγκρίνεται με το User comment audit (κανόνες του «Call Analysis.pptx»).
 *
 * Drop (§1.6, σειρά προτεραιότητας): SRVCC_FAIL → HO_FAIL → RLF → RTP_TIMEOUT → CORE_RELEASE → UNKNOWN_LOG_GAP.
 * Fail (§1.4): το πρώτο στάδιο του ladder RRC → PAGING → IMS_REG → BEARER → PRECONDITION → INVITE → RINGING
 * που δεν ολοκληρώθηκε· network/user από τους SIP κωδικούς (§1.5).
 * Το md αφορά VoLTE: καθαρές CS-GSM κλήσεις δεν ταξινομούνται (OUT_OF_SCOPE).
 */
import type { CallEvidenceBundle, L3SummaryRow, LteSample, TraceRow } from "@/lib/commentAudit/evidence";
import { MD_CONFIG, type MdConfig } from "./config";

export type MdDropCause = "SRVCC_FAIL" | "HO_FAIL" | "RLF" | "RTP_TIMEOUT" | "CORE_RELEASE" | "UNKNOWN_LOG_GAP";
export type MdFailStage = "RRC" | "PAGING" | "IMS_REG" | "BEARER" | "PRECONDITION" | "INVITE" | "RINGING" | "FALLBACK";
export type MdConfidence = "high" | "medium" | "low";

export interface MdResult {
  kind: "drop" | "fail" | "out_of_scope";
  category: MdDropCause | MdFailStage | "OUT_OF_SCOPE";
  confidence: MdConfidence;
  networkOrUser: "network" | "user" | "—";
  evidence: readonly string[];
}

type Side = Readonly<Record<string, unknown>> | null;
const text = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const has = (rows: readonly L3SummaryRow[], dir: string, name: RegExp) =>
  rows.some((r) => text(r.Direction).toUpperCase() === dir && name.test(text(r.SimpleMsgName).trim()));
const lastSeen = (rows: readonly L3SummaryRow[], dir: string, name: RegExp) =>
  Math.max(-Infinity, ...rows.filter((r) => text(r.Direction).toUpperCase() === dir && name.test(text(r.SimpleMsgName).trim())).map((r) => Date.parse(text(r.lastSeen))).filter((t) => !Number.isNaN(t)));

function callEnd(b: CallEvidenceBundle): number | null {
  const ends = [b.analysisA, b.analysisB].map((a) => Date.parse(text(a?.callEndTimeStamp))).filter((t) => !Number.isNaN(t));
  return ends.length ? Math.min(...ends) : null;
}

/** §1.5: τελικός SIP κωδικός από το tracelog («IMS SIP INVITE Error 503»). */
export function sipErrorCodes(trace: readonly TraceRow[]): number[] {
  return trace.flatMap((t) => [...text(t.Info).matchAll(/SIP INVITE Error (\d{3})/gi)].map((m) => Number(m[1])));
}

/** §1.6: radio pattern στα τελευταία N s πριν το τέλος (A ή B). */
function radioPattern(b: CallEvidenceBundle, end: number | null, cfg: MdConfig): string | null {
  if (end == null) return null;
  const from = end - cfg.lastWindowSec * 1000;
  const inWindow = (r: LteSample) => {
    const t = Date.parse(text(r.MsgTime));
    return !Number.isNaN(t) && t >= from && t <= end;
  };
  const samples = [...b.lteA, ...b.lteB].filter(inWindow);
  const rsrp = samples.map((s) => s.RSRP).filter((v): v is number => typeof v === "number");
  const sinr = samples.flatMap((s) => [s.SINR, s.SINR0, s.SINR1]).filter((v): v is number => typeof v === "number");
  const minRsrp = rsrp.length ? Math.min(...rsrp) : null;
  const minSinr = sinr.length ? Math.min(...sinr) : null;
  if ((minRsrp != null && minRsrp < cfg.rsrpLow) || (minSinr != null && minSinr < cfg.sinrLow)) {
    return `radio στα τελευταία ${cfg.lastWindowSec} s: min RSRP ${minRsrp ?? "—"} dBm, min SINR ${minSinr ?? "—"} dB`;
  }
  return null;
}

const MOBILITY_FROM_EUTRA = /^MobilityFromEUTRACommand$/i;

export function classifyDrop(b: CallEvidenceBundle, cfg: MdConfig = MD_CONFIG): MdResult {
  const sides: readonly [string, Side, readonly L3SummaryRow[]][] = [["A", b.analysisA, b.l3A], ["B", b.analysisB, b.l3B]];
  const end = callEnd(b);
  const result = (category: MdDropCause, confidence: MdConfidence, evidence: string[]): MdResult => ({ kind: "drop", category, confidence, networkOrUser: "network", evidence });

  // 1. SRVCC σε εξέλιξη στα τελευταία 5 s.
  const srvcc = sides.find(([, , l3]) => end != null && lastSeen(l3, "D", MOBILITY_FROM_EUTRA) >= end - cfg.lastWindowSec * 1000);
  if (srvcc) return result("SRVCC_FAIL", "high", [`MobilityFromEUTRACommand στα τελευταία ${cfg.lastWindowSec} s (${srvcc[0]})`]);

  // 2. HO χωρίς Complete / handover failure.
  const ho = sides.find(([, a, l3]) => text(a?.LastHoType) === "HO_FAIL" || has(l3, "U", /^Handover Failure$/i));
  if (ho) return result("HO_FAIL", "high", [`HO failure (LastHoType ${text(ho[1]?.LastHoType) || "—"}, ${ho[0]})`]);

  // 3. RLF: RRC re-establishment.
  const reest = sides.find(([, a, l3]) => num(a?.num4GReestablishment) > 0 || has(l3, "U", /RRCConnectionReestablishmentRequest/i));
  if (reest) return result("RLF", "high", [`RRC Connection Re-establishment (${reest[0]})`]);

  // 4. BYE από UE με RTP/RTCP timeout.
  const rtp = sides.find(([, a]) => /rtp|rtcp/i.test(text(a?.SIPBYEReason)) && text(a?.SIPBYEInitDirection).toUpperCase() === "U");
  if (rtp) return result("RTP_TIMEOUT", "high", [`SIP BYE από UE: ${text(rtp[1]?.SIPBYEReason)} (${rtp[0]})`]);

  // 5. BYE/release από δίκτυο με 5xx / session timer.
  const core5xx = sipErrorCodes(b.tracelog).find((c) => c >= 500);
  const coreBye = sides.find(([, a]) => text(a?.SIPBYEInitDirection).toUpperCase() === "D" && /session timer|5\d\d|server|bearer lost/i.test(text(a?.SIPBYEReason)));
  if (core5xx || coreBye) return result("CORE_RELEASE", "high", [core5xx ? `SIP ${core5xx}` : `BYE από δίκτυο: ${text(coreBye?.[1]?.SIPBYEReason)}`]);

  // Μόνο radio pattern → RLF με medium confidence· αλλιώς κενό signalling.
  const radio = radioPattern(b, end, cfg);
  if (radio) return result("RLF", "medium", [radio]);
  return result("UNKNOWN_LOG_GAP", "low", ["καμία ρητή υπογραφή στο signalling"]);
}

/** §1.5: network ή user από τον τελικό κωδικό / την κατεύθυνση του CANCEL. */
function networkOrUser(b: CallEvidenceBundle, cfg: MdConfig): "network" | "user" {
  const codes = sipErrorCodes(b.tracelog);
  if (codes.some((c) => cfg.userCodes.includes(c))) return "user";
  if (codes.includes(487)) {
    const cancelByUe = [b.analysisA, b.analysisB].some((a) => text(a?.SIPCANCELInitDirection).toUpperCase() === "U");
    return cancelByUe ? "user" : "network";
  }
  return "network";
}

function failStage(b: CallEvidenceBundle, cfg: MdConfig): { stage: MdFailStage; evidence: string } {
  const all = [...b.l3A, ...b.l3B];
  const a = b.analysisA;
  const dir = text(a?.callDir).replace(/\s/g, "").toUpperCase();
  const terminating = dir.startsWith("B->A") ? b.l3A : b.l3B;
  const codes = sipErrorCodes(b.tracelog);
  const ringing = num(b.analysisA?.numSIPINVITERinging) + num(b.analysisB?.numSIPINVITERinging);

  if (has(all, "D", /^RRCConnectionReject$/i) || (has(all, "U", /^RRCConnectionRequest$/i) && !has(all, "D", /^RRCConnectionSetup$/i))) {
    return { stage: "RRC", evidence: "RRCConnectionRequest χωρίς Setup ή Reject" };
  }
  if (terminating.length && !has(terminating, "D", /SIP INVITE/i) && !has(terminating, "U", /Service request|Paging Response/i)) {
    return { stage: "PAGING", evidence: "η καλούμενη πλευρά δεν έλαβε INVITE / δεν έστειλε Service Request" };
  }
  if ([a, b.analysisB].some((x) => num(x?.FailedRegistration) > 0)) return { stage: "IMS_REG", evidence: "Failed IMS registration" };
  if (has(all, "U", /SIP INVITE/i) && !has(all, "D", /Activate dedicated EPS bearer context request/i)) {
    return { stage: "BEARER", evidence: "INVITE χωρίς Activate dedicated EPS bearer" };
  }
  if (codes.includes(580) || [a, b.analysisB].some((x) => num(x?.numSIPPRACKFailure) > 0)) return { stage: "PRECONDITION", evidence: "580 / PRACK failure" };
  const networkCancel = [a, b.analysisB].some((x) => text(x?.SIPCANCELInitDirection).toUpperCase() === "D");
  if (/Session Progress/i.test(text(a?.SIPINVITECode)) && networkCancel && ringing === 0) {
    return { stage: "PRECONDITION", evidence: "183 Session Progress και CANCEL από το δίκτυο" };
  }
  const finalError = codes.find((c) => cfg.networkCodes.includes(c));
  if (finalError && ringing === 0) return { stage: "INVITE", evidence: `SIP ${finalError} χωρίς 180` };
  if (ringing === 0) return { stage: "RINGING", evidence: "δεν ήρθε 180 Ringing" };
  return { stage: "INVITE", evidence: codes.length ? `SIP ${codes.join(", ")}` : "αρνητική κατάληξη μετά το Ringing" };
}

export function classifyFail(b: CallEvidenceBundle, cfg: MdConfig = MD_CONFIG): MdResult {
  const tech = text(b.analysisA?.technology).trim().toUpperCase();
  if (tech === "GSM/LTE") return { kind: "fail", category: "FALLBACK", confidence: "medium", networkOrUser: "network", evidence: ["κλήση GSM/LTE (CSFB)"] };
  const { stage, evidence } = failStage(b, cfg);
  const nw = networkOrUser(b, cfg);
  const explicit = stage === "RRC" || stage === "IMS_REG" || stage === "PRECONDITION" || sipErrorCodes(b.tracelog).length > 0;
  return { kind: "fail", category: stage, confidence: explicit ? "high" : "medium", networkOrUser: nw, evidence: [evidence] };
}

/** Ταξινόμηση κατά το md· `status` = callStatus της λίστας ("Dropped" / "Failed"). */
export function classifyMd(b: CallEvidenceBundle, status: string | null | undefined, cfg: MdConfig = MD_CONFIG): MdResult {
  const tech = text(b.analysisA?.technology).trim().toUpperCase();
  if (tech === "GSM") return { kind: "out_of_scope", category: "OUT_OF_SCOPE", confidence: "low", networkOrUser: "—", evidence: ["καθαρή CS-GSM κλήση: το md καλύπτει VoLTE"] };
  return /drop/i.test(text(status)) ? classifyDrop(b, cfg) : classifyFail(b, cfg);
}
