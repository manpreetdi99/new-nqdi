"""Σελίδα Call Detail — GSM radio charts: RxLev/RxQual (A & B side) + neighbors."""
from fastapi import APIRouter, HTTPException, Query

from api_utils import _rows
from db import get_connection

router = APIRouter(tags=["call-radio-gsm"])


@router.get("/api/gsm_values")
def get_gsm_values(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT fs.[FactId]               AS MsgId
                  ,fs.[SessionId]
                  ,fs.[FullDate]              AS MsgTime
                  ,fs.[PosId]
                  ,fs.[NetworkId]
                  ,fs.band
                  ,fs.[RxLevSub]
                  ,fs.[RxQualSub]
                  ,fs.[CGI]
                  ,p.Latitude
                  ,p.Longitude
              FROM [FactGSMRadio] fs
              LEFT JOIN DmnPosition p ON fs.DmnIdPosition = p.DmnId
              WHERE fs.[SessionId] = ?
              ORDER BY fs.FullDate
        """

        cursor.execute(query, (session_id,))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"gsmValues": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/gsm_values_b_side")
def get_gsm_values_b_side(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
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
            SELECT
                fs.[FactId]    AS MsgId,
                fs.[SessionId],
                fs.[FullDate]  AS MsgTime,
                fs.[PosId],
                fs.[NetworkId],
                fs.band,
                fs.[RxLevSub],
                fs.[RxQualSub],
                fs.[CGI],
                p.Latitude,
                p.Longitude
            FROM [FactGSMRadio] fs
            INNER JOIN b_side B
                ON fs.SessionId = B.BSessionId
            LEFT JOIN DmnPosition p ON fs.DmnIdPosition = p.DmnId
            ORDER BY fs.FullDate
        """

        cursor.execute(query, (session_id, session_id))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"gsmValuesBSide": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/gsm_neighbors")
def get_gsm_neighbors(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """GSM neighbour list during the call: BCCH/BSIC/RxLev/C1/C2 per neighbour."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                n.FullDate AS MsgTime,
                n.SessionId,
                n.Cell,
                n.BCCH,
                n.BSICFormatted AS BSIC,
                n.RxLev,
                n.C1,
                n.C2,
                n.DistanceToBTS,
                p.Latitude,
                p.Longitude
            FROM FactGSMNeighbors n
            LEFT JOIN Position p ON p.PosId = n.PosId
            WHERE n.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY n.FullDate, n.RxLev DESC
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"gsmNeighbors": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
