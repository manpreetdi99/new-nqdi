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

        query += " ORDER BY CC.SessionId, CC.[Test Start TS]"

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
