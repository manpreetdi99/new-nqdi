/**
 * Βαθμολόγηση των user comments με υβριδικό recommender:
 *
 *  1. Content-based: κάθε ετικέτα έχει "προφίλ" χαρακτηριστικών. Το σκορ είναι
 *     μίξη ενός expert prior (τι περιμένουμε π.χ. για LC LTE) και του κεντροειδούς
 *     (Rocchio) των ΑΛΛΩΝ κλήσεων που ο χρήστης χαρακτήρισε με την ίδια ετικέτα.
 *  2. Collaborative: παραγοντοποίηση πίνακα (MF, SGD) στον πίνακα
 *     κλήσεις × [χαρακτηριστικά | ετικέτες χρήστη]. Η ετικέτα της κλήσης που
 *     κρίνεται κρύβεται (k-fold), οπότε το σκορ της βγαίνει μόνο από τις όμοιες κλήσεις.
 *  3. Hybrid = α·content + (1−α)·CF → βαθμός 0–100 και ετυμηγορία για το σχόλιο.
 */
import { AUDIT_LABELS, type AuditLabel, type ParsedComment } from "./labels";
import { FEATURE_KEYS, type FeatureVector } from "./evidence";
import { SPECIFIC_LABELS, hardRules, labelMatches, primaryEvidence, priorScore, type DrbRuleMode } from "./profiles";

export { HARD_RULES, PRIOR_PROFILES, hardRules, priorScore, profileFor, type DrbRuleMode } from "./profiles";

export type LabelScores = Readonly<Record<AuditLabel, number>>;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const vec = (x: FeatureVector) => FEATURE_KEYS.map((k) => x[k]);

function mapLabels(fn: (l: AuditLabel) => number): LabelScores {
  return Object.fromEntries(AUDIT_LABELS.map((l) => [l, fn(l)])) as Record<AuditLabel, number>;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((v, i) => {
    dot += v * b[i];
    na += v * v;
    nb += b[i] * b[i];
  });
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export interface AuditItem {
  id: string;
  comment: ParsedComment | null;
  features: FeatureVector;
}

/** Κάτω από τόσα παραδείγματα, το κεντροειδές είναι θόρυβος → μόνο prior. */
const MIN_CENTROID_EXAMPLES = 3;
const PRIOR_WEIGHT = 0.5;

interface CentroidSums {
  sum: number[];
  count: number;
}

function centroidSums(items: readonly AuditItem[]): Map<AuditLabel, CentroidSums> {
  const sums = new Map<AuditLabel, CentroidSums>();
  for (const it of items) {
    const label = it.comment?.label;
    if (!label) continue;
    const prev = sums.get(label) ?? { sum: FEATURE_KEYS.map(() => 0), count: 0 };
    const v = vec(it.features);
    sums.set(label, { sum: prev.sum.map((s, i) => s + v[i]), count: prev.count + 1 });
  }
  return sums;
}

/** Content-based σκορ μιας κλήσης· το κεντροειδές της δικής της ετικέτας ΔΕΝ την περιέχει. */
export function contentScores(item: AuditItem, sums: Map<AuditLabel, CentroidSums>): LabelScores {
  const x = vec(item.features);
  return mapLabels((label) => {
    const prior = priorScore(label, item.features);
    const s = sums.get(label);
    if (!s) return prior;
    const own = item.comment?.label === label;
    const count = s.count - (own ? 1 : 0);
    if (count < MIN_CENTROID_EXAMPLES) return prior;
    const centroid = s.sum.map((v, i) => (v - (own ? x[i] : 0)) / count);
    return clamp01(PRIOR_WEIGHT * prior + (1 - PRIOR_WEIGHT) * cosine(x, centroid));
  });
}

export interface MfOptions {
  rank: number;
  epochs: number;
  learningRate: number;
  regularization: number;
  folds: number;
  seed: number;
}

export const DEFAULT_MF: MfOptions = { rank: 4, epochs: 250, learningRate: 0.05, regularization: 0.02, folds: 5, seed: 42 };

/** mulberry32 — ντετερμινιστικό, ώστε το ίδιο dataset να δίνει πάντα τους ίδιους βαθμούς. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cell {
  row: number;
  col: number;
  value: number;
}

function factorize(rows: number, cols: number, cells: readonly Cell[], opt: MfOptions, seed: number) {
  const rand = rng(seed);
  const U = Array.from({ length: rows }, () => Array.from({ length: opt.rank }, () => rand() * 0.3));
  const V = Array.from({ length: cols }, () => Array.from({ length: opt.rank }, () => rand() * 0.3));
  const order = cells.map((_, i) => i);
  for (let epoch = 0; epoch < opt.epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const idx of order) {
      const { row, col, value } = cells[idx];
      const u = U[row];
      const v = V[col];
      const err = value - u.reduce((s, uk, k) => s + uk * v[k], 0);
      for (let k = 0; k < opt.rank; k++) {
        const uk = u[k];
        u[k] += opt.learningRate * (err * v[k] - opt.regularization * uk);
        v[k] += opt.learningRate * (err * uk - opt.regularization * v[k]);
      }
    }
  }
  return { U, V };
}

/**
 * Collaborative σκορ ανά κλήση. Στήλες = χαρακτηριστικά + ετικέτες· οι ετικέτες των
 * κλήσεων του τρέχοντος fold κρύβονται και προβλέπονται από τους λανθάνοντες παράγοντες.
 */
export function collaborativeScores(items: readonly AuditItem[], opt: MfOptions = DEFAULT_MF): LabelScores[] {
  const F = FEATURE_KEYS.length;
  const cols = F + AUDIT_LABELS.length;
  const featureCells: Cell[] = items.flatMap((it, row) => vec(it.features).map((value, col) => ({ row, col, value })));
  const fold = (row: number) => row % opt.folds;
  const out: LabelScores[] = new Array(items.length);

  for (let f = 0; f < opt.folds; f++) {
    const rowsInFold = items.map((_, r) => r).filter((r) => fold(r) === f);
    if (rowsInFold.length === 0) continue;
    const labelCells: Cell[] = items.flatMap((it, row) => {
      const label = it.comment?.label;
      if (!label || fold(row) === f) return [];
      return AUDIT_LABELS.map((l, i) => ({ row, col: F + i, value: l === label ? 1 : 0 }));
    });
    const { U, V } = factorize(items.length, cols, [...featureCells, ...labelCells], opt, opt.seed + f);
    for (const r of rowsInFold) {
      out[r] = mapLabels((l) => clamp01(U[r].reduce((s, uk, k) => s + uk * V[F + AUDIT_LABELS.indexOf(l)][k], 0)));
    }
  }
  return out;
}

/** "no_comment" = κλήση χωρίς σχόλιο χρήστη: μόνο η αιτία κατά τα δεδομένα, χωρίς βαθμό. */
export type Verdict = "correct" | "partial" | "wrong" | "insufficient" | "not_auditable" | "no_comment";

export interface AuditScore {
  id: string;
  content: LabelScores;
  collaborative: LabelScores | null;
  hybrid: LabelScores;
  userLabel: AuditLabel | null;
  topLabel: AuditLabel;
  topScore: number;
  userScore: number | null;
  /** 0–100: πόσο στηρίζουν τα δεδομένα την ετικέτα του χρήστη. null όταν δεν αξιολογείται. */
  grade: number | null;
  verdict: Verdict;
  /** Κανόνας που αποφάσισε την ετικέτα (υπερισχύει του content/CF), αλλιώς null. */
  rule: string | null;
  /** Κατανομή των πιθανών αιτιών σε ποσοστά (άθροισμα 100), από την πιο πιθανή. Κενή όταν δεν κρίνεται. */
  mix: readonly LabelShare[];
}

export interface LabelShare {
  label: AuditLabel;
  pct: number;
}

/** Λιγότερες ετικέτες από αυτό → το MF δεν έχει τι να μάθει, μένει μόνο το content. */
const MIN_LABELED_FOR_CF = 10;
const CONTENT_WEIGHT = 0.6;
const MIN_EVIDENCE = 0.2;
const TIE_MARGIN = 0.05;
const STRONG_OWN_EVIDENCE = 0.6;
const RADIO_LABELS: ReadonlySet<AuditLabel> = new Set(["LC_LTE", "LQ_LTE", "LC_GSM", "LQ_GSM"]);

/**
 * `ownEvidence` = πόσο υπάρχει η κύρια ένδειξη της ετικέτας του χρήστη (0..1, βλ. primaryEvidence).
 * Αν είναι ισχυρή, το σχόλιο δεν είναι "λάθος" ακόμη κι αν κάτι άλλο βγαίνει πρώτο
 * (π.χ. LC GSM στην A και ταυτόχρονα LC LTE στη B) — είναι το πολύ "μερικώς".
 */
export function verdictFor(userScore: number, topScore: number, isTop: boolean, ownEvidence = 0): Verdict {
  if (topScore < MIN_EVIDENCE) return "insufficient";
  if (isTop || userScore >= topScore - TIE_MARGIN) return "correct";
  if (userScore >= 0.5 * topScore || ownEvidence >= STRONG_OWN_EVIDENCE) return "partial";
  return "wrong";
}

const MIX_MAX_LABELS = 3;
/** Στην κατανομή μπαίνουν αιτίες με σκορ τουλάχιστον τόσο σε σχέση με την πρώτη. */
const MIX_RELATIVE = 0.5;

/** Ποσοστά ακέραια με άθροισμα ακριβώς 100 (μέθοδος μεγαλύτερου υπολοίπου). */
export function toPercentages(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (100 * v) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((v, i) => [v - floors[i], i] as const).sort((a, b) => b[0] - a[0]);
  const out = [...floors];
  for (const [, i] of byRemainder) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

/**
 * Κατανομή των αιτιών που στηρίζουν τα δεδομένα (π.χ. 50% UL disconnect · 50% LC LTE):
 * έως 3 αιτίες με σκορ ≥ 50% της πρώτης, κανονικοποιημένες στο 100. Στο "μερικώς"
 * μπαίνει πάντα και η ετικέτα του χρήστη, ώστε να φαίνεται πόσο τη στηρίζουν.
 */
export function labelMix(hybrid: LabelScores, candidates: readonly AuditLabel[], userLabel: AuditLabel | null, verdict: Verdict): LabelShare[] {
  const ranked = [...candidates].sort((a, b) => hybrid[b] - hybrid[a]);
  const top = ranked.length ? hybrid[ranked[0]] : 0;
  if (top < MIN_EVIDENCE) return [];
  const picked = ranked.filter((l) => hybrid[l] >= Math.max(MIN_EVIDENCE, MIX_RELATIVE * top)).slice(0, MIX_MAX_LABELS);
  const needsUser = verdict === "partial" && userLabel && hybrid[userLabel] > 0 && !picked.some((l) => labelMatches(userLabel, l));
  const labels = needsUser && userLabel ? [...picked, userLabel] : picked;
  const pcts = toPercentages(labels.map((l) => hybrid[l]));
  return labels.map((label, i) => ({ label, pct: pcts[i] })).filter((s) => s.pct > 0);
}

export interface AuditOptions {
  /** Πώς εφαρμόζεται ο κανόνας DRB 3 του audit (βλ. DrbRuleMode). */
  drbRule?: DrbRuleMode;
}

export function auditComments(items: readonly AuditItem[], mf: MfOptions = DEFAULT_MF, options: AuditOptions = {}): AuditScore[] {
  const rules = hardRules(options.drbRule);
  const sums = centroidSums(items);
  const labeled = items.filter((i) => i.comment?.label).length;
  const cf = labeled >= MIN_LABELED_FOR_CF ? collaborativeScores(items, mf) : null;
  const alpha = cf ? CONTENT_WEIGHT : 1;

  return items.map((item, r) => {
    const content = contentScores(item, sums);
    const collaborative = cf ? cf[r] : null;
    const hybrid = mapLabels((l) => alpha * content[l] + (1 - alpha) * (collaborative?.[l] ?? 0));
    const userLabel = item.comment?.label ?? null;
    const rule = rules.find((r) => r.applies(item.features));
    if (rule) {
      const base = { id: item.id, content, collaborative, hybrid, userLabel, topLabel: rule.label, topScore: 1, rule: rule.description, mix: [{ label: rule.label, pct: 100 }] };
      if (!userLabel) return { ...base, userScore: null, grade: null, verdict: item.comment ? "not_auditable" : "no_comment" };
      const match = labelMatches(userLabel, rule.label);
      return { ...base, userScore: match ? 1 : 0, grade: match ? 100 : 0, verdict: match ? "correct" : "wrong" };
    }

    // Πρώτη ετικέτα = η πιο συγκεκριμένη (όχι γενική) και όχι ετικέτα κανόνα που δεν ισχύει.
    const candidates = SPECIFIC_LABELS.filter((l) => !rules.some((r) => r.exclusive && r.label === l));
    const [topLabel, topScore] = candidates.map((l) => [l, hybrid[l]] as const).reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    if (!userLabel) {
      const verdict: Verdict = item.comment ? "not_auditable" : "no_comment";
      return { id: item.id, content, collaborative, hybrid, userLabel, topLabel, topScore, userScore: null, grade: null, verdict, rule: null, mix: labelMix(hybrid, candidates, null, verdict) };
    }
    const userScore = hybrid[userLabel];
    const relative = topScore > 0 ? userScore / topScore : 0;
    const grade = Math.round(100 * clamp01(0.5 * userScore + 0.5 * relative));
    // Σχόλιο κάλυψης/ποιότητας χωρίς δείγματα ράδιο ΚΑΙ χωρίς σχετική σημείωση του native
    // classifier ("Low RxLev" κ.λπ.): δεν επιβεβαιώνεται ούτε διαψεύδεται.
    const nativeHint = userLabel.endsWith("_GSM") ? item.features.nativeLowGsm : item.features.nativeLowLte;
    const unverifiableRadio = RADIO_LABELS.has(userLabel) && item.features.noRadio === 1 && nativeHint === 0;
    const verdict = unverifiableRadio
      ? "insufficient"
      : verdictFor(userScore, topScore, labelMatches(userLabel, topLabel), primaryEvidence(userLabel, item.features));
    const mix = verdict === "insufficient" ? [] : labelMix(hybrid, candidates, userLabel, verdict);
    return { id: item.id, content, collaborative, hybrid, userLabel, topLabel, topScore, userScore, grade, verdict, rule: null, mix };
  });
}
