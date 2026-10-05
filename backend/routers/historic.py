"""Σελίδα Historic: read-only KPI snapshot από το BI data warehouse (BI_VOICE/BI_DATA),
ΕΝΑ campaign (CollectionName) τη φορά, συν μια χρονοσειρά ανά Scope.

Ρητά ξεχωριστό από τα routers/* του "live" swissqual-srvsa dataset (calls.py,
data_calls.py, filters.py, ...):
  - άλλο connection target — πάντα BI_VOICE / BI_DATA (όχι το `database` dropdown που
    διαλέγει ο χρήστης στα άλλα tabs),
  - άλλο σχήμα — star-schema warehouse με CollectionName ως μοναδικό dimension key,
    semi-annual campaigns από το 2019 μέχρι σήμερα,
  - ανά-operator KPIs αντί για raw per-session rows.

Κάθε KPI εδώ αντιγράφει τον ορισμό του COSMOTE BENCHMARKING BI REPORT v12.pbix — τα
measures/aggregations των σελίδων «Comparison Voice GSM / Voice Free / Voice Free (MOS/CST)
/ Data» και «GRADES» (Report/Layout του .pbix + §04/§05 του COSMOTE_BI_Blueprint.html).
Όπου το .pbix δεν επιβεβαιώνει κάτι, το σχόλιο το λέει ρητά.

Δύο κανόνες του Power Query που ΠΡΕΠΕΙ να αναπαράγονται, αλλιώς τα νούμερα δεν βγαίνουν:
  1. Scope = 4ο κομμάτι του CollectionName, με fallback "2019H2" όταν λείπει. Τα fact tables
     έχουν ΟΛΑ τα 2019H2 collections ως 3-part ονόματα ("ATH_X_MAIN ROADS") ενώ το
     BI_SCORES_TOTAL τα έχει ως "ATH_X_MAIN ROADS_2019H2" — βλ. _fact_names / _split_collection.
     Το PARSENAME δεν κάνει αυτή τη δουλειά: επιστρέφει την κατηγορία για τα 3-part και NULL
     για ονόματα με τελεία ("AG.NIKOLAOS").
  2. Operator: Cosmote / Vodafone / Nova, με το Wind ενοποιημένο στο Nova (HomeOperator
     (groups) του μοντέλου) — ισχύει ΚΑΙ για το BI_SCORES_TOTAL[Operator] που είναι raw
     ("Cosmote", "Wind", ...), όχι μόνο για τα fact tables.
"""
import re

from fastapi import APIRouter, HTTPException, Query

from db import get_connection

router = APIRouter(tags=["historic"])


def _operator_case(column: str) -> str:
    """HomeOperator (groups) του μοντέλου σε SQL. 'Wind' μπαίνει σκόπιμα στο NOVA (merged
    historical alias) ώστε τα legacy campaigns να συγκρίνονται σωστά με τα σημερινά."""
    return f"""
    CASE
        WHEN {column} LIKE 'Cosmote%'  THEN 'COSMOTE'
        WHEN {column} LIKE 'Vodafone%' THEN 'VODAFONE'
        WHEN {column} IN ('NOVA', 'Nova', 'Wind') THEN 'NOVA'
        ELSE 'OTHER'
    END
"""


_OPERATOR_CASE = _operator_case("HomeOperator")


def _operator_key(raw: str | None) -> str:
    """Python δίδυμο του _operator_case, για τιμές που δεν περνάνε από GROUP BY
    (BI_BEST_OP_SCORE[BEST_OPERATOR])."""
    s = (raw or "").strip().upper()
    if s.startswith("COSMOTE"):
        return "COSMOTE"
    if s.startswith("VODAFONE"):
        return "VODAFONE"
    if s in ("NOVA", "WIND"):
        return "NOVA"
    return "OTHER"


# Power Query γράφει "2019H2" όποτε το CollectionName δεν έχει 4ο κομμάτι (§08 του blueprint).
_FALLBACK_SCOPE = "2019H2"


def _split_collection(name: str | None):
    """Power Query split του CollectionName σε (GreaterArea, CollectionName, Category, Scope)
    — 4 κομμάτια με '_', τα επιπλέον κόβονται, και Scope = "2019H2" όταν λείπει."""
    parts = (name or "").split("_")[:4]
    parts += [None] * (4 - len(parts))
    area, collection, category, scope = parts
    return area, collection, category, _FALLBACK_SCOPE if scope is None else scope


def _fact_names(collection: str) -> tuple[str, str]:
    """Τα CollectionName των fact tables που αντιστοιχούν σε ένα STR_ID του BI_SCORES_TOTAL.
    Για "…_2019H2" το fact table έχει το ίδιο όνομα ΧΩΡΙΣ το scope (βλ. docstring του
    module) — χωρίς αυτό κάθε 2019H2 campaign έβγαζε άδειους πίνακες Voice/Data/Video.
    Πάντα 2 τιμές, ώστε το SQL να είναι σταθερό `CollectionName IN (?, ?)`."""
    suffix = "_" + _FALLBACK_SCOPE
    if collection.endswith(suffix) and len(collection.split("_")) == 4:
        return collection, collection[: -len(suffix)]
    return collection, collection


# Το WEIGHT ανά κατηγορία περιοχής, custom column στο Power Query (§05 του blueprint) — ο
# σταθμισμένος μέσος όρος του Visuals Total Score ΠΑΝΤΑ περνάει από αυτό όταν συνδυάζεις
# περισσότερα από ένα collection. UPPER/strip γιατί η πηγή έχει typo + leading space
# (" MAJOR TOWNS", "MAKOR TOWNS").
_CATEGORY_WEIGHTS = {
    "MAJOR CITIES": 85,
    "MOTORWAYS": 65,
    "MAJOR TOWNS": 65,
    "MAKOR TOWNS": 65,
    "MAIN ROADS": 50,
    "SUBURBS": 50,
}
_DEFAULT_CATEGORY_WEIGHT = 75


def _category_weight(category: str | None) -> int:
    return _CATEGORY_WEIGHTS.get((category or "").strip().upper(), _DEFAULT_CATEGORY_WEIGHT)


_SCOPE_RE = re.compile(r"^(\d{4})H([12])$")


def _scope_sort_key(scope: str):
    """Χρονολογική σειρά ενός Scope ("2019H2" -> 2019*2+1), ίδια λογική με το
    ScopeRank calculated column (§09 του blueprint) — μεγαλύτερο == πιο πρόσφατο.
    None για ό,τι δεν ταιριάζει το naming convention (ορφανά/κενά scopes), ώστε να
    μείνουν εκτός χρονοσειράς αντί να σπάσουν τη σύγκριση με το προηγούμενο scope."""
    m = _SCOPE_RE.match(scope or "")
    if not m:
        return None
    year, half = int(m.group(1)), int(m.group(2))
    return year * 2 + (half - 1)


def _f(value):
    """Decimal/None -> float/None, ώστε το JSON output να έχει καθαρούς αριθμούς αντί
    για SQL Server Decimal literals (π.χ. '100.000000000000')."""
    return None if value is None else float(value)


def _pct(numerator, denominator):
    return None if not denominator else 100.0 * float(numerator or 0) / float(denominator)


# MO_CallSetupTime είναι varchar στο warehouse ('2.548000', και '' για κλήσεις χωρίς setup).
# Σκέτο CAST('' AS float) δίνει 0 στον SQL Server — ~7.300 ψεύτικα μηδενικά στο M→F —
# ενώ το Power Query/DAX το αφήνει κενό. Και σκέτο `MO_CallSetupTime > 0` σκάει με
# "Conversion failed ... to data type int".
_CST_EXPR = "TRY_CAST(NULLIF(LTRIM(RTRIM(MO_CallSetupTime)), '') AS float)"


def _voice_kpis(table: str, collection: str, with_volte: bool):
    """Τα measures των σελίδων «Comparison Voice GSM» (MtoF_voice) και «Comparison Voice
    Free» + «(MOS/CST)» (MtoM_voice), ίδιος ορισμός και στους δύο πίνακες:

      CALL ATTEMPTS        = COUNT(callStatus)
      Success Rate (%)     = COMPLETED / CALL ATTEMPTS
      AFR (%)              = FAILED    / CALL ATTEMPTS
      DCR (%)              = DROPPED   / (COMPLETED + DROPPED)
      Average MOS / CST    = Avg(MOSValue) / Avg(MO_CallSetupTime)   (implicit aggregation)
      P'10_MOS / P'90_CST  = PERCENTILE.INC(…, 0.1 / 0.9) == PERCENTILE_CONT

    UPPER() γιατί το §04 καταγράφει μικτό casing στο callStatus ("COMPLETED"/"failed"/…) —
    το DAX είναι case-insensitive, εδώ το κάνουμε ρητό αντί να βασιστούμε στο collation."""
    names = _fact_names(collection)
    conn = get_connection("BI_VOICE")
    try:
        cur = conn.cursor()
        volte_select = (
            ",\n                SUM(CASE WHEN CustomCallMode = 'VoLTE' THEN 1 ELSE 0 END) AS volte,\n"
            "                COUNT(*) AS total_rows"
            if with_volte
            else ""
        )
        cur.execute(
            f"""
            SELECT
                {_OPERATOR_CASE} AS operator,
                COUNT(callStatus) AS attempts,
                SUM(CASE WHEN UPPER(callStatus) = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN UPPER(callStatus) = 'FAILED' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN UPPER(callStatus) = 'DROPPED' THEN 1 ELSE 0 END) AS dropped,
                AVG(CAST(MOSValue AS float)) AS mos,
                AVG({_CST_EXPR}) AS avg_cst{volte_select}
            FROM {table}
            WHERE CollectionName IN (?, ?)
            GROUP BY {_OPERATOR_CASE}
            """,
            names,
        )
        base = {row.operator: row for row in cur.fetchall() if row.operator != "OTHER"}

        cur.execute(
            f"""
            SELECT DISTINCT
                {_OPERATOR_CASE} AS operator,
                PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY CAST(MOSValue AS float)) OVER (PARTITION BY {_OPERATOR_CASE}) AS p10_mos,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY {_CST_EXPR}) OVER (PARTITION BY {_OPERATOR_CASE}) AS p90_cst
            FROM {table}
            WHERE CollectionName IN (?, ?)
            """,
            names,
        )
        pct = {row.operator: row for row in cur.fetchall()}
    finally:
        conn.close()

    rows = []
    for op, row in sorted(base.items()):
        p = pct.get(op)
        out = {
            "operator": op,
            "attempts": row.attempts,
            "successRate": _pct(row.completed, row.attempts),
            "afr": _pct(row.failed, row.attempts),
            "dcr": _pct(row.dropped, (row.completed or 0) + (row.dropped or 0)),
            "mos": _f(row.mos),
            "p10Mos": _f(p.p10_mos) if p else None,
            "avgCst": _f(row.avg_cst),
            "p90Cst": _f(p.p90_cst) if p else None,
        }
        if with_volte:
            # Όχι measure του report (εκεί το VoLTE βγαίνει από το calculated CallModeA) —
            # εδώ από το CustomCallMode που γράφει ήδη το BI query.
            out["voltePct"] = _pct(row.volte, row.total_rows)
        rows.append(out)
    return rows


@router.get("/api/historic/collections")
def list_historic_collections():
    """CollectionName dimension του warehouse — μικρός, authoritative πίνακας. Πιο πρόσφατα
    πρώτα. Όλα τα ονόματα εδώ έχουν 4 κομμάτια (και τα 2019H2 — βλ. _fact_names)."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT CollectionName
            FROM BI_SCORES_TOTAL
            WHERE CollectionName IS NOT NULL
            ORDER BY CollectionName DESC
        """)
        return {"collections": [row[0] for row in cur.fetchall() if row[0]]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


@router.get("/api/historic/scorecard")
def get_historic_scorecard(collection: str = Query(..., min_length=1)):
    """BI_SCORES_TOTAL (Operator x CollectionName) + BI_BEST_OP_SCORE winner ανά
    category (VOICE/DATA/TOTAL).

    Το Operator εδώ είναι raw ("Cosmote", "Vodafone", "NOVA", "Wind") — κανονικοποιείται με
    τον ίδιο κανόνα με τα fact tables, αλλιώς το frontend (κλειδιά COSMOTE/VODAFONE/NOVA)
    δεν βρίσκει καμία γραμμή και ο πίνακας εξαφανίζεται. AVG γιατί μερικά collections
    (π.χ. MTWS_*_2024H2) έχουν 2 γραμμές για τον ίδιο operator — ίδιο WEIGHT, άρα ο
    σταθμισμένος μέσος του report (Σ WEIGHT×score / Σ WEIGHT) είναι απλός μέσος εδώ.

    Στα default των 8 sliders του GRADES (Voice 40, τα υπόλοιπα 50) το Visuals Total Score
    του report == TOTAL_SCORE: επαληθεύτηκε ότι SCORE_X = SUB_SCORE_X × βασικοί πόντοι και
    TOTAL_SCORE = Σ SCORE_X (διαφορά < 1e-12 σε όλες τις γραμμές)."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        op = _operator_case("Operator")
        cur.execute(
            f"""
            SELECT {op} AS operator,
                   AVG(TOTAL_VOICE) AS TOTAL_VOICE, AVG(TOTAL_DATA) AS TOTAL_DATA, AVG(TOTAL_SCORE) AS TOTAL_SCORE,
                   AVG(VOICE_SCORE_GSM) AS VOICE_SCORE_GSM, AVG(VOICE_SCORE_FREE) AS VOICE_SCORE_FREE,
                   AVG(SCORE_Browsing) AS SCORE_Browsing, AVG(SCORE_HTTP) AS SCORE_HTTP, AVG(SCORE_CAP) AS SCORE_CAP,
                   AVG(SCORE_Ping) AS SCORE_Ping, AVG(SCORE_YT) AS SCORE_YT
            FROM BI_SCORES_TOTAL
            WHERE CollectionName = ?
            GROUP BY {op}
            ORDER BY operator
            """,
            (collection,),
        )
        scores = [
            {
                "operator": row.operator,
                "totalVoice": _f(row.TOTAL_VOICE),
                "totalData": _f(row.TOTAL_DATA),
                "totalScore": _f(row.TOTAL_SCORE),
                "voiceScoreGsm": _f(row.VOICE_SCORE_GSM),
                "voiceScoreFree": _f(row.VOICE_SCORE_FREE),
                "scoreBrowsing": _f(row.SCORE_Browsing),
                "scoreHttp": _f(row.SCORE_HTTP),
                "scoreCap": _f(row.SCORE_CAP),
                "scorePing": _f(row.SCORE_Ping),
                "scoreYt": _f(row.SCORE_YT),
            }
            for row in cur.fetchall()
            if row.operator != "OTHER"
        ]

        # "[COLLECTION NAME]" έχει space — μοναδική εξαίρεση στο warehouse.
        cur.execute(
            """
            SELECT CATEGORY, BEST_OPERATOR, BEST_SCORE
            FROM BI_BEST_OP_SCORE
            WHERE [COLLECTION NAME] = ?
            """,
            (collection,),
        )
        winners = [
            {"category": row.CATEGORY, "operator": _operator_key(row.BEST_OPERATOR), "score": _f(row.BEST_SCORE)}
            for row in cur.fetchall()
        ]

        return {"scores": scores, "winners": winners}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


@router.get("/api/historic/voice")
def get_historic_voice(collection: str = Query(..., min_length=1)):
    """Free voice (Mobile-to-Mobile) — BI_VOICE_MtoM, σελίδες «Comparison Voice Free» +
    «(MOS/CST)». Βλ. _voice_kpis για τους ορισμούς."""
    try:
        return {"rows": _voice_kpis("BI_VOICE_MtoM", collection, with_volte=True)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/historic/voice_gsm")
def get_historic_voice_gsm(collection: str = Query(..., min_length=1)):
    """GSM voice (Mobile-to-Fixed) — BI_VOICE_MtoF, σελίδα «Comparison Voice GSM»
    (Success Rate_MF / AFR_MF / DCR_MF, Avg MOS/CST, P'10_MOS_mtof / P'90_CST_mtof)."""
    try:
        return {"rows": _voice_kpis("BI_VOICE_MtoF", collection, with_volte=False)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/historic/video")
def get_historic_video(collection: str = Query(..., min_length=1)):
    """YouTube — BI_YOUTUBE, σελίδες DATA-VIDEO + «Comparison Data»:
      YT_attempts = COUNT(State) · YT_successRate = State="completed" / YT_attempts ·
      Freezing % = measure "test" = AVERAGE(FreezingTimePerc) · Youtube VMOS = Avg(Vmos).

    ΑΝΕΠΙΒΕΒΑΙΩΤΟ: το Youtube[Vmos] είναι μετονομασία στο Power Query· δεν υπάρχει στήλη Vmos
    στο BI_YOUTUBE. Αντιστοιχίζεται στο TestQualityAvg (το commented-out
    `TestQualityAvg as VMOS` του bi queries/YOUTUBE_newDB.sql, εύρος 1–4.8)."""
    conn = None
    try:
        conn = get_connection("BI_DATA")
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
                {_OPERATOR_CASE} AS operator,
                COUNT(State) AS attempts,
                SUM(CASE WHEN LOWER(State) = 'completed' THEN 1 ELSE 0 END) AS successes,
                -- FreezingTimePerc είναι κλάσμα 0–1 (max 0.995) — ×100 για ποσοστό.
                100.0 * AVG(CAST(FreezingTimePerc AS float)) AS freezing_pct,
                AVG(CAST(TestQualityAvg AS float)) AS avg_vmos
            FROM BI_YOUTUBE
            WHERE CollectionName IN (?, ?)
            GROUP BY {_OPERATOR_CASE}
            """,
            _fact_names(collection),
        )
        rows = [
            {
                "operator": row.operator,
                "attempts": row.attempts,
                "successRate": _pct(row.successes, row.attempts),
                "freezingPct": _f(row.freezing_pct),
                "avgVmos": _f(row.avg_vmos),
            }
            for row in cur.fetchall()
            if row.operator != "OTHER"
        ]
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


@router.get("/api/historic/data")
def get_historic_data(collection: str = Query(..., min_length=1)):
    """Capacity + Ping, όπως η σελίδα «Comparison Data»:
      Avg Capacity DL/UL Thrp = Avg(AvgThrpDL/UL) με visual filter TaskStatus = 'Success'
        (kbps στο report — /1000 εδώ για Mbps· AvgThrpDL γεμάτο μόνο σε Capacity DL tests).
      CapacitySuccessRate = TaskStatus = 'Success' / COUNT(TaskStatus).
      Weighted Average RTT = Σ(AvgRTT × SuccessTests) / Σ(SuccessTests) — βάρος τα ΕΠΙΤΥΧΗ
        pings, όχι τα TotalPingAttempts (το AvgRTT ενός test υπολογίζεται μόνο από αυτά)."""
    conn = None
    try:
        names = _fact_names(collection)
        conn = get_connection("BI_DATA")
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
                {_OPERATOR_CASE} AS operator,
                AVG(CASE WHEN TaskStatus = 'Success' THEN CAST(AvgThrpDL AS float) END) / 1000.0 AS avg_thrp_dl_mbps,
                AVG(CASE WHEN TaskStatus = 'Success' THEN CAST(AvgThrpUL AS float) END) / 1000.0 AS avg_thrp_ul_mbps,
                SUM(CASE WHEN TaskStatus = 'Success' THEN 1 ELSE 0 END) AS successes,
                COUNT(TaskStatus) AS total_tests
            FROM BI_Capacity
            WHERE CollectionName IN (?, ?)
            GROUP BY {_OPERATOR_CASE}
            """,
            names,
        )
        capacity_rows = {
            row.operator: row
            for row in cur.fetchall()
            if row.operator != "OTHER"
        }

        cur.execute(
            f"""
            SELECT
                {_OPERATOR_CASE} AS operator,
                SUM(TotalPingAttempts) AS total_ping_attempts,
                SUM(SuccessTests) AS success_ping_tests,
                SUM(AvgRTT * SuccessTests) / NULLIF(SUM(SuccessTests), 0) AS avg_rtt_ms
            FROM BI_PING_NEW
            WHERE CollectionName IN (?, ?)
            GROUP BY {_OPERATOR_CASE}
            """,
            names,
        )
        ping_rows = {
            row.operator: row
            for row in cur.fetchall()
            if row.operator != "OTHER"
        }

        operators = sorted(set(capacity_rows) | set(ping_rows))
        rows = []
        for op in operators:
            cap = capacity_rows.get(op)
            ping = ping_rows.get(op)
            rows.append(
                {
                    "operator": op,
                    "avgThrpDlMbps": _f(cap.avg_thrp_dl_mbps) if cap else None,
                    "avgThrpUlMbps": _f(cap.avg_thrp_ul_mbps) if cap else None,
                    "taskSuccessRate": _pct(cap.successes, cap.total_tests) if cap else None,
                    "totalTests": cap.total_tests if cap else None,
                    "avgRttMs": _f(ping.avg_rtt_ms) if ping else None,
                    "totalPingAttempts": ping.total_ping_attempts if ping else None,
                    "successPingTests": ping.success_ping_tests if ping else None,
                }
            )
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


@router.get("/api/historic/trend")
def get_historic_trend():
    """Χρονοσειρά ΟΛΩΝ των campaigns, μία γραμμή ανά Scope — τα line charts των σελίδων
    «Comparison …» (X = Scope, series = operator, κανένα default slicer selection) +
    coverage counts και Δ vs προηγούμενο scope του §09.

    Το SQL αθροίζει ανά (CollectionName, operator) και η Python κάνει το roll-up σε Scope,
    γιατί το Scope/Category βγαίνει από το Power Query split (_split_collection) — με το
    PARSENAME χανόταν όλο το 2019H2 (3-part ονόματα) και όσα collections έχουν τελεία.

    Pooled aggregates πάνω σε ΟΛΑ τα collections ενός scope (όπως φιλτράρει ο άξονας Scope
    στο DAX), όχι μέσος όρος ανά-collection μέσων όρων. Δ values συγκρίνουν με το
    προηγούμενο scope που έχει ΟΝΤΩΣ τιμή για το συγκεκριμένο operator+metric — π.χ. το
    2023H1 με το 2022H1, γιατί δεν έγινε καμπάνια το 2022H2."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()

        collections_by_scope: dict[str, set] = {}
        # Visuals Total Score ανά scope = Σ(WEIGHT × TOTAL_SCORE) / Σ(WEIGHT) (§05, στα default
        # sliders — βλ. get_historic_scorecard). Ένα απλό AVG θα έδινε σε μια MAIN ROADS
        # διαδρομή (weight 50) το ίδιο βάρος με μια MAJOR CITIES (weight 85).
        score_acc: dict[tuple, list] = {}
        op = _operator_case("Operator")
        cur.execute(
            f"""
            SELECT CollectionName, {op} AS operator,
                   SUM(CAST(TOTAL_SCORE AS float)) AS score_sum, COUNT(TOTAL_SCORE) AS score_n
            FROM BI_SCORES_TOTAL
            WHERE CollectionName IS NOT NULL
            GROUP BY CollectionName, {op}
            """
        )
        for row in cur.fetchall():
            _, _, category, scope = _split_collection(row.CollectionName)
            collections_by_scope.setdefault(scope, set()).add(row.CollectionName)
            if row.operator == "OTHER" or not row.score_n:
                continue
            w = _category_weight(category)
            acc = score_acc.setdefault((scope, row.operator), [0.0, 0.0])
            acc[0] += w * row.score_sum
            acc[1] += w * row.score_n

        # Success Rate (%) του «Comparison Voice Free» = COMPLETED / COUNT(callStatus).
        voice_collections_by_scope: dict[str, set] = {}
        sr_acc: dict[tuple, list] = {}
        cur.execute(
            f"""
            SELECT CollectionName, {_OPERATOR_CASE} AS operator,
                   COUNT(callStatus) AS attempts,
                   SUM(CASE WHEN UPPER(callStatus) = 'COMPLETED' THEN 1 ELSE 0 END) AS completed
            FROM BI_VOICE_MtoM
            WHERE CollectionName IS NOT NULL
            GROUP BY CollectionName, {_OPERATOR_CASE}
            """
        )
        for row in cur.fetchall():
            scope = _split_collection(row.CollectionName)[3]
            voice_collections_by_scope.setdefault(scope, set()).add(row.CollectionName)
            if row.operator == "OTHER":
                continue
            acc = sr_acc.setdefault((scope, row.operator), [0, 0])
            acc[0] += row.completed or 0
            acc[1] += row.attempts or 0

        conn.close()
        conn = get_connection("BI_DATA")
        cur = conn.cursor()

        # «Avg Capacity DL Thrp» = Avg(AvgThrpDL) με visual filter TaskStatus = 'Success'.
        capacity_collections_by_scope: dict[str, set] = {}
        thrp_acc: dict[tuple, list] = {}
        cur.execute(
            f"""
            SELECT CollectionName, {_OPERATOR_CASE} AS operator,
                   SUM(CASE WHEN TaskStatus = 'Success' THEN CAST(AvgThrpDL AS float) END) AS dl_sum,
                   COUNT(CASE WHEN TaskStatus = 'Success' THEN AvgThrpDL END) AS dl_n
            FROM BI_Capacity
            WHERE CollectionName IS NOT NULL
            GROUP BY CollectionName, {_OPERATOR_CASE}
            """
        )
        for row in cur.fetchall():
            scope = _split_collection(row.CollectionName)[3]
            capacity_collections_by_scope.setdefault(scope, set()).add(row.CollectionName)
            if row.operator == "OTHER" or not row.dl_n:
                continue
            acc = thrp_acc.setdefault((scope, row.operator), [0.0, 0])
            acc[0] += row.dl_sum
            acc[1] += row.dl_n

        def _ratio(acc, key, scale=1.0):
            pair = acc.get(key)
            return None if not pair or not pair[1] else scale * pair[0] / pair[1]

        all_scopes = set(collections_by_scope) | set(voice_collections_by_scope) | set(capacity_collections_by_scope)
        all_operators = sorted({o for (_, o) in score_acc} | {o for (_, o) in sr_acc} | {o for (_, o) in thrp_acc})

        # Χρονολογική σειρά (§09 ScopeRank idiom) — ό,τι δεν ταιριάζει το "YYYYHn"
        # naming (ορφανά/κενά) πάει στο τέλος, χωρίς Δ ποτέ.
        ordered_scopes = sorted(all_scopes, key=lambda s: (_scope_sort_key(s) is None, _scope_sort_key(s) or 0, s or ""))

        # Τελευταία γνωστή τιμή ανά (operator, metric) καθώς προχωράμε χρονολογικά,
        # για το Δ vs προηγούμενο ΔΙΑΘΕΣΙΜΟ scope.
        last_seen = {}

        def _with_delta(op, metric, value):
            key = (op, metric)
            prev = last_seen.get(key)
            delta = None if value is None or prev is None else round(value - prev, 4)
            if value is not None:
                last_seen[key] = value
            return delta

        scopes_out = []
        for scope in ordered_scopes:
            is_chronological = _scope_sort_key(scope) is not None
            operators_out = []
            for op in all_operators:
                total_score = _ratio(score_acc, (scope, op))
                success_rate = _ratio(sr_acc, (scope, op), 100.0)
                thrp_dl = _ratio(thrp_acc, (scope, op), 1 / 1000.0)
                operators_out.append(
                    {
                        "operator": op,
                        "totalScore": total_score,
                        "successRate": success_rate,
                        "avgThrpDlMbps": thrp_dl,
                        # Δ μόνο για scopes με αναγνωρίσιμη θέση στη χρονοσειρά —
                        # τα ορφανά δεν έχουν νόημα "πριν/μετά".
                        "deltaTotalScore": _with_delta(op, "totalScore", total_score) if is_chronological else None,
                        "deltaSuccessRate": _with_delta(op, "successRate", success_rate) if is_chronological else None,
                        "deltaAvgThrpDlMbps": _with_delta(op, "avgThrpDlMbps", thrp_dl) if is_chronological else None,
                    }
                )
            scopes_out.append(
                {
                    "scope": scope or "",
                    "collections": len(collections_by_scope.get(scope, ())) or None,
                    "voiceCollections": len(voice_collections_by_scope.get(scope, ())) or None,
                    "capacityCollections": len(capacity_collections_by_scope.get(scope, ())) or None,
                    "operators": operators_out,
                }
            )

        return {"scopes": scopes_out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()
