/**
 * «Κατά τα δεδομένα» = μείγμα Historic και Standard με βάρος από τη μπάρα (default 65% / 35%):
 * για κάθε αιτία, βάρος_Historic × %Historic + βάρος_Standard × %Standard. Τα % είναι αυτά που
 * δείχνει κάθε μοντέλο (mix, άθροισμα 100)· με κανόνα (DRB 3, TAU) το Standard δίνει 100% στην αιτία του.
 */
import { LABEL_TITLES, type AuditLabel } from "./labels";
import { toPercentages, type LabelShare } from "./scoring";

export const DEFAULT_HISTORIC_WEIGHT = 0.65;

export interface BlendedCause {
  label: AuditLabel;
  /** Τελικό ποσοστό (όλες οι αιτίες αθροίζουν 100). */
  pct: number;
  standardPct: number;
  historicPct: number;
}

const clampWeight = (w: number) => (Number.isFinite(w) ? Math.max(0, Math.min(1, w)) : DEFAULT_HISTORIC_WEIGHT);

/** Χωρίς Historic (μη εκπαιδευμένο μοντέλο) μετράει μόνο το Standard. */
export function blendMix(standard: readonly LabelShare[], historic: readonly LabelShare[] | null, historicWeight = DEFAULT_HISTORIC_WEIGHT): BlendedCause[] {
  const w = historic?.length ? clampWeight(historicWeight) : 0;
  const pctOf = (mix: readonly LabelShare[] | null, l: AuditLabel) => mix?.find((m) => m.label === l)?.pct ?? 0;
  const labels = [...new Set([...standard, ...(historic ?? [])].map((m) => m.label))];
  const raw = labels.map((l) => w * pctOf(historic, l) + (1 - w) * pctOf(standard, l));
  const pcts = toPercentages(raw);
  return labels
    .map((label, i) => ({ label, pct: pcts[i], standardPct: pctOf(standard, label), historicPct: pctOf(historic, label) }))
    .filter((c) => c.pct > 0)
    .sort((a, b) => b.pct - a.pct || b.historicPct - a.historicPct);
}

/** «52% LC GSM · 30% LQ GSM · 18% CORE NETWORK (DL CHANNEL RELEASE)» */
export const formatBlend = (blend: readonly BlendedCause[]) => blend.map((c) => `${c.pct}% ${LABEL_TITLES[c.label]}`).join(" · ");

/** «Historic 65% · Standard 35%» */
export const formatWeights = (historicWeight: number) => {
  const h = Math.round(100 * clampWeight(historicWeight));
  return `Historic ${h}% · Standard ${100 - h}%`;
};
