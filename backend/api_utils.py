"""Κοινά helpers για τα routers."""
import datetime
import decimal
import json

from fastapi import Response


def _rows(cursor):
    cols = [c[0] for c in cursor.description] if cursor.description else []
    return [{cols[i]: r[i] for i in range(len(cols))} for r in cursor.fetchall()]


def _json_default(value):
    """datetime/Decimal -> JSON, ό,τι ακριβώς θα έβγαζε και το jsonable_encoder."""
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, datetime.timedelta):
        return value.total_seconds()
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", "replace")
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def rows_response(cursor, key: str = "rows") -> Response:
    """Ίδιο JSON με το `return {"rows": _rows(cursor)}`, αλλά χωρίς το πέρασμα του
    FastAPI `jsonable_encoder` πάνω σε δεκάδες χιλιάδες dicts — σε αυτόν τον όγκο
    (π.χ. 30k γραμμές στο /api/data_calls) ο encoder μόνος του κόστιζε ~1.5s.
    Σειριοποιούμε κατευθείαν με json.dumps + `default` για datetime/Decimal."""
    payload = json.dumps({key: _rows(cursor)}, default=_json_default)
    return Response(content=payload, media_type="application/json")
