"""Integration tests (read-only) στη DOD_26H2 για routers/call_detail_native.

Τα αναμενόμενα νούμερα είναι τα acceptance του prompt — ΔΕΝ προσαρμόζονται στο αποτέλεσμα."""
import pytest

pytestmark = pytest.mark.db

A_SID = "42949673010"
B_SID = "47244640306"
PCAP_MAGICS = {
    bytes.fromhex("d4c3b2a1"), bytes.fromhex("a1b2c3d4"),
    bytes.fromhex("4d3cb2a1"), bytes.fromhex("0a0d0d0a"),
}


def _get(client, db_name, path, **params):
    r = client.get(path, params={"database": db_name, **params})
    assert r.status_code == 200, r.text
    return r.json()


# --- §1 CDR -------------------------------------------------------------------

@pytest.mark.parametrize("sid", [A_SID, B_SID])
def test_call_cdr_acceptance(client, db_name, sid):
    body = _get(client, db_name, "/api/call_cdr", session_id=sid)
    assert body["pairSource"] == "FactCallSession"
    assert body["call"]["CallStatus"] == "Failed"
    assert body["call"]["Valid"] == "Valid"
    assert body["a"]["CallMode"] == "VoLTE"
    assert body["b"]["CallMode"] == "CSFB"
    assert body["b"]["CsfbStatus"] == "Successful"
    assert body["a"]["StartCellId"] == 2820867
    assert body["a"]["StartScPciBsic"] == 15
    assert body["a"]["StartRsrpRscpRxLev"] == -122.5


def test_call_cdr_same_for_a_and_b(client, db_name):
    assert (_get(client, db_name, "/api/call_cdr", session_id=A_SID)
            == _get(client, db_name, "/api/call_cdr", session_id=B_SID))


def test_call_cdr_unknown_session_returns_nulls(client, db_name):
    body = _get(client, db_name, "/api/call_cdr", session_id="1")
    assert (body["call"], body["a"], body["b"]) == (None, None, None)


def test_cdr_mapping_covers_all_side_columns(db_name):
    """Κάθε στήλη του FactCDRVoice που τελειώνει σε A/B αντιστοιχίζεται ακριβώς μία φορά."""
    from db import get_connection
    from routers.call_detail_native import CDR_SIDE_COLUMNS
    conn = get_connection(db_name)
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('FactCDRVoice')")
        cols = {r[0] for r in cur.fetchall()}
    finally:
        conn.close()
    native_a = {a for _, a, _ in CDR_SIDE_COLUMNS}
    native_b = {b for _, _, b in CDR_SIDE_COLUMNS}
    assert native_a | native_b <= cols
    assert {c for c in cols if c.endswith("A")} == native_a
    assert {c for c in cols if c.endswith("B")} == native_b


# --- §2 Events ----------------------------------------------------------------

GROUPS_ALL = "Voice Service,RRM,Data Service"


def test_call_events_acceptance(client, db_name):
    events = _get(client, db_name, "/api/call_events",
                  session_id=A_SID, groups=GROUPS_ALL)["events"]
    a = [e for e in events if e["Side"] == "A"]
    b = [e for e in events if e["Side"] == "B"]
    assert len(a) == 38
    assert len(b) == 23

    # Το EventFullName είναι "<TopGroup> - <Group> - <όνομα>"· το EventShortName είναι NULL
    # στα Voice Service events.
    first = a[0]
    assert (first["EventTopGroup"], first["EventGroup"], first["EventFullName"]) == (
        "Voice Service", "Call Marker", "Voice Service - Call Marker - Start Dial")
    assert first["FullDate"].startswith("2026-09-21T08:37:24.204")

    assert any(
        e["EventTopGroup"] == "Voice Service" and e["EventGroup"] == "Call Status"
        and e["EventFullName"] == "Voice Service - Call Status - Call Failed"
        and e["FullDate"].startswith("2026-09-21T08:37:45.727")
        for e in events)

    dates = [e["FullDate"] for e in events]
    assert dates == sorted(dates)


def test_call_events_l3_only_for_rrm(client, db_name):
    events = _get(client, db_name, "/api/call_events",
                  session_id=A_SID, groups=GROUPS_ALL)["events"]
    assert all(e["L3MsgName"] is None for e in events if e["EventTopGroup"] != "RRM")


def test_call_events_same_for_a_and_b(client, db_name):
    assert (_get(client, db_name, "/api/call_events", session_id=A_SID, groups=GROUPS_ALL)
            == _get(client, db_name, "/api/call_events", session_id=B_SID, groups=GROUPS_ALL))


# --- §3 PCAP ------------------------------------------------------------------

def test_pcap_info_call_without_pcap(client, db_name):
    body = _get(client, db_name, "/api/call_pcap_info", session_id=A_SID)
    assert body["a"]["available"] is False
    assert body["b"]["available"] is False


def test_pcap_download_magic(client, db_name):
    from db import get_connection
    conn = get_connection(db_name)
    try:
        cur = conn.cursor()
        cur.execute("SELECT TOP 1 SessionId FROM PCAPData")
        sid = str(cur.fetchone()[0])
    finally:
        conn.close()

    info = _get(client, db_name, "/api/call_pcap_info", session_id=sid)
    side = next(s for s in ("a", "b") if info[s]["sessionId"] == int(sid))
    assert info[side]["available"] is True

    r = client.get("/api/call_pcap", params={"database": db_name, "session_id": sid})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/vnd.tcpdump.pcap"
    assert r.headers["content-disposition"].startswith('attachment; filename="')
    assert r.headers["content-disposition"].endswith('.pcap"')
    assert len(r.content) == info[side]["bytes"]
    assert r.content[:4] in PCAP_MAGICS


def test_pcap_download_404(client, db_name):
    r = client.get("/api/call_pcap", params={"database": db_name, "session_id": A_SID})
    assert r.status_code == 404


# --- §4 ---------------------------------------------------------------------

def test_call_markers_v2_acceptance(client, db_name):
    markers = _get(client, db_name, "/api/call_markers_v2", session_id=A_SID)["markers"]
    assert sum(m["Side"] == "A" for m in markers) == 6
    assert sum(m["Side"] == "B" for m in markers) == 12


def test_call_markers_v2_types_filter(client, db_name):
    markers = _get(client, db_name, "/api/call_markers_v2",
                   session_id=A_SID, types="Call Marker")["markers"]
    assert markers and all(m["MarkerType"] == "Call Marker" for m in markers)


def test_call_system_trace_counts_and_paging(client, db_name):
    body = _get(client, db_name, "/api/call_system_trace", session_id=A_SID)
    assert body["system"]["total"] == 27 + 27
    assert body["ip"]["total"] == 208 + 82
    page = _get(client, db_name, "/api/call_system_trace",
                session_id=A_SID, kind="ip", limit=50, offset=50)
    assert "system" not in page
    assert page["ip"]["total"] == 290 and len(page["ip"]["rows"]) == 50


def test_tracelog_without_fallback(client, db_name):
    body = _get(client, db_name, "/api/call_system_trace", session_id=A_SID, kind="tracelog")
    tl = body["tracelog"]
    assert tl["total"] == 27 + 27
    assert tl["fallbackSides"] == []
    assert all(r["TraceSource"] == "TraceLog" for r in tl["rows"])


def test_tracelog_ip_fallback_per_side(client, db_name):
    # 17179869218 (A): 0 TraceLog / 16 IP · 21474836514 (B): 14 TraceLog
    body = _get(client, db_name, "/api/call_system_trace", session_id="21474836514", kind="tracelog")
    tl = body["tracelog"]
    assert tl["fallbackSides"] == ["A"]
    assert tl["total"] == 16 + 14
    by_side = {s: {r["TraceSource"] for r in tl["rows"] if r["Side"] == s} for s in ("A", "B")}
    assert by_side == {"A": {"IP"}, "B": {"TraceLog"}}
    dates = [r["FullDate"] for r in tl["rows"]]
    assert dates == sorted(dates)

    page = _get(client, db_name, "/api/call_system_trace",
                session_id="21474836514", kind="tracelog", limit=10, offset=25)
    assert len(page["tracelog"]["rows"]) == 5


def test_call_rtp_shape(client, db_name):
    body = _get(client, db_name, "/api/call_rtp", session_id=A_SID)
    assert set(body["summary"]) == {"a", "b"}
    assert all(s["Side"] in ("A", "B") for s in body["samples"])


def test_ue_capability_shape(client, db_name):
    body = _get(client, db_name, "/api/ue_capability", session_id=A_SID)
    for side in ("a", "b"):
        assert body[side] is not None
        for item in body[side]["items"]:
            assert item["fields"] and item["raw"]
            assert item["fields"][0]["key"] == "Rat type"


def test_sync_devices_acceptance(client, db_name):
    body = _get(client, db_name, "/api/sync_devices", at="2026-09-21T08:37:30")
    sids = {d["SessionId"] for d in body["devices"]}
    assert len(body["devices"]) == 16
    assert {int(A_SID), int(B_SID)} <= sids
