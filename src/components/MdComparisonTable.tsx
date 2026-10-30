import { useMemo, useState } from "react";
import { LABEL_TITLES } from "@/lib/commentAudit/labels";
import { classifyMd, type MdResult } from "@/lib/mdClassifier/classify";
import { labelFamily, mdFamily, type Family } from "@/lib/mdClassifier/families";
import type { AuditRow } from "./CommentAuditResults";

type Props = { results: readonly AuditRow[] };

interface Compared {
  r: AuditRow;
  md: MdResult;
  user: Family;
  mdFam: Family;
  audit: Family;
}

type Filter = "all" | "md_vs_audit" | "md_wrong" | "audit_wrong" | "out_of_scope";

const FILTERS: readonly { key: Filter; title: string; test: (c: Compared) => boolean }[] = [
  { key: "all", title: "Όλες", test: () => true },
  { key: "md_vs_audit", title: "md ≠ audit", test: (c) => c.mdFam !== "—" && c.mdFam !== c.audit },
  { key: "md_wrong", title: "md ≠ χρήστης", test: (c) => c.mdFam !== "—" && c.user !== "—" && c.mdFam !== c.user },
  { key: "audit_wrong", title: "audit ≠ χρήστης", test: (c) => c.user !== "—" && c.audit !== c.user },
  { key: "out_of_scope", title: "Εκτός md (CS-GSM)", test: (c) => c.md.kind === "out_of_scope" },
];

/** % συμφωνίας ανάμεσα σε δύο οικογένειες, μόνο όπου και οι δύο είναι γνωστές. */
function agreement(rows: readonly Compared[], a: (c: Compared) => Family, b: (c: Compared) => Family) {
  const known = rows.filter((c) => a(c) !== "—" && b(c) !== "—");
  const same = known.filter((c) => a(c) === b(c)).length;
  return { pct: known.length ? Math.round((100 * same) / known.length) : null, n: known.length };
}

const mark = (ok: boolean | null) => (ok == null ? <span className="text-muted-foreground">—</span> : ok ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>);
const same = (a: Family, b: Family) => (a === "—" || b === "—" ? null : a === b);

export default function MdComparisonTable({ results }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo<Compared[]>(
    () =>
      results.map((r) => {
        const md = classifyMd(r.bundle, r.row.status);
        return { r, md, user: labelFamily(r.comment?.label), mdFam: mdFamily(md), audit: labelFamily(r.score.topLabel) };
      }),
    [results],
  );
  const stats = [
    { title: "χρήστης ↔ md", ...agreement(rows, (c) => c.user, (c) => c.mdFam) },
    { title: "χρήστης ↔ audit", ...agreement(rows, (c) => c.user, (c) => c.audit) },
    { title: "md ↔ audit", ...agreement(rows, (c) => c.mdFam, (c) => c.audit) },
  ];
  const categories = Object.entries(rows.reduce<Record<string, number>>((m, c) => ({ ...m, [c.md.category]: (m[c.md.category] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const visible = rows.filter(active.test);

  return (
    <section className="space-y-3 border-t border-border pt-3" aria-labelledby="md-comparison-heading">
      <div>
        <h3 id="md-comparison-heading" className="text-sm font-bold">Σύγκριση: ταξινομητής md vs audit (pptx)</h3>
        <p className="text-[11px] text-muted-foreground max-w-3xl">
          Ο ταξινομητής md εφαρμόζει μόνο το volte-drop-fail-analysis.md §1.3–1.6 (αιτία drop / στάδιο fail, network/user από SIP κωδικούς) στα ίδια
          δεδομένα. Σύγκριση σε οικογένειες: RADIO (LC/LQ, RLF, HO, SRVCC, RRC…) · CORE · FAKE (md: UNKNOWN_LOG_GAP) · USER.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {stats.map((s) => (
          <div key={s.title} className="rounded-md border border-border px-3 py-2">
            <div className="text-muted-foreground">Συμφωνία {s.title}</div>
            <div className="text-xl font-bold">{s.pct == null ? "—" : `${s.pct}%`}</div>
            <div className="text-[10px] text-muted-foreground">{s.n} κλήσεις με γνωστές οικογένειες</div>
          </div>
        ))}
        <div className="rounded-md border border-border px-3 py-2">
          <div className="text-muted-foreground">Αποτελέσματα md</div>
          <div className="text-[11px] font-mono leading-5">{categories.map(([k, v]) => `${k} ${v}`).join(" · ")}</div>
        </div>
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
            {f.title} ({rows.filter(f.test).length})
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
              <th className="px-2 py-1.5 text-left">md (§1.6)</th>
              <th className="px-2 py-1.5 text-left">Audit (pptx)</th>
              <th className="px-2 py-1.5 text-center">md = χρήστης</th>
              <th className="px-2 py-1.5 text-center">audit = χρήστης</th>
              <th className="px-2 py-1.5 text-left">Ένδειξη md</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={String(c.r.row.SessionId)} className="border-t border-border/60 align-top">
                <td className="px-2 py-1.5 font-mono">{String(c.r.row.SessionId)}</td>
                <td className="px-2 py-1.5">{c.r.row.CollectionName || "—"}</td>
                <td className="px-2 py-1.5">{c.r.row.Location || "—"}</td>
                <td className="px-2 py-1.5">{c.r.row.status}</td>
                <td className="px-2 py-1.5">{String(c.r.bundle.analysisA?.technology ?? c.r.row.technology ?? "—")}</td>
                <td className="px-2 py-1.5">{c.r.comment?.raw ?? "—"} <span className="text-muted-foreground">({c.user})</span></td>
                <td className="px-2 py-1.5">
                  <span className="font-semibold">{c.md.category}</span>{" "}
                  <span className="text-muted-foreground">
                    {c.md.kind === "out_of_scope" ? "" : `· ${c.md.confidence} · ${c.md.networkOrUser} (${c.mdFam})`}
                  </span>
                </td>
                <td className="px-2 py-1.5">{LABEL_TITLES[c.r.score.topLabel]} <span className="text-muted-foreground">({c.audit})</span></td>
                <td className="px-2 py-1.5 text-center">{mark(same(c.mdFam, c.user))}</td>
                <td className="px-2 py-1.5 text-center">{mark(same(c.audit, c.user))}</td>
                <td className="px-2 py-1.5 max-w-[360px]">{c.md.evidence.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
