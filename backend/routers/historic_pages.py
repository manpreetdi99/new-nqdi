"""Historic — οι σελίδες 01–05 του COSMOTE BENCHMARKING BI REPORT v12.pbix:

  [01] GREECE MAP                -> /api/historic/greece_map
  [02] GRADES                    -> /api/historic/grades
  [03] VOICE M->F                -> /api/historic/voice_page?kind=mtof
  [04] VOICE M->M                -> /api/historic/voice_page?kind=mtom
  [05] RADIO TECH-VOICE CODECS   -> /api/historic/radio_codecs
  [14] DATA-BANDWIDTH (scatter)  -> /api/historic/data_bandwidth

Σε αντίθεση με το historic.py (ΕΝΑ CollectionName τη φορά), εδώ το φίλτρο είναι οι slicers
της σελίδας του .pbix: Scope (υποχρεωτικό) + προαιρετικά GreaterArea / Category /
CollectionName — pooled πάνω σε ΟΛΑ τα collections που ταιριάζουν, όπως φιλτράρει ο
`ALL INFO SYNCED FILTERS` πίνακας μέσω STR_ID. Κάθε measure αντιγράφει το DAX του
COSMOTE_BI_lineage_ana_selida_1.md· όπου ξεφεύγουμε, το σχόλιο το λέει.

Τα helpers (operator groups, Scope fallback 2019H2, 3-part fact names, category WEIGHT)
είναι του historic.py — ίδιοι κανόνες Power Query, βλ. το docstring εκεί.
"""
from fastapi import APIRouter, HTTPException, Query

from api_utils import sinr_throughput_scatter
from db import get_connection
from routers.historic import (
    _CST_EXPR,
    _OPERATOR_CASE,
    _category_weight,
    _f,
    _fact_names,
    _operator_case,
    _operator_key,
    _pct,
    _scope_sort_key,
    _split_collection,
)

router = APIRouter(tags=["historic"])

_OPERATORS = ("COSMOTE", "VODAFONE", "NOVA")


def _all_collections(cur) -> list[str]:
    cur.execute("SELECT DISTINCT CollectionName FROM BI_SCORES_TOTAL WHERE CollectionName IS NOT NULL")
    return [row[0] for row in cur.fetchall() if row[0]]


def _matches(name: str, scope: str, area: str | None, category: str | None, collection: str | None) -> bool:
    a, _, cat, sc = _split_collection(name)
    if sc != scope:
        return False
    if area and a != area:
        return False
    if category and (cat or "").strip().upper() != category.strip().upper():
        return False
    if collection and name != collection:
        return False
    return True


def _selected(cur, scope, area, category, collection) -> list[str]:
    """Τα STR_ID (ονόματα του BI_SCORES_TOTAL) που περνάνε τους slicers."""
    return sorted(n for n in _all_collections(cur) if _matches(n, scope, area, category, collection))


def _fact_map(names: list[str]) -> dict[str, str]:
    """fact-table CollectionName -> STR_ID. Για τα 2019H2 τα fact tables έχουν το 3-part
    όνομα (βλ. historic._fact_names) — και τα δύο δείχνουν στο ίδιο STR_ID."""
    out = {}
    for n in names:
        for fact in _fact_names(n):
            out[fact] = n
    return out


def _str_id(fact: dict[str, str], name: str) -> str | None:
    """Lookup στο _fact_map ανεκτικό σε trailing spaces: το `IN (...)` του SQL Server τα
    αγνοεί (ANSI padding), οπότε επιστρέφει π.χ. "…_TOURISTIC AREAS " για κλειδί χωρίς κενό."""
    return fact.get(name) or fact.get(name.rstrip())


def _in(values) -> str:
    return "(" + ",".join("?" * len(values)) + ")"


def _ok_operator(op: str) -> bool:
    return op in _OPERATORS


@router.get("/api/historic/filters")
def get_historic_filters():
    """Οι επιλογές των slicers (Scope / GreaterArea / Category / CollectionName), με το ίδιο
    split του Power Query που χρησιμοποιούν όλα τα endpoints εδώ."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        rows = []
        for name in _all_collections(cur):
            area, coll, cat, scope = _split_collection(name)
            rows.append({"name": name, "area": area, "collection": coll, "category": (cat or "").strip(), "scope": scope})
        scopes = sorted({r["scope"] for r in rows}, key=lambda s: (_scope_sort_key(s) is None, -(_scope_sort_key(s) or 0), s))
        return {"scopes": scopes, "collections": sorted(rows, key=lambda r: r["name"])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ─────────────────────────────── [01] GREECE MAP ───────────────────────────────


@router.get("/api/historic/greece_map")
def get_historic_greece_map(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """01.1 χάρτης (BEST_OPERATOR ανά COLLECTION NAME), 01.2 matrix (Avg TOTAL_SCORE ανά
    collection × operator), 01.4 πίτα (πλήθος νικών), 01.3/01.5 Min/Max(MtoM[StartDate]),
    01.6–01.8 KMS_DATA_HOURS (ώρες:λεπτά, GB = MB × 1/1024, KMs).

    ΑΠΟΚΛΙΣΗ: το .pbix παίρνει Lat/Lon από merge με το GIS.xlsx (Z: drive) — το
    BI_BEST_OP_SCORE στο warehouse ΔΕΝ έχει συντεταγμένες. Εδώ κάθε collection μπαίνει στο
    κέντρο βάρους των testStart σημείων των κλήσεων του (MtoM ∪ MtoF), μέσα σε ένα
    bounding box της Ελλάδας ώστε τα 0/0 GPS να μη μετακινούν το σημείο."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        names = _selected(cur, scope, area, category, collection)
        empty_kpis = {"firstDate": None, "lastDate": None, "minutes": None, "dataGb": None, "kms": None}
        if not names:
            return {"collections": [], "kpis": empty_kpis}

        op = _operator_case("Operator")
        cur.execute(
            f"""
            SELECT CollectionName, {op} AS operator, AVG(TOTAL_SCORE) AS total, AVG(TOTAL_VOICE) AS voice, AVG(TOTAL_DATA) AS data
            FROM BI_SCORES_TOTAL
            WHERE CollectionName IN {_in(names)}
            GROUP BY CollectionName, {op}
            """,
            names,
        )
        scores: dict[str, dict] = {}
        for row in cur.fetchall():
            if _ok_operator(row.operator):
                scores.setdefault(row.CollectionName, {})[row.operator] = {
                    "total": _f(row.total),
                    "voice": _f(row.voice),
                    "data": _f(row.data),
                }

        cur.execute(
            f"""
            SELECT [COLLECTION NAME] AS name, CATEGORY, BEST_OPERATOR, BEST_SCORE
            FROM BI_BEST_OP_SCORE
            WHERE [COLLECTION NAME] IN {_in(names)}
            """,
            names,
        )
        # Ισοβαθμίες γράφουν δύο γραμμές για το ίδιο CATEGORY — κρατάμε όλους τους νικητές.
        winners: dict[str, dict[str, dict]] = {}
        for row in cur.fetchall():
            key = _operator_key(row.BEST_OPERATOR)
            entry = winners.setdefault(row.name, {}).setdefault(row.CATEGORY, {"operators": [], "score": _f(row.BEST_SCORE)})
            if key not in entry["operators"]:
                entry["operators"].append(key)

        fact = _fact_map(names)
        facts = list(fact)
        # Κέντρο βάρους ανά collection — SUM/COUNT ώστε να ενώσουμε MtoM και MtoF σωστά.
        centroid: dict[str, list] = {}
        for table in ("BI_VOICE_MtoM", "BI_VOICE_MtoF"):
            cur.execute(
                f"""
                SELECT CollectionName, SUM(testStartLat) AS slat, SUM(testStartLong) AS slon, COUNT(*) AS n
                FROM {table}
                WHERE CollectionName IN {_in(facts)}
                  AND testStartLat BETWEEN 34.5 AND 42.0 AND testStartLong BETWEEN 19.0 AND 30.0
                GROUP BY CollectionName
                """,
                facts,
            )
            for row in cur.fetchall():
                str_id = _str_id(fact, row.CollectionName)
                if str_id is None:
                    continue
                acc = centroid.setdefault(str_id, [0.0, 0.0, 0])
                acc[0] += row.slat
                acc[1] += row.slon
                acc[2] += row.n

        cur.execute(
            f"""
            SELECT MIN(TRY_CONVERT(date, StartDate, 104)) AS first_date, MAX(TRY_CONVERT(date, StartDate, 104)) AS last_date
            FROM BI_VOICE_MtoM
            WHERE CollectionName IN {_in(facts)}
            """,
            facts,
        )
        dates = cur.fetchone()
        conn.close()

        conn = get_connection("BI_DATA")
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT SUM(Minutes) AS minutes, SUM(Data_Transferred_MBs) AS mbs, SUM(KMs) AS kms
            FROM BI_KMS_DATA_HOURS
            WHERE CollectionName IN {_in(facts)}
            """,
            facts,
        )
        kms = cur.fetchone()

        collections = []
        for name in names:
            a, coll, cat, _ = _split_collection(name)
            c = centroid.get(name)
            collections.append(
                {
                    "name": name,
                    "area": a,
                    "collection": coll,
                    "category": (cat or "").strip(),
                    "lat": c[0] / c[2] if c else None,
                    "lon": c[1] / c[2] if c else None,
                    "scores": scores.get(name, {}),
                    "winners": winners.get(name, {}),
                }
            )

        return {
            "collections": collections,
            "kpis": {
                "firstDate": dates.first_date.isoformat() if dates and dates.first_date else None,
                "lastDate": dates.last_date.isoformat() if dates and dates.last_date else None,
                "minutes": kms.minutes if kms else None,
                # Data_Transferred_GBs του μοντέλου = MBs × 0.0009765625 (1/1024).
                "dataGb": _f(kms.mbs) / 1024.0 if kms and kms.mbs is not None else None,
                "kms": _f(kms.kms) if kms else None,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ─────────────────────────────── [02] GRADES ───────────────────────────────


@router.get("/api/historic/grades")
def get_historic_grades(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """Τα SUB_SCORE_* (0–1) ανά (collection, operator) + το WEIGHT της κατηγορίας. Τα 8
    sliders της σελίδας GRADES (Voice_scores_total, Voice GSM/FREE, HTTP, Capacity, Browsing,
    YouTube, Ping) εφαρμόζονται στο frontend — το DAX είναι καθαρή αριθμητική πάνω σε αυτά:

      Grade X              = SUB_SCORE_X × base_X × slider_X × CorrectionFactor(group)
      CF Voice / CF DATA   = 10 × group weight / Σ_group(base × slider)
      Visuals Total Score  = Σ WEIGHT × Σ_X Grade X / Σ WEIGHT

    με base: GSM 150, FREE 250, HTTP 100, Capacity 275, Browsing 100, YouTube 100, Ping 25
    (επαληθεύτηκε: SCORE_X / SUB_SCORE_X == base σε ΟΛΕΣ τις γραμμές του BI_SCORES_TOTAL).
    AVG ανά (collection, operator) γιατί μερικά collections έχουν διπλές γραμμές — ίδιο
    WEIGHT, άρα ίδιο αποτέλεσμα με το SUMX του report."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        names = _selected(cur, scope, area, category, collection)
        if not names:
            return {"rows": []}
        op = _operator_case("Operator")
        cur.execute(
            f"""
            SELECT CollectionName, {op} AS operator,
                   AVG(SUB_SCORE_GSM) AS gsm, AVG(SUB_SCORE_FREE) AS free,
                   AVG(SUB_SCORE_HTTP) AS http, AVG(SUB_SCORE_CAP) AS cap, AVG(SUB_SCORE_Browsing) AS browsing,
                   AVG(SUB_SCORE_YT) AS yt, AVG(SUB_SCORE_Ping) AS ping
            FROM BI_SCORES_TOTAL
            WHERE CollectionName IN {_in(names)}
            GROUP BY CollectionName, {op}
            """,
            names,
        )
        rows = []
        for row in cur.fetchall():
            if not _ok_operator(row.operator):
                continue
            _, coll, cat, _ = _split_collection(row.CollectionName)
            rows.append(
                {
                    "name": row.CollectionName,
                    "collection": coll,
                    "operator": row.operator,
                    "weight": _category_weight(cat),
                    "sub": {
                        "gsm": _f(row.gsm),
                        "free": _f(row.free),
                        "http": _f(row.http),
                        "cap": _f(row.cap),
                        "browsing": _f(row.browsing),
                        "yt": _f(row.yt),
                        "ping": _f(row.ping),
                    },
                }
            )
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ─────────────────────────────── [03] / [04] VOICE ───────────────────────────────

# MtoM[CallModeA] (calculated column) σε SQL. Πιστό στο DAX — και στο LEFT(testStartMode, 3)
# = "UMTS" που δεν ισχύει ποτέ (3 χαρακτήρες), άρα '-' σε UMTS μένει κενό και το visual
# filter το πετάει μαζί με (VoNR)/Unknown/null.
_CALL_MODE_A = """
    CASE
        WHEN callmode = '-' THEN
            CASE WHEN LEFT(testStartMode, 3) = 'LTE' THEN 'VoLTE'
                 WHEN LEFT(testStartMode, 3) = 'GSM' THEN 'CS' END
        WHEN callmode = 'EPSFB' THEN 'VoLTE'
        ELSE callmode
    END
"""

# MtoF[CustomCallMode] (calculated column): CS -> CS, '-'/CSFB -> CSFB.
_CUSTOM_CALL_MODE_MF = """
    CASE
        WHEN callmode = 'CS' THEN 'CS'
        WHEN callmode IN ('-', 'CSFB') THEN 'CSFB'
        ELSE callmode
    END
"""

# ASideSRVCCDuration είναι varchar ('       254', '' όταν δεν έγινε SRVCC) — ms.
_SRVCC_EXPR = "TRY_CAST(NULLIF(LTRIM(RTRIM(ASideSRVCCDuration)), '') AS float)"
_CST11000_EXPR = "TRY_CAST(NULLIF(LTRIM(RTRIM(MO_CallSetupTime_11000)), '') AS float)"


def _percentiles(cur, table, facts, value_expr, q, where=""):
    cur.execute(
        f"""
        SELECT DISTINCT {_OPERATOR_CASE} AS operator,
            PERCENTILE_CONT({q}) WITHIN GROUP (ORDER BY {value_expr}) OVER (PARTITION BY {_OPERATOR_CASE}) AS p
        FROM {table}
        WHERE CollectionName IN {_in(facts)} {where}
        """,
        facts,
    )
    return {row.operator: _f(row.p) for row in cur.fetchall()}


@router.get("/api/historic/voice_page")
def get_historic_voice_page(
    kind: str = Query(..., pattern="^(mtof|mtom)$"),
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """Σελίδες VOICE M->F (BI_VOICE_MtoF) και VOICE M->M (BI_VOICE_MtoM).

    Κοινά (cards ανά operator):
      CALL ATTEMPTS = COUNT(callStatus) · FAILED / DROPPED CALLS = COUNTROWS(callStatus = …)
      Success Rate = COMPLETED / ATTEMPTS · AFR = FAILED / ATTEMPTS · DCR = DROPPED / (COMPLETED + DROPPED)
      Avg CST / P'90 CST — visual filter callStatus IN {Completed, Dropped}
      Avg MOS / P'10 MOS = PERCENTILE.INC(MOSValue, 0.1)
      Low MOS % (funnel 03.32/04.37) = COUNT(lowMOs | lowmosfree) / COUNT(callStatus)
    M->F: CustomCallMode mix ανά Operator (groups) (03.4), Avg(ThreeGMO) (03.27 — CSFB 3G MO setup).
    M->M: CallModeA mix (04.4, χωρίς (VoNR)/Unknown/null), Inter_Suc_rate / Intra_Succ_Rate
      (04.5/04.15), Avg(ASideSRVCCDuration) (04.23, ms), Avg / P'90 MO_CallSetupTime_11000 με
      visual filter callDir = A->B (04.28–04.36).
    Χάρτης (03.28/04.24): testEnd σημεία των Dropped/Failed κλήσεων."""
    table = "BI_VOICE_MtoF" if kind == "mtof" else "BI_VOICE_MtoM"
    low_mos_col = "lowMOs" if kind == "mtof" else "lowmosfree"
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        names = _selected(cur, scope, area, category, collection)
        if not names:
            return {"operators": [], "callModes": [], "failures": []}
        facts = list(_fact_map(names))
        cst_where = "AND UPPER(callStatus) IN ('COMPLETED', 'DROPPED')"

        extra = ""
        if kind == "mtof":
            extra = ", AVG(CAST(ThreeGMO AS float)) AS three_g_mo"
        else:
            extra = f""",
                SUM(CAST(sucIntrHO AS float)) AS suc_inter,
                SUM(CASE WHEN sucIntrHO IS NOT NULL THEN CAST(numIntrHo AS float) END) AS num_inter,
                SUM(CAST(sucIntraHO AS float)) AS suc_intra,
                SUM(CASE WHEN sucIntraHO IS NOT NULL THEN CAST(numIntraHO AS float) END) AS num_intra,
                AVG({_SRVCC_EXPR}) AS srvcc_ms,
                AVG(CASE WHEN callDir = 'A->B' THEN {_CST11000_EXPR} END) AS avg_cst_11000"""

        cur.execute(
            f"""
            SELECT
                {_OPERATOR_CASE} AS operator,
                COUNT(callStatus) AS attempts,
                SUM(CASE WHEN UPPER(callStatus) = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN UPPER(callStatus) = 'FAILED' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN UPPER(callStatus) = 'DROPPED' THEN 1 ELSE 0 END) AS dropped,
                AVG(CASE WHEN UPPER(callStatus) IN ('COMPLETED', 'DROPPED') THEN {_CST_EXPR} END) AS avg_cst,
                AVG(CAST(MOSValue AS float)) AS mos,
                COUNT({low_mos_col}) AS low_mos{extra}
            FROM {table}
            WHERE CollectionName IN {_in(facts)}
            GROUP BY {_OPERATOR_CASE}
            """,
            facts,
        )
        base = {row.operator: row for row in cur.fetchall() if _ok_operator(row.operator)}

        p90_cst = _percentiles(cur, table, facts, _CST_EXPR, 0.9, cst_where)
        p10_mos = _percentiles(cur, table, facts, "CAST(MOSValue AS float)", 0.1)
        p90_cst_11000 = (
            _percentiles(cur, table, facts, _CST11000_EXPR, 0.9, "AND callDir = 'A->B'") if kind == "mtom" else {}
        )

        operators = []
        for op in _OPERATORS:
            row = base.get(op)
            if row is None:
                continue
            out = {
                "operator": op,
                "attempts": row.attempts,
                "completed": row.completed,
                "failed": row.failed,
                "dropped": row.dropped,
                "successRate": _pct(row.completed, row.attempts),
                "afr": _pct(row.failed, row.attempts),
                "dcr": _pct(row.dropped, (row.completed or 0) + (row.dropped or 0)),
                "avgCst": _f(row.avg_cst),
                "p90Cst": p90_cst.get(op),
                "mos": _f(row.mos),
                "p10Mos": p10_mos.get(op),
                "lowMosPct": _pct(row.low_mos, row.attempts),
            }
            if kind == "mtof":
                out["threeGMo"] = _f(row.three_g_mo)
            else:
                out.update(
                    {
                        "interHoSr": _pct(row.suc_inter, row.num_inter),
                        "intraHoSr": _pct(row.suc_intra, row.num_intra),
                        "srvccDurationMs": _f(row.srvcc_ms),
                        "avgCst11000": _f(row.avg_cst_11000),
                        "p90Cst11000": p90_cst_11000.get(op),
                    }
                )
            operators.append(out)

        # 03.4 ομαδοποιεί ανά Operator (groups) — όχι HomeOperator (διαφέρουν σε ~800 γραμμές).
        mode_expr, mode_op, mode_where = (
            (_CUSTOM_CALL_MODE_MF, _operator_case("Operator"), "")
            if kind == "mtof"
            else (_CALL_MODE_A, _OPERATOR_CASE, "")
        )
        cur.execute(
            f"""
            SELECT operator, mode, COUNT(*) AS n FROM (
                SELECT {mode_op} AS operator, {mode_expr} AS mode
                FROM {table}
                WHERE CollectionName IN {_in(facts)} {mode_where}
            ) x
            WHERE mode IS NOT NULL AND mode NOT IN ('(VoNR)', 'Unknown')
            GROUP BY operator, mode
            """,
            facts,
        )
        call_modes = [
            {"operator": row.operator, "mode": row.mode.strip(), "count": row.n}
            for row in cur.fetchall()
            if _ok_operator(row.operator)
        ]

        cur.execute(
            f"""
            SELECT TOP 5000 {_OPERATOR_CASE} AS operator, callStatus, testEndLat, testEndLong, CollectionName
            FROM {table}
            WHERE CollectionName IN {_in(facts)}
              AND UPPER(callStatus) IN ('DROPPED', 'FAILED')
              AND testEndLat BETWEEN 34.5 AND 42.0 AND testEndLong BETWEEN 19.0 AND 30.0
            """,
            facts,
        )
        failures = [
            {
                "operator": row.operator,
                "status": "Dropped" if row.callStatus.upper() == "DROPPED" else "Failed",
                "lat": row.testEndLat,
                "lon": row.testEndLong,
                "collection": row.CollectionName,
            }
            for row in cur.fetchall()
            if _ok_operator(row.operator)
        ]

        return {"operators": operators, "callModes": call_modes, "failures": failures}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ─────────────────────────────── [05] RADIO TECH-VOICE CODECS ───────────────────────────────

# Voice Technology[Home Operator] — group πάνω στο ASideLocation (το BI_RADIO_TECH δεν έχει
# HomeOperator).
_LOCATION_OPERATOR = """
    CASE
        WHEN ASideLocation LIKE 'Cosmote%' THEN 'COSMOTE'
        WHEN ASideLocation LIKE 'Vodafone%' THEN 'VODAFONE'
        WHEN ASideLocation LIKE 'Nova%' OR ASideLocation LIKE 'Wind%' THEN 'NOVA'
        ELSE 'OTHER'
    END
"""

# Τα visual filters της σελίδας, αυτούσια.
_GSM_LOCATIONS = ("Cosmote GSM", "Vodafone GSM", "Wind GSM", "Nova GSM")
_FREE_LOCATIONS = (
    "Cosmote Free", "Cosmote Free A", "Cosmote Free ASide",
    "Nova Free A",
    "Vodafone Free", "Vodafone Free A", "Vodafone Free ASide",
    "Wind Free", "Wind Free A", "Wind Free ASide",
)
# 05.5: NOT IN {…} — αφήνει μέσα και το Cosmote_VoLTE_A.
_EVS_EXCLUDED = ("Cosmote GSM", "Vodafone GSM", "Cosmote Free 1", "Vodafone Free 1", "Wind GSM", "Wind Free 1", "Nova GSM")

_RADIO_BANDS = [
    ("LTE B1", "[LTE B1_Samples]"),
    ("LTE B3", "[LTE B3_Samples]"),
    ("LTE B7", "[LTE B7_Samples]"),
    ("LTE B8", "[LTE B8_Samples]"),
    ("LTE B20", "[LTE B20_Samples]"),
    ("LTE B28", "[LTE B28_Samples]"),
    ("UMTS", "UMTS_Total_Samples"),
    ("GSM", "GSM_Total_Samples"),
]


def _codec_mix(cur, facts, location_sql, location_params, parts):
    """Samples ανά codec (Sum) + MOS (μέσος σταθμισμένος με τα samples του codec — το
    report δείχνει Average(MOS_X) ανά γραμμή, ίδιο για ένα collection)."""
    select = ",\n".join(
        f"SUM(CAST({cnt} AS float)) AS n{i}, SUM(CAST({mos} AS float) * {cnt}) / NULLIF(SUM(CASE WHEN {mos} IS NOT NULL THEN CAST({cnt} AS float) END), 0) AS mos{i}"
        for i, (_, cnt, mos) in enumerate(parts)
    )
    cur.execute(
        f"""
        SELECT {_OPERATOR_CASE} AS operator, {select}
        FROM BI_VOICE_CODEC
        WHERE CollectionName IN {_in(facts)} AND {location_sql}
        GROUP BY {_OPERATOR_CASE}
        """,
        [*facts, *location_params],
    )
    out = []
    for row in cur.fetchall():
        if not _ok_operator(row.operator):
            continue
        out.append(
            {
                "operator": row.operator,
                "parts": [
                    {"key": key, "value": _f(getattr(row, f"n{i}")) or 0.0, "mos": _f(getattr(row, f"mos{i}"))}
                    for i, (key, _, _) in enumerate(parts)
                ],
            }
        )
    return out


@router.get("/api/historic/radio_codecs")
def get_historic_radio_codecs(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """Σελίδα RADIO TECH-VOICE CODECS — 5 x 100% stacked bars ανά operator:
      05.2 GSM band (GSM 900 / 1800) στις GSM θέσεις (BI_RADIO_TECH)
      05.4 τεχνολογία/LTE band στις Free θέσεις (BI_RADIO_TECH)
      05.1 codec στις GSM θέσεις: AMR-WB / AMR / άλλα (BI_VOICE_CODEC)
      05.3 codec στις Free θέσεις: EVS / AMR-WB / AMR
      05.5 EVS/AMR-WB bit rate στις Free θέσεις (εκτός "Free 1"): EVS >13.2 / 13.2 / <13.2,
           AMR-WB >0 / =0, AMR. Οι στήλες εδώ είναι ΗΔΗ ποσοστά ανά γραμμή — το report κάνει
           Sum + κανονικοποίηση 100%· εμείς σταθμίζουμε με Total_Samples ώστε πολλά collections
           να μη μετράνε ισοβαρώς (ίδιο αποτέλεσμα για ένα collection)."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        names = _selected(cur, scope, area, category, collection)
        empty = {"gsmBands": [], "freeTech": [], "gsmCodecs": [], "freeCodecs": [], "evsRates": []}
        if not names:
            return empty
        facts = list(_fact_map(names))

        def radio(columns, locations):
            select = ", ".join(f"SUM(CAST({col} AS float)) AS n{i}" for i, (_, col) in enumerate(columns))
            cur.execute(
                f"""
                SELECT {_LOCATION_OPERATOR} AS operator, {select}
                FROM BI_RADIO_TECH
                WHERE CollectionName IN {_in(facts)} AND ASideLocation IN {_in(locations)}
                GROUP BY {_LOCATION_OPERATOR}
                """,
                [*facts, *locations],
            )
            return [
                {"operator": row.operator, "parts": [{"key": label, "value": _f(getattr(row, f"n{i}")) or 0.0, "mos": None} for i, (label, _) in enumerate(columns)]}
                for row in cur.fetchall()
                if _ok_operator(row.operator)
            ]

        gsm_bands = radio([("GSM 900", "GSM_900_Samples"), ("GSM 1800", "GSM_1800_Samples")], _GSM_LOCATIONS)
        free_tech = radio(_RADIO_BANDS, _FREE_LOCATIONS)

        gsm_codecs = _codec_mix(
            cur, facts, f"ASideLocation IN {_in(_GSM_LOCATIONS)}", list(_GSM_LOCATIONS),
            [("AMR-WB", "AMR_WB_Samples", "MOS_AMR_WB"), ("AMR", "AMR_Samples", "MOS_AMR"), ("Other", "All_Others", "MOS_All_Others")],
        )
        free_codecs = _codec_mix(
            cur, facts, f"ASideLocation IN {_in(_FREE_LOCATIONS)}", list(_FREE_LOCATIONS),
            [("EVS", "EVS_Samples", "MOS_EVS"), ("AMR-WB", "AMR_WB_Samples", "MOS_AMR_WB"), ("AMR", "AMR_Samples", "MOS_AMR")],
        )

        rate_parts = [
            ("EVS >13.2", "EVS_24", "MOS_EVS_24"),
            ("EVS 13.2", "EVS_13", "MOS_EVS_13"),
            ("EVS <13.2", "EVS_lower_13", "MOS_EVS_lower_13"),
            ("AMR-WB >0", "AMR_WB_NOT_0", "MOS_AMR_WB_not_0"),
            ("AMR-WB 0", "AMR_WB_0", "MOS_AMR_WB_0"),
            ("AMR", "AMR", "MOS_AMR"),
        ]
        select = ",\n".join(
            f"SUM(CAST({pct} AS float) * Total_Samples) / NULLIF(SUM(CASE WHEN {pct} IS NOT NULL THEN CAST(Total_Samples AS float) END), 0) AS v{i}, "
            f"SUM(CAST({mos} AS float) * Total_Samples) / NULLIF(SUM(CASE WHEN {mos} IS NOT NULL THEN CAST(Total_Samples AS float) END), 0) AS mos{i}"
            for i, (_, pct, mos) in enumerate(rate_parts)
        )
        cur.execute(
            f"""
            SELECT {_OPERATOR_CASE} AS operator, {select}
            FROM BI_VOICE_CODEC
            WHERE CollectionName IN {_in(facts)} AND ASideLocation NOT IN {_in(_EVS_EXCLUDED)}
            GROUP BY {_OPERATOR_CASE}
            """,
            [*facts, *_EVS_EXCLUDED],
        )
        evs_rates = [
            {
                "operator": row.operator,
                "parts": [
                    {"key": key, "value": _f(getattr(row, f"v{i}")) or 0.0, "mos": _f(getattr(row, f"mos{i}"))}
                    for i, (key, _, _) in enumerate(rate_parts)
                ],
            }
            for row in cur.fetchall()
            if _ok_operator(row.operator)
        ]

        return {
            "gsmBands": gsm_bands,
            "freeTech": free_tech,
            "gsmCodecs": gsm_codecs,
            "freeCodecs": free_codecs,
            "evsRates": evs_rates,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ─────────────────────────────── [14] DATA-BANDWIDTH ───────────────────────────────


@router.get("/api/historic/data_bandwidth")
def get_historic_data_bandwidth(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """Τα δύο scatter της σελίδας DATA-BANDWIDTH: 14.4 X = Capacity[testAvgSINR],
    Y = Capacity[AvgThrpDL] και 14.6 ίδιο με Y = Capacity[AvgThrpUL], series = HomeOperator
    (groups), visual filter TaskStatus = 'Success'. Ένα σημείο ανά test (το AvgThrpDL είναι
    γεμάτο μόνο στα Capacity DL, το AvgThrpUL μόνο στα Capacity UL). kbps -> Mbps εδώ, όπως
    στο /api/historic/data."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        names = _selected(conn.cursor(), scope, area, category, collection)
        conn.close()
        conn = None
        if not names:
            return {"dl": [], "ul": []}
        facts = list(_fact_map(names))

        conn = get_connection("BI_DATA")
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT {_OPERATOR_CASE} AS operator, CAST(testAvgSINR AS float) AS sinr,
                   CAST(AvgThrpDL AS float) / 1000.0 AS dl, CAST(AvgThrpUL AS float) / 1000.0 AS ul
            FROM BI_Capacity
            WHERE CollectionName IN {_in(facts)} AND TaskStatus = 'Success' AND testAvgSINR IS NOT NULL
              AND (AvgThrpDL IS NOT NULL OR AvgThrpUL IS NOT NULL)
            ORDER BY TestId
            """,
            facts,
        )
        rows = []
        for row in cur.fetchall():
            if row.dl is not None:
                rows.append((row.operator, "DL", row.sinr, row.dl))
            if row.ul is not None:
                rows.append((row.operator, "UL", row.sinr, row.ul))
        return sinr_throughput_scatter(rows, _OPERATORS)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()
