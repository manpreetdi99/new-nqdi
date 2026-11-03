import { describe, expect, it } from "vitest";
import type { AllCallsRow } from "@/lib/api";
import { extractEvidence, type CallEvidenceBundle } from "./evidence";
import { KPI_COLUMNS, buildKpiRow, sqlCreateTable, toCsv } from "./kpiExport";
import { parseComment, type AuditLabel } from "./labels";
import type { ScannerBundle } from "./scannerBundle";
import { buildNarrative } from "./narrative";
import { auditComments } from "./scoring";

const lte = (rsrp: number, phase = "during") => ({ RSRP: rsrp, RSRQ: -16, SINR0: -4, SINR1: -4, phase });
const bundle: CallEvidenceBundle = {
  analysisA: { technology: "LTE", callDir: "A->B", CallDuration_s: 45, SetupTime_s: 2.5, SIPBYEReason: "RTP timeout", SIPBYEInitDirection: "U" },
  analysisB: null,
  lteA: [lte(-130, "before"), lte(-110), lte(-116), lte(-121), lte(-122), lte(-118), lte(-100)],
  lteB: [],
  gsmA: [],
  gsmB: [{ RxLevSub: -94, RxQualSub: 6, phase: "during" }, { RxLevSub: -101, RxQualSub: 2, phase: "during" }],
  tracelog: [{ Side: "A", Info: "Start call duration (90s)" }, { Side: "B", Info: "IMS SIP INVITE Error 503" }, { Side: "A", Info: "Test aborted" }],
  l3A: [],
  l3B: [],
  isLastCallOfFile: true,
};
const row = { SessionId: 123, CollectionName: "COL, 1", Location: "Cosmote Free A", status: "Dropped", comment: "LC LTE", isValid: 1 } as unknown as AllCallsRow;

const scanner: ScannerBundle = {
  lteBest: [{ PCI: 10, RSRP: -100, RSRQ: -10 }, { PCI: 10, RSRP: -116, RSRQ: -16 }, { PCI: 22, RSRP: -121, RSRQ: -17 }, { PCI: 22, RSRP: -95, RSRQ: -9 }],
  gsmBest: [{ RxLev: -90, CoverI: 12 }, { RxLev: -101, CoverI: 6 }],
  nrBest: [],
  servingVsScanner: { missedHandoverHint: { deltaDb: 5.5, scannerBestRSRP: -95, servingBestRSRP: -100.5 } },
};

function kpis(scan: ScannerBundle | null = null, override: AuditLabel | null = null) {
  const evidence = extractEvidence(bundle);
  const comment = parseComment(row.comment);
  const [score] = auditComments([{ id: "123", comment, features: evidence.features }]);
  return buildKpiRow({ database: "DEMO", row, bundle, evidence, comment, standard: { score, narrative: buildNarrative(comment, evidence, score) }, scanner: scan, override });
}

describe("buildKpiRow", () => {
  it("counts consecutive samples and percentages per threshold (only in-call samples)", () => {
    const k = kpis();
    expect(k.a_lte_samples).toBe(6);
    expect(k.a_rsrp_max_consec_le_115).toBe(4);
    expect(k.a_rsrp_max_consec_le_120).toBe(2);
    expect(k.a_rsrp_pct_le_115).toBeCloseTo(66.7, 1);
    expect(k.a_rsrp_pct_le_120).toBeCloseTo(33.3, 1);
    expect(k.a_rsrp_min).toBe(-122);
  });

  it("computes GSM KPIs on RxLev Sub", () => {
    const k = kpis();
    expect(k.b_rxlev_max_consec_le_93).toBe(2);
    expect(k.b_rxlev_max_consec_le_100).toBe(1);
    expect(k.b_rxlev_pct_le_105).toBe(0);
    expect(k.b_rxqual_pct_ge_5).toBe(50);
  });

  it("fills duration, SIP codes, booleans and the training label", () => {
    const k = kpis();
    expect(k).toMatchObject({ call_duration_s: 45, configured_duration_s: 90, duration_ratio: 0.5, sip_5xx_code: 503, sip_error_codes: "503", is_fake_eof: 1, is_last_call_of_file: 1, user_label: "LC_LTE", sip_bye_reason: "RTP timeout" });
    expect(k.historic_label).toBeNull();
    expect(String(k.standard_summary)).toContain("Ο χρήστης έγραψε «LC LTE»");
    expect(String(k.standard_summary)).toMatch(/\[ράδιο LTE A\]/);
  });

  it("produces exactly the schema columns", () => {
    expect(Object.keys(kpis()).sort()).toEqual(KPI_COLUMNS.map((c) => c.name).sort());
    expect(Object.keys(kpis(scanner)).sort()).toEqual(KPI_COLUMNS.map((c) => c.name).sort());
  });
});

describe("scanner KPIs", () => {
  it("leaves scanner columns empty/zero without scanner data", () => {
    const k = kpis();
    expect(k).toMatchObject({ scan_has_data: 0, scan_lte_samples: 0, scan_lte_rsrp_avg: null, scan_missed_ho_hint: 0, a_ue_minus_scan_rsrp_avg: null });
  });

  it("computes best-cell LTE/GSM KPIs, cell changes and the missed-HO hint", () => {
    const k = kpis(scanner);
    expect(k).toMatchObject({
      scan_has_data: 1,
      scan_lte_samples: 4,
      scan_lte_rsrp_min: -121,
      scan_lte_rsrp_pct_le_115: 50,
      scan_lte_rsrp_pct_le_120: 25,
      scan_lte_rsrq_pct_le_15: 50,
      scan_lte_best_cell_changes: 1,
      scan_gsm_samples: 2,
      scan_gsm_rxlev_pct_le_80: 100,
      scan_gsm_rxlev_pct_le_90: 100,
      scan_gsm_rxlev_max_consec_le_90: 2,
      scan_gsm_ci_pct_lt_9: 50,
      scan_nr_samples: 0,
      scan_missed_ho_hint: 1,
      scan_missed_ho_delta_db: 5.5,
    });
  });

  it("compares the phone with the scanner (UE − scanner)", () => {
    const k = kpis(scanner);
    // A: μέσο RSRP κατά την κλήση −114.5, scanner −108 → −6.5 dB χειρότερο.
    expect(k.a_ue_minus_scan_rsrp_avg).toBeCloseTo(-6.5, 1);
    expect(k.b_ue_minus_scan_rsrp_avg).toBeNull();
    expect(k.b_ue_minus_scan_rxlev_avg).toBeCloseTo(-2, 1);
  });
});

describe("CSV and SQL", () => {
  it("escapes commas and quotes and leaves NULL empty", () => {
    const csv = toCsv([kpis()]);
    const [header, line] = csv.trim().split("\r\n");
    expect(header.split(",")).toHaveLength(KPI_COLUMNS.length);
    expect(line).toContain('"COL, 1"');
    expect(line.startsWith("DEMO,123,")).toBe(true);
  });

  it("creates a SQL Server table with the same columns and a primary key", () => {
    const sql = sqlCreateTable();
    expect(sql).toContain("CREATE TABLE dbo.AuditCallKpi (");
    expect(sql).toContain("[a_rsrp_pct_le_120] FLOAT NULL");
    expect(sql).toContain("PRIMARY KEY ([database_name], [session_id])");
    expect(sql.match(/^ {2}\[/gm)).toHaveLength(KPI_COLUMNS.length);
  });
});

describe("final label", () => {
  it("is the audit label unless the user chose which cause prevails", () => {
    const auto = kpis();
    expect(auto.final_label).toBe(auto.blend_label);
    expect(auto.final_label_source).toBe("auto");
    expect(kpis(null, "LC_LTE")).toMatchObject({ final_label: "LC LTE", final_label_source: "manual" });
    // Χωρίς Historic το «Κατά τα δεδομένα» είναι 100% Standard.
    expect(auto).toMatchObject({ blend_historic_weight: 0, blend_label: auto.standard_label });
  });

  it("exports the cause percentages", () => {
    const k = kpis();
    expect(typeof k.standard_mix === "string" || k.standard_mix === null).toBe(true);
    if (k.standard_mix) expect(String(k.standard_mix)).toMatch(/^\d+% /);
  });
});
