"""Integration tests (read-only) στη DOD_26H2 για routers/call_analysis και τις αλλαγές
setup time / side comparison. Τα νούμερα είναι επαληθευμένα στη βάση (2026-10-27) και
στα REA/*.md — ΔΕΝ προσαρμόζονται στο αποτέλεσμα."""
import pytest

pytestmark = pytest.mark.db

A_SID = "42949673010"       # Failed VoLTE, A C3.120 / B C3.16
B_SID = "47244640306"
OUTSIDE_SID = "519691042840"  # Dropped, disconnect 43 s μετά το session (REA Q1)
UNCLASSIFIED_SID = "8589934594"  # A System Release (S), B Landunit (I)


def _get(client, db_name, path, **params):
    r = client.get(path, params={"database": db_name, **params})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("sid", [A_SID, B_SID])
def test_call_analysis_sample_call(client, db_name, sid):
    body = _get(client, db_name, "/api/call_analysis", session_id=sid)
    a, b = body["a"], body["b"]
    assert (a["code"], b["code"]) == ("C3.120", "C3.16")
    assert a["DescriptionGroup"] == "Poor Signal"
    assert a["Description"].startswith("Failed, SIP CANCEL Request sent")
    assert a["SetupTime_s"] is None and a["SetupTimeSentinel"] is True
    assert a["SIPINVITECode"] == "Session Progress"
    assert a["radioWindow"]["applies"] and not a["radioWindow"]["outsideCall"]
    assert a["radioWindow"]["native"] == {"rsrp": -118.05, "rsrq": -19.58, "sinr": -12.75, "n": 8}


def test_call_analysis_disconnect_outside_call(client, db_name):
    w = _get(client, db_name, "/api/call_analysis", session_id=OUTSIDE_SID)["a"]["radioWindow"]
    assert w["outsideCall"] and w["overshootMs"] == 43242
    assert w["native"]["rsrp"] is None
    assert (w["fixed"]["rsrp"], w["fixed"]["sinr"], w["fixed"]["n"]) == (-131.0, -14.0, 8)


def test_call_analysis_unclassified(client, db_name):
    body = _get(client, db_name, "/api/call_analysis", session_id=UNCLASSIFIED_SID)
    assert body["a"]["code"] == "S" and "System Release" in body["a"]["UnclassifiedReason"]
    assert body["b"]["code"] == "I" and "Landunit" in body["b"]["UnclassifiedReason"]


def test_side_comparison_has_scene_description(client, db_name):
    rows = _get(client, db_name, "/api/call_side_comparison", session_id=A_SID)["comparison"]
    by_side = {r["Side"]: r for r in rows}
    assert by_side["A"]["descriptionGroup"] == "Poor Signal"
    assert by_side["A"]["unclassifiedReason"] is None
    rows = _get(client, db_name, "/api/call_side_comparison", session_id=UNCLASSIFIED_SID)["comparison"]
    assert "Landunit" in {r["Side"]: r for r in rows}["B"]["unclassifiedReason"]


def test_kpi_tile_setup_time_seconds(client, db_name):
    # Failed κλήση: η σημαία 99.9 δεν είναι χρόνος -> null (παλιά: 0.1 από το "/ 1000").
    assert _get(client, db_name, "/api/call_kpi_tile", session_id=A_SID)["SetupTime_s"] is None


def test_speech_samples_and_time_domain(client, db_name):
    body = _get(client, db_name, "/api/speech_samples", session_id="8589934596")
    assert len(body["samples"]) == 8
    assert body["summary"]["A"]["SampleCount"] == 4 and body["summary"]["B"]["SampleCount"] == 4
    test_id = body["samples"][0]["TestId"]
    points = _get(client, db_name, "/api/speech_time_domain", session_id="8589934596", test_id=str(test_id))["points"]
    assert len(points) == 473


def test_speech_time_domain_rejects_foreign_test(client, db_name):
    # Test άλλης κλήσης -> κανένα σημείο (φιλτράρεται με τα sessions του ζεύγους).
    assert _get(client, db_name, "/api/speech_time_domain", session_id=A_SID, test_id="8589934593")["points"] == []
