"""Unit tests (χωρίς βάση) για call_pairs και routers/call_detail_native."""
import pytest
from fastapi import HTTPException

from call_pairs import pair_sides, parse_capability_fields
from routers.call_detail_native import (
    CDR_CALL_COLUMNS,
    CDR_SIDE_COLUMNS,
    EVENT_TOP_GROUPS,
    MARKER_TYPES,
    parse_whitelist,
    pcap_safe_name,
    split_cdr_row,
    summarize_rtp,
)

SAMPLE_FIELDS = (
    "Rat type=eutra|Release=rel15|Category=rel1450(DL): 20| =rel1430(UL): 18"
    "|EUTRA Bands=1; 3; 7; 8; 20; 28; 38; 39|EN-DC Support=supported"
    "|EN-DC Bands=n1; n3; n5"
)


# --- parse_capability_fields ------------------------------------------------

def test_capability_basic_keys_in_order():
    items = parse_capability_fields(SAMPLE_FIELDS)
    assert [i["key"] for i in items] == [
        "Rat type", "Release", "Category", "EUTRA Bands", "EN-DC Support", "EN-DC Bands"]
    assert items[0]["values"] == ["eutra"]
    assert items[4]["values"] == ["supported"]


def test_capability_empty_key_continues_previous():
    category = parse_capability_fields(SAMPLE_FIELDS)[2]
    assert category["values"] == ["rel1450(DL): 20", "rel1430(UL): 18"]
    assert category["raw"] == "Category=rel1450(DL): 20| =rel1430(UL): 18"


def test_capability_semicolon_values_become_list():
    items = {i["key"]: i for i in parse_capability_fields(SAMPLE_FIELDS)}
    assert items["EUTRA Bands"]["values"] == [["1", "3", "7", "8", "20", "28", "38", "39"]]
    assert items["EN-DC Bands"]["values"] == [["n1", "n3", "n5"]]


def test_capability_splits_on_first_equals_only():
    assert parse_capability_fields("A=b=c")[0]["values"] == ["b=c"]


def test_capability_raw_roundtrip():
    items = parse_capability_fields(SAMPLE_FIELDS)
    assert "|".join(i["raw"] for i in items) == SAMPLE_FIELDS


def test_capability_empty_and_odd_input():
    assert parse_capability_fields(None) == []
    assert parse_capability_fields("") == []
    # segment χωρίς '=' -> key χωρίς τιμή, όχι μαντεψιά
    assert parse_capability_fields("A=1|weird|") == [
        {"key": "A", "values": ["1"], "raw": "A=1"},
        {"key": "weird", "values": [], "raw": "weird"},
    ]
    # συνέχεια χωρίς προηγούμενο key -> δικό της item με κενό key
    assert parse_capability_fields(" =x")[0] == {"key": "", "values": ["x"], "raw": " =x"}


# --- PCAP safe_name -----------------------------------------------------------

@pytest.mark.parametrize("name, expected", [
    ("2026-09-21-09-08-24-1111-2303-5166-1033-A0101.pcap",
     "2026-09-21-09-08-24-1111-2303-5166-1033-A0101.pcap"),
    ("trace file.pcap", "trace_file.pcap"),
    ('a"; rm -rf /.pcap', "a___rm_-rf__.pcap"),
    ("../../etc/passwd", "etc_passwd.pcap"),
    ("καταγραφή.cap", "cap.pcap"),
    ("capture.PCAP", "capture.PCAP"),
    (None, "session_123.pcap"),
    ("", "session_123.pcap"),
    ("....", "session_123.pcap"),
])
def test_pcap_safe_name(name, expected):
    out = pcap_safe_name(name, "123")
    assert out == expected
    assert all(ch.isascii() and (ch.isalnum() or ch in "._-") for ch in out)
    assert out.lower().endswith(".pcap")


def test_pcap_safe_name_length_capped():
    assert len(pcap_safe_name("x" * 500, 1)) <= 205


# --- whitelists ---------------------------------------------------------------

def test_groups_whitelist_accepts_and_dedupes():
    assert parse_whitelist(" RRM,Voice Service ,RRM,", EVENT_TOP_GROUPS, "groups") == [
        "RRM", "Voice Service"]


@pytest.mark.parametrize("value", [
    "Voice Service,Bogus", "rrm", "RRM'); DROP TABLE x;--", "", " , "])
def test_groups_whitelist_rejects(value):
    with pytest.raises(HTTPException) as exc:
        parse_whitelist(value, EVENT_TOP_GROUPS, "groups")
    assert exc.value.status_code == 400


def test_types_whitelist():
    assert parse_whitelist("Call Marker,Test Borders", MARKER_TYPES, "types") == [
        "Call Marker", "Test Borders"]
    with pytest.raises(HTTPException) as exc:
        parse_whitelist("Call Marker,Nope", MARKER_TYPES, "types")
    assert exc.value.status_code == 400


def test_events_endpoint_rejects_bad_group_before_db(client):
    r = client.get("/api/call_events",
                   params={"database": "x", "session_id": "1", "groups": "Nope"})
    assert r.status_code == 400


def test_markers_endpoint_rejects_bad_type_before_db(client):
    r = client.get("/api/call_markers_v2",
                   params={"database": "x", "session_id": "1", "types": "Nope"})
    assert r.status_code == 400


# --- CDR split A/B --------------------------------------------------------------

def test_cdr_each_native_column_mapped_once():
    natives = [c for _, a, b in CDR_SIDE_COLUMNS for c in (a, b)] + CDR_CALL_COLUMNS
    assert len(natives) == len(set(natives))


def test_cdr_keys_unique_and_side_suffixes():
    keys = [k for k, _, _ in CDR_SIDE_COLUMNS]
    assert len(keys) == len(set(keys))
    for _, col_a, col_b in CDR_SIDE_COLUMNS:
        assert col_a.endswith("A"), col_a
        assert col_b.endswith("B"), col_b


def test_cdr_known_irregular_names():
    by_key = {k: (a, b) for k, a, b in CDR_SIDE_COLUMNS}
    assert by_key["InternalStatus"] == ("InternalStatusA", "internalStatusB")
    assert by_key["SsbIndex"] == ("SsbIndexA", "SSBIndexB")
    assert by_key["CsfbScBsic"] == ("CsbScBsciA", "CsfbScBsicB")
    assert by_key["CsfbRscpRxLev"] == ("CsfbRsrcpRxLevA", "CsfbRscpRxLevB")


def test_split_cdr_row_no_loss_no_duplicates():
    row = {}
    for i, (_, a, b) in enumerate(CDR_SIDE_COLUMNS):
        row[a] = f"a{i}"
        row[b] = f"b{i}"
    for col in CDR_CALL_COLUMNS:
        row[col] = col
    out = split_cdr_row(row)
    assert set(out) == {"call", "a", "b"}
    assert set(out["a"]) == set(out["b"]) == {k for k, _, _ in CDR_SIDE_COLUMNS}
    assert out["call"] == {c: c for c in CDR_CALL_COLUMNS}
    # κάθε τιμή του row εμφανίζεται ακριβώς μία φορά στο output
    values = list(out["call"].values()) + list(out["a"].values()) + list(out["b"].values())
    assert sorted(values) == sorted(row.values())


# --- pair / RTP helpers ---------------------------------------------------------

def test_pair_sides():
    assert pair_sides(None) == {}
    assert pair_sides({"ASessionId": 1, "BSessionId": 2}) == {1: "A", 2: "B"}
    assert pair_sides({"ASessionId": 1, "BSessionId": None}) == {1: "A"}
    assert pair_sides({"ASessionId": 1, "BSessionId": 1}) == {1: "A"}


def test_summarize_rtp():
    samples = [
        {"AvgJitter": 1, "PacketLossRate": None, "NumPackets": 10, "Mode": "m", "Codec": "c",
         "PayloadType": 1, "SSRC": "x", "SIP Call Access": None},
        {"AvgJitter": 2, "PacketLossRate": 0.5, "NumPackets": 20, "Mode": "m", "Codec": "c",
         "PayloadType": 1, "SSRC": "x", "SIP Call Access": 300},
    ]
    s = summarize_rtp(samples)
    assert s["AvgJitter"] == 1.5          # float AVG, όχι integer division
    assert s["PacketLossRate"] == 0.5     # NULL εκτός μέσου όρου
    assert s["NumPackets"] == 30
    assert s["streams"] == [{"Mode": "m", "Codec": "c", "PayloadType": 1, "SSRC": "x"}]
    assert s["SIP Call Access"] == 300
    assert summarize_rtp([])["AvgJitter"] is None
