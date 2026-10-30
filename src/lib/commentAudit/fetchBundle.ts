/**
 * Μαζεύει ό,τι χρειάζεται το comment audit για μία κλήση από το backend.
 * Όλα τα requests τρέχουν παράλληλα· ένα endpoint που αποτυγχάνει δίνει κενά δεδομένα
 * (και μετράει στο `failedSources`), ώστε μία κλήση να μην παγώνει όλο το audit.
 */
import {
  fetchCallAnalysis,
  fetchCallContextSignal,
  fetchCallContextSignalBSide,
  fetchGsmContextSignal,
  fetchGsmContextSignalBSide,
  fetchL3Messages,
  fetchL3Summary,
  fetchTracelogValues,
  type CallL3MessagesResponse,
  type RequestOptions,
} from "@/lib/api";
import { drbReleasesForCall, type SideRrcMessages } from "./drbRelease";
import { DRB_RELEASE_RULE, type AnalysisSide, type CallEvidenceBundle, type DrbReleaseHit } from "./evidence";

const OPTIONS: RequestOptions = { timeoutMs: 20000, retries: 0 };
/** ±δευτερόλεπτα γύρω από την κλήση· το evidence κρατά μόνο τα 'during'. */
const WINDOW_SEC = 10;

export interface FetchedBundle {
  bundle: CallEvidenceBundle;
  failedSources: readonly string[];
}

type Safe = <T>(source: string, p: Promise<T>, fallback: T) => Promise<T>;

/** Λίγα δευτερόλεπτα μετά το τέλος, ώστε να φαίνεται και το Reconfiguration Complete του UE. */
const DRB_AFTER_SEC = 2;

type L3Page = Pick<CallL3MessagesResponse, "callWindow" | "l3Messages">;

/**
 * Για κάθε πλευρά: τα LTE RRC μηνύματα (DCCH-RRCConnectionReconfiguration με drb-ToReleaseList)
 * και τα SIP (για το «IMS SIP ACK: Request» από το οποίο μετράμε τη σειρά των Reconfiguration).
 */
async function fetchDrbReleases(database: string, sessionId: string, safe: Safe): Promise<DrbReleaseHit[]> {
  const page = (side: "A" | "B", layer: string) =>
    safe<L3Page>(
      `${layer} ${side}`,
      fetchL3Messages(database, sessionId, { side, layer, before_seconds: 0, after_seconds: DRB_RELEASE_RULE.afterEndSec + DRB_AFTER_SEC }, OPTIONS),
      { callWindow: null, l3Messages: [] },
    );
  const sides = await Promise.all(
    (["A", "B"] as const).map(async (side): Promise<SideRrcMessages> => {
      const [rrc, sip] = await Promise.all([page(side, "LTE-RRC"), page(side, "SIP")]);
      return { side, messages: rrc.l3Messages ?? [], sipMessages: sip.l3Messages ?? [], callEnd: rrc.callWindow?.CallEnd as string | undefined };
    }),
  );
  return drbReleasesForCall(sides);
}

export interface CallContext {
  /** Η κλήση είναι η τελευταία του αρχείου μέτρησης (από τη λίστα κλήσεων). */
  isLastCallOfFile?: boolean;
}

export async function fetchCallEvidence(database: string, sessionId: string, context: CallContext = {}): Promise<FetchedBundle> {
  const failed: string[] = [];
  const safe = <T,>(source: string, p: Promise<T>, fallback: T): Promise<T> =>
    p.catch(() => {
      failed.push(source);
      return fallback;
    });

  const [analysis, lteA, lteB, gsmA, gsmB, trace, l3A] = await Promise.all([
    safe("call_analysis", fetchCallAnalysis(database, sessionId, OPTIONS), null),
    safe("lte A", fetchCallContextSignal(database, sessionId, WINDOW_SEC, OPTIONS), { signal: [] }),
    safe("lte B", fetchCallContextSignalBSide(database, sessionId, WINDOW_SEC, OPTIONS), { signal: [] }),
    safe("gsm A", fetchGsmContextSignal(database, sessionId, WINDOW_SEC, OPTIONS), { signal: [] }),
    safe("gsm B", fetchGsmContextSignalBSide(database, sessionId, WINDOW_SEC, OPTIONS), { signal: [] }),
    safe("tracelog", fetchTracelogValues(database, sessionId, OPTIONS), { tracelogValues: [] }),
    safe("l3 A", fetchL3Summary(database, sessionId, OPTIONS), { l3Summary: [] }),
  ]);

  const analysisA = (analysis?.a ?? null) as AnalysisSide | null;
  const analysisB = (analysis?.b ?? null) as AnalysisSide | null;
  const bSessionId = analysisB?.SessionId != null ? String(analysisB.SessionId) : null;
  const [l3B, drbReleases] = await Promise.all([
    bSessionId ? safe("l3 B", fetchL3Summary(database, bSessionId, OPTIONS), { l3Summary: [] }) : { l3Summary: [] },
    fetchDrbReleases(database, sessionId, safe),
  ]);

  return {
    bundle: {
      analysisA,
      analysisB,
      lteA: lteA.signal ?? [],
      lteB: lteB.signal ?? [],
      gsmA: gsmA.signal ?? [],
      gsmB: gsmB.signal ?? [],
      tracelog: trace.tracelogValues ?? [],
      l3A: l3A.l3Summary ?? [],
      l3B: l3B.l3Summary ?? [],
      drbReleases,
      isLastCallOfFile: context.isLastCallOfFile ?? false,
    },
    failedSources: failed,
  };
}
