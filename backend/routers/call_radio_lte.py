"""Σελίδα Call Detail — LTE radio charts:
serving cell values (A & B side), cell info, neighbors, CA config, A/B σύγκριση."""
from fastapi import APIRouter, HTTPException, Query

from api_utils import _rows
from db import get_connection

router = APIRouter(tags=["call-radio-lte"])


@router.get("/api/lte_values")
def get_lte_values(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """LTE serving-cell radio for the call, from FactLTERadio.

    Changed from LTEMeasurementReport -> FactLTERadio. Key differences handled:
      - timestamp column is FullDate (not MsgTime) -> aliased back to MsgTime
      - SINR is a single column (not SINR0/SINR1)
      - position joins via DmnIdPosition -> DmnPosition.DmnId (not PosId)
    Extra FactLTERadio fields exposed: CarrierIndex/SCCIndex (carrier aggregation),
    DL/UL bandwidth, DistanceToBTS, CGI, and per-antenna Rx0..Rx3 (RSRP/RSRQ/SINR).
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT fr.[MsgId]
                  ,fr.[SessionId]
                  ,fr.[FullDate]           AS [MsgTime]
                  ,fr.[PosId]
                  ,fr.[NetworkId]
                  ,fr.[CarrierIndex]
                  ,fr.[SCCIndex]
                  ,fr.[EARFCN]
                  ,fr.[PhyCellId]
                  ,ROUND(fr.[RSRP], 2)  AS [RSRP]
                  ,ROUND(fr.[RSRQ], 2)  AS [RSRQ]
                  ,ROUND(fr.[RSSI], 2)  AS [RSSI]
                  ,ROUND(fr.[SINR], 2)  AS [SINR]
                  -- per-antenna branches (MIMO diagnostics)
                  ,ROUND(fr.[RSRP_Rx0], 2) AS [RSRP_Rx0]
                  ,ROUND(fr.[RSRP_Rx1], 2) AS [RSRP_Rx1]
                  ,ROUND(fr.[RSRP_Rx2], 2) AS [RSRP_Rx2]
                  ,ROUND(fr.[RSRP_Rx3], 2) AS [RSRP_Rx3]
                  ,ROUND(fr.[SINR_Rx0], 2) AS [SINR_Rx0]
                  ,ROUND(fr.[SINR_Rx1], 2) AS [SINR_Rx1]
                  -- carrier / cell context
                  ,fr.[DLBandWidth]
                  ,fr.[ULBandWidth]
                  ,fr.[DistanceToBTS]
                  ,fr.[CGI]
                  ,fr.[LTEServingCellInfoId]
                  ,dp.Latitude
                  ,dp.Longitude
              FROM [FactLTERadio] fr
              LEFT JOIN DmnPosition dp ON dp.DmnId = fr.DmnIdPosition
              WHERE fr.[SessionId] = TRY_CONVERT(BIGINT, ?)
              ORDER BY fr.FullDate
        """

        cursor.execute(query, (session_id,))
        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []
        data = [{columns[i]: row[i] for i in range(len(columns))} for row in rows]

        conn.close()
        return {"lteValues": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/cell_info")
def get_cell_info(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT TOP 1
                dci.eNBId,
                fl.EARFCN,
                fl.PhyCellId
            FROM FactLTERadio fl
            LEFT JOIN DmnCellInformation dci ON fl.DmnIdCellInformation = dci.DmnId
            WHERE fl.SessionId = ?
              AND dci.eNBId IS NOT NULL
            ORDER BY fl.FullDate
        """, (session_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {"eNBId": row[0], "EARFCN": row[1], "PCI": row[2]}
        return {"eNBId": None, "EARFCN": None, "PCI": None}
    except Exception as e:
        return {"eNBId": None, "EARFCN": None, "PCI": None}


@router.get("/api/cell_info_b_side")
def get_cell_info_b_side(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
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
            b_side AS (
                SELECT TOP (1)
                    CA.SessionId AS BSessionId
                FROM CallAnalysis CA
                INNER JOIN pair_root PR
                    ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'
            )
            SELECT TOP 1
                dci.eNBId,
                fl.EARFCN,
                fl.PhyCellId
            FROM FactLTERadio fl
            INNER JOIN b_side B ON fl.SessionId = B.BSessionId
            LEFT JOIN DmnCellInformation dci ON fl.DmnIdCellInformation = dci.DmnId
            WHERE dci.eNBId IS NOT NULL
            ORDER BY fl.FullDate
        """, (session_id, session_id))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {"eNBId": row[0], "EARFCN": row[1], "PCI": row[2]}
        return {"eNBId": None, "EARFCN": None, "PCI": None}
    except Exception as e:
        return {"eNBId": None, "EARFCN": None, "PCI": None}


@router.get("/api/lte_values_b_side")
def get_lte_values_b_side(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """LTE serving-cell radio for the B-side of the call, from FactLTERadio.
    Mirrors /api/lte_values (same FactLTERadio columns / MsgTime aliasing),
    but resolves the B-side SessionId from CallAnalysis first."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
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
            b_side AS (
                SELECT TOP (1)
                    CA.SessionId AS BSessionId
                FROM CallAnalysis CA
                INNER JOIN pair_root PR
                    ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'
            )
            SELECT fr.[MsgId]
                  ,fr.[SessionId]
                  ,fr.[FullDate]           AS [MsgTime]
                  ,fr.[PosId]
                  ,fr.[NetworkId]
                  ,fr.[CarrierIndex]
                  ,fr.[SCCIndex]
                  ,fr.[EARFCN]
                  ,fr.[PhyCellId]
                  ,ROUND(fr.[RSRP], 2)  AS [RSRP]
                  ,ROUND(fr.[RSRQ], 2)  AS [RSRQ]
                  ,ROUND(fr.[RSSI], 2)  AS [RSSI]
                  ,ROUND(fr.[SINR], 2)  AS [SINR]
                  -- per-antenna branches (MIMO diagnostics)
                  ,ROUND(fr.[RSRP_Rx0], 2) AS [RSRP_Rx0]
                  ,ROUND(fr.[RSRP_Rx1], 2) AS [RSRP_Rx1]
                  ,ROUND(fr.[RSRP_Rx2], 2) AS [RSRP_Rx2]
                  ,ROUND(fr.[RSRP_Rx3], 2) AS [RSRP_Rx3]
                  ,ROUND(fr.[SINR_Rx0], 2) AS [SINR_Rx0]
                  ,ROUND(fr.[SINR_Rx1], 2) AS [SINR_Rx1]
                  -- carrier / cell context
                  ,fr.[DLBandWidth]
                  ,fr.[ULBandWidth]
                  ,fr.[DistanceToBTS]
                  ,fr.[CGI]
                  ,fr.[LTEServingCellInfoId]
                  ,dp.Latitude
                  ,dp.Longitude
              FROM [FactLTERadio] fr
              INNER JOIN b_side B
                  ON fr.SessionId = B.BSessionId
              LEFT JOIN DmnPosition dp ON dp.DmnId = fr.DmnIdPosition
              ORDER BY fr.FullDate
        """

        cursor.execute(query, (session_id, session_id))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"lteValuesBSide": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/lte_neighbors")
def get_lte_neighbors(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """LTE neighbor cells (PCI, RSRP, RSRQ, EARFCN) during the session."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                n.FullDate AS MsgTime,
                n.PCI,
                ROUND(n.RSRP, 2) AS RSRP,
                ROUND(n.RSRQ, 2) AS RSRQ,
                n.DL_EARFCN,
                n.RFBand,
                n.Detected,
                p.Latitude,
                p.Longitude
            FROM FactLTENeighbors n
            LEFT JOIN Position p ON p.PosId = n.PosId
            WHERE n.SessionId = ?
            ORDER BY n.FullDate
        """, (session_id,))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []
        conn.close()

        return {"lteNeighbors": [{columns[i]: row[i] for i in range(len(columns))} for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/lte_cell_info")
def get_lte_cell_info(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """LTE serving cell + CA configuration over the call: PCI, EARFCN, bandwidths,
    number of antennas, transmission mode, aggregated bandwidth (CA)."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                c.FullDate AS MsgTime,
                c.SessionId,
                c.CarrierIndexName,
                c.PCI,
                c.DL_EARFCN,
                c.UL_EARFCN,
                c.DLBandwidth,
                c.ULBandwidth,
                c.RFBand,
                c.NumberOfAntennas,
                c.TransmissionMode,
                c.NumCarriers,
                c.DLBandwidthAggregated,
                c.MCC,
                c.MNC,
                c.TAC
            FROM FactLTECellInfo c
            WHERE c.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY c.FullDate
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"lteCellInfo": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/lte_measurement_comparison")
def get_lte_measurement_comparison(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """LTEMeasurementReport A-side vs B-side grouped by EARFCN+PCI."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # A-side: aggregate per EARFCN+PCI
        cursor.execute("""
            SELECT
                lmr.EARFCN,
                lmr.PhyCellId AS PCI,
                COUNT(*)                        AS samples,
                ROUND(AVG(lmr.RSRP),  2)        AS avgRSRP,
                ROUND(MIN(lmr.RSRP),  2)        AS minRSRP,
                ROUND(MAX(lmr.RSRP),  2)        AS maxRSRP,
                ROUND(AVG(lmr.RSRQ),  2)        AS avgRSRQ,
                ROUND(MIN(lmr.RSRQ),  2)        AS minRSRQ,
                ROUND(MAX(lmr.RSRQ),  2)        AS maxRSRQ,
                ROUND(AVG(lmr.SINR0), 2)        AS avgSINR0,
                ROUND(AVG(lmr.SINR1), 2)        AS avgSINR1
            FROM LTEMeasurementReport lmr
            WHERE lmr.SessionId = TRY_CONVERT(BIGINT, ?)
              AND lmr.EARFCN IS NOT NULL
            GROUP BY lmr.EARFCN, lmr.PhyCellId
            ORDER BY samples DESC
        """, (session_id,))
        cols_a = [c[0] for c in cursor.description] if cursor.description else []
        a_side = [{cols_a[i]: row[i] for i in range(len(cols_a))} for row in cursor.fetchall()]

        # B-side: resolve B-session then aggregate
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
            b_side AS (
                SELECT TOP (1) CA.SessionId AS BSessionId
                FROM CallAnalysis CA
                INNER JOIN pair_root PR ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'
            )
            SELECT
                lmr.EARFCN,
                lmr.PhyCellId AS PCI,
                COUNT(*)                        AS samples,
                ROUND(AVG(lmr.RSRP),  2)        AS avgRSRP,
                ROUND(MIN(lmr.RSRP),  2)        AS minRSRP,
                ROUND(MAX(lmr.RSRP),  2)        AS maxRSRP,
                ROUND(AVG(lmr.RSRQ),  2)        AS avgRSRQ,
                ROUND(MIN(lmr.RSRQ),  2)        AS minRSRQ,
                ROUND(MAX(lmr.RSRQ),  2)        AS maxRSRQ,
                ROUND(AVG(lmr.SINR0), 2)        AS avgSINR0,
                ROUND(AVG(lmr.SINR1), 2)        AS avgSINR1
            FROM LTEMeasurementReport lmr
            INNER JOIN b_side B ON lmr.SessionId = B.BSessionId
            WHERE lmr.EARFCN IS NOT NULL
            GROUP BY lmr.EARFCN, lmr.PhyCellId
            ORDER BY samples DESC
        """, (session_id, session_id))
        cols_b = [c[0] for c in cursor.description] if cursor.description else []
        b_side = [{cols_b[i]: row[i] for i in range(len(cols_b))} for row in cursor.fetchall()]

        conn.close()
        return {"aSide": a_side, "bSide": b_side}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
