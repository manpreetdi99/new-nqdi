/**
 * KPIs ανά κλήση (audit-kpis-historic.csv): μία γραμμή ανά drop/fail κλήση, με τις μετρήσεις
 * (από αυτές εκπαιδεύεται το Historic) και τα αποτελέσματα Standard / Historic,
 * σταθερό σχήμα (όνομα, τύπος SQL, περιγραφή) ώστε το CSV να φορτώνεται σε πίνακα SQL Server.
 *
 * Τα δείγματα ράδιο είναι τα ίδια που βλέπει το audit (μόνο κατά την κλήση, βλ. inCall)·
 * τα f_* είναι ακριβώς τα χαρακτηριστικά από τα οποία βγαίνει η περίληψη του Standard.
 */
import type { AllCallsRow } from "@/lib/api";
import { sipErrorCodes } from "../mdClassifier/classify";
import { FEATURE_KEYS, type CallEvidence, type CallEvidenceBundle, type GsmSample, type LteSample } from "./evidence";
import { LABEL_TITLES, type AuditLabel, type ParsedComment } from "./labels";
import { formatMix, narrativeText, type Narrative } from "./narrative";
import { DEFAULT_HISTORIC_WEIGHT, blendMix, formatBlend } from "./blend";
import { CONTEXT_COLUMNS, CONTEXT_RADIO_COLUMNS, contextKpis } from "./kpiContext";
import { labelMatches } from "./profiles";
import { inCall, longestRun, sinrOf } from "./radioEvidence";
import type { ScannerBundle } from "./scannerBundle";
import type { AuditScore } from "./scoring";

export type SqlType = "NVARCHAR(100)" | "NVARCHAR(400)" | "NVARCHAR(MAX)" | "BIGINT" | "INT" | "FLOAT" | "BIT";
export interface KpiColumn {
  name: string;
  sql: SqlType;
  description: string;
}
export type KpiValue = string | number | boolean | null;
export type KpiRow = Readonly<Record<string, KpiValue>>;

/** Όρια των KPI ράδιο (ζήτηση χρήστη: −115 / −120 για RSRP· GSM RxLev Sub −93 / −100 / −105). */
export const KPI_THRESHOLDS = {
  rsrp: [-115, -120],
  rsrq: -15,
  sinrNegative: 0,
  sinrLow: -3,
  rxLev: [-93, -100, -105],
  rxQual: 5,
  /** GSM C/I (CoverI) κάτω από αυτό = παρεμβολή. */
  gsmCi: 9,
  /** Scanner GSM: η καλύτερη κυψέλη είναι πάντα πολύ ισχυρότερη από το κινητό (−26…−80 dBm), γι' αυτό υψηλότερα όρια. */
  scanGsmRxLev: [-80, -85, -90],
} as const;

const abs = (n: number) => String(Math.abs(n));
const LTE_COLUMNS = (p: string): KpiColumn[] => [
  { name: `${p}lte_samples`, sql: "INT", description: `${p} πλευρά: δείγματα LTE κατά την κλήση` },
  { name: `${p}rsrp_min`, sql: "FLOAT", description: "ελάχιστο RSRP (dBm)" },
  { name: `${p}rsrp_avg`, sql: "FLOAT", description: "μέσο RSRP (dBm)" },
  ...KPI_THRESHOLDS.rsrp.flatMap((t): KpiColumn[] => [
    { name: `${p}rsrp_max_consec_le_${abs(t)}`, sql: "INT", description: `μέγιστα συνεχόμενα δείγματα RSRP ≤ ${t} dBm` },
    { name: `${p}rsrp_pct_le_${abs(t)}`, sql: "FLOAT", description: `% δειγμάτων RSRP ≤ ${t} dBm` },
  ]),
  { name: `${p}rsrq_min`, sql: "FLOAT", description: "ελάχιστο RSRQ (dB)" },
  { name: `${p}rsrq_avg`, sql: "FLOAT", description: "μέσο RSRQ (dB)" },
  { name: `${p}rsrq_max_consec_le_15`, sql: "INT", description: `μέγιστα συνεχόμενα δείγματα RSRQ ≤ ${KPI_THRESHOLDS.rsrq} dB` },
  { name: `${p}rsrq_pct_le_15`, sql: "FLOAT", description: `% δειγμάτων RSRQ ≤ ${KPI_THRESHOLDS.rsrq} dB` },
  { name: `${p}sinr_min`, sql: "FLOAT", description: "ελάχιστο SINR (dB, μέσος όρος κεραιών)" },
  { name: `${p}sinr_avg`, sql: "FLOAT", description: "μέσο SINR (dB)" },
  { name: `${p}sinr_pct_lt_0`, sql: "FLOAT", description: "% δειγμάτων SINR < 0 dB" },
  { name: `${p}sinr_pct_le_3neg`, sql: "FLOAT", description: `% δειγμάτων SINR ≤ ${KPI_THRESHOLDS.sinrLow} dB` },
];
const GSM_COLUMNS = (p: string): KpiColumn[] => [
  { name: `${p}gsm_samples`, sql: "INT", description: `${p} πλευρά: δείγματα GSM κατά την κλήση` },
  { name: `${p}rxlev_min`, sql: "FLOAT", description: "ελάχιστο RxLev Sub (dBm)" },
  { name: `${p}rxlev_avg`, sql: "FLOAT", description: "μέσο RxLev Sub (dBm)" },
  ...KPI_THRESHOLDS.rxLev.flatMap((t): KpiColumn[] => [
    { name: `${p}rxlev_max_consec_le_${abs(t)}`, sql: "INT", description: `μέγιστα συνεχόμενα δείγματα RxLev Sub ≤ ${t} dBm` },
    { name: `${p}rxlev_pct_le_${abs(t)}`, sql: "FLOAT", description: `% δειγμάτων RxLev Sub ≤ ${t} dBm` },
  ]),
  { name: `${p}rxqual_max`, sql: "FLOAT", description: "μέγιστο RxQual Sub" },
  { name: `${p}rxqual_avg`, sql: "FLOAT", description: "μέσο RxQual Sub" },
  { name: `${p}rxqual_max_consec_ge_5`, sql: "INT", description: `μέγιστα συνεχόμενα δείγματα RxQual Sub ≥ ${KPI_THRESHOLDS.rxQual}` },
  { name: `${p}rxqual_pct_ge_5`, sql: "FLOAT", description: `% δειγμάτων RxQual Sub ≥ ${KPI_THRESHOLDS.rxQual}` },
];

export const KPI_COLUMNS: readonly KpiColumn[] = [
  { name: "database_name", sql: "NVARCHAR(100)", description: "βάση μέτρησης" },
  { name: "session_id", sql: "BIGINT", description: "SessionId (A-side)" },
  { name: "collection", sql: "NVARCHAR(400)", description: "CollectionName" },
  { name: "a_side_location", sql: "NVARCHAR(400)", description: "ASideLocation" },
  { name: "call_status", sql: "NVARCHAR(100)", description: "Dropped / Failed" },
  { name: "technology", sql: "NVARCHAR(100)", description: "GSM / LTE / GSM/LTE" },
  { name: "call_dir", sql: "NVARCHAR(100)", description: "A->B / B->A" },
  { name: "call_duration_s", sql: "FLOAT", description: "διάρκεια κλήσης (s, call_analysis)" },
  { name: "configured_duration_s", sql: "FLOAT", description: "ρυθμισμένη διάρκεια (tracelog «Start call duration»)" },
  { name: "duration_ratio", sql: "FLOAT", description: "διάρκεια ÷ ρυθμισμένη διάρκεια" },
  { name: "setup_time_s", sql: "FLOAT", description: "χρόνος εγκατάστασης (s)" },
  ...LTE_COLUMNS("a_"),
  ...LTE_COLUMNS("b_"),
  ...GSM_COLUMNS("a_"),
  ...GSM_COLUMNS("b_"),
  ...CONTEXT_RADIO_COLUMNS,
  { name: "scan_has_data", sql: "BIT", description: "υπάρχουν δεδομένα scanner για την κλήση" },
  { name: "scan_lte_samples", sql: "INT", description: "scanner: δείγματα καλύτερης LTE κυψέλης του operator κατά την κλήση" },
  { name: "scan_lte_rsrp_min", sql: "FLOAT", description: "scanner: ελάχιστο RSRP της καλύτερης LTE κυψέλης (dBm)" },
  { name: "scan_lte_rsrp_avg", sql: "FLOAT", description: "scanner: μέσο RSRP της καλύτερης LTE κυψέλης (dBm)" },
  ...KPI_THRESHOLDS.rsrp.map((t): KpiColumn => ({ name: `scan_lte_rsrp_pct_le_${abs(t)}`, sql: "FLOAT", description: `scanner: % δειγμάτων best RSRP ≤ ${t} dBm` })),
  { name: "scan_lte_rsrq_avg", sql: "FLOAT", description: "scanner: μέσο RSRQ της καλύτερης LTE κυψέλης (dB)" },
  { name: "scan_lte_rsrq_pct_le_15", sql: "FLOAT", description: `scanner: % δειγμάτων best RSRQ ≤ ${KPI_THRESHOLDS.rsrq} dB` },
  { name: "scan_lte_best_cell_changes", sql: "INT", description: "scanner: πόσες φορές άλλαξε η καλύτερη LTE κυψέλη (PCI)" },
  { name: "scan_gsm_samples", sql: "INT", description: "scanner: δείγματα καλύτερης GSM κυψέλης" },
  { name: "scan_gsm_rxlev_min", sql: "FLOAT", description: "scanner: ελάχιστο RxLev καλύτερης GSM κυψέλης (dBm)" },
  { name: "scan_gsm_rxlev_avg", sql: "FLOAT", description: "scanner: μέσο RxLev καλύτερης GSM κυψέλης (dBm)" },
  ...KPI_THRESHOLDS.scanGsmRxLev.flatMap((t): KpiColumn[] => [
    { name: `scan_gsm_rxlev_max_consec_le_${abs(t)}`, sql: "INT", description: `scanner: μέγιστα συνεχόμενα δείγματα best RxLev ≤ ${t} dBm` },
    { name: `scan_gsm_rxlev_pct_le_${abs(t)}`, sql: "FLOAT", description: `scanner: % δειγμάτων best RxLev ≤ ${t} dBm` },
  ]),
  { name: "scan_gsm_ci_min", sql: "FLOAT", description: "scanner: ελάχιστο C/I (dB)" },
  { name: "scan_gsm_ci_avg", sql: "FLOAT", description: "scanner: μέσο C/I (dB)" },
  { name: "scan_gsm_ci_pct_lt_9", sql: "FLOAT", description: `scanner: % δειγμάτων C/I < ${KPI_THRESHOLDS.gsmCi} dB (παρεμβολή)` },
  { name: "scan_nr_samples", sql: "INT", description: "scanner: δείγματα καλύτερης NR κυψέλης" },
  { name: "scan_nr_rsrp_min", sql: "FLOAT", description: "scanner: ελάχιστο SS-RSRP καλύτερης NR κυψέλης (dBm)" },
  { name: "scan_nr_rsrp_avg", sql: "FLOAT", description: "scanner: μέσο SS-RSRP καλύτερης NR κυψέλης (dBm)" },
  { name: "scan_nr_rsrp_pct_le_115", sql: "FLOAT", description: "scanner: % δειγμάτων NR SS-RSRP ≤ −115 dBm" },
  { name: "scan_nr_rsrq_avg", sql: "FLOAT", description: "scanner: μέσο SS-RSRQ (dB)" },
  { name: "scan_missed_ho_hint", sql: "BIT", description: "ο scanner είδε ισχυρότερη LTE κυψέλη από τη serving (πιθανό missed/late HO)" },
  { name: "scan_missed_ho_delta_db", sql: "FLOAT", description: "πόσα dB ισχυρότερη ήταν η κυψέλη του scanner" },
  { name: "a_ue_minus_scan_rsrp_avg", sql: "FLOAT", description: "A: μέσο RSRP κινητού − μέσο best RSRP scanner (αρνητικό = χειρότερο από τη διαθέσιμη κάλυψη)" },
  { name: "b_ue_minus_scan_rsrp_avg", sql: "FLOAT", description: "B: μέσο RSRP κινητού − μέσο best RSRP scanner" },
  { name: "a_ue_minus_scan_rxlev_avg", sql: "FLOAT", description: "A: μέσο RxLev κινητού − μέσο best RxLev scanner" },
  { name: "b_ue_minus_scan_rxlev_avg", sql: "FLOAT", description: "B: μέσο RxLev κινητού − μέσο best RxLev scanner" },
  ...CONTEXT_COLUMNS,
  { name: "native_code", sql: "NVARCHAR(100)", description: "κωδικός native classifier (π.χ. C2.112)" },
  { name: "native_group", sql: "NVARCHAR(100)", description: "DescriptionGroup του native" },
  { name: "native_description", sql: "NVARCHAR(400)", description: "περιγραφή native (A)" },
  { name: "disconnect_cause", sql: "NVARCHAR(400)", description: "αιτία αποσύνδεσης (A)" },
  { name: "last_ho_type", sql: "NVARCHAR(100)", description: "τελευταίο handover (HO_CMPL / HO_FAIL …)" },
  { name: "num_lte_reestablishment", sql: "INT", description: "RRC re-establishments (A+B)" },
  { name: "sip_bye_reason", sql: "NVARCHAR(400)", description: "Reason του SIP BYE (A ή B)" },
  { name: "sip_bye_direction", sql: "NVARCHAR(100)", description: "U = από το UE, D = από το δίκτυο" },
  { name: "sip_cancel_direction", sql: "NVARCHAR(100)", description: "κατεύθυνση SIP CANCEL" },
  { name: "sip_error_codes", sql: "NVARCHAR(100)", description: "κωδικοί «IMS SIP INVITE Error» (λίστα με ;)" },
  { name: "sip_5xx_code", sql: "INT", description: "πρώτος κωδικός 5xx, αλλιώς κενό" },
  { name: "sip_user_code", sql: "INT", description: "486/603/604/404 αν υπάρχει" },
  { name: "is_fake_eof", sql: "BIT", description: "ρητό σημάδι διακοπής μέτρησης στο tracelog" },
  { name: "is_last_call_of_file", sql: "BIT", description: "τελευταία κλήση του αρχείου μέτρησης" },
  ...FEATURE_KEYS.map((k): KpiColumn => ({ name: `f_${k}`, sql: "FLOAT", description: `χαρακτηριστικό audit «${k}» (0–1)` })),
  { name: "user_comment", sql: "NVARCHAR(400)", description: "σχόλιο χρήστη (ετικέτα εκπαίδευσης)" },
  { name: "user_label", sql: "NVARCHAR(100)", description: "κανονικοποιημένη ετικέτα του σχολίου" },
  { name: "is_valid", sql: "INT", description: "Sessions.Valid" },
  { name: "standard_label", sql: "NVARCHAR(100)", description: "Standard (pptx): αιτία κατά τα δεδομένα" },
  { name: "standard_verdict", sql: "NVARCHAR(100)", description: "Standard: correct / partial / wrong / …" },
  { name: "standard_grade", sql: "INT", description: "Standard: βαθμός 0–100" },
  { name: "standard_hybrid", sql: "FLOAT", description: "Standard: hybrid σκορ της ετικέτας του χρήστη" },
  { name: "standard_mix", sql: "NVARCHAR(400)", description: "Standard: κατανομή αιτιών σε ποσοστά (π.χ. 50% LC LTE · 50% FAKE UE STUCK (UL DISCONNECT))" },
  { name: "standard_top_pct", sql: "INT", description: "Standard: ποσοστό της πιο πιθανής αιτίας" },
  { name: "standard_second_label", sql: "NVARCHAR(100)", description: "Standard: δεύτερη πιο πιθανή αιτία" },
  { name: "standard_second_pct", sql: "INT", description: "Standard: ποσοστό της δεύτερης αιτίας" },
  { name: "standard_user_pct", sql: "INT", description: "Standard: ποσοστό της αιτίας του σχολίου μέσα στην κατανομή (0 αν δεν μπαίνει)" },
  { name: "historic_label", sql: "NVARCHAR(100)", description: "Historic (μοντέλο από το CSV): πιο πιθανή αιτία" },
  { name: "historic_verdict", sql: "NVARCHAR(100)", description: "Historic: ετυμηγορία για το σχόλιο" },
  { name: "historic_grade", sql: "INT", description: "Historic: βαθμός 0–100" },
  { name: "historic_mix", sql: "NVARCHAR(400)", description: "Historic: κατανομή αιτιών σε ποσοστά" },
  { name: "historic_top_pct", sql: "INT", description: "Historic: ποσοστό της πιο πιθανής αιτίας" },
  { name: "blend_label", sql: "NVARCHAR(100)", description: "«Κατά τα δεδομένα»: πιο πιθανή αιτία του μείγματος Historic/Standard" },
  { name: "blend_mix", sql: "NVARCHAR(400)", description: "«Κατά τα δεδομένα»: βάρος × % Historic + βάρος × % Standard ανά αιτία" },
  { name: "blend_historic_weight", sql: "INT", description: "βάρος του Historic στη μπάρα (%), το Standard παίρνει το υπόλοιπο" },
  { name: "final_label", sql: "NVARCHAR(100)", description: "τελική αιτία: η επιλογή του χρήστη στα μερικώς/λάθος αν υπάρχει, αλλιώς η πρώτη αιτία του «Κατά τα δεδομένα» (blend_label)" },
  { name: "final_label_source", sql: "NVARCHAR(100)", description: "manual = επιλογή χρήστη, auto = «Κατά τα δεδομένα»" },
  { name: "standard_summary", sql: "NVARCHAR(MAX)", description: "περίληψη του Standard (κάθε εύρημα με την πηγή του)" },
  { name: "historic_summary", sql: "NVARCHAR(MAX)", description: "περίληψη του Historic" },
];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const minOf = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const maxOf = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pctOf = (xs: number[], test: (v: number) => boolean) => (xs.length ? (100 * xs.filter(test).length) / xs.length : null);
const consec = (xs: number[], test: (v: number) => boolean) => longestRun(xs, (v) => v, test).length;
const text = (v: unknown) => (v == null ? "" : String(v));

function lteKpis(p: string, rows: readonly LteSample[]): Record<string, KpiValue> {
  const s = inCall(rows);
  const rsrp = s.map((r) => r.RSRP).filter(isNum);
  const rsrq = s.map((r) => r.RSRQ).filter(isNum);
  const sinr = s.map(sinrOf).filter(isNum);
  const out: Record<string, KpiValue> = {
    [`${p}lte_samples`]: s.length,
    [`${p}rsrp_min`]: round(minOf(rsrp)),
    [`${p}rsrp_avg`]: round(avgOf(rsrp)),
    [`${p}rsrq_min`]: round(minOf(rsrq)),
    [`${p}rsrq_avg`]: round(avgOf(rsrq)),
    [`${p}rsrq_max_consec_le_15`]: consec(rsrq, (v) => v <= KPI_THRESHOLDS.rsrq),
    [`${p}rsrq_pct_le_15`]: round(pctOf(rsrq, (v) => v <= KPI_THRESHOLDS.rsrq), 1),
    [`${p}sinr_min`]: round(minOf(sinr)),
    [`${p}sinr_avg`]: round(avgOf(sinr)),
    [`${p}sinr_pct_lt_0`]: round(pctOf(sinr, (v) => v < KPI_THRESHOLDS.sinrNegative), 1),
    [`${p}sinr_pct_le_3neg`]: round(pctOf(sinr, (v) => v <= KPI_THRESHOLDS.sinrLow), 1),
  };
  for (const t of KPI_THRESHOLDS.rsrp) {
    out[`${p}rsrp_max_consec_le_${abs(t)}`] = consec(rsrp, (v) => v <= t);
    out[`${p}rsrp_pct_le_${abs(t)}`] = round(pctOf(rsrp, (v) => v <= t), 1);
  }
  return out;
}

function gsmKpis(p: string, rows: readonly GsmSample[]): Record<string, KpiValue> {
  const s = inCall(rows);
  const lev = s.map((r) => r.RxLevSub).filter(isNum);
  const qual = s.map((r) => r.RxQualSub).filter(isNum);
  const out: Record<string, KpiValue> = {
    [`${p}gsm_samples`]: s.length,
    [`${p}rxlev_min`]: round(minOf(lev)),
    [`${p}rxlev_avg`]: round(avgOf(lev)),
    [`${p}rxqual_max`]: round(maxOf(qual)),
    [`${p}rxqual_avg`]: round(avgOf(qual)),
    [`${p}rxqual_max_consec_ge_5`]: consec(qual, (v) => v >= KPI_THRESHOLDS.rxQual),
    [`${p}rxqual_pct_ge_5`]: round(pctOf(qual, (v) => v >= KPI_THRESHOLDS.rxQual), 1),
  };
  for (const t of KPI_THRESHOLDS.rxLev) {
    out[`${p}rxlev_max_consec_le_${abs(t)}`] = consec(lev, (v) => v <= t);
    out[`${p}rxlev_pct_le_${abs(t)}`] = round(pctOf(lev, (v) => v <= t), 1);
  }
  return out;
}

function scannerKpis(scan: ScannerBundle | null | undefined): Record<string, KpiValue> {
  const lteRsrp = (scan?.lteBest ?? []).map((r) => r.RSRP).filter(isNum);
  const lteRsrq = (scan?.lteBest ?? []).map((r) => r.RSRQ).filter(isNum);
  const pcis = (scan?.lteBest ?? []).map((r) => r.PCI).filter(isNum);
  const gsmLev = (scan?.gsmBest ?? []).map((r) => r.RxLev).filter(isNum);
  const gsmCi = (scan?.gsmBest ?? []).map((r) => r.CoverI).filter(isNum);
  const nrRsrp = (scan?.nrBest ?? []).map((r) => r.RSRP).filter(isNum);
  const nrRsrq = (scan?.nrBest ?? []).map((r) => r.RSRQ).filter(isNum);
  const hint = scan?.servingVsScanner?.missedHandoverHint ?? null;
  const out: Record<string, KpiValue> = {
    scan_has_data: lteRsrp.length + gsmLev.length + nrRsrp.length > 0 ? 1 : 0,
    scan_lte_samples: lteRsrp.length,
    scan_lte_rsrp_min: round(minOf(lteRsrp)),
    scan_lte_rsrp_avg: round(avgOf(lteRsrp)),
    scan_lte_rsrq_avg: round(avgOf(lteRsrq)),
    scan_lte_rsrq_pct_le_15: round(pctOf(lteRsrq, (v) => v <= KPI_THRESHOLDS.rsrq), 1),
    scan_lte_best_cell_changes: pcis.filter((p, i) => i > 0 && p !== pcis[i - 1]).length,
    scan_gsm_samples: gsmLev.length,
    scan_gsm_rxlev_min: round(minOf(gsmLev)),
    scan_gsm_rxlev_avg: round(avgOf(gsmLev)),
    scan_gsm_ci_min: round(minOf(gsmCi)),
    scan_gsm_ci_avg: round(avgOf(gsmCi)),
    scan_gsm_ci_pct_lt_9: round(pctOf(gsmCi, (v) => v < KPI_THRESHOLDS.gsmCi), 1),
    scan_nr_samples: nrRsrp.length,
    scan_nr_rsrp_min: round(minOf(nrRsrp)),
    scan_nr_rsrp_avg: round(avgOf(nrRsrp)),
    scan_nr_rsrp_pct_le_115: round(pctOf(nrRsrp, (v) => v <= -115), 1),
    scan_nr_rsrq_avg: round(avgOf(nrRsrq)),
    scan_missed_ho_hint: hint ? 1 : 0,
    scan_missed_ho_delta_db: isNum(hint?.deltaDb) ? round(hint.deltaDb as number) : null,
  };
  for (const t of KPI_THRESHOLDS.rsrp) {
    out[`scan_lte_rsrp_pct_le_${abs(t)}`] = round(pctOf(lteRsrp, (v) => v <= t), 1);
  }
  for (const t of KPI_THRESHOLDS.scanGsmRxLev) {
    out[`scan_gsm_rxlev_max_consec_le_${abs(t)}`] = consec(gsmLev, (v) => v <= t);
    out[`scan_gsm_rxlev_pct_le_${abs(t)}`] = round(pctOf(gsmLev, (v) => v <= t), 1);
  }
  return out;
}

/** Κινητό − scanner (dB): πόσο χειρότερο ήταν το κινητό από την καλύτερη διαθέσιμη κυψέλη. */
const diff = (ue: KpiValue, scan: KpiValue) => (isNum(ue) && isNum(scan) ? round(ue - scan) : null);

/** Πόσο % της κατανομής αντιστοιχεί στην ετικέτα του σχολίου (γενική ετικέτα = άθροισμα των υποκατηγοριών της). */
function userPct(userLabel: AuditLabel | null, score: AuditScore): number | null {
  if (!userLabel) return null;
  return score.mix.filter((m) => labelMatches(userLabel, m.label)).reduce((t, m) => t + m.pct, 0);
}

/** Τα δεδομένα μιας κλήσης, χωρίς αποτελέσματα μοντέλων. */
export interface MeasuredInput {
  database: string;
  row: AllCallsRow;
  bundle: CallEvidenceBundle;
  evidence: CallEvidence;
  comment: ParsedComment | null;
  /** Δεδομένα scanner (προαιρετικά· χωρίς αυτά οι στήλες scan_* μένουν κενές/0). */
  scanner?: ScannerBundle | null;
}

export interface KpiInput extends MeasuredInput {
  standard: { score: AuditScore; narrative: Narrative };
  /** Αποτέλεσμα του Historic, αν υπάρχει εκπαιδευμένο μοντέλο. */
  historic?: { score: AuditScore; narrative: Narrative } | null;
  /** Αιτία που διάλεξε ο χρήστης ότι υπερισχύει (μερικώς/λάθος), αλλιώς null. */
  override?: AuditLabel | null;
  /** Βάρος του Historic (0..1) στο «Κατά τα δεδομένα» (default 0.65). */
  historicWeight?: number;
}

/** Μετρήσεις μιας κλήσης (όλες οι στήλες εκτός των αποτελεσμάτων Standard / Historic). */
export function measuredKpis(input: MeasuredInput): Record<string, KpiValue> {
  const { bundle: b, evidence: ev, row, comment } = input;
  const a = b.analysisA;
  const bb = b.analysisB;
  const f = ev.features;
  const codes = sipErrorCodes(b.tracelog);
  const configured = Number(b.tracelog.map((t) => text(t.Info).match(/Start call duration \((\d+)s\)/i)?.[1]).find(Boolean) ?? NaN);
  const duration = Number(a?.CallDuration_s ?? NaN);
  const pick = (k: string) => text(a?.[k]) || text(bb?.[k]) || null;
  const bit = (v: number) => (v >= 1 ? 1 : 0);
  const lteA = lteKpis("a_", b.lteA);
  const lteB = lteKpis("b_", b.lteB);
  const gsmA = gsmKpis("a_", b.gsmA);
  const gsmB = gsmKpis("b_", b.gsmB);
  const scan = scannerKpis(input.scanner ?? b.scanner);
  return {
    database_name: input.database,
    session_id: String(row.SessionId),
    collection: row.CollectionName ?? null,
    a_side_location: row.Location ?? null,
    call_status: row.status ?? null,
    technology: text(a?.technology) || row.technology || null,
    call_dir: text(a?.callDir) || row.callDir || null,
    call_duration_s: Number.isFinite(duration) ? round(duration) : null,
    configured_duration_s: Number.isFinite(configured) ? configured : null,
    duration_ratio: Number.isFinite(duration) && Number.isFinite(configured) && configured > 0 ? round(duration / configured, 3) : null,
    setup_time_s: isNum(a?.SetupTime_s) ? round(a.SetupTime_s as number) : null,
    ...lteA,
    ...lteB,
    ...gsmA,
    ...gsmB,
    ...scan,
    a_ue_minus_scan_rsrp_avg: diff(lteA.a_rsrp_avg, scan.scan_lte_rsrp_avg),
    b_ue_minus_scan_rsrp_avg: diff(lteB.b_rsrp_avg, scan.scan_lte_rsrp_avg),
    a_ue_minus_scan_rxlev_avg: diff(gsmA.a_rxlev_avg, scan.scan_gsm_rxlev_avg),
    b_ue_minus_scan_rxlev_avg: diff(gsmB.b_rxlev_avg, scan.scan_gsm_rxlev_avg),
    ...contextKpis(b, row),
    native_code: pick("code"),
    native_group: pick("DescriptionGroup"),
    native_description: text(a?.Description).slice(0, 400) || null,
    disconnect_cause: pick("disconCause"),
    last_ho_type: pick("LastHoType"),
    num_lte_reestablishment: Number(a?.num4GReestablishment ?? 0) + Number(bb?.num4GReestablishment ?? 0),
    sip_bye_reason: pick("SIPBYEReason"),
    sip_bye_direction: pick("SIPBYEInitDirection"),
    sip_cancel_direction: pick("SIPCANCELInitDirection"),
    sip_error_codes: codes.length ? codes.join(";") : null,
    sip_5xx_code: codes.find((c) => c >= 500) ?? null,
    sip_user_code: codes.find((c) => [404, 486, 603, 604].includes(c)) ?? null,
    is_fake_eof: bit(f.fakeEof),
    is_last_call_of_file: b.isLastCallOfFile ? 1 : 0,
    ...Object.fromEntries(FEATURE_KEYS.map((k) => [`f_${k}`, round(f[k], 3)])),
    user_comment: comment?.raw ?? null,
    user_label: comment?.label ?? null,
    is_valid: row.isValid ?? null,
  };
}

/** Μία γραμμή KPI για μία κλήση (κλειδιά = KPI_COLUMNS). */
export function buildKpiRow(input: KpiInput): KpiRow {
  const { standard, historic, comment } = input;
  const std = standard.score;
  const his = historic?.score ?? null;
  const key = std.userLabel ?? std.topLabel;
  const weight = his ? input.historicWeight ?? DEFAULT_HISTORIC_WEIGHT : 0;
  const blend = blendMix(std.mix, his?.mix ?? null, weight);
  const autoLabel = blend[0]?.label ?? std.topLabel;
  return {
    ...measuredKpis(input),
    standard_label: LABEL_TITLES[std.topLabel],
    standard_verdict: std.verdict,
    standard_grade: std.grade,
    standard_hybrid: round(std.hybrid[key], 3),
    standard_mix: std.mix.length ? formatMix(std.mix) : null,
    standard_top_pct: std.mix[0]?.pct ?? null,
    standard_second_label: std.mix[1] ? LABEL_TITLES[std.mix[1].label] : null,
    standard_second_pct: std.mix[1]?.pct ?? null,
    standard_user_pct: userPct(comment?.label ?? null, std),
    historic_label: his ? LABEL_TITLES[his.topLabel] : null,
    historic_verdict: his?.verdict ?? null,
    historic_grade: his?.grade ?? null,
    historic_mix: his?.mix.length ? formatMix(his.mix) : null,
    historic_top_pct: his?.mix[0]?.pct ?? null,
    blend_label: LABEL_TITLES[autoLabel],
    blend_mix: blend.length ? formatBlend(blend) : null,
    blend_historic_weight: Math.round(100 * weight),
    final_label: LABEL_TITLES[input.override ?? autoLabel],
    final_label_source: input.override ? "manual" : "auto",
    standard_summary: narrativeText(standard.narrative),
    historic_summary: historic ? narrativeText(historic.narrative) : null,
  };
}

/** RFC 4180: κόμμα, διπλά εισαγωγικά όπου χρειάζεται, τελεία για δεκαδικά, κενό = NULL. */
function csvCell(v: KpiValue): string {
  if (v == null) return "";
  const s = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly KpiRow[]): string {
  const header = KPI_COLUMNS.map((c) => c.name).join(",");
  const lines = rows.map((r) => KPI_COLUMNS.map((c) => csvCell(r[c.name] ?? null)).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}

/** CREATE TABLE για SQL Server με τις ίδιες στήλες (κλειδί: βάση + SessionId). */
export function sqlCreateTable(table = "dbo.AuditCallKpi"): string {
  const cols = KPI_COLUMNS.map((c) => `  [${c.name}] ${c.sql} ${c.name === "database_name" || c.name === "session_id" ? "NOT NULL" : "NULL"}`);
  return `CREATE TABLE ${table} (\n${cols.join(",\n")},\n  CONSTRAINT [PK_AuditCallKpi] PRIMARY KEY ([database_name], [session_id])\n);\n`;
}
