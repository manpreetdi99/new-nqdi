/** Ράδιο A/B κατά την κλήση: συνεχόμενα κακά δείγματα LTE/GSM και "καλό ράδιο". */
import type { CallSide } from "./labels";
import { RADIO_THRESHOLDS, clamp01, isNum, sideName, type EvidenceFact, type GsmSample, type LteSample } from "./types";

interface Run {
  length: number;
  worst: number | null;
}

export function longestRun<T>(rows: readonly T[], value: (r: T) => number | null, isBad: (v: number, r: T) => boolean, worseIsLower = true): Run {
  let best: Run = { length: 0, worst: null };
  let cur: Run = { length: 0, worst: null };
  for (const r of rows) {
    const v = value(r);
    if (v == null || !isBad(v, r)) {
      cur = { length: 0, worst: null };
      continue;
    }
    const worst = cur.worst == null ? v : worseIsLower ? Math.min(cur.worst, v) : Math.max(cur.worst, v);
    cur = { length: cur.length + 1, worst };
    if (cur.length > best.length) best = cur;
  }
  return best;
}

const runStrength = (run: Run) => clamp01(run.length / RADIO_THRESHOLDS.fullRun);

/** Δείγματα κατά την κλήση· αν δεν υπάρχουν, ό,τι υπάρχει μετά την έναρξη (όχι 'before'). */
function inCall<T extends { phase?: string | null }>(rows: readonly T[]): readonly T[] {
  const during = rows.filter((r) => r.phase === "during");
  return during.length ? during : rows.filter((r) => r.phase !== "before");
}

function sinrOf(r: LteSample): number | null {
  const vals = [r.SINR, r.SINR0, r.SINR1].filter(isNum);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

const minOf = (vals: readonly (number | null | undefined)[]) => {
  const nums = vals.filter(isNum);
  return nums.length ? Math.min(...nums) : null;
};

interface SideRadio {
  side: CallSide;
  lteCount: number;
  gsmCount: number;
  rsrpRun: Run;
  /** Στα δείγματα με χαμηλό RSRP είναι κακό και το RSRQ ή το SINR. */
  rsrpCorroborated: boolean;
  qualityRun: Run;
  rxLevRun: Run;
  rxQualRun: Run;
  minRsrp: number | null;
  minRxLev: number | null;
}

function sideRadio(side: CallSide, lteRows: readonly LteSample[], gsmRows: readonly GsmSample[]): SideRadio {
  const T = RADIO_THRESHOLDS;
  const lte = inCall(lteRows);
  const gsm = inCall(gsmRows);
  const lowRsrp = (r: LteSample) => isNum(r.RSRP) && r.RSRP <= T.lteRsrpLow;
  const badQuality = (r: LteSample) => (isNum(r.RSRQ) && r.RSRQ <= T.lteRsrqLow) || (sinrOf(r) ?? Infinity) < T.lteSinrNegative;
  return {
    side,
    lteCount: lte.length,
    gsmCount: gsm.length,
    rsrpRun: longestRun(lte, (r) => (isNum(r.RSRP) ? r.RSRP : null), (v) => v <= T.lteRsrpLow),
    rsrpCorroborated: lte.some((r) => lowRsrp(r) && badQuality(r)),
    // Κακή ποιότητα με αποδεκτή στάθμη: αλλιώς είναι κάλυψη, όχι ποιότητα.
    qualityRun: longestRun(
      lte,
      (r) => (isNum(r.RSRQ) ? r.RSRQ : sinrOf(r)),
      (_v, r) => (!isNum(r.RSRP) || r.RSRP > T.lteRsrpLow) && ((isNum(r.RSRQ) && r.RSRQ <= T.lteRsrqLow) || (sinrOf(r) ?? 0) <= T.lteSinrLow),
    ),
    rxLevRun: longestRun(gsm, (r) => (isNum(r.RxLevSub) ? r.RxLevSub : null), (v) => v <= T.gsmRxLevLow),
    rxQualRun: longestRun(
      gsm,
      (r) => (isNum(r.RxQualSub) ? r.RxQualSub : null),
      (v, r) => v >= T.gsmRxQualHigh && (!isNum(r.RxLevSub) || r.RxLevSub > T.gsmRxLevLow),
      false,
    ),
    minRsrp: minOf(lte.map((r) => r.RSRP)),
    minRxLev: minOf(gsm.map((r) => r.RxLevSub)),
  };
}

function strongest(sides: readonly SideRadio[], pick: (s: SideRadio) => Run): SideRadio | null {
  const best = [...sides].sort((a, b) => pick(b).length - pick(a).length)[0];
  return best && pick(best).length > 0 ? best : null;
}

export function radioEvidence(lteA: readonly LteSample[], gsmA: readonly GsmSample[], lteB: readonly LteSample[], gsmB: readonly GsmSample[]) {
  const T = RADIO_THRESHOLDS;
  const sides = [sideRadio("A", lteA, gsmA), sideRadio("B", lteB, gsmB)];
  const facts: EvidenceFact[] = [];
  const rsrp = strongest(sides, (s) => s.rsrpRun);
  const quality = strongest(sides, (s) => s.qualityRun);
  const rxLev = strongest(sides, (s) => s.rxLevRun);
  const rxQual = strongest(sides, (s) => s.rxQualRun);

  if (rsrp) {
    const extra = rsrp.rsrpCorroborated ? " μαζί με κακό RSRQ/SINR" : ", ενώ RSRQ/SINR αποδεκτά";
    facts.push({ feature: "lteLowRsrp", side: rsrp.side, text: `${rsrp.rsrpRun.length} συνεχόμενα δείγματα RSRP ≤ ${T.lteRsrpLow} dBm (χειρότερο ${rsrp.rsrpRun.worst} dBm)${extra} στην ${sideName(rsrp.side)}` });
  }
  if (quality) facts.push({ feature: "lteLowQuality", side: quality.side, text: `${quality.qualityRun.length} συνεχόμενα δείγματα RSRQ ≤ ${T.lteRsrqLow} dB ή SINR ≤ ${T.lteSinrLow} dB με αποδεκτό RSRP στην ${sideName(quality.side)}` });
  if (rxLev) facts.push({ feature: "gsmLowRxLev", side: rxLev.side, text: `${rxLev.rxLevRun.length} συνεχόμενα δείγματα RxLev Sub ≤ ${T.gsmRxLevLow} dBm (χειρότερο ${rxLev.rxLevRun.worst} dBm) στην ${sideName(rxLev.side)}` });
  if (rxQual) facts.push({ feature: "gsmHighRxQual", side: rxQual.side, text: `${rxQual.rxQualRun.length} συνεχόμενα δείγματα RxQual Sub ≥ ${T.gsmRxQualHigh} με αποδεκτό RxLev στην ${sideName(rxQual.side)}` });

  const samples = sides.reduce((n, s) => n + s.lteCount + s.gsmCount, 0);
  const anyLow = Boolean(rsrp || rxLev || quality || rxQual);
  const minRsrp = minOf(sides.map((s) => s.minRsrp));
  const minRxLev = minOf(sides.map((s) => s.minRxLev));
  const clearlyGood = (minRsrp == null || minRsrp > T.goodRsrp) && (minRxLev == null || minRxLev > T.goodRxLev);
  const radioGood = samples === 0 || anyLow ? 0 : clearlyGood ? 1 : 0.5;
  if (radioGood === 1) {
    const parts = [minRsrp != null ? `min RSRP ${minRsrp} dBm` : null, minRxLev != null ? `min RxLev ${minRxLev} dBm` : null].filter(Boolean);
    facts.push({ feature: "radioGood", side: null, text: `καλό ράδιο σε όλη την κλήση${parts.length ? ` (${parts.join(", ")})` : ""}` });
  }
  if (samples === 0) facts.push({ feature: "noRadio", side: null, text: "κανένα δείγμα LTE/GSM κατά την κλήση σε καμία πλευρά" });

  const worst = [...sides].sort((a, b) => Math.max(b.rsrpRun.length, b.rxLevRun.length) - Math.max(a.rsrpRun.length, a.rxLevRun.length))[0];
  const rsrpWeight = rsrp && !rsrp.rsrpCorroborated ? T.uncorroboratedLteWeight : 1;
  return {
    values: {
      lteLowRsrp: rsrp ? runStrength(rsrp.rsrpRun) * rsrpWeight : 0,
      lteLowQuality: quality ? runStrength(quality.qualityRun) : 0,
      gsmLowRxLev: rxLev ? runStrength(rxLev.rxLevRun) : 0,
      gsmHighRxQual: rxQual ? runStrength(rxQual.rxQualRun) : 0,
      radioGood,
      noRadio: samples === 0 ? 1 : 0,
    },
    facts,
    worstRadioSide: worst && Math.max(worst.rsrpRun.length, worst.rxLevRun.length) > 0 ? worst.side : null,
  };
}
