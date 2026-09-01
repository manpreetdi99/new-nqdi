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
"""
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
