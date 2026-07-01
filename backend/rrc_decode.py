"""
rrc_decode.py
-----------------------------------------------------------------------------
Decodes the hex-encoded LTE RRC UL-DCCH MeasurementReport PDUs stored in
FactL3Messages.Message into RSRP/RSRQ values, so the frontend never has to
render raw hex for these rows.

3GPP TS 36.331 UL-DCCH-Message, UPER-encoded; 3GPP TS 36.133 index mappings.
-----------------------------------------------------------------------------
"""

from binascii import unhexlify

from pycrate_asn1dir import RRCLTE

_UL_DCCH = RRCLTE.EUTRA_RRC_Definitions.UL_DCCH_Message

_HEX_RE_CHARS = set("0123456789abcdefABCDEF")


def _rsrp_dbm(v):
    if v is None:
        return None
    if v == 0:
        return -140.0
    if v == 97:
        return -44.0
    return v - 141


def _rsrq_db(v):
    if v is None:
        return None
    if v == 0:
        return -19.5
    if v == 34:
        return -3.0
    return -20.0 + 0.5 * v


def is_lte_measurement_report(technology: str | None, simple_msg_name: str | None, msg_name: str | None) -> bool:
    # GSM has its own "Measurement Report" (RR, not UL-DCCH) and 5G NR has its own RRC PDU —
    # only LTE MeasurementReport actually matches the UL_DCCH_Message ASN.1 definition below.
    if (technology or "").strip().upper() != "LTE":
        return False
    name = (simple_msg_name or msg_name or "").lower()
    return "measurementreport" in name.replace(" ", "")


def decode_meas_report(hex_str: str) -> dict | None:
    """UL-DCCH MeasurementReport hex -> RSRP/RSRQ dict, or None if it doesn't decode."""
    hex_str = (hex_str or "").strip()
    if not hex_str or len(hex_str) % 2 != 0 or not all(c in _HEX_RE_CHARS for c in hex_str):
        return None

    try:
        _UL_DCCH.from_uper(unhexlify(hex_str))
        v = _UL_DCCH()

        _, c1 = v["message"]
        _, mr = c1
        _, root = mr["criticalExtensions"]
        _, body = root
        mrs = body["measResults"]

        pc = mrs["measResultPCell"]
        rp = pc.get("rsrpResult")
        rq = pc.get("rsrqResult")

        result = {
            "measId": mrs.get("measId"),
            "pcellRsrpDbm": _rsrp_dbm(rp),
            "pcellRsrqDb": _rsrq_db(rq),
            "neighbours": [],
        }

        mrn = mrs.get("measResultNeighCells")
        if mrn:
            typ, lst = mrn
            if "EUTRA" in typ:
                for e in lst:
                    m = e["measResult"]
                    nr = m.get("rsrpResult")
                    nq = m.get("rsrqResult")
                    result["neighbours"].append({
                        "pci": e["physCellId"],
                        "rsrpDbm": _rsrp_dbm(nr),
                        "rsrqDb": _rsrq_db(nq),
                    })

        return result
    except Exception:
        return None


def format_meas_report(decoded: dict) -> str:
    """Human-readable one-liner for the L3 log's Message column."""
    parts = [f"PCell RSRP {decoded['pcellRsrpDbm']:.0f}dBm / RSRQ {decoded['pcellRsrqDb']:.1f}dB"]
    for n in decoded["neighbours"]:
        rsrp = f"{n['rsrpDbm']:.0f}dBm" if n["rsrpDbm"] is not None else "—"
        rsrq = f"{n['rsrqDb']:.1f}dB" if n["rsrqDb"] is not None else "—"
        parts.append(f"PCI{n['pci']} {rsrp}/{rsrq}")
    return "; ".join(parts)


def decode_row_message(technology: str | None, simple_msg_name: str | None, msg_name: str | None, message: str | None) -> str | None:
    """Returns a decoded human-readable Message for LTE MeasurementReport rows, else None."""
    if not is_lte_measurement_report(technology, simple_msg_name, msg_name):
        return None
    decoded = decode_meas_report(message)
    if decoded is None:
        return None
    return format_meas_report(decoded)
