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


# Πόσα σημεία ανά (operator, κατεύθυνση) στέλνουμε για scatter — τα avg/r/bins βγαίνουν
# πάντα από ΟΛΑ τα tests, το δείγμα είναι μόνο για να μη σέρνεται το SVG του recharts.
SCATTER_MAX_POINTS = 1500


def sinr_throughput_scatter(rows, operators=("COSMOTE", "VODAFONE", "NOVA")):
    """Scatter "SINR → Throughput" ανά operator (σελίδα DATA-BANDWIDTH του .pbix, 14.4 DL
    και 14.6 UL). `rows`: (operator, "DL"|"UL", sinr_db, throughput_mbps) — ένα ανά test.

    Ανά operator: n, μέσοι όροι, Pearson r, το (δειγματοληπτημένο) σύννεφο σημείων και
    μέση throughput ανά ακέραιο dB SINR (bins με >= 5 tests) για τη γραμμή τάσης."""
    groups: dict[tuple[str, str], list[tuple[float, float]]] = {}
    for operator, direction, sinr, mbps in rows:
        if operator not in operators or sinr is None or mbps is None:
            continue
        groups.setdefault((direction, operator), []).append((float(sinr), float(mbps)))

    def summary(operator, pts):
        n = len(pts)
        mx = sum(x for x, _ in pts) / n
        my = sum(y for _, y in pts) / n
        sxx = sum((x - mx) ** 2 for x, _ in pts)
        syy = sum((y - my) ** 2 for _, y in pts)
        sxy = sum((x - mx) * (y - my) for x, y in pts)
        bins: dict[int, list[float]] = {}
        for x, y in pts:
            bins.setdefault(round(x), []).append(y)
        stride = max(1, -(-n // SCATTER_MAX_POINTS))
        return {
            "operator": operator,
            "n": n,
            "avgSinr": mx,
            "avgMbps": my,
            "r": sxy / (sxx * syy) ** 0.5 if sxx > 0 and syy > 0 else None,
            "points": [[round(x, 2), round(y, 3)] for x, y in pts[::stride]],
            "bins": [[b, sum(ys) / len(ys), len(ys)] for b, ys in sorted(bins.items()) if len(ys) >= 5],
        }

    return {
        key: [summary(op, groups[(direction, op)]) for op in operators if groups.get((direction, op))]
        for key, direction in (("dl", "DL"), ("ul", "UL"))
    }
