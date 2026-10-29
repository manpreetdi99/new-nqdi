"""Call Detail — πηγές που χρησιμοποιεί το native SmartAnalytics Scene (25.3.66) και δεν
διάβαζε ακόμη το routers/call_detail.py:

  /api/call_cdr           -> FactCDRVoice (μία γραμμή ανά κλήση, χωρισμένη σε call/A/B)
  /api/call_events        -> FactAdvancedTriggerEvent (ενιαίο event timeline A+B)
  /api/call_pcap_info     -> PCAPData: ύπαρξη/μέγεθος ανά πλευρά (χωρίς το blob)
  /api/call_pcap          -> PCAPData: download του .pcap ενός session
  /api/call_rtp           -> FactVoLTE + DmnVoLTE (RTP samples + summary ανά πλευρά)
  /api/call_system_trace  -> FactSystemTraceLog / FactIPTrace (paged)
  /api/call_markers_v2    -> FactMarkers + DmnMarkerInfo
  /api/ue_capability      -> UECapabilityInformation ανά FileId πλευράς
  /api/sync_devices       -> συσκευές/sessions που καλύπτουν μια χρονική στιγμή

Το ζεύγος A/B βγαίνει από το call_pairs._call_pair (FactCallSession, fallback CallAnalysis).
Σε κάθε row το `Side` ('A'/'B') είναι η πλευρά του ζεύγους· όπου ο πίνακας έχει δική του
στήλη Side, αυτή επιστρέφεται ως `NativeSide`."""
import datetime
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from api_utils import _rows
from call_pairs import _call_pair, pair_sides, parse_capability_fields
from db import get_connection

router = APIRouter(tags=["call-detail"])


# ---------------------------------------------------------------------------
# FactCDRVoice: ρητή αντιστοίχιση στηλών A/B -> κανονικοποιημένο key.
# ΟΧΙ regex: τα native ονόματα δεν είναι συνεπή (internalStatusB, SSBIndexB/SsbIndexA,
# CsbScBsciA/CsfbScBsicB, CsfbRsrcpRxLevA/CsfbRscpRxLevB).
# ---------------------------------------------------------------------------
CDR_SIDE_COLUMNS = [
    # (key, στήλη A, στήλη B)
    # identity
    ("Operator", "OperatorA", "OperatorB"),
    ("Client", "ClientA", "ClientB"),
    ("System", "SystemA", "SystemB"),
    ("SessionId", "SessionIdA", "SessionIdB"),
    ("FileId", "FileIdA", "FileIdB"),
    ("FileName", "FileNameA", "FileNameB"),
    ("RouteName", "RouteNameA", "RouteNameB"),
    ("Category", "CategoryA", "CategoryB"),
    ("Mobility", "MobilityA", "MobilityB"),
    # θέση
    ("Latitude", "LatitudeA", "LatitudeB"),
    ("Longitude", "LongitudeA", "LongitudeB"),
    ("Direction", "DirectionA", "DirectionB"),
    ("SpeedKmph", "SpeedKmphA", "SpeedKmphB"),
    # συσκευή
    ("Imsi", "ImsiA", "ImsiB"),
    ("Imei", "ImeiA", "ImeiB"),
    ("Number", "NumberA", "NumberB"),
    ("Firmware", "FirmwareA", "FirmwareB"),
    ("Model", "ModelA", "ModelB"),
    # τεχνολογία
    ("CallTechnology", "CallTechnologyA", "CallTechnologyB"),
    ("SessionStartTechnology", "SessionStartTechnologyA", "SessionStartTechnologyB"),
    # start cell LTE/legacy
    ("StartMcc", "StartMccA", "StartMccB"),
    ("StartMnc", "StartMncA", "StartMncB"),
    ("StartTacLac", "StartTacLacA", "StartTacLacB"),
    ("StartCellId", "StartCellIdA", "StartCellIdB"),
    ("StartCarrier", "StartCarrierA", "StartCarrierB"),
    ("StartScPciBsic", "StartScPciBsicA", "StartScPciBsicB"),
    ("StartRsrpRscpRxLev", "StartRsrpRscpRxLevA", "StartRsrpRscpRxLevB"),
    ("StartRsrqEcNo", "StartRsrqEcNoA", "StartRsrqEcNoB"),
    ("StartSinr", "StartSinrA", "StartSinrB"),
    # start cell NR
    ("StartCarrierNr", "StartCarrierNrA", "StartCarrierNrB"),
    ("StartPciNr", "StartPciNrA", "StartPciNrB"),
    ("SsbIndex", "SsbIndexA", "SSBIndexB"),
    ("StartRsrpNr", "StartRsrpNrA", "StartRsrpNrB"),
    ("StartRsrqNr", "StartRsrqNrA", "StartRsrqNrB"),
    ("StartSinrNr", "StartSinrNrA", "StartSinrNrB"),
    # mode/status
    ("CallMode", "CallModeA", "CallModeB"),
    ("InternalStatus", "InternalStatusA", "internalStatusB"),
    # CSFB
    ("CsfbStatus", "CsfbStatusA", "CsfbStatusB"),
    ("CsfbStartTs", "CsfbStartTsA", "CsfbStartTsB"),
    ("CsfbDuration", "CsfbDurationA", "CsfbDurationB"),
    ("CsfbTechnology", "CsfbTechnologyA", "CsfbTechnologyB"),
    ("CsfbMcc", "CsfbMccA", "CsfbMccB"),
    ("CsfbMnc", "CsfbMncA", "CsfbMncB"),
    ("CsfbLac", "CsfbLacA", "CsfbLacB"),
    ("CsfbCellId", "CsfbCellIdA", "CsfbCellIdB"),
    ("CsfbCarrier", "CsfbCarrierA", "CsfbCarrierB"),
    ("CsfbScBsic", "CsbScBsciA", "CsfbScBsicB"),
    ("CsfbRscpRxLev", "CsfbRsrcpRxLevA", "CsfbRscpRxLevB"),
    ("CsfbEcNo", "CsfbEcNoA", "CsfbEcNoB"),
]

CDR_CALL_COLUMNS = [
    "CallStatus", "CallType", "CallDirection", "DialTs", "CallSessionStartTS", "CallSessionEndTs",
    "CallSetupTime_s", "CallDuration_s", "SqSampleCount", "MinSQ", "AvgSQ", "MaxSQ",
    "BadSampleCount", "Valid", "InvalidReason",
]


def split_cdr_row(row):
    """Flat FactCDRVoice row -> {"call", "a", "b"} με τα keys των παραπάνω λιστών."""
    return {
        "call": {col: row.get(col) for col in CDR_CALL_COLUMNS},
        "a": {key: row.get(col_a) for key, col_a, _ in CDR_SIDE_COLUMNS},
        "b": {key: row.get(col_b) for key, _, col_b in CDR_SIDE_COLUMNS},
    }


# ---------------------------------------------------------------------------
# Whitelists (παρατηρημένες τιμές στη DOD_26H2)
# ---------------------------------------------------------------------------
EVENT_TOP_GROUPS = ("Voice Service", "RRM", "Data Service", "Video Streaming")
DEFAULT_EVENT_GROUPS = "Voice Service,RRM"

MARKER_TYPES = (
    "Call Marker", "Test Borders", "Information Marker", "LTEEMMState", "MsgGSMLayer1",
    "Forcing Marker", "Video Marker", "Video Streaming", "WCDMARRCState",
)


def parse_whitelist(value, allowed, param_name):
    """'a, b,a' -> ['a', 'b'] (σειρά εμφάνισης, χωρίς διπλά). Τιμή εκτός whitelist -> 400.
    Οι τιμές επιστρέφονται ΜΟΝΟ ως παράμετροι του query, ποτέ μέσα στο SQL string."""
    values = []
    for part in (value or "").split(","):
        part = part.strip()
        if not part or part in values:
            continue
        if part not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid {param_name} value: {part!r}. Allowed: {', '.join(allowed)}",
            )
        values.append(part)
    if not values:
        raise HTTPException(status_code=400, detail=f"{param_name} must not be empty")
    return values


def _placeholders(n):
    return ", ".join("?" * n)


# ---------------------------------------------------------------------------
# PCAP
# ---------------------------------------------------------------------------
PCAP_MAX_BYTES = 50 * 1024 * 1024


def pcap_safe_name(file_name, session_id):
    """Όνομα αρχείου για Content-Disposition: μόνο [A-Za-z0-9._-], πάντα σε '.pcap'."""
    name = re.sub(r"[^A-Za-z0-9._-]", "_", file_name or "").strip("._")[:200]
    if not name:
        name = f"session_{re.sub(r'[^0-9]', '', str(session_id)) or 'unknown'}"
    if not name.lower().endswith(".pcap"):
        name += ".pcap"
    return name


def _side_payload(pair, payload):
    """Κοινό σχήμα response: pairSource + ό,τι επιστρέφει το endpoint."""
    return {"pairSource": pair["pairSource"] if pair else None, **payload}


def _tag_sides(rows, sides, native_side_col=None):
    """Προσθέτει `Side` από το ζεύγος. Η native στήλη Side (αν υπάρχει) -> `NativeSide`."""
    for r in rows:
        if native_side_col:
            r["NativeSide"] = r.pop(native_side_col, None)
        r["Side"] = sides.get(r["SessionId"])
    return rows


# ---------------------------------------------------------------------------
# 1. CDR
# ---------------------------------------------------------------------------
@router.get("/api/call_cdr")
def get_call_cdr(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """FactCDRVoice της κλήσης (A ή B session). Μία γραμμή ανά κλήση, SessionId = A-side
    (επαληθευμένο 3.027/3.027 στη DOD_26H2: SessionIdA/B = FactCallSession.SessionIdA/BSide)."""
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        empty = {"call": None, "a": None, "b": None}
        if not pair or pair["ASessionId"] is None:
            return _side_payload(pair, empty)

        cursor.execute("""
            DECLARE @aSid BIGINT = TRY_CONVERT(BIGINT, ?);
            SELECT c.*
            FROM FactCDRVoice c
            WHERE c.SessionId = @aSid;
        """, (pair["ASessionId"],))
        rows = _rows(cursor)

        return _side_payload(pair, split_cdr_row(rows[0]) if rows else empty)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# 2. Events
# ---------------------------------------------------------------------------
@router.get("/api/call_events")
def get_call_events(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    groups: str | None = Query(default=None),
):
    """Ενιαίο event timeline του native Scene (UE Drill Down -> Call, Voice Overview) από το
    FactAdvancedTriggerEvent, για A και B, ταξινομημένο κατά FullDate.

    `groups`: comma-separated EventTopGroup (whitelist EVENT_TOP_GROUPS), default
    'Voice Service,RRM'.

    Το FactL3Messages γίνεται join ΜΟΝΟ για RRM: στα Voice Service markers το
    FactIdLayer3Messages είναι γεμάτο αλλά δείχνει σε άσχετο μήνυμα (π.χ. το 'Dial' σε
    'Packet Downlink Dummy Control Block'). Το native το χρησιμοποιεί μόνο για RRC
    procedure/event name (TableService.AppendRRCEvents). Το SummaryInfo επιστρέφεται ως έχει."""
    top_groups = parse_whitelist(
        DEFAULT_EVENT_GROUPS if groups is None else groups, EVENT_TOP_GROUPS, "groups")

    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        sides = pair_sides(pair)
        if not sides:
            return _side_payload(pair, {"events": []})

        sids = list(sides)
        cursor.execute(f"""
            SELECT e.FactId, e.FullDate, e.SessionId, e.TestId, e.KPIId,
                   d.EventTopGroup, d.EventGroup, d.EventFullName, d.EventShortName, d.EventSubType,
                   e.SummaryInfo, e.EventSource, e.L3Content, e.SCellsLTE, e.SCells5GNR,
                   e.SignalStrengthBefore, e.SignalQualityAfter,
                   e.FactIdLayer3Messages,
                   l.Technology AS L3Technology, l.Layer AS L3Layer, l.Direction AS L3Direction,
                   l.SimpleMsgName AS L3MsgName, l.CombinedMsgNameSIPResponse AS L3MsgInfo,
                   p.latitude AS Latitude, p.longitude AS Longitude
            FROM FactAdvancedTriggerEvent e
            JOIN DmnAdvancedTriggerEventInfo d ON d.DmnId = e.DmnIdAdvancedTriggerEventInfo
            LEFT JOIN FactL3Messages l ON l.FactId = e.FactIdLayer3Messages AND d.EventTopGroup = 'RRM'
            LEFT JOIN Position p ON p.PosId = e.PosId
            WHERE e.SessionId IN ({_placeholders(len(sids))})
              AND d.EventTopGroup IN ({_placeholders(len(top_groups))})
            ORDER BY e.FullDate, e.FactId;
        """, (*sids, *top_groups))

        return _side_payload(pair, {"events": _tag_sides(_rows(cursor), sides)})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# 3. PCAP
# ---------------------------------------------------------------------------
@router.get("/api/call_pcap_info")
def get_call_pcap_info(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Υπάρχει PCAP ανά πλευρά; Ισοδύναμο του native PcapFileService.HasPcap
    (SELECT FileName FROM PCAPData WHERE SessionId = …). ΔΕΝ φέρνει τη στήλη Data."""
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        sides = pair_sides(pair)
        result = {
            side: {"available": False, "sessionId": None, "fileName": None, "bytes": None}
            for side in ("a", "b")
        }
        for sid, side in sides.items():
            result[side.lower()]["sessionId"] = sid

        if sides:
            sids = list(sides)
            cursor.execute(f"""
                SELECT p.SessionId, p.FileName, DATALENGTH(p.Data) AS Bytes
                FROM PCAPData p
                WHERE p.SessionId IN ({_placeholders(len(sids))});
            """, sids)
            for r in _rows(cursor):
                entry = result[sides[r["SessionId"]].lower()]
                # Στη DOD_26H2 το πολύ 1 γραμμή ανά session· αν βρεθούν περισσότερες,
                # κρατάμε την πρώτη, όπως το TOP (1) του /api/call_pcap.
                if not entry["available"]:
                    entry.update(available=True, fileName=r["FileName"], bytes=r["Bytes"])

        return _side_payload(pair, result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


@router.get("/api/call_pcap")
def get_call_pcap(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Download του PCAP ΕΝΟΣ session (της πλευράς, όχι του ζεύγους) — native
    PcapFileService: SELECT Data, FileName FROM PCAPData WHERE SessionId = ….
    Πρώτα DATALENGTH (404 αν δεν υπάρχει, 413 πάνω από PCAP_MAX_BYTES), μετά το blob."""
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);
            SELECT TOP (1) DATALENGTH(Data) AS Bytes, FileName
            FROM PCAPData
            WHERE SessionId = @sid;
        """, (session_id,))
        head = cursor.fetchone()
        if not head:
            raise HTTPException(status_code=404, detail="No PCAP for this session")
        if (head[0] or 0) > PCAP_MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"PCAP is {head[0]} bytes, limit is {PCAP_MAX_BYTES}",
            )

        cursor.execute("""
            DECLARE @sid BIGINT = TRY_CONVERT(BIGINT, ?);
            SELECT TOP (1) Data, FileName
            FROM PCAPData
            WHERE SessionId = @sid;
        """, (session_id,))
        row = cursor.fetchone()
        if not row or row[0] is None:
            raise HTTPException(status_code=404, detail="No PCAP for this session")

        safe_name = pcap_safe_name(row[1], session_id)
        return Response(
            content=bytes(row[0]),
            media_type="application/vnd.tcpdump.pcap",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# 4a. RTP / VoLTE
# ---------------------------------------------------------------------------
# Native Fusion FillSpeechRTPValues (items 25673/25643/25622/25602/25633): όλα AVG.
RTP_AVG_COLUMNS = (
    "AvgJitter", "PacketLossRate", "AvgIPDV", "AvgPDV",
    "NumLostPackets", "MaxConseqLostPackets", "NumOutOfOrderPackets",
)
RTP_SIP_COLUMNS = (
    "SIP Post Dial Delay", "SIP Dial Accept Delay", "SIP Dial Response Delay",
    "SIP Call Access", "SIP Termination", "SIP Registration", "SIP Subscribe",
)


def summarize_rtp(samples):
    """Summary μιας πλευράς: AVG (σε float, χωρίς NULL) των RTP_AVG_COLUMNS, SUM(NumPackets),
    distinct (Mode, Codec, PayloadType, SSRC) και το πρώτο μη-NULL κάθε SIP στήλης."""
    summary = {"SampleCount": len(samples)}
    for col in RTP_AVG_COLUMNS:
        vals = [float(s[col]) for s in samples if s.get(col) is not None]
        summary[col] = sum(vals) / len(vals) if vals else None

    packets = [s["NumPackets"] for s in samples if s.get("NumPackets") is not None]
    summary["NumPackets"] = sum(packets) if packets else None

    streams = []
    for s in samples:
        key = {k: s.get(k) for k in ("Mode", "Codec", "PayloadType", "SSRC")}
        if key not in streams:
            streams.append(key)
    summary["streams"] = streams

    for col in RTP_SIP_COLUMNS:
        summary[col] = next((s[col] for s in samples if s.get(col) is not None), None)
    return summary


@router.get("/api/call_rtp")
def get_call_rtp(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """VoLTE/RTP statistics ανά πλευρά: FactVoLTE + DmnVoLTE (Mode/Codec/PayloadType/SSRC)."""
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        sides = pair_sides(pair)
        samples = []
        if sides:
            sids = list(sides)
            cursor.execute(f"""
                SELECT v.FullDate, v.SessionId, v.RTPStatId,
                       dv.Mode, dv.Codec, dv.PayloadType, dv.SSRC,
                       v.NumPackets, v.NumLostPackets, v.PacketLossRate, v.MaxConseqLostPackets,
                       v.NumOutOfOrderPackets, v.AvgPayloadLength,
                       v.AvgJitter, v.AvgIPDV, v.MinIPDV, v.MaxIPDV, v.AvgPDV,
                       v.[SIP Post Dial Delay], v.[SIP Dial Accept Delay], v.[SIP Dial Response Delay],
                       v.[SIP Call Access], v.[SIP Termination], v.[SIP Registration], v.[SIP Subscribe]
                FROM FactVoLTE v
                LEFT JOIN DmnVoLTE dv ON dv.DmnId = v.DmnIdVoLTE
                WHERE v.SessionId IN ({_placeholders(len(sids))})
                ORDER BY v.FullDate;
            """, sids)
            samples = _tag_sides(_rows(cursor), sides)

        summary = {
            side.lower(): summarize_rtp([s for s in samples if s["Side"] == side])
            for side in ("A", "B")
        }
        return _side_payload(pair, {"samples": samples, "summary": summary})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# 4b. System / IP trace
# ---------------------------------------------------------------------------
# Σταθερά SQL fragments ανά πηγή — ΠΟΤΕ χωρίς φίλτρο session (FactIPTrace ~15,7 εκ. γραμμές).
_TRACE_SOURCES = {
    "system": (
        "FactSystemTraceLog",
        "t.FactId, t.FullDate, t.SessionId, t.Info, t.Side, t.MeasId",
        "Side",
    ),
    "ip": (
        "FactIPTrace",
        "t.FactId, t.FullDate, t.SessionId, t.TestId, t.Source, t.Destination, "
        "t.Direction, t.Protocol, t.Message",
        None,
    ),
}


def _tracelog_with_ip_fallback(cursor, sides, limit, offset):
    """TraceLog (FactSystemTraceLog) για κάθε πλευρά· όποια πλευρά δεν έχει ΚΑΜΙΑ γραμμή
    TraceLog παίρνει τις γραμμές της από το FactIPTrace. Στη DOD_26H2: 76/6.054 πλευρές
    κλήσεων χωρίς TraceLog, οι 15 με IP trace (π.χ. 17179869218: A 0 TraceLog / 16 IP).
    Κάθε row έχει `TraceSource` = 'TraceLog' | 'IP'."""
    sids = list(sides)
    in_sids = _placeholders(len(sids))

    cursor.execute(f"""
        SELECT t.SessionId, COUNT(*) AS n
        FROM FactSystemTraceLog t
        WHERE t.SessionId IN ({in_sids})
        GROUP BY t.SessionId;
    """, sids)
    tracelog_counts = {r[0]: r[1] for r in cursor.fetchall()}

    fallback_sids = [s for s in sids if not tracelog_counts.get(s)]
    ip_counts = {}
    if fallback_sids:
        cursor.execute(f"""
            SELECT i.SessionId, COUNT(*) AS n
            FROM FactIPTrace i
            WHERE i.SessionId IN ({_placeholders(len(fallback_sids))})
            GROUP BY i.SessionId;
        """, fallback_sids)
        ip_counts = {r[0]: r[1] for r in cursor.fetchall()}

    ip_sids = [s for s in fallback_sids if ip_counts.get(s)]
    total = sum(tracelog_counts.values()) + sum(ip_counts.values())
    if total == 0:
        return {"total": 0, "rows": [], "fallbackSides": []}

    # Ίδιες στήλες και στα δύο σκέλη του UNION, ώστε να γίνεται ένα κοινό paging.
    parts, params = [], []
    if tracelog_counts:
        tl_sids = list(tracelog_counts)
        parts.append(f"""
            SELECT t.FactId, t.FullDate, t.SessionId, 'TraceLog' AS TraceSource,
                   t.Info, t.Side,
                   CAST(NULL AS varchar(255)) AS Source, CAST(NULL AS varchar(255)) AS Destination,
                   CAST(NULL AS varchar(50)) AS Direction, CAST(NULL AS varchar(50)) AS Protocol,
                   CAST(NULL AS varchar(max)) AS Message
            FROM FactSystemTraceLog t
            WHERE t.SessionId IN ({_placeholders(len(tl_sids))})""")
        params += tl_sids
    if ip_sids:
        parts.append(f"""
            SELECT i.FactId, i.FullDate, i.SessionId, 'IP' AS TraceSource,
                   CAST(NULL AS varchar(max)) AS Info, CAST(NULL AS char(1)) AS Side,
                   i.Source, i.Destination, i.Direction, i.Protocol, i.Message
            FROM FactIPTrace i
            WHERE i.SessionId IN ({_placeholders(len(ip_sids))})""")
        params += ip_sids

    cursor.execute(f"""
        SELECT * FROM ({" UNION ALL ".join(parts)}) r
        ORDER BY r.FullDate, r.FactId
        OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
    """, (*params, offset, limit))

    return {
        "total": total,
        "rows": _tag_sides(_rows(cursor), sides, "Side"),
        "fallbackSides": sorted(sides[s] for s in ip_sids),
    }


@router.get("/api/call_system_trace")
def get_call_system_trace(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    kind: Literal["tracelog", "system", "ip", "both"] = "both",
    limit: int = Query(2000, ge=1, le=20000),
    offset: int = Query(0, ge=0),
):
    """System trace log και IP trace για A+B, paged (limit/offset ανά πηγή) με `total`.

    kind='tracelog': ένας ενιαίος πίνακας — TraceLog, με fallback σε IP trace για την
    πλευρά που δεν έχει TraceLog (βλ. _tracelog_with_ip_fallback)."""
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        sides = pair_sides(pair)

        if kind == "tracelog":
            tracelog = (_tracelog_with_ip_fallback(cursor, sides, limit, offset) if sides
                        else {"total": 0, "rows": [], "fallbackSides": []})
            return _side_payload(pair, {"limit": limit, "offset": offset, "tracelog": tracelog})

        kinds = ("system", "ip") if kind == "both" else (kind,)
        result = {}

        for k in kinds:
            table, columns, native_side = _TRACE_SOURCES[k]
            if not sides:
                result[k] = {"total": 0, "rows": []}
                continue

            sids = list(sides)
            in_sids = _placeholders(len(sids))
            cursor.execute(
                f"SELECT COUNT(*) FROM {table} t WHERE t.SessionId IN ({in_sids});", sids)
            total = cursor.fetchone()[0]

            cursor.execute(f"""
                SELECT {columns}
                FROM {table} t
                WHERE t.SessionId IN ({in_sids})
                ORDER BY t.FullDate, t.FactId
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
            """, (*sids, offset, limit))
            result[k] = {"total": total, "rows": _tag_sides(_rows(cursor), sides, native_side)}

        return _side_payload(pair, {"limit": limit, "offset": offset, **result})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# 4c. Markers (FactMarkers + DmnMarkerInfo)
# ---------------------------------------------------------------------------
@router.get("/api/call_markers_v2")
def get_call_markers_v2(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    types: str | None = Query(default=None),
):
    """Markers A+B από το FactMarkers με Category/Class από το DmnMarkerInfo. Το παλιό
    /api/markers (classic Markers) μένει όπως είναι. `types`: comma-separated MarkerType
    (whitelist MARKER_TYPES)· χωρίς αυτό επιστρέφονται όλοι οι τύποι."""
    marker_types = parse_whitelist(types, MARKER_TYPES, "types") if types is not None else None

    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        sides = pair_sides(pair)
        if not sides:
            return _side_payload(pair, {"markers": []})

        sids = list(sides)
        type_filter = (
            f"AND m.MarkerType IN ({_placeholders(len(marker_types))})" if marker_types else ""
        )
        cursor.execute(f"""
            SELECT m.FactId, m.FullDate, m.SessionId, m.Side, m.MarkerType, m.MarkerText,
                   d.Category, d.Class, d.ShortName, d.FullName,
                   p.latitude AS Latitude, p.longitude AS Longitude
            FROM FactMarkers m
            LEFT JOIN DmnMarkerInfo d ON d.DmnId = m.DmnIdMarkerInfo
            LEFT JOIN Position p ON p.PosId = m.PosId
            WHERE m.SessionId IN ({_placeholders(len(sids))})
              {type_filter}
            ORDER BY m.FullDate, m.FactId;
        """, (*sids, *(marker_types or ())))

        return _side_payload(pair, {"markers": _tag_sides(_rows(cursor), sides, "Side")})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# 4d. UE capability
# ---------------------------------------------------------------------------
@router.get("/api/ue_capability")
def get_ue_capability(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """UE capability ανά πλευρά. Το capability στέλνεται συχνά σε IDLE session πριν την κλήση
    (μόνο 257 CALL sessions έχουν δικό τους row στη DOD_26H2), οπότε ψάχνουμε στο FileId της
    πλευράς: ανά RatType η τελευταία γραμμή με FullDate <= τέλος κλήσης, αλλιώς η πρώτη του
    file. ΣΥΝΑΓΟΜΕΝΟ από τα value items του native UeCapabilityService (που δουλεύει ανά
    IMEI), όχι από runtime trace. Rows με Fields IS NULL (π.χ. utra, geran_cs) αγνοούνται."""
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        result = {"a": None, "b": None}

        for side in ("A", "B"):
            file_id = pair.get(f"{side}FileId") if pair else None
            if file_id is None:
                continue
            end = pair.get(f"{side}End")

            cursor.execute("""
                ;WITH c AS (
                    SELECT u.*, ROW_NUMBER() OVER (PARTITION BY u.RatType
                               ORDER BY CASE WHEN u.FullDate <= ? THEN 0 ELSE 1 END,
                                        CASE WHEN u.FullDate <= ? THEN u.FullDate END DESC,
                                        u.FullDate ASC) AS rn
                    FROM UECapabilityInformation u
                    WHERE u.FileId = ? AND u.Fields IS NOT NULL
                )
                SELECT MsgId, SessionId, FullDate, RatType, Fields FROM c WHERE rn = 1
                ORDER BY RatType;
            """, (end, end, file_id))

            result[side.lower()] = {
                "fileId": file_id,
                "sessionId": pair[f"{side}SessionId"],
                "items": [
                    {
                        "ratType": r["RatType"],
                        "fullDate": r["FullDate"],
                        "sessionId": r["SessionId"],
                        "msgId": r["MsgId"],
                        "fields": parse_capability_fields(r["Fields"]),
                        "raw": r["Fields"],
                    }
                    for r in _rows(cursor)
                ],
            }

        return _side_payload(pair, result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# 4e. Sync: συσκευές σε μια χρονική στιγμή
# ---------------------------------------------------------------------------
@router.get("/api/sync_devices")
def get_sync_devices(
    database: str = Query(..., min_length=1),
    at: datetime.datetime = Query(...),
    collection: str | None = Query(default=None),
):
    """Ανά συσκευή το session που καλύπτει τη στιγμή `at` (StartTime <= at < EndTime) και
    το RelatedSessionId του. Αναπαράγει το native SyncService.GetDevicesForTimeWindow /
    BuildDeviceList (items: Device Name, IMEI, Side, Device Type, Operator, Session,
    RelatedSessionId, Time, EndTime) — ΣΥΝΑΓΟΜΕΝΟ από τα value items, όχι από runtime trace.
    `collection`: προαιρετικό φίλτρο FileList.CollectionName.
    `SessionSide` (DwSession.Side): σε CALL B session το RelatedSessionId είναι το A — με
    αυτό το frontend ανοίγει την κλήση από τη λίστα, που κρατά μόνο A-side sessions."""
    # Naive datetime: το DwSession είναι datetime2 χωρίς timezone.
    at_value = at.replace(tzinfo=None)
    collection_join = (
        "JOIN FileList fl ON fl.FileId = ds.FileId AND fl.CollectionName = ?"
        if collection else ""
    )
    params = ((collection,) if collection else ()) + (at_value, at_value)

    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        cursor.execute(f"""
            SELECT d.DmnId AS DeviceId, d.Location AS DeviceName, d.IMEI, d.Side, d.DeviceType, d.Model,
                   op.Provider AS Operator,
                   ds.SessionId, ds.SessionType, ds.Side AS SessionSide,
                   ds.StartTime, ds.EndTime, ds.RelatedSessionId, ds.FileId
            FROM FactSession fs
            JOIN DwSession ds ON ds.SessionId = fs.SessionId
            {collection_join}
            LEFT JOIN DmnDevice d ON d.DmnId = fs.DmnIdDevice
            LEFT JOIN DmnOperator op ON op.DmnId = fs.DmnIdOperator
            WHERE ds.StartTime <= ? AND ds.EndTime > ?
            ORDER BY d.DeviceType, d.Side, d.Location;
        """, params)

        return {"at": at_value, "devices": _rows(cursor)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()
