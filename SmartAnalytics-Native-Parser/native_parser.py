"""Independent SQC reader and conservative writer for native SmartAnalytics tables.

Only the table/field mappings listed in README.md are implemented. An import is
marked invalid in FileList so a partial reconstruction is never presented as
a completed Smart ETL run.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sqlite3
import sys
import tempfile
import zipfile
from bisect import bisect_right
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc)
ATHENS = ZoneInfo("Europe/Athens")
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_MEMBER = 256 * 1024 * 1024


def local_time(serial: float) -> datetime:
    value = (EPOCH + timedelta(days=float(serial))).astimezone(ATHENS).replace(tzinfo=None)
    return value.replace(microsecond=0) + timedelta(milliseconds=round(value.microsecond / 1000))


def numeric(value, low=None, high=None, integer=False):
    try:
        result = int(value) if integer else float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not integer and (result != result or abs(result) == float("inf")):
        return None
    if (low is not None and result < low) or (high is not None and result > high):
        return None
    return result


def fields(value):
    return value.split(",") if isinstance(value, str) else []


def value_at(parts, index, low=None, high=None, integer=False):
    return numeric(parts[index], low, high, integer) if index < len(parts) else None


def verify_checksum(path: Path):
    sidecar = Path(str(path) + ".md5")
    if not sidecar.exists():
        return False
    text = sidecar.read_text(encoding="utf-8-sig", errors="replace")[:4096]
    match = re.search(r"(?<![0-9a-fA-F])([0-9a-fA-F]{32})(?![0-9a-fA-F])", text)
    if not match:
        raise ValueError(f"Invalid MD5 sidecar: {sidecar}")
    digest = hashlib.md5()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest().lower() != match.group(1).lower():
        raise ValueError(f"MD5 mismatch: {path}")
    return True


@dataclass
class MfPlan:
    mf_name: str
    operator: str
    path_in_sqc: str
    start: datetime
    end: datetime
    measurement_header: str = ""
    source_counts: Counter = field(default_factory=Counter)
    positions: list = field(default_factory=list)
    sessions: list = field(default_factory=list)
    tests: list = field(default_factory=list)
    lte: list = field(default_factory=list)
    lte_secondary: list = field(default_factory=list)
    lte_neighbors: list = field(default_factory=list)
    nr: list = field(default_factory=list)
    ip: list = field(default_factory=list)

    def summary(self):
        return {
            "mf": self.mf_name, "operator": self.operator,
            "measurement_header": self.measurement_header,
            "start": self.start.isoformat(), "end": self.end.isoformat(),
            "source_messages": sum(self.source_counts.values()),
            "source_types": len(self.source_counts),
            "mapped": {name: len(getattr(self, name)) for name in
                       ("positions", "sessions", "tests", "lte", "lte_secondary",
                        "lte_neighbors", "nr", "ip")},
        }


def parse_mf(path: Path, name: str, operator: str, path_in_sqc: str) -> MfPlan:
    if path.stat().st_size > MAX_MEMBER:
        raise ValueError(f"MF too large: {name}")
    with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True) as db:
        db.execute("PRAGMA query_only=ON")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"Message", "Measurement"} <= tables:
            raise ValueError(f"Invalid MF schema: {name}")
        start_serial, end_serial = db.execute(
            "SELECT MIN(TimeStampCreated), MAX(TimeStampCreated) FROM Message").fetchone()
        if start_serial is None or end_serial is None:
            raise ValueError(f"Missing measurement times: {name}")
        header = db.execute("SELECT FileHeader FROM Measurement LIMIT 1").fetchone()[0] or ""
        plan = MfPlan(name, operator, path_in_sqc, local_time(start_serial), local_time(end_serial), header)
        plan.source_counts.update(dict(db.execute("SELECT MessageType, COUNT(*) FROM Message GROUP BY MessageType")))
        wanted = (100, 200, 201, 1001, 1023, 6206, 6207, 6208, 6604, 100000)
        sql = ("SELECT ID, MessageType, MessageData, TimeStampCreated FROM Message "
               "WHERE MessageType IN (" + ",".join("?" for _ in wanted) + ") "
               "ORDER BY TimeStampCreated, ID")
        transitions = []
        test_starts = []
        test_ends = []
        for message_id, kind, value, serial in db.execute(sql, wanted):
            if serial is None:
                continue
            stamp = local_time(serial)
            data = fields(value)
            if kind == 100 and value in ("DATA", "IDLE", "CALL"):
                transitions.append((stamp, value))
            elif kind == 200:
                test_starts.append(stamp)
            elif kind == 201:
                test_ends.append(stamp)
            elif kind in (1001, 1023):
                lat, lon = value_at(data, 0, -90, 90), value_at(data, 1, -180, 180)
                if lat is not None and lon is not None:
                    plan.positions.append((stamp, lat, lon))
            elif kind == 6206 and len(data) >= 7:
                row = (stamp, value_at(data, 1, 0, 1000000, True), value_at(data, 2, 0, 1007, True),
                       value_at(data, 3, -160, -30), value_at(data, 4, -60, 0), value_at(data, 5, -130, 20),
                       value_at(data, 6, -50, 80), 0)
                if any(v is not None for v in row[3:]):
                    plan.lte.append(row)
            elif kind == 6207 and len(data) >= 8:
                row = (stamp, value_at(data, 0, 0, 1007, True), value_at(data, 7, 0, 1000000, True),
                       value_at(data, 4, -160, -30), value_at(data, 5, -60, 0), value_at(data, 6, -130, 20))
                if any(v is not None for v in row[3:]):
                    plan.lte_neighbors.append(row)
            elif kind == 6208 and len(data) >= 7:
                carrier = value_at(data, 0, 1, 16, True)
                row = (stamp, value_at(data, 2, 0, 1000000, True), value_at(data, 3, 0, 1007, True),
                       value_at(data, 4, -160, -30), value_at(data, 5, -60, 0), value_at(data, 6, -130, 20),
                       None, carrier)
                if carrier is not None and any(v is not None for v in row[3:6]):
                    plan.lte_secondary.append(row)
            elif kind == 6604 and len(data) >= 9:
                row = (stamp, value_at(data, 2, 0, 1007, True), value_at(data, 3, 0, 1000000, True),
                       value_at(data, 6, -160, -30), value_at(data, 7, -60, 0), value_at(data, 8, -50, 80))
                if any(v is not None for v in row[3:]):
                    plan.nr.append(row)
            elif kind == 100000 and len(data) >= 3 and data[0] in ("Downlink", "Uplink"):
                count = value_at(data, 2, 0, 2147483647, True)
                if count is not None:
                    plan.ip.append((stamp, data[0], count))
        if plan.positions and plan.positions[0][0] > plan.start:
            # Native import materializes the initial file location at the
            # first message timestamp, reusing the first measured GPS point.
            plan.positions.insert(0, (plan.start, plan.positions[0][1], plan.positions[0][2]))
        transitions = [(stamp, kind) for stamp, kind in transitions if plan.start < stamp <= plan.end]
        boundaries = [(plan.start, "IDLE")] + transitions + [(plan.end, None)]
        for (start, kind), (end, _) in zip(boundaries, boundaries[1:]):
            duration = round((end - start).total_seconds() * 1000)
            if duration >= 100:
                plan.sessions.append((start, end, kind, duration))
        if len(test_starts) != len(test_ends):
            raise ValueError(f"Unpaired test start/end messages in {name}")
        for start, end in zip(test_starts, test_ends):
            duration = round((end - start).total_seconds() * 1000)
            if end < start or duration < 0:
                raise ValueError(f"Invalid test interval in {name}")
            plan.tests.append((start, end, duration))
        if not plan.sessions:
            raise ValueError(f"No sessions reconstructed in {name}")
        return plan


def parse_sqc(path: Path) -> tuple[bool, list[MfPlan]]:
    if not path.is_file() or path.suffix.lower() != ".sqc" or path.stat().st_size > MAX_ARCHIVE:
        raise ValueError(f"Expected SQC <= {MAX_ARCHIVE} bytes: {path}")
    checksum = verify_checksum(path)
    plans = []
    with zipfile.ZipFile(path) as outer:
        if len(outer.infolist()) > 100 or sum(item.file_size for item in outer.infolist()) > MAX_ARCHIVE:
            raise ValueError(f"SQC archive limits exceeded: {path}")
        for sqz in outer.infolist():
            if not sqz.filename.lower().endswith(".sqz"):
                continue
            if sqz.file_size > MAX_MEMBER:
                raise ValueError(f"SQZ too large: {sqz.filename}")
            with zipfile.ZipFile(io.BytesIO(outer.read(sqz))) as inner:
                mfs = [item for item in inner.infolist() if item.filename.lower().endswith(".mf")]
                if len(mfs) != 1 or mfs[0].file_size > MAX_MEMBER:
                    raise ValueError(f"Expected one MF in {sqz.filename}")
                with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
                    target = Path(directory) / "measurement.mf"
                    target.write_bytes(inner.read(mfs[0]))
                    plans.append(parse_mf(target, Path(mfs[0].filename).name,
                                          Path(sqz.filename).parent.name, sqz.filename))
    if not plans:
        raise ValueError(f"No SQZ/MF entries in {path}")
    return checksum, plans


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", required=True, help="Native FileList.CollectionName")
    parser.add_argument("--database", default="DOD_26H2")
    parser.add_argument("--server", default="swissqual-srvsa")
    parser.add_argument("--output", help="Optional JSON plan path")
    parser.add_argument("--write", action="store_true", help="Write supported native tables")
    parser.add_argument("--accept-partial", action="store_true",
                        help="Acknowledge that native ETL coverage is incomplete")
    parser.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args(argv)
    if not args.collection.strip() or len(args.collection) > 255:
        parser.error("collection must be 1-255 characters")
    if args.write and not args.accept_partial:
        parser.error("--write requires --accept-partial: native ETL mapping is incomplete")
    if args.write and args.database.upper() == "DOD_26H2":
        parser.error("partial native writes are disabled for DOD_26H2; use an isolated test database")
    result = {"collection": args.collection, "database": args.database, "files": []}
    parsed = []
    for path in args.files:
        checksum, plans = parse_sqc(path)
        parsed.append((path, plans))
        result["files"].append({"sqc": path.name, "md5_verified": checksum,
                                "members": [plan.summary() for plan in plans]})
    if args.write:
        from native_writer import write_files
        result["written"] = write_files(args.server, args.database, args.collection, parsed)
    output = json.dumps(result, indent=2, ensure_ascii=False, default=str)
    if args.output:
        Path(args.output).write_text(output + "\n", encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, sqlite3.Error, zipfile.BadZipFile) as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
