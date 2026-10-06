"""Historic — οι σελίδες DATA / 5G / SCANNER του COSMOTE BENCHMARKING BI REPORT v12.pbix:

  [06] DATA-BROWSING             -> /api/historic/browsing
  [07] DNS                       -> /api/historic/dns
  [08] DATA-HTTP                 -> /api/historic/http
  [09] DATA-PING/OOKLA           -> /api/historic/ping_ookla
  [10] DATA-INTERACTIVITY        -> /api/historic/interactivity
  [11] DATA-CAPACITY             -> /api/historic/capacity
  [12] DATA-VIDEO                -> /api/historic/video_page
  [13] DATA-MAP / [23] DATA-MAP-UL -> /api/historic/data_map?direction=dl|ul
  [14] DATA-BANDWIDTH (BW pies)  -> /api/historic/bandwidth_mix   (τα scatter: historic_pages.py)
  [15] DATA-MAP NR               -> /api/historic/nr_map
  [16] NR DATA TECH + [17] NR DATA TECH/CA/BW -> /api/historic/nr_tech
  [18] / [19] NR SCANNER MAP 50m / 500m       -> /api/historic/nr_scanner_map?bin=50|500
  [20] SCANNER 4G-5G             -> /api/historic/scanner

Ίδιο φίλτρο με το historic_pages.py: Scope (υποχρεωτικό) + προαιρετικά GreaterArea / Category /
CollectionName, pooled πάνω σε όλα τα collections που ταιριάζουν. Κάθε measure αντιγράφει το
DAX του COSMOTE_BI_lineage_ana_selida_1.md· όπου ξεφεύγουμε, το σχόλιο το λέει.

Οι σελίδες [21] / [22] (MAP BOOKMARK M->F / M->M) είναι κρυφές στο view mode του report και
δείχνουν τα ίδια Dropped/Failed σημεία με τους χάρτες των σελίδων VOICE — δεν αντιγράφονται.
"""
from fastapi import APIRouter, HTTPException, Query

from db import get_connection
from routers.historic import _f, _operator_case, _pct
from routers.historic_pages import _LOCATION_OPERATOR, _OPERATORS, _fact_map, _in, _ok_operator, _selected

router = APIRouter(tags=["historic"])

# HomeOperator (groups) — Cosmote / Vodafone / Nova (+Wind).
_HOME_OP = _operator_case("HomeOperator")


def _page_names(scope, area, category, collection) -> list[str]:
    """Τα STR_ID που περνάνε τους slicers (από το BI_SCORES_TOTAL, όπως ο ALL INFO SYNCED FILTERS)."""
    conn = get_connection("BI_VOICE")
    try:
        return _selected(conn.cursor(), scope, area, category, collection)
    finally:
        conn.close()


# Οι πίνακες του BI_DATA / BI_SCANNER είναι heaps χωρίς indexes: ένα `IN (?, ?, …)` με
# εκατοντάδες nvarchar parameters πάνω σε varchar στήλη κάνει implicit conversion σε κάθε
# γραμμή (37 s στο BI_NR_DATA για ένα scope) — semi-join σε varchar temp table: ~5 s.
_KEYS = "(SELECT k FROM #keys)"


def _run(database, scope, area, category, collection, empty, build):
    """Κοινός σκελετός: slicers -> #keys (τα CollectionName των fact tables ΚΑΙ τα STR_ID, ώστε να
    ταιριάζουν και οι πίνακες με STR_ID όπως το BI_NR_DATA) -> build(cur)."""
    conn = None
    try:
        names = _page_names(scope, area, category, collection)
        if not names:
            return empty
        conn = get_connection(database)
        cur = conn.cursor()
        cur.execute("CREATE TABLE #keys (k VARCHAR(400) COLLATE DATABASE_DEFAULT)")
        cur.fast_executemany = True
        cur.executemany("INSERT INTO #keys (k) VALUES (?)", [(k,) for k in sorted(set(names) | set(_fact_map(names)))])
        cur.fast_executemany = False
        return build(cur)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


def _by_operator(rows, attr="operator"):
    return {getattr(row, attr): row for row in rows if _ok_operator(getattr(row, attr))}


def _percentiles(cur, table, op_expr, value_expr, q, where="", params=()):
    """PERCENTILE.INC (== PERCENTILE_CONT) ανά operator — τα NULL αγνοούνται όπως στο DAX."""
    cur.execute(
        f"""
        SELECT DISTINCT operator, PERCENTILE_CONT({q}) WITHIN GROUP (ORDER BY v) OVER (PARTITION BY operator) AS p
        FROM (
            SELECT {op_expr} AS operator, {value_expr} AS v
            FROM {table}
            WHERE CollectionName IN {_KEYS} {where}
        ) x
        WHERE v IS NOT NULL
        """,
        list(params),
    )
    return {row.operator: _f(row.p) for row in cur.fetchall() if _ok_operator(row.operator)}


def _mix(cur, sql, params, scale=1.0):
    """(operator, key, value) γραμμές -> HistoricMixRow[] για τα 100% stacked charts."""
    cur.execute(sql, params)
    out: dict[str, dict[str, float]] = {}
    for row in cur.fetchall():
        if not _ok_operator(row.operator) or row.k is None:
            continue
        parts = out.setdefault(row.operator, {})
        parts[str(row.k)] = parts.get(str(row.k), 0.0) + (_f(row.v) or 0.0) * scale
    return [
        {"operator": op, "parts": [{"key": k, "value": v, "mos": None} for k, v in out[op].items()]}
        for op in _OPERATORS
        if op in out
    ]


def _sample(points: list, limit: int) -> list:
    """Ομοιόμορφο δείγμα (κάθε n-οστό) — ντετερμινιστικό, ώστε το ίδιο φίλτρο να δίνει τον ίδιο χάρτη."""
    if len(points) <= limit:
        return points
    step = len(points) / limit
    return [points[int(i * step)] for i in range(limit)]


# ─────────────────────────────── [06] DATA-BROWSING ───────────────────────────────

# TestName (groups): τα δύο TestName slicers της σελίδας. Το group "Kepler" = HTTP Browser
# (Kepler), "Kepler (After 30 sec)" = HTTP Browser (Kepler_2)· το report δεν εξάγει τον ορισμό
# του group, αυτή η αντιστοίχιση βγαίνει από τις τιμές του warehouse.
_KEPLER_TESTS = ("HTTP Browser (Kepler)", "HTTP Browser (Kepler_2)", "HTTP Browser (Newton)")


@router.get("/api/historic/browsing")
def get_historic_browsing(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """06.1–06.3 (Kepler reference page: Kepler / Kepler after 30 s / Newton) και 06.4–06.6 (live
    web pages, όλα τα υπόλοιπα TestName):
      browing attempts_500kb = COUNT(TransferStatus) · BrowsingSuccessfulTests_500 = TransferStatus
      (groups) = "success" · Success Rate_500 = successful / attempts
      Avg TransferDuration (s), Avg TimetoFirstByte / TimetoFirst500b (ms) — visual filter Success.
    ΥΠΟΘΕΣΗ: TransferStatus (groups) "Success" = TransferStatus 'OK' (οι υπόλοιπες τιμές είναι
    όλες error messages)."""

    def build(cur):
        out = {}
        for key, where in (("kepler", f"TestName IN {_in(_KEPLER_TESTS)}"), ("live", f"TestName NOT IN {_in(_KEPLER_TESTS)}")):
            cur.execute(
                f"""
                SELECT {_HOME_OP} AS operator,
                    COUNT(TransferStatus) AS attempts,
                    SUM(CASE WHEN TransferStatus = 'OK' THEN 1 ELSE 0 END) AS successes,
                    AVG(CASE WHEN TransferStatus = 'OK' THEN CAST(TransferDuration AS float) END) AS duration,
                    AVG(CASE WHEN TransferStatus = 'OK' THEN CAST(TimetoFirstByte AS float) END) AS ttfb,
                    AVG(CASE WHEN TransferStatus = 'OK' THEN CAST(TimetoFirst500b AS float) END) AS ttf500
                FROM BI_BROWSING_500KB
                WHERE CollectionName IN {_KEYS} AND {where}
                GROUP BY {_HOME_OP}
                """,
                list(_KEPLER_TESTS),
            )
            out[key] = [
                {
                    "operator": row.operator,
                    "attempts": row.attempts,
                    "successes": row.successes,
                    "successRate": _pct(row.successes, row.attempts),
                    "avgDurationS": _f(row.duration),
                    "avgTtfbMs": _f(row.ttfb),
                    "avgTtf500Ms": _f(row.ttf500),
                }
                for row in _by_operator(cur.fetchall()).values()
            ]
        return out

    return _run("BI_DATA", scope, area, category, collection, {"kepler": [], "live": []}, build)


# ─────────────────────────────── [07] DNS ───────────────────────────────

# DNS[Test Selection] (page slicer): ο ορισμός της στήλης δεν υπάρχει στο lineage — εδώ τα
# TestName ομαδοποιούνται ανά υπηρεσία.
_DNS_TEST_GROUP = """
    CASE
        WHEN TestName LIKE 'HTTP% Browser%' THEN 'Browsing'
        WHEN TestName LIKE 'Capacity%' THEN 'Capacity'
        WHEN TestName LIKE 'HTTP Transfer%' OR TestName = 'HTTP UL' THEN 'HTTP Transfer'
        WHEN TestName LIKE 'FTP%' THEN 'FTP'
        WHEN TestName LIKE '%Ping%' THEN 'Ping'
        WHEN TestName LIKE 'YouTube%' THEN 'YouTube'
        WHEN TestName LIKE 'Ookla%' THEN 'Ookla'
        ELSE TestName
    END
"""


@router.get("/api/historic/dns")
def get_historic_dns(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
    test: str | None = None,
):
    """BI_DNS_NEW (ήδη aggregated ανά collection × test):
      07.1 SuccessFull_Tests / Failed_Tests = Σ SuccessDNSTests / Σ TotalDNSAttempts (και 1 − αυτό)
      07.2 Weighted Average DNS_TIME = Σ(Avg_DNS_TIME × SuccessDNSTests) / Σ SuccessDNSTests (ms)
      07.3 Min(Min_DNS_TIME) · 07.4 Max(Max_DNS_TIME)
    `test` = DNS[Test Selection] (βλ. _DNS_TEST_GROUP)."""
    op = _operator_case("[Home Operator]")

    def build(cur):
        cur.execute(
            f"SELECT DISTINCT {_DNS_TEST_GROUP} AS g FROM BI_DNS_NEW WHERE CollectionName IN {_KEYS}",
            (),
        )
        tests = sorted(row.g for row in cur.fetchall() if row.g)
        test_where, params = ("", [])
        if test:
            test_where, params = (f"AND {_DNS_TEST_GROUP} = ?", [test])
        cur.execute(
            f"""
            SELECT {op} AS operator,
                SUM(CAST(TotalDNSAttempts AS float)) AS attempts,
                SUM(CAST(SuccessDNSTests AS float)) AS successes,
                SUM(Avg_DNS_TIME * SuccessDNSTests) / NULLIF(SUM(CAST(SuccessDNSTests AS float)), 0) AS avg_time,
                MIN(Min_DNS_TIME) AS min_time,
                MAX(Max_DNS_TIME) AS max_time
            FROM BI_DNS_NEW
            WHERE CollectionName IN {_KEYS} {test_where}
            GROUP BY {op}
            """,
            params,
        )
        operators = []
        for row in _by_operator(cur.fetchall()).values():
            success = _pct(row.successes, row.attempts)
            operators.append(
                {
                    "operator": row.operator,
                    "attempts": row.attempts,
                    "successes": row.successes,
                    "successPct": success,
                    "failedPct": None if success is None else 100.0 - success,
                    "avgTimeMs": _f(row.avg_time),
                    "minTimeMs": _f(row.min_time),
                    "maxTimeMs": _f(row.max_time),
                }
            )
        return {"tests": tests, "operators": operators}

    return _run("BI_DATA", scope, area, category, collection, {"tests": [], "operators": []}, build)


# ─────────────────────────────── [08] DATA-HTTP ───────────────────────────────

_HTTP_THRP = "TRY_CAST(LTRIM(RTRIM(AvgThrp)) AS float)"


@router.get("/api/historic/http")
def get_historic_http(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_HTTP (HTTP Transfer), ανά Direction (Downlink / Uplink):
      cards 08.1–08.18 (ανά ASideLocation, χωρίς TaskStatus filter): P'10 / P'90 =
        PERCENTILE.INC(AvgThrp) / 1000, MaxAvgThrp = MAX(AvgThrp) / 1000 (Mbps)
      08.19/08.25 Avg(AvgThrp), 08.20/08.26 Avg(Duration) — visual filter TaskStatus = Success
      08.21/08.27 HTTPsuccessRate = TaskStatus = "SUCCESS" / COUNT(TaskStatus)
    Το AvgThrp είναι varchar (kbps) στο warehouse."""

    def build(cur):
        out = {}
        for key, direction in (("dl", "Downlink"), ("ul", "Uplink")):
            where = "AND Direction = ?"
            p10 = _percentiles(cur, "BI_HTTP", _LOCATION_OPERATOR, _HTTP_THRP, 0.1, where, [direction])
            p90 = _percentiles(cur, "BI_HTTP", _LOCATION_OPERATOR, _HTTP_THRP, 0.9, where, [direction])
            cur.execute(
                f"""
                SELECT {_LOCATION_OPERATOR} AS operator, MAX({_HTTP_THRP}) AS max_thrp
                FROM BI_HTTP WHERE CollectionName IN {_KEYS} AND Direction = ?
                GROUP BY {_LOCATION_OPERATOR}
                """,
                [direction],
            )
            max_thrp = {row.operator: _f(row.max_thrp) for row in cur.fetchall()}
            cur.execute(
                f"""
                SELECT {_HOME_OP} AS operator,
                    COUNT(TaskStatus) AS attempts,
                    SUM(CASE WHEN UPPER(TaskStatus) = 'SUCCESS' THEN 1 ELSE 0 END) AS successes,
                    AVG(CASE WHEN UPPER(TaskStatus) = 'SUCCESS' THEN {_HTTP_THRP} END) AS avg_thrp,
                    AVG(CASE WHEN UPPER(TaskStatus) = 'SUCCESS' THEN CAST(Duration AS float) END) AS avg_duration
                FROM BI_HTTP
                WHERE CollectionName IN {_KEYS} AND Direction = ?
                GROUP BY {_HOME_OP}
                """,
                [direction],
            )
            base = _by_operator(cur.fetchall())
            rows = []
            for op in _OPERATORS:
                row = base.get(op)
                if row is None and op not in p90:
                    continue
                kbps = lambda v: None if v is None else v / 1000.0  # noqa: E731
                rows.append(
                    {
                        "operator": op,
                        "attempts": row.attempts if row else None,
                        "successes": row.successes if row else None,
                        "successRate": _pct(row.successes, row.attempts) if row else None,
                        "avgThrpMbps": kbps(_f(row.avg_thrp)) if row else None,
                        "avgDurationS": _f(row.avg_duration) if row else None,
                        "p10Mbps": kbps(p10.get(op)),
                        "p90Mbps": kbps(p90.get(op)),
                        "maxMbps": kbps(max_thrp.get(op)),
                    }
                )
            out[key] = rows
        return out

    return _run("BI_DATA", scope, area, category, collection, {"dl": [], "ul": []}, build)


# ─────────────────────────────── [09] DATA-PING/OOKLA ───────────────────────────────


@router.get("/api/historic/ping_ookla")
def get_historic_ping_ookla(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_PING_NEW (aggregated ανά collection × PacketSize), δύο ομάδες όπως τα visual filters:
    PacketSize IN {32, 40} (09.1/09.2/09.8) και {800} (09.4/09.5/09.7):
      Weighted Average RTT = Σ(AvgRTT × SuccessTests) / Σ SuccessTests
      PingSuccessRate = Σ SuccessTests / Σ TotalPingAttempts
      RTT LTE-5G / LTE = Σ([1.LTE-5GNR] × [1.Count_LTE_5GNR_Success]) / Σ count (και για LTE)
    BI_OOKLA (ActionStatus = Success): 09.3 / 09.6 Avg(Throughput) DL / UL (kbps -> Mbps),
    09.9 Avg(Latency) (ms, όλα τα επιτυχή actions)."""

    def build(cur):
        ping = {}
        for key, sizes in (("small", (32, 40)), ("large", (800,))):
            cur.execute(
                f"""
                SELECT {_HOME_OP} AS operator,
                    SUM(CAST(TotalPingAttempts AS float)) AS attempts,
                    SUM(CAST(SuccessTests AS float)) AS successes,
                    SUM(AvgRTT * SuccessTests) / NULLIF(SUM(CAST(SuccessTests AS float)), 0) AS rtt,
                    SUM([1.LTE-5GNR] * [1.Count_LTE_5GNR_Success]) / NULLIF(SUM(CAST([1.Count_LTE_5GNR_Success] AS float)), 0) AS rtt_5g,
                    SUM([2.LTE] * [2.Count_LTE_Success]) / NULLIF(SUM(CAST([2.Count_LTE_Success] AS float)), 0) AS rtt_lte
                FROM BI_PING_NEW
                WHERE CollectionName IN {_KEYS} AND PacketSize IN {_in(sizes)}
                GROUP BY {_HOME_OP}
                """,
                list(sizes),
            )
            ping[key] = [
                {
                    "operator": row.operator,
                    "attempts": row.attempts,
                    "successes": row.successes,
                    "successRate": _pct(row.successes, row.attempts),
                    "rttMs": _f(row.rtt),
                    "rtt5gMs": _f(row.rtt_5g),
                    "rttLteMs": _f(row.rtt_lte),
                }
                for row in _by_operator(cur.fetchall()).values()
            ]

        cur.execute(
            f"""
            SELECT {_HOME_OP} AS operator,
                AVG(CASE WHEN ActionName = 'Downlink Performance' THEN CAST(Throughput AS float) END) / 1000.0 AS dl,
                COUNT(CASE WHEN ActionName = 'Downlink Performance' THEN Throughput END) AS dl_n,
                AVG(CASE WHEN ActionName = 'Uplink Performance' THEN CAST(Throughput AS float) END) / 1000.0 AS ul,
                COUNT(CASE WHEN ActionName = 'Uplink Performance' THEN Throughput END) AS ul_n,
                AVG(CAST(Latency AS float)) AS latency,
                COUNT(Latency) AS latency_n
            FROM BI_OOKLA
            WHERE CollectionName IN {_KEYS} AND ActionStatus = 'Success'
            GROUP BY {_HOME_OP}
            """,
            (),
        )
        ookla = [
            {
                "operator": row.operator,
                "dlMbps": _f(row.dl),
                "dlTests": row.dl_n,
                "ulMbps": _f(row.ul),
                "ulTests": row.ul_n,
                "latencyMs": _f(row.latency),
                "latencyTests": row.latency_n,
            }
            for row in _by_operator(cur.fetchall()).values()
        ]
        return {"pingSmall": ping["small"], "pingLarge": ping["large"], "ookla": ookla}

    return _run("BI_DATA", scope, area, category, collection, {"pingSmall": [], "pingLarge": [], "ookla": []}, build)


# ─────────────────────────────── [10] DATA-INTERACTIVITY ───────────────────────────────


@router.get("/api/historic/interactivity")
def get_historic_interactivity(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_INTERACTIVITY (aggregated ανά collection × pattern):
      10.1/10.2/10.5/10.6 Weighted Avg INT RTT / Delay / PacketLostRate / Thrp_Kbps =
        Σ(X × Succ_Count) / Σ Succ_Count — visual filter Fail_Count = 0
      10.3 Average(QoEScore) · 10.4 Success_Rate = Σ Succ / (Σ Succ + Σ Fail)."""

    def weighted(col):
        return (
            f"SUM(CASE WHEN Fail_Count = 0 THEN {col} * Succ_Count END) / "
            f"NULLIF(SUM(CASE WHEN Fail_Count = 0 AND {col} IS NOT NULL THEN CAST(Succ_Count AS float) END), 0)"
        )

    def build(cur):
        cur.execute(
            f"""
            SELECT {_HOME_OP} AS operator,
                {weighted('AVGRTT')} AS rtt,
                {weighted('AVGDelay')} AS delay,
                {weighted('AVGPacketsLostRate')} AS loss,
                {weighted('AvgThroughputKbps')} AS thrp,
                AVG(CAST(QoEScore AS float)) AS qoe,
                SUM(CAST(Succ_Count AS float)) AS succ,
                SUM(CAST(Fail_Count AS float)) AS fail,
                SUM(CASE WHEN Fail_Count = 0 THEN CAST(PacketsLost AS float) END) AS lost,
                SUM(CASE WHEN Fail_Count = 0 THEN CAST(SumPacketsSent AS float) END) AS sent
            FROM BI_INTERACTIVITY
            WHERE CollectionName IN {_KEYS}
            GROUP BY {_HOME_OP}
            """,
            (),
        )
        return {
            "operators": [
                {
                    "operator": row.operator,
                    "rttMs": _f(row.rtt),
                    "delayMs": _f(row.delay),
                    "packetLossPct": _f(row.loss),
                    "thrpKbps": _f(row.thrp),
                    "qoeScore": _f(row.qoe),
                    "successes": row.succ,
                    "failures": row.fail,
                    "successRate": _pct(row.succ, (row.succ or 0) + (row.fail or 0)),
                    "packetsLost": row.lost,
                    "packetsSent": row.sent,
                }
                for row in _by_operator(cur.fetchall()).values()
            ]
        }

    return _run("BI_DATA", scope, area, category, collection, {"operators": []}, build)


# ─────────────────────────────── [11] DATA-CAPACITY ───────────────────────────────

# Capacity[Operator] (το δίκτυο όπου έγινε το test) για τα cards: {Cosmote}, {Vodafone}, {Wind, NOVA}.
_NETWORK_OP = _operator_case("Operator")

_CA_GROUP = """
    CASE ca_active
        WHEN 'LTE 5CA' THEN 'LTE 5CA'
        WHEN 'LTE 4CA' THEN 'LTE 4CA'
        WHEN 'LTE 3CA' THEN 'LTE 3CA'
        WHEN 'LTE 2CA' THEN 'LTE 2CA'
        WHEN 'LTE' THEN 'LTE'
        WHEN 'Non LTE' THEN 'Non LTE'
        ELSE COALESCE(ca_active, '(Blank)')
    END
"""

# NR DATA TECH[DL_NRARFCN (groups)] — χωρίς το πρόθεμα operator (μπαίνει ανά μπάρα).
_NRARFCN_BAND = """
    CASE
        WHEN DL_NRARFCN IN (427730, 427930, 431070, 433250, 422856, 422870, 423130, 424856, 425080, 428856) THEN 'N1'
        WHEN DL_NRARFCN IN (152210, 156510, 156600, 154090) THEN 'N28'
        WHEN DL_NRARFCN IN (647328, 649988, 630720, 632064, 634080, 636666, 628592, 628608, 640608, 642322, 643322) THEN 'N78'
        ELSE 'Other'
    END
"""


@router.get("/api/historic/capacity")
def get_historic_capacity(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_Capacity:
      cards 11.1–11.18 (ανά Capacity[Operator], TaskStatus = Success): P'10 / P'90 / Max του
        AvgThrpDL και AvgThrpUL / 1000 (Mbps)
      11.19/11.20 CapacitySuccessRate (TestName = Capacity UL / DL) = Success / COUNT(TaskStatus)
      11.21/11.23 Avg(AvgThrpDL / UL) — Capacity DL / UL, TaskStatus = Success
      11.22 ca_active (groups) mix (CountNonNull) — Capacity DL
    BI_NR_DATA: 11.24 Sum(Duration) ανά DL_NRARFCN (groups), Capacity DL, DL_NRARFCN not null.
    ΑΠΟΚΛΙΣΗ: το 11.24 ομαδοποιεί στο ανενεργό NR DATA TECH[Home Operator1] — εδώ ανά
    ASideLocation (το raw [Home Operator] του BI_NR_DATA έχει roaming δίκτυα και NULL)."""

    def build(cur):
        succ = "AND TaskStatus = 'Success'"
        cards = {}
        for key, col in (("dl", "AvgThrpDL"), ("ul", "AvgThrpUL")):
            v = f"CAST({col} AS float)"
            p10 = _percentiles(cur, "BI_Capacity", _NETWORK_OP, v, 0.1, succ)
            p90 = _percentiles(cur, "BI_Capacity", _NETWORK_OP, v, 0.9, succ)
            cur.execute(
                f"""
                SELECT {_NETWORK_OP} AS operator, MAX({v}) AS mx FROM BI_Capacity
                WHERE CollectionName IN {_KEYS} {succ} GROUP BY {_NETWORK_OP}
                """,
                (),
            )
            mx = {row.operator: _f(row.mx) for row in cur.fetchall()}
            cards[key] = {"p10": p10, "p90": p90, "max": mx}

        cur.execute(
            f"""
            SELECT {_HOME_OP} AS operator,
                COUNT(CASE WHEN TestName = 'Capacity DL' THEN TaskStatus END) AS dl_attempts,
                SUM(CASE WHEN TestName = 'Capacity DL' AND TaskStatus = 'Success' THEN 1 ELSE 0 END) AS dl_success,
                COUNT(CASE WHEN TestName = 'Capacity UL' THEN TaskStatus END) AS ul_attempts,
                SUM(CASE WHEN TestName = 'Capacity UL' AND TaskStatus = 'Success' THEN 1 ELSE 0 END) AS ul_success,
                AVG(CASE WHEN TestName = 'Capacity DL' AND TaskStatus = 'Success' THEN CAST(AvgThrpDL AS float) END) AS dl_avg,
                AVG(CASE WHEN TestName = 'Capacity UL' AND TaskStatus = 'Success' THEN CAST(AvgThrpUL AS float) END) AS ul_avg
            FROM BI_Capacity
            WHERE CollectionName IN {_KEYS}
            GROUP BY {_HOME_OP}
            """,
            (),
        )
        base = _by_operator(cur.fetchall())
        mbps = lambda v: None if v is None else v / 1000.0  # noqa: E731
        operators = []
        for op in _OPERATORS:
            row = base.get(op)
            if row is None:
                continue
            operators.append(
                {
                    "operator": op,
                    "dlAttempts": row.dl_attempts,
                    "dlSuccesses": row.dl_success,
                    "dlSuccessRate": _pct(row.dl_success, row.dl_attempts),
                    "ulAttempts": row.ul_attempts,
                    "ulSuccesses": row.ul_success,
                    "ulSuccessRate": _pct(row.ul_success, row.ul_attempts),
                    "dlAvgMbps": mbps(_f(row.dl_avg)),
                    "ulAvgMbps": mbps(_f(row.ul_avg)),
                    "dlP10Mbps": mbps(cards["dl"]["p10"].get(op)),
                    "dlP90Mbps": mbps(cards["dl"]["p90"].get(op)),
                    "dlMaxMbps": mbps(cards["dl"]["max"].get(op)),
                    "ulP10Mbps": mbps(cards["ul"]["p10"].get(op)),
                    "ulP90Mbps": mbps(cards["ul"]["p90"].get(op)),
                    "ulMaxMbps": mbps(cards["ul"]["max"].get(op)),
                }
            )

        ca_mix = _mix(
            cur,
            f"""
            SELECT {_HOME_OP} AS operator, {_CA_GROUP} AS k, COUNT(*) AS v
            FROM BI_Capacity WHERE CollectionName IN {_KEYS} AND TestName = 'Capacity DL'
            GROUP BY {_HOME_OP}, {_CA_GROUP}
            """,
            (),
        )
        nr_bands = _mix(
            cur,
            f"""
            SELECT {_LOCATION_OPERATOR} AS operator, {_NRARFCN_BAND} AS k, SUM(CAST(Duration AS float)) AS v
            FROM BI_NR_DATA
            WHERE STR_ID IN {_KEYS} AND TestName = 'Capacity DL' AND DL_NRARFCN IS NOT NULL
            GROUP BY {_LOCATION_OPERATOR}, {_NRARFCN_BAND}
            """,
            (),
        )
        return {"operators": operators, "caMix": ca_mix, "nrBands": nr_bands}

    empty = {"operators": [], "caMix": [], "nrBands": []}
    return _run("BI_DATA", scope, area, category, collection, empty, build)


# ─────────────────────────────── [12] DATA-VIDEO ───────────────────────────────

# Page filter: Youtube[Vmos] NOT IN {0.217, 0.365, 0.654, 0.735} (Vmos = TestQualityAvg, βλ.
# historic.get_historic_video). ROUND γιατί η στήλη είναι real.
_VMOS_EXCLUDED = "(TestQualityAvg IS NULL OR ROUND(TestQualityAvg, 3) NOT IN (0.217, 0.365, 0.654, 0.735))"


@router.get("/api/historic/video_page")
def get_historic_video_page(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_YOUTUBE:
      12.1 Freezing = measure "test" = AVERAGE(FreezingTimePerc) — State IN {Completed, Dropped}
      12.2 YT_successRate = State = "completed" / COUNT(State)
      12.3/12.4/12.8 gauges Average(Vmos) — State = Completed
      12.5 Avg(TimeToFirstPicturePlayer) (s), 12.6 Avg(AVGres) (γραμμές) — State IN {Completed, Dropped}"""

    def build(cur):
        played = "LOWER(State) IN ('completed', 'dropped')"
        cur.execute(
            f"""
            SELECT {_HOME_OP} AS operator,
                COUNT(State) AS attempts,
                SUM(CASE WHEN LOWER(State) = 'completed' THEN 1 ELSE 0 END) AS successes,
                100.0 * AVG(CASE WHEN {played} THEN CAST(FreezingTimePerc AS float) END) AS freezing,
                AVG(CASE WHEN LOWER(State) = 'completed' THEN CAST(TestQualityAvg AS float) END) AS vmos,
                AVG(CASE WHEN {played} THEN CAST(TimeToFirstPicturePlayer AS float) END) AS ttfp,
                AVG(CASE WHEN {played} THEN CAST(AVGres AS float) END) AS res
            FROM BI_YOUTUBE
            WHERE CollectionName IN {_KEYS} AND {_VMOS_EXCLUDED}
            GROUP BY {_HOME_OP}
            """,
            (),
        )
        return {
            "operators": [
                {
                    "operator": row.operator,
                    "attempts": row.attempts,
                    "successes": row.successes,
                    "successRate": _pct(row.successes, row.attempts),
                    "freezingPct": _f(row.freezing),
                    "vmos": _f(row.vmos),
                    "ttfpS": _f(row.ttfp),
                    "avgResolution": _f(row.res),
                }
                for row in _by_operator(cur.fetchall()).values()
            ]
        }

    return _run("BI_DATA", scope, area, category, collection, {"operators": []}, build)


# ─────────────────────────────── [13] / [23] DATA-MAP (DL / UL) ───────────────────────────────

# Capacity[Calculated Throughput bins DL/UL] (kbps). Τα όρια του DAX (>256.01 κ.λπ.) αφήνουν
# κενά 0.01 kbps που πέφτουν στο "ERROR" — εδώ συνεχή όρια (μόνο για τιμές με 3+ δεκαδικά).
_THRP_BINS = {
    "dl": [(256, "Bad (<256)"), (1000, "Poor (256–1,000)"), (2000, "Fair (1,000–2,000)"), (10000, "Good (2,000–10,000)"),
           (30000, "Very good (10,000–30,000)"), (100000, "Excellent (30,000–100,000)"), (None, "Superb (>100,000)")],
    "ul": [(128, "Bad (<128)"), (500, "Poor (128–500)"), (1000, "Fair (500–1,000)"), (5000, "Good (1,000–5,000)"),
           (20000, "Very good (5,000–20,000)"), (40000, "Excellent (20,000–40,000)"), (None, "Superb (>40,000)")],
}

_TECH_GROUP = """
    CASE DataTechnology
        WHEN 'LTE-5GNR' THEN 'LTE-5GNR'
        WHEN 'LTE CA' THEN 'LTE CA'
        WHEN 'LTE/LTE CA' THEN 'LTE/LTE CA'
        WHEN 'LTE' THEN 'LTE'
        WHEN 'UMTS' THEN 'UMTS'
        WHEN 'GSM' THEN 'GSM'
        WHEN 'Mixed' THEN 'Mixed'
        ELSE DataTechnology
    END
"""

# 13.6 / 23.6: NOT Capacity[Operator] IN {…} — roaming δίκτυα εκτός Ελλάδας.
_FOREIGN_NETWORKS = ("0  /0", "602/10", "ALBtelecom", "Eagle Mobile", "Libyana", "Madar", "ONE", "Telekom.al", "Türk Telekom", "Turkcell", "West Central Wireless")


def _bin_index(value_kbps, bins):
    for i, (upper, _) in enumerate(bins):
        if upper is None or value_kbps <= upper:
            return i
    return len(bins) - 1


@router.get("/api/historic/data_map")
def get_historic_data_map(
    direction: str = Query("dl", pattern="^(dl|ul)$"),
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """[13] DATA-MAP (DL) και [23] DATA-MAP-UL (κρυφή σελίδα του report, ίδια διάταξη):
      χάρτης: TestEnd σημεία των Capacity tests χρωματισμένα ανά throughput bin (TestEndLong ≠ 0)
      13.2/23.2 Avg(AvgThrp) · 13.4/23.4 Max(AvgThrp) ανά operator · 13.3/23.3 πλήθος tests ανά bin
      13.5/23.5 DataTechnology (groups) mix · 13.6/23.6 Avg RSRP / SINR / RSCP / EcNo
    Φίλτρα: DL — TestName = Capacity DL (page filter TaskStatus ανοιχτό → όλα τα tests)·
    UL — TestName = Capacity UL, page filter TaskStatus = Success.
    ΑΠΟΚΛΙΣΗ: ο χάρτης του report δεν φιλτράρει TestName (τα UL tests έχουν κενό AvgThrpDL και
    το DAX τα βάζει στο "Bad") — εδώ μόνο τα tests της κατεύθυνσης."""
    col = "AvgThrpDL" if direction == "dl" else "AvgThrpUL"
    test = "Capacity DL" if direction == "dl" else "Capacity UL"
    status = "" if direction == "dl" else "AND TaskStatus = 'Success'"
    bins = _THRP_BINS[direction]

    def build(cur):
        where = f"CollectionName IN {_KEYS} AND TestName = ? {status}"
        params = [test]
        cur.execute(
            f"""
            SELECT {_HOME_OP} AS operator,
                AVG(CAST({col} AS float)) / 1000.0 AS avg_thrp, MAX(CAST({col} AS float)) / 1000.0 AS max_thrp,
                COUNT({col}) AS tests
            FROM BI_Capacity WHERE {where}
            GROUP BY {_HOME_OP}
            """,
            params,
        )
        base = _by_operator(cur.fetchall())
        # Τα radio averages έχουν δικό τους φίλτρο (εκτός roaming δικτύων).
        cur.execute(
            f"""
            SELECT {_HOME_OP} AS operator,
                AVG(CAST(testAvgRSRP AS float)) AS rsrp, AVG(CAST(testAvgSINR AS float)) AS sinr,
                AVG(CAST(testAvgRSCP AS float)) AS rscp, AVG(CAST(testAvgEcNo AS float)) AS ecno
            FROM BI_Capacity WHERE {where} AND (Operator IS NULL OR Operator NOT IN {_in(_FOREIGN_NETWORKS)})
            GROUP BY {_HOME_OP}
            """,
            [*params, *_FOREIGN_NETWORKS],
        )
        radio = _by_operator(cur.fetchall())

        tech_mix = _mix(
            cur,
            f"""
            SELECT {_HOME_OP} AS operator, {_TECH_GROUP} AS k, COUNT(*) AS v
            FROM BI_Capacity WHERE {where} AND DataTechnology IS NOT NULL
            GROUP BY {_HOME_OP}, {_TECH_GROUP}
            """,
            params,
        )

        cur.execute(
            f"""
            SELECT {_HOME_OP} AS operator, TestEndLat AS lat, TestEndLong AS lon, CAST({col} AS float) AS v
            FROM BI_Capacity
            WHERE {where} AND {col} IS NOT NULL AND TestEndLong IS NOT NULL AND TestEndLong <> 0
              AND TestEndLat BETWEEN 34.5 AND 42.0 AND TestEndLong BETWEEN 19.0 AND 30.0
            ORDER BY TestId
            """,
            params,
        )
        counts: dict[str, list[int]] = {}
        points = []
        for row in cur.fetchall():
            if not _ok_operator(row.operator):
                continue
            b = _bin_index(row.v, bins)
            counts.setdefault(row.operator, [0] * len(bins))[b] += 1
            points.append([round(row.lat, 5), round(row.lon, 5), row.operator, b, round(row.v / 1000.0, 2)])

        operators = []
        for op in _OPERATORS:
            row = base.get(op)
            if row is None:
                continue
            r = radio.get(op)
            operators.append(
                {
                    "operator": op,
                    "tests": row.tests,
                    "avgMbps": _f(row.avg_thrp),
                    "maxMbps": _f(row.max_thrp),
                    "rsrp": _f(r.rsrp) if r else None,
                    "sinr": _f(r.sinr) if r else None,
                    "rscp": _f(r.rscp) if r else None,
                    "ecno": _f(r.ecno) if r else None,
                    "binCounts": counts.get(op, [0] * len(bins)),
                }
            )
        return {
            "bins": [label for _, label in bins],
            "operators": operators,
            "techMix": tech_mix,
            "points": _sample(points, 8000),
            "totalPoints": len(points),
        }

    empty = {"bins": [label for _, label in bins], "operators": [], "techMix": [], "points": [], "totalPoints": 0}
    return _run("BI_DATA", scope, area, category, collection, empty, build)


# ─────────────────────────────── [14] DATA-BANDWIDTH (BW) ───────────────────────────────


@router.get("/api/historic/bandwidth_mix")
def get_historic_bandwidth_mix(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_BW (Capacity DL):
      14.1–14.3 πίτες ανά operator: πλήθος samples ανά TotalBwN (MHz) — BW[totalBWcount]
        (ο ορισμός του measure δεν υπάρχει στο lineage, εδώ COUNT γραμμών)
      14.5 Avg(TotalThp) ανά TotalBwN × operator (kbps -> Mbps)
    Τα 1.4 / 23 MHz (μεμονωμένα outliers) εξαιρούνται, όπως στα visual filters 14.2 / 14.5."""

    def build(cur):
        cur.execute(
            f"""
            SELECT {_HOME_OP} AS operator, TotalBwN AS bw, COUNT(*) AS n, AVG(CAST(TotalThp AS float)) / 1000.0 AS thp
            FROM BI_BW
            WHERE CollectionName IN {_KEYS} AND TestName = 'Capacity DL'
              AND TotalBwN IS NOT NULL AND TotalBwN NOT IN (1, 23) AND TotalBwN >= 2
            GROUP BY {_HOME_OP}, TotalBwN
            """,
            (),
        )
        rows = [
            {"operator": row.operator, "bwMhz": round(float(row.bw), 1), "samples": row.n, "avgThpMbps": _f(row.thp)}
            for row in cur.fetchall()
            if _ok_operator(row.operator)
        ]
        return {"rows": sorted(rows, key=lambda r: r["bwMhz"])}

    return _run("BI_DATA", scope, area, category, collection, {"rows": []}, build)


# ─────────────────────────────── [15] DATA-MAP NR ───────────────────────────────

_RSRP_BINS = [(-85, "Excellent (≥ −85)"), (-100, "Good (≥ −100)"), (-110, "Fair (≥ −110)"), (-125, "Poor (≥ −125)"), (None, "Bad (< −125)")]

# NR_CAP_USAGE[EARFCN (groups)]: κάθε NR ARFCN ξεχωριστά, τα LTE κανάλια μαζί, τα υπόλοιπα "Other".
_NR_ARFCNS = (152210, 154090, 156510, 423130, 425080, 427730, 431070, 628592, 628608, 630720, 632064, 634080, 640608, 643322, 647328, 649988)
_LTE_EARFCNS = (100, 300, 500, 1251, 1276, 1301, 1451, 1575, 1700, 1844, 1871, 2850, 3050, 3194, 3350, 3701, 3724, 3725, 6200, 6300, 6400, 9260, 9360)


def _earfcn_group(earfcn):
    if earfcn in _NR_ARFCNS:
        return str(earfcn)
    if earfcn in _LTE_EARFCNS:
        return "LTE Channels"
    return "Other"


def _rsrp_bin(rsrp):
    for i, (lower, _) in enumerate(_RSRP_BINS):
        if lower is None or rsrp >= lower:
            return i
    return len(_RSRP_BINS) - 1


@router.get("/api/historic/nr_map")
def get_historic_nr_map(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_5G_CAP_USAGE (ένα δείγμα ανά θέση, Capacity DL / UL):
      15.2 χάρτης: σημεία χρωματισμένα ανά RSRP_Bin (NR_RSRP: ≥−85 / ≥−100 / ≥−110 / ≥−125 / <−125)
      15.3 κατανομή samples ανά RSRP_Bin (ανά operator εδώ — ο report δείχνει το σύνολο)
      15.1/15.4 Avg(ThroughputDL/UL) + πλήθος ανά EARFCN (groups) × ASideLocation
    Operator = ASideLocation (Cosmote/Vodafone/Nova+Wind Data). Throughput kbps -> Mbps."""

    def build(cur):
        cur.execute(
            f"""
            SELECT {_LOCATION_OPERATOR} AS operator, TestName, EARFCN,
                COUNT(*) AS n,
                AVG(CAST(ThroughputDL AS float)) / 1000.0 AS dl, COUNT(ThroughputDL) AS dl_n,
                AVG(CAST(ThroughputUL AS float)) / 1000.0 AS ul, COUNT(ThroughputUL) AS ul_n
            FROM BI_5G_CAP_USAGE
            WHERE CollectionName IN {_KEYS} AND EARFCN IS NOT NULL
            GROUP BY {_LOCATION_OPERATOR}, TestName, EARFCN
            """,
            (),
        )
        # Re-aggregate σε EARFCN groups (σταθμισμένος μέσος με τα counts).
        acc: dict[tuple, list] = {}
        for row in cur.fetchall():
            if not _ok_operator(row.operator):
                continue
            is_dl = row.TestName == "Capacity DL"
            avg, n = (row.dl, row.dl_n) if is_dl else (row.ul, row.ul_n)
            if not n or avg is None:
                continue
            a = acc.setdefault(("dl" if is_dl else "ul", _earfcn_group(row.EARFCN), row.operator), [0.0, 0])
            a[0] += avg * n
            a[1] += n
        channels = [
            {"direction": d, "group": g, "operator": op, "avgMbps": s / n, "samples": n}
            for (d, g, op), (s, n) in acc.items()
        ]

        cur.execute(
            f"""
            SELECT {_LOCATION_OPERATOR} AS operator, latitude AS lat, longitude AS lon, NR_RSRP AS rsrp, NR_SINR AS sinr, EARFCN
            FROM BI_5G_CAP_USAGE
            WHERE CollectionName IN {_KEYS} AND NR_RSRP IS NOT NULL
              AND latitude BETWEEN 34.5 AND 42.0 AND longitude BETWEEN 19.0 AND 30.0
            ORDER BY PosId
            """,
            (),
        )
        counts: dict[str, list[int]] = {}
        points = []
        for row in cur.fetchall():
            if not _ok_operator(row.operator):
                continue
            b = _rsrp_bin(row.rsrp)
            counts.setdefault(row.operator, [0] * len(_RSRP_BINS))[b] += 1
            points.append([round(row.lat, 5), round(row.lon, 5), row.operator, b, round(row.rsrp, 1), None if row.sinr is None else round(row.sinr, 1), _earfcn_group(row.EARFCN)])

        return {
            "bins": [label for _, label in _RSRP_BINS],
            "binCounts": [{"operator": op, "counts": counts[op]} for op in _OPERATORS if op in counts],
            "channels": channels,
            "points": _sample(points, 8000),
            "totalPoints": len(points),
        }

    empty = {"bins": [label for _, label in _RSRP_BINS], "binCounts": [], "channels": [], "points": [], "totalPoints": 0}
    return _run("BI_DATA", scope, area, category, collection, empty, build)


# ─────────────────────────────── [16] / [17] NR DATA TECH ───────────────────────────────

_NR_DL_TESTS = ("Capacity DL", "HTTP Transfer (DL)", "Ookla(R)", "YouTube Service", "YouTube Service_4K", "YouTube Service_Live")
_NR_UL_TESTS = ("Capacity UL", "HTTP UL")

# NR DATA TECH[DataTechnologyReporting (groups)].
_NR_TECH_GROUP = """
    CASE
        WHEN DataTechnologyReporting IS NULL THEN '(Blank)'
        WHEN DataTechnologyReporting IN ('5G EN-DC', '5G NR', 'LTE-5G NR', 'LTE-5GNR') THEN '5G NR-LTE'
        WHEN DataTechnologyReporting LIKE 'LTE 5CCA%' THEN 'LTE 5CCA'
        WHEN DataTechnologyReporting LIKE 'LTE 4CCA%' THEN 'LTE 4CCA'
        WHEN DataTechnologyReporting LIKE 'LTE 3CCA%' THEN 'LTE 3CCA'
        WHEN DataTechnologyReporting LIKE 'LTE 2CCA%' THEN 'LTE 2CCA'
        WHEN DataTechnologyReporting IN ('LTE', 'LTE UL 2CCA', 'LTE UL 3CCA') THEN 'LTE'
        WHEN DataTechnologyReporting IN ('DC-HSPA+', 'HSPA', 'HSPA+', 'UMTS') THEN 'UMTS'
        ELSE DataTechnologyReporting
    END
"""

# NR Usage BandList / BandwidthList (groups): ίδιες λίστες με αντεστραμμένη σειρά ενώνονται.
_NR_BANDLIST_GROUP = """
    CASE [NR Usage BandList]
        WHEN '5G NR n78, n1' THEN '5G NR n1, n78'
        ELSE [NR Usage BandList]
    END
"""
_NR_BWLIST_GROUP = """
    CASE [NR Usage BandwidthList]
        WHEN '20, 100' THEN '100, 20'
        WHEN '50, 100' THEN '100, 50'
        ELSE [NR Usage BandwidthList]
    END
"""


def _band_pie_sql(tests):
    """CM_/VD_/NV_ N78 / N1 / N28 / LTE measures ανά ASideLocation (Sum Duration):
      N78/N1/N28 = DL_NRARFCN (groups) του operator · LTE: Cosmote = DataTechnologyReporting
      (groups) <> 5GNR-LTE, Vodafone/Nova = DL_NRARFCN κενό (ασυμμετρία του report, κρατιέται).
    Το N28 υπάρχει στο report μόνο για την Cosmote (CM_N28). Διαβάζει το #nr (βλ. nr_tech)."""
    return f"""
        SELECT operator, k, SUM(v) AS v FROM (
            SELECT {_LOCATION_OPERATOR} AS operator,
                CASE
                    WHEN {_NRARFCN_BAND} = 'N78' THEN 'N78'
                    WHEN {_NRARFCN_BAND} = 'N1' THEN 'N1'
                    WHEN {_NRARFCN_BAND} = 'N28' AND ASideLocation LIKE 'Cosmote%' THEN 'N28'
                    WHEN ASideLocation LIKE 'Cosmote%' AND {_NR_TECH_GROUP} <> '5G NR-LTE' THEN 'LTE'
                    WHEN ASideLocation NOT LIKE 'Cosmote%' AND DL_NRARFCN IS NULL THEN 'LTE'
                END AS k,
                dur AS v
            FROM #nr
            WHERE TestName IN {_in(tests)}
        ) x
        WHERE k IS NOT NULL
        GROUP BY operator, k
    """


@router.get("/api/historic/nr_tech")
def get_historic_nr_tech(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_NR_DATA (Sum Duration = χρόνος σε κάθε τεχνολογία/band):
      [16] 16.1 DataTechnologyReporting (groups) mix — DL tests · 16.2–16.7 πίτες N78/N1/N28/LTE
           ανά operator, DL tests και UL tests (Capacity UL, HTTP UL)
      [17] page filter: DataTechnologyReporting IN {5G EN-DC, 5G NR}, NR Usage BandList /
           BandwidthList not null, DL tests — 17.1 NR band mix, 17.2 NR bandwidth mix (MHz),
           17.3 Avg(NR Usage BW MHz)
    Operator = ASideLocation (βλ. ΑΠΟΚΛΙΣΗ στο get_historic_capacity).
    Ο BI_NR_DATA είναι heap 8.5M γραμμών: ΕΝΑ scan που συμπυκνώνει στο #nr (group by τις
    διαστάσεις που χρειάζονται τα visuals) και όλα τα visuals διαβάζουν από εκεί."""

    def build(cur):
        tests = (*_NR_DL_TESTS, *_NR_UL_TESTS)
        # CREATE χωρίς parameters: ένα parameterized SELECT … INTO τρέχει μέσα σε sp_prepexec και
        # το temp table χάνεται μόλις τελειώσει.
        cur.execute(
            """
            CREATE TABLE #nr (
                ASideLocation VARCHAR(100) COLLATE DATABASE_DEFAULT, TestName VARCHAR(100) COLLATE DATABASE_DEFAULT,
                DataTechnologyReporting VARCHAR(100) COLLATE DATABASE_DEFAULT, DL_NRARFCN BIGINT,
                [NR Usage BandList] NVARCHAR(400) COLLATE DATABASE_DEFAULT, [NR Usage BandwidthList] NVARCHAR(400) COLLATE DATABASE_DEFAULT,
                dur FLOAT, bw_sum FLOAT, bw_n INT, cfg_sum FLOAT, cfg_n INT, n INT
            )
            """
        )
        cur.execute(
            f"""
            INSERT INTO #nr
            SELECT ASideLocation, TestName, DataTechnologyReporting, DL_NRARFCN,
                [NR Usage BandList], [NR Usage BandwidthList],
                SUM(CAST(Duration AS float)),
                SUM(CAST([NR Usage BW MHz] AS float)), COUNT([NR Usage BW MHz]),
                SUM(CAST([NR Config BW MHz] AS float)), COUNT([NR Config BW MHz]),
                COUNT(TestName)
            FROM BI_NR_DATA
            WHERE STR_ID IN {_KEYS} AND TestName IN {_in(tests)}
            GROUP BY ASideLocation, TestName, DataTechnologyReporting, DL_NRARFCN, [NR Usage BandList], [NR Usage BandwidthList]
            """,
            list(tests),
        )
        dl = f"TestName IN {_in(_NR_DL_TESTS)}"
        tech_mix = _mix(
            cur,
            f"""
            SELECT {_LOCATION_OPERATOR} AS operator, {_NR_TECH_GROUP} AS k, SUM(dur) AS v
            FROM #nr WHERE {dl}
            GROUP BY {_LOCATION_OPERATOR}, {_NR_TECH_GROUP}
            """,
            list(_NR_DL_TESTS),
        )
        bands_dl = _mix(cur, _band_pie_sql(_NR_DL_TESTS), list(_NR_DL_TESTS))
        bands_ul = _mix(cur, _band_pie_sql(_NR_UL_TESTS), list(_NR_UL_TESTS))

        nr_where = (
            f"{dl} AND DataTechnologyReporting IN ('5G EN-DC', '5G NR') "
            "AND [NR Usage BandList] IS NOT NULL AND [NR Usage BandwidthList] IS NOT NULL"
        )
        params = list(_NR_DL_TESTS)
        band_list = _mix(
            cur,
            f"""
            SELECT {_LOCATION_OPERATOR} AS operator, {_NR_BANDLIST_GROUP} AS k, SUM(dur) AS v
            FROM #nr WHERE {nr_where}
            GROUP BY {_LOCATION_OPERATOR}, {_NR_BANDLIST_GROUP}
            """,
            params,
        )
        bw_list = _mix(
            cur,
            f"""
            SELECT {_LOCATION_OPERATOR} AS operator, {_NR_BWLIST_GROUP} AS k, SUM(dur) AS v
            FROM #nr WHERE {nr_where}
            GROUP BY {_LOCATION_OPERATOR}, {_NR_BWLIST_GROUP}
            """,
            params,
        )
        cur.execute(
            f"""
            SELECT {_LOCATION_OPERATOR} AS operator, SUM(bw_sum) / NULLIF(SUM(bw_n), 0) AS bw,
                   SUM(cfg_sum) / NULLIF(SUM(cfg_n), 0) AS cfg, SUM(n) AS n
            FROM #nr WHERE {nr_where}
            GROUP BY {_LOCATION_OPERATOR}
            """,
            params,
        )
        usage_bw = [
            {"operator": row.operator, "usageBwMhz": _f(row.bw), "configBwMhz": _f(row.cfg), "samples": row.n}
            for row in _by_operator(cur.fetchall()).values()
        ]
        return {"techMix": tech_mix, "bandsDl": bands_dl, "bandsUl": bands_ul, "bandList": band_list, "bwList": bw_list, "usageBw": usage_bw}

    empty = {"techMix": [], "bandsDl": [], "bandsUl": [], "bandList": [], "bwList": [], "usageBw": []}
    return _run("BI_DATA", scope, area, category, collection, empty, build)


# ─────────────────────────────── [18] / [19] NR SCANNER MAP ───────────────────────────────

# AbsFreqSSB (groups): τα N78 SSB κανάλια κάθε operator (ίδια με τα NR ARFCN groups του NR DATA TECH).
_SSB_OPERATOR = """
    CASE
        WHEN AbsFreqSSB IN (630720, 632064, 634080, 636666) THEN 'COSMOTE'
        WHEN AbsFreqSSB IN (628592, 628608, 640608, 642322, 643322) THEN 'VODAFONE'
        WHEN AbsFreqSSB IN (647328, 649988) THEN 'NOVA'
        ELSE 'OTHER'
    END
"""

# Scanner5G Map [SS-RSRP_binning] (dBm).
_SSB_BINS = [(-50, "≥ −50"), (-75, "−50 to −75"), (-85, "−75 to −85"), (-95, "−85 to −95"), (-110, "−95 to −110"), (-125, "−110 to −125"), (None, "< −125")]


def _ssb_bin(v):
    for i, (lower, _) in enumerate(_SSB_BINS):
        if lower is None or v >= lower:
            return i
    return len(_SSB_BINS) - 1


@router.get("/api/historic/nr_scanner_map")
def get_historic_nr_scanner_map(
    bin: int = Query(50),
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_NR_SCANNER_MAP_50 / _500 (scanner bins 50 m / 500 m, μόνο N78):
      χάρτες 18.1–18.3 / 19.1–19.3 ανά operator (AbsFreqSSB groups): bin centers χρωματισμένα ανά
      SS-RSRP_binning του Avg_SS-RSRP
      πίνακες 18.4–18.6 / 19.4–19.6 %_Samples_per_Bin = Σ samples του bin / Σ samples του operator.
    ΥΠΟΘΕΣΗ: Total_Binned_Samples = SUM(SampleCount) (ο ορισμός λείπει από το lineage)."""
    if bin not in (50, 500):
        raise HTTPException(status_code=400, detail="bin must be 50 or 500")
    table = "BI_NR_SCANNER_MAP_50" if bin == 50 else "BI_NR_SCANNER_MAP_500"

    def build(cur):
        cur.execute(
            f"""
            SELECT {_SSB_OPERATOR} AS operator, CAST(BinCenterLatitude AS float) AS lat, CAST(BinCenterLongitude AS float) AS lon,
                   [Avg_SS-RSRP] AS rsrp, SampleCount AS n
            FROM {table}
            WHERE CollectionName IN {_KEYS} AND [Avg_SS-RSRP] IS NOT NULL
              AND BinCenterLatitude IS NOT NULL AND BinCenterLongitude IS NOT NULL
            """,
            (),
        )
        samples: dict[str, list[float]] = {}
        points: dict[str, list] = {}
        for row in cur.fetchall():
            if not _ok_operator(row.operator):
                continue
            b = _ssb_bin(row.rsrp)
            samples.setdefault(row.operator, [0.0] * len(_SSB_BINS))[b] += row.n or 0
            points.setdefault(row.operator, []).append([round(row.lat, 5), round(row.lon, 5), b, round(row.rsrp, 1)])
        return {
            "bins": [label for _, label in _SSB_BINS],
            "operators": [
                {
                    "operator": op,
                    "binSamples": samples[op],
                    "points": _sample(points[op], 6000),
                    "totalPoints": len(points[op]),
                }
                for op in _OPERATORS
                if op in samples
            ],
        }

    return _run("BI_SCANNER", scope, area, category, collection, {"bins": [label for _, label in _SSB_BINS], "operators": []}, build)


# ─────────────────────────────── [20] SCANNER 4G-5G ───────────────────────────────

_SCANNER_CLASSES = [("Excellent", "Excelent"), ("Good", "Good"), ("Fair", "Fair"), ("Poor", "Poor"), ("No coverage", "No coverage")]


@router.get("/api/historic/scanner")
def get_historic_scanner(
    scope: str = Query(..., min_length=1),
    area: str | None = None,
    category: str | None = None,
    collection: str | None = None,
):
    """BI_SCANNER_LTE / BI_SCANNER_NR (samples ανά κλάση, ήδη μετρημένα ανά collection × κανάλι):
      20.1 / 20.2 LTE: Σ samples ανά RSRP / SINR κλάση ανά EARFCN (100% stacked)
      20.3 / 20.4 NR: ίδιο ανά Op_Channel = Operator (groups) & " " & AbsFreqSSB
    Operator = BI_SCANNER_*[Operator] (Wind -> NOVA)."""
    op = _operator_case("Operator")

    def build(cur):
        out = {}
        for key, table, channel in (("lte", "BI_SCANNER_LTE", "EARFCN"), ("nr", "BI_SCANNER_NR", "AbsFreqSSB")):
            sums = ", ".join(
                f"SUM(CAST([{src} {kind}] AS float)) AS [{kind.lower()}_{i}]"
                for kind in ("RSRP", "SINR")
                for i, (_, src) in enumerate(_SCANNER_CLASSES)
            )
            cur.execute(
                f"""
                SELECT {op} AS operator, {channel} AS channel, {sums}
                FROM {table}
                WHERE collectionname IN {_KEYS}
                GROUP BY {op}, {channel}
                """,
                (),
            )
            rows = []
            for row in cur.fetchall():
                if not _ok_operator(row.operator):
                    continue
                rows.append(
                    {
                        "operator": row.operator,
                        "channel": row.channel,
                        "rsrp": [_f(getattr(row, f"rsrp_{i}")) or 0.0 for i in range(len(_SCANNER_CLASSES))],
                        "sinr": [_f(getattr(row, f"sinr_{i}")) or 0.0 for i in range(len(_SCANNER_CLASSES))],
                    }
                )
            out[key] = sorted(rows, key=lambda r: (_OPERATORS.index(r["operator"]), r["channel"] or 0))
        out["classes"] = [label for label, _ in _SCANNER_CLASSES]
        return out

    return _run("BI_SCANNER", scope, area, category, collection, {"lte": [], "nr": [], "classes": [c for c, _ in _SCANNER_CLASSES]}, build)
