#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rrc_decode.py
-----------------------------------------------------------------------------
1) Backend helper: decodes the hex-encoded LTE RRC UL-DCCH MeasurementReport
   PDUs stored in FactL3Messages.Message into RSRP/RSRQ values, so the
   frontend never has to render raw hex for these rows.
   (3GPP TS 36.331 UL-DCCH-Message, UPER-encoded; TS 36.133 index mappings.)

2) Γενικός αποκωδικοποιητής hex payloads από drive-test logs
   (LTE-RRC, LTE-NAS, 5G NR RRC, IMS SIP)

Χρήση (CLI):
    python3 rrc_decode.py <ΤΥΠΟΣ_ΜΗΝΥΜΑΤΟΣ> <HEX>
    python3 rrc_decode.py --file log.txt        # μαζική αποκωδικοποίηση tab-separated log

Παραδείγματα:
    python3 rrc_decode.py DCCH-RRCConnectionReconfiguration 24068405293D...
    python3 rrc_decode.py "EMM-Service request" C7481A29
    python3 rrc_decode.py SIP 494E56495445...

Απαιτεί: pip install pycrate
-----------------------------------------------------------------------------
"""

import re
import sys
import threading
from binascii import unhexlify

from pycrate_asn1dir import RRCLTE

LTE = RRCLTE.EUTRA_RRC_Definitions

_UL_DCCH = LTE.UL_DCCH_Message

_HEX_RE_CHARS = set("0123456789abcdefABCDEF")

# pycrate ASN.1 objects are module-level singletons; FastAPI serves requests from a
# threadpool, so concurrent decodes on the same object would corrupt each other.
_DECODE_LOCK = threading.Lock()


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


# ---------------------------------------------------------------------------
# GSM Measurement Report — TS 44.018 §9.1.21 + Measurement Results IE §10.5.2.20.
# Compact RxLev/RxQual one-liner for the L3 log, same idea as the LTE
# MeasurementReport summary above (it's the highest-volume GSM dedicated-channel
# message, so the one-liner reads much better than the full field dump).
# ---------------------------------------------------------------------------

def rxlev_dbm(rxlev: int) -> int:
    # RXLEV 0..63 -> dBm: 0 => <-110, 63 => >-48
    return rxlev - 110


def rxqual_ber(q: int) -> float | None:
    # RXQUAL 0..7 -> approx BER % midpoints (TS 45.008)
    return [0.14, 0.28, 0.57, 1.13, 2.26, 4.53, 9.05, 18.10][q] if 0 <= q <= 7 else None


def decode_gsm_meas_report(msg: str) -> dict | None:
    """GSM RR Measurement Report -> dict, or None if it doesn't parse.

    Input is the FactL3Messages format: direction letter + zero padding +
    PD/TI (06) + MsgType (15) + Measurement Results IE octets.
    """
    s = (msg or "").strip()
    if s[:1].upper() in ("D", "U"):
        s = s[1:]
    if len(s) % 2:  # stray trailing nibble, same as _decode_gsm_row
        s = s[:-1]
    b = _hex_to_bytes(s)
    if b is None:
        return None
    b = b.lstrip(b"\x00")
    # RR protocol discriminator + Measurement Report message type, then the IE
    if len(b) < 6 or b[0] & 0x0F != 0x06 or b[1] != 0x15:
        return None
    o = b[2:]
    if len(o) < 4:
        return None

    # octet 1
    ba_used     = (o[0] >> 7) & 1
    dtx_used    = (o[0] >> 6) & 1
    rxlev_full  =  o[0] & 0x3F
    # octet 2
    ba3g_used   = (o[1] >> 7) & 1
    meas_valid  = (o[1] >> 6) & 1              # 0 = results valid
    rxlev_sub   =  o[1] & 0x3F
    # octet 3
    rxqual_full = (o[2] >> 4) & 0x07
    rxqual_sub  = (o[2] >> 1) & 0x07
    # NO-NCELL-M: 3 bits = octet3 b1 (MSB) + octet4 b8,b7
    no_ncell    = ((o[2] & 0x01) << 2) | ((o[3] >> 6) & 0x03)

    # neighbour bitstream: octet4 onward, top 2 bits already consumed by NO-NCELL-M
    bits = []
    for by in o[3:]:
        for i in range(7, -1, -1):
            bits.append((by >> i) & 1)
    pos = 2

    def take(n):
        nonlocal pos
        v = 0
        for _ in range(n):
            if pos >= len(bits):
                return None
            v = (v << 1) | bits[pos]
            pos += 1
        return v

    neighbours = []
    count = no_ncell if no_ncell != 7 else 0   # 7 = "no neighbour info"
    for _ in range(min(count, 6)):
        rl = take(6); bcch = take(5); bsic = take(6)
        if rl is None or bcch is None or bsic is None:
            break
        neighbours.append({
            "rxlev": rl, "rxlev_dbm": rxlev_dbm(rl),
            "bcch_freq_idx": bcch, "bsic": bsic,
        })

    return {
        "ba_used": ba_used, "ba3g_used": ba3g_used, "dtx_used": dtx_used,
        "meas_valid": meas_valid == 0,
        "rxlev_full": rxlev_full, "rxlev_full_dbm": rxlev_dbm(rxlev_full),
        "rxlev_sub":  rxlev_sub,  "rxlev_sub_dbm":  rxlev_dbm(rxlev_sub),
        "rxqual_full": rxqual_full, "rxqual_full_ber": rxqual_ber(rxqual_full),
        "rxqual_sub":  rxqual_sub,  "rxqual_sub_ber":  rxqual_ber(rxqual_sub),
        "no_ncell": no_ncell,
        "neighbours": neighbours,
    }


def format_gsm_meas_report(d: dict) -> str:
    """Human-readable one-liner for the L3 log's Message column."""
    parts = [
        f"RxLev full {d['rxlev_full_dbm']}dBm / sub {d['rxlev_sub_dbm']}dBm",
        f"RxQual full {d['rxqual_full']} / sub {d['rxqual_sub']}"
        + (f" (~{d['rxqual_sub_ber']}% BER)" if d["rxqual_sub_ber"] else ""),
    ]
    if d["dtx_used"]:
        parts.append("DTX")
    if not d["meas_valid"]:
        parts.append("MEAS-INVALID")
    for n in d["neighbours"]:
        parts.append(f"NCell idx{n['bcch_freq_idx']} {n['rxlev_dbm']}dBm BSIC{n['bsic']}")
    return "; ".join(parts)


def is_gsm_measurement_report(technology: str | None, simple_msg_name: str | None, msg_name: str | None) -> bool:
    if (technology or "").strip().upper() != "GSM":
        return False
    name = (simple_msg_name or msg_name or "").strip().lower()
    return name == "measurement report"


# ---------------------------------------------------------------------------
# Full-row decoding for the L3 log: FactL3Messages stores raw hex payloads for
# every protocol; each helper below turns one family into readable text.
# Values observed in FactL3Messages:
#   Layer: LTE-RRC, LTE-NAS, 5GNR-RRC, SIP, RR/MM/CC/GMM/SM/GPRS RLC/MAC (GSM)
#   Direction: 'U' / 'D'
#   MsgName: 'DCCH-…', 'CCCH-…', 'BCCH:SCH-…', 'PCCH-Paging', 'EMM-…', 'ESM-…',
#            'IE-…' (NR standalone IEs), GSM plain names.
# GSM payloads are prefixed with the direction letter ('D'/'U') + zero padding
# before the standard L3 bytes.
# ---------------------------------------------------------------------------

def _hex_to_bytes(s: str | None) -> bytes | None:
    s = (s or "").strip()
    if len(s) >= 2 and len(s) % 2 == 0 and all(c in _HEX_RE_CHARS for c in s):
        return unhexlify(s)
    return None


def _asn1_result(cont, data: bytes) -> str | None:
    """UPER-decode `data` into `cont` and return cleaned ASN.1 text.

    pycrate's from_uper can "succeed" on a wrong container by consuming almost
    nothing (all-optional SEQUENCE -> '{ }'), so a large payload that yields a
    tiny text is treated as a failed decode.
    """
    with _DECODE_LOCK:
        cont.from_uper(data)
        txt = cont.to_asn1().strip()
    if txt.startswith("{") and txt.endswith("}"):
        txt = txt[1:-1].strip()
    if not txt or (len(data) >= 8 and len(txt) < 20):
        return None
    return txt


def _decode_lte_rrc_row(msg_name: str, direction: str, data: bytes) -> str | None:
    cont = pick_container(msg_name, direction)
    if cont is None:
        return None
    try:
        return _asn1_result(cont, data)
    except Exception:
        return None


def _nr_defs():
    from pycrate_asn1dir import RRCNR
    return RRCNR.NR_RRC_Definitions


def _decode_nr_rrc_row(msg_name: str, direction: str, data: bytes) -> str | None:
    m = msg_name.upper()
    d = (direction or "").upper()
    try:
        NR = _nr_defs()
        if m.startswith("IE-"):
            # Standalone NR PDUs carried inside LTE RRC containers (EN-DC), e.g.
            # IE-RRCReconfiguration, IE-RadioBearerConfig, IE-MeasResultSCG-Failure.
            name = msg_name[3:].replace("-", "_")
            cont = getattr(NR, name, None)
            if cont is None:
                return None
        elif "BCCH:BCH" in m or m == "MIB":
            cont = NR.BCCH_BCH_Message
        elif m.startswith("BCCH"):
            cont = NR.BCCH_DL_SCH_Message
        elif m.startswith("PCCH"):
            cont = NR.PCCH_Message
        elif m.startswith("CCCH"):
            cont = NR.UL_CCCH_Message if d == "U" else NR.DL_CCCH_Message
        elif m.startswith("DCCH"):
            cont = NR.UL_DCCH_Message if d == "U" else NR.DL_DCCH_Message
        else:
            return None
        return _asn1_result(cont, data)
    except Exception:
        return None


def _decode_nas_row(direction: str, data: bytes) -> str | None:
    """LTE NAS (EMM/ESM). If ciphered, pycrate still shows the security header.

    The log's Direction flag is occasionally wrong for NAS rows, so fall back to
    the opposite-direction parser before giving up.
    """
    try:
        from pycrate_mobile import NAS
        mo_first = (direction or "").upper() == "U"
        fns = (NAS.parse_NAS_MO, NAS.parse_NAS_MT) if mo_first else (NAS.parse_NAS_MT, NAS.parse_NAS_MO)
        with _DECODE_LOCK:
            for fn in fns:
                msg, err = fn(data)
                if msg is not None:
                    return msg.show()
        return None
    except Exception:
        return None


def _decode_sip_row(data: bytes) -> str | None:
    try:
        txt = data.decode("utf-8", errors="replace")
    except Exception:
        return None
    # Sanity check: real SIP text, not arbitrary binary that happened to decode.
    return txt.replace("\r\n", "\n") if txt[:12].isascii() else None


def _decode_gsm_row(direction: str, message: str | None) -> str | None:
    """GSM L3 (RR/MM/CC/GMM/SM). Payload = direction letter + zero padding + L3 bytes."""
    s = (message or "").strip()
    if s[:1].upper() in ("D", "U"):
        s = s[1:]
    if len(s) % 2:  # some GSM exports carry a stray trailing nibble
        s = s[:-1]
    data = _hex_to_bytes(s)
    if data is None:
        return None
    data = data.lstrip(b"\x00")
    if len(data) < 2:
        return None
    # Low nibble of the first octet is the protocol discriminator (TS 24.007);
    # GPRS RLC/MAC control blocks are not L3 and won't parse — skip them.
    if data[0] & 0x0F not in (0x3, 0x5, 0x6, 0x8, 0x9, 0xA, 0xB):
        return None
    try:
        from pycrate_mobile import NAS
        fn = NAS.parse_NAS_MO if (direction or "").upper() == "U" else NAS.parse_NAS_MT
        with _DECODE_LOCK:
            msg, err = fn(data)
            if msg is not None:
                return msg.show()
        # Broadcast/paging RR (System Information, Paging Request, Immediate
        # Assignment) aren't in the DCCH dispatch used by parse_NAS_*: they carry
        # an L2 pseudo-length octet that the log strips — resynthesize it and
        # parse with the BCCH class map.
        if data[0] & 0x0F == 0x6:
            from pycrate_mobile import TS44018_RR
            cls = TS44018_RR.RRBCCHTypeClasses.get(data[1])
            if cls is not None:
                buf = bytes([((min(len(data), 22) & 0x3F) << 2) | 0x01]) + data
                with _DECODE_LOCK:
                    m = cls()
                    m.from_bytes(buf)
                    return m.show()
        return None
    except Exception:
        return None


def decode_l3_row(technology: str | None, layer: str | None, direction: str | None,
                  msg_name: str | None, simple_msg_name: str | None,
                  message: str | None) -> str | None:
    """Decodes one FactL3Messages row's hex payload into readable text, else None.

    LTE MeasurementReport keeps its compact RSRP/RSRQ one-liner; everything else
    gets the full decoded message text.
    """
    # Compact summary for LTE MeasurementReport (high-volume; the one-liner reads better)
    summary = decode_row_message(technology, simple_msg_name, msg_name, message)
    if summary is not None:
        return summary

    lay = (layer or "").strip().upper()
    tech = (technology or "").strip().upper()
    mname = (msg_name or simple_msg_name or "")
    d = (direction or "").strip().upper()

    if tech == "GSM":
        # Compact one-liner for GSM Measurement Report, like the LTE one above
        if is_gsm_measurement_report(technology, simple_msg_name, msg_name):
            g = decode_gsm_meas_report(message)
            if g is not None:
                return format_gsm_meas_report(g)
        return _decode_gsm_row(d, message)

    data = _hex_to_bytes(message)
    if data is None:
        return None

    if lay == "SIP" or "SIP" in mname.upper():
        return _decode_sip_row(data)
    if lay == "LTE-NAS" or mname.upper().startswith(("EMM", "ESM")):
        return _decode_nas_row(d, data)
    if lay == "5GNR-RRC" or tech in ("5G NR", "NR", "5G"):
        return _decode_nr_rrc_row(mname, d, data)
    if lay == "LTE-RRC" or tech == "LTE":
        return _decode_lte_rrc_row(mname, d, data)
    return None


# ---------------------------------------------------------------------------
# Γενικός αποκωδικοποιητής (LTE-RRC, LTE-NAS, 5G NR RRC, IMS SIP)
# Αντιστοίχιση: όνομα μηνύματος στο log -> (ASN.1 container, direction)
# Το κανάλι καθορίζει ποιο top-level ASN.1 message χρησιμοποιείται.
# ---------------------------------------------------------------------------
def pick_container(msg_type: str, direction: str):
    """Επιστρέφει το σωστό pycrate ASN.1 object για τον τύπο μηνύματος."""
    m = msg_type.upper()
    d = (direction or "").upper()

    if m.startswith("PCCH"):
        return LTE.PCCH_Message
    if "BCCH:BCH" in m or "BCH-MASTERINFORMATIONBLOCK" in m or m == "MIB":
        return LTE.BCCH_BCH_Message
    if m.startswith("BCCH"):                      # SIB1 / SI
        return LTE.BCCH_DL_SCH_Message
    if m.startswith("CCCH"):
        # RRCConnectionRequest / ReestablishmentRequest = uplink,
        # Setup / Reject / ReestablishmentReject = downlink
        if d == "U" or "REQUEST" in m:
            return LTE.UL_CCCH_Message
        return LTE.DL_CCCH_Message
    if m.startswith("DCCH"):
        if d == "U" or any(k in m for k in
              ("COMPLETE", "MEASUREMENTREPORT", "ULINFORMATION", "UEINFORMATIONRESPONSE")):
            return LTE.UL_DCCH_Message
        return LTE.DL_DCCH_Message
    return None


def decode_rrc(msg_type: str, direction: str, hexstr: str) -> str:
    cont = pick_container(msg_type, direction)
    if cont is None:
        return f"[?] Άγνωστο κανάλι για '{msg_type}'"
    try:
        cont.from_uper(bytes.fromhex(hexstr))
        return cont.to_asn1()
    except Exception as e:
        return f"[!] Αποτυχία UPER decode ({e})"


def decode_nr_mib(hexstr: str) -> str:
    # Lazy import: το NR ASN.1 tree είναι μεγάλο και δεν χρειάζεται στο backend path.
    from pycrate_asn1dir import RRCNR
    m = RRCNR.NR_RRC_Definitions.BCCH_BCH_Message
    m.from_uper(bytes.fromhex(hexstr))
    return m.to_asn1()


def decode_nas(hexstr: str, direction: str) -> str:
    """LTE NAS (EMM/ESM). Uplink=MO, Downlink=MT. Αν είναι ciphered βγάζει μόνο header."""
    from pycrate_mobile import NAS
    buf = bytes.fromhex(hexstr)
    fn = NAS.parse_NAS_MO if (direction or "").upper() == "U" else NAS.parse_NAS_MT
    msg, err = fn(buf)
    out = msg.show() if msg is not None else ""
    if err:
        out += f"\n[!] err={err} (πιθανώς ciphered/truncated)"
    return out


def decode_sip(hexstr: str) -> str:
    return bytes.fromhex(hexstr).decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Ενιαίο entry point ανά γραμμή log
# ---------------------------------------------------------------------------
def decode_any(protocol: str, direction: str, msg_type: str, hexstr: str) -> str:
    hexstr = re.sub(r"\s+", "", hexstr)
    if not re.fullmatch(r"[0-9A-Fa-f]+", hexstr or ""):
        return "[i] Δεν είναι hex payload (π.χ. ήδη αποκωδικοποιημένο MeasurementReport) — skip"
    p = (protocol or "").upper()
    if "SIP" in p or "SIP" in msg_type.upper():
        return decode_sip(hexstr)
    if "NAS" in p or msg_type.upper().startswith(("EMM", "ESM")):
        return decode_nas(hexstr, direction)
    if "5G" in p or "NR" in p.replace("LTE", ""):
        return decode_nr_mib(hexstr)
    return decode_rrc(msg_type, direction, hexstr)


def decode_logfile(path: str, only_type: str | None = None):
    """Περνάει ένα tab-separated log (όπως το export σου) και αποκωδικοποιεί ό,τι μπορεί.
    Αναμενόμενες στήλες: phase, time, offset, tech, protocol, dir, msg_type, pci, earfcn, extra, hex
    """
    with open(path, encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 11:
                continue
            _, t, off, tech, proto, d, mtype, pci, earfcn, _, hexpl = cols[:11]
            if only_type and only_type.lower() not in mtype.lower():
                continue
            print("=" * 100)
            print(f"[{ln}] {t} {off}  {proto} {d}  {mtype}  PCI={pci} EARFCN={earfcn}")
            print("-" * 100)
            print(decode_any(proto, d, mtype, hexpl))


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(0)
    if args[0] == "--file":
        decode_logfile(args[1], args[2] if len(args) > 2 else None)
    else:
        mtype, hexstr = args[0], args[1]
        direction = args[2] if len(args) > 2 else ("U" if "Complete" in mtype or "Report" in mtype else "D")
        proto = "SIP" if mtype.upper() == "SIP" else ("NAS" if mtype.upper().startswith(("EMM","ESM")) else "RRC")
        print(decode_any(proto, direction, mtype, hexstr))
