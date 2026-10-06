"""Historic — οι σελίδες «Comparison» του COSMOTE BENCHMARKING BI REPORT v12.pbix:

  [24] Comparison Voice GSM / [25] Monthly …       -> /api/historic/comparison?kind=voice_gsm
  [26] Comparison Voice Free (+ [27] MOS, [28] CST) / [29] Monthly … -> ?kind=voice_free
  [30] Comparison Data / [31] Comparison Data 2 / [32] Monthly …     -> ?kind=data
  [33]–[36] Comparison Voice/Data GRADES (+ Difference)               -> /api/historic/grades_all

Σε αντίθεση με τις υπόλοιπες σελίδες, εδώ ΔΕΝ υπάρχει Scope slicer: X = Scope (ή μήνας του
ALL INFO SYNCED FILTERS[StartDate] στις «Monthly»), series = operator. Φίλτρο = GreaterArea /
Category / Collection (χωρίς scope) — όλα τα campaigns που ταιριάζουν, σε όλα τα εξάμηνα.

Η αντιστοίχιση collection -> (Scope, μήνας) φορτώνεται σε temp table (#cmap) ώστε οι
aggregations και τα PERCENTILE_CONT να γίνονται σε SQL ανά Scope/μήνα, και ώστε να μη
σκάμε στο όριο των 2100 parameters όταν το φίλτρο είναι "All" (χιλιάδες collections).
"""
import time

from fastapi import APIRouter, HTTPException, Query

from db import get_connection
from routers.historic import _CST_EXPR, _OPERATOR_CASE, _category_weight, _f, _operator_case, _scope_sort_key, _split_collection
from routers.historic_data_pages import _HTTP_THRP, _NR_DL_TESTS, _NRARFCN_BAND
from routers.historic_pages import _CST11000_EXPR, _LOCATION_OPERATOR, _OPERATORS, _all_collections, _fact_map, _ok_operator

router = APIRouter(tags=["historic"])

# Το /comparison χωρίς φίλτρο σαρώνει όλη την ιστορία (~30 s για τα data tables) — το warehouse
# αλλάζει μόνο όταν φορτώνεται νέο campaign, οπότε κρατάμε τα αποτελέσματα λίγη ώρα.
_CACHE_TTL_S = 15 * 60
_cache: dict[tuple, tuple[float, dict]] = {}


def _selected_all(cur, area, category, coll) -> list[str]:
    """STR_ID όλων των scopes που ταιριάζουν Area / Category / Collection (χωρίς scope) —
    μόνο χρονολογικά scopes (YYYYHn), αφού ο άξονας είναι χρονοσειρά."""
    out = []
    for name in _all_collections(cur):
        a, c, cat, scope = _split_collection(name)
        if _scope_sort_key(scope) is None:
            continue
        if area and a != area:
            continue
        if category and (cat or "").strip().upper() != category.strip().upper():
            continue
        if coll and c != coll:
            continue
        out.append(name)
    return sorted(out)


def _load_map(cur, rows):
    """#cmap(name, str_id, scope, month) στη σύνδεση `cur`."""
    cur.execute(
        """
        CREATE TABLE #cmap (
            name NVARCHAR(400) COLLATE DATABASE_DEFAULT,
            str_id NVARCHAR(400) COLLATE DATABASE_DEFAULT,
            scope VARCHAR(16) COLLATE DATABASE_DEFAULT,
            month CHAR(7) COLLATE DATABASE_DEFAULT NULL
        )
        """
    )
    if rows:
        cur.fast_executemany = True
        cur.executemany("INSERT INTO #cmap (name, str_id, scope, month) VALUES (?, ?, ?, ?)", rows)
        cur.fast_executemany = False


def _collection_months(fact: dict[str, str]) -> dict[str, str]:
    """ALL INFO SYNCED FILTERS[StartDate] ανά STR_ID. Ο πίνακας χτίζεται από το BI_Capacity
    (μία γραμμή ανά STR_ID) — εδώ MIN(CallDate) του BI_Capacity, με fallback στο MIN(StartDate)
    των voice πινάκων για collections χωρίς capacity tests."""
    base = [(f, s, None, None) for f, s in fact.items()]
    months: dict[str, str] = {}
    for database, sql in (
        ("BI_DATA", "SELECT m.str_id, MIN(TRY_CONVERT(date, t.CallDate, 104)) AS d FROM BI_Capacity t JOIN #cmap m ON m.name = t.CollectionName GROUP BY m.str_id"),
        (
            "BI_VOICE",
            """
            SELECT str_id, MIN(d) AS d FROM (
                SELECT m.str_id, TRY_CONVERT(date, t.StartDate, 104) AS d FROM BI_VOICE_MtoM t JOIN #cmap m ON m.name = t.CollectionName
                UNION ALL
                SELECT m.str_id, TRY_CONVERT(date, t.StartDate, 104) AS d FROM BI_VOICE_MtoF t JOIN #cmap m ON m.name = t.CollectionName
            ) x GROUP BY str_id
            """,
        ),
    ):
        missing = [r for r in base if r[1] not in months]
        if not missing:
            break
        conn = get_connection(database)
        try:
            cur = conn.cursor()
            _load_map(cur, missing)
            cur.execute(sql)
            for row in cur.fetchall():
                if row.d is not None and row.str_id not in months:
                    months[row.str_id] = row.d.strftime("%Y-%m")
        finally:
            conn.close()
    return months


def _series(cur, sql, metrics):
    """Τρέχει ένα SELECT που επιστρέφει (g, operator, <metrics…>) και το κάνει
    {g: {operator: {metric: value}}}."""
    cur.execute(sql)
    out: dict[str, dict[str, dict]] = {}
    for row in cur.fetchall():
        if row.g is None or not _ok_operator(row.operator):
            continue
        target = out.setdefault(row.g, {}).setdefault(row.operator, {})
        for m in metrics:
            target[m] = _f(getattr(row, m))
    return out


def _percentile_series(cur, table, op_expr, value_expr, q, where, metric, g):
    return _series(
        cur,
        f"""
        SELECT DISTINCT g, operator, PERCENTILE_CONT({q}) WITHIN GROUP (ORDER BY v) OVER (PARTITION BY g, operator) AS {metric}
        FROM (
            SELECT {g} AS g, {op_expr} AS operator, {value_expr} AS v
            FROM {table} t JOIN #cmap m ON m.name = t.CollectionName
            WHERE 1 = 1 {where}
        ) x
        WHERE v IS NOT NULL
        """,
        [metric],
    )


def _merge(*parts):
    out: dict[str, dict[str, dict]] = {}
    for part in parts:
        for g, ops in part.items():
            for op, metrics in ops.items():
                out.setdefault(g, {}).setdefault(op, {}).update(metrics)
    return out


def _voice_series(cur, table, g, with_free_extras):
    """Comparison Voice GSM / Free measures — ίδιοι ορισμοί με το get_historic_voice_page:
    Success = COMPLETED / COUNT(callStatus), AFR = FAILED / COUNT, DCR = DROPPED / (COMPLETED +
    DROPPED), Avg(MOSValue), Avg(MO_CallSetupTime), P'10 MOS / P'90 CST (PERCENTILE.INC),
    και για M->M Avg / P'90 MO_CallSetupTime_11000. Οι γραμμές των σελίδων Comparison δεν
    έχουν visual filter στο callStatus — ούτε εδώ."""
    op = _OPERATOR_CASE
    base = _series(
        cur,
        f"""
        SELECT {g} AS g, {op} AS operator,
            COUNT(callStatus) AS attempts,
            100.0 * SUM(CASE WHEN UPPER(callStatus) = 'COMPLETED' THEN 1 ELSE 0 END) / NULLIF(COUNT(callStatus), 0) AS successRate,
            100.0 * SUM(CASE WHEN UPPER(callStatus) = 'FAILED' THEN 1 ELSE 0 END) / NULLIF(COUNT(callStatus), 0) AS afr,
            100.0 * SUM(CASE WHEN UPPER(callStatus) = 'DROPPED' THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN UPPER(callStatus) IN ('COMPLETED', 'DROPPED') THEN 1 ELSE 0 END), 0) AS dcr,
            AVG(CAST(MOSValue AS float)) AS mos,
            AVG({_CST_EXPR}) AS cst
            {", AVG(" + _CST11000_EXPR + ") AS cst11000" if with_free_extras else ""}
        FROM {table} t JOIN #cmap m ON m.name = t.CollectionName
        GROUP BY {g}, {op}
        """,
        ["attempts", "successRate", "afr", "dcr", "mos", "cst"] + (["cst11000"] if with_free_extras else []),
    )
    parts = [base]
    if g == "m.scope":
        parts.append(_percentile_series(cur, table, op, "CAST(MOSValue AS float)", 0.1, "", "p10Mos", g))
        parts.append(_percentile_series(cur, table, op, _CST_EXPR, 0.9, "", "p90Cst", g))
        if with_free_extras:
            parts.append(_percentile_series(cur, table, op, _CST11000_EXPR, 0.9, "", "p90Cst11000", g))
    return _merge(*parts)


def _data_series(cur, g, monthly):
    """Comparison Data (30), Data 2 (31), Monthly Data (32):
      Capacity Avg(AvgThrpDL/UL) — TaskStatus = Success (kbps -> Mbps)
      Ping Weighted Average RTT = Σ(AvgRTT × SuccessTests) / Σ SuccessTests (όλα τα PacketSize)
      Browsing Avg(TransferDuration) — Success· Success Rate_500 (μόνο ανά Scope)
      HTTP Avg(Duration) DL / UL — Success
    Μόνο ανά Scope (30/31): OOKLA Avg(Throughput) DL / UL, Avg(Vmos) YouTube, HTTP UL P'10,
      N78 usage % ανά operator (Σ Duration σε N78 / Σ Duration σε NR, DL tests του NR DATA TECH)."""
    op = _OPERATOR_CASE
    parts = [
        _series(
            cur,
            f"""
            SELECT {g} AS g, {op} AS operator,
                AVG(CASE WHEN TaskStatus = 'Success' THEN CAST(AvgThrpDL AS float) END) / 1000.0 AS capDl,
                AVG(CASE WHEN TaskStatus = 'Success' THEN CAST(AvgThrpUL AS float) END) / 1000.0 AS capUl
            FROM BI_Capacity t JOIN #cmap m ON m.name = t.CollectionName
            GROUP BY {g}, {op}
            """,
            ["capDl", "capUl"],
        ),
        _series(
            cur,
            f"""
            SELECT {g} AS g, {op} AS operator,
                SUM(AvgRTT * SuccessTests) / NULLIF(SUM(CAST(SuccessTests AS float)), 0) AS pingRtt
            FROM BI_PING_NEW t JOIN #cmap m ON m.name = t.CollectionName
            GROUP BY {g}, {op}
            """,
            ["pingRtt"],
        ),
        _series(
            cur,
            f"""
            SELECT {g} AS g, {op} AS operator,
                AVG(CASE WHEN TransferStatus = 'OK' THEN CAST(TransferDuration AS float) END) AS browsingDuration,
                100.0 * SUM(CASE WHEN TransferStatus = 'OK' THEN 1 ELSE 0 END) / NULLIF(COUNT(TransferStatus), 0) AS browsingSuccess
            FROM BI_BROWSING_500KB t JOIN #cmap m ON m.name = t.CollectionName
            GROUP BY {g}, {op}
            """,
            ["browsingDuration", "browsingSuccess"],
        ),
        _series(
            cur,
            f"""
            SELECT {g} AS g, {op} AS operator,
                AVG(CASE WHEN Direction = 'Downlink' AND UPPER(TaskStatus) = 'SUCCESS' THEN CAST(Duration AS float) END) AS httpDlDuration,
                AVG(CASE WHEN Direction = 'Uplink' AND UPPER(TaskStatus) = 'SUCCESS' THEN CAST(Duration AS float) END) AS httpUlDuration
            FROM BI_HTTP t JOIN #cmap m ON m.name = t.CollectionName
            GROUP BY {g}, {op}
            """,
            ["httpDlDuration", "httpUlDuration"],
        ),
    ]
    if not monthly:
        parts.append(
            _series(
                cur,
                f"""
                SELECT {g} AS g, {op} AS operator,
                    AVG(CASE WHEN ActionName = 'Downlink Performance' THEN CAST(Throughput AS float) END) / 1000.0 AS ooklaDl,
                    AVG(CASE WHEN ActionName = 'Uplink Performance' THEN CAST(Throughput AS float) END) / 1000.0 AS ooklaUl
                FROM BI_OOKLA t JOIN #cmap m ON m.name = t.CollectionName
                WHERE ActionStatus = 'Success'
                GROUP BY {g}, {op}
                """,
                ["ooklaDl", "ooklaUl"],
            )
        )
        parts.append(
            _series(
                cur,
                f"""
                SELECT {g} AS g, {op} AS operator, AVG(CAST(TestQualityAvg AS float)) AS vmos
                FROM BI_YOUTUBE t JOIN #cmap m ON m.name = t.CollectionName
                GROUP BY {g}, {op}
                """,
                ["vmos"],
            )
        )
        parts.append(
            _percentile_series(
                cur, "BI_HTTP", op, f"{_HTTP_THRP} / 1000.0", 0.1, "AND Direction = 'Uplink' AND UPPER(TaskStatus) = 'SUCCESS'", "httpUlP10", g
            )
        )
        # Το BI_NR_DATA κρατάει STR_ID (πλήρες όνομα) — join στο str_id του #cmap.
        nr_in = ", ".join(f"'{t}'" for t in _NR_DL_TESTS)
        parts.append(
            _series(
                cur,
                f"""
                SELECT g, operator, 100.0 * SUM(CASE WHEN band = 'N78' THEN v ELSE 0 END) / NULLIF(SUM(v), 0) AS n78Usage
                FROM (
                    SELECT nm.g, {_LOCATION_OPERATOR} AS operator, {_NRARFCN_BAND} AS band, CAST(Duration AS float) AS v
                    FROM BI_NR_DATA t JOIN (SELECT DISTINCT str_id, scope AS g FROM #cmap) nm ON nm.str_id = t.STR_ID
                    WHERE t.TestName IN ({nr_in}) AND t.DL_NRARFCN IS NOT NULL
                ) x
                GROUP BY g, operator
                """,
                ["n78Usage"],
            )
        )
    return _merge(*parts)


def _to_list(series, chronological_key):
    keys = sorted(series, key=chronological_key)
    return [{"key": k, "operators": [{"operator": op, **series[k][op]} for op in _OPERATORS if op in series[k]]} for k in keys]


@router.get("/api/historic/comparison")
def get_historic_comparison(
    kind: str = Query(..., pattern="^(voice_gsm|voice_free|data)$"),
    area: str | None = None,
    category: str | None = None,
    coll: str | None = None,
):
    """X = Scope και X = μήνας για το `kind`. Επιστρέφει {"scopes": [...], "months": [...]}, κάθε
    στοιχείο {"key", "operators": [{operator, <metrics>}]}. Ορισμοί: _voice_series / _data_series."""
    key = (kind, area, category, coll)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL_S:
        return hit[1]
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        names = _selected_all(conn.cursor(), area, category, coll)
        conn.close()
        conn = None
        if not names:
            return {"scopes": [], "months": []}
        fact = _fact_map(names)
        months = _collection_months(fact)
        rows = [(f, s, _split_collection(s)[3], months.get(s)) for f, s in fact.items()]

        conn = get_connection("BI_DATA" if kind == "data" else "BI_VOICE")
        cur = conn.cursor()
        _load_map(cur, rows)
        if kind == "data":
            by_scope = _data_series(cur, "m.scope", monthly=False)
            by_month = _data_series(cur, "m.month", monthly=True)
        else:
            table = "BI_VOICE_MtoF" if kind == "voice_gsm" else "BI_VOICE_MtoM"
            extras = kind == "voice_free"
            by_scope = _voice_series(cur, table, "m.scope", extras)
            by_month = _voice_series(cur, table, "m.month", extras)
        result = {
            "scopes": _to_list(by_scope, lambda s: _scope_sort_key(s) or 0),
            "months": _to_list(by_month, lambda m: m),
        }
        _cache[key] = (time.monotonic(), result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


@router.get("/api/historic/grades_all")
def get_historic_grades_all(
    area: str | None = None,
    category: str | None = None,
    coll: str | None = None,
):
    """[33]–[36]: SUB_SCORE_* + WEIGHT ανά Scope × operator (βλ. roll-up παρακάτω) — το frontend
    εφαρμόζει τα Grade X / Visual * Score / Diff … measures (Cosmote − Vodafone, Cosmote − Nova)
    με τα sliders της σελίδας GRADES."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        names = _selected_all(cur, area, category, coll)
        if not names:
            return {"rows": []}
        _load_map(cur, [(n, n, _split_collection(n)[3], None) for n in names])
        op = _operator_case("Operator")
        cur.execute(
            f"""
            SELECT t.CollectionName, m.scope, {op} AS operator,
                   AVG(SUB_SCORE_GSM) AS gsm, AVG(SUB_SCORE_FREE) AS free,
                   AVG(SUB_SCORE_HTTP) AS http, AVG(SUB_SCORE_CAP) AS cap, AVG(SUB_SCORE_Browsing) AS browsing,
                   AVG(SUB_SCORE_YT) AS yt, AVG(SUB_SCORE_Ping) AS ping
            FROM BI_SCORES_TOTAL t JOIN #cmap m ON m.name = t.CollectionName
            GROUP BY t.CollectionName, m.scope, {op}
            """
        )
        # Roll-up ανά (Scope, operator): WEIGHT = Σ WEIGHT, SUB_SCORE_X = Σ(WEIGHT × SUB_SCORE_X) /
        # Σ WEIGHT (κενό SUB_SCORE -> 0, όπως το SUMX). Ίδιο σχήμα με τις γραμμές του /grades, ώστε
        # το aggregate() του HistoricGrades να δίνει ακριβώς Σ WEIGHT × Grade X / Σ WEIGHT.
        keys = ("gsm", "free", "http", "cap", "browsing", "yt", "ping")
        acc: dict[tuple, dict] = {}
        for row in cur.fetchall():
            if not _ok_operator(row.operator):
                continue
            w = _category_weight(_split_collection(row.CollectionName)[2])
            a = acc.setdefault((row.scope, row.operator), {"weight": 0.0, "collections": 0, **{k: 0.0 for k in keys}})
            a["weight"] += w
            a["collections"] += 1
            for k in keys:
                a[k] += w * (_f(getattr(row, k)) or 0.0)
        rows = [
            {
                "name": scope,
                "collection": scope,
                "scope": scope,
                "operator": op,
                "weight": a["weight"],
                "collections": a["collections"],
                "sub": {k: a[k] / a["weight"] for k in keys},
            }
            for (scope, op), a in sorted(acc.items(), key=lambda kv: (_scope_sort_key(kv[0][0]) or 0, kv[0][1]))
            if a["weight"]
        ]
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()
