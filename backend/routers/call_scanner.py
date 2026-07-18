"""Σελίδα Call Detail — scanner tab:
FactLTEScanner / FactGSMScanner (raw, best-per-cycle, serving vs scanner)."""
from fastapi import APIRouter, HTTPException, Query

from db import get_connection

router = APIRouter(tags=["call-scanner"])


@router.get("/api/lte_scanner_raw")
def get_lte_scanner_raw(
    database: str = Query(..., min_length=1),
    cgi: str = Query(..., min_length=1),
    start: str = Query(..., min_length=1),
    end: str = Query(..., min_length=1)
):
    """FactLTEScanner rows for a given serving CGI within [start, end] — mirrors
    /api/gsm_scanner_raw's per-segment approach, since the serving CGI can change several
    times within a single call (handovers) and PCI alone can be reused by other cells."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                fs.FullDate,
                fs.EARFCN,
                fs.PCI,
                fs.CId,
                fs.TAC,
                fs.MCC,
                fs.MNC,
                fs.RFBand,
                fs.IsConfiguredBand,
                ROUND(fs.RSRP, 2)              AS RSRP,
                ROUND(fs.RSRQ, 2)              AS RSRQ,
                ROUND(fs.SINR, 2)              AS SINR,
                ROUND(fs.RSSI, 2)              AS RSSI,
                ROUND(fs.RSRP_Avg_Operator, 2) AS RSRP_AvgOperator,
                ROUND(fs.SINR_Avg_Operator, 2) AS SINR_AvgOperator,
                fs.MIMO,
                fs.NR5GENDC                    AS ENDC_capable,
                fs.Bandwidth,
                fs.DmnIdTopN_RSRP              AS RankByRSRP,
                fs.DistanceToBTS,
                fs.CGI
            FROM FactLTEScanner fs
            WHERE fs.CGI = ?
              AND fs.FullDate >= ?
              AND fs.FullDate <= ?
            ORDER BY fs.FullDate
        """, (cgi, start, end))
        cols = [c[0] for c in cursor.description] if cursor.description else []
        rows = [{cols[i]: row[i] for i in range(len(cols))} for row in cursor.fetchall()]

        conn.close()
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/lte_serving_vs_scanner")
def get_lte_serving_vs_scanner(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Head-to-head: what the UE was CAMPED ON (FactLTERadio serving cell) vs the
    BEST cell the SCANNER saw at the same time. Grouped per EARFCN+PCI so you can
    spot missed handovers (scanner best PCI stronger than serving)."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # SERVING (FactLTERadio) aggregated per cell during the call
        cursor.execute("""
            ;WITH win AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    COALESCE(CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration,0), CA.callStartTimeStamp)
                    ) AS end_time
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            )
            SELECT
                'serving' AS Source,
                fr.EARFCN,
                fr.PhyCellId AS PCI,
                COUNT(*)                 AS samples,
                ROUND(AVG(fr.RSRP),2)    AS avgRSRP,
                ROUND(AVG(fr.RSRQ),2)    AS avgRSRQ,
                ROUND(AVG(fr.SINR),2)    AS avgSINR
            FROM FactLTERadio fr
            CROSS JOIN win w
            WHERE fr.SessionId = TRY_CONVERT(BIGINT, ?)
              AND fr.FullDate BETWEEN w.start_time AND w.end_time
              AND fr.EARFCN IS NOT NULL
            GROUP BY fr.EARFCN, fr.PhyCellId
        """, (session_id, session_id))
        cols = [c[0] for c in cursor.description]
        serving = [{cols[i]: r[i] for i in range(len(cols))} for r in cursor.fetchall()]

        # SCANNER (FactLTEScanner) aggregated per cell during the call
        cursor.execute("""
            ;WITH win AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    COALESCE(CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration,0), CA.callStartTimeStamp)
                    ) AS end_time
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            )
            SELECT
                'scanner' AS Source,
                fs.EARFCN,
                fs.PCI,
                COUNT(*)                 AS samples,
                ROUND(AVG(fs.RSRP),2)    AS avgRSRP,
                ROUND(AVG(fs.RSRQ),2)    AS avgRSRQ,
                ROUND(AVG(fs.SINR),2)    AS avgSINR
            FROM FactLTEScanner fs
            CROSS JOIN win w
            WHERE fs.FullDate BETWEEN w.start_time AND w.end_time
              AND fs.EARFCN IS NOT NULL
            GROUP BY fs.EARFCN, fs.PCI
            ORDER BY avgRSRP DESC
        """, (session_id,))
        cols = [c[0] for c in cursor.description]
        scanner = [{cols[i]: r[i] for i in range(len(cols))} for r in cursor.fetchall()]

        conn.close()

        # derive: was the scanner's best cell stronger than the serving cell?
        serving_best = max((s["avgRSRP"] for s in serving if s["avgRSRP"] is not None), default=None)
        scanner_best = scanner[0] if scanner else None
        missed_ho = None
        if serving_best is not None and scanner_best and scanner_best.get("avgRSRP") is not None:
            # scanner best PCI not in serving list and >3 dB stronger
            serving_pcis = {s["PCI"] for s in serving}
            if scanner_best["PCI"] not in serving_pcis and scanner_best["avgRSRP"] - serving_best > 3:
                missed_ho = {
                    "scannerBestPCI": scanner_best["PCI"],
                    "scannerBestRSRP": scanner_best["avgRSRP"],
                    "servingBestRSRP": serving_best,
                    "deltaDb": round(scanner_best["avgRSRP"] - serving_best, 1),
                    "note": "Scanner saw a stronger cell than serving — possible missed/late handover",
                }

        return {"serving": serving, "scanner": scanner, "missedHandoverHint": missed_ho}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/gsm_scanner_raw")
def get_gsm_scanner_raw(
    database: str = Query(..., min_length=1),
    cgi: str = Query(..., min_length=1),
    start: str = Query(..., min_length=1),
    end: str = Query(..., min_length=1)
):
    """FactGSMScanner rows for a given CGI within [start, end]."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT FullDate, BCCH, RFBand, BSIC, RxLev, CoverI, CGI, CId, LAC
            FROM FactGSMScanner
            WHERE CGI = ?
              AND FullDate >= ?
              AND FullDate <= ?
            ORDER BY FullDate
        """, (cgi, start, end))
        cols = [c[0] for c in cursor.description] if cursor.description else []
        rows = [{cols[i]: row[i] for i in range(len(cols))} for row in cursor.fetchall()]

        conn.close()
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/gsm_scanner_best")
def get_gsm_scanner_best(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Best (DmnIdTopN_RxLev_Operator = 1) FactGSMScanner reading per scan cycle for the
    call's own operator — independent of the serving CGI, so it doesn't need per-segment
    matching like /api/gsm_scanner_raw. Feeds the 'Best RxLev Scanner' chart line.

    Time window and operator are both derived server-side from SessionId (like the other
    scanner endpoints), instead of trusting values computed by the frontend: CallRecord's
    `operator` field is hardcoded to "N/A" for real calls, and its `startTime`/`endTime`
    are round-tripped through JS Date (local-time interpretation of a naive DB datetime),
    which can shift the window by the browser's UTC offset."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            ;WITH call_ctx AS (
                SELECT TOP 1
                    COALESCE(S.startTime, SB.startTime) AS start_time,
                    COALESCE(
                        CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), COALESCE(S.startTime, SB.startTime))
                    ) AS end_time,
                    CASE
                        WHEN DF.ASideLocation LIKE '%Cosmote%' OR DF.CollectionName LIKE '%Cosmote%' THEN 'COSMOTE'
                        WHEN DF.ASideLocation LIKE '%Vodafone%' OR DF.CollectionName LIKE '%Vodafone%' THEN 'VODAFONE'
                        WHEN DF.ASideLocation LIKE '%Nova%' OR DF.ASideLocation LIKE '%Wind%'
                             OR DF.CollectionName LIKE '%Nova%' OR DF.CollectionName LIKE '%Wind%' THEN 'NOVA'
                        ELSE NULL
                    END AS call_operator
                FROM CallAnalysis CA
                LEFT JOIN FileList DF ON CA.FileId = DF.FileId
                LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
                LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            )
            SELECT fs.FullDate, fs.BCCH, fs.RFBand, fs.BSIC, fs.RxLev, fs.CoverI, fs.CGI, fs.CId, fs.LAC
            FROM FactGSMScanner fs
            CROSS JOIN call_ctx cc
            WHERE fs.DmnIdTopN_RxLev_Operator = 1
              AND fs.FullDate >= cc.start_time
              AND fs.FullDate <= cc.end_time
              AND cc.call_operator IS NOT NULL
              AND (
                    (cc.call_operator = 'VODAFONE' AND fs.CGI LIKE '202-5-%') OR
                    (cc.call_operator = 'NOVA' AND fs.CGI LIKE '202-10-%') OR
                    (cc.call_operator = 'COSMOTE' AND fs.CGI LIKE '202-1-%' AND fs.CGI NOT LIKE '202-10%')
                  )
            ORDER BY fs.FullDate
        """, (session_id,))
        cols = [c[0] for c in cursor.description] if cursor.description else []
        rows = [{cols[i]: row[i] for i in range(len(cols))} for row in cursor.fetchall()]

        conn.close()
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/lte_scanner_best")
def get_lte_scanner_best(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Best (DmnIdTopN_RSRP_Operator = 1) FactLTEScanner reading per scan cycle for the
    call's own operator — independent of the UE's serving EARFCN/PCI. Feeds the
    'Best LTE Scanner' chart line. Same time-window/operator derivation as
    /api/gsm_scanner_best, but matches the operator via MCC/MNC (both are already plain
    int columns on FactLTEScanner) instead of a CGI string prefix."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            ;WITH call_ctx AS (
                SELECT TOP 1
                    COALESCE(S.startTime, SB.startTime) AS start_time,
                    COALESCE(
                        CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), COALESCE(S.startTime, SB.startTime))
                    ) AS end_time,
                    CASE
                        WHEN DF.ASideLocation LIKE '%Cosmote%' OR DF.CollectionName LIKE '%Cosmote%' THEN 1
                        WHEN DF.ASideLocation LIKE '%Vodafone%' OR DF.CollectionName LIKE '%Vodafone%' THEN 5
                        WHEN DF.ASideLocation LIKE '%Nova%' OR DF.ASideLocation LIKE '%Wind%'
                             OR DF.CollectionName LIKE '%Nova%' OR DF.CollectionName LIKE '%Wind%' THEN 10
                        ELSE NULL
                    END AS call_mnc
                FROM CallAnalysis CA
                LEFT JOIN FileList DF ON CA.FileId = DF.FileId
                LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
                LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            )
            SELECT fs.FullDate, fs.EARFCN, fs.PCI, fs.CId, fs.TAC, fs.MCC, fs.MNC,
                   ROUND(fs.RSRP, 2) AS RSRP, ROUND(fs.RSRQ, 2) AS RSRQ, fs.CGI
            FROM FactLTEScanner fs
            CROSS JOIN call_ctx cc
            WHERE fs.DmnIdTopN_RSRP_Operator = 1
              AND fs.FullDate >= cc.start_time
              AND fs.FullDate <= cc.end_time
              AND cc.call_mnc IS NOT NULL
              AND fs.MCC = 202
              AND fs.MNC = cc.call_mnc
            ORDER BY fs.FullDate
        """, (session_id,))
        cols = [c[0] for c in cursor.description] if cursor.description else []
        rows = [{cols[i]: row[i] for i in range(len(cols))} for row in cursor.fetchall()]

        conn.close()
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/lte_scanner_measurement")
def get_lte_scanner_measurement(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """FactLTEScanner A-side vs B-side grouped by EARFCN+PCI."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # A-side scanner: match by call time window
        cursor.execute("""
            ;WITH call_time AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    COALESCE(
                        CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp)
                    ) AS end_time
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            )
            SELECT
                fs.EARFCN,
                fs.PCI,
                fs.RFBand,
                COUNT(*)                    AS samples,
                ROUND(AVG(fs.RSRP), 2)      AS avgRSRP,
                ROUND(MIN(fs.RSRP), 2)      AS minRSRP,
                ROUND(MAX(fs.RSRP), 2)      AS maxRSRP,
                ROUND(AVG(fs.RSRQ), 2)      AS avgRSRQ,
                ROUND(MIN(fs.RSRQ), 2)      AS minRSRQ,
                ROUND(MAX(fs.RSRQ), 2)      AS maxRSRQ,
                ROUND(AVG(fs.SINR), 2)      AS avgSINR,
                ROUND(AVG(fs.RSSI), 2)      AS avgRSSI
            FROM FactLTEScanner fs
            CROSS JOIN call_time ct
            WHERE fs.EARFCN IS NOT NULL
              AND fs.FullDate >= ct.start_time
              AND fs.FullDate <= ct.end_time
            GROUP BY fs.EARFCN, fs.PCI, fs.RFBand
            ORDER BY samples DESC
        """, (session_id,))
        cols_a = [c[0] for c in cursor.description] if cursor.description else []
        a_side = [{cols_a[i]: row[i] for i in range(len(cols_a))} for row in cursor.fetchall()]

        # B-side scanner: resolve B session then match by B-side call time window
        cursor.execute("""
            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE
                        WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                        ELSE CA.SessionId
                    END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
            ),
            b_session AS (
                SELECT TOP (1) CA.SessionId AS BSessionId
                FROM CallAnalysis CA
                INNER JOIN pair_root PR ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'
            ),
            b_time AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    COALESCE(
                        CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp)
                    ) AS end_time
                FROM CallAnalysis CA
                INNER JOIN b_session B ON CA.SessionId = B.BSessionId
            )
            SELECT
                fs.EARFCN,
                fs.PCI,
                fs.RFBand,
                COUNT(*)                    AS samples,
                ROUND(AVG(fs.RSRP), 2)      AS avgRSRP,
                ROUND(MIN(fs.RSRP), 2)      AS minRSRP,
                ROUND(MAX(fs.RSRP), 2)      AS maxRSRP,
                ROUND(AVG(fs.RSRQ), 2)      AS avgRSRQ,
                ROUND(MIN(fs.RSRQ), 2)      AS minRSRQ,
                ROUND(MAX(fs.RSRQ), 2)      AS maxRSRQ,
                ROUND(AVG(fs.SINR), 2)      AS avgSINR,
                ROUND(AVG(fs.RSSI), 2)      AS avgRSSI
            FROM FactLTEScanner fs
            CROSS JOIN b_time bt
            WHERE fs.EARFCN IS NOT NULL
              AND fs.FullDate >= bt.start_time
              AND fs.FullDate <= bt.end_time
            GROUP BY fs.EARFCN, fs.PCI, fs.RFBand
            ORDER BY samples DESC
        """, (session_id, session_id))
        cols_b = [c[0] for c in cursor.description] if cursor.description else []
        b_side = [{cols_b[i]: row[i] for i in range(len(cols_b))} for row in cursor.fetchall()]

        conn.close()
        return {"aSide": a_side, "bSide": b_side}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
