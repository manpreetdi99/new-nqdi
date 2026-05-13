from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from db import get_connection, get_available_databases
import time
import os
import openpyxl

# ---- Antennas cache ----
_antennas_cache: list[dict] | None = None

ANTENNAS_EXCEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "cosmote all antennas",
    "geo4g.xlsx"
)

def _load_antennas() -> list[dict]:
    global _antennas_cache
    if _antennas_cache is not None:
        return _antennas_cache

    wb = openpyxl.load_workbook(ANTENNAS_EXCEL_PATH, read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(min_row=1, values_only=True)
    header = next(rows_iter)
    # Column indices (0-based)
    lat_idx      = header.index("Latitude_Sector")
    lon_idx      = header.index("Longitude_Sector")
    site_idx     = header.index("SiteID")
    cell_idx     = header.index("Cell_ID")
    name_idx     = header.index("CellName")
    az_idx       = header.index("Azimuth")
    freq_idx     = header.index("FREQUENCY")
    vendor_idx   = header.index("VENDOR")
    enb_idx      = header.index("ENB_NAME")
    tech_idx     = header.index("Technology")
    status_idx   = header.index("TECHSTATUS")
    pci_idx      = header.index("PCI")
    tilt_idx     = header.index("Downtilt")
    ht_idx       = header.index("HT")

    result = []
    for row in rows_iter:
        lat = row[lat_idx]
        lon = row[lon_idx]
        if lat is None or lon is None:
            continue
        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError):
            continue
        result.append({
            "lat": lat,
            "lon": lon,
            "siteId":   row[site_idx],
            "cellId":   row[cell_idx],
            "cellName": row[name_idx],
            "azimuth":  row[az_idx],
            "freq":     row[freq_idx],
            "vendor":   row[vendor_idx],
            "enbName":  row[enb_idx],
            "tech":     row[tech_idx],
            "status":   row[status_idx],
            "pci":      row[pci_idx],
            "downtilt": row[tilt_idx],
            "height":   row[ht_idx],
        })
    wb.close()
    _antennas_cache = result
    return result

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # μετά μπορείς να το περιορίσεις
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from typing import Union

class QueryRequest(BaseModel):
    database: str
    queries: list[str]

class CommentRequest(BaseModel):
    database: str
    session_id: Union[str, int]
    comment: str | None = ""

@app.post("/api/calls/comment")
def update_call_comment(req: CommentRequest):
    try:
        conn = get_connection(req.database)
        cursor = conn.cursor()

        # Check if comment already exists in AnalysisComment
        cursor.execute("SELECT commentID FROM AnalysisComment WHERE Comment = ?", (req.comment,))
        row = cursor.fetchone()
        
        if row:
            comment_id = row[0]
        else:
            try:
                # We must insert it. In SQL Server OUTPUT INSERTED is supported.
                cursor.execute("INSERT INTO AnalysisComment (Comment) OUTPUT INSERTED.commentID VALUES (?)", (req.comment,))
                comment_id = cursor.fetchone()[0]
            except Exception as e:
                # Fallback if OUTPUT INSERTED is not supported or identity fails
                cursor.execute("INSERT INTO AnalysisComment (Comment) VALUES (?)", (req.comment,))
                cursor.execute("SELECT @@IDENTITY")
                comment_id = cursor.fetchone()[0]

        # check if it exists in bridge
        cursor.execute("SELECT sessionID FROM AnalysisCommentSessionsBridge WHERE sessionID = ?", (req.session_id,))
        if cursor.fetchone():
            cursor.execute("UPDATE AnalysisCommentSessionsBridge SET commentId = ? WHERE sessionID = ?", (comment_id, req.session_id))
        else:
            cursor.execute("INSERT INTO AnalysisCommentSessionsBridge (sessionID, commentId) VALUES (?, ?)", (req.session_id, comment_id))
            
        # If comment starts with 'fake' or 'FAKE', set session as invalid (Valid = 0), otherwise Valid = 1
        if req.comment and req.comment.lower().startswith("fake"):
            cursor.execute("UPDATE Sessions SET Valid = 0 WHERE SessionId = ?", (req.session_id,))
        else:
            cursor.execute("UPDATE Sessions SET Valid = 1 WHERE SessionId = ?", (req.session_id,))

        conn.commit()
        conn.close()

        return {"message": "Comment updated successfully"}
    except Exception as e:
        print(f"Error in update_call_comment bridge update: {e}")
        # If the above fails because of missing table, fallback to updating Sessions.InvalidReason
        try:
            conn = get_connection(req.database)
            cursor = conn.cursor()
            cursor.execute("UPDATE Sessions SET InvalidReason = ? WHERE SessionId = ?", (req.comment, req.session_id))
            if req.comment and req.comment.lower().startswith("fake"):
                cursor.execute("UPDATE Sessions SET Valid = 0 WHERE SessionId = ?", (req.session_id,))
            else:
                cursor.execute("UPDATE Sessions SET Valid = 1 WHERE SessionId = ?", (req.session_id,))
            conn.commit()
            conn.close()
            return {"message": "Comment updated successfully in Sessions"}
        except Exception as fallback_e:
            print(f"Fallback Error in update_call_comment: {fallback_e}")
            raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/calls")
def list_calls(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT
                DF.ASideLocation AS Location,
                CA.SessionId,
                CA.technology as technology,
                CA.callmode AS callMode,
                CA.callType,
                CA.callDir,
                CA.callStatus AS status,
                DF.CollectionName,
                COALESCE(S.startTime, SB.startTime) AS callStartTimeStamp,
                ROUND(CA.setupTime, 2) AS setupTime,
                (SELECT ROUND(AVG(OptionalWB),2) AS MOS
                    FROM ResultsLQ08Avg 
                    WHERE SessionId = CA.SessionId) AS Avg_mos,
                (ca.callDuration/1000) as callDuration,
                COALESCE (AC.Comment, s.InvalidReason) AS comment,
                DF.ASideFileName,
                POS.Latitude AS latitude,
                POS.Longitude AS longitude,
                S.Valid AS isValid
            FROM CallAnalysis CA
            LEFT JOIN FileList DF ON CA.FileId = DF.FileId
            LEFT JOIN Position POS ON CA.PosId = POS.PosId
            LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
            LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
			LEFT JOIN AnalysisCommentSessionsBridge ACSB ON ACSB.sessionID = CA.SessionId
			LEFT JOIN AnalysisComment AC ON ACSB.commentId = AC.commentID
            WHERE (S.Valid = 1 or S.Valid = 0)
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]

        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND DF.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]

        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND DF.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        query += " ORDER BY callStartTimeStamp"

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


@app.get("/api/data_calls")
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


@app.get("/api/locations")
def list_locations(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT DISTINCT ASideLocation
            FROM FileList
            WHERE ASideLocation IS NOT NULL
        """
        params = []
        
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND CollectionName IN ({placeholders})"
            params.extend(selected_collections)
            
        query += " ORDER BY ASideLocation"

        cursor.execute(query, tuple(params))

        rows = cursor.fetchall()
        conn.close()

        return {"locations": [row[0] for row in rows if row[0]]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/databases")
def list_databases():
    try:
        return {"databases": get_available_databases()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/benchmark")
def run_benchmark(req: QueryRequest):
    try:
        conn = get_connection(req.database)
        cursor = conn.cursor()

        results = []
        total_start = time.time()

        for i, query in enumerate(req.queries):
            q_start = time.time()
            cursor.execute(query)

            columns = [col[0] for col in cursor.description] if cursor.description else []
            rows = cursor.fetchall() if cursor.description else []

            data = []
            for row in rows:
                data.append({columns[idx]: row[idx] for idx in range(len(columns))})

            exec_ms = round((time.time() - q_start) * 1000)

            results.append({
                "id": f"result-{i}",
                "queryLabel": f"Query {i+1}",
                "executionTime": exec_ms,
                "rowsReturned": len(data),
                "columns": columns,
                "data": data
            })

        conn.close()

        total_time = round((time.time() - total_start) * 1000)

        return {
            "results": results,
            "totalTime": total_time
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/collections")
def list_collections(database: str = Query(..., min_length=1)):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT DISTINCT CollectionName
            FROM filelist
            WHERE CollectionName IS NOT NULL
            ORDER BY CollectionName
        """)

        rows = cursor.fetchall()
        conn.close()

        return {"collections": [row[0] for row in rows if row[0]]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/lte_values")
def get_lte_values(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT lmr.[MsgId]
                  ,lmr.[SessionId]
                  ,lmr.[MsgTime]
                  ,lmr.[PosId]
                  ,lmr.[NetworkId]
                  ,lmr.[EARFCN]
                  ,lmr.[PhyCellId]
                  ,round(lmr.[RSRP], 2) AS [RSRP]
                  ,round(lmr.[RSRQ], 2) AS [RSRQ]
                  ,round(lmr.[SINR0], 2) AS [SINR0]
                  ,round(lmr.[SINR1], 2) AS [SINR1]
                  ,lmr.[LTEServingCellInfoId]
                  ,p.Latitude
                  ,p.Longitude
              FROM [LTEMeasurementReport] lmr
              LEFT JOIN Position p ON p.PosId = lmr.PosId
              WHERE lmr.[SessionId] = ?
              ORDER BY lmr.MsgTime
        """

        cursor.execute(query, (session_id,))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"lteValues": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cell_info")
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


@app.get("/api/cell_info_b_side")
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


@app.get("/api/lte_values_b_side")
def get_lte_values_b_side(
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
                L.SessionId,
                L.MsgTime,
                L.PosId,
                L.EARFCN,
                ROUND(L.RSRP, 2) AS RSRP,
                ROUND(L.RSRQ, 2) AS RSRQ,
                ROUND(L.SINR0, 2) AS SINR0,
                ROUND(L.SINR1, 2) AS SINR1,
                P.Latitude,
                P.Longitude
            FROM LTEMeasurementReport L
            INNER JOIN b_side B
                ON L.SessionId = B.BSessionId
            LEFT JOIN Position P
                ON P.PosId = L.PosId
            ORDER BY L.MsgTime
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

@app.get("/api/markers")
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

@app.get("/api/gsm_values")
def get_gsm_values(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT g.[MsgId]
                  ,g.[SessionId]
                  ,g.[MsgTime]
                  ,g.[PosId]
                  ,g.[NetworkId]
                  ,g.[RxLevSub]
                  ,g.[RxQualSub]
                  ,p.Latitude
                  ,p.Longitude
              FROM [GSMMeasReport] g
              LEFT JOIN Position p ON p.PosId = g.PosId
              WHERE g.[SessionId] = ?
              ORDER BY g.MsgTime
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

@app.get("/api/gsm_values_b_side")
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
                G.[MsgId],
                G.[SessionId],
                G.[MsgTime],
                G.[PosId],
                G.[NetworkId],
                G.[RxLevSub],
                G.[RxQualSub]
            FROM [GSMMeasReport] G
            INNER JOIN b_side B
                ON G.SessionId = B.BSessionId
            ORDER BY G.MsgTime
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

@app.get("/api/mos_values")
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

@app.get("/api/results_kpi")
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

@app.get("/api/tracelog_values")
def get_tracelog_values(
    database: str = Query(..., min_length=1),
    session_id: str | None = Query(default=None)
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
            sessions_to_include AS (
                SELECT PR.ASessionId AS SessionId
                FROM pair_root PR
                WHERE PR.ASessionId IS NOT NULL

                UNION

                SELECT CA.SessionId AS SessionId
                FROM CallAnalysis CA
                INNER JOIN pair_root PR
                    ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'

                UNION

                SELECT TRY_CONVERT(BIGINT, ?)
                WHERE TRY_CONVERT(BIGINT, ?) IS NOT NULL
            )
            SELECT
                TL.[FactId],
                TL.[FullDate],
                TL.[Side],
                TL.[SessionId],
                TL.[Info]
            FROM [dbo].[FactSystemTraceLog] TL
            INNER JOIN sessions_to_include SI
                ON TL.[SessionId] = SI.[SessionId]
            ORDER BY TL.[FullDate], TL.[FactId]
        """

        cursor.execute(query, (session_id, session_id, session_id, session_id))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"tracelogValues": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/api/call_side_comparison")
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


@app.get("/api/antennas")
def get_antennas(
    freq: list[int] | None = Query(default=None),
    vendor: list[str] | None = Query(default=None),
    status: str | None = Query(default=None),
):
    """Return all 4G antenna sectors from geo4g.xlsx.
    Optional filters: freq (e.g. 1800, 2100), vendor, status (ACTIVATED/DEACTIVATED).
    First call loads & caches the file (~3-5s); subsequent calls are instant.
    """
    try:
        antennas = _load_antennas()
        result = antennas

        if freq:
            freq_set = set(freq)
            result = [a for a in result if a["freq"] in freq_set]

        if vendor:
            vendor_set = {v.lower() for v in vendor}
            result = [a for a in result if (a["vendor"] or "").lower() in vendor_set]

        if status:
            result = [a for a in result if (a["status"] or "").upper() == status.upper()]

        return {"antennas": result, "total": len(result)}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="geo4g.xlsx not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Call context: signal & technology window around a call ──────────────────

@app.get("/api/call_context_signal")
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


@app.get("/api/call_context_technology")
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


# ── Extra per-call detail endpoints ────────────────────────────────────────

@app.get("/api/call_details")
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


@app.get("/api/technology_timeline")
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


@app.get("/api/lte_neighbors")
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


@app.get("/api/call_paging_info")
def get_call_paging_info(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    before_seconds: int = Query(default=60, ge=0, le=600),
    after_seconds: int = Query(default=60, ge=0, le=600),
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        def fetch_dicts():
            columns = [col[0] for col in cursor.description] if cursor.description else []
            return [
                {columns[i]: row[i] for i in range(len(columns))}
                for row in cursor.fetchall()
            ]

        # 1. Call window
        cursor.execute("""
            ;WITH target_call AS (
                SELECT TOP (1)
                    CA.SessionId AS SelectedSessionId,
                    CA.SessionIdA,
                    CA.Side,
                    COALESCE(S.FileId, SB.FileId) AS FileId,
                    COALESCE(S.startTime, SB.startTime) AS CallStart,
                    COALESCE(
                        DATEADD(ms, S.duration, S.startTime),
                        DATEADD(ms, SB.duration, SB.startTime),
                        DATEADD(ms, CA.callDuration, COALESCE(S.startTime, SB.startTime))
                    ) AS CallEnd,
                    CA.callStatus,
                    CA.code,
                    CA.codeDescription,
                    CA.technology,
                    CA.callmode,
                    CA.callType,
                    CA.callDir
                FROM CallAnalysis CA
                LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
                LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
                ORDER BY COALESCE(S.startTime, SB.startTime)
            )
            SELECT
                *,
                DATEADD(second, -?, CallStart) AS PreStart,
                DATEADD(second,  ?, CallEnd) AS PostEnd
            FROM target_call
        """, (session_id, session_id, before_seconds, after_seconds))

        call_rows = fetch_dicts()
        if not call_rows:
            conn.close()
            return {
                "callWindow": None,
                "message": "No call found for this session_id"
            }

        call_window = call_rows[0]

        # 2. LTE Paging / eDRX request table
        cursor.execute("""
            ;WITH target_call AS (
                SELECT TOP (1)
                    COALESCE(S.FileId, SB.FileId) AS FileId,
                    COALESCE(S.startTime, SB.startTime) AS CallStart,
                    COALESCE(
                        DATEADD(ms, S.duration, S.startTime),
                        DATEADD(ms, SB.duration, SB.startTime),
                        DATEADD(ms, CA.callDuration, COALESCE(S.startTime, SB.startTime))
                    ) AS CallEnd
                FROM CallAnalysis CA
                LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
                LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
            ),
            bounds AS (
                SELECT
                    FileId,
                    CallStart,
                    CallEnd,
                    DATEADD(second, -?, CallStart) AS PreStart,
                    DATEADD(second,  ?, CallEnd) AS PostEnd
                FROM target_call
            ),
            sessions_in_window AS (
                SELECT S.SessionId
                FROM Sessions S
                CROSS JOIN bounds B
                WHERE S.FileId = B.FileId
                  AND S.startTime <= B.PostEnd
                  AND DATEADD(ms, S.duration, S.startTime) >= B.PreStart

                UNION

                SELECT SB.SessionId
                FROM SessionsB SB
                CROSS JOIN bounds B
                WHERE SB.FileId = B.FileId
                  AND SB.startTime <= B.PostEnd
                  AND DATEADD(ms, SB.duration, SB.startTime) >= B.PreStart
            )
            SELECT
                CASE
                    WHEN P.MsgTime < B.CallStart THEN 'before'
                    WHEN P.MsgTime <= B.CallEnd THEN 'during'
                    ELSE 'after'
                END AS Phase,
                DATEDIFF(ms, B.CallStart, P.MsgTime) / 1000.0 AS SecondsFromCallStart,
                P.MsgId,
                P.SessionId,
                P.TestId,
                P.MsgTime,
                P.PosId,
                P.NetworkId,
                P.EARFCN,
                P.PCI,
                P.UEId,
                P.PagingCycle,
                CASE P.PagingCycle
                    WHEN 0 THEN 320
                    WHEN 1 THEN 640
                    WHEN 2 THEN 1280
                    WHEN 3 THEN 2560
                    WHEN 4 THEN 5120
                END AS PagingCycleDecoded,
                P.Nb,
                CASE P.Nb
                    WHEN 0 THEN 'fourT'
                    WHEN 1 THEN 'twoT'
                    WHEN 2 THEN 'oneT'
                    WHEN 3 THEN 'halfT'
                    WHEN 4 THEN 'quarterT'
                    WHEN 5 THEN 'oneEighthT'
                    WHEN 6 THEN 'oneSixteenthT'
                    WHEN 7 THEN 'oneThirtySecondT'
                    WHEN 8 THEN 'oneSixtyFourthT'
                    WHEN 9 THEN 'oneOneHundredTwentyEighthT'
                    WHEN 10 THEN 'oneTwoHundredFiftySixthT'
                    WHEN 11 THEN 'oneFiveHundredTwelfthT'
                    WHEN 12 THEN 'oneTenTwentyFourthT'
                END AS NbDecoded,
                P.PagingSFNOffset,
                P.PagingSubFNOffset,
                P.CatM1PagingStartNB,
                P.EDRXHyperFrameOffset,
                P.EDRXPageStartOffset,
                P.EDRXPageEndOffset,
                P.EDRXCycleLength,
                P.EDRXPTWLength
            FROM LTEPagingEDRXRequest P
            INNER JOIN sessions_in_window SI ON SI.SessionId = P.SessionId
            CROSS JOIN bounds B
            WHERE P.MsgTime BETWEEN B.PreStart AND B.PostEnd
            ORDER BY P.MsgTime
        """, (session_id, session_id, before_seconds, after_seconds))

        lte_paging_edrx = fetch_dicts()

        # 3. LTE RRC messages that look like Paging
        cursor.execute("""
            ;WITH target_call AS (
                SELECT TOP (1)
                    COALESCE(S.FileId, SB.FileId) AS FileId,
                    COALESCE(S.startTime, SB.startTime) AS CallStart,
                    COALESCE(
                        DATEADD(ms, S.duration, S.startTime),
                        DATEADD(ms, SB.duration, SB.startTime),
                        DATEADD(ms, CA.callDuration, COALESCE(S.startTime, SB.startTime))
                    ) AS CallEnd
                FROM CallAnalysis CA
                LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
                LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
            ),
            bounds AS (
                SELECT
                    FileId,
                    CallStart,
                    CallEnd,
                    DATEADD(second, -?, CallStart) AS PreStart,
                    DATEADD(second,  ?, CallEnd) AS PostEnd
                FROM target_call
            ),
            sessions_in_window AS (
                SELECT S.SessionId
                FROM Sessions S
                CROSS JOIN bounds B
                WHERE S.FileId = B.FileId
                  AND S.startTime <= B.PostEnd
                  AND DATEADD(ms, S.duration, S.startTime) >= B.PreStart

                UNION

                SELECT SB.SessionId
                FROM SessionsB SB
                CROSS JOIN bounds B
                WHERE SB.FileId = B.FileId
                  AND SB.startTime <= B.PostEnd
                  AND DATEADD(ms, SB.duration, SB.startTime) >= B.PreStart
            )
            SELECT
                CASE
                    WHEN R.MsgTime < B.CallStart THEN 'before'
                    WHEN R.MsgTime <= B.CallEnd THEN 'during'
                    ELSE 'after'
                END AS Phase,
                DATEDIFF(ms, B.CallStart, R.MsgTime) / 1000.0 AS SecondsFromCallStart,
                R.MsgId,
                R.SessionId,
                R.TestId,
                R.MsgTime,
                R.PosId,
                R.NetworkId,
                R.RRCRelease,
                R.RRCVersion,
                R.PhyCellId,
                R.Freq,
                R.ChnType,
                R.MsgType,
                R.MsgTypeName,
                R.Direction,
                R.MsgName,
                R.Msg
            FROM vLTERRCMessages R
            INNER JOIN sessions_in_window SI ON SI.SessionId = R.SessionId
            CROSS JOIN bounds B
            WHERE R.MsgTime BETWEEN B.PreStart AND B.PostEnd
              AND (
                    R.MsgTypeName LIKE '%Paging%'
                 OR R.MsgName LIKE '%Paging%'
                 OR R.Msg LIKE '%Paging%'
              )
            ORDER BY R.MsgTime
        """, (session_id, session_id, before_seconds, after_seconds))

        lte_rrc_paging = fetch_dicts()

        # 4. NR RRC paging messages, if available in DB
        try:
            cursor.execute("""
                ;WITH target_call AS (
                    SELECT TOP (1)
                        COALESCE(S.FileId, SB.FileId) AS FileId,
                        COALESCE(S.startTime, SB.startTime) AS CallStart,
                        COALESCE(
                            DATEADD(ms, S.duration, S.startTime),
                            DATEADD(ms, SB.duration, SB.startTime),
                            DATEADD(ms, CA.callDuration, COALESCE(S.startTime, SB.startTime))
                        ) AS CallEnd
                    FROM CallAnalysis CA
                    LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
                    LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
                    WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                       OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
                ),
                bounds AS (
                    SELECT
                        FileId,
                        CallStart,
                        CallEnd,
                        DATEADD(second, -?, CallStart) AS PreStart,
                        DATEADD(second,  ?, CallEnd) AS PostEnd
                    FROM target_call
                ),
                sessions_in_window AS (
                    SELECT S.SessionId
                    FROM Sessions S
                    CROSS JOIN bounds B
                    WHERE S.FileId = B.FileId
                      AND S.startTime <= B.PostEnd
                      AND DATEADD(ms, S.duration, S.startTime) >= B.PreStart

                    UNION

                    SELECT SB.SessionId
                    FROM SessionsB SB
                    CROSS JOIN bounds B
                    WHERE SB.FileId = B.FileId
                      AND SB.startTime <= B.PostEnd
                      AND DATEADD(ms, SB.duration, SB.startTime) >= B.PreStart
                )
                SELECT
                    CASE
                        WHEN R.MsgTime < B.CallStart THEN 'before'
                        WHEN R.MsgTime <= B.CallEnd THEN 'during'
                        ELSE 'after'
                    END AS Phase,
                    DATEDIFF(ms, B.CallStart, R.MsgTime) / 1000.0 AS SecondsFromCallStart,
                    R.MsgId,
                    R.SessionId,
                    R.TestId,
                    R.MsgTime,
                    R.PosId,
                    R.NetworkId,
                    R.RRCRelease,
                    R.RRCVersion,
                    R.ChnType,
                    R.MsgType,
                    R.MsgTypeName,
                    R.Msg
                FROM vNR5GRRCMessages R
                INNER JOIN sessions_in_window SI ON SI.SessionId = R.SessionId
                CROSS JOIN bounds B
                WHERE R.MsgTime BETWEEN B.PreStart AND B.PostEnd
                  AND (
                        R.MsgTypeName LIKE '%Paging%'
                     OR R.Msg LIKE '%Paging%'
                  )
                ORDER BY R.MsgTime
            """, (session_id, session_id, before_seconds, after_seconds))

            nr_rrc_paging = fetch_dicts()
        except Exception:
            nr_rrc_paging = []

        conn.close()

        timeline = []

        for row in lte_paging_edrx:
            timeline.append({
                "phase": row.get("Phase"),
                "time": row.get("MsgTime"),
                "secondsFromCallStart": row.get("SecondsFromCallStart"),
                "type": "lte_paging_edrx",
                "title": f"LTE Paging/eDRX EARFCN={row.get('EARFCN')} PCI={row.get('PCI')}",
                "details": row,
            })

        for row in lte_rrc_paging:
            timeline.append({
                "phase": row.get("Phase"),
                "time": row.get("MsgTime"),
                "secondsFromCallStart": row.get("SecondsFromCallStart"),
                "type": "lte_rrc_paging",
                "title": row.get("MsgTypeName") or row.get("MsgName") or "LTE RRC Paging",
                "details": row,
            })

        for row in nr_rrc_paging:
            timeline.append({
                "phase": row.get("Phase"),
                "time": row.get("MsgTime"),
                "secondsFromCallStart": row.get("SecondsFromCallStart"),
                "type": "nr_rrc_paging",
                "title": row.get("MsgTypeName") or "NR RRC Paging",
                "details": row,
            })

        timeline.sort(key=lambda x: x["time"] or "")

        return {
            "callWindow": call_window,
            "ltePagingEDRX": lte_paging_edrx,
            "lteRrcPaging": lte_rrc_paging,
            "nrRrcPaging": nr_rrc_paging,
            "timeline": timeline,
            "summary": {
                "ltePagingEDRX": len(lte_paging_edrx),
                "lteRrcPaging": len(lte_rrc_paging),
                "nrRrcPaging": len(nr_rrc_paging),
                "totalPagingEvents": len(timeline),
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/call_device_info")
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


@app.get("/api/lte_measurement_comparison")
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


@app.get("/api/lte_scanner_raw")
def get_lte_scanner_raw(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Raw FactLTEScanner rows matched by call datetime window, not by SessionId."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # A-side: match scanner rows by A-side call time window
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
                fs.FullDate,
                fs.EARFCN,
                fs.PCI,
                fs.RFBand,
                ROUND(fs.RSRP, 2)  AS RSRP,
                ROUND(fs.RSRQ, 2)  AS RSRQ,
                ROUND(fs.SINR, 2)  AS SINR,
                ROUND(fs.RSSI, 2)  AS RSSI
            FROM FactLTEScanner fs
            CROSS JOIN call_time ct
            WHERE fs.EARFCN IS NOT NULL
              AND fs.FullDate >= ct.start_time
              AND fs.FullDate <= ct.end_time
            ORDER BY fs.FullDate
        """, (session_id,))
        cols_a = [c[0] for c in cursor.description] if cursor.description else []
        a_side = [{cols_a[i]: row[i] for i in range(len(cols_a))} for row in cursor.fetchall()]

        # B-side: resolve B session then match scanner rows by B-side call time window
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
                fs.FullDate,
                fs.EARFCN,
                fs.PCI,
                fs.RFBand,
                ROUND(fs.RSRP, 2)  AS RSRP,
                ROUND(fs.RSRQ, 2)  AS RSRQ,
                ROUND(fs.SINR, 2)  AS SINR,
                ROUND(fs.RSSI, 2)  AS RSSI
            FROM FactLTEScanner fs
            CROSS JOIN b_time bt
            WHERE fs.EARFCN IS NOT NULL
              AND fs.FullDate >= bt.start_time
              AND fs.FullDate <= bt.end_time
            ORDER BY fs.FullDate
        """, (session_id, session_id))
        cols_b = [c[0] for c in cursor.description] if cursor.description else []
        b_side = [{cols_b[i]: row[i] for i in range(len(cols_b))} for row in cursor.fetchall()]

        conn.close()
        return {"aSide": a_side, "bSide": b_side}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/gsm_scanner_raw")
def get_gsm_scanner_raw(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """FactGSMScanner rows matched by call datetime window.
    For each unique BCCH+RFBand keeps the single reading closest to call start."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

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
            ),
            scanner_ranked AS (
                SELECT
                    fs.FullDate,
                    fs.BCCH,
                    fs.RFBand,
                    fs.BSIC,
                    fs.RxLev,
                    fs.CoverI,
                    fs.CGI,
                    fs.CId,
                    fs.LAC,
                    ROW_NUMBER() OVER (
                        PARTITION BY fs.BCCH, fs.RFBand
                        ORDER BY ABS(DATEDIFF(MILLISECOND, ct.start_time, fs.FullDate))
                    ) AS rn
                FROM FactGSMScanner fs
                CROSS JOIN call_time ct
                WHERE fs.BCCH IS NOT NULL
                  AND fs.FullDate >= ct.start_time
                  AND fs.FullDate <= ct.end_time
            )
            SELECT FullDate, BCCH, RFBand, BSIC, RxLev, CoverI, CGI, CId, LAC
            FROM scanner_ranked
            WHERE rn = 1
            ORDER BY BCCH, RFBand
        """, (session_id,))
        cols = [c[0] for c in cursor.description] if cursor.description else []
        rows = [{cols[i]: row[i] for i in range(len(cols))} for row in cursor.fetchall()]

        conn.close()
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/lte_scanner_measurement")
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


@app.get("/api/wcdma_values")
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
