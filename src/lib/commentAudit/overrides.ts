/**
 * Χειροκίνητη επιλογή της αιτίας που υπερισχύει, για κλήσεις όπου το audit βγάζει
 * «μερικώς» ή «λάθος». Αποθηκεύεται ανά βάση και SessionId (localStorage) και
 * περνάει στο KPI export ως τελική ετικέτα, ώστε να εκπαιδεύει το Historic.
 */
import { AUDIT_LABELS, type AuditLabel } from "./labels";
import type { Verdict } from "./scoring";

/** database → SessionId → ετικέτα */
export type LabelOverrides = Readonly<Record<string, Readonly<Record<string, AuditLabel>>>>;

export const OVERRIDES_STORAGE_KEY = "commentAudit.labelOverrides";

/** Ετυμηγορίες όπου ο χρήστης μπορεί να αλλάξει την αιτία που υπερισχύει. */
export const OVERRIDABLE_VERDICTS: ReadonlySet<Verdict> = new Set(["partial", "wrong"]);

const isAuditLabel = (v: unknown): v is AuditLabel => typeof v === "string" && (AUDIT_LABELS as readonly string[]).includes(v);

/** Η αποθηκευμένη επιλογή, μόνο αν είναι έγκυρη ετικέτα (το localStorage δεν είναι αξιόπιστο). */
export function overrideFor(overrides: LabelOverrides, database: string, sessionId: string): AuditLabel | null {
  const value = overrides?.[database]?.[sessionId];
  return isAuditLabel(value) ? value : null;
}

/** Νέο αντικείμενο με την επιλογή (ή χωρίς αυτή, όταν label = null). */
export function withOverride(overrides: LabelOverrides, database: string, sessionId: string, label: AuditLabel | null): LabelOverrides {
  const current = { ...(overrides?.[database] ?? {}) };
  if (label) current[sessionId] = label;
  else delete current[sessionId];
  return { ...overrides, [database]: current };
}
