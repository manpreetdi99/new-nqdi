/**
 * signallingHighlights.ts
 * -----------------------------------------------------------------------------
 * Per-technology anomaly classification for L3 signalling rows (RRC/NAS/SIP for
 * LTE/VoLTE/NR, CC/MM/RR for GSM). Pure client-side logic over the rows the
 * /api/l3_messages endpoint already returns (FactL3Messages) — no queries here.
 *
 * Handles:
 *   - LTE / VoLTE / NR → SIP response + SimpleMsgName regex rules (NR reuses
 *     the LTE ruleset since 5GMM/NR-RRC names are folded into the same table)
 *   - GSM               → SimpleMsgName rules + cause-value decode (fires once
 *     the endpoint starts exposing causeValue/causeText from GSML3Causes)
 *
 * Cross-row (JS-side) detections layered on top of the single-row rules:
 *   - LTE: RRCConnectionReconfiguration (DL) without ...Complete (UL) within 3s
 *   - GSM: Handover Command (DL) without Handover Complete (UL) within 3s
 *   - SIP: network-initiated BYE (downlink) arriving early / with Reason header
 * -----------------------------------------------------------------------------
 */

import { useMemo } from "react";
import type { L3MessageRow } from "@/lib/api";

export type Severity = "red" | "orange" | "yellow" | "green" | "none";

export interface HighlightResult {
  severity: Severity;
  reason: string; // human-readable why-it-fired (tooltip)
}

/** L3MessageRow plus optional GSM cause-decode fields, once the backend exposes them. */
export type L3Row = L3MessageRow & {
  causeValue?: number | null;
  causeText?: string | null;
};

/* ===========================================================================
 * SIP rules (shared by LTE / VoLTE / NR)
 * =========================================================================*/

/** Any SIP response NOT in this set is treated as abnormal (red). */
const SIP_NORMAL = new Set(["trying", "ringing", "ok", "request", "session progress"]);

/** Extract the response phrase from a SIPResponse that may be '486 Busy Here' etc. */
function normalizeSipResponse(raw: string): string {
  return raw
    .replace(/^\s*\d{3}\s*/, "") // strip leading status code if present
    .trim()
    .toLowerCase();
}

/* ===========================================================================
 * LTE / VoLTE / NR — SimpleMsgName regex rules
 * =========================================================================*/

const LTE_RULES: Array<{ sev: Severity; re: RegExp; reason: string }> = [
  // red — drop / failure
  {
    sev: "red",
    re: /Reestablishment(Request|Reject)?|RadioLinkFailure|RRC.*Reject|RRCReject|RRCReestablishmentReject/i,
    reason: "Radio drop / re-establishment / RRC reject",
  },
  {
    sev: "red",
    re: /Detach request|Authentication Reject|Service [Rr]eject|Tracking Area Update Reject|PDN Connectivity Reject|Bearer Resource Allocation Reject|Registration reject|.*Reject$/i,
    reason: "NAS/5GMM reject or detach",
  },
  // orange — abnormal, not certain drop
  {
    sev: "orange",
    re: /CANCEL|MobilityFromEUTRA|ReestablishmentComplete|Deactivate EPS bearer/i,
    reason: "Forced inter-RAT / cancel / bearer deactivation mid-call",
  },
  // yellow — context
  {
    sev: "yellow",
    re: /MeasurementReport|Modify EPS bearer/i,
    reason: "Signal struggle / codec-QoS churn",
  },
];

/* ===========================================================================
 * GSM — SimpleMsgName rules  (cause-based logic handled separately below)
 * =========================================================================*/

const GSM_RULES: Array<{ sev: Severity; re: RegExp; reason: string }> = [
  // red — drop / failure
  {
    sev: "red",
    re: /Handover Failure|Assignment Failure|Ciphering Mode Reject/i,
    reason: "RR failure (HO / assignment / ciphering)",
  },
  {
    sev: "red",
    re: /Location Updating Reject|Authentication Reject|CM Service Reject|\bAbort\b/i,
    reason: "MM reject / abort",
  },
  // orange — abnormal, not certain drop
  {
    sev: "orange",
    re: /Immediate Assignment Reject|Channel Mode Modify|Classmark (Change|Enquiry)/i,
    reason: "Congestion / codec instability / classmark churn",
  },
  // yellow — context
  {
    sev: "yellow",
    re: /Measurement Report/i,
    reason: "Signal struggle (precursor to HO/drop)",
  },
];

/** CC causes considered normal — a Disconnect/Release with these is green. */
const GSM_NORMAL_CC_CAUSES = new Set<number>([16, 17, 31]);
// 16 normal clearing · 17 user busy · 31 normal unspecified

/** CC causes that positively indicate a network-side problem. */
const GSM_PROBLEM_CC_CAUSES = new Set<number>([38, 41, 42, 44, 47]);
// 38 network out of order · 41 temporary failure · 42 switching congestion
// 44 requested channel unavailable · 47 resource unavailable

const GSM_RELEASE_NAME = /Disconnect|Release Complete|Release|Channel Release/i;

/* ===========================================================================
 * Per-row classification (single-message rules)
 * =========================================================================*/

function classifyRow(m: L3Row): HighlightResult {
  const name = (m.SimpleMsgName || m.MsgName || "").trim();
  const tech = (m.Technology || "").toUpperCase();

  /* ---- SIP (any RAT) ---- */
  if (m.SIPResponse && m.SIPResponse.trim()) {
    const norm = normalizeSipResponse(m.SIPResponse);
    if (norm && !SIP_NORMAL.has(norm)) {
      return { severity: "red", reason: `Abnormal SIP response: ${m.SIPResponse}` };
    }
  }

  /* ---- GSM cause-based release (name normal, cause abnormal) ---- */
  if (tech === "GSM" && GSM_RELEASE_NAME.test(name) && m.causeValue != null) {
    if (GSM_PROBLEM_CC_CAUSES.has(m.causeValue)) {
      return {
        severity: "red",
        reason: `Abnormal release — cause ${m.causeValue}${m.causeText ? ` (${m.causeText})` : ""}`,
      };
    }
    if (!GSM_NORMAL_CC_CAUSES.has(m.causeValue)) {
      return {
        severity: "orange",
        reason: `Non-standard release cause ${m.causeValue}${m.causeText ? ` (${m.causeText})` : ""}`,
      };
    }
  }

  /* ---- name-based rules per technology ---- */
  const rules = tech === "GSM" ? GSM_RULES : LTE_RULES;
  for (const r of rules) {
    if (r.re.test(name)) return { severity: r.sev, reason: r.reason };
  }

  return { severity: "none", reason: "" };
}

/* ===========================================================================
 * Multi-row (JS-side) detections — run over the ordered array
 * =========================================================================*/

const RECONFIG_WINDOW_MS = 3000;

function ts(m: L3Row): number {
  return m.MsgTime ? new Date(m.MsgTime).getTime() : NaN;
}

/** True if any row after `i` (until deadlineMs) satisfies `pred`. */
function hasFollowUp(rows: L3Row[], i: number, pred: (m: L3Row) => boolean, deadlineMs: number): boolean {
  for (let j = i + 1; j < rows.length; j++) {
    if (ts(rows[j]) > deadlineMs) return false;
    if (pred(rows[j])) return true;
  }
  return false;
}

/** Heuristic: BYE is "early" if it appears before the mid-point of the call. */
function isEarlyBye(rows: L3Row[], i: number): boolean {
  if (rows.length < 4) return false;
  const start = ts(rows[0]);
  const end = ts(rows[rows.length - 1]);
  const half = start + (end - start) / 2;
  return ts(rows[i]) < half;
}

/**
 * Escalates rows that a single-row rule can't catch:
 *   - LTE RRCConnectionReconfiguration (DL) w/o ...Complete (UL) within 3s → red
 *   - GSM Handover Command (DL) w/o Handover Complete (UL) within 3s        → red
 *   - SIP BYE downlink arriving unusually early / with Reason header        → orange
 */
function applyCrossRowDetections(rows: L3Row[], base: HighlightResult[]): HighlightResult[] {
  const out = base.slice();

  for (let i = 0; i < rows.length; i++) {
    const m = rows[i];
    const name = (m.SimpleMsgName || m.MsgName || "").trim();
    const dir = (m.Direction || "").toUpperCase();

    // --- LTE: Reconfiguration without Complete ---
    if (/RRCConnectionReconfiguration$|RRCReconfiguration$/i.test(name) && dir === "D") {
      const found = hasFollowUp(
        rows,
        i,
        (x) => /Reconfiguration.*Complete/i.test(x.SimpleMsgName || x.MsgName || ""),
        ts(m) + RECONFIG_WINDOW_MS
      );
      if (!found) out[i] = { severity: "red", reason: "Reconfiguration without Complete (<3s) — HO failure" };
    }

    // --- GSM: Handover Command without Handover Complete ---
    if (/Handover Command/i.test(name) && dir === "D") {
      const found = hasFollowUp(
        rows,
        i,
        (x) => /Handover Complete/i.test(x.SimpleMsgName || x.MsgName || ""),
        ts(m) + RECONFIG_WINDOW_MS
      );
      if (!found) out[i] = { severity: "red", reason: "Handover Command without Complete (<3s) — HO failure" };
    }

    // --- SIP: network-initiated BYE ---
    if (/\bBYE\b/i.test(name) && dir === "D") {
      const early = isEarlyBye(rows, i);
      const hasReason = /Reason\s*:/i.test(m.Message || "");
      if (early || hasReason) {
        out[i] = {
          severity: "orange",
          reason: hasReason ? "Network-initiated BYE with Reason header" : "Early downlink BYE — network-initiated release",
        };
      }
    }
  }

  return out;
}

/* ===========================================================================
 * Public hook — classify the whole log once
 * =========================================================================*/

export function useSignallingHighlights(rows: L3Row[]): HighlightResult[] {
  return useMemo(() => {
    if (!rows?.length) return [];
    const base = rows.map(classifyRow);
    return applyCrossRowDetections(rows, base);
  }, [rows]);
}

/* ===========================================================================
 * Presentation helpers — Tailwind classes matching the rest of CallDetail's table
 * =========================================================================*/

export const SEV_ROW_CLASS: Record<Severity, string> = {
  red: "border-l-2 border-destructive bg-destructive/5",
  orange: "border-l-2 border-warning bg-warning/5",
  yellow: "border-l-2 border-amber-400",
  green: "border-l-2 border-success bg-success/5",
  none: "border-l-2 border-transparent",
};

export const SEV_BADGE_CLASS: Record<Severity, string> = {
  red: "text-destructive",
  orange: "text-warning",
  yellow: "text-amber-500",
  green: "text-success",
  none: "text-transparent",
};

export const SEV_LABEL: Record<Severity, string> = {
  red: "DROP/FAIL",
  orange: "ABNORMAL",
  yellow: "",
  green: "OK",
  none: "",
};
