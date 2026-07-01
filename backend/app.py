from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from db import get_connection, get_available_databases
from rrc_decode import decode_row_message
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
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        selected_collections = [col for col in (collection or []) if col and col.strip()]

        filelist_query = """
            SELECT DISTINCT ASideLocation
            FROM FileList
            WHERE ASideLocation IS NOT NULL
        """
        params = []
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            filelist_query += f" AND CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        filelist_query += " ORDER BY ASideLocation"

        try:
            cursor.execute(filelist_query, tuple(params))
            rows = cursor.fetchall()
            if rows:
                return {"locations": [row[0] for row in rows if row[0]]}
        except Exception:
            rows = []

        dmn_query = """
            SELECT DISTINCT Location
            FROM DmnFile
            WHERE Location IS NOT NULL
        """
        dmn_params = []
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            dmn_query += f" AND CollectionName IN ({placeholders})"
            dmn_params.extend(selected_collections)

        dmn_query += " ORDER BY Location"

        cursor.execute(dmn_query, tuple(dmn_params))
        rows = cursor.fetchall()
        return {"locations": [row[0] for row in rows if row[0]]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()

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
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        try:
            cursor.execute("""
                SELECT DISTINCT CollectionName
                FROM filelist
                WHERE CollectionName IS NOT NULL
                ORDER BY CollectionName
            """)

            rows = cursor.fetchall()
            if rows:
                return {"collections": [row[0] for row in rows if row[0]]}
        except Exception:
            rows = []

        cursor.execute("""
            SELECT DISTINCT CollectionName
            FROM DmnFile
            WHERE CollectionName IS NOT NULL
            ORDER BY CollectionName
        """)

        rows = cursor.fetchall()
        return {"collections": [row[0] for row in rows if row[0]]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()

@app.get("/api/lte_values")
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

@app.get("/api/call_kpi_tile")
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

@app.get("/api/gsm_context_signal")
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


@app.get("/api/call_context_signal_b_side")
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


@app.get("/api/gsm_context_signal_b_side")
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


@app.get("/api/l3_messages")
def get_l3_messages(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    side: str = Query(default="A"),  # "A" (default, uses session_id as-is) or "B" (resolves the paired B-side SessionId)
    technology: str | None = Query(default=None),     # e.g. LTE, NR5G, GSM, WCDMA, VoIP
    layer: str | None = Query(default=None),          # e.g. LTE-RRC, LTE-NAS, SIP, 5GNR-RRC
    before_seconds: int = Query(default=10, ge=0, le=600),
    after_seconds: int = Query(default=10, ge=0, le=600),
):
    """
    L3 / SIP / RRC / NAS messages for the call window.

    Both SessionIds (A & B) are resolved together, up front, in one query
    (pair_root -> ASessionId, b_side -> BSessionId), then ?side=A or ?side=B
    simply picks which of the two already-resolved ids to use for the call
    window / L3 log below — same pattern as the other *_b_side endpoints,
    so the frontend only ever has to pass a single session_id.

    The window anchors on the EARLIEST of: first SIP INVITE, first RRC
    connection setup/reconfiguration, or callStartTimeStamp, then extends by
    before_seconds/after_seconds, so call-setup signalling isn't cut off.
    """

    conn = None

    try:
        side = (side or "A").upper().strip()

        if side not in ("A", "B"):
            raise HTTPException(status_code=400, detail="side must be A or B")

        conn = get_connection(database)
        cursor = conn.cursor()

        # 0) Resolve BOTH SessionIds (A & B) for this call in one round trip.
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
                SELECT TOP (1) CA.SessionId AS BSessionId
                FROM CallAnalysis CA
                INNER JOIN pair_root PR ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'
            )
            SELECT PR.ASessionId, BS.BSessionId
            FROM pair_root PR
            LEFT JOIN b_side BS ON 1 = 1
        """, (session_id, session_id))
        pair_row = cursor.fetchone()
        if not pair_row or pair_row[0] is None:
            return {"callWindow": None, "l3Messages": [], "message": "No call found for this session_id"}
        a_session_id, b_session_id = pair_row[0], pair_row[1]

        if side == "B":
            if b_session_id is None:
                return {"callWindow": None, "l3Messages": [], "message": "No B-side session found for this call"}
            resolved_session_id = str(b_session_id)
        else:
            resolved_session_id = str(a_session_id)

        # 1) Call window for the resolved session_id.
        cursor.execute("""
            SELECT TOP 1
                CA.SessionId,
                CA.FileId,
                CA.callStartTimeStamp AS CallStart,
                COALESCE(
                    CA.callEndTimeStamp,
                    DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp)
                ) AS CallEnd,
                CA.callStatus,
                CA.technology,
                CA.callDir,
                CA.Side,
                CA.SessionIdA
            FROM CallAnalysis CA
            WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY CA.callStartTimeStamp
        """, (resolved_session_id,))

        cols = [c[0] for c in cursor.description] if cursor.description else []
        wrow = cursor.fetchone()

        if not wrow:
            return {
                "callWindow": None,
                "l3Messages": [],
                "message": f"No call found for selected side={side}, session_id={resolved_session_id}",
            }

        call_window = {cols[i]: wrow[i] for i in range(len(cols))}

        # Add useful frontend metadata
        call_window["SelectedSide"] = side
        call_window["ASessionId"] = a_session_id
        call_window["BSessionId"] = b_session_id
        call_window["ResolvedSessionId"] = resolved_session_id

        # 2) Full L3 log based on the selected call window.
        #    'during' is scoped strictly to this side's own SessionId (no
        #    neighbouring SessionIds from the same FileId), so every one of
        #    its rows belongs to this call and is reported as phase='during'
        #    regardless of whether it lands a few seconds before the recorded
        #    callStartTimeStamp (call-setup signalling commonly precedes it).
        #    'before' / 'after' add surrounding context from the rest of the
        #    FileId (other SessionIds) without touching the 'during' rowset
        #    above — same source query, just UNIONed in.
        cte = """
            ;WITH target_call AS (
                SELECT TOP 1
                    CA.FileId,
                    CA.callStartTimeStamp AS CallStart,
                    COALESCE(
                        CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp)
                    ) AS CallEnd
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                ORDER BY CA.callStartTimeStamp
            ),
            setup_anchor AS (
                SELECT MIN(l.FullDate) AS AnchorTime
                FROM FactL3Messages l
                CROSS JOIN target_call tc
                WHERE l.SessionId = TRY_CONVERT(BIGINT, ?)
                  AND l.FullDate BETWEEN DATEADD(second, -30, tc.CallStart) AND tc.CallEnd
                  AND (
                        l.SimpleMsgName LIKE '%INVITE%'
                     OR l.SimpleMsgName LIKE '%RRCConnectionRequest%'
                     OR l.SimpleMsgName LIKE '%RRCConnectionSetup%'
                     OR l.SimpleMsgName LIKE '%RRCSetup%'
                     OR l.SimpleMsgName LIKE '%RRCConnectionReconfiguration%'
                     OR l.SimpleMsgName LIKE '%RRCReconfiguration%'
                     OR l.SimpleMsgName LIKE '%Activate dedicated EPS bearer%'
                  )
            ),
            bounds AS (
                SELECT
                    tc.FileId,
                    tc.CallStart,
                    tc.CallEnd,

                    DATEADD(
                        second,
                        -?,
                        CASE
                            WHEN (SELECT AnchorTime FROM setup_anchor) IS NOT NULL
                             AND (SELECT AnchorTime FROM setup_anchor) < tc.CallStart
                            THEN (SELECT AnchorTime FROM setup_anchor)
                            ELSE tc.CallStart
                        END
                    ) AS PreStart,

                    DATEADD(second, ?, tc.CallEnd) AS PostEnd
                FROM target_call tc
            )
        """

        branches = """
            SELECT
                'during' AS Phase,

                DATEDIFF(ms, B.CallStart, l.FullDate) / 1000.0 AS SecondsFromCallStart,

                l.FullDate AS MsgTime,
                l.SessionId,
                l.Technology,
                l.Direction,
                l.Layer,
                l.MsgName,
                l.SimpleMsgName,
                l.Category,
                l.Class,
                l.SIPResponse,
                l.CombinedMsgNameSIPResponse,
                l.SIPCallId,
                l.PCI,
                l.ARFCN,
                LEFT(l.Message, 1500) AS Message

            FROM FactL3Messages l
            CROSS JOIN bounds B
            WHERE l.SessionId = TRY_CONVERT(BIGINT, ?)
              AND l.FullDate BETWEEN B.PreStart AND B.PostEnd

            UNION ALL

            SELECT
                'before' AS Phase,

                DATEDIFF(ms, B.CallStart, l.FullDate) / 1000.0 AS SecondsFromCallStart,

                l.FullDate AS MsgTime,
                l.SessionId,
                l.Technology,
                l.Direction,
                l.Layer,
                l.MsgName,
                l.SimpleMsgName,
                l.Category,
                l.Class,
                l.SIPResponse,
                l.CombinedMsgNameSIPResponse,
                l.SIPCallId,
                l.PCI,
                l.ARFCN,
                LEFT(l.Message, 1500) AS Message

            FROM FactL3Messages l
            CROSS JOIN bounds B
            WHERE l.FileId = B.FileId
              AND l.SessionId <> TRY_CONVERT(BIGINT, ?)
              AND l.FullDate >= B.PreStart
              AND l.FullDate <  B.CallStart

            UNION ALL

            SELECT
                'after' AS Phase,

                DATEDIFF(ms, B.CallStart, l.FullDate) / 1000.0 AS SecondsFromCallStart,

                l.FullDate AS MsgTime,
                l.SessionId,
                l.Technology,
                l.Direction,
                l.Layer,
                l.MsgName,
                l.SimpleMsgName,
                l.Category,
                l.Class,
                l.SIPResponse,
                l.CombinedMsgNameSIPResponse,
                l.SIPCallId,
                l.PCI,
                l.ARFCN,
                LEFT(l.Message, 1500) AS Message

            FROM FactL3Messages l
            CROSS JOIN bounds B
            WHERE l.FileId = B.FileId
              AND l.SessionId <> TRY_CONVERT(BIGINT, ?)
              AND l.FullDate >  B.CallEnd
              AND l.FullDate <= B.PostEnd
        """

        params = [
            resolved_session_id, resolved_session_id, before_seconds, after_seconds,
            resolved_session_id,   # during
            resolved_session_id,   # before (exclude own session, already covered by during)
            resolved_session_id,   # after  (exclude own session, already covered by during)
        ]

        q = cte + f" SELECT * FROM ({branches}) AS combined WHERE 1=1"

        if technology:
            q += " AND Technology = ?"
            params.append(technology)

        if layer:
            q += " AND Layer = ?"
            params.append(layer)

        q += " ORDER BY MsgTime"

        cursor.execute(q, tuple(params))
        data = _rows(cursor)

        # LTE MeasurementReport rows carry a UPER-encoded RRC PDU in Message (raw hex) —
        # decode it into RSRP/RSRQ so the L3 log never shows hex to the user.
        for r in data:
            decoded = decode_row_message(r.get("Technology"), r.get("SimpleMsgName"), r.get("MsgName"), r.get("Message"))
            if decoded is not None:
                r["Message"] = decoded

        phase_counts = {"before": 0, "during": 0, "after": 0}

        for r in data:
            ph = r.get("Phase")
            if ph in phase_counts:
                phase_counts[ph] += 1

        return {
            "callWindow": call_window,
            "l3Messages": data,
            "summary": {
                "selectedSide": side,
                "resolvedSessionId": resolved_session_id,
                "aSessionId": a_session_id,
                "bSessionId": b_session_id,
                "total": len(data),
                "byPhase": phase_counts,
                "windowBeforeSec": before_seconds,
                "windowAfterSec": after_seconds,
            },
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if conn:
            conn.close()


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
    session_id: str = Query(..., min_length=1),
    top_only: bool = Query(default=False),   # μόνο η καλύτερη κυψέλη ανά EARFCN (DmnIdTopN_RSRP=1)
):
    """FactLTEScanner rows in the call time window, A-side & B-side.
    Richer than before: includes MCC/MNC/PCI/CId/TAC, TopN ranking, MIMO/rank,
    ENDC flag and best-neighbour context — so you can compare what the UE was
    camped on (FactLTERadio serving) vs what the scanner saw as best available.
    ?top_only=true keeps only the #1 ranked cell per EARFCN (best server)."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        scanner_cols = """
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
        """

        def run(where_time_cte, params):
            q = f"""
                {where_time_cte}
                SELECT {scanner_cols}
                FROM FactLTEScanner fs
                CROSS JOIN win w
                WHERE fs.EARFCN IS NOT NULL
                  AND fs.FullDate >= w.start_time
                  AND fs.FullDate <= w.end_time
                  {"AND fs.DmnIdTopN_RSRP = 1" if top_only else ""}
                ORDER BY fs.FullDate, fs.DmnIdTopN_RSRP
            """
            cursor.execute(q, params)
            cols = [c[0] for c in cursor.description] if cursor.description else []
            return [{cols[i]: r[i] for i in range(len(cols))} for r in cursor.fetchall()]

        # A-side time window
        a_cte = """
            ;WITH win AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    COALESCE(CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration,0), CA.callStartTimeStamp)
                    ) AS end_time
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            )
        """
        a_side = run(a_cte, (session_id,))

        # B-side: resolve B session, then its time window
        b_cte = """
            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE WHEN CA.Side='B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                         ELSE CA.SessionId END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
            ),
            b_session AS (
                SELECT TOP (1) CA.SessionId AS BSessionId
                FROM CallAnalysis CA
                INNER JOIN pair_root PR ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side='B'
            ),
            win AS (
                SELECT TOP 1
                    CA.callStartTimeStamp AS start_time,
                    COALESCE(CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration,0), CA.callStartTimeStamp)
                    ) AS end_time
                FROM CallAnalysis CA
                INNER JOIN b_session B ON CA.SessionId = B.BSessionId
            )
        """
        b_side = run(b_cte, (session_id, session_id))

        conn.close()
        return {"aSide": a_side, "bSide": b_side}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/lte_serving_vs_scanner")
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


@app.get("/api/gsm_scanner_raw")
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


class RunMapRequest(BaseModel):
    database: str
    collection: str
    gpx_path: str = ""
    max_workers: int = 6


@app.post("/api/run_map")
def run_map(req: RunMapRequest):
    """
    Trigger main_mt.run_for_collection() and return captured stdout logs + output path.
    The main_mt.py / panel_*.py files must be importable from sys.path.
    """
    import sys
    import io
    import contextlib

    # Folder that contains main_mt.py / panel_*.py, bundled inside this repo.
    MAP_SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "validation_maps")
    if MAP_SCRIPTS_DIR not in sys.path:
        sys.path.insert(0, MAP_SCRIPTS_DIR)

    try:
        import main_mt  # type: ignore
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Cannot import main_mt: {e}. Make sure MAP_SCRIPTS_DIR is correct."
        )

    log_buffer = io.StringIO()
    output_html = None

    try:
        with contextlib.redirect_stdout(log_buffer):
            output_html = main_mt.run_for_collection(
                req.collection,
                req.database,
                input_gpx=req.gpx_path if req.gpx_path.strip() else None,
                max_workers=req.max_workers,
            )
    except Exception as e:
        raw_logs = [l for l in log_buffer.getvalue().splitlines() if l.strip()]
        raw_logs.append(f"ERROR: {e}")
        raise HTTPException(status_code=500, detail="\n".join(raw_logs))

    logs = [l for l in log_buffer.getvalue().splitlines() if l.strip()]

    html_content = None
    if output_html and os.path.isfile(output_html):
        with open(output_html, "r", encoding="utf-8") as f:
            html_content = f.read()

    return {"output_path": output_html, "html_content": html_content, "logs": logs, "success": True}


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


# ============================================================================
#  Extra per-call endpoints â cover tables not touched by the API above.
#  Verified against schema MTWS_26H1 (wma.sql).
# ============================================================================

def _rows(cursor):
    cols = [c[0] for c in cursor.description] if cursor.description else []
    return [{cols[i]: r[i] for i in range(len(cols))} for r in cursor.fetchall()]


@app.get("/api/handover_info")
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


@app.get("/api/l3_summary")
def get_l3_summary(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Aggregated signalling overview for the call: how many of each message type,
    by technology and direction. Quick way to spot e.g. repeated RRC re-establish
    or paging storms without scrolling the whole log."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                l.Technology,
                l.Layer,
                l.Direction,
                l.SimpleMsgName,
                COUNT(*) AS cnt,
                MIN(l.FullDate) AS firstSeen,
                MAX(l.FullDate) AS lastSeen
            FROM FactL3Messages l
            WHERE l.SessionId = TRY_CONVERT(BIGINT, ?)
            GROUP BY l.Technology, l.Layer, l.Direction, l.SimpleMsgName
            ORDER BY cnt DESC
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"l3Summary": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/gsm_neighbors")
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


@app.get("/api/nr5g_state")
def get_nr5g_state(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """5G MM state over time (StateAsTxt / SubStateAsTxt) â shows when the UE
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


@app.get("/api/nr5g_throughput")
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


@app.get("/api/lte_cell_info")
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


@app.get("/api/nr5g_cell_info")
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


@app.get("/api/coverage_class")
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


@app.get("/api/ping_summary")
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


@app.get("/api/wcdma_radio")
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
