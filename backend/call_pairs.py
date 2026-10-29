"""Κοινά helpers για τα native endpoints του Call Detail (routers/call_detail_native.py):

  _call_pair               -> επίλυση ζεύγους A/B με τον native τρόπο του SmartAnalytics Scene
  parse_capability_fields  -> ανάλυση του pipe-delimited UECapabilityInformation.Fields
"""


# Native τρόπος: FactCallSession.SessionIdASide/SessionIdBSide (+ DwSession για file/χρόνους).
# Δέχεται είτε το A είτε το B session. Στη DOD_26H2: 3.027 κλήσεις, όλες με A και B.
_PAIR_NATIVE_SQL = """
    DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);
    SELECT TOP (1)
        f.SessionIdASide AS ASessionId,
        f.SessionIdBSide AS BSessionId,
        f.FactId         AS CallFactId,
        sa.FileId AS AFileId, sa.StartTime AS AStart, sa.EndTime AS AEnd,
        sb.FileId AS BFileId, sb.StartTime AS BStart, sb.EndTime AS BEnd,
        CASE WHEN f.SessionIdASide = @sid THEN 'A' ELSE 'B' END AS RequestedSide
    FROM FactCallSession f
    LEFT JOIN DwSession sa ON sa.SessionId = f.SessionIdASide
    LEFT JOIN DwSession sb ON sb.SessionId = f.SessionIdBSide
    WHERE f.SessionIdASide = @sid OR f.SessionIdBSide = @sid;
"""

# Fallback: ο υπάρχων τρόπος του routers/call_detail.py (pair_root μέσω CallAnalysis).
_PAIR_CALLANALYSIS_SQL = """
    DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);

    ;WITH pair_root AS (
        SELECT TOP (1)
            CASE
                WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                ELSE CA.SessionId
            END AS ASessionId
        FROM CallAnalysis CA
        WHERE CA.SessionId = @sid OR CA.SessionIdA = @sid
        ORDER BY CASE WHEN CA.SessionId = @sid THEN 0 ELSE 1 END
    ),
    pair AS (
        SELECT PR.ASessionId,
               (SELECT TOP (1) CA.SessionId
                  FROM CallAnalysis CA
                 WHERE CA.SessionIdA = PR.ASessionId AND CA.Side = 'B') AS BSessionId
        FROM pair_root PR
    )
    SELECT
        P.ASessionId,
        P.BSessionId,
        CAST(NULL AS BIGINT) AS CallFactId,
        sa.FileId AS AFileId, sa.StartTime AS AStart, sa.EndTime AS AEnd,
        sb.FileId AS BFileId, sb.StartTime AS BStart, sb.EndTime AS BEnd,
        CASE WHEN P.ASessionId = @sid THEN 'A' ELSE 'B' END AS RequestedSide
    FROM pair P
    LEFT JOIN DwSession sa ON sa.SessionId = P.ASessionId
    LEFT JOIN DwSession sb ON sb.SessionId = P.BSessionId;
"""


def _fetch_one(cursor):
    row = cursor.fetchone()
    if not row:
        return None
    cols = [c[0] for c in cursor.description]
    return {cols[i]: row[i] for i in range(len(cols))}


def _call_pair(cursor, session_id):
    """Ζεύγος A/B μιας κλήσης, από A ή B session. Επιστρέφει dict με τις στήλες του
    _PAIR_NATIVE_SQL + "pairSource" ('FactCallSession' | 'CallAnalysis'), ή None αν το
    session δεν είναι κλήση σε καμία από τις δύο πηγές."""
    cursor.execute(_PAIR_NATIVE_SQL, (session_id,))
    pair = _fetch_one(cursor)
    if pair:
        pair["pairSource"] = "FactCallSession"
        return pair

    cursor.execute(_PAIR_CALLANALYSIS_SQL, (session_id,))
    pair = _fetch_one(cursor)
    if pair:
        pair["pairSource"] = "CallAnalysis"
        return pair
    return None


def pair_sides(pair):
    """{SessionId: 'A'|'B'} για όσες πλευρές υπάρχουν. Αν A == B (κλήση χωρίς B) μένει το A."""
    if not pair:
        return {}
    sides = {}
    if pair.get("BSessionId") is not None:
        sides[pair["BSessionId"]] = "B"
    if pair.get("ASessionId") is not None:
        sides[pair["ASessionId"]] = "A"
    return sides


def _split_value(value):
    """Τιμές με '; ' γίνονται λίστα (π.χ. 'EUTRA Bands=1; 3; 7'), αλλιώς μένουν string."""
    if "; " in value:
        return [v.strip() for v in value.split("; ") if v.strip()]
    return value


def parse_capability_fields(text):
    """UECapabilityInformation.Fields -> [{"key", "values", "raw"}].

    Format: pipe-delimited `key=value`, π.χ.
        'Rat type=eutra|Category=rel1450(DL): 20| =rel1430(UL): 18|EUTRA Bands=1; 3; 7'

    - split σε '|', μετά split στο ΠΡΩΤΟ '='
    - κενό key (' =rel1430(UL): 18') = συνέχεια του προηγούμενου key -> επόμενη τιμή του
    - τιμή με '; ' -> λίστα
    - `values` κρατά μία θέση ανά εμφάνιση του key, `raw` τα αρχικά segments ενωμένα με '|'
    - segment χωρίς '=' γίνεται key χωρίς τιμή — δεν μαντεύουμε τι σημαίνει
    """
    items = []
    if not text:
        return items

    for segment in text.split("|"):
        if not segment.strip():
            continue

        key, sep, value = segment.partition("=")
        key = key.strip()

        if sep and not key and items:
            items[-1]["values"].append(_split_value(value.strip()))
            items[-1]["raw"] += "|" + segment
            continue

        items.append({
            "key": key,
            "values": [_split_value(value.strip())] if sep else [],
            "raw": segment,
        })

    return items
