"""Transactional writer for the verified subset of native SmartAnalytics tables."""

from __future__ import annotations

import os
import re
from bisect import bisect_right


def _connection(server, database):
    import pyodbc

    if not re.fullmatch(r"[A-Za-z0-9_.\\-]+", server) or not re.fullmatch(r"[A-Za-z0-9_-]+", database):
        raise ValueError("Invalid SQL Server/database name")
    user = os.environ.get("SMARTANALYTICS_SQL_USER", "sa")
    password = os.environ.get("SMARTANALYTICS_SQL_PASSWORD")
    if not password:
        raise ValueError("Set SMARTANALYTICS_SQL_PASSWORD in the process environment")
    if "}" in password or ";" in user or "}" in user:
        raise ValueError("Unsupported characters in ODBC credentials")
    installed = pyodbc.drivers()
    driver = next((name for name in ("SQL Server Native Client 11.0", "ODBC Driver 17 for SQL Server")
                   if name in installed), None)
    if not driver:
        raise ValueError("SQL Server Native Client 11.0 or ODBC Driver 17 is required")
    return pyodbc.connect(
        f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};"
        f"UID={{{user}}};PWD={{{password}}};Encrypt=No;TrustServerCertificate=Yes;"
        "Connection Timeout=10;", autocommit=False, timeout=10)


def _many(cursor, sql, rows, batch=1000):
    iterator = iter(rows)
    while True:
        chunk = []
        for _ in range(batch):
            try:
                chunk.append(next(iterator))
            except StopIteration:
                break
        if not chunk:
            return
        cursor.executemany(sql, chunk)


def _locate(stamps, ids, stamp):
    i = bisect_right(stamps, stamp) - 1
    return ids[i] if i >= 0 else None


def _id_base(file_id):
    # Observed on the installed sample: FileId 241 -> 241 * 2^32 + n.
    return file_id << 32


def _write_lte_reports(cursor, file_id, plan, session_times, session_ids,
                       position_times, position_ids):
    report_ids = [_id_base(file_id) + i for i in range(1, len(plan.lte) + 1)]
    report_times = [row[0] for row in plan.lte]
    _many(cursor, """
        INSERT dbo.LTEMeasurementReport
          (LTEMeasReportId, SessionId, MsgTime, PosId, EARFCN,
           PhyCellId, RSRP, RSRQ, RSSI)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, ((report_id, _locate(session_times, session_ids, stamp), stamp,
           _locate(position_times, position_ids, stamp), earfcn, pci, rsrp, rsrq, rssi)
          for report_id, (stamp, earfcn, pci, rsrp, rsrq, rssi, _, _carrier)
          in zip(report_ids, plan.lte)))
    if plan.lte_neighbors and not report_ids:
        raise ValueError("LTE neighbors have no parent measurement reports")
    _many(cursor, """
        INSERT dbo.FactLTENeighbors
          (LTEMeasReportId, FullDate, FileId, SessionId, PosId,
           PCI, DL_EARFCN, RSRP, RSRQ, RSSI)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, ((_locate(report_times, report_ids, stamp), stamp, file_id,
           _locate(session_times, session_ids, stamp),
           _locate(position_times, position_ids, stamp), pci, earfcn, rsrp, rsrq, rssi)
          for stamp, pci, earfcn, rsrp, rsrq, rssi in plan.lte_neighbors))


def _write_lte_radio(cursor, file_id, source, session_times, session_ids,
                     position_times, position_ids):
    _many(cursor, """
        INSERT dbo.FactLTERadio
          (FullDate, FileId, SessionId, PosId, CarrierIndex, SCCIndex,
           EARFCN, PhyCellId, RSRP, RSRQ, RSSI, SINR)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, ((stamp, file_id, _locate(session_times, session_ids, stamp),
           _locate(position_times, position_ids, stamp), carrier, carrier,
           earfcn, pci, rsrp, rsrq, rssi, sinr)
          for stamp, earfcn, pci, rsrp, rsrq, rssi, sinr, carrier in source))


def _write_mf(cursor, file_id, collection, plan):
    base = _id_base(file_id)
    if max(len(plan.positions), len(plan.sessions), len(plan.tests)) >= 2**32:
        raise ValueError("Too many IDs within one MF")
    position_ids = [base + i for i in range(1, len(plan.positions) + 1)]
    position_times = [row[0] for row in plan.positions]
    session_ids = [base + i for i in range(1, len(plan.sessions) + 1)]
    session_times = [row[0] for row in plan.sessions]
    test_ids = [base + i for i in range(1, len(plan.tests) + 1)]
    test_times = [row[0] for row in plan.tests]

    # Valid=0 is deliberate: native dimensions/KPI ETL are not fully mapped.
    cursor.execute("""
        INSERT dbo.FileList
          (FileId, ASideFileName, ASideLocation, CollectionName, Provider, Valid, InvalidReason)
        VALUES (?, ?, ?, ?, ?, 0, ?)
    """, file_id, plan.mf_name, plan.operator, collection, plan.operator,
                   "External parser: partial native ETL; see import plan")
    cursor.execute("""
        INSERT dbo.FactFile (FullDate, FileId, FileName, FirstSessionId, Side,
                             StartPosId, StartTime, EndTime)
        VALUES (?, ?, ?, ?, 'A', ?, ?, ?)
    """, plan.start, file_id, plan.mf_name, session_ids[0],
                   position_ids[0] if position_ids else None, plan.start, plan.end)

    _many(cursor, """
        INSERT dbo.Position (PosId, FileId, SessionId, MsgTime, latitude, longitude)
        VALUES (?, ?, ?, ?, ?, ?)
    """, ((pos_id, file_id, _locate(session_times, session_ids, stamp), stamp, lat, lon)
          for pos_id, (stamp, lat, lon) in zip(position_ids, plan.positions)))
    _many(cursor, """
        INSERT dbo.FactPosition (FullDate, PosId, FileId, SessionId)
        VALUES (?, ?, ?, ?)
    """, ((stamp, pos_id, file_id, _locate(session_times, session_ids, stamp))
          for pos_id, (stamp, _, _) in zip(position_ids, plan.positions)))

    test_count_by_session = {item: 0 for item in session_ids}
    for start, _, _ in plan.tests:
        session = _locate(session_times, session_ids, start)
        if session:
            test_count_by_session[session] += 1
    _many(cursor, """
        INSERT dbo.Sessions
          (SessionId, sessionType, FileId, PosId, startTime, duration, numOfTests,
           valid, prevSessionId, nextSessionId)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    """, ((session_id, kind, file_id, _locate(position_times, position_ids, start),
           start, duration, test_count_by_session[session_id],
           session_ids[index - 1] if index else 0,
           session_ids[index + 1] if index + 1 < len(session_ids) else -1)
          for index, (session_id, (start, _, kind, duration)) in
          enumerate(zip(session_ids, plan.sessions))))
    _many(cursor, """
        INSERT dbo.FactSession
          (FullDate, FileId, SessionId, Side, StartPosId, StartTime, EndTime, Duration)
        VALUES (?, ?, ?, 'A', ?, ?, ?, ?)
    """, ((start, file_id, session_id, _locate(position_times, position_ids, start),
           start, end, duration)
          for session_id, (start, end, _, duration) in zip(session_ids, plan.sessions)))
    _many(cursor, """
        INSERT dbo.FactTest
          (FullDate, FileId, SessionId, TestId, StartPosId, EndPosId,
           StartTime, EndTime, Duration, TestCompleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    """, ((start, file_id, _locate(session_times, session_ids, start), test_id,
           _locate(position_times, position_ids, start),
           _locate(position_times, position_ids, end), start, end, duration)
          for test_id, (start, end, duration) in zip(test_ids, plan.tests)))

    def radio_rows(source):
        for stamp, *values in source:
            yield (stamp, file_id, _locate(session_times, session_ids, stamp),
                   _locate(position_times, position_ids, stamp), *values)

    _write_lte_radio(cursor, file_id, (*plan.lte, *plan.lte_secondary),
                     session_times, session_ids, position_times, position_ids)
    _write_lte_reports(cursor, file_id, plan, session_times, session_ids,
                       position_times, position_ids)

    nr_base = cursor.execute(
        "SELECT ISNULL(MAX(FactId),0) FROM dbo.FactNR5GRadio WITH (TABLOCKX,HOLDLOCK)").fetchone()[0]
    _many(cursor, """
        INSERT dbo.FactNR5GRadio
          (FactId, FullDate, FileId, SessionId, PosId, PCI, NRARFCN, RSRP, RSRQ, SINR)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, ((nr_base + i, *row) for i, row in enumerate(radio_rows(plan.nr), 1)))
    _many(cursor, """
        INSERT dbo.FactIPThroughput
          (FullDate, FileId, SessionId, TestId, PosId, Direction, BytesTransferred)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, ((stamp, file_id, _locate(session_times, session_ids, stamp),
           _locate(test_times, test_ids, stamp),
           _locate(position_times, position_ids, stamp), direction, count)
          for stamp, direction, count in plan.ip))
    written = plan.summary()["mapped"]
    written["lte"] = len(plan.lte) + len(plan.lte_secondary)
    return {"FileId": file_id, "MF": plan.mf_name,
            "lte_reports": len(plan.lte), **written}


def write_files(server, database, collection, parsed):
    """Commit each SQC atomically. Duplicate SQC/MF names abort before writing."""
    for _, plans in parsed:
        if any(plan.measurement_header.strip() != "MeasurementType=4" for plan in plans):
            raise ValueError("Native writes currently support only validated MeasurementType=4 data MFs")
    cn = _connection(server, database)
    written = []
    try:
        for sqc_path, plans in parsed:
            try:
                cursor = cn.cursor()
                lock = cursor.execute("""
                    SET NOCOUNT ON;
                    DECLARE @result int;
                    EXEC @result = sys.sp_getapplock
                      @Resource='REA_NativeSQC_Import', @LockMode='Exclusive',
                      @LockOwner='Transaction', @LockTimeout=10000;
                    SELECT @result;
                """).fetchone()[0]
                if lock < 0:
                    raise RuntimeError("Could not acquire import lock")
                for plan in plans:
                    if cursor.execute("SELECT 1 FROM dbo.FileList WHERE ASideFileName=?",
                                      plan.mf_name).fetchone():
                        raise ValueError(f"MF already exists in FileList: {plan.mf_name}")
                next_file = cursor.execute(
                    "SELECT ISNULL(MAX(FileId),0) FROM dbo.FileList WITH (TABLOCKX,HOLDLOCK)").fetchone()[0] + 1
                current = []
                for offset, plan in enumerate(plans):
                    current.append(_write_mf(cursor, next_file + offset, collection, plan))
                for row in current:
                    count = cursor.execute("SELECT COUNT_BIG(*) FROM dbo.FactTest WHERE FileId=?",
                                           row["FileId"]).fetchone()[0]
                    if count != row["tests"]:
                        raise RuntimeError(f"FactTest count mismatch for FileId {row['FileId']}")
                cn.commit()
                written.extend(current)
            except Exception:
                cn.rollback()
                raise
    finally:
        cn.close()
    return written
