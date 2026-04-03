from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from db import get_connection, get_available_databases
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # μετά μπορείς να το περιορίσεις
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    database: str
    queries: list[str]


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
            SELECT [MsgId]
                  ,[SessionId]
                  ,[MsgTime]
                  ,[PosId]
                  ,[NetworkId]
                  ,[EARFCN]
                  ,[PhyCellId]
                  ,round([RSRP], 2) AS [RSRP]
                  ,round([RSRQ], 2) AS [RSRQ]
                  ,round([SINR0], 2) AS [SINR0]
                  ,round([SINR1], 2) AS [SINR1]
                  ,[LTEServingCellInfoId]
              FROM [LTEMeasurementReport]
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

        return {"lteValues": data}
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
            SELECT [MsgId]
                  ,[SessionId]
                  ,[MsgTime]
                  ,[PosId]
                  ,[NetworkId]
                  ,[RxLevSub]
                  ,[RxQualSub]
              FROM [GSMMeasReport]
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

        return {"gsmValues": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))