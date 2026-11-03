/**
 * Historic: μοντέλο που μαθαίνει από το audit-kpis-historic.csv, ανεξάρτητο από το Standard (pptx).
 *
 * Multinomial logistic regression στις ΜΕΤΡΗΣΕΙΣ κάθε κλήσης (ράδιο A/B και τέλος κλήσης, uplink,
 * σηματοδοσία, tracelog) με στόχο το σχόλιο του χρήστη. Δεν βλέπει τα αποτελέσματα του Standard
 * ούτε τις ερμηνείες ράδιο του (f_lteLowRsrp κ.λπ.). Εκπαιδεύεται εκτός εφαρμογής από το
 * historic/train.py → historic/model.json. Για τις κλήσεις του training χρησιμοποιούνται οι
 * out-of-fold πιθανότητες (το μοντέλο δεν έχει δει τη συγκεκριμένη κλήση).
 */
import { AUDIT_LABELS, LABEL_TITLES, type AuditLabel, type ParsedComment } from "./labels";
import { measuredKpis, type KpiValue, type MeasuredInput } from "./kpiExport";
import { formatMix, type Narrative } from "./narrative";
import { labelMatches } from "./profiles";
import { toPercentages, type AuditScore, type LabelScores, type LabelShare, type Verdict } from "./scoring";
import modelJson from "./historic/model.json";

export interface HistoricFeature {
  /** Στήλη του CSV, «στήλη=τιμή» για κατηγορικές (one-hot) ή «στήλη_present» (υπάρχει τιμή). */
  name: string;
  mean: number;
  std: number;
}

export interface HistoricModel {
  version: number;
  trainedAt: string | null;
  databases: readonly string[];
  rows: number;
  classes: readonly string[];
  features: readonly HistoricFeature[];
  /** coef[κλάση][feature] στα standardized features. */
  coef: readonly (readonly number[])[];
  intercept: readonly number[];
  /** «database:SessionId» → out-of-fold πιθανότητες (σειρά = classes). */
  oof: Readonly<Record<string, readonly number[]>>;
  cv: { accuracy: number | null; folds: number };
}

export const HISTORIC_MODEL = modelJson as HistoricModel;

const MIX_MAX_LABELS = 3;
const MIX_MIN_PROB = 0.1;
const MIX_RELATIVE = 0.25;
const TIE_MARGIN = 0.05;
const PARTIAL_RELATIVE = 0.5;
const TOP_FACTORS = 3;
/** «sip_5xx_code_present» = 1 αν η στήλη sip_5xx_code έχει τιμή. */
const PRESENT_SUFFIX = "_present";

const isLabel = (v: string): v is AuditLabel => (AUDIT_LABELS as readonly string[]).includes(v);
export const historicKey = (database: string, sessionId: string) => `${database}:${sessionId}`;
const isIndicator = (name: string) => name.includes("=") || name.endsWith(PRESENT_SUFFIX);
export const isTrained = (model: HistoricModel) => model.classes.length > 1 && model.features.length > 0;

/** Τιμή ενός feature από τη γραμμή KPI (κατηγορικά: 1 αν η στήλη έχει αυτή την τιμή). */
function featureValue(f: HistoricFeature, kpis: Readonly<Record<string, KpiValue>>): number | null {
  if (f.name.endsWith(PRESENT_SUFFIX)) {
    const base = kpis[f.name.slice(0, -PRESENT_SUFFIX.length)];
    return base == null || base === "" ? 0 : 1;
  }
  const eq = f.name.indexOf("=");
  if (eq > 0) return String(kpis[f.name.slice(0, eq)] ?? "") === f.name.slice(eq + 1) ? 1 : 0;
  const v = kpis[f.name];
  if (v == null || v === "") return null;
  const n = typeof v === "boolean" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Standardized τιμές· ό,τι λείπει = μέσος όρος (0). */
function standardized(model: HistoricModel, kpis: Readonly<Record<string, KpiValue>>): number[] {
  return model.features.map((f) => {
    const v = featureValue(f, kpis);
    return v == null || f.std === 0 ? 0 : (v - f.mean) / f.std;
  });
}

function softmax(logits: readonly number[]): number[] {
  const max = Math.max(...logits);
  const exp = logits.map((l) => Math.exp(l - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / sum);
}

export interface HistoricPrediction {
  probs: readonly number[];
  /** true = πιθανότητες από fold που δεν περιείχε την κλήση (κλήση του training). */
  outOfFold: boolean;
  /** Τα features που ανέβασαν περισσότερο την πρώτη αιτία: [όνομα, τιμή]. */
  factors: readonly (readonly [string, number])[];
}

export function historicPredict(model: HistoricModel, kpis: Readonly<Record<string, KpiValue>>, key: string): HistoricPrediction | null {
  if (!isTrained(model)) return null;
  const z = standardized(model, kpis);
  const logits = model.coef.map((w, c) => model.intercept[c] + w.reduce((s, wj, j) => s + wj * z[j], 0));
  const oof = model.oof[key];
  const probs = oof && oof.length === model.classes.length ? oof : softmax(logits);
  const top = probs.indexOf(Math.max(...probs));
  const factors = model.features
    .map((f, j) => [f.name, model.coef[top][j] * z[j], featureValue(f, kpis)] as const)
    // Κατηγορικά/«υπάρχει» με τιμή 0 δεν είναι λόγος για την περίληψη («technology=LTE = 0»).
    .filter(([name, contribution, raw]) => contribution > 0 && raw != null && !(isIndicator(name) && raw === 0))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_FACTORS)
    .map(([name, , raw]) => [name, raw as number] as const);
  return { probs, outOfFold: Boolean(oof), factors };
}

function verdictOf(userLabel: AuditLabel | null, comment: ParsedComment | null, known: boolean, userProb: number, top: number, isTop: boolean): Verdict {
  if (!userLabel) return comment ? "not_auditable" : "no_comment";
  if (!known) return "not_auditable";
  if (isTop || userProb >= top - TIE_MARGIN) return "correct";
  if (userProb >= PARTIAL_RELATIVE * top) return "partial";
  return "wrong";
}

/** Αποτέλεσμα Historic στο ίδιο σχήμα με το Standard (για πίνακες, export, περίληψη). */
export function historicScore(model: HistoricModel, id: string, comment: ParsedComment | null, pred: HistoricPrediction): AuditScore {
  const byLabel = new Map(model.classes.filter(isLabel).map((l) => [l, pred.probs[model.classes.indexOf(l)] ?? 0]));
  const scores = Object.fromEntries(AUDIT_LABELS.map((l) => [l, byLabel.get(l) ?? 0])) as Record<AuditLabel, number>;
  const ranked = [...byLabel.entries()].sort((a, b) => b[1] - a[1]);
  const [topLabel, topScore] = ranked[0];
  const userLabel = comment?.label ?? null;
  const userProb = userLabel ? ranked.filter(([l]) => labelMatches(userLabel, l)).reduce((t, [, p]) => t + p, 0) : 0;
  const known = Boolean(userLabel && ranked.some(([l]) => labelMatches(userLabel, l)));
  const verdict = verdictOf(userLabel, comment, known, userProb, topScore, Boolean(userLabel && labelMatches(userLabel, topLabel)));
  const picked = ranked.filter(([, p]) => p >= Math.max(MIX_MIN_PROB, MIX_RELATIVE * topScore)).slice(0, MIX_MAX_LABELS);
  const withUser = verdict === "partial" && userLabel && !picked.some(([l]) => labelMatches(userLabel, l)) && byLabel.has(userLabel)
    ? [...picked, [userLabel, byLabel.get(userLabel) ?? 0] as const]
    : picked;
  const pcts = toPercentages(withUser.map(([, p]) => p));
  const mix: LabelShare[] = withUser.map(([label], i) => ({ label, pct: pcts[i] })).filter((m) => m.pct > 0);
  const graded = verdict === "correct" || verdict === "partial" || verdict === "wrong";
  return {
    id,
    content: scores as LabelScores,
    collaborative: null,
    hybrid: scores as LabelScores,
    userLabel,
    topLabel,
    topScore,
    userScore: userLabel ? userProb : null,
    grade: graded ? Math.round(100 * Math.min(1, topScore > 0 ? userProb / topScore : 0)) : null,
    verdict,
    rule: null,
    mix,
  };
}

const formatValue = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function historicNarrative(model: HistoricModel, comment: ParsedComment | null, score: AuditScore, pred: HistoricPrediction): Narrative {
  const source = `μοντέλο από ${model.rows} κλήσεις (${model.databases.join(", ")})${pred.outOfFold ? ", χωρίς αυτή την κλήση" : ""}`;
  const top = `«${LABEL_TITLES[score.topLabel]}»`;
  const factors = pred.factors.length ? `Για ${top} μετράνε κυρίως: ${pred.factors.map(([n, v]) => `${n} = ${formatValue(v)}`).join(" · ")}.` : null;
  const verdictText: Record<Verdict, string> = {
    correct: `Το σχόλιο «${comment?.raw ?? ""}» συμφωνεί με τις όμοιες κλήσεις — βαθμός ${score.grade}/100.`,
    partial: `Το σχόλιο «${comment?.raw ?? ""}» στηρίζεται εν μέρει· οι όμοιες κλήσεις δείχνουν πιο συχνά ${top} — βαθμός ${score.grade}/100.`,
    wrong: `Οι όμοιες κλήσεις δεν στηρίζουν το «${comment?.raw ?? ""}»· πιο πιθανό είναι ${top} — βαθμός ${score.grade}/100.`,
    insufficient: "Δεν υπάρχουν αρκετά δεδομένα για το Historic.",
    not_auditable: `Το Historic δεν έχει μάθει την κατηγορία «${comment?.raw ?? ""}» (λίγα παραδείγματα στο CSV)· δείχνει ${top}.`,
    no_comment: `Χωρίς σχόλιο χρήστη· κατά το Historic: ${top}.`,
  };
  return {
    why: `Historic [${source}]: ${formatMix(score.mix)}.`,
    against: null,
    alternative: factors,
    sideNote: null,
    verdict: verdictText[score.verdict],
    mix: null,
  };
}

/** Historic για μία κλήση από τις μετρήσεις της· null όταν δεν υπάρχει εκπαιδευμένο μοντέλο. */
export function historicFor(model: HistoricModel, input: MeasuredInput): { score: AuditScore; narrative: Narrative } | null {
  const id = String(input.row.SessionId);
  const pred = historicPredict(model, measuredKpis(input), historicKey(input.database, id));
  if (!pred) return null;
  const score = historicScore(model, id, input.comment, pred);
  return { score, narrative: historicNarrative(model, input.comment, score, pred) };
}
