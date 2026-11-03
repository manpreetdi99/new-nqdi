import { describe, expect, it } from "vitest";
import type { AuditRow } from "./CommentAuditResults";
import { nextSort, sortRows } from "./commentAuditSort";

const row = (id: number, verdict: string, grade: number | null) => ({ row: { SessionId: id }, score: { verdict, grade } }) as unknown as AuditRow;
const rows = [row(1, "partial", 60), row(2, "correct", 80), row(3, "no_comment", null), row(4, "wrong", 20), row(5, "correct", 95)];
const ids = (rs: readonly AuditRow[]) => rs.map((r) => r.row.SessionId);

describe("sorting Βαθμός / Ετυμηγορία", () => {
  it("sorts by grade, calls without a grade always last", () => {
    expect(ids(sortRows(rows, { key: "grade", dir: "desc" }))).toEqual([5, 2, 1, 4, 3]);
    expect(ids(sortRows(rows, { key: "grade", dir: "asc" }))).toEqual([4, 1, 2, 5, 3]);
  });

  it("sorts by verdict (Σωστό → Μερικώς → Λάθος → …), ties by grade", () => {
    expect(ids(sortRows(rows, { key: "verdict", dir: "desc" }))).toEqual([5, 2, 1, 4, 3]);
    expect(ids(sortRows(rows, { key: "verdict", dir: "asc" }))).toEqual([3, 4, 1, 2, 5]);
  });

  it("keeps the original order without sorting and cycles desc → asc → none", () => {
    expect(ids(sortRows(rows, null))).toEqual([1, 2, 3, 4, 5]);
    expect(nextSort(null, "grade")).toEqual({ key: "grade", dir: "desc" });
    expect(nextSort({ key: "grade", dir: "desc" }, "grade")).toEqual({ key: "grade", dir: "asc" });
    expect(nextSort({ key: "grade", dir: "asc" }, "grade")).toBeNull();
    expect(nextSort({ key: "grade", dir: "asc" }, "verdict")).toEqual({ key: "verdict", dir: "desc" });
  });
});
