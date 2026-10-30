import { Fragment, useMemo, useState } from "react";
import type { AllCallsRow } from "@/lib/api";
import type { CallEvidence, CallEvidenceBundle } from "@/lib/commentAudit/evidence";
import { LABEL_TITLES, type AuditLabel, type ParsedComment } from "@/lib/commentAudit/labels";
import { narrativeText, type Narrative } from "@/lib/commentAudit/narrative";
import type { AuditScore, Verdict } from "@/lib/commentAudit/scoring";

export interface AuditRow {
  row: AllCallsRow;
  comment: ParsedComment | null;
  evidence: CallEvidence;
  /** Τα δεδομένα του backend, για τον ταξινομητή του md (χωρίς νέα requests). */
  bundle: CallEvidenceBundle;
  failedSources: readonly string[];
  score: AuditScore;
  narrative: Narrative;
}

type Props = { results: readonly AuditRow[] };

const VERDICT_TEXT: Record<Verdict, string> = {
  correct: "Σωστό",
  partial: "Μερικώς",
  wrong: "Λάθος",
  insufficient: "Ανεπαρκή δεδομένα",
  not_auditable: "Μη ελέγξιμο",
  no_comment: "Χωρίς σχόλιο",
};

const VERDICT_CLASS: Record<Verdict, string> = {
  correct: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  partial: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  wrong: "bg-red-500/15 text-red-400 border-red-500/40",
  insufficient: "bg-muted text-muted-foreground border-border",
  not_auditable: "bg-muted text-muted-foreground border-border",
  no_comment: "bg-muted/50 text-muted-foreground border-border",
};

/** "drb" = μόνο οι κλήσεις όπου εφαρμόστηκε ο κανόνας DRB 3. */
type VerdictFilter = Verdict | "all" | "drb";

interface LabelSummary {
  label: AuditLabel;
  n: number;
  counts: Record<Verdict, number>;
  avgGrade: number | null;
  topSuggestion: AuditLabel | null;
}

function summarizeByLabel(results: readonly AuditRow[]): LabelSummary[] {
  const groups = new Map<AuditLabel, AuditRow[]>();
  for (const r of results) {
    const label = r.score.userLabel;
    if (label) groups.set(label, [...(groups.get(label) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([label, rows]) => {
      const counts = { correct: 0, partial: 0, wrong: 0, insufficient: 0, not_auditable: 0, no_comment: 0 } as Record<Verdict, number>;
      rows.forEach((r) => { counts[r.score.verdict] += 1; });
      const graded = rows.filter((r) => r.score.grade != null);
      const disagreements = rows.filter((r) => r.score.verdict === "wrong" || r.score.verdict === "partial").map((r) => r.score.topLabel);
      const topSuggestion = disagreements.length
        ? disagreements.reduce((best, l, _, all) => (all.filter((x) => x === l).length > all.filter((x) => x === best).length ? l : best))
        : null;
      return {
        label,
        n: rows.length,
        counts,
        avgGrade: graded.length ? Math.round(graded.reduce((s, r) => s + (r.score.grade ?? 0), 0) / graded.length) : null,
        topSuggestion,
      };
    })
    .sort((a, b) => b.n - a.n);
}

function gradeClass(grade: number | null) {
  if (grade == null) return "text-muted-foreground";
  if (grade >= 70) return "text-emerald-400";
  if (grade >= 40) return "text-amber-400";
  return "text-red-400";
}

export default function CommentAuditResults({ results }: Props) {
  const [filter, setFilter] = useState<VerdictFilter>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const byLabel = useMemo(() => summarizeByLabel(results), [results]);
  const auditable = results.filter((r) => r.score.verdict !== "not_auditable" && r.score.verdict !== "insufficient" && r.score.verdict !== "no_comment");
  const agreement = auditable.length ? Math.round((100 * auditable.filter((r) => r.score.verdict === "correct").length) / auditable.length) : null;
  const drbRows = results.filter((r) => r.score.topLabel === "CORE_DRB_RELEASE" && r.score.rule);
  const visible = filter === "all" ? results : filter === "drb" ? drbRows : results.filter((r) => r.score.verdict === filter);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs">
        <div className="rounded-md border border-border px-3 py-2">
          <div className="text-muted-foreground">Συμφωνία με τα δεδομένα</div>
          <div className="text-xl font-bold">{agreement == null ? "—" : `${agreement}%`}</div>
          <div className="text-[10px] text-muted-foreground">{auditable.length} σχόλια που κρίθηκαν</div>
        </div>
        {(Object.keys(VERDICT_TEXT) as Verdict[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setFilter(filter === v ? "all" : v)}
            aria-pressed={filter === v}
            className={`rounded-md border px-3 py-2 text-left transition-colors ${VERDICT_CLASS[v]} ${filter === v ? "ring-2 ring-primary" : "hover:brightness-125"}`}
          >
            <div>{VERDICT_TEXT[v]}</div>
            <div className="text-xl font-bold">{results.filter((r) => r.score.verdict === v).length}</div>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFilter(filter === "drb" ? "all" : "drb")}
          aria-pressed={filter === "drb"}
          className={`rounded-md border px-3 py-2 text-left transition-colors border-sky-500/40 bg-sky-500/10 text-sky-300 ${filter === "drb" ? "ring-2 ring-primary" : "hover:brightness-125"}`}
        >
          <div>Κανόνας DRB</div>
          <div className="text-xl font-bold">{drbRows.length}</div>
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-2 py-1.5 text-left">Σχόλιο χρήστη (κατηγορία)</th>
              <th className="px-2 py-1.5 text-right">Κλήσεις</th>
              <th className="px-2 py-1.5 text-right">Σωστό</th>
              <th className="px-2 py-1.5 text-right">Μερικώς</th>
              <th className="px-2 py-1.5 text-right">Λάθος</th>
              <th className="px-2 py-1.5 text-right">Ανεπαρκή</th>
              <th className="px-2 py-1.5 text-right">Μέσος βαθμός</th>
              <th className="px-2 py-1.5 text-left">Συχνότερη εναλλακτική</th>
            </tr>
          </thead>
          <tbody>
            {byLabel.map((s) => (
              <tr key={s.label} className="border-t border-border/60">
                <td className="px-2 py-1.5 font-medium">{LABEL_TITLES[s.label]}</td>
                <td className="px-2 py-1.5 text-right font-mono">{s.n}</td>
                <td className="px-2 py-1.5 text-right font-mono">{s.counts.correct}</td>
                <td className="px-2 py-1.5 text-right font-mono">{s.counts.partial}</td>
                <td className="px-2 py-1.5 text-right font-mono">{s.counts.wrong}</td>
                <td className="px-2 py-1.5 text-right font-mono">{s.counts.insufficient}</td>
                <td className={`px-2 py-1.5 text-right font-mono ${gradeClass(s.avgGrade)}`}>{s.avgGrade ?? "—"}</td>
                <td className="px-2 py-1.5">{s.topSuggestion ? LABEL_TITLES[s.topSuggestion] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-2 py-1.5 text-left">SessionId</th>
              <th className="px-2 py-1.5 text-left">Collection</th>
              <th className="px-2 py-1.5 text-left">A-side Location</th>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 text-left">Σχόλιο χρήστη</th>
              <th className="px-2 py-1.5 text-right">Βαθμός</th>
              <th className="px-2 py-1.5 text-left">Ετυμηγορία</th>
              <th className="px-2 py-1.5 text-left">Κατά τα δεδομένα</th>
              <th className="px-2 py-1.5 text-left">Περίληψη</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const id = String(r.row.SessionId);
              const isOpen = expanded.has(id);
              const text = narrativeText(r.narrative);
              return (
                <Fragment key={id}>
                  <tr className="border-t border-border/60 align-top">
                    <td className="px-2 py-1.5 font-mono">{id}</td>
                    <td className="px-2 py-1.5">{r.row.CollectionName || "—"}</td>
                    <td className="px-2 py-1.5">{r.row.Location || "—"}</td>
                    <td className="px-2 py-1.5">{r.row.status}</td>
                    <td className="px-2 py-1.5">{r.comment?.raw ?? "—"}</td>
                    <td className={`px-2 py-1.5 text-right font-mono font-semibold ${gradeClass(r.score.grade)}`}>{r.score.grade ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-block rounded border px-1.5 py-0.5 ${VERDICT_CLASS[r.score.verdict]}`}>{VERDICT_TEXT[r.score.verdict]}</span>
                    </td>
                    <td className="px-2 py-1.5">{LABEL_TITLES[r.score.topLabel]}</td>
                    <td className="px-2 py-1.5 max-w-[520px]">
                      <button type="button" onClick={() => toggle(id)} aria-expanded={isOpen} className="text-left hover:underline">
                        <span className={isOpen ? "" : "line-clamp-2"}>{text}</span>
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/30">
                      <td colSpan={9} className="px-3 py-2 space-y-1">
                        <div className="font-semibold">Όλα τα ευρήματα:</div>
                        <ul className="list-disc pl-5">
                          {r.evidence.facts.map((f, i) => <li key={i}>{f.text}</li>)}
                          {r.evidence.facts.length === 0 && <li>Καμία ένδειξη.</li>}
                        </ul>
                        <div className="text-muted-foreground">
                          Σκορ — content: {r.score.content[r.score.userLabel ?? r.score.topLabel].toFixed(2)}
                          {r.score.collaborative && ` · collaborative (MF): ${r.score.collaborative[r.score.userLabel ?? r.score.topLabel].toFixed(2)}`}
                          {` · hybrid: ${r.score.hybrid[r.score.userLabel ?? r.score.topLabel].toFixed(2)}`}
                          {r.failedSources.length > 0 && ` · δεν ήρθαν: ${r.failedSources.join(", ")}`}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
