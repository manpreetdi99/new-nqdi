"""Unit tests (χωρίς βάση) για routers/call_analysis."""
import datetime

from routers.call_analysis import (
    CA_COLUMNS,
    CA_GROUPS,
    _COMPUTED_KEYS,
    parse_call_cause,
    radio_window,
    setup_time_value,
    speech_summary,
    unclassified_reason,
)


# --- setup time ---------------------------------------------------------------

def test_setup_time_sentinel_is_none():
    assert setup_time_value(99.9000015258789) is None
    assert setup_time_value(None) is None


def test_setup_time_seconds_kept():
    assert setup_time_value(4.514) == 4.514
    assert setup_time_value(99.0) == 99.0


# --- callCause ----------------------------------------------------------------

def test_cause_suffix_from_post_import():
    assert parse_call_cause("Stop Call; Normal call clearing (Cause: 16)") == {
        "raw": "Stop Call; Normal call clearing (Cause: 16)",
        "base": "Stop Call", "causeText": "Normal call clearing", "causeCode": 16,
    }


def test_cause_suffix_without_base():
    r = parse_call_cause("; Normal, unspecified (Cause: 31)")
    assert (r["base"], r["causeText"], r["causeCode"]) == (None, "Normal, unspecified", 31)


def test_cause_prefix_from_mf():
    r = parse_call_cause("Cause :16 (Normal event: normal call clearing)")
    assert (r["base"], r["causeText"], r["causeCode"]) == (None, "Normal event: normal call clearing", 16)


def test_cause_plain_and_empty():
    assert parse_call_cause("Call Setup Timeout")["base"] == "Call Setup Timeout"
    assert parse_call_cause("Call Setup Timeout")["causeCode"] is None
    assert parse_call_cause("")["raw"] is None
    assert parse_call_cause(None)["raw"] is None


# --- unclassified -------------------------------------------------------------

def test_unclassified_landunit():
    reason = unclassified_reason("I", "Completed", "B", "Landunit")
    assert "Landunit" in reason and "Phone" in reason


def test_unclassified_system_release():
    assert "System Release" in unclassified_reason("S", "System Release", "A", "Phone")


def test_classified_has_no_reason():
    assert unclassified_reason("C3.120", "Failed", "A", "Phone") is None
    assert unclassified_reason("I", "Completed", "A", "Phone") == "Δεν πέρασε από τον native classifier (code I)"


# --- groups -------------------------------------------------------------------

def test_group_keys_unique():
    keys = [k for _, cols, _ in CA_GROUPS for k in cols]
    assert len(keys) == len(set(keys))


def test_columns_exclude_computed():
    assert not set(CA_COLUMNS) & _COMPUTED_KEYS
    assert "callDisconnectTimeStamp" in CA_COLUMNS and "avgLTERSRP" in CA_COLUMNS


# --- radio window -------------------------------------------------------------

T0 = datetime.datetime(2026, 9, 22, 19, 25, 22, 479000)


def test_radio_window_outside_call():
    w = radio_window({
        "callStatus": "Dropped",
        "callDisconnectTimeStamp": T0 + datetime.timedelta(milliseconds=43242),
        "SessionEnd": T0, "DisconnectFixed": T0,
        "avgLTERSRP": None, "numOfLTERadioValues": None,
        "FixedLTERSRP": -131.0, "FixedLTESINR": -14.0, "FixedNumLTE": 8,
    })
    assert w["applies"] and w["outsideCall"]
    assert w["overshootMs"] == 43242
    assert w["fixed"] == {"rsrp": -131.0, "rsrq": None, "sinr": -14.0, "n": 8}


def test_radio_window_inside_and_completed():
    inside = radio_window({"callStatus": "Failed", "callDisconnectTimeStamp": T0,
                           "SessionEnd": T0 + datetime.timedelta(seconds=1), "avgLTERSRP": -118.05})
    assert inside["applies"] and not inside["outsideCall"] and inside["fixed"] is None
    assert inside["native"]["rsrp"] == -118.05
    completed = radio_window({"callStatus": "Completed", "callDisconnectTimeStamp": T0 + datetime.timedelta(seconds=5),
                              "SessionEnd": T0})
    assert not completed["applies"] and not completed["outsideCall"]


# --- speech summary -----------------------------------------------------------

def test_speech_summary_per_side():
    samples = [
        {"Side": "A", "LQ": 3.0, "IPAudioRTT": 50.0, "LQIsBad": 0, "SilentCount": 0},
        {"Side": "A", "LQ": 2.0, "IPAudioRTT": None, "LQIsBad": 1, "SilentCount": 1},
        {"Side": "B", "LQ": None},
    ]
    s = speech_summary(samples)
    assert s["A"]["SampleCount"] == 2 and s["A"]["LQ"] == 2.5 and s["A"]["MinLQ"] == 2.0
    assert s["A"]["IPAudioRTT"] == 50.0
    assert s["A"]["BadCount"] == 1 and s["A"]["SilentCount"] == 1
    assert s["B"]["SampleCount"] == 1 and s["B"]["LQ"] is None and s["B"]["MinLQ"] is None
