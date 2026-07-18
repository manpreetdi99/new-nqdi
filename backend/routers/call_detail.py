"""Σελίδα Call Detail — γενικά στοιχεία κλήσης:
KPI tiles, call details, MOS, ResultsKPI, A/B σύγκριση, device info,
markers, handovers, voice codec, technology timeline."""
from fastapi import APIRouter, HTTPException, Query

from api_utils import _rows
from db import get_connection

router = APIRouter(tags=["call-detail"])


@router.get("/api/call_kpi_tile")
def get_call_kpi_tile(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Dashboard tile metrics for one call: download/upload, latency, avg MOS,
    jitter, packet loss, setup time. Each metric lives in a different table,
    so scalar subqueries are used instead of JOINs to avoid row fan-out."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);

            SELECT
                (SELECT ROUND(MAX(CA.setupTime) / 1000.0, 2)
                   FROM CallAnalysis CA
                  WHERE CA.SessionId = @sid)                    AS SetupTime_s,

                (SELECT ROUND(AVG(COALESCE(LQ.OptionalWB, LQ.OptionalNB)), 2)
                   FROM ResultsLQ08Avg LQ
                  WHERE LQ.SessionId = @sid)                    AS AvgMOS,

                (SELECT ROUND(AVG(CAST(v.AvgJitter AS FLOAT)), 1)
                   FROM FactVoLTE v
                  WHERE v.SessionId = @sid)                     AS Jitter_ms,

                (SELECT ROUND(AVG(v.PacketLossRate), 2)
                   FROM FactVoLTE v
                  WHERE v.SessionId = @sid)                     AS PacketLoss_pct,

                (SELECT ROUND(AVG(ipt.ThroughputKbps_DL) / 1000.0, 2)
                   FROM FactIPThroughput ipt
                  WHERE ipt.SessionId = @sid)                   AS Download_Mbps,

                (SELECT ROUND(AVG(ipt.ThroughputKbps_UL) / 1000.0, 2)
                   FROM FactIPThroughput ipt
                  WHERE ipt.SessionId = @sid)                   AS Upload_Mbps,

                (SELECT ROUND(AVG(p.RTTAverage), 0)
                   FROM FactPingSummary p
                  WHERE p.SessionId = @sid)                     AS Latency_ms;
        """, (session_id,))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        row = cursor.fetchone()
        result = {columns[idx]: row[idx] for idx in range(len(columns))} if row else {}

        conn.close()

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/call_details")
def get_call_details(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Extended CallAnalysis fields: disconnect cause, handover info, avg signal per technology."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                CA.SessionId,
                CA.technology,
                CA.StartTechnology,
                CA.EndTechnology,
                CA.CallTechnologies,
                CA.band,
                CA.setupTime,
                CA.callDuration,
                CA.disconCause,
                CA.disconClass,
                CA.disconDirection,
                CA.disconLocation,
                CA.code,
                CA.codeDescription,
                CA.LastHoType,
                CA.LastHoCause,
                CA.LastHoTimeStamp,
                CA.avgRxLev,
                CA.avgRxQual,
                CA.avgTA,
                CA.avgMsTxPwr,
                CA.avgBLER,
                CA.avgTotEcIo,
                CA.avgUETxPwr,
                CA.avgUERxPwr,
                CA.avgLQ,
                CA.avgRLT,
                CA.numOfRLTValues,
                CA.NoService,
                CA.Initializing
            FROM CallAnalysis CA
            WHERE CA.SessionId = ?
        """, (session_id,))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        row = cursor.fetchone()
        conn.close()

        if row:
            return {"callDetails": {columns[i]: row[i] for i in range(len(columns))}}
        return {"callDetails": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/call_neighbors")
def get_call_neighbors(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Prev/Next κλήση για τα κουμπιά πλοήγησης του Call Detail.
    Κάθε κλήση καταναλώνει συνήθως 2 SessionIds (A-side + B-side), οπότε ο στόχος
    είναι το ±2 — αλλά ελέγχουμε σειριακά και το ±1 (κλήσεις χωρίς B-side).
    Ίδια κριτήρια ορατότητας με το /api/calls (Sessions.Valid 0/1, όχι B-side rows).
    NULL σημαίνει ότι δεν υπάρχει prev/next κλήση → το κουμπί γίνεται disabled."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);

            SELECT
                (SELECT MAX(CA.SessionId)
                   FROM CallAnalysis CA
                   LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
                  WHERE CA.SessionId IN (@sid - 1, @sid - 2)
                    AND CA.SessionId > 0
                    AND (CA.Side <> 'B' OR CA.Side IS NULL)
                    AND (S.Valid = 1 OR S.Valid = 0))   AS PrevSessionId,

                (SELECT MIN(CA.SessionId)
                   FROM CallAnalysis CA
                   LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
                  WHERE CA.SessionId IN (@sid + 1, @sid + 2)
                    AND (CA.Side <> 'B' OR CA.Side IS NULL)
                    AND (S.Valid = 1 OR S.Valid = 0))   AS NextSessionId;
        """, (session_id,))

        row = cursor.fetchone()
        conn.close()

        return {
            "prevSessionId": row[0] if row else None,
            "nextSessionId": row[1] if row else None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/mos_values")
def get_mos_values(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT OptionalWB
              FROM [ResultsLQ08Avg]
              WHERE [SessionId] = ?
              ORDER BY MsgId
        """

        cursor.execute(query, (session_id,))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"mosValues": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/results_kpi")
def get_results_kpi(
    database: str = Query(..., min_length=1),
    session_id: str | None = Query(default=None)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT [MsgId]
                  ,[SessionId]
                  ,[TestId]
                  ,[KPIId]
                  ,[StartTime]
                  ,[EndTime]
                  ,[ErrorCode]
                  ,[Counter]
                  ,[Value1]
                  ,[Value2]
                  ,[Value3]
                  ,[Value4]
                  ,[Value5]
              FROM [ResultsKPI]
        """

        params = []
        if session_id:
            query += " WHERE [SessionId] = ?"
            params.append(session_id)

        query += " ORDER BY [MsgId]"

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"kpiValues": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/call_side_comparison")
def get_call_side_comparison(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            WITH root_session AS (
                SELECT TOP (1)
                    CASE
                        WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                        ELSE CA.SessionId
                    END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
            )
            SELECT
                CA.Side,
                CA.callStatus,
                CA.code,
                CA.codeDescription,
                COUNT(*) AS calls
            FROM CallAnalysis CA
            CROSS JOIN root_session RS
            WHERE
                (CA.Side = 'A' AND CA.SessionId = RS.ASessionId)
                OR
                (CA.Side = 'B' AND CA.SessionIdA = RS.ASessionId)
            GROUP BY
                CA.Side,
                CA.callStatus,
                CA.code,
                CA.codeDescription
            ORDER BY
                calls DESC
        """

        cursor.execute(query, (session_id, session_id))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"comparison": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/call_device_info")
def get_call_device_info(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Device & scanner info for a call: FileList fields + DmnDevice details (A-side & B-side)."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # File-level device info from FileList
        cursor.execute("""
            SELECT TOP 1
                FL.ASideDevice,
                FL.BSideDevice,
                FL.ASideNumber,
                FL.BSideNumber,
                FL.IMEI,
                FL.FirmwareV,
                FL.IMSI,
                FL.ProductVersion,
                FL.MFVersion,
                FL.SWVersion,
                FL.ASideFileName,
                FL.BSideFileName,
                FL.ASideLocation,
                FL.BSideLocation
            FROM CallAnalysis CA
            LEFT JOIN FileList FL ON FL.FileId = CA.FileId
            WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
        """, (session_id,))

        row = cursor.fetchone()
        columns = [col[0] for col in cursor.description] if cursor.description else []
        file_info = {columns[i]: row[i] for i in range(len(columns))} if row else {}

        # DmnDevice info for A-side via FactLTERadio
        a_device = None
        try:
            cursor.execute("""
                SELECT TOP 1
                    DD.Model,
                    DD.IMEI,
                    DD.IMSI,
                    DD.Firmware,
                    DD.Number,
                    DD.Side,
                    DD.DeviceType,
                    DD.RFManufacturer,
                    DD.RFModel,
                    DD.SerialNumber,
                    DD.OS,
                    DD.BaseBand
                FROM FactLTERadio FR
                LEFT JOIN DmnDevice DD ON FR.DmnIdDevice = DD.DmnId
                WHERE FR.SessionId = TRY_CONVERT(BIGINT, ?)
                  AND DD.DmnId IS NOT NULL
                ORDER BY FR.FullDate
            """, (session_id,))
            r = cursor.fetchone()
            if r:
                cols = [c[0] for c in cursor.description]
                a_device = {cols[i]: r[i] for i in range(len(cols))}
        except Exception:
            pass

        # DmnDevice info for B-side
        b_device = None
        try:
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
                SELECT TOP 1
                    DD.Model,
                    DD.IMEI,
                    DD.IMSI,
                    DD.Firmware,
                    DD.Number,
                    DD.Side,
                    DD.DeviceType,
                    DD.RFManufacturer,
                    DD.RFModel,
                    DD.SerialNumber,
                    DD.OS,
                    DD.BaseBand
                FROM FactLTERadio FR
                INNER JOIN b_side B ON FR.SessionId = B.BSessionId
                LEFT JOIN DmnDevice DD ON FR.DmnIdDevice = DD.DmnId
                WHERE DD.DmnId IS NOT NULL
                ORDER BY FR.FullDate
            """, (session_id, session_id))
            r = cursor.fetchone()
            if r:
                cols = [c[0] for c in cursor.description]
                b_device = {cols[i]: r[i] for i in range(len(cols))}
        except Exception:
            pass

        conn.close()
        return {
            "fileInfo": file_info,
            "aSideDevice": a_device,
            "bSideDevice": b_device,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/markers")
def get_markers(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT [markerId]
                  ,[SessionId]
                  ,[MsgTime]
                  ,[PosId]
                  ,[NetworkId]
                  ,[MarkerText]
              FROM [Markers]
              WHERE [SessionId] = ?
              ORDER BY MsgTime
        """

        cursor.execute(query, (session_id,))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"markers": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/handover_info")
def get_handover_info(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """All handover events during the call: status + duration. HoStatus tells you
    if the HO succeeded/failed; hoDuration is the interruption length (ms)."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT h.MsgId, h.SessionId, h.MsgTime, h.HoStatus, h.hoDuration,
                   p.Latitude, p.Longitude
            FROM HandoverInfo h
            LEFT JOIN Position p ON p.PosId = h.PosId
            WHERE h.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY h.MsgTime
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"handoverInfo": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/voice_codec")
def get_voice_codec(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Voice codec used per direction (uplink/downlink) during the call, incl. codec
    rate (kbps) and how long each codec was active. DmnVoiceCodecInformation gives the
    human-readable codec name (e.g. AMR-WB) for the raw codec id, when matched."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                vc.MsgTime,
                vc.SessionId,
                vc.Direction,
                vc.Codec,
                dvc.CodecName,
                vc.CodecRate,
                vc.Duration
            FROM VoiceCodecTest vc
            LEFT JOIN DmnVoiceCodecInformation dvc ON dvc.Codec = vc.Codec
            WHERE vc.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY vc.MsgTime
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"voiceCodec": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/technology_timeline")
def get_technology_timeline(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Technology changes during the session (PrevTechnology → CurrTechnology events)."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                t.MsgTime,
                t.PrevTechnology,
                t.CurrTechnology,
                t.Duration,
                t.Band,
                t.LTEDLCarriers,
                t.LTEULCarriers,
                t.NR5GDLCarriers,
                t.NR5GULCarriers,
                p.Latitude,
                p.Longitude
            FROM Technology t
            LEFT JOIN Position p ON p.PosId = t.PosId
            WHERE t.SessionId = ?
            ORDER BY t.MsgTime
        """, (session_id,))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []
        conn.close()

        return {"technologyTimeline": [{columns[i]: row[i] for i in range(len(columns))} for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
