import { useMemo, useState } from "react";
import { callDetailUrl } from "@/lib/commentAudit/callDetailUrl";
import { LABEL_TITLES } from "@/lib/commentAudit/labels";
import { narrativeText } from "@/lib/commentAudit/narrative";
import type { Verdict } from "@/lib/commentAudit/scoring";
import type { AuditRow } from "./CommentAuditResults";

type Props = {
  /** Standard (pptx) και Historic (μοντέλο από το CSV) στις ίδιες κλήσεις. */
  standard: readonly AuditRow[];
  historic: readonly AuditRow[];
  /** Πόσες κλήσεις / ποιες βάσεις έχει το CSV που εκπαίδευσε το Historic. */
  trainedOn: string;
  database: string;
};

const VERDICT_TEXT: Record<Verdict, string> = {
  correct: "Σωστό",
  partial: "Μερικώς",
  wrong: "Λάθος",
  insufficient: "Ανεπαρκή",
  not_auditable: "Μη ελέγξιμο",
  no_comment: "Χωρίς σχόλιο",
};
/** Για «καλύτερο/χειρότερο»: πόσο συμφωνεί η ετυμηγορία με το σχόλιο του χρήστη. */
const VERDICT_RANK: Record<Verdict, number> = { correct: 3, partial: 2, insufficient: 1, not_auditable: 1, no_comment: 1, wrong: 0 };

type Change = "same" | "better" | "worse" | "relabel";

interface Pair {
  standard: AuditRow;
  historic: AuditRow;
  change: Change;
}

function changeOf(a: AuditRow, b: AuditRow): Change {
  const rankDiff = VERDICT_RANK[b.score.verdict] - VERDICT_RANK[a.score.verdict];
  if (rankDiff > 0) return "better";
  if (rankDiff < 0) return "worse";
  if (a.score.topLabel !== b.score.topLabel) return "relabel";
  return "same";
}

const CHANGE_TEXT: Record<Change, string> = { same: "=", better: "↑ καλύτερα", worse: "↓ χειρότερα", relabel: "άλλη ετικέτα" };
const CHANGE_CLASS: Record<Change, string> = {
  same: "text-muted-foreground",
  better: "text-emerald-400",
  worse: "text-red-400",
  relabel: "text-amber-400",
};

const FILTERS: readonly { key: "all" | "changed" | Change; title: string; test: (p: Pair) => boolean }[] = [
  { key: "all", title: "Όλες", test: () => true },
  { key: "changed", title: "Άλλαξαν", test: (p) => p.change !== "same" },
  { key: "better", title: "Καλύτερα", test: (p) => p.change === "better" },
  { key: "worse", title: "Χειρότερα", test: (p) => p.change === "worse" },
];

function correctPct(rows: readonly AuditRow[]) {
  const judged = rows.filter((r) => ["correct", "partial", "wrong"].includes(r.score.verdict));
  const correct = judged.filter((r) => r.score.verdict === "correct").length;
  return { pct: judged.length ? Math.round((100 * correct) / judged.length) : null, correct, judged: judged.length };
}

const verdictCell = (r: AuditRow) => (
  <>
    <span className="font-semibold">{LABEL_TITLES[r.score.topLabel]}</span>
    <span className="text-muted-foreground"> · {VERDICT_TEXT[r.score.verdict]}{r.score.grade != null ? ` · ${r.score.grade}` : ""}</span>
  </>
);

export default function StandardHistoricTable({ standard, historic, database, trainedOn }: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const pairs = useMemo<Pair[]>(() => {
    const bySession = new Map(historic.map((r) => [String(r.row.SessionId), r]));
    return standard.flatMap((a) => {
      const b = bySession.get(String(a.row.SessionId));
      return b ? [{ standard: a, historic: b, change: changeOf(a, b) }] : [];
    });
  }, [standard, historic]);

  const before = correctPct(standard);
  const after = correctPct(historic);
  const sameLabel = pairs.filter((p) => p.standard.score.topLabel === p.historic.score.topLabel).length;
  const count = (c: Change) => pairs.filter((p) => p.change === c).length;
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const visible = pairs.filter(active.test);

  return (
    <section className="space-y-3 border-t border-border pt-3" aria-labelledby="standard-historic-heading">
      <div>
        <h3 id="standard-historic-heading" className="text-sm font-bold">Σύγκριση: Standard vs Historic</h3>
        <p className="text-[11px] text-muted-foreground max-w-3xl">
          Standard = κανόνες του Call Analysis.pptx (πρώτα το ράδιο, RxLev Sub −93, RSRQ −15, Fake/Core) + content/collaborative filtering.
          Historic = μοντέλο (logistic regression) που έμαθε από το audit-kpis-historic.csv ({trainedOn}): από τις μετρήσεις κάθε κλήσης
          (ράδιο A/B και τέλος κλήσης, uplink, σηματοδοσία, tracelog) προβλέπει τι γράφουν οι χρήστες σε όμοιες κλήσεις — χωρίς να βλέπει το Standard.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <div className="rounded-md border border-border px-3 py-2">
          <div className="text-muted-foreground">Συμφωνία με το σχόλιο</div>
          <div className="text-xl font-bold">
            {before.pct ?? "—"}% → {after.pct ?? "—"}%
          </div>
          <div className="text-[10px] text-muted-foreground">
            Standard {before.correct}/{before.judged} · Historic {after.correct}/{after.judged} σωστά
          </div>
        </div>
        <div className="rounded-md border border-border px-3 py-2">
          <div className="text-muted-foreground">Ίδια αιτία</div>
          <div className="text-xl font-bold">{pairs.length ? Math.round((100 * sameLabel) / pairs.length) : "—"}%</div>
          <div className="text-[10px] text-muted-foreground">{sameLabel}/{pairs.length} κλήσεις</div>
        </div>
        {(["better", "worse", "relabel"] as const).map((c) => (
          <div key={c} className="rounded-md border border-border px-3 py-2">
            <div className={CHANGE_CLASS[c]}>{CHANGE_TEXT[c]}</div>
            <div className="text-xl font-bold">{count(c)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`rounded border px-2 py-1 text-[11px] ${filter === f.key ? "border-primary bg-primary/15" : "border-border bg-muted hover:bg-muted/70"}`}
          >
            {f.title} ({pairs.filter(f.test).length})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-2 py-1.5 text-left">SessionId</th>
              <th className="px-2 py-1.5 text-left">Collection</th>
              <th className="px-2 py-1.5 text-left">A-side Location</th>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 text-left">Tech</th>
              <th className="px-2 py-1.5 text-left">Σχόλιο χρήστη</th>
              <th className="px-2 py-1.5 text-left">Standard</th>
              <th className="px-2 py-1.5 text-left">Historic</th>
              <th className="px-2 py-1.5 text-left">Αλλαγή</th>
              <th className="px-2 py-1.5 text-left">Σχόλιο Historic</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ standard: a, historic: b, change }) => {
              const id = String(a.row.SessionId);
              return (
                <tr key={id} className="border-t border-border/60 align-top">
                  <td className="px-2 py-1.5 font-mono">
                    <a href={callDetailUrl(database, id, a.row.CollectionName, window.location.pathname)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {id}
                    </a>
                  </td>
                  <td className="px-2 py-1.5">{a.row.CollectionName || "—"}</td>
                  <td className="px-2 py-1.5">{a.row.Location || "—"}</td>
                  <td className="px-2 py-1.5">{a.row.status}</td>
                  <td className="px-2 py-1.5">{String(a.bundle.analysisA?.technology ?? a.row.technology ?? "—")}</td>
                  <td className="px-2 py-1.5">{a.comment?.raw ?? "—"}</td>
                  <td className="px-2 py-1.5">{verdictCell(a)}</td>
                  <td className="px-2 py-1.5">{verdictCell(b)}</td>
                  <td className={`px-2 py-1.5 whitespace-nowrap ${CHANGE_CLASS[change]}`}>{CHANGE_TEXT[change]}</td>
                  <td className="px-2 py-1.5 max-w-[520px]">{narrativeText(b.narrative)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
