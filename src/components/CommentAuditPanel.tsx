import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import type { AllCallsRow } from "@/lib/api";
import { extractEvidence } from "@/lib/commentAudit/evidence";
import { fetchCallEvidence } from "@/lib/commentAudit/fetchBundle";
import { parseComment } from "@/lib/commentAudit/labels";
import { buildNarrative } from "@/lib/commentAudit/narrative";
import { auditComments, type DrbRuleMode } from "@/lib/commentAudit/scoring";
import CommentAuditResults, { type AuditRow } from "./CommentAuditResults";
import MdComparisonTable from "./MdComparisonTable";

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

type Fetched = Omit<AuditRow, "score" | "narrative">;

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
  const allResults = useMemo(() => scoreAll(fetchedRows, drbWithoutRules ? "unconditional" : "strict"), [fetchedRows, drbWithoutRules]);
  // Με «DRB without rules» απομονώνονται οι κλήσεις όπου έπιασε ο κανόνας DRB 3.
  const results = useMemo(
    () => (drbWithoutRules ? allResults.filter((r) => r.score.rule && r.score.topLabel === "CORE_DRB_RELEASE") : allResults),
    [allResults, drbWithoutRules],
  );
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
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
          <h3 id="comment-audit-heading" className="text-sm font-bold">User comment audit</h3>
          <p className="text-[11px] text-muted-foreground max-w-3xl">
            Αναλύει τις {calls.length} drop/fail κλήσεις ({commentedCount} με σχόλιο χρήστη): μαζεύει από το backend ράδιο A/B (RSRP/RSRQ/SINR, RxLev/RxQual),
            SIP, L3 και tracelog, βγάζει την αιτία κατά τα δεδομένα και, όπου υπάρχει σχόλιο, βαθμολογεί αν στέκει: content-based (προφίλ ανά κατηγορία) +
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
      {drbWithoutRules && allResults.length > 0 && (
        <p className="text-xs text-amber-300">
          {results.length
            ? `Εμφανίζονται μόνο οι ${results.length} από τις ${allResults.length} κλήσεις με drb-ToReleaseList { 3 } στο 1ο/2ο RRC Reconfiguration μετά το IMS SIP ACK (χωρίς έλεγχο ράδιο).`
            : `Καμία από τις ${allResults.length} κλήσεις δεν έχει drb-ToReleaseList { 3 } στο 1ο/2ο RRC Reconfiguration μετά το IMS SIP ACK.`}
        </p>
      )}
      {results.length > 0 && <CommentAuditResults results={results} />}
      {results.length > 0 && <MdComparisonTable results={results} />}
    </section>
  );
}
