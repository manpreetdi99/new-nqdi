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
    """Prev/Next visible A-side call from the same measurement file, ordered by time.

    SessionId values are identifiers, not a chronological sequence: paired A/B calls,
    missing B sides and parallel devices make ``sid +/- 1`` unreliable.  FileId keeps
    navigation on the same device/route stream and the timestamp provides the order.
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);

            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE
                        WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                        ELSE CA.SessionId
                    END AS SessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = @sid OR CA.SessionIdA = @sid
                ORDER BY CASE WHEN CA.SessionId = @sid THEN 0 ELSE 1 END
            ),
            current_call AS (
                SELECT TOP (1)
                    CA.SessionId,
                    CA.FileId,
                    CA.callStartTimeStamp
                FROM CallAnalysis CA
                INNER JOIN pair_root PR ON PR.SessionId = CA.SessionId
                WHERE (CA.Side <> 'B' OR CA.Side IS NULL)
            ),
            visible_calls AS (
                SELECT
                    CA.SessionId,
                    CA.callStartTimeStamp
                FROM CallAnalysis CA
                INNER JOIN current_call CC ON CC.FileId = CA.FileId
                LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
                WHERE (CA.Side <> 'B' OR CA.Side IS NULL)
                  AND (S.Valid IN (0, 1) OR S.SessionId IS NULL)
                  AND CA.callStartTimeStamp IS NOT NULL
            )
            SELECT
                (SELECT TOP (1) VC.SessionId
                   FROM visible_calls VC
                   CROSS JOIN current_call CC
                  WHERE VC.callStartTimeStamp < CC.callStartTimeStamp
                     OR (VC.callStartTimeStamp = CC.callStartTimeStamp AND VC.SessionId < CC.SessionId)
                  ORDER BY VC.callStartTimeStamp DESC, VC.SessionId DESC) AS PrevSessionId,
                (SELECT TOP (1) VC.SessionId
                   FROM visible_calls VC
                   CROSS JOIN current_call CC
                  WHERE VC.callStartTimeStamp > CC.callStartTimeStamp
                     OR (VC.callStartTimeStamp = CC.callStartTimeStamp AND VC.SessionId > CC.SessionId)
                  ORDER BY VC.callStartTimeStamp ASC, VC.SessionId ASC) AS NextSessionId;
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
            SELECT
                COALESCE(OptionalWB, OptionalNB) AS MOS,
                OptionalWB,
                OptionalNB
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
            SELECT RK.[MsgId]
                  ,RK.[SessionId]
                  ,RK.[TestId]
                  ,RK.[KPIId]
                  ,DK.[ShortName] AS [KPIShortName]
                  ,DK.[KPIName]
                  ,DK.[KPIStatus]
                  ,RK.[StartTime]
                  ,RK.[EndTime]
                  ,RK.[ErrorCode]
                  ,RK.[Counter]
                  ,RK.[Value1]
                  ,RK.[Value2]
                  ,RK.[Value3]
                  ,RK.[Value4]
                  ,RK.[Value5]
              FROM [ResultsKPI] RK
              LEFT JOIN [DmnKPI] DK
                ON DK.[KPIId] = RK.[KPIId]
               AND DK.[ErrorCode] = RK.[ErrorCode]
        """

        params = []
        if session_id:
            query += " WHERE RK.[SessionId] = ?"
            params.append(session_id)

        query += " ORDER BY RK.[MsgId]"

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


@router.get("/api/call_srvcc_detail")
def get_call_srvcc_detail(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """SRVCC-specific events and A/B technology context for one paired call.

    ResultsKPI is the authoritative SRVCC source:
      * KPI 38040 -> 4G to 3G
      * KPI 38050 -> 4G to 2G
      * ErrorCode 0 -> success, 108003 -> known failure

    The source/target network snapshots are taken from the same side's FileId,
    immediately before the KPI start and at/after the KPI end. This keeps the
    event classification separate from the generic HandoverInfo feed.
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);

            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE
                        WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                        ELSE CA.SessionId
                    END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = @sid OR CA.SessionIdA = @sid
                ORDER BY CASE WHEN CA.SessionId = @sid THEN 0 ELSE 1 END
            ),
            paired_sessions AS (
                SELECT DISTINCT
                    CA.SessionId,
                    CASE
                        WHEN CA.SessionId = PR.ASessionId THEN 'A'
                        ELSE COALESCE(NULLIF(CA.Side, ''), 'B')
                    END AS Side,
                    CA.FileId
                FROM CallAnalysis CA
                CROSS JOIN pair_root PR
                WHERE CA.SessionId = PR.ASessionId
                   OR CA.SessionIdA = PR.ASessionId
            ),
            srvcc_events AS (
                SELECT
                    PS.Side,
                    PS.FileId,
                    RK.MsgId,
                    RK.SessionId,
                    RK.KPIId,
                    RK.StartTime,
                    RK.EndTime,
                    RK.ErrorCode,
                    RK.Duration AS InterruptionMs,
                    COALESCE(RK.StartTime, RK.EndTime) AS EventTime,
                    COALESCE(
                        RK.EndTime,
                        DATEADD(MILLISECOND, TRY_CONVERT(INT, RK.Duration), RK.StartTime),
                        RK.StartTime
                    ) AS TargetTime
                FROM paired_sessions PS
                INNER JOIN ResultsKPI RK ON RK.SessionId = PS.SessionId
                WHERE RK.KPIId IN (38040, 38050)
            )
            SELECT
                E.Side,
                E.MsgId,
                E.SessionId,
                E.KPIId,
                CASE E.KPIId
                    WHEN 38040 THEN '4G->3G'
                    WHEN 38050 THEN '4G->2G'
                    ELSE 'N/A'
                END AS HandoverType,
                E.ErrorCode,
                CASE
                    WHEN E.ErrorCode = 0 THEN 'Success'
                    WHEN E.ErrorCode = 108003 THEN 'Fail'
                    ELSE 'Unknown'
                END AS Status,
                E.EventTime,
                E.TargetTime,
                E.InterruptionMs,

                SRC.MsgTime AS SourceTime,
                SRC.Technology AS SourceTechnology,
                SRC.RFBand AS SourceBand,
                SRC.CGI AS SourceCGI,
                SRC.CID AS SourceCellId,
                SRC.LAC AS SourceLAC,
                SRC.RAC AS SourceRAC,
                SRC.BCCH AS SourceBCCH,
                SRC.BSIC AS SourceBSIC,
                SRC.Operator AS SourceOperator,
                SRC.MCC AS SourceMCC,
                SRC.MNC AS SourceMNC,

                TGT.MsgTime AS TargetNetworkTime,
                TGT.Technology AS TargetTechnology,
                TGT.RFBand AS TargetBand,
                TGT.CGI AS TargetCGI,
                TGT.CID AS TargetCellId,
                TGT.LAC AS TargetLAC,
                TGT.RAC AS TargetRAC,
                TGT.BCCH AS TargetBCCH,
                TGT.BSIC AS TargetBSIC,
                TGT.Operator AS TargetOperator,
                TGT.MCC AS TargetMCC,
                TGT.MNC AS TargetMNC,

                LTE.FullDate AS SourceRadioTime,
                LTE.EARFCN AS SourceEARFCN,
                LTE.PhyCellId AS SourcePCI,
                LTE.CGI AS SourceRadioCGI,
                ROUND(LTE.RSRP, 2) AS SourceRSRP,
                ROUND(LTE.RSRQ, 2) AS SourceRSRQ,
                ROUND(LTE.SINR, 2) AS SourceSINR,
                ROUND(LTE.RSSI, 2) AS SourceRSSI,
                LTE.DLBandWidth AS SourceDLBandwidth,
                LTE.ULBandWidth AS SourceULBandwidth,

                GSM.FullDate AS TargetRadioTime,
                GSM.band AS TargetRadioBand,
                GSM.CGI AS TargetRadioCGI,
                ROUND(GSM.RxLevSub, 2) AS TargetRxLev,
                ROUND(GSM.RxQualSub, 2) AS TargetRxQual
            FROM srvcc_events E
            OUTER APPLY (
                SELECT TOP (1)
                    NI.MsgTime, NI.Technology, NI.RFBand, NI.CGI, NI.CID,
                    NI.LAC, NI.RAC, NI.BCCH, NI.BSIC, NI.Operator, NI.MCC, NI.MNC
                FROM NetworkInfo NI
                WHERE NI.FileId = E.FileId
                  AND NI.MsgTime <= E.EventTime
                ORDER BY NI.MsgTime DESC
            ) SRC
            OUTER APPLY (
                SELECT TOP (1)
                    NI.MsgTime, NI.Technology, NI.RFBand, NI.CGI, NI.CID,
                    NI.LAC, NI.RAC, NI.BCCH, NI.BSIC, NI.Operator, NI.MCC, NI.MNC
                FROM NetworkInfo NI
                WHERE NI.FileId = E.FileId
                  AND NI.MsgTime >= E.TargetTime
                ORDER BY NI.MsgTime
            ) TGT
            OUTER APPLY (
                SELECT TOP (1)
                    FR.FullDate, FR.EARFCN, FR.PhyCellId, FR.CGI,
                    FR.RSRP, FR.RSRQ, FR.SINR, FR.RSSI,
                    FR.DLBandWidth, FR.ULBandWidth
                FROM FactLTERadio FR
                WHERE FR.SessionId = E.SessionId
                  AND FR.FullDate <= E.EventTime
                ORDER BY FR.FullDate DESC
            ) LTE
            OUTER APPLY (
                SELECT TOP (1)
                    FG.FullDate, FG.band, FG.CGI, FG.RxLevSub, FG.RxQualSub
                FROM FactGSMRadio FG
                WHERE FG.SessionId = E.SessionId
                  AND FG.FullDate >= E.TargetTime
                  AND (FG.RxLevSub IS NOT NULL OR FG.RxQualSub IS NOT NULL)
                ORDER BY FG.FullDate
            ) GSM
            ORDER BY E.EventTime, E.Side;
        """, (session_id,))
        events = _rows(cursor)

        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);

            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE
                        WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                        ELSE CA.SessionId
                    END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = @sid OR CA.SessionIdA = @sid
                ORDER BY CASE WHEN CA.SessionId = @sid THEN 0 ELSE 1 END
            ),
            paired_sessions AS (
                SELECT DISTINCT
                    CA.SessionId,
                    CASE
                        WHEN CA.SessionId = PR.ASessionId THEN 'A'
                        ELSE COALESCE(NULLIF(CA.Side, ''), 'B')
                    END AS Side
                FROM CallAnalysis CA
                CROSS JOIN pair_root PR
                WHERE CA.SessionId = PR.ASessionId
                   OR CA.SessionIdA = PR.ASessionId
            )
            SELECT
                PS.Side,
                T.MsgTime,
                T.SessionId,
                T.PrevTechnology,
                T.CurrTechnology,
                T.Duration,
                T.Band,
                T.LTEDLCarriers,
                T.LTEULCarriers,
                T.NR5GDLCarriers,
                T.NR5GULCarriers
            FROM paired_sessions PS
            INNER JOIN Technology T ON T.SessionId = PS.SessionId
            ORDER BY T.MsgTime, PS.Side;
        """, (session_id,))
        technology = _rows(cursor)

        conn.close()
        return {"events": events, "technology": technology}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/call_csfb_detail")
def get_call_csfb_detail(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """CSFB (CS Fallback) events and A/B technology context for one paired call.

    Το CSFB ανάλογο του /api/call_srvcc_detail: το UE είναι σε LTE, η κλήση δεν
    μπορεί να γίνει VoLTE, οπότε το δίκτυο το ρίχνει σε 2G/3G (redirect ή
    PS handover), η κλήση στήνεται εκεί και στο τέλος το UE γυρίζει σε LTE.

    Το ResultsKPI είναι και εδώ η αυθεντική πηγή — μια ολόκληρη οικογένεια
    "Voice(LTE CSFB)" KPIs, ένα ανά φάση της μετάβασης:

      * 10181 -> Radio Redirect            (RRCConnectionRelease με redirect)
      * 10180 -> Radio Fallback Delay      (redirect -> camp στο 2G/3G)
      * 10182 -> Technology Change Delay   (συνολική αλλαγή τεχνολογίας)
      * 10175 -> Telephony Fallback Delay  (ESR -> πρώτο CS μήνυμα)
      * 10171 -> Telephony CS Fallback Delay
      * 10178 -> Telephony Service         (ESR -> έτοιμη CS υπηρεσία)
      * 10170 / 10184 -> Telephony / Telephony Service AB
      * 30180 -> Telephony Return Delay    (επιστροφή σε LTE, κοινό με SRVCC)

    ErrorCode 0 -> success· οτιδήποτε άλλο είναι αποτυχία με το μήνυμα να
    διαβάζεται από το DmnError (108003 Timeout, 108005 End Trigger missing, ...)
    αντί για hardcoded λίστα.

    Προσοχή στο ποιες πλευρές μετράνε ως CSFB: τα 10171/30180 εμφανίζονται και σε
    SRVCC σκέλη (το 30180 λέγεται κυριολεκτικά "CSFB/SRVCC") και το 10184 είναι
    μέτρηση του ζευγαριού που γράφεται στο A ακόμη κι όταν έπεσε σε 2G μόνο το B.
    Γι' αυτό μια πλευρά περνά ως CSFB μόνο αν έχει τουλάχιστον ένα από τα "core"
    KPIs (10170/10175/10178/10180/10181/10182) — χωρίς αυτό εμφανίζονταν άδεια
    CSFB events χωρίς target cell στην πλευρά που δεν έπεσε ποτέ σε 2G.

    Δεν αρκεί το callmode της κλήσης για να ξέρεις αν υπάρχει CSFB: στα δεδομένα,
    τα περισσότερα CSFB σκέλη κρέμονται από ζευγάρι που είναι περασμένο VoLTE/CS/
    SRVCC (το ένα κινητό μιλάει VoLTE και το άλλο πέφτει σε 2G), γι' αυτό το
    endpoint καλείται για κάθε κλήση και απλώς γυρίζει άδειο όταν δεν υπάρχει.
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # ── 1. Μία σύνοψη ανά πλευρά: χρόνοι, διάρκειες φάσεων, source/target cell ──
        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);

            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE
                        WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                        ELSE CA.SessionId
                    END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = @sid OR CA.SessionIdA = @sid
                ORDER BY CASE WHEN CA.SessionId = @sid THEN 0 ELSE 1 END
            ),
            paired_sessions AS (
                SELECT DISTINCT
                    CA.SessionId,
                    CASE
                        WHEN CA.SessionId = PR.ASessionId THEN 'A'
                        ELSE COALESCE(NULLIF(CA.Side, ''), 'B')
                    END AS Side,
                    CA.FileId
                FROM CallAnalysis CA
                CROSS JOIN pair_root PR
                WHERE CA.SessionId = PR.ASessionId
                   OR CA.SessionIdA = PR.ASessionId
            ),
            -- DISTINCT: το ResultsKPI κρατά το ίδιο KPI/MsgId δύο φορές σε αρκετές
            -- κλήσεις, οπότε χωρίς αυτό κάθε φάση μετριόταν διπλή.
            kpi AS (
                SELECT DISTINCT
                    PS.Side, PS.FileId, PS.SessionId,
                    RK.KPIId, RK.MsgId, RK.StartTime, RK.EndTime, RK.ErrorCode,
                    RK.Duration AS DurationMs
                FROM paired_sessions PS
                INNER JOIN ResultsKPI RK ON RK.SessionId = PS.SessionId
                WHERE RK.KPIId IN (10170, 10171, 10175, 10178, 10180, 10181, 10182, 10184, 30180)
            ),
            anchors AS (
                SELECT
                    Side, FileId, SessionId,
                    -- Το 30180 (επιστροφή σε LTE) είναι ΜΕΤΑ την κλήση, οπότε μένει
                    -- έξω από τα όρια της ίδιας της πτώσης σε 2G/3G.
                    MIN(CASE WHEN KPIId <> 30180 THEN StartTime END) AS FallbackStart,
                    MAX(CASE WHEN KPIId <> 30180 THEN COALESCE(EndTime, StartTime) END) AS FallbackEnd,
                    MAX(CASE WHEN KPIId = 10181 THEN COALESCE(EndTime, StartTime) END) AS RedirectTime,
                    MIN(CASE WHEN KPIId = 30180 THEN StartTime END) AS ReturnStart,
                    MAX(CASE WHEN KPIId = 30180 THEN COALESCE(EndTime, StartTime) END) AS ReturnEnd,
                    MAX(CASE WHEN KPIId = 10181 THEN DurationMs END) AS RadioRedirectMs,
                    MAX(CASE WHEN KPIId = 10180 THEN DurationMs END) AS RadioFallbackMs,
                    MAX(CASE WHEN KPIId = 10182 THEN DurationMs END) AS TechChangeMs,
                    MAX(CASE WHEN KPIId = 10175 THEN DurationMs END) AS TelephonyFallbackMs,
                    MAX(CASE WHEN KPIId = 10171 THEN DurationMs END) AS CsFallbackDelayMs,
                    MAX(CASE WHEN KPIId = 10178 THEN DurationMs END) AS TelephonyServiceMs,
                    MAX(CASE WHEN KPIId = 30180 THEN DurationMs END) AS ReturnDelayMs,
                    MAX(CASE WHEN KPIId = 10178 THEN ErrorCode END) AS ServiceErrorCode,
                    MAX(CASE WHEN KPIId = 10175 THEN ErrorCode END) AS FallbackErrorCode,
                    COUNT(CASE WHEN KPIId IN (10170, 10175, 10178, 10180, 10181, 10182) THEN 1 END) AS CoreKpis
                FROM kpi
                GROUP BY Side, FileId, SessionId
            )
            SELECT
                A.Side,
                A.SessionId,
                A.FallbackStart,
                A.FallbackEnd,
                A.RedirectTime,
                A.ReturnStart,
                A.ReturnEnd,
                A.RadioRedirectMs,
                A.RadioFallbackMs,
                A.TechChangeMs,
                A.TelephonyFallbackMs,
                A.CsFallbackDelayMs,
                A.TelephonyServiceMs,
                A.ReturnDelayMs,
                COALESCE(A.ServiceErrorCode, A.FallbackErrorCode) AS ErrorCode,
                ERR.msg AS ErrorMessage,
                CASE
                    WHEN COALESCE(A.ServiceErrorCode, A.FallbackErrorCode) = 0 THEN 'Success'
                    WHEN COALESCE(A.ServiceErrorCode, A.FallbackErrorCode) IS NULL THEN 'Unknown'
                    ELSE 'Fail'
                END AS Status,
                -- Πόσο έμεινε το UE χωρίς serving cell: από την αρχή του fallback μέχρι
                -- να φανεί η πρώτη 2G/3G κυψέλη στο NetworkInfo.
                DATEDIFF(MILLISECOND, A.FallbackStart, TGT.MsgTime) AS RadioGapMs,

                SRC.MsgTime AS SourceTime,
                SRC.Technology AS SourceTechnology,
                SRC.RFBand AS SourceRFBand,
                SRC.CGI AS SourceCGI,
                SRC.CID AS SourceCellId,
                SRC.LAC AS SourceLAC,
                SRC.BCCH AS SourceEARFCN,
                SRC.Operator AS SourceOperator,

                TGT.MsgTime AS TargetTime,
                TGT.Technology AS TargetTechnology,
                TGT.RFBand AS TargetRFBand,
                TGT.CGI AS TargetCGI,
                TGT.CID AS TargetCellId,
                TGT.LAC AS TargetLAC,
                TGT.RAC AS TargetRAC,
                TGT.BCCH AS TargetBCCH,
                TGT.BSIC AS TargetBSIC,
                TGT.Operator AS TargetOperator,

                RET.MsgTime AS ReturnTime,
                RET.Technology AS ReturnTechnology,
                RET.CGI AS ReturnCGI,

                LTE.FullDate AS SourceRadioTime,
                LTE.EARFCN AS SourceRadioEARFCN,
                LTE.PhyCellId AS SourcePCI,
                LTE.CGI AS SourceRadioCGI,
                ROUND(LTE.RSRP, 2) AS SourceRSRP,
                ROUND(LTE.RSRQ, 2) AS SourceRSRQ,
                ROUND(LTE.SINR, 2) AS SourceSINR,

                GSM.FullDate AS TargetRadioTime,
                GSM.band AS TargetRadioBand,
                GSM.CGI AS TargetRadioCGI,
                ROUND(GSM.RxLevSub, 2) AS TargetRxLev,
                ROUND(GSM.RxQualSub, 2) AS TargetRxQual
            FROM anchors A
            LEFT JOIN DmnError ERR
                   ON ERR.code = COALESCE(A.ServiceErrorCode, A.FallbackErrorCode)
                  AND ERR.type = 0
            OUTER APPLY (
                SELECT TOP (1)
                    NI.MsgTime, NI.Technology, NI.RFBand, NI.CGI, NI.CID,
                    NI.LAC, NI.BCCH, NI.Operator
                FROM NetworkInfo NI
                WHERE NI.FileId = A.FileId
                  AND NI.MsgTime <= A.FallbackStart
                ORDER BY NI.MsgTime DESC
            ) SRC
            -- Target = η πρώτη 2G/3G κυψέλη μετά την αρχή του fallback. Το "πρώτο
            -- NetworkInfo μετά το τέλος του KPI" (όπως στο SRVCC) δεν δουλεύει εδώ:
            -- σε αποτυχημένα fallback το 10178 τελειώνει αφού το UE έχει ήδη γυρίσει
            -- σε LTE, οπότε έδειχνε LTE ως "target".
            OUTER APPLY (
                SELECT TOP (1)
                    NI.MsgTime, NI.Technology, NI.RFBand, NI.CGI, NI.CID,
                    NI.LAC, NI.RAC, NI.BCCH, NI.BSIC, NI.Operator
                FROM NetworkInfo NI
                WHERE NI.FileId = A.FileId
                  AND NI.MsgTime >= A.FallbackStart
                  AND (NI.Technology LIKE 'GSM%' OR NI.Technology LIKE 'UMTS%' OR NI.Technology LIKE 'WCDMA%')
                ORDER BY NI.MsgTime
            ) TGT
            OUTER APPLY (
                SELECT TOP (1)
                    NI.MsgTime, NI.Technology, NI.CGI
                FROM NetworkInfo NI
                WHERE NI.FileId = A.FileId
                  AND A.ReturnStart IS NOT NULL
                  AND NI.MsgTime >= A.ReturnStart
                  AND (NI.Technology LIKE 'LTE%' OR NI.Technology LIKE 'NR%')
                ORDER BY NI.MsgTime
            ) RET
            OUTER APPLY (
                SELECT TOP (1)
                    FR.FullDate, FR.EARFCN, FR.PhyCellId, FR.CGI, FR.RSRP, FR.RSRQ, FR.SINR
                FROM FactLTERadio FR
                WHERE FR.SessionId = A.SessionId
                  AND FR.FullDate <= A.FallbackStart
                ORDER BY FR.FullDate DESC
            ) LTE
            OUTER APPLY (
                SELECT TOP (1)
                    FG.FullDate, FG.band, FG.CGI, FG.RxLevSub, FG.RxQualSub
                FROM FactGSMRadio FG
                WHERE FG.SessionId = A.SessionId
                  AND FG.FullDate >= A.FallbackStart
                  AND (FG.RxLevSub IS NOT NULL OR FG.RxQualSub IS NOT NULL)
                ORDER BY FG.FullDate
            ) GSM
            WHERE A.CoreKpis > 0
            ORDER BY A.FallbackStart, A.Side;
        """, (session_id,))
        events = _rows(cursor)

        # ── 2. Οι επιμέρους φάσεις, μία γραμμή ανά KPI, για τον πίνακα βημάτων ──
        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);

            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE
                        WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                        ELSE CA.SessionId
                    END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = @sid OR CA.SessionIdA = @sid
                ORDER BY CASE WHEN CA.SessionId = @sid THEN 0 ELSE 1 END
            ),
            paired_sessions AS (
                SELECT DISTINCT
                    CA.SessionId,
                    CASE
                        WHEN CA.SessionId = PR.ASessionId THEN 'A'
                        ELSE COALESCE(NULLIF(CA.Side, ''), 'B')
                    END AS Side
                FROM CallAnalysis CA
                CROSS JOIN pair_root PR
                WHERE CA.SessionId = PR.ASessionId
                   OR CA.SessionIdA = PR.ASessionId
            ),
            steps AS (
                SELECT DISTINCT
                    PS.Side, PS.SessionId, RK.KPIId, RK.MsgId,
                    RK.StartTime, RK.EndTime, RK.ErrorCode, RK.Duration AS DurationMs
                FROM paired_sessions PS
                INNER JOIN ResultsKPI RK ON RK.SessionId = PS.SessionId
                WHERE RK.KPIId IN (10170, 10171, 10175, 10178, 10180, 10181, 10182, 10184, 30180)
            )
            SELECT
                S.Side,
                S.SessionId,
                S.KPIId,
                S.MsgId,
                CASE S.KPIId
                    WHEN 10181 THEN 'Radio Redirect'
                    WHEN 10180 THEN 'Radio Fallback Delay'
                    WHEN 10182 THEN 'Technology Change Delay'
                    WHEN 10175 THEN 'Telephony Fallback Delay'
                    WHEN 10171 THEN 'Telephony CS Fallback Delay'
                    WHEN 10178 THEN 'Telephony Service'
                    WHEN 10170 THEN 'Telephony'
                    WHEN 10184 THEN 'Telephony Service AB'
                    WHEN 30180 THEN 'Telephony Return Delay'
                    ELSE 'KPI ' + CAST(S.KPIId AS VARCHAR(10))
                END AS StepName,
                CASE WHEN S.KPIId = 30180 THEN 'return' ELSE 'fallback' END AS Phase,
                S.StartTime,
                S.EndTime,
                S.DurationMs,
                S.ErrorCode,
                ERR.msg AS ErrorMessage,
                CASE
                    WHEN S.ErrorCode = 0 THEN 'Success'
                    WHEN S.ErrorCode IS NULL THEN 'Unknown'
                    ELSE 'Fail'
                END AS Status
            FROM steps S
            LEFT JOIN DmnError ERR ON ERR.code = S.ErrorCode AND ERR.type = 0
            ORDER BY S.Side, S.StartTime, S.KPIId;
        """, (session_id,))
        steps = _rows(cursor)

        # ── 3. Ίδιο technology context με το SRVCC, για το ίδιο διάγραμμα ──
        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);

            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE
                        WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                        ELSE CA.SessionId
                    END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = @sid OR CA.SessionIdA = @sid
                ORDER BY CASE WHEN CA.SessionId = @sid THEN 0 ELSE 1 END
            ),
            paired_sessions AS (
                SELECT DISTINCT
                    CA.SessionId,
                    CASE
                        WHEN CA.SessionId = PR.ASessionId THEN 'A'
                        ELSE COALESCE(NULLIF(CA.Side, ''), 'B')
                    END AS Side
                FROM CallAnalysis CA
                CROSS JOIN pair_root PR
                WHERE CA.SessionId = PR.ASessionId
                   OR CA.SessionIdA = PR.ASessionId
            )
            SELECT
                PS.Side,
                T.MsgTime,
                T.SessionId,
                T.PrevTechnology,
                T.CurrTechnology,
                T.Duration,
                T.Band
            FROM paired_sessions PS
            INNER JOIN Technology T ON T.SessionId = PS.SessionId
            ORDER BY T.MsgTime, PS.Side;
        """, (session_id,))
        technology = _rows(cursor)

        conn.close()
        return {"events": events, "steps": steps, "technology": technology}
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
