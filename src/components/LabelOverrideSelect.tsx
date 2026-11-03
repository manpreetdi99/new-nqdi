import { AUDIT_LABELS, LABEL_TITLES, type AuditLabel } from "@/lib/commentAudit/labels";
import type { AuditScore, LabelShare } from "@/lib/commentAudit/scoring";

type Props = {
  sessionId: string;
  score: AuditScore;
  /** «Κατά τα δεδομένα» (μείγμα Historic/Standard): η πρώτη αιτία είναι το «Αυτόματα». */
  mix: readonly LabelShare[];
  /** Η επιλογή του χρήστη για την κλήση, αλλιώς null (= αυτόματα, η πρώτη αιτία του «Κατά τα δεδομένα»). */
  value: AuditLabel | null;
  onChange: (sessionId: string, label: AuditLabel | null) => void;
};

/** Προτάσεις πρώτα: η ετικέτα του σχολίου και οι αιτίες του «Κατά τα δεδομένα» με το ποσοστό τους. */
function suggestions(score: AuditScore, mix: readonly LabelShare[]): { label: AuditLabel; text: string }[] {
  const out = new Map<AuditLabel, string>();
  if (score.userLabel) out.set(score.userLabel, `Σχόλιο: ${LABEL_TITLES[score.userLabel]}`);
  for (const m of mix) {
    const prev = out.get(m.label);
    out.set(m.label, prev ? `${prev} — ${m.pct}%` : `${LABEL_TITLES[m.label]} — ${m.pct}%`);
  }
  return [...out.entries()].map(([label, text]) => ({ label, text }));
}

/** Ο χρήστης διαλέγει ποια αιτία υπερισχύει σε κλήση «μερικώς» / «λάθος». */
export default function LabelOverrideSelect({ sessionId, score, mix, value, onChange }: Props) {
  const suggested = suggestions(score, mix);
  const auto = mix[0] ?? null;
  const others = AUDIT_LABELS.filter((l) => !suggested.some((s) => s.label === l));
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(sessionId, (e.target.value || null) as AuditLabel | null)}
      aria-label={`Αιτία που υπερισχύει για την κλήση ${sessionId}`}
      title="Διάλεξε ποια αιτία υπερισχύει· η επιλογή αποθηκεύεται και περνάει στο KPI export ως final_label"
      className={`max-w-[230px] rounded border px-1 py-0.5 text-xs bg-background ${value ? "border-primary text-primary font-semibold" : "border-border"}`}
    >
      <option value="">Αυτόματα: {LABEL_TITLES[auto?.label ?? score.topLabel]}{auto ? ` — ${auto.pct}%` : ""}</option>
      <optgroup label="Προτάσεις">
        {suggested.map((s) => (
          <option key={s.label} value={s.label}>{s.text}</option>
        ))}
      </optgroup>
      <optgroup label="Όλες οι κατηγορίες">
        {others.map((l) => (
          <option key={l} value={l}>{LABEL_TITLES[l]}</option>
        ))}
      </optgroup>
    </select>
  );
}
