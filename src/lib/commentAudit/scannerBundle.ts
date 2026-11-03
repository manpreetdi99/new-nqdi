/**
 * Δεδομένα scanner για μία κλήση: η καλύτερη κυψέλη του operator (LTE / GSM / NR) στη διάρκεια
 * της κλήσης και η σύγκριση serving vs scanner. Ξεχωρίζει την πραγματικά κακή κάλυψη (κακός και ο
 * scanner) από πρόβλημα κινητού / handover (ο scanner βλέπει καλύτερη κυψέλη).
 * Κάθε endpoint κοστίζει ~2 s, γι' αυτό φορτώνονται μόνο για το export των KPI.
 */
import { fetchGsmScannerBest, fetchLteScannerBest, fetchLteServingVsScanner, fetchNr5gScannerBest, type RequestOptions } from "@/lib/api";

export interface ScannerLteSample {
  PCI?: number | null;
  RSRP?: number | null;
  RSRQ?: number | null;
}
export interface ScannerGsmSample {
  RxLev?: number | null;
  CoverI?: number | null;
}
export interface ServingVsScanner {
  missedHandoverHint?: { deltaDb?: number | null; scannerBestRSRP?: number | null; servingBestRSRP?: number | null } | null;
}
export interface ScannerBundle {
  lteBest: readonly ScannerLteSample[];
  gsmBest: readonly ScannerGsmSample[];
  nrBest: readonly ScannerLteSample[];
  servingVsScanner: ServingVsScanner | null;
}

const OPTIONS: RequestOptions = { timeoutMs: 30000, retries: 0 };
/** 0 = μόνο η διάρκεια της κλήσης. */
const WINDOW_SEC = 0;

export async function fetchScannerBundle(database: string, sessionId: string): Promise<{ scanner: ScannerBundle; failed: readonly string[] }> {
  const failed: string[] = [];
  const safe = <T,>(source: string, p: Promise<T>, fallback: T): Promise<T> =>
    p.catch(() => {
      failed.push(source);
      return fallback;
    });
  const [lteBest, gsmBest, nrBest, servingVsScanner] = await Promise.all([
    safe("lte scanner", fetchLteScannerBest(database, sessionId, WINDOW_SEC, OPTIONS), []),
    safe("gsm scanner", fetchGsmScannerBest(database, sessionId, WINDOW_SEC, OPTIONS), []),
    safe("nr scanner", fetchNr5gScannerBest(database, sessionId, WINDOW_SEC, OPTIONS), []),
    safe("serving vs scanner", fetchLteServingVsScanner(database, sessionId, OPTIONS), null),
  ]);
  return { scanner: { lteBest, gsmBest, nrBest, servingVsScanner }, failed };
}
