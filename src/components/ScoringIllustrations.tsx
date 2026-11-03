import { useState } from "react";
import { ChevronRight } from "lucide-react";

type Rung = {
  n: number;
  file: string;
  title: string;
  /** Τι μαθαίνεις εδώ, σε μία φράση. */
  oneLiner: string;
  /** 2-3 σύντομες προτάσεις. */
  body: string[];
  code: string[];
};

const RUNGS: Rung[] = [
  {
    n: 1,
    file: "01-evidence-sources.png",
    title: "Από πού έρχεται η απόδειξη",
    oneLiner: "Κάθε κλήση γίνεται 29 αριθμοί (features) από 5 πηγές του backend.",
    body: [
      "Πηγές: ράδιο A/B (RSRP/RSRQ/SINR, RxLev/RxQual), scanner (καλύτερη κυψέλη), tracelog, L3 A/B (RRC + SIP), call analysis.",
      "Κάθε feature είναι 0..1, όπου 0 = καλά, 1 = πρόβλημα. Παράδειγμα: RSRP = −117 → lteLowRsrp = 1.0. Το gsmLowRxLev παίρνει το καλύτερο από tracer και scanner.",
      "Οι 29 features ορίζονται στο types.ts:10 (FEATURE_KEYS).",
    ],
    code: ["fetchBundle.ts:68 · fetchCallEvidence()", "evidence.ts:20/28 · extractEvidence()", "radioEvidence.ts:26 · runStrength", "scannerEvidence.ts:38 · scannerEvidence()", "types.ts:10 · FEATURE_KEYS (29)", "types.ts:49/56 · lteRsrpLow=−117 / gsmRxLevLow=−93"],
  },
  {
    n: 2,
    file: "02-hard-rules.png",
    title: "Σκληροί κανόνες = αιτία 100%",
    oneLiner: "Δύο αιτίες δεν περνάνε από ζυγαριά: DRB RELEASE 3 και TAU.",
    body: [
      "DRB 3: drb-ToReleaseList { 3 } στο 1ο/2ο RRC Reconfiguration μετά το IMS SIP ACK, με Reconfiguration Complete εντός 2 s και καλά ράδιο.",
      "TAU: UL Tracking Area Update Request στο L3 με αποδεκτό ράδιο.",
      "Αν ο κανόνας έπιασε → score 1.0, verdict Σωστό. Αν πέσει μία προϋπόθεση → επαλήθευση, score 0. Με «DRB without rules» ο κανόνας DRB 3 εφαρμόζεται πάντα.",
    ],
    code: ["profiles.ts:104/120/128 · DRB_RULES / TAU_RULE", "types.ts:79 · DRB_RELEASE_RULE: maxReconfigAfterAck=2", "drbRelease.ts:110 · drbReleaseEvidence()", "profiles.ts:87/88 · radioMeasurementsGood / radioAcceptable", "scoring.ts:262 · rules.find() → 100%"],
  },
  {
    n: 3,
    file: "03-hybrid-score.png",
    title: "Το hybrid score: προφίλ + ομοιότητα + collaborative",
    oneLiner: "Κάθε αιτία έχει δικό της προφίλ βαρών· το score βγαίνει από 3 πηγές.",
    body: [
      "Προφίλ: Σ(βάρος × τιμή) ÷ Σ(θετικά βάρη), κομμένο στο 0..1. Λέει τι ποσοστό από τις ενδείξεις που περιμένει αυτή η αιτία υπάρχει στην κλήση.",
      "Content = 50% προφίλ + 50% ομοιότητα (centroid) με τις κλήσεις που οι χρήστες σχολίασαν την ίδια αιτία (χρειάζονται ≥3).",
      "Collaborative (MF, rank 4, 5-fold) χρειάζεται ≥10 σχολιασμένες κλήσεις. Hybrid = 0.6 × content + 0.4 × CF. Η αιτία με το μεγαλύτερο hybrid είναι η πρώτη.",
    ],
    code: ["profiles.ts:18/24 · PRIOR_PROFILES · LC_GSM", "profiles.ts:13 · BAD_RADIO: −0.8 / −0.6 στα Core/Fake", "scoring.ts:46 · MIN_CENTROID_EXAMPLES = 3", "scoring.ts:47 · PRIOR_WEIGHT = 0.5", "scoring.ts:189 · MIN_LABELED_FOR_CF = 10", "scoring.ts:190/260 · CONTENT_WEIGHT = 0.6 → hybrid", "scoring.ts:208/234 · labelMix()"],
  },
  {
    n: 4,
    file: "04-verdict-height.png",
    title: "Το verdict από το score",
    oneLiner: "Από το hybrid της πρώτης αιτίας βγαίνει Σωστό / Μερικώς / Λάθος / Αξιολόγηση αδύνατη.",
    body: [
      "Αξιολόγηση αδύνατη αν η πρώτη αιτία έχει <0.2 features ≠ 0. Σωστό αν η διαφορά με τη δεύτερη ≤ 0.05 (TIE_MARGIN). Μερικώς αν η πιθανότητα ≥0.5 και STRONG_OWN_EVIDENCE ≥0.6. Λάθος στα υπόλοιπα.",
      "Βαθμός = 100 × (½ × σ + ½ × πιθανότητα). Παράδειγμα (κλήση 1322849927204, σχόλιο «LC GSM»): σ = 0.456, πιθανότητα = 1 → 100 × (0.228 + 0.5) = 73.",
    ],
    code: ["scoring.ts:191 · MIN_EVIDENCE = 0.2 → Αξιολόγηση αδύνατη", "scoring.ts:192 · TIE_MARGIN = 0.05 → Σωστό", "scoring.ts:193 · STRONG_OWN_EVIDENCE = 0.6", "scoring.ts:201 · verdictFor()", "scoring.ts:279 · grade = 100 × (½σ + ½πρότ)", "labels.ts:117 · parseComment()"],
  },
  {
    n: 5,
    file: "05-blend-valve.png",
    title: "Σκέψη Standard ↔ Historic (βαλβίδα ανάμειξης)",
    oneLiner: "Η μπάρα «Κατά τα δεδομένα» αναμειγνύει Standard και Historic ανά αιτία.",
    body: [
      "Default 65 / 35: ανά αιτία = Historic% × πιθανότητα Historic + Standard% × πιθανότητα Standard.",
      "Οι κανόνες DRB 3 / TAU και τα overrides χρήστη (μερικώς/λάθος) κερδίζουν πάντα 100% στο Standard και δεν επηρεάζονται από τη μπάρα.",
      "Τα blend_label / final_label εξάγονται στο CSV (kpiExport).",
    ],
    code: ["blend.ts:9 · DEFAULT_HISTORIC_WEIGHT = 0.65", "blend.ts:22/26 · blendMix()", "CommentAuditPanel.tsx:223/39 · η μπάρα (localStorage)", "overrides.ts:12/15 · overrides", "kpiExport.ts:373 · blend_label / final_label"],
  },
  {
    n: 6,
    file: "06-historic-model.png",
    title: "Το Historic μοντέλο (μαθημένο από τα παλιά σχόλια)",
    oneLiner: "Δεύτερη μέθοδος: logistic regression πάνω στα παλιά σχόλια χρηστών.",
    body: [
      "Εκπαιδεύεται στο audit-kpis-historic.csv (π.χ. 233 κλήσεις × 12 κατηγορίες): logistic regression, out-of-fold με 5 FOLDs, features από ράδιο A/B, διάρκεια κλήσης, uplink, L3, tracelog και scanner.",
      "Έχει το ίδιο σύστημα ζυγαριάς: Σωστό αν η διαφορά με τη δεύτερη ≤5%, Μερικώς αν η πιθανότητα ≥50% της πρώτης, Αξιολόγηση αδύνατη αν έχει <3 ταξινομημένες κλήσεις σε αυτήν την κατηγορία.",
    ],
    code: ["historic/train.py:22/23 · MIN_CLASS_ROWS=3 · FOLDS=5", "historic/train.py:101 · LogisticRegression(class_weight=balanced)", "historic/model.json · το μοντέλο", "historic.ts:92/109 · historicPredict() / verdictOf()", "historic.ts:143 · grade"],
  },
  {
    n: 7,
    file: "07-feature-weights.png",
    title: "Ζυγαριά ανά αιτία: η ίδια παράμετρος + για τη μία, − για την άλλη",
    oneLiner: "ΔΕΝ υπάρχει ένα βάρος ανά παράμετρο — κάθε αιτία έχει δικό της προφίλ.",
    body: [
      "Το gsmLowRxLev είναι +1 για LC GSM αλλά −0.8 για όλα τα Core/Fake. Αν μια παράμετρος δεν υπάρχει στο προφίλ μιας αιτίας, δεν μετράει καθόλου για εκείνη.",
      "Λυμένο παράδειγμα κλήση 1322849927204 (σχόλιο «LC GSM»): features gsmLowRxLev=0.69, nativeLowGsm=1, noCmServiceRequest=1.",
      "Προφίλ LC GSM = (1×0.69 + 0.4×1) ÷ 2.0 = 0.544 · LQ GSM = 0.269 · FAKE UE STUCK (NO CM) = (1×1 − 0.8×0.69) ÷ 1.5 = 0.300. Πρώτη LC GSM → βαθμός 73, ποσοστά 63% LC GSM · 37% LQ GSM.",
      "Ο πλήρης πίνακας 29 × 20 είναι στο exports/standard-weights.csv.",
    ],
    code: ["profiles.ts:57 · ownScore() · Σ(βάρος×τιμή) ÷ Σ(βάρος)", "profiles.ts:24/25/46 · LC_GSM / LQ_GSM / FAKE_UE_STUCK_NO_CM", "profiles.ts:65 · priorScore()", "scoring.ts:67 · contentScores()", "scoring.ts:279 · grade", "exports/standard-weights.csv · 29 × 20"],
  },
];

export default function ScoringIllustrations() {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-3" aria-labelledby="scoring-illustrations-heading">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <div>
          <h3 id="scoring-illustrations-heading" className="text-sm font-bold">
            Πώς βγαίνει το score — βήμα βήμα (7 εικόνες)
          </h3>
          <p className="text-[10px] text-muted-foreground">
            Διάβασε τα βήματα με τη σειρά: από τα δεδομένα → στο score → στο verdict → στην ανάμειξη → στο μαθημένο μοντέλο → στη ζυγαριά βαρών.
          </p>
        </div>
      </button>

      {open && (
        <>
          {/* TL;DR */}
          <div className="rounded-md bg-muted/40 border border-border p-3 space-y-1 text-[11px]">
            <div className="font-bold text-foreground">Σε 3 γραμμές:</div>
            <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
              <li><strong className="text-foreground">Προφίλ</strong> (profiles.ts:57): Σ(βάρος × τιμή) ÷ Σ(θετικά βάρη), κομμένο στο 0..1. Λέει πόσες από τις ενδείξεις που περιμένει αυτή η αιτία υπάρχουν, μείον όσες την αντικρούουν.</li>
              <li><strong className="text-foreground">Content</strong> = 50% προφίλ + 50% ομοιότητα (centroid) με τις κλήσεις που οι χρήστες σχολίασαν ίδια.</li>
              <li><strong className="text-foreground">Hybrid</strong> = 0.6 × content + 0.4 × collaborative (MF). Η αιτία με το μεγαλύτερο hybrid είναι η πρώτη.</li>
            </ol>
            <p className="text-muted-foreground">
              Σκληροί κανόνες (DRB 3 / TAU) επιβάλλουν αιτία με score 1.0 πριν τη ζυγαριά. Το verdict και ο βαθμός βγαίνουν στο βήμα 4.
            </p>
          </div>

          <div className="space-y-5">
            {RUNGS.map((r) => (
              <figure key={r.file} className="rounded-md border border-border overflow-hidden">
                <img
                  src={`/demo-scoring/detailed/${r.file}`}
                  alt={`Βήμα ${r.n}: ${r.title}`}
                  loading="lazy"
                  className="w-full bg-white"
                />
                <figcaption className="p-3 space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-bold text-primary">Βήμα {r.n}</span>
                    <span className="text-xs font-semibold text-foreground">{r.title}</span>
                  </div>
                  <p className="text-[11px] font-medium text-foreground leading-relaxed">
                    {r.oneLiner}
                  </p>
                  {r.body.map((line, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">{line}</p>
                  ))}
                  <div className="font-mono text-[10px] text-muted-foreground/80 leading-relaxed pt-1 border-t border-border/50">
                    {r.code.map((c, i) => (
                      <div key={i}>{c}</div>
                    ))}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>

          {/* Λυμένο παράδειγμα */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <h4 className="text-xs font-bold">Λυμένο παράδειγμα — κλήση 1322849927204 (σχόλιο «LC GSM»)</h4>
            <p className="text-[11px] text-muted-foreground">
              Η κλήση έχει μόνο 3 features διάφορα του 0: gsmLowRxLev = 0.69 (από τον scanner), nativeLowGsm = 1, noCmServiceRequest = 1.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-1 pr-3 font-medium">Αιτία</th>
                    <th className="text-left py-1 pr-3 font-medium">Τι μετράει</th>
                    <th className="text-left py-1 pr-3 font-medium">Προφίλ</th>
                    <th className="text-left py-1 pr-3 font-medium">Content</th>
                    <th className="text-left py-1 pr-3 font-medium">CF</th>
                    <th className="text-left py-1 font-medium">Hybrid</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr className="border-b border-border/50">
                    <td className="py-1 pr-3">LC GSM</td>
                    <td className="py-1 pr-3 text-muted-foreground">1×0.69 (RxLev) + 0.4×1 (native) = 1.09 ÷ 2.0</td>
                    <td className="py-1 pr-3">0.544</td>
                    <td className="py-1 pr-3">0.571</td>
                    <td className="py-1 pr-3">0.284</td>
                    <td className="py-1 font-semibold">0.456</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-1 pr-3">LQ GSM</td>
                    <td className="py-1 pr-3 text-muted-foreground">0.4×1 (native) + 0.2×0.69 (RxLev) = 0.54 ÷ 2.0</td>
                    <td className="py-1 pr-3">0.269</td>
                    <td className="py-1 pr-3">0.353</td>
                    <td className="py-1 pr-3">0.148</td>
                    <td className="py-1 font-semibold">0.271</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-3">FAKE UE STUCK (NO CM)</td>
                    <td className="py-1 pr-3 text-muted-foreground">1×1 (no CM) − 0.8×0.69 (κακό RxLev) = 0.45 ÷ 1.5</td>
                    <td className="py-1 pr-3">0.300</td>
                    <td className="py-1 pr-3">0.300</td>
                    <td className="py-1 pr-3">0.000</td>
                    <td className="py-1 font-semibold">0.180</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Πριν μπει ο scanner, το gsmLowRxLev ήταν 0 — τότε το NO CM έπαιρνε 1.0 ÷ 1.5 και κέρδιζε. Τώρα το −0.8 × 0.69 το ρίχνει («πρώτα το ράδιο»).&nbsp;·&nbsp;
              hybrid LC GSM = 0.6 × 0.571 + 0.4 × 0.284 = <span className="font-mono">0.456</span>&nbsp;·&nbsp;
              βαθμός = 100 × (½ × 0.456 + ½ × 1) = <span className="font-mono">73</span>&nbsp;·&nbsp;
              ποσοστά: 0.456 / 0.271 → <span className="font-mono">63% LC GSM · 37% LQ GSM</span>.
            </p>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Ο πλήρης πίνακας βαρών (29 παράμετροι × 20 αιτίες) είναι στο <code className="font-mono">exports/standard-weights.csv</code>.
          </p>
        </>
      )}
    </section>
  );
}
