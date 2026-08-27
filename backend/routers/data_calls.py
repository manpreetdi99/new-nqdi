"""Σελίδα Data Sessions: λίστα data tests (CDRCombined)."""
from fastapi import APIRouter, HTTPException, Query

from db import get_connection

router = APIRouter(tags=["data-calls"])


@router.get("/api/data_calls")
def list_data_calls(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT
                FL.ASideLocation                                    AS Location,
                CC.SessionId,
                CC.TestId,
                CC.[Test Start TS]                                  AS callStartTimeStamp,
                CC.[Test Name]                                      AS testType,
                CC.TestDirection                                    AS direction,
                CC.[Transfer Status]                                AS status,
                CC.[Scoring Status]                                 AS scoringStatus,
                CC.Host                                             AS host,
                CC.[Ping_RTT Avg (ms)]                              AS pingRttAvg,
                CC.[Transfer Throughput (kbps)]                     AS throughputKbps,
                CC.[Capacity_Sustainable Throughput (kbps)]         AS capacityThroughputKbps,
                CC.[YouTube_Avg. Video MOS]                         AS youtubeMos,
                CC.[YouTube_Number of Interuptions]                 AS youtubeInterruptions,
                CC.Technology                                       AS technology,
                CC.[Start Technology]                               AS startTechnology,
                FL.CollectionName,
                FL.ASideFileName,
                S.Valid                                             AS isValid,
                COALESCE(AC.Comment, S.InvalidReason)               AS comment,
                P.Latitude                                          AS latitude,
                P.Longitude                                         AS longitude
            FROM CDRCombined CC
            JOIN FileList FL         ON FL.FileId    = CC.FileId
            LEFT JOIN Sessions S     ON S.SessionId  = CC.SessionId
            LEFT JOIN TestInfo TI    ON TI.TestId    = CC.TestId
            LEFT JOIN Position P     ON P.PosId      = TI.PosId
            LEFT JOIN AnalysisCommentSessionsBridge ACSB ON ACSB.sessionID = CC.SessionId
            LEFT JOIN AnalysisComment AC                 ON AC.commentID   = ACSB.commentId
            WHERE (S.Valid = 1 OR S.Valid = 0 OR S.Valid IS NULL)
              AND FL.ASideLocation NOT LIKE '%Free%'
              AND FL.ASideLocation NOT LIKE '%Voice%'
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]

        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FL.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]

        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND FL.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        # Ταξινόμηση ανά location, μετά χρονολογικά (SessionId ↑ = πιο παλιό πρώτα).
        # Κάθε 6 συνεχόμενα SessionId μιας location αποτελούν ένα cycle (grouping γίνεται στο UI).
        query += " ORDER BY FL.ASideLocation, CC.SessionId, CC.TestId"

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/data_device_info")
def get_data_device_info(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Device & scanner info for a data session — same shape as /api/call_device_info
    (Scanner & Κινητό panel), but data sessions hang off Sessions/FileList instead of
    CallAnalysis (data tests have no CallAnalysis row)."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # File-level device info from FileList, same fields as call_device_info
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
            FROM Sessions S
            LEFT JOIN FileList FL ON FL.FileId = S.FileId
            WHERE S.SessionId = TRY_CONVERT(BIGINT, ?)
        """, (session_id,))

        row = cursor.fetchone()
        columns = [col[0] for col in cursor.description] if cursor.description else []
        file_info = {columns[i]: row[i] for i in range(len(columns))} if row else {}

        # DmnDevice info for the device that ran this data session
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

        # DmnDevice info for the other phone on the same trace file (B-side), if any —
        # data tests have no CallAnalysis pairing, so match on FileId + DmnDevice.Side instead.
        b_device = None
        try:
            cursor.execute("""
                ;WITH file_root AS (
                    SELECT TOP (1) S.FileId
                    FROM Sessions S
                    WHERE S.SessionId = TRY_CONVERT(BIGINT, ?)
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
                INNER JOIN Sessions S2 ON S2.SessionId = FR.SessionId
                INNER JOIN file_root FR_ROOT ON S2.FileId = FR_ROOT.FileId
                LEFT JOIN DmnDevice DD ON FR.DmnIdDevice = DD.DmnId
                WHERE DD.DmnId IS NOT NULL
                  AND DD.Side = 'B'
                ORDER BY FR.FullDate
            """, (session_id,))
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
