"""Backfill LTE report/neighbor rows for this parser's partial DEMO import."""

import argparse
from pathlib import Path

from native_parser import parse_sqc
from native_writer import _connection, _id_base, _write_lte_reports


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--collection", required=True)
    cli.add_argument("--database", required=True)
    cli.add_argument("--server", default="swissqual-srvsa")
    cli.add_argument("--write", action="store_true")
    cli.add_argument("sqc", type=Path)
    args = cli.parse_args()
    if args.database.upper() != "DEMO":
        cli.error("This backfill is limited to DEMO")
    _, plans = parse_sqc(args.sqc)
    if not args.write:
        for plan in plans:
            print(plan.mf_name, "reports", len(plan.lte), "neighbors", len(plan.lte_neighbors))
        return
    cn = _connection(args.server, args.database)
    try:
        cur = cn.cursor()
        cur.execute("""
            SET NOCOUNT ON;
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock
              @Resource='REA_NativeSQC_Import', @LockMode='Exclusive',
              @LockOwner='Transaction', @LockTimeout=10000;
            SELECT @result;
        """)
        if cur.fetchone()[0] < 0:
            raise RuntimeError("Could not acquire import lock")
        for plan in plans:
            rows = cur.execute("""
                SELECT FileId FROM dbo.FileList
                WHERE ASideFileName=? AND CollectionName=? AND Valid=0
            """, plan.mf_name, args.collection).fetchall()
            if len(rows) != 1:
                raise ValueError(f"Expected one partial import for {plan.mf_name}")
            file_id = rows[0][0]
            base = _id_base(file_id)
            existing_report = cur.execute("""
                SELECT COUNT_BIG(*) FROM dbo.LTEMeasurementReport
                WHERE LTEMeasReportId BETWEEN ? AND ?
            """, base + 1, base + len(plan.lte)).fetchone()[0]
            existing_neighbor = cur.execute(
                "SELECT COUNT_BIG(*) FROM dbo.FactLTENeighbors WHERE FileId=?", file_id).fetchone()[0]
            if existing_report or existing_neighbor:
                raise ValueError(f"LTE rows already exist for FileId {file_id}")
            session_times = [row[0] for row in plan.sessions]
            session_ids = [base + i for i in range(1, len(plan.sessions) + 1)]
            position_times = [row[0] for row in plan.positions]
            position_ids = [base + i for i in range(1, len(plan.positions) + 1)]
            _write_lte_reports(cur, file_id, plan, session_times, session_ids,
                               position_times, position_ids)
            actual_report = cur.execute("""
                SELECT COUNT_BIG(*) FROM dbo.LTEMeasurementReport
                WHERE LTEMeasReportId BETWEEN ? AND ?
            """, base + 1, base + len(plan.lte)).fetchone()[0]
            actual_neighbor = cur.execute(
                "SELECT COUNT_BIG(*) FROM dbo.FactLTENeighbors WHERE FileId=?", file_id).fetchone()[0]
            if (actual_report, actual_neighbor) != (len(plan.lte), len(plan.lte_neighbors)):
                raise RuntimeError(f"LTE count mismatch for FileId {file_id}")
            print(file_id, "reports", actual_report, "neighbors", actual_neighbor)
        cn.commit()
    except Exception:
        cn.rollback()
        raise
    finally:
        cn.close()


if __name__ == "__main__":
    main()
