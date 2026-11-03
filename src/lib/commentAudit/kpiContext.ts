/**
 * KPIs πλαισίου για το export: ράδιο στο τέλος της κλήσης, uplink (ισχύς εκπομπής / TA),
 * κυψέλη και θέση, ήχος και μετρήσεις σηματοδοσίας.
 * Όλα βγαίνουν από δεδομένα που ήδη φέρνει το audit (call_analysis, ράδιο, λίστα κλήσεων).
 */
import type { AllCallsRow } from "@/lib/api";
import type { KpiColumn, KpiValue } from "./kpiExport";
import { inCall, sinrOf } from "./radioEvidence";
import type { AnalysisSide, CallEvidenceBundle, GsmSample, LteSample } from "./types";

/** Παράθυρο «τέλους κλήσης» για το ράδιο: τα τελευταία τόσα δευτερόλεπτα δειγμάτων. */
export const END_WINDOW_SEC = 10;
/** Χωρίς χρόνους δειγμάτων: τα τελευταία τόσα δείγματα. */
const END_WINDOW_FALLBACK_SAMPLES = 5;

export const CONTEXT_RADIO_COLUMNS: readonly KpiColumn[] = (["a_", "b_"] as const).flatMap((p): KpiColumn[] => [
  { name: `${p}rsrp_last10s_avg`, sql: "FLOAT", description: `${p} πλευρά: μέσο RSRP στα τελευταία ${END_WINDOW_SEC} s της κλήσης (dBm)` },
  { name: `${p}sinr_last10s_avg`, sql: "FLOAT", description: `${p} πλευρά: μέσο SINR στα τελευταία ${END_WINDOW_SEC} s (dB)` },
  { name: `${p}rxlev_last10s_avg`, sql: "FLOAT", description: `${p} πλευρά: μέσο RxLev Sub στα τελευταία ${END_WINDOW_SEC} s (dBm)` },
]);

export const CONTEXT_COLUMNS: readonly KpiColumn[] = [
  { name: "a_ms_tx_pwr_avg", sql: "FLOAT", description: "A: μέση ισχύς εκπομπής κινητού GSM (dBm) — υψηλή = πρόβλημα uplink" },
  { name: "b_ms_tx_pwr_avg", sql: "FLOAT", description: "B: μέση ισχύς εκπομπής κινητού GSM (dBm)" },
  { name: "a_pusch_tx_pwr_avg", sql: "FLOAT", description: "A: μέση ισχύς PUSCH (LTE uplink, dBm)" },
  { name: "b_pusch_tx_pwr_avg", sql: "FLOAT", description: "B: μέση ισχύς PUSCH (LTE uplink, dBm)" },
  { name: "a_ta_avg", sql: "FLOAT", description: "A: μέσο Timing Advance (GSM, απόσταση από τον σταθμό)" },
  { name: "b_ta_avg", sql: "FLOAT", description: "B: μέσο Timing Advance (GSM)" },
  { name: "a_last_pci", sql: "INT", description: "A: PCI της serving LTE κυψέλης στο τελευταίο δείγμα της κλήσης" },
  { name: "a_last_earfcn", sql: "INT", description: "A: EARFCN στο τελευταίο δείγμα LTE της κλήσης" },
  { name: "band", sql: "NVARCHAR(100)", description: "band στο τέλος της κλήσης (A)" },
  { name: "end_technology", sql: "NVARCHAR(100)", description: "τεχνολογία στο τέλος της κλήσης (A)" },
  { name: "latitude", sql: "FLOAT", description: "γεωγραφικό πλάτος της κλήσης" },
  { name: "longitude", sql: "FLOAT", description: "γεωγραφικό μήκος της κλήσης" },
  { name: "call_start_time", sql: "NVARCHAR(100)", description: "έναρξη κλήσης (ISO 8601)" },
  { name: "mos_dl_avg", sql: "FLOAT", description: "μέσο MOS downlink" },
  { name: "mos_ul_avg", sql: "FLOAT", description: "μέσο MOS uplink" },
  { name: "num_silence_samples", sql: "INT", description: "δείγματα σιωπής (POLQA)" },
  { name: "bad_quality_call", sql: "BIT", description: "κλήση κακής ποιότητας ήχου" },
  { name: "num_lte_rrc_conn_rel", sql: "INT", description: "RRC Connection Release LTE (A+B)" },
  { name: "num_tau", sql: "INT", description: "Tracking Area Updates (A+B)" },
  { name: "num_epsfb", sql: "INT", description: "EPS fallback (A+B)" },
];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const avgOf = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const sumOf = (...vs: unknown[]) => {
  const nums = vs.map(num).filter(isNum);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
};

/** Δείγματα της κλήσης στα τελευταία END_WINDOW_SEC (με MsgTime), αλλιώς τα τελευταία 5. */
export function lastWindow<T extends { MsgTime?: string | null; phase?: string | null }>(rows: readonly T[]): readonly T[] {
  const s = inCall(rows);
  const times = s.map((r) => Date.parse(String(r.MsgTime ?? "")));
  if (!s.length || times.some(Number.isNaN)) return s.slice(-END_WINDOW_FALLBACK_SAMPLES);
  const end = Math.max(...times);
  return s.filter((_, i) => times[i] >= end - END_WINDOW_SEC * 1000);
}

const endAvg = <T extends { MsgTime?: string | null; phase?: string | null }>(rows: readonly T[], value: (r: T) => number | null | undefined) =>
  round(avgOf(lastWindow(rows).map(value).filter(isNum)));

function endRadio(p: string, lte: readonly LteSample[], gsm: readonly GsmSample[]): Record<string, KpiValue> {
  return {
    [`${p}rsrp_last10s_avg`]: endAvg(lte, (r) => r.RSRP),
    [`${p}sinr_last10s_avg`]: endAvg(lte, sinrOf),
    [`${p}rxlev_last10s_avg`]: endAvg(gsm, (r) => r.RxLevSub),
  };
}

/** Μέση τιμή του call_analysis· 0 σημαίνει «δεν μετρήθηκε» για ισχύ/TA. */
const measured = (a: AnalysisSide | null, key: string) => {
  const v = num(a?.[key]);
  return v == null || v === 0 ? null : round(v);
};

export function contextKpis(bundle: CallEvidenceBundle, row: AllCallsRow): Record<string, KpiValue> {
  const a = bundle.analysisA;
  const b = bundle.analysisB;
  const lastLte = inCall(bundle.lteA).at(-1);
  return {
    ...endRadio("a_", bundle.lteA, bundle.gsmA),
    ...endRadio("b_", bundle.lteB, bundle.gsmB),
    a_ms_tx_pwr_avg: measured(a, "avgMsTxPwr"),
    b_ms_tx_pwr_avg: measured(b, "avgMsTxPwr"),
    a_pusch_tx_pwr_avg: measured(a, "avgPuschTxPower"),
    b_pusch_tx_pwr_avg: measured(b, "avgPuschTxPower"),
    a_ta_avg: round(num(a?.avgTA)),
    b_ta_avg: round(num(b?.avgTA)),
    a_last_pci: num(lastLte?.PhyCellId),
    a_last_earfcn: num(lastLte?.EARFCN),
    band: a?.band != null ? String(a.band) : null,
    end_technology: a?.EndTechnology != null ? String(a.EndTechnology) : null,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    call_start_time: row.callStartTimeStamp ?? null,
    mos_dl_avg: round(num(row.mosDlAvg)),
    mos_ul_avg: round(num(row.mosUlAvg)),
    num_silence_samples: num(row.numSilenceSample),
    bad_quality_call: num(row.badQualityCall) ? 1 : 0,
    num_lte_rrc_conn_rel: sumOf(a?.num4GRRCConnRel, b?.num4GRRCConnRel),
    num_tau: sumOf(a?.numTrackingAreaUpdate, b?.numTrackingAreaUpdate),
    num_epsfb: sumOf(a?.numEPSFB, b?.numEPSFB),
  };
}
