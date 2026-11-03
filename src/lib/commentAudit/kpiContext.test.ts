import { describe, expect, it } from "vitest";
import type { AllCallsRow } from "@/lib/api";
import { contextKpis, lastWindow } from "./kpiContext";
import type { CallEvidenceBundle } from "./types";

const at = (sec: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, sec)).toISOString();
const bundle: CallEvidenceBundle = {
  analysisA: { avgMsTxPwr: 30, avgTA: 2, avgPuschTxPower: 0, band: "LTE 1800", EndTechnology: "LTE", num4GRRCConnRel: 1, numTrackingAreaUpdate: 2 },
  analysisB: { avgMsTxPwr: 0, num4GRRCConnRel: 2 },
  lteA: [
    { RSRP: -90, SINR0: 10, MsgTime: at(0), PhyCellId: 11, EARFCN: 1849, phase: "during" },
    { RSRP: -110, SINR0: 0, MsgTime: at(25), PhyCellId: 12, EARFCN: 1849, phase: "during" },
    { RSRP: -120, SINR0: -4, MsgTime: at(32), PhyCellId: 12, EARFCN: 1849, phase: "during" },
    { RSRP: -60, MsgTime: at(40), PhyCellId: 99, phase: "after" },
  ],
  lteB: [],
  gsmA: [],
  gsmB: [{ RxLevSub: -80, phase: "during" }, { RxLevSub: -100, phase: "during" }],
  tracelog: [],
  l3A: [],
  l3B: [],
};
const row = { latitude: 40.6, longitude: 22.9, callStartTimeStamp: "2026-10-01T12:00:00", mosDlAvg: 3.456, badQualityCall: 1 } as unknown as AllCallsRow;

describe("context KPIs", () => {
  it("averages radio over the last 10 s of the call only", () => {
    const k = contextKpis(bundle, row);
    expect(k.a_rsrp_last10s_avg).toBe(-115);
    expect(k.a_sinr_last10s_avg).toBe(-2);
    expect(k.b_rxlev_last10s_avg).toBe(-90);
    expect(k.a_rxlev_last10s_avg).toBeNull();
  });

  it("falls back to the last samples when there are no timestamps", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ phase: "during", i }));
    expect(lastWindow(rows).map((r) => r.i)).toEqual([3, 4, 5, 6, 7]);
  });

  it("takes uplink, cell, position, audio and signalling counters", () => {
    expect(contextKpis(bundle, row)).toMatchObject({
      a_ms_tx_pwr_avg: 30,
      b_ms_tx_pwr_avg: null,
      a_pusch_tx_pwr_avg: null,
      a_ta_avg: 2,
      a_last_pci: 12,
      a_last_earfcn: 1849,
      band: "LTE 1800",
      end_technology: "LTE",
      latitude: 40.6,
      call_start_time: "2026-10-01T12:00:00",
      mos_dl_avg: 3.46,
      bad_quality_call: 1,
      num_lte_rrc_conn_rel: 3,
      num_tau: 2,
      num_epsfb: null,
    });
  });
});
