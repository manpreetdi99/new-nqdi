"""Σελίδα Call Detail — WCDMA (3G) / NR5G radio + coverage / ping panels."""
from fastapi import APIRouter, HTTPException, Query

from api_utils import _rows
from db import get_connection

router = APIRouter(tags=["call-radio-other"])


@router.get("/api/wcdma_values")
def get_wcdma_values(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """WCDMA (3G) measurements: RSCP, Ec/Io, PSC, UARFCN per session."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                wmri.MsgTime,
                wmr.PSC,
                wmr.EcIo,
                wmr.RSCP,
                wmr.UARFCN,
                wmr.SetValue,
                p.Latitude,
                p.Longitude
            FROM WCDMAMeasReportInfo wmri
            JOIN WCDMAMeasReport wmr ON wmr.MeasReportId = wmri.MeasReportId
            LEFT JOIN Position p ON p.PosId = wmri.PosId
            WHERE wmri.SessionId = ?
            ORDER BY wmri.MsgTime
        """, (session_id,))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []
        conn.close()

        return {"wcdmaValues": [{columns[i]: row[i] for i in range(len(columns))} for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/wcdma_radio")
def get_wcdma_radio(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """3G WCDMA radio over the call: aggregate Ec/Io, RSCP, Tx/Rx power, SIR, BLER."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                w.FullDate AS MsgTime,
                w.SessionId,
                w.ARFCN,
                w.NumCells,
                ROUND(w.AggrEcIo, 2) AS AggrEcIo,
                ROUND(w.AggrRSCP, 2) AS AggrRSCP,
                ROUND(w.RxPwr,    2) AS RxPwr,
                ROUND(w.TxPwr,    2) AS TxPwr,
                ROUND(w.SIR,      2) AS SIR,
                w.BLERDecimal AS BLER,
                w.NumPolluter,
                w.DistanceToBTS,
                w.CGI
            FROM FactWCDMARadio w
            WHERE w.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY w.FullDate
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"wcdmaRadio": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/nr5g_state")
def get_nr5g_state(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """5G MM state over time (StateAsTxt / SubStateAsTxt) — shows when the UE
    actually camped on / dropped 5G during the call."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                s.FullDate AS MsgTime,
                s.SessionId,
                s.StateAsTxt,
                s.SubStateAsTxt,
                s.MM5GUpdateStatusTxt,
                s.TAC,
                s.PLMNID
            FROM FactNR5GMM5GState s
            WHERE s.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY s.FullDate
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"nr5gState": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/nr5g_throughput")
def get_nr5g_throughput(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """NR PDSCH net/scheduled downlink throughput over the call, plus BER & carriers."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                t.FullDate AS MsgTime,
                t.SessionId,
                t.Interval,
                ROUND(t.NetThroughput,   2) AS NetThroughput,
                ROUND(t.SchedThroughput, 2) AS SchedThroughput,
                t.BER,
                t.NumCarriers,
                t.Overhead
            FROM FactNR5GPDSCHThroughput t
            WHERE t.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY t.FullDate
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"nr5gThroughput": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/nr5g_cell_info")
def get_nr5g_cell_info(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """NR serving cell over the call: PCI, NRARFCN, band, SCS, bandwidths,
    serving beam index and number of detected beams."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                c.FullDate AS MsgTime,
                c.SessionId,
                c.PCI,
                c.DL_NRARFCN,
                c.UL_NRARFCN,
                c.Band,
                c.CellType,
                c.DuplexMode,
                c.DL_SubCarrierSpacing,
                c.DL_Bandwidth,
                c.UL_Bandwidth,
                c.ServingBeamSSBIndex,
                c.DetectedBeams,
                c.NumCarrier
            FROM FactNR5GCellInfo c
            WHERE c.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY c.FullDate
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"nr5gCellInfo": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/coverage_class")
def get_coverage_class(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Best-server coverage classification per geo bin: which channel/band/operator
    gave the best SS-RSRP (5G), RSRP (LTE), RSCP (3G), RxLev (2G) at each point."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                f.FullDate AS MsgTime,
                f.SessionId,
                f.RadioTechnology,
                f.RadioTechnologyBand,
                f.Frequency,
                f.Channel,
                f.Best_SS_RSRP_Channel,
                f.Best_SS_RSRP_Band,
                f.Best_RSRP_Channel,
                f.Best_RSRP_Band,
                f.Best_RSCP_Channel,
                f.Best_RxLev_Channel,
                f.MCC,
                f.MNC
            FROM FactCoverageClassification f
            WHERE f.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY f.FullDate
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"coverageClass": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/ping_summary")
def get_ping_summary(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Ping RTT summary for the session: average / median / 10th-percentile RTT,
    packet size, request count and error code."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                p.FullDate AS MsgTime,
                p.SessionId,
                p.Protocol,
                p.Host,
                p.PacketSize,
                p.Requests,
                p.ErrorCode,
                ROUND(p.RTTAverage,        2) AS RTTAverage_ms,
                ROUND(p.RTTMedian,         2) AS RTTMedian_ms,
                ROUND(p.RTT10thPercentile, 2) AS RTT_P10_ms
            FROM FactPingSummary p
            WHERE p.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY p.FullDate
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"pingSummary": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
