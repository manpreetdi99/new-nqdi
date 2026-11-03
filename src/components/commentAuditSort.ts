/** Ταξινόμηση του πίνακα «User comment audit» κατά βαθμό / ετυμηγορία. */
import type { Verdict } from "@/lib/commentAudit/scoring";
import type { AuditRow } from "./CommentAuditResults";

/** Ταξινόμηση ετυμηγορίας: από τη μεγαλύτερη συμφωνία με το σχόλιο στη μικρότερη. */
const VERDICT_ORDER: Record<Verdict, number> = { correct: 5, partial: 4, wrong: 3, insufficient: 2, not_auditable: 1, no_comment: 0 };

export type SortKey = "grade" | "verdict";
export type SortDir = "asc" | "desc";
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

/** Ταξινομεί χωρίς να αλλάζει τον πίνακα· οι κλήσεις χωρίς βαθμό μένουν πάντα στο τέλος. */
export function sortRows(rows: readonly AuditRow[], sort: Sort | null): readonly AuditRow[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  const value = (r: AuditRow) => (sort.key === "grade" ? r.score.grade : VERDICT_ORDER[r.score.verdict]);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
    // Ισοπαλία ετυμηγορίας → κατά βαθμό, ίδια κατεύθυνση.
    const tie = sort.key === "verdict" ? (a.score.grade ?? -1) - (b.score.grade ?? -1) : 0;
    return sign * (va - vb || tie);
  });
}

/** Κλικ: φθίνουσα → αύξουσα → χωρίς ταξινόμηση. */
export const nextSort = (current: Sort | null, key: SortKey): Sort | null =>
  current?.key !== key ? { key, dir: "desc" } : current.dir === "desc" ? { key, dir: "asc" } : null;
