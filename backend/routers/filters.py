"""Κοινά φίλτρα όλων των σελίδων (dropdowns): databases / collections / locations."""
from fastapi import APIRouter, HTTPException, Query

from db import get_connection, get_available_databases

router = APIRouter(tags=["filters"])


@router.get("/api/databases")
def list_databases():
    try:
        return {"databases": get_available_databases()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/collections")
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


@router.get("/api/locations")
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
