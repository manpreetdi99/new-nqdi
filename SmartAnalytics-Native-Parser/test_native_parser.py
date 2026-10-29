"""Checks against the supplied real SQC and the observed native SQL sample."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_parser import main, parse_sqc
from native_writer import _id_base, _locate, _write_mf, write_files


SAMPLE = (Path(__file__).resolve().parents[2] / "inputs" /
          "CSM30102303-2026-09-29-15-18-40-6454-2303-0000-0000.sqc")
VOICE = (Path(__file__).resolve().parents[2] / "inputs" / "2026_H2_VOICE" /
         "2026-09-29-15-17-13" /
         "CSM30102303-2026-09-29-15-17-13-1111-2303-0000-0000.sqc")


class NativeParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verified, cls.plans = parse_sqc(SAMPLE)

    def test_archive_and_native_session_test_counts(self):
        self.assertTrue(self.verified)
        self.assertEqual(len(self.plans), 3)
        self.assertEqual([len(p.sessions) for p in self.plans], [22, 22, 22])
        self.assertEqual([len(p.tests) for p in self.plans], [149, 149, 149])
        self.assertEqual([len(p.positions) for p in self.plans], [1455, 1445, 1458])

    def test_first_native_observations(self):
        plan = self.plans[0]
        self.assertEqual(plan.start.isoformat(timespec="milliseconds"), "2026-09-29T15:18:46.249")
        self.assertEqual(plan.positions[0][0], plan.start)
        self.assertEqual(plan.sessions[0][2], "IDLE")
        self.assertEqual(plan.sessions[1][2], "DATA")
        self.assertEqual(plan.sessions[1][0].isoformat(timespec="milliseconds"),
                         "2026-09-29T15:18:52.401")
        self.assertEqual(plan.tests[0][0].isoformat(timespec="milliseconds"),
                         "2026-09-29T15:18:52.403")
        self.assertEqual(plan.lte[0][1:4], (1700, 66, -100.6))
        self.assertEqual(plan.nr[0][1:4], (68, 630720, -112.0))

    def test_ids_and_nearest_session(self):
        self.assertEqual(_id_base(241) + 1, 1035087118337)
        plan = self.plans[0]
        times = [row[0] for row in plan.sessions]
        ids = [_id_base(241) + n for n in range(1, len(times) + 1)]
        self.assertEqual(_locate(times, ids, plan.tests[0][0]), 1035087118338)

    def test_native_insert_shapes_offline(self):
        class RecordingCursor:
            def __init__(self):
                self.tables = {}

            def execute(self, sql, *params):
                if sql.lstrip().startswith("INSERT"):
                    self.executemany(sql, [params])
                return self

            def fetchone(self):
                return (0,)

            def executemany(self, sql, rows):
                import re
                table = re.search(r"INSERT\s+dbo\.(\w+)", sql, re.I).group(1)
                count = sql.count("?")
                for row in rows:
                    if len(row) != count:
                        raise AssertionError(f"{table}: {len(row)} values for {count} parameters")
                    self.tables[table] = self.tables.get(table, 0) + 1

        cursor = RecordingCursor()
        summary = _write_mf(cursor, 999999, "TEST_COLLECTION", self.plans[0])
        self.assertEqual(cursor.tables["FileList"], 1)
        self.assertEqual(cursor.tables["Sessions"], 22)
        self.assertEqual(cursor.tables["FactTest"], 149)
        self.assertEqual(cursor.tables["LTEMeasurementReport"], 2286)
        self.assertEqual(cursor.tables["FactLTENeighbors"], 15305)
        self.assertEqual(summary["FileId"], 999999)
        self.assertEqual(summary["lte_neighbors"], 15305)

    def test_partial_write_is_blocked_on_known_production_db(self):
        with self.assertRaises(SystemExit) as error:
            main(["--collection", "TEST", "--write", "--accept-partial", str(SAMPLE)])
        self.assertEqual(error.exception.code, 2)

    def test_voice_preview_is_not_admitted_to_data_writer(self):
        _, voice_plans = parse_sqc(VOICE)
        self.assertEqual(len(voice_plans), 10)
        with self.assertRaisesRegex(ValueError, "MeasurementType=4"):
            write_files("swissqual-srvsa", "DEMO", "TEST", [(VOICE, voice_plans)])


if __name__ == "__main__":
    unittest.main()
