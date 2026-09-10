"""Σελίδα Historic: read-only KPI snapshot από το BI data warehouse (BI_VOICE/BI_DATA),
ΕΝΑ campaign (CollectionName) τη φορά — βλ. src/components/BI_DW_SYSTEM_PROMPT.md.

Ρητά ξεχωριστό από τα routers/* του "live" swissqual-srvsa dataset (calls.py,
data_calls.py, filters.py, ...):
  - άλλο connection target — πάντα BI_VOICE / BI_DATA (όχι το `database` dropdown που
    διαλέγει ο χρήστης στα άλλα tabs),
  - άλλο σχήμα — star-schema warehouse με CollectionName ως μοναδικό dimension key,
    semi-annual campaigns από το 2019 μέχρι σήμερα (βλ. §2.1 του system prompt),
  - portable, ανά-operator KPIs (βλ. §6 του system prompt) αντί για raw per-session rows.

Το frontend (HistoricTab.tsx) διαλέγει ΕΝΑ collection από το /api/historic/collections
και ζωγραφίζει 3 πίνακες με τα δεδομένα των 3 endpoints παρακάτω — ίδιο look με το
SummaryTab (operator columns), πολύ πιο λεπτό dataset.

Το /api/historic/trend (βλ. παρακάτω) είναι το δεύτερο, χρονοσειριακό κομμάτι της
σελίδας — μία γραμμή ανά Scope αντί ανά CollectionName, με coverage counts και Δ vs
προηγούμενο ΔΙΑΘΕΣΙΜΟ scope ανά operator. Ίδιο πνεύμα με το «Δ vs προηγούμενο scope» +
«Ποιότητα δεδομένων» φάκελο measures που προστέθηκαν στο μοντέλο στις 5 Σεπ 2026
(βλ. §09 του blueprint) — εδώ υπολογισμένο σε SQL/Python αντί για DAX, γιατί το
warehouse δεν έχει το ScopeRank calculated column.
"""
import re

from fastapi import APIRouter, HTTPException, Query

from db import get_connection

router = APIRouter(tags=["historic"])

# Operator normalization — ίδιο idiom με §2.2 / §6.4 του system prompt. 'Wind' μπαίνει
# σκόπιμα στο NOVA (merged historical alias, βλ. §2.2) ώστε τα legacy campaigns να
# συγκρίνονται σωστά με τα σημερινά.
_OPERATOR_CASE = """
    CASE
        WHEN HomeOperator LIKE 'Cosmote%'  THEN 'COSMOTE'
        WHEN HomeOperator LIKE 'Vodafone%' THEN 'VODAFONE'
        WHEN HomeOperator IN ('NOVA', 'Nova', 'Wind') THEN 'NOVA'
        ELSE 'OTHER'
    END
"""

# Scope = τελευταίο κομμάτι του CollectionName (π.χ. "…_2026H2" -> "2026H2") — ίδιο
# PARSENAME split με το §2 του blueprint (Πηγές & ETL) και με splitCollectionName
# στο HistoricTab.tsx. Ξαναγράφεται αυτούσιο σε κάθε GROUP BY γιατί το T-SQL δεν
# επιτρέπει alias εκεί (ίδιο idiom με το _OPERATOR_CASE παραπάνω).
_SCOPE_EXPR = "PARSENAME(REPLACE(CollectionName,'_','.'),1)"

# CATEGORY = προτελευταίο κομμάτι (π.χ. "…_MAJOR CITIES_2026H2" -> "MAJOR CITIES").
_CATEGORY_EXPR = "PARSENAME(REPLACE(CollectionName,'_','.'),2)"

# Το WEIGHT ανά κατηγορία περιοχής, custom column στο Power Query (§05 του blueprint) — ο
# σταθμισμένος μέσος όρος του Visuals Total Score ΠΑΝΤΑ περνάει από αυτό όταν συνδυάζεις
# περισσότερα από ένα collection (π.χ. όλα τα collections ενός Scope, βλ. get_historic_trend).
# ΧΩΡΙΣ αυτό ένα απλό AVG(TOTAL_SCORE) πάνω σε πολλά collections δίνει λάθος νούμερο — ίδιο λάθος
# με το να αγνοείς τελείως τη στάθμιση της σελίδας GRADES. UPPER/LTRIM/RTRIM γιατί η πηγή έχει
# τουλάχιστον ένα typo + leading space καταγεγραμμένο στο §08 (" MAJOR TOWNS", "MAKOR TOWNS").
_WEIGHT_CASE = f"""
    CASE UPPER(LTRIM(RTRIM({_CATEGORY_EXPR})))
        WHEN 'MAJOR CITIES' THEN 85
        WHEN 'MOTORWAYS'    THEN 65
        WHEN 'MAJOR TOWNS'  THEN 65
        WHEN 'MAKOR TOWNS'  THEN 65
        WHEN 'MAIN ROADS'   THEN 50
        WHEN 'SUBURBS'      THEN 50
        ELSE 75
    END
"""

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


@router.get("/api/historic/collections")
def list_historic_collections():
    """CollectionName dimension του warehouse — μικρός, authoritative πίνακας (βλ. §7
    του system prompt: "μικρό και authoritative, cache το σκληρά"). Πιο πρόσφατα πρώτα."""
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
    category (VOICE/DATA/TOTAL) — το ελαφρύτερο, ήδη-υπολογισμένο scorecard (§3.1)."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        cur.execute(
            """
            SELECT Operator, TOTAL_VOICE, TOTAL_DATA, TOTAL_SCORE,
                   VOICE_SCORE_GSM, VOICE_SCORE_FREE,
                   SCORE_Browsing, SCORE_HTTP, SCORE_CAP, SCORE_Ping, SCORE_YT
            FROM BI_SCORES_TOTAL
            WHERE CollectionName = ?
            ORDER BY Operator
            """,
            (collection,),
        )
        scores = [
            {
                "operator": row.Operator,
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
        ]

        # "[COLLECTION NAME]" έχει space — μοναδική εξαίρεση στο warehouse, βλ. §5.10.
        cur.execute(
            """
            SELECT CATEGORY, BEST_OPERATOR, BEST_SCORE
            FROM BI_BEST_OP_SCORE
            WHERE [COLLECTION NAME] = ?
            """,
            (collection,),
        )
        winners = [
            {"category": row.CATEGORY, "operator": row.BEST_OPERATOR, "score": _f(row.BEST_SCORE)}
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
    """Portable voice KPIs (§6.1 — χτισμένα πάνω σε callStatus, το μόνο outcome column
    που είναι γεμάτο σε ΚΑΘΕ περίοδο, βλ. §5.5) από BI_VOICE_MtoM, ανά operator."""
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
                {_OPERATOR_CASE} AS operator,
                COUNT(*) AS attempts,
                100.0 * SUM(CASE WHEN callStatus = 'Completed' OR callStatus LIKE 'Dro%' THEN 1 ELSE 0 END)
                      / NULLIF(SUM(CASE WHEN callStatus IN ('Completed', 'Failed') OR callStatus LIKE 'Dro%' THEN 1 ELSE 0 END), 0) AS cssr,
                100.0 * SUM(CASE WHEN callStatus LIKE 'Dro%' THEN 1 ELSE 0 END)
                      / NULLIF(SUM(CASE WHEN callStatus = 'Completed' OR callStatus LIKE 'Dro%' THEN 1 ELSE 0 END), 0) AS dcr,
                100.0 * SUM(CASE WHEN callStatus = 'Completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS completion_rate,
                AVG(CASE WHEN MOSValue > 0 THEN CAST(MOSValue AS float) END) AS mos,
                100.0 * SUM(CASE WHEN CustomCallMode = 'VoLTE' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS volte_pct
            FROM BI_VOICE_MtoM
            WHERE CollectionName = ?
            GROUP BY {_OPERATOR_CASE}
            """,
            (collection,),
        )
        rows = [
            {
                "operator": row.operator,
                "attempts": row.attempts,
                "cssr": _f(row.cssr),
                "dcr": _f(row.dcr),
                "completionRate": _f(row.completion_rate),
                "mos": _f(row.mos),
                "voltePct": _f(row.volte_pct),
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


@router.get("/api/historic/voice_gsm")
def get_historic_voice_gsm(collection: str = Query(..., min_length=1)):
    """GSM voice KPIs (Mobile-to-Fixed, §04 "Voice — Mobile to Fixed" του blueprint) από
    BI_VOICE_MtoF, ανά operator — ίδιο σχήμα με το FREE (BI_VOICE_MtoM) του
    /api/historic/voice, ΜΙΑ διαφορά: το §04 προειδοποιεί ρητά ότι το callStatus εδώ
    έχει ασυνεπές casing στην πηγή ("COMPLETED" ΚΑΙ "Completed" ΚΑΙ πεζά "failed"/
    "dropped") — DAX είναι case-insensitive by default, το SQL Server (ανάλογα με το
    collation) όχι πάντα, οπότε το UPPER() εδώ το κάνει ρητό αντί να βασιστούμε σε
    collation defaults που δεν μπορούμε να επαληθεύσουμε.

    Δεν υπάρχει VoLTE% εδώ (αυτό είναι χαρακτηριστικό του FREE/M→M axis) — αντί γι'
    αυτό avgCallSetupTime (MO_CallSetupTime), το μέγεθος που το ίδιο το report
    δείχνει ως P'90_CST_mtof. Μονάδα όπως είναι αποθηκευμένη στη βάση — δεν
    επαληθεύτηκε αν είναι δευτερόλεπτα ή ms, γι' αυτό το frontend δεν το labelάρει.
    """
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
                {_OPERATOR_CASE} AS operator,
                COUNT(*) AS attempts,
                100.0 * SUM(CASE WHEN UPPER(callStatus) IN ('COMPLETED', 'DROPPED') THEN 1 ELSE 0 END)
                      / NULLIF(SUM(CASE WHEN UPPER(callStatus) IN ('COMPLETED', 'DROPPED', 'FAILED') THEN 1 ELSE 0 END), 0) AS cssr,
                100.0 * SUM(CASE WHEN UPPER(callStatus) = 'DROPPED' THEN 1 ELSE 0 END)
                      / NULLIF(SUM(CASE WHEN UPPER(callStatus) IN ('COMPLETED', 'DROPPED') THEN 1 ELSE 0 END), 0) AS dcr,
                100.0 * SUM(CASE WHEN UPPER(callStatus) = 'COMPLETED' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS completion_rate,
                AVG(CASE WHEN MOSValue > 0 THEN CAST(MOSValue AS float) END) AS mos,
                AVG(CASE WHEN MO_CallSetupTime > 0 THEN CAST(MO_CallSetupTime AS float) END) AS avg_cst
            FROM BI_VOICE_MtoF
            WHERE CollectionName = ?
            GROUP BY {_OPERATOR_CASE}
            """,
            (collection,),
        )
        rows = [
            {
                "operator": row.operator,
                "attempts": row.attempts,
                "cssr": _f(row.cssr),
                "dcr": _f(row.dcr),
                "completionRate": _f(row.completion_rate),
                "mos": _f(row.mos),
                "avgCallSetupTime": _f(row.avg_cst),
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


@router.get("/api/historic/video")
def get_historic_video(collection: str = Query(..., min_length=1)):
    """YouTube/video KPIs (§04 "Data — Latency, DNS, video, interactivity" + σελίδα
    DATA-VIDEO, §06) από BI_YOUTUBE, ανά operator. `freezingPct` είναι το measure που
    στο πραγματικό μοντέλο κρύβεται πίσω από το δοκιμαστικό όνομα "test" (βλ. §04/§09
    — AVERAGE(Youtube[FreezingTimePerc])) — το ίδιο measure που είχε το σπασμένο
    "Delta Freezing%" πριν διορθωθεί στις 5 Σεπ 2026."""
    conn = None
    try:
        conn = get_connection("BI_DATA")
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
                {_OPERATOR_CASE} AS operator,
                COUNT(State) AS attempts,
                100.0 * SUM(CASE WHEN LOWER(State) = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(State), 0) AS success_rate,
                AVG(CASE WHEN FreezingTimePerc >= 0 THEN CAST(FreezingTimePerc AS float) END) AS freezing_pct,
                AVG(CASE WHEN Vmos > 0 THEN CAST(Vmos AS float) END) AS avg_vmos
            FROM BI_YOUTUBE
            WHERE CollectionName = ?
            GROUP BY {_OPERATOR_CASE}
            """,
            (collection,),
        )
        rows = [
            {
                "operator": row.operator,
                "attempts": row.attempts,
                "successRate": _f(row.success_rate),
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
    """Canonical data KPIs (§6.3): throughput DL/UL από BI_Capacity (AvgThrpDL/UL είναι
    σε Kbps — /1000 για Mbps), latency από BI_PING_NEW (ήδη pre-aggregated ανά operator,
    weighted average στο AvgRTT με βάρος TotalPingAttempts όταν υπάρχουν πάνω από 1
    γραμμές ανά operator, π.χ. split [1.LTE-5GNR]/[2.LTE])."""
    conn = None
    try:
        conn = get_connection("BI_DATA")
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
                {_OPERATOR_CASE} AS operator,
                AVG(CASE WHEN TestName = 'Capacity DL' AND TaskStatus = 'Success' THEN AvgThrpDL END) / 1000.0 AS avg_thrp_dl_mbps,
                AVG(CASE WHEN TestName = 'Capacity UL' AND TaskStatus = 'Success' THEN AvgThrpUL END) / 1000.0 AS avg_thrp_ul_mbps,
                100.0 * SUM(CASE WHEN TaskStatus = 'Success' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS task_success_rate,
                COUNT(*) AS total_tests
            FROM BI_Capacity
            WHERE CollectionName = ?
            GROUP BY {_OPERATOR_CASE}
            """,
            (collection,),
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
                SUM(AvgRTT * TotalPingAttempts) / NULLIF(SUM(TotalPingAttempts), 0) AS avg_rtt_ms
            FROM BI_PING_NEW
            WHERE CollectionName = ?
            GROUP BY {_OPERATOR_CASE}
            """,
            (collection,),
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
                    "taskSuccessRate": _f(cap.task_success_rate) if cap else None,
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
    """Χρονοσειρά ΟΛΩΝ των campaigns, μία γραμμή ανά Scope (π.χ. "2026H2") αντί ανά
    CollectionName — ο πίνακας "Ποιότητα δεδομένων" + "Δ vs προηγούμενο scope" του §09
    του blueprint, φτιαγμένος σε SQL/Python. Pooled aggregates πάνω σε ΟΛΑ τα
    collections ενός scope (ίδια λογική με το πώς θα φιλτράριζε ένα DAX CALCULATE στο
    scope axis) — όχι μέσος όρος ανά-collection μέσων όρων.

    Coverage counts (collections/voiceCollections/capacityCollections) είναι το SQL
    ισοδύναμο των "Coll w/ Voice M2M / Capacity" measures. Δ values συγκρίνουν με το
    προηγούμενο scope που έχει ΟΝΤΩΣ τιμή για το συγκεκριμένο operator+metric — π.χ.
    το 2023H1 συγκρίνεται με το 2022H1 γιατί δεν έγινε καμπάνια το 2022H2 (βλ.
    ScopeRank στο §09) — δεν χρειάζεται το κενό ScopeRank στο SQL, απλά προσπερνιέται
    στο χρονολογικό sort.
    """
    conn = None
    try:
        conn = get_connection("BI_VOICE")
        cur = conn.cursor()

        cur.execute(
            f"""
            SELECT {_SCOPE_EXPR} AS scope, COUNT(DISTINCT CollectionName) AS collections
            FROM BI_SCORES_TOTAL
            WHERE CollectionName IS NOT NULL
            GROUP BY {_SCOPE_EXPR}
            """
        )
        # (row.scope or "") — PARSENAME επιστρέφει NULL όταν το CollectionName δεν έχει τα 4
        # αναμενόμενα κομμάτια (βλ. τα 34 ορφανά κλειδιά του §08)· χωρίς αυτό ένα None ανακατεύεται
        # με strings μέσα στο all_scopes set παρακάτω και σκάει το sorted() (None < str TypeError).
        collections_by_scope = {(row.scope or ""): row.collections for row in cur.fetchall()}

        # Σταθμισμένος μέσος όρος ανά κατηγορία περιοχής — Σ(WEIGHT × TOTAL_SCORE) / Σ(WEIGHT),
        # ίδιος τύπος με το τελευταίο βήμα της αλυσίδας βαθμολόγησης (§05, "Τελικό σκορ"). Ένα
        # απλό AVG() εδώ θα έδινε σε μια MAIN ROADS διαδρομή (weight 50) το ίδιο βάρος με μια
        # MAJOR CITIES (weight 85), κάτι που το ίδιο το report δεν κάνει πουθενά.
        cur.execute(
            f"""
            SELECT
                {_SCOPE_EXPR} AS scope,
                Operator AS operator,
                SUM(CAST(TOTAL_SCORE AS float) * {_WEIGHT_CASE}) / NULLIF(SUM(CAST({_WEIGHT_CASE} AS float)), 0) AS avg_total_score
            FROM BI_SCORES_TOTAL
            WHERE CollectionName IS NOT NULL AND Operator IS NOT NULL AND TOTAL_SCORE IS NOT NULL
            GROUP BY {_SCOPE_EXPR}, Operator
            """
        )
        scores_by_scope_op = {(row.scope or "", row.operator): _f(row.avg_total_score) for row in cur.fetchall()}

        cur.execute(
            f"""
            SELECT {_SCOPE_EXPR} AS scope, COUNT(DISTINCT CollectionName) AS voice_collections
            FROM BI_VOICE_MtoM
            WHERE CollectionName IS NOT NULL
            GROUP BY {_SCOPE_EXPR}
            """
        )
        voice_collections_by_scope = {(row.scope or ""): row.voice_collections for row in cur.fetchall()}

        cur.execute(
            f"""
            SELECT
                {_SCOPE_EXPR} AS scope,
                {_OPERATOR_CASE} AS operator,
                100.0 * SUM(CASE WHEN callStatus = 'Completed' OR callStatus LIKE 'Dro%' THEN 1 ELSE 0 END)
                      / NULLIF(SUM(CASE WHEN callStatus IN ('Completed', 'Failed') OR callStatus LIKE 'Dro%' THEN 1 ELSE 0 END), 0) AS cssr
            FROM BI_VOICE_MtoM
            WHERE CollectionName IS NOT NULL
            GROUP BY {_SCOPE_EXPR}, {_OPERATOR_CASE}
            """
        )
        cssr_by_scope_op = {
            (row.scope or "", row.operator): _f(row.cssr) for row in cur.fetchall() if row.operator != "OTHER"
        }

        conn.close()
        conn = get_connection("BI_DATA")
        cur = conn.cursor()

        cur.execute(
            f"""
            SELECT {_SCOPE_EXPR} AS scope, COUNT(DISTINCT CollectionName) AS capacity_collections
            FROM BI_Capacity
            WHERE CollectionName IS NOT NULL
            GROUP BY {_SCOPE_EXPR}
            """
        )
        capacity_collections_by_scope = {(row.scope or ""): row.capacity_collections for row in cur.fetchall()}

        cur.execute(
            f"""
            SELECT
                {_SCOPE_EXPR} AS scope,
                {_OPERATOR_CASE} AS operator,
                AVG(CASE WHEN TestName = 'Capacity DL' AND TaskStatus = 'Success' THEN AvgThrpDL END) / 1000.0 AS avg_thrp_dl_mbps
            FROM BI_Capacity
            WHERE CollectionName IS NOT NULL
            GROUP BY {_SCOPE_EXPR}, {_OPERATOR_CASE}
            """
        )
        thrp_by_scope_op = {
            (row.scope or "", row.operator): _f(row.avg_thrp_dl_mbps) for row in cur.fetchall() if row.operator != "OTHER"
        }

        all_scopes = set(collections_by_scope) | set(voice_collections_by_scope) | set(capacity_collections_by_scope)
        all_operators = sorted({op for (_, op) in scores_by_scope_op} | {op for (_, op) in cssr_by_scope_op} | {op for (_, op) in thrp_by_scope_op})

        # Χρονολογική σειρά (§09 ScopeRank idiom) — ό,τι δεν ταιριάζει το "YYYYHn"
        # naming (ορφανά/κενά) πάει στο τέλος, χωρίς Δ ποτέ.
        ordered_scopes = sorted(all_scopes, key=lambda s: (_scope_sort_key(s) is None, _scope_sort_key(s) or 0, s))

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
                total_score = scores_by_scope_op.get((scope, op))
                cssr = cssr_by_scope_op.get((scope, op))
                thrp_dl = thrp_by_scope_op.get((scope, op))
                operators_out.append(
                    {
                        "operator": op,
                        "totalScore": total_score,
                        "cssr": cssr,
                        "avgThrpDlMbps": thrp_dl,
                        # Δ μόνο για scopes με αναγνωρίσιμη θέση στη χρονοσειρά —
                        # τα ορφανά δεν έχουν νόημα "πριν/μετά".
                        "deltaTotalScore": _with_delta(op, "totalScore", total_score) if is_chronological else None,
                        "deltaCssr": _with_delta(op, "cssr", cssr) if is_chronological else None,
                        "deltaAvgThrpDlMbps": _with_delta(op, "avgThrpDlMbps", thrp_dl) if is_chronological else None,
                    }
                )
            scopes_out.append(
                {
                    "scope": scope,
                    "collections": collections_by_scope.get(scope),
                    "voiceCollections": voice_collections_by_scope.get(scope),
                    "capacityCollections": capacity_collections_by_scope.get(scope),
                    "operators": operators_out,
                }
            )

        return {"scopes": scopes_out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()
