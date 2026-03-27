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
    collection: str = Query(..., min_length=1),
    location: str = Query(..., min_length=1),
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                CA.SessionId,
                CA.callStatus AS status,
                DF.CollectionName,
                DF.ASideLocation AS Location,
                POS.Latitude AS latitude,
                POS.Longitude AS longitude
            FROM CallAnalysis CA
            LEFT JOIN FileList DF ON CA.FileId = DF.FileId
            LEFT JOIN Position POS ON CA.PosId = POS.PosId
            LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
            WHERE DF.ASideLocation = ?
              AND DF.CollectionName = ?
              AND S.Valid = 1
            """,
            (location, collection),
        )

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
    collection: str = Query(..., min_length=1),
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT DISTINCT ASideLocation
            FROM FileList
            WHERE CollectionName = ?
              AND ASideLocation IS NOT NULL
            ORDER BY ASideLocation
            """,
            (collection,),
        )

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