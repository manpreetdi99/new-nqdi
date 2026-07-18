"""Σελίδα Call Detail — L3 signalling tab:
FactL3Messages log (με αποκωδικοποίηση RRC/NAS/SIP/GSM), L3 summary, tracelog."""
from fastapi import APIRouter, HTTPException, Query

from api_utils import _rows
from db import get_connection
from rrc_decode import decode_l3_row

router = APIRouter(tags=["call-l3"])


@router.get("/api/l3_messages")
def get_l3_messages(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    side: str = Query(default="A"),  # "A" (default, uses session_id as-is) or "B" (resolves the paired B-side SessionId)
    technology: str | None = Query(default=None),     # e.g. LTE, NR5G, GSM, WCDMA, VoIP
    layer: str | None = Query(default=None),          # e.g. LTE-RRC, LTE-NAS, SIP, 5GNR-RRC
    before_seconds: int = Query(default=10, ge=0, le=600),
    after_seconds: int = Query(default=10, ge=0, le=600),
):
    """
    L3 / SIP / RRC / NAS messages for the call window.

    Both SessionIds (A & B) are resolved together, up front, in one query
    (pair_root -> ASessionId, b_side -> BSessionId), then ?side=A or ?side=B
    simply picks which of the two already-resolved ids to use for the call
    window / L3 log below — same pattern as the other *_b_side endpoints,
    so the frontend only ever has to pass a single session_id.

    The window anchors on the EARLIEST of: first SIP INVITE, first RRC
    connection setup/reconfiguration, or callStartTimeStamp, then extends by
    before_seconds/after_seconds, so call-setup signalling isn't cut off.

    If the selected side is missing callStartTimeStamp / callEndTimeStamp,
    the paired side's timestamps are used instead (A <-> B fallback); the
    borrowed field is flagged via CallStartSource / CallEndSource.
    """

    conn = None

    try:
        side = (side or "A").upper().strip()

        if side not in ("A", "B"):
            raise HTTPException(status_code=400, detail="side must be A or B")

        conn = get_connection(database)
        cursor = conn.cursor()

        # 0) Resolve BOTH SessionIds (A & B) for this call in one round trip.
        cursor.execute("""
            ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                         ELSE CA.SessionId END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
            ),
            b_side AS (
                SELECT TOP (1) CA.SessionId AS BSessionId
                FROM CallAnalysis CA
                INNER JOIN pair_root PR ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'
            )
            SELECT PR.ASessionId, BS.BSessionId
            FROM pair_root PR
            LEFT JOIN b_side BS ON 1 = 1
        """, (session_id, session_id))
        pair_row = cursor.fetchone()
        if not pair_row or pair_row[0] is None:
            return {"callWindow": None, "l3Messages": [], "message": "No call found for this session_id"}
        a_session_id, b_session_id = pair_row[0], pair_row[1]

        if side == "B":
            if b_session_id is None:
                return {"callWindow": None, "l3Messages": [], "message": "No B-side session found for this call"}
            resolved_session_id = str(b_session_id)
        else:
            resolved_session_id = str(a_session_id)

        # 1) Call window for the resolved session_id.
        cursor.execute("""
            SELECT TOP 1
                CA.SessionId,
                CA.FileId,
                CA.callStartTimeStamp AS CallStart,
                COALESCE(
                    CA.callEndTimeStamp,
                    DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp)
                ) AS CallEnd,
                CA.callStatus,
                CA.technology,
                CA.callDir,
                CA.Side,
                CA.SessionIdA
            FROM CallAnalysis CA
            WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
            ORDER BY CA.callStartTimeStamp
        """, (resolved_session_id,))

        cols = [c[0] for c in cursor.description] if cursor.description else []
        wrow = cursor.fetchone()

        if not wrow:
            return {
                "callWindow": None,
                "l3Messages": [],
                "message": f"No call found for selected side={side}, session_id={resolved_session_id}",
            }

        call_window = {cols[i]: wrow[i] for i in range(len(cols))}

        # Add useful frontend metadata
        call_window["SelectedSide"] = side
        call_window["ASessionId"] = a_session_id
        call_window["BSessionId"] = b_session_id
        call_window["ResolvedSessionId"] = resolved_session_id

        # 1b) Fallback: if this side's CallStart/CallEnd is missing, borrow the
        #     paired side's timestamps (A <-> B) so the window is still usable.
        other_session_id = b_session_id if side == "A" else a_session_id
        other_side = "B" if side == "A" else "A"
        if (call_window.get("CallStart") is None or call_window.get("CallEnd") is None) \
                and other_session_id is not None:
            cursor.execute("""
                SELECT TOP 1
                    CA.callStartTimeStamp AS CallStart,
                    COALESCE(
                        CA.callEndTimeStamp,
                        DATEADD(MILLISECOND, ISNULL(CA.callDuration, 0), CA.callStartTimeStamp)
                    ) AS CallEnd
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                ORDER BY CA.callStartTimeStamp
            """, (str(other_session_id),))
            other_row = cursor.fetchone()
            if other_row:
                if call_window.get("CallStart") is None and other_row[0] is not None:
                    call_window["CallStart"] = other_row[0]
                    call_window["CallStartSource"] = other_side
                if call_window.get("CallEnd") is None and other_row[1] is not None:
                    call_window["CallEnd"] = other_row[1]
                    call_window["CallEndSource"] = other_side

        # 2) Full L3 log based on the selected call window.
        #    'during' is scoped strictly to this side's own SessionId (no
        #    neighbouring SessionIds from the same FileId), so every one of
        #    its rows belongs to this call and is reported as phase='during'
        #    regardless of whether it lands a few seconds before the recorded
        #    callStartTimeStamp (call-setup signalling commonly precedes it).
        #    'before' / 'after' add surrounding context from the rest of the
        #    FileId (other SessionIds) without touching the 'during' rowset
        #    above — same source query, just UNIONed in.
        cte = """
            ;WITH target_call AS (
                SELECT TOP 1
                    CA.FileId,
                    CAST(? AS DATETIME2) AS CallStart,
                    CAST(? AS DATETIME2) AS CallEnd
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                ORDER BY CA.callStartTimeStamp
            ),
            setup_anchor AS (
                SELECT MIN(l.FullDate) AS AnchorTime
                FROM FactL3Messages l
                CROSS JOIN target_call tc
                WHERE l.SessionId = TRY_CONVERT(BIGINT, ?)
                  AND l.FullDate BETWEEN DATEADD(second, -30, tc.CallStart) AND tc.CallEnd
                  AND (
                        l.SimpleMsgName LIKE '%INVITE%'
                     OR l.SimpleMsgName LIKE '%RRCConnectionRequest%'
                     OR l.SimpleMsgName LIKE '%RRCConnectionSetup%'
                     OR l.SimpleMsgName LIKE '%RRCSetup%'
                     OR l.SimpleMsgName LIKE '%RRCConnectionReconfiguration%'
                     OR l.SimpleMsgName LIKE '%RRCReconfiguration%'
                     OR l.SimpleMsgName LIKE '%Activate dedicated EPS bearer%'
                  )
            ),
            bounds AS (
                SELECT
                    tc.FileId,
                    tc.CallStart,
                    tc.CallEnd,

                    DATEADD(
                        second,
                        -?,
                        CASE
                            WHEN (SELECT AnchorTime FROM setup_anchor) IS NOT NULL
                             AND (SELECT AnchorTime FROM setup_anchor) < tc.CallStart
                            THEN (SELECT AnchorTime FROM setup_anchor)
                            ELSE tc.CallStart
                        END
                    ) AS PreStart,

                    DATEADD(second, ?, tc.CallEnd) AS PostEnd
                FROM target_call tc
            )
        """

        branches = """
            SELECT
                'during' AS Phase,

                DATEDIFF(ms, B.CallStart, l.FullDate) / 1000.0 AS SecondsFromCallStart,

                l.FullDate AS MsgTime,
                l.SessionId,
                l.Technology,
                l.Direction,
                l.Layer,
                l.MsgName,
                l.SimpleMsgName,
                l.Category,
                l.Class,
                l.SIPResponse,
                l.CombinedMsgNameSIPResponse,
                l.SIPCallId,
                l.PCI,
                l.ARFCN,
                l.Message AS Message

            FROM FactL3Messages l
            CROSS JOIN bounds B
            WHERE l.SessionId = TRY_CONVERT(BIGINT, ?)
              AND l.FullDate BETWEEN B.PreStart AND B.PostEnd

            UNION ALL

            SELECT
                'before' AS Phase,

                DATEDIFF(ms, B.CallStart, l.FullDate) / 1000.0 AS SecondsFromCallStart,

                l.FullDate AS MsgTime,
                l.SessionId,
                l.Technology,
                l.Direction,
                l.Layer,
                l.MsgName,
                l.SimpleMsgName,
                l.Category,
                l.Class,
                l.SIPResponse,
                l.CombinedMsgNameSIPResponse,
                l.SIPCallId,
                l.PCI,
                l.ARFCN,
                l.Message AS Message

            FROM FactL3Messages l
            CROSS JOIN bounds B
            WHERE l.FileId = B.FileId
              AND l.SessionId <> TRY_CONVERT(BIGINT, ?)
              AND l.FullDate >= B.PreStart
              AND l.FullDate <  B.CallStart

            UNION ALL

            SELECT
                'after' AS Phase,

                DATEDIFF(ms, B.CallStart, l.FullDate) / 1000.0 AS SecondsFromCallStart,

                l.FullDate AS MsgTime,
                l.SessionId,
                l.Technology,
                l.Direction,
                l.Layer,
                l.MsgName,
                l.SimpleMsgName,
                l.Category,
                l.Class,
                l.SIPResponse,
                l.CombinedMsgNameSIPResponse,
                l.SIPCallId,
                l.PCI,
                l.ARFCN,
                l.Message AS Message

            FROM FactL3Messages l
            CROSS JOIN bounds B
            WHERE l.FileId = B.FileId
              AND l.SessionId <> TRY_CONVERT(BIGINT, ?)
              AND l.FullDate >  B.CallEnd
              AND l.FullDate <= B.PostEnd
        """

        params = [
            call_window.get("CallStart"), call_window.get("CallEnd"),   # target_call window (with A<->B fallback)
            resolved_session_id, resolved_session_id, before_seconds, after_seconds,
            resolved_session_id,   # during
            resolved_session_id,   # before (exclude own session, already covered by during)
            resolved_session_id,   # after  (exclude own session, already covered by during)
        ]

        q = cte + f" SELECT * FROM ({branches}) AS combined WHERE 1=1"

        if technology:
            q += " AND Technology = ?"
            params.append(technology)

        if layer:
            q += " AND Layer = ?"
            params.append(layer)

        q += " ORDER BY MsgTime"

        cursor.execute(q, tuple(params))
        data = _rows(cursor)

        # Every FactL3Messages row stores its PDU as raw hex — decode RRC/NAS/SIP/GSM
        # payloads into readable text so the L3 log shows hex only when decode fails.
        for r in data:
            decoded = decode_l3_row(r.get("Technology"), r.get("Layer"), r.get("Direction"),
                                    r.get("MsgName"), r.get("SimpleMsgName"), r.get("Message"))
            if decoded is not None:
                if len(decoded) > 4000:
                    decoded = decoded[:4000] + f"\n… [+{len(decoded) - 4000} chars]"
                r["Message"] = decoded
            elif r.get("Message") and len(r["Message"]) > 1500:
                # undecodable payloads keep the old 1500-char hex cap
                r["Message"] = r["Message"][:1500]

        phase_counts = {"before": 0, "during": 0, "after": 0}

        for r in data:
            ph = r.get("Phase")
            if ph in phase_counts:
                phase_counts[ph] += 1

        return {
            "callWindow": call_window,
            "l3Messages": data,
            "summary": {
                "selectedSide": side,
                "resolvedSessionId": resolved_session_id,
                "aSessionId": a_session_id,
                "bSessionId": b_session_id,
                "total": len(data),
                "byPhase": phase_counts,
                "windowBeforeSec": before_seconds,
                "windowAfterSec": after_seconds,
            },
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if conn:
            conn.close()


@router.get("/api/l3_summary")
def get_l3_summary(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Aggregated signalling overview for the call: how many of each message type,
    by technology and direction. Quick way to spot e.g. repeated RRC re-establish
    or paging storms without scrolling the whole log."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                l.Technology,
                l.Layer,
                l.Direction,
                l.SimpleMsgName,
                COUNT(*) AS cnt,
                MIN(l.FullDate) AS firstSeen,
                MAX(l.FullDate) AS lastSeen
            FROM FactL3Messages l
            WHERE l.SessionId = TRY_CONVERT(BIGINT, ?)
            GROUP BY l.Technology, l.Layer, l.Direction, l.SimpleMsgName
            ORDER BY cnt DESC
        """, (session_id,))
        data = _rows(cursor)
        conn.close()
        return {"l3Summary": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/tracelog_values")
def get_tracelog_values(
    database: str = Query(..., min_length=1),
    session_id: str | None = Query(default=None)
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
           ;WITH pair_root AS (
                SELECT TOP (1)
                    CASE
                        WHEN CA.Side = 'B' AND CA.SessionIdA IS NOT NULL THEN CA.SessionIdA
                        ELSE CA.SessionId
                    END AS ASessionId
                FROM CallAnalysis CA
                WHERE CA.SessionId = TRY_CONVERT(BIGINT, ?)
                   OR CA.SessionIdA = TRY_CONVERT(BIGINT, ?)
            ),
            sessions_to_include AS (
                SELECT PR.ASessionId AS SessionId
                FROM pair_root PR
                WHERE PR.ASessionId IS NOT NULL

                UNION

                SELECT CA.SessionId AS SessionId
                FROM CallAnalysis CA
                INNER JOIN pair_root PR
                    ON CA.SessionIdA = PR.ASessionId
                WHERE CA.Side = 'B'

                UNION

                SELECT TRY_CONVERT(BIGINT, ?)
                WHERE TRY_CONVERT(BIGINT, ?) IS NOT NULL
            )
            SELECT
                TL.[FactId],
                TL.[FullDate],
                TL.[Side],
                TL.[SessionId],
                TL.[Info]
            FROM [dbo].[FactSystemTraceLog] TL
            INNER JOIN sessions_to_include SI
                ON TL.[SessionId] = SI.[SessionId]
            ORDER BY TL.[FullDate], TL.[FactId]
        """

        cursor.execute(query, (session_id, session_id, session_id, session_id))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"tracelogValues": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
