/**
 * Ο scanner ως ένδειξη ράδιο για το Standard («πρώτα το ράδιο», pptx): αν η καλύτερη κυψέλη του
 * operator είναι αδύναμη εκεί που έγινε η κλήση, η κάλυψη είναι κακή ακόμη κι όταν το κινητό δεν
 * έχει δείγματα (π.χ. Failed πριν το setup). Τα δείγματα του scanner είναι της καλύτερης κυψέλης,
 * άρα πολύ ισχυρότερα από του κινητού — γι' αυτό τα όρια είναι υψηλότερα (−80 GSM).
 */
import { RADIO_THRESHOLDS, isNum, text, type CallEvidenceBundle, type EvidenceFact } from "./types";

export interface ScannerRadio {
  /** 0..1: ποσοστό δειγμάτων καλύτερης GSM κυψέλης ≤ −80 dBm. */
  gsmLow: number;
  /** 0..1: ποσοστό δειγμάτων με C/I κάτω από το όριο ενώ το RxLev είναι αποδεκτό (παρεμβολή). */
  gsmInterference: number;
  /** 0..1: ποσοστό δειγμάτων καλύτερης LTE κυψέλης με RSRP ≤ −115 dBm. */
  lteLow: number;
  facts: EvidenceFact[];
}

const NONE: ScannerRadio = { gsmLow: 0, gsmInterference: 0, lteLow: 0, facts: [] };

const pct = (v: number) => `${Math.round(100 * v)}%`;
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Κλάσμα «κακών» δειγμάτων· κάτω από το ελάχιστο κλάσμα ή με λίγα δείγματα = 0 (θόρυβος). */
function fraction<T>(rows: readonly T[], bad: (r: T) => boolean): number {
  const T = RADIO_THRESHOLDS;
  if (rows.length < T.scanMinSamples) return 0;
  const f = rows.filter(bad).length / rows.length;
  return f >= T.scanMinFraction ? f : 0;
}

/** Ο scanner της τεχνολογίας που χρησιμοποίησε η κλήση (άγνωστη τεχνολογία = και οι δύο). */
function usesTechnology(b: CallEvidenceBundle, tech: "GSM" | "LTE"): boolean {
  const used = `${text(b.analysisA?.technology)} ${text(b.analysisA?.CallTechnologies)} ${text(b.analysisB?.technology)}`.toUpperCase();
  return !used.trim() || used.includes(tech);
}

export function scannerEvidence(b: CallEvidenceBundle): ScannerRadio {
  const scan = b.scanner;
  if (!scan) return NONE;
  const T = RADIO_THRESHOLDS;
  const facts: EvidenceFact[] = [];

  const gsm = usesTechnology(b, "GSM") ? scan.gsmBest.filter((r) => isNum(r.RxLev)) : [];
  const gsmLev = gsm.map((r) => r.RxLev as number);
  const gsmLow = fraction(gsmLev, (v) => v <= T.scanGsmRxLevLow);
  if (gsmLow > 0) {
    const avg = gsmLev.reduce((a, v) => a + v, 0) / gsmLev.length;
    facts.push({
      feature: "gsmLowRxLev",
      side: null,
      source: "scanner GSM",
      text: `${pct(gsmLow)} των δειγμάτων της καλύτερης GSM κυψέλης ≤ ${T.scanGsmRxLevLow} dBm (μέσο ${round1(avg)}, χειρότερο ${Math.min(...gsmLev)} dBm)`,
    });
  }
  const gsmInterference = fraction(gsm, (r) => isNum(r.CoverI) && r.CoverI < T.scanGsmCiLow && (r.RxLev as number) > T.scanGsmRxLevLow);
  if (gsmInterference > 0) {
    facts.push({
      feature: "gsmHighRxQual",
      side: null,
      source: "scanner GSM",
      text: `${pct(gsmInterference)} των δειγμάτων με C/I < ${T.scanGsmCiLow} dB ενώ το RxLev είναι > ${T.scanGsmRxLevLow} dBm (παρεμβολή)`,
    });
  }

  const lteRsrp = usesTechnology(b, "LTE") ? scan.lteBest.map((r) => r.RSRP).filter(isNum) : [];
  const lteLow = fraction(lteRsrp, (v) => v <= T.scanLteRsrpLow);
  if (lteLow > 0) {
    facts.push({
      feature: "lteLowRsrp",
      side: null,
      source: "scanner LTE",
      text: `${pct(lteLow)} των δειγμάτων της καλύτερης LTE κυψέλης με RSRP ≤ ${T.scanLteRsrpLow} dBm (χειρότερο ${Math.min(...lteRsrp)} dBm)`,
    });
  }
  return { gsmLow, gsmInterference, lteLow, facts };
}
