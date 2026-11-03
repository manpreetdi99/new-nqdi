import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import type { AllCallsRow } from "@/lib/api";
import { useLocalStorage } from "@/hooks/use-local-storage";
import type { AuditLabel } from "@/lib/commentAudit/labels";
import { OVERRIDABLE_VERDICTS, OVERRIDES_STORAGE_KEY, overrideFor, withOverride, type LabelOverrides } from "@/lib/commentAudit/overrides";
import { extractEvidence } from "@/lib/commentAudit/evidence";
import { fetchCallEvidence } from "@/lib/commentAudit/fetchBundle";
import { parseComment } from "@/lib/commentAudit/labels";
import { buildNarrative } from "@/lib/commentAudit/narrative";
import { buildKpiRow, toCsv } from "@/lib/commentAudit/kpiExport";
import { DEFAULT_HISTORIC_WEIGHT, formatWeights } from "@/lib/commentAudit/blend";
import { HISTORIC_MODEL, historicFor, isTrained } from "@/lib/commentAudit/historic";
import { auditComments, type DrbRuleMode } from "@/lib/commentAudit/scoring";
import CommentAuditResults, { type AuditRow } from "./CommentAuditResults";
import StandardHistoricTable from "./StandardHistoricTable";

type Props = {
  database: string;
  /** Όλες οι drop/fail κλήσεις του Demo tab (με ή χωρίς σχόλιο χρήστη). */
  rows: readonly AllCallsRow[];
  /** Όλες οι κλήσεις των collections, για να ξέρουμε ποια είναι η τελευταία κάθε αρχείου. */
  allRows: readonly AllCallsRow[];
};

/** SessionId της τελευταίας κλήσης κάθε αρχείου μέτρησης (pptx #14, Fake EOF). */
function lastCallOfEachFile(rows: readonly AllCallsRow[]): ReadonlySet<string> {
  const last = new Map<string, AllCallsRow>();
  for (const r of rows) {
    const file = r.ASideFileName;
    if (!file) continue;
    const prev = last.get(file);
    if (!prev || String(r.callStartTimeStamp ?? "") > String(prev.callStartTimeStamp ?? "")) last.set(file, r);
  }
  return new Set([...last.values()].map((r) => String(r.SessionId)));
}

const AUDIT_CONCURRENCY = 3;
const HISTORIC_WEIGHT_STORAGE_KEY = "commentAudit.historicWeightPct";

type Fetched = Omit<AuditRow, "score" | "narrative">;

/** Historic: μοντέλο από το audit-kpis-historic.csv, μόνο από τις μετρήσεις κάθε κλήσης. */
function historicAll(fetched: readonly Fetched[], database: string): AuditRow[] {
  return fetched.flatMap((f) => {
    const h = historicFor(HISTORIC_MODEL, { database, row: f.row, bundle: f.bundle, evidence: f.evidence, comment: f.comment });
    return h ? [{ ...f, ...h }] : [];
  });
}

const HISTORIC_TRAINED_ON = isTrained(HISTORIC_MODEL)
  ? `${HISTORIC_MODEL.rows} κλήσεις με σχόλιο από ${HISTORIC_MODEL.databases.join(", ")}`
  : "δεν έχει εκπαιδευτεί ακόμη";

/** Το MF χρειάζεται όλες τις κλήσεις μαζί, γι' αυτό η βαθμολόγηση γίνεται στο τέλος. */
function scoreAll(fetched: readonly Fetched[], drbRule: DrbRuleMode): AuditRow[] {
  const items = fetched.map((f) => ({ id: String(f.row.SessionId), comment: f.comment, features: f.evidence.features }));
  const scores = auditComments(items, undefined, { drbRule });
  return fetched.map((f, i) => ({ ...f, score: scores[i], narrative: buildNarrative(f.comment, f.evidence, scores[i]) }));
}

export default function CommentAuditPanel({ database, rows, allRows }: Props) {
  const calls = rows;
  const commentedCount = useMemo(() => rows.filter((r) => (r.comment ?? "").trim()).length, [rows]);
  const lastCalls = useMemo(() => lastCallOfEachFile(allRows), [allRows]);
  // Κρατάμε τα δεδομένα του backend: το κουμπί «DRB without rules» ξαναβαθμολογεί χωρίς νέο fetch.
  const [fetchedRows, setFetchedRows] = useState<readonly Fetched[]>([]);
  const [drbWithoutRules, setDrbWithoutRules] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const allResults = useMemo(() => scoreAll(fetchedRows, drbWithoutRules ? "unconditional" : "strict"), [fetchedRows, drbWithoutRules]);
  // Standard με τον αυστηρό κανόνα DRB (δεν επηρεάζεται από το «DRB without rules») και Historic στις ίδιες κλήσεις.
  const strictResults = useMemo(() => scoreAll(fetchedRows, "strict"), [fetchedRows]);
  const historicResults = useMemo(() => historicAll(fetchedRows, database), [fetchedRows, database]);
  // Επιλογές του χρήστη «ποια αιτία υπερισχύει» (μερικώς/λάθος), ανά βάση, μόνιμα στον browser.
  const [allOverrides, setAllOverrides] = useLocalStorage<LabelOverrides>(OVERRIDES_STORAGE_KEY, {});
  const overrides = useMemo(() => {
    const stored = allOverrides?.[database] ?? {};
    return Object.fromEntries(
      Object.keys(stored).flatMap((sid) => {
        const label = overrideFor(allOverrides, database, sid);
        return label ? [[sid, label] as const] : [];
      }),
    ) as Readonly<Record<string, AuditLabel>>;
  }, [allOverrides, database]);
  // Μπάρα «Κατά τα δεδομένα»: % Historic (το Standard παίρνει το υπόλοιπο), μόνιμα στον browser.
  const [storedWeight, setStoredWeight] = useLocalStorage<number>(HISTORIC_WEIGHT_STORAGE_KEY, Math.round(100 * DEFAULT_HISTORIC_WEIGHT));
  const historicPct = Number.isFinite(storedWeight) ? Math.max(0, Math.min(100, Math.round(storedWeight))) : Math.round(100 * DEFAULT_HISTORIC_WEIGHT);
  const historicWeight = historicPct / 100;
  const historicMix = useMemo(() => new Map(historicResults.map((h) => [String(h.row.SessionId), h.score.mix])), [historicResults]);

  const handleOverride = (sessionId: string, label: AuditLabel | null) =>
    setAllOverrides((prev) => withOverride(prev, database, sessionId, label));

  /** Μία γραμμή KPI ανά κλήση (μετρήσεις + scanner + Standard + Historic), για φόρτωση σε βάση / εκπαίδευση του Historic. */
  const handleExportKpis = useCallback(() => {
    if (strictResults.length === 0) return;
    setError(null);
    try {
      // Ο scanner ήρθε ήδη με το Analyze (bundle.scanner), οπότε το export δεν κάνει νέα requests.
      const historicBySession = new Map(historicResults.map((h) => [String(h.row.SessionId), h]));
      const rows = strictResults.map((r) => {
        const sid = String(r.row.SessionId);
        const override = OVERRIDABLE_VERDICTS.has(r.score.verdict) ? overrides[sid] ?? null : null;
        const historic = historicBySession.get(sid) ?? null;
        return buildKpiRow({ database, row: r.row, bundle: r.bundle, evidence: r.evidence, comment: r.comment, standard: r, historic, override, historicWeight });
      });
      const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-kpis-${database}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Το export KPI σταμάτησε: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [database, strictResults, historicResults, overrides, historicWeight]);
  // Με «DRB without rules» απομονώνονται οι κλήσεις όπου έπιασε ο κανόνας DRB 3.
  const results = useMemo(
    () => (drbWithoutRules ? allResults.filter((r) => r.score.rule && r.score.topLabel === "CORE_DRB_RELEASE") : allResults),
    [allResults, drbWithoutRules],
  );
  const cancelRef = useRef(false);

  const handleRun = useCallback(async () => {
    if (!database || calls.length === 0) return;
    setIsRunning(true);
    setError(null);
    setProgress(0);
    setFetchedRows([]);
    cancelRef.current = false;
    const fetched: Fetched[] = [];
    const queue = [...calls];
    let done = 0;
    const worker = async () => {
      while (queue.length && !cancelRef.current) {
        const row = queue.shift();
        if (!row) break;
        const sid = String(row.SessionId);
        const { bundle, failedSources } = await fetchCallEvidence(database, sid, { isLastCallOfFile: lastCalls.has(sid) });
        fetched.push({ row, comment: parseComment(row.comment), evidence: extractEvidence(bundle), bundle, failedSources });
        done += 1;
        setProgress(done);
      }
    };
    try {
      await Promise.all(Array.from({ length: AUDIT_CONCURRENCY }, worker));
      // Τα requests τελειώνουν με τυχαία σειρά· τα folds του MF εξαρτώνται από τη σειρά,
      // οπότε ταξινομούμε για να βγαίνουν οι ίδιοι βαθμοί σε κάθε run.
      const order = new Map(calls.map((r, i) => [String(r.SessionId), i]));
      const ordered = [...fetched].sort((a, b) => (order.get(String(a.row.SessionId)) ?? 0) - (order.get(String(b.row.SessionId)) ?? 0));
      setFetchedRows(ordered);
      const partial = fetched.filter((f) => f.failedSources.length).length;
      if (partial) setError(`${partial} κλήση(εις) με ελλιπή δεδομένα από το backend — ο βαθμός τους βασίζεται σε ό,τι ήρθε.`);
    } catch (e) {
      setError(`Το audit σταμάτησε: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsRunning(false);
    }
  }, [database, calls, lastCalls]);

  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-3" aria-labelledby="comment-audit-heading">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 id="comment-audit-heading" className="text-sm font-bold">User comment audit — Standard (pptx)</h3>
          <p className="text-[11px] text-muted-foreground max-w-3xl">
            Αναλύει τις {calls.length} drop/fail κλήσεις ({commentedCount} με σχόλιο χρήστη): μαζεύει από το backend ράδιο A/B (RSRP/RSRQ/SINR, RxLev/RxQual),
            SIP, L3, tracelog και scanner (καλύτερη κυψέλη), βγάζει την αιτία κατά τα δεδομένα και, όπου υπάρχει σχόλιο, βαθμολογεί αν στέκει: content-based (προφίλ ανά κατηγορία) +
            collaborative filtering (παραγοντοποίηση πίνακα).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning || !database || calls.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            {isRunning ? `Reading backend ${progress}/${calls.length}` : `Analyze calls (${calls.length})`}
          </button>
          <button
            type="button"
            onClick={() => setDrbWithoutRules((v) => !v)}
            aria-pressed={drbWithoutRules}
            title="Ο κανόνας DRB 3 εφαρμόζεται σε κάθε drb-ToReleaseList { 3 } στο 1ο/2ο RRC Reconfiguration μετά το IMS SIP ACK, χωρίς έλεγχο ράδιο και Reconfiguration Complete"
            className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
              drbWithoutRules ? "bg-amber-500/20 border-amber-500/60 text-amber-300" : "border-border bg-muted hover:bg-muted/70"
            }`}
          >
            DRB without rules{drbWithoutRules ? ": ON" : ""}
          </button>
          <button
            type="button"
            onClick={handleExportKpis}
            disabled={isRunning || strictResults.length === 0}
            title="KPIs ανά κλήση (ράδιο A/B, scanner, σηματοδοσία, σχόλιο, Standard, Historic) σε CSV για φόρτωση σε βάση"
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted hover:bg-muted/70 text-xs font-medium disabled:opacity-50"
          >
            Export KPIs (CSV)
          </button>
          {isRunning && (
            <button
              type="button"
              onClick={() => { cancelRef.current = true; }}
              className="px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-xs font-medium"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-amber-400">{error}</p>}
      {strictResults.length > 0 && historicResults.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-xs">
          <label htmlFor="historic-weight" className="font-medium">«Κατά τα δεδομένα»</label>
          <span className="text-muted-foreground">Standard</span>
          <input
            id="historic-weight"
            type="range"
            min={0}
            max={100}
            step={5}
            value={historicPct}
            onChange={(e) => setStoredWeight(Number(e.target.value))}
            aria-valuetext={formatWeights(historicWeight)}
            className="w-48 accent-primary"
          />
          <span className="text-muted-foreground">Historic</span>
          <span className="font-mono font-semibold">{formatWeights(historicWeight)}</span>
          <span className="text-muted-foreground">ανά αιτία: Historic% × πιθανότητα Historic + Standard% × πιθανότητα Standard</span>
          {historicPct !== Math.round(100 * DEFAULT_HISTORIC_WEIGHT) && (
            <button type="button" onClick={() => setStoredWeight(Math.round(100 * DEFAULT_HISTORIC_WEIGHT))} className="rounded border border-border px-2 py-0.5 hover:bg-muted">
              Default 65 / 35
            </button>
          )}
        </div>
      )}
      {drbWithoutRules && allResults.length > 0 && (
        <p className="text-xs text-amber-300">
          {results.length
            ? `Εμφανίζονται μόνο οι ${results.length} από τις ${allResults.length} κλήσεις με drb-ToReleaseList { 3 } στο 1ο/2ο RRC Reconfiguration μετά το IMS SIP ACK (χωρίς έλεγχο ράδιο).`
            : `Καμία από τις ${allResults.length} κλήσεις δεν έχει drb-ToReleaseList { 3 } στο 1ο/2ο RRC Reconfiguration μετά το IMS SIP ACK.`}
        </p>
      )}
      {results.length > 0 && (
        <CommentAuditResults
          results={results}
          database={database}
          overrides={overrides}
          onOverride={handleOverride}
          historicMix={historicMix}
          historicWeight={historicWeight}
        />
      )}
      {strictResults.length > 0 && historicResults.length > 0 && (
        <StandardHistoricTable standard={strictResults} historic={historicResults} database={database} trainedOn={HISTORIC_TRAINED_ON} />
      )}
    </section>
  );
}
