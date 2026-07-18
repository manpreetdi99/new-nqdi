"""Σελίδα Call Detail — context window γύρω από την κλήση:
σήμα (LTE/GSM, A & B side) και αλλαγές τεχνολογίας σε παράθυρο ±window_sec."""
from fastapi import APIRouter, HTTPException, Query

from db import get_connection

router = APIRouter(tags=["call-context"])


@router.get("/api/gsm_context_signal")
def get_gsm_context_signal(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    window_sec: int = Query(default=10, ge=10, le=300)
):
    """GSM RxLev/RxQual in a ±window_sec window around the call, queried by TIME (not FileId).
    Falls back from RxLevSub→RxLevFull and RxQualSub→RxQualFull when Sub is NULL.
    Each row carries phase='before'|'during'|'after'."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            ;WITH call_info AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp) AS end_time
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            ),
            win AS (
                SELECT
                    DATEADD(SECOND, -?, ci.start_time) AS window_start,
                    DATEADD(SECOND,  ?, ci.end_time)   AS window_end,
                    ci.start_time,
                    ci.end_time
                FROM call_info ci
            )
            SELECT
                g.MsgTime,
                g.SessionId,
                COALESCE(g.RxLevSub,  g.RxLevFull)  AS RxLevSub,
                COALESCE(g.RxQualSub, g.RxQualFull) AS RxQualSub,
                p.Latitude,
                p.Longitude,
                CASE
                    WHEN g.MsgTime < w.start_time THEN 'before'
                    WHEN g.MsgTime > w.end_time   THEN 'after'
                    ELSE 'during'
                END AS phase
            FROM win w
            INNER JOIN GSMMeasReport g
                ON  g.MsgTime BETWEEN w.window_start AND w.window_end
            LEFT JOIN Position p
                ON  p.PosId = g.PosId
            ORDER BY g.MsgTime
        """, (session_id, window_sec, window_sec))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []
        conn.close()

        return {"signal": [{columns[i]: row[i] for i in range(len(columns))} for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/call_context_signal")
def get_call_context_signal(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    window_sec: int = Query(default=10, ge=5, le=300)
):
    """LTE RSRP/RSRQ/SINR in a ±window_sec window around the call (same file, all sessions).
    Each row carries phase='before'|'during'|'after'."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            ;WITH call_info AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    COALESCE(
                        CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp)
                    ) AS end_time,
                    CA.FileId
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            ),
            win AS (
                SELECT
                    DATEADD(SECOND, -?, ci.start_time) AS window_start,
                    DATEADD(SECOND,  ?, ci.end_time)   AS window_end,
                    ci.start_time,
                    ci.end_time,
                    ci.FileId
                FROM call_info ci
            )
            SELECT
                lmr.MsgTime,
                lmr.SessionId,
                lmr.EARFCN,
                lmr.PhyCellId,
                ROUND(lmr.RSRP,  2) AS RSRP,
                ROUND(lmr.RSRQ,  2) AS RSRQ,
                ROUND(lmr.SINR0, 2) AS SINR0,
                ROUND(lmr.SINR1, 2) AS SINR1,
                p.Latitude,
                p.Longitude,
                CASE
                    WHEN lmr.MsgTime < w.start_time THEN 'before'
                    WHEN lmr.MsgTime > w.end_time   THEN 'after'
                    ELSE 'during'
                END AS phase
            FROM win w
            INNER JOIN Sessions s
                ON  s.FileId = w.FileId
            INNER JOIN LTEMeasurementReport lmr
                ON  lmr.SessionId = s.SessionId
                AND lmr.MsgTime BETWEEN w.window_start AND w.window_end
            LEFT JOIN Position p
                ON  p.PosId = lmr.PosId
            ORDER BY lmr.MsgTime
        """, (session_id, window_sec, window_sec))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []
        conn.close()

        return {"signal": [{columns[i]: row[i] for i in range(len(columns))} for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/call_context_signal_b_side")
def get_call_context_signal_b_side(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    window_sec: int = Query(default=10, ge=5, le=300)
):
    """LTE RSRP/RSRQ in ±window_sec window for the B-side session of the call."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                         ELSE CA.SessionId END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
            ),
            b_side AS (
                SELECT TOP (1)
                    CA.SessionId AS BSessionId,
                    COALESCE(CA.FileId, S.FileId, SB.FileId) AS BFileId
                FROM CallAnalysis CA
                LEFT JOIN Sessions  S  ON S.SessionId  = CA.SessionId
                LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
                INNER JOIN pair_root PR ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'
            ),
            call_info AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    COALESCE(
                        CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp)
                    ) AS end_time
                FROM CallAnalysis CA
                INNER JOIN b_side BS ON CA.SessionId = BS.BSessionId
            ),
            b_sessions AS (
                SELECT S.SessionId AS SID
                FROM Sessions S
                CROSS JOIN b_side bs
                WHERE S.FileId = bs.BFileId

                UNION

                SELECT SB.SessionId AS SID
                FROM SessionsB SB
                CROSS JOIN b_side bs
                WHERE SB.FileId = bs.BFileId

                UNION

                SELECT bs.BSessionId AS SID
                FROM b_side bs
            ),
            win AS (
                SELECT
                    DATEADD(SECOND, -?, ci.start_time) AS window_start,
                    DATEADD(SECOND,  ?, ci.end_time)   AS window_end,
                    ci.start_time,
                    ci.end_time
                FROM call_info ci
            )
            SELECT
                lmr.MsgTime,
                lmr.SessionId,
                lmr.EARFCN,
                lmr.PhyCellId,
                ROUND(lmr.RSRP,  2) AS RSRP,
                ROUND(lmr.RSRQ,  2) AS RSRQ,
                ROUND(lmr.SINR0, 2) AS SINR0,
                ROUND(lmr.SINR1, 2) AS SINR1,
                p.Latitude,
                p.Longitude,
                CASE
                    WHEN lmr.MsgTime < w.start_time THEN 'before'
                    WHEN lmr.MsgTime > w.end_time   THEN 'after'
                    ELSE 'during'
                END AS phase
            FROM win w
            INNER JOIN b_sessions bss ON 1=1
            INNER JOIN LTEMeasurementReport lmr
                ON  lmr.SessionId = bss.SID
                AND lmr.MsgTime BETWEEN w.window_start AND w.window_end
            LEFT JOIN Position p ON p.PosId = lmr.PosId
            ORDER BY lmr.MsgTime
        """, (session_id, session_id, window_sec, window_sec))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []
        conn.close()

        return {"signal": [{columns[i]: row[i] for i in range(len(columns))} for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/gsm_context_signal_b_side")
def get_gsm_context_signal_b_side(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    window_sec: int = Query(default=10, ge=10, le=300)
):
    """GSM RxLev/RxQual in ±window_sec window for the B-side session of the call."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                         ELSE CA.SessionId END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
            ),
            b_side AS (
                SELECT TOP (1)
                    CA.SessionId AS BSessionId,
                    COALESCE(CA.FileId, S.FileId, SB.FileId) AS BFileId
                FROM CallAnalysis CA
                LEFT JOIN Sessions  S  ON S.SessionId  = CA.SessionId
                LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
                INNER JOIN pair_root PR ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'
            ),
            call_info AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp) AS end_time
                FROM CallAnalysis CA
                INNER JOIN b_side BS ON CA.SessionId = BS.BSessionId
            ),
            b_sessions AS (
                SELECT S.SessionId AS SID
                FROM Sessions S
                CROSS JOIN b_side bs
                WHERE S.FileId = bs.BFileId

                UNION

                SELECT SB.SessionId AS SID
                FROM SessionsB SB
                CROSS JOIN b_side bs
                WHERE SB.FileId = bs.BFileId

                UNION

                SELECT bs.BSessionId AS SID
                FROM b_side bs
            ),
            win AS (
                SELECT
                    DATEADD(SECOND, -?, ci.start_time) AS window_start,
                    DATEADD(SECOND,  ?, ci.end_time)   AS window_end,
                    ci.start_time,
                    ci.end_time
                FROM call_info ci
            )
            SELECT
                g.MsgTime,
                g.SessionId,
                COALESCE(g.RxLevSub,  g.RxLevFull)  AS RxLevSub,
                COALESCE(g.RxQualSub, g.RxQualFull) AS RxQualSub,
                p.Latitude,
                p.Longitude,
                CASE
                    WHEN g.MsgTime < w.start_time THEN 'before'
                    WHEN g.MsgTime > w.end_time   THEN 'after'
                    ELSE 'during'
                END AS phase
            FROM win w
            INNER JOIN b_sessions bss ON 1=1
            INNER JOIN GSMMeasReport g
                ON  g.SessionId = bss.SID
                AND g.MsgTime BETWEEN w.window_start AND w.window_end
            LEFT JOIN Position p ON p.PosId = g.PosId
            ORDER BY g.MsgTime
        """, (session_id, session_id, window_sec, window_sec))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []
        conn.close()

        return {"signal": [{columns[i]: row[i] for i in range(len(columns))} for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/call_context_technology")
def get_call_context_technology(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    window_sec: int = Query(default=10, ge=5, le=300)
):
    """Technology change events in a ±window_sec window around the call.
    Technology links via FileId so idle/data sessions before & after are included."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            ;WITH call_info AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    COALESCE(
                        CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp)
                    ) AS end_time,
                    CA.FileId
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            ),
            win AS (
                SELECT
                    DATEADD(SECOND, -?, ci.start_time) AS window_start,
                    DATEADD(SECOND,  ?, ci.end_time)   AS window_end,
                    ci.start_time,
                    ci.end_time,
                    ci.FileId
                FROM call_info ci
            )
            SELECT
                t.MsgTime,
                t.SessionId,
                t.PrevTechnology,
                t.CurrTechnology,
                t.Duration,
                t.Band,
                t.LTEDLCarriers,
                t.LTEULCarriers,
                t.NR5GDLCarriers,
                t.NR5GULCarriers,
                p.Latitude,
                p.Longitude,
                CASE
                    WHEN t.MsgTime < w.start_time THEN 'before'
                    WHEN t.MsgTime > w.end_time   THEN 'after'
                    ELSE 'during'
                END AS phase
            FROM win w
            INNER JOIN Technology t
                ON  t.FileId  = w.FileId
                AND t.MsgTime BETWEEN w.window_start AND w.window_end
            LEFT JOIN Position p
                ON  p.PosId = t.PosId
            ORDER BY t.MsgTime
        """, (session_id, window_sec, window_sec))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []
        conn.close()

        return {"technology": [{columns[i]: row[i] for i in range(len(columns))} for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
