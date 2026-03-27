from fastapi import FastAPI, HTTPException
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