"""Call Analysis — η έξοδος του native classifier (CallAnalysis) ανά πλευρά, και ό,τι από το REA
(SmartAnalytics 25.3.66, REA/*.md) έλειπε από τη Call Detail:

  /api/call_analysis       -> CallAnalysis A+B: ταξινόμηση, χρονικά όρια, radio GSM/WCDMA/LTE/NR,
                              SIP, release, handover, μετρητές L3 + DescriptionA/B του Scene
                              (DmnCallInformation), callCause (CallSession) και έλεγχος του
                              παραθύρου radio (σφάλμα SIP join SessionId + 1 του sqCallAnalysis)
  /api/speech_samples      -> FactSpeech ανά δείγμα (IPAudioRTT, MissedVoice, LQ sub-scores...)
  /api/speech_time_domain  -> FactSpeechTimeDomain ενός speech test (similarity, delay, signal)

Το ζεύγος A/B βγαίνει από το call_pairs._call_pair, όπως στο call_detail_native."""
import re

from fastapi import APIRouter, HTTPException, Query

from api_utils import _rows
from call_pairs import _call_pair, pair_sides
from db import get_connection

router = APIRouter(tags=["call-detail"])


# ---------------------------------------------------------------------------
# Pure helpers (ελέγχονται στα tests χωρίς βάση)
# ---------------------------------------------------------------------------

# Τιμή-σημαία του MF για Failed κλήσεις: ο importer την αντιγράφει στο CallSession.setupTime
# και από εκεί στο CallAnalysis (REA §7). Στη DOD_26H2: 188 Failed + 10 System Release.
SETUP_TIME_SENTINEL_S = 99.9


def setup_time_value(value):
    """CallAnalysis.setupTime (δευτερόλεπτα) -> None όταν είναι η σημαία 99.9."""
    if value is None:
        return None
    value = float(value)
    if abs(value - SETUP_TIME_SENTINEL_S) < 0.01:
        return None
    return round(value, 3)


# 'normal; Normal call clearing (Cause: 16)'  (sqPostImportUpdateVoiceCallCause, M->… κλήσεις)
_CAUSE_SUFFIX = re.compile(r"^(?P<base>.*?)\s*;\s*(?P<text>[^;]*?)\s*\(Cause:\s*(?P<code>\d+)\)\s*$")
# 'Cause :16 (Normal event: normal call clearing)'  (όπως έρχεται από το MF)
_CAUSE_PREFIX = re.compile(r"^Cause\s*:\s*(?P<code>\d+)\s*\((?P<text>.*)\)\s*$")


def parse_call_cause(text):
    """CallSession.callCause -> {"raw", "base", "causeText", "causeCode"}.

    Δύο μορφές με αριθμό GSM L3 cause:
      'Stop Call; Normal call clearing (Cause: 16)' -> base 'Stop Call', 16
      'Cause :16 (Normal event: normal call clearing)' -> base None, 16
    Οτιδήποτε άλλο μένει ως base, χωρίς cause."""
    raw = text.strip() if isinstance(text, str) else None
    out = {"raw": raw or None, "base": None, "causeText": None, "causeCode": None}
    if not raw:
        return out

    m = _CAUSE_SUFFIX.match(raw)
    if m:
        out["base"] = m.group("base").strip() or None
    else:
        m = _CAUSE_PREFIX.match(raw)
        if not m:
            out["base"] = raw
            return out
    out["causeText"] = m.group("text").strip() or None
    out["causeCode"] = int(m.group("code"))
    return out


def unclassified_reason(code, call_status, side, media_client):
    """Γιατί μια γραμμή του CallAnalysis έμεινε χωρίς ταξινόμηση (REA §3, query Q3).

    'I': το sqCallAnalysis επεξεργάζεται μόνο κλήσεις με MediaClient LIKE '%Phone%'· μια
         B-side Landunit (σταθερή μονάδα) μένει στο 'I' του sqPostImportInitCallAnalysis.
    'S': το sqCallAnalysisCode δεν έχει κανόνα για 'System Release'."""
    if code == "I":
        if media_client and "phone" not in media_client.lower():
            return (f"{side}-side είναι {media_client}: ο native classifier (sqCallAnalysis) "
                    "ταξινομεί μόνο Phone")
        return "Δεν πέρασε από τον native classifier (code I)"
    if code == "S":
        if call_status == "System Release":
            return "System Release: δεν υπάρχει κανόνας στο sqCallAnalysisCode"
        return "Ο native classifier δεν βρήκε κανόνα (code S)"
    return None


# Ομάδες στηλών του CallAnalysis για το UI: (τίτλος, στήλες, κρύψε γραμμές με 0 και στις δύο
# πλευρές). Τα keys με κεφαλαίο πρώτο που δεν είναι στήλες (Description, CallCause...) τα
# υπολογίζει το endpoint.
CA_GROUPS = [
    ("Ταξινόμηση", [
        "callStatus", "code", "codeDescription", "Description", "DescriptionGroup", "UnclassifiedReason",
    ], False),
    ("Κλήση", [
        "callType", "callDir", "CallMode", "VoiceCallType", "MediaClient",
        "CallCause", "CallCauseCode", "CallCauseText",
        "SetupTime_s", "CallDuration_s",
        "technology", "StartTechnology", "EndTechnology", "CallTechnologies", "band", "Roaming", "NetIds",
    ], False),
    ("Χρονικά όρια", [
        "callStartTimeStamp", "alertTimeStamp", "connAckTimeStamp", "callSetupEndTimeStamp",
        "callEndTimeStamp", "callDisconnectTimeStamp", "SessionEnd",
    ], False),
    ("Radio LTE", [
        "avgLTERSRP", "avgLTERSRQ", "avgLTERSSI", "avgLTESINR", "avgPuschTxPower",
        "numOfLTERadioValues", "LastLTERadioTimeStamp",
    ], False),
    ("Radio NR", [
        "avgNR5GRSRP", "avgNR5GRSRQ", "avgNR5GSINR", "avgNR5GPuschTxPower",
        "numOfNR5GRadioValues", "LastNR5GRadioTimeStamp",
    ], False),
    ("Radio WCDMA", [
        "avgTotEcIo", "avgUERxPwr", "avgUETxPwr", "avgBLER", "numOfWCDMARadioValues", "LastWCDMARadioTimeStamp",
    ], False),
    ("Radio GSM", [
        "avgRxLev", "avgRxQual", "avgTA", "avgMsTxPwr", "AvgBCCHRxLev", "numOfRadioValues", "LastRadioTimeStamp",
        "avgRLT", "numOfRLTValues",
    ], False),
    ("SIP", [
        "SIPINVITECode", "SIPINVITEReason", "SIPBYECode", "SIPBYEReason", "SIPBYEInitDirection",
        "SIPCANCELCode", "SIPCANCELReason", "SIPCANCELInitDirection",
        "LastSIPMessage", "LastRTPSent", "LastRTPReceived",
    ], False),
    ("Disconnect / Release", [
        "disconCause", "disconClass", "disconDirection", "disconLocation", "ReleaseCause",
        "noL3Duration", "FailedRegistration", "NoService", "Initializing", "CRRandomCode",
        "NumReestablishmentRequests",
    ], False),
    ("Handover", [
        "LastHoType", "LastHoCause", "LastHoTimeStamp",
        "LastUMTSHoType", "LastUMTSCause", "LastUMTSHoTimeStamp",
        "LastLTEHoType", "LastLTECause", "LastLTEHoTimeStamp",
        "LastNR5GHoType", "LastNR5GCause", "LastNR5GHoTimeStamp",
        "LastAssMsg", "LastAssCause", "LastAssTimeStamp",
    ], False),
    ("Μετρητές SIP", [
        "numSIPINVITERequest", "numSIPINVITETrying", "numSIPINVITEProgress", "numSIPINVITERinging",
        "numSIPINVITEOK", "numSIPINVITEFailure", "numSIPINVITEForwarded",
        "numSIPPRACKRequest", "numSIPPRACKOK", "numSIPPRACKFailure",
        "numSIPBYERequest", "numSIPBYEOK", "numSIPBYEFailure",
        "numSIPCANCELRequest", "numSIPCANCELOK", "numSIPCANCELFailure", "numSIPMessages",
    ], True),
    ("Μετρητές CSFB / EPSFB", [
        "numCSFBRRCConnectionRequest", "numCSFBEMMExtendedServiceRequest", "numCSFBEMMServiceReject",
        "numCSFBRRCRelease", "numCSFB4GIRATChange",
        "numEPSFB", "numEPSFBRRCConnectionRequest", "numEPSFBEMM5GMMServiceRequest",
        "numEPSFBEMMServiceReject", "numEPSFBRRCRelease", "numEPSFB5GIRATChange",
    ], True),
    ("Μετρητές LTE / NR", [
        "numDCCH4GTrial", "numDCCH4GSuccess", "numDedicatedBearer", "numDedicatedBearerSuccess",
        "num4GRRCConnRel", "num4GReestablishment", "num4GReestablishmentSuccess",
        "numTrackingAreaUpdate", "numTrackingAreaUpdateSuccess", "numEMMDetach",
        "numDCCHNR5GTrial", "numDCCHNR5GSuccess", "numNR5GPDUSession", "numNR5GPDUSessionSuccess",
        "numNR5GRRCConnRel", "numNR5GReestablishment", "numNR5GReestablishmentSuccess",
        "numNR5GRegistration", "numNR5GRegistrationSuccess",
    ], True),
    ("Μετρητές GSM / UMTS", [
        "numChnReq", "numImmASS", "numImmAssRej", "numCMServiceRequest", "numCMServiceReject",
        "numSetup", "numCallProceding", "numAlerting", "numConn", "numConnAck",
        "numAssCmd", "numAssCmpl", "numAssFail", "numDisconnect", "numRelease", "numChnRel",
        "numLURequest", "numLUAccept", "numLUReject",
        "numRRCConnReq", "numRRCConnSetup", "numRRCConnRej", "numRBSetup", "numRBSetupFail",
        "numRABTrial", "numRABSuccess", "numRRCConnRel", "num3GReestablishment",
    ], True),
]

# Υπολογισμένα keys (όχι στήλες του CallAnalysis).
_COMPUTED_KEYS = {
    "Description", "DescriptionGroup", "UnclassifiedReason", "VoiceCallType", "MediaClient",
    "CallCause", "CallCauseCode", "CallCauseText", "SetupTime_s", "CallDuration_s", "SessionEnd",
}

CA_COLUMNS = [c for _, cols, _ in CA_GROUPS for c in cols if c not in _COMPUTED_KEYS]


def groups_payload():
    return [{"title": t, "keys": cols, "hideZero": hide_zero} for t, cols, hide_zero in CA_GROUPS]


# ---------------------------------------------------------------------------
# 1. CallAnalysis A+B
# ---------------------------------------------------------------------------

# Παράθυρο radio του sqCallAnalysis: τα τελευταία 8 LTEMeasurementReport (κατά MsgId) στα
# 20 s πριν από το callDisconnectTimeStamp, απλό AVG σε dB, μόνο για Dropped/Failed.
# "Fixed": το ίδιο, με το disconnect κομμένο στο τέλος του session (REA §9, query Q1).
_CALL_ANALYSIS_SQL = """
    SELECT CA.SessionId, {ca_cols},
           CA.Side AS NativeSide, CA.SessionIdA, CA.setupTime, CA.callDuration,
           CI.DescriptionA, CI.DescriptionB, CI.DescriptionGroupA, CI.DescriptionGroupB,
           CS.callCause AS CsCallCause, CS.VoiceCallType, CS.MediaClient AS CsMediaClient,
           CS.MediaClientB AS CsMediaClientB,
           DS.EndTime AS SessionEnd,
           FX.DisconnectFixed,
           LTEF.n AS FixedNumLTE, LTEF.rsrp AS FixedLTERSRP, LTEF.rsrq AS FixedLTERSRQ, LTEF.sinr AS FixedLTESINR
    FROM CallAnalysis CA
    LEFT JOIN DwSession DS ON DS.SessionId = CA.SessionId
    LEFT JOIN CallSession CS ON CS.SessionId = COALESCE(CA.SessionIdA, CA.SessionId)
    LEFT JOIN FactCallSession F ON F.SessionIdASide = COALESCE(CA.SessionIdA, CA.SessionId)
    LEFT JOIN DmnCallInformation CI ON CI.DmnId = F.DmnIdCallInformation
    OUTER APPLY (
        SELECT CASE WHEN CA.callDisconnectTimeStamp > DS.EndTime THEN DS.EndTime
                    ELSE CA.callDisconnectTimeStamp END AS DisconnectFixed
    ) FX
    OUTER APPLY (
        SELECT COUNT(*) AS n, AVG(x.RSRP) AS rsrp, AVG(x.RSRQ) AS rsrq, AVG(x.SINR0) AS sinr
        FROM (
            SELECT TOP (8) g.RSRP, g.RSRQ, g.SINR0
            FROM LTEMeasurementReport g
            WHERE g.SessionId = CA.SessionId
              AND g.MsgTime < FX.DisconnectFixed
              AND g.MsgTime > DATEADD(s, -20, FX.DisconnectFixed)
            ORDER BY g.MsgId DESC
        ) x
        WHERE CA.callStatus IN ('Dropped', 'Failed')
          AND CA.callDisconnectTimeStamp > DS.EndTime
    ) LTEF
    WHERE CA.SessionId IN ({placeholders});
"""


def _num(v):
    return None if v is None else round(float(v), 2)


def radio_window(row):
    """Έλεγχος του παραθύρου radio του native: εφαρμόζεται μόνο σε Dropped/Failed. Όταν το
    disconnect πέφτει μετά το τέλος του session (SIP του επόμενου IDLE session), επιστρέφει
    και τις τιμές LTE με το διορθωμένο παράθυρο."""
    applies = row.get("callStatus") in ("Dropped", "Failed")
    disconnect = row.get("callDisconnectTimeStamp")
    session_end = row.get("SessionEnd")
    outside = bool(applies and disconnect is not None and session_end is not None and disconnect > session_end)
    overshoot = int((disconnect - session_end).total_seconds() * 1000) if outside else None
    return {
        "applies": applies,
        "outsideCall": outside,
        "overshootMs": overshoot,
        "disconnectNative": disconnect,
        "disconnectFixed": row.get("DisconnectFixed") if outside else None,
        "native": {
            "rsrp": _num(row.get("avgLTERSRP")), "rsrq": _num(row.get("avgLTERSRQ")),
            "sinr": _num(row.get("avgLTESINR")), "n": row.get("numOfLTERadioValues"),
        },
        "fixed": {
            "rsrp": _num(row.get("FixedLTERSRP")), "rsrq": _num(row.get("FixedLTERSRQ")),
            "sinr": _num(row.get("FixedLTESINR")), "n": row.get("FixedNumLTE"),
        } if outside else None,
    }


def shape_side(row, side):
    """Γραμμή CallAnalysis (+ joins) -> {στήλες, υπολογισμένα keys, radioWindow}."""
    is_b = side == "B"
    media_client = row.get("CsMediaClientB") if is_b else row.get("CsMediaClient")
    cause = parse_call_cause(row.get("CsCallCause"))
    duration = row.get("callDuration")

    out = {c: row.get(c) for c in CA_COLUMNS}
    out.update({
        "SessionId": row.get("SessionId"),
        "Side": side,
        "Description": row.get("DescriptionB" if is_b else "DescriptionA"),
        "DescriptionGroup": row.get("DescriptionGroupB" if is_b else "DescriptionGroupA"),
        "UnclassifiedReason": unclassified_reason(row.get("code"), row.get("callStatus"), side, media_client),
        "VoiceCallType": row.get("VoiceCallType"),
        "MediaClient": media_client,
        "CallCause": cause["raw"],
        "CallCauseCode": cause["causeCode"],
        "CallCauseText": cause["causeText"],
        "SetupTime_s": setup_time_value(row.get("setupTime")),
        "SetupTimeSentinel": row.get("setupTime") is not None and setup_time_value(row.get("setupTime")) is None,
        "CallDuration_s": round(duration / 1000.0, 3) if duration is not None else None,
        "SessionEnd": row.get("SessionEnd"),
        "radioWindow": radio_window(row),
    })
    return out


@router.get("/api/call_analysis")
def get_call_analysis(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Έξοδος του native classifier (CallAnalysis) για A και B, ομαδοποιημένη για το UI.

    Response: {"pairSource", "groups": [{"title", "keys", "hideZero"}], "a": {...}|null, "b": {...}|null}.
    Κάθε πλευρά έχει τις στήλες των groups, `Description`/`DescriptionGroup` όπως τα δείχνει
    το Scene (DmnCallInformation), `UnclassifiedReason` για code I/S, `CallCause` από το
    CallSession (με το '; <cause> (Cause: n)' του post-import) και `radioWindow`."""
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        sides = pair_sides(pair)
        payload = {"pairSource": pair["pairSource"] if pair else None, "groups": groups_payload(), "a": None, "b": None}
        if not sides:
            return payload

        sids = list(sides)
        cursor.execute(_CALL_ANALYSIS_SQL.format(
            ca_cols=", ".join(f"CA.[{c}]" for c in CA_COLUMNS),
            placeholders=", ".join("?" * len(sids)),
        ), tuple(sids))

        for row in _rows(cursor):
            side = sides.get(row["SessionId"])
            if side:
                payload[side.lower()] = shape_side(row, side)
        return payload
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# 2. FactSpeech ανά δείγμα
# ---------------------------------------------------------------------------

# Μέσοι όροι του summary ανά πλευρά (πλευρά = session που ΑΚΟΥΣΕ το δείγμα).
SPEECH_SUMMARY_AVG = (
    "LQ", "IPAudioRTT", "MissedVoiceDecimal", "FrontClippingDecimal", "DelaySpread", "DelayDeviation",
    "ASLrcvP56", "NoiseRcv", "StaticSNR", "LQColoration", "LQDiscontinuity", "LQNoisiness", "LQLoudness",
)


def speech_summary(samples):
    """{"A": {...}, "B": {...}}: πλήθος, AVG των SPEECH_SUMMARY_AVG (αγνοώντας NULL), min LQ,
    πλήθος LQIsBad και SilentCount."""
    out = {}
    for side in ("A", "B"):
        rows = [s for s in samples if s.get("Side") == side]
        summary = {"SampleCount": len(rows)}
        for col in SPEECH_SUMMARY_AVG:
            vals = [float(r[col]) for r in rows if r.get(col) is not None]
            summary[col] = round(sum(vals) / len(vals), 3) if vals else None
        lqs = [float(r["LQ"]) for r in rows if r.get("LQ") is not None]
        summary["MinLQ"] = round(min(lqs), 2) if lqs else None
        summary["BadCount"] = sum(1 for r in rows if r.get("LQIsBad"))
        summary["SilentCount"] = sum(1 for r in rows if r.get("SilentCount"))
        out[side] = summary
    return out


@router.get("/api/speech_samples")
def get_speech_samples(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """FactSpeech της κλήσης (A+B), ένα row ανά speech δείγμα: πέρα από το MOS (LQ, ίσο με
    το ResultsLQ08Avg σε 22.035/22.044 δείγματα της DOD_26H2, τα υπόλοιπα NULL) έχει
    IPAudioRTT (Two-way Audio Delay), MissedVoice, FrontClipping, DelaySpread, επίπεδα
    σήματος/θορύβου και τα LQ sub-scores (Voice.saws «Speech Quality» του Scene)."""
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        sides = pair_sides(pair)
        if not sides:
            return {"pairSource": pair["pairSource"] if pair else None, "samples": [], "summary": speech_summary([])}

        sids = list(sides)
        cursor.execute(f"""
            SELECT fs.FactId, fs.FullDate, fs.SessionId, fs.TestId, fs.Direction,
                   fs.SpeechAlgorithm, fs.Band, fs.SpeechSample, fs.CodecName, fs.CodecRate,
                   fs.LQ, fs.LQIsBad, fs.QualityCode, fs.[Quality Category] AS QualityCategory,
                   fs.MissedVoiceDecimal, fs.FrontClippingDecimal, fs.DelaySpread, fs.DelayDeviation,
                   fs.IPAudioRTT, fs.ASLrcvP56, fs.NoiseRcv, fs.StaticSNR, fs.TotalGain,
                   fs.LQColoration, fs.LQDiscontinuity, fs.LQNoisiness, fs.LQLoudness,
                   CAST(fs.SilentCount AS int) AS SilentCount
            FROM FactSpeech fs
            WHERE fs.SessionId IN ({", ".join("?" * len(sids))})
            ORDER BY fs.FullDate, fs.FactId;
        """, tuple(sids))
        samples = _rows(cursor)
        for s in samples:
            s["Side"] = sides.get(s["SessionId"])

        return {"pairSource": pair["pairSource"], "samples": samples, "summary": speech_summary(samples)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


@router.get("/api/speech_time_domain")
def get_speech_time_domain(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1),
    test_id: str = Query(..., min_length=1),
):
    """FactSpeechTimeDomain ενός speech test της κλήσης (~470 σημεία): Similarity,
    Interruptions, Sent/ReceivedSignal, SignalAmplification(Trend), DelayProfile ανά Time (s).
    Το test πρέπει να ανήκει σε session του ζεύγους — δεν διαβάζουμε ξένα tests."""
    conn = None
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        pair = _call_pair(cursor, session_id)
        sids = list(pair_sides(pair))
        if not sids:
            return {"points": []}

        cursor.execute(f"""
            DECLARE @tid BIGINT = TRY_CONVERT(BIGINT, ?);
            SELECT t.Time, t.Similarity, t.Interruptions, t.SentSignal, t.ReceivedSignal,
                   t.SignalAmplification, t.SignalAmplificationTrend, t.DelayProfile
            FROM FactSpeechTimeDomain t
            WHERE t.TestId = @tid AND t.SessionId IN ({", ".join("?" * len(sids))})
            ORDER BY t.Time, t.FactId;
        """, (test_id, *sids))
        return {"points": _rows(cursor)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()
