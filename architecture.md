# architecture.md — ταξινομητής του md (βήμα 2, overkill --advanced)

**Baseline:** δύο καθαροί TypeScript ταξινομητές στο Demo tab, στα ίδια δεδομένα του backend (call_analysis, σήμα A/B, L3 summary, RRC/SIP, tracelog), χωρίς MCP server και email (απόφαση χρήστη):

- **Audit** (`src/lib/commentAudit/`) — κανόνες του «Call Analysis.pptx»· κρίνει το σχόλιο του χρήστη (βαθμός 0–100, ετυμηγορία, «κατά τα δεδομένα»).
- **md** (`src/lib/mdClassifier/`) — μόνο οι κανόνες του `volte-drop-fail-analysis.md` §1.3–1.6 (αιτία drop / στάδιο fail)· εμφανίζεται ως στήλη «md (§1.6)» στον πίνακα σύγκρισης.

Οι δύο **δεν** αντιστοιχούν: διαφορετικοί κανόνες και λεξιλόγιο· συγκρίνονται μόνο σε οικογένειες (RADIO / CORE / FAKE / USER).

> Mode `--advanced`: ο πίνακας μετρά το **κόστος υιοθέτησης στην παραγωγή** (χρόνος ως το πρώτο commit, ops burden, δυσκολία πρόσληψης), όχι την καμπύλη μάθησης. Οι επιλογές είναι ο χώρος σχεδίασης πέρα από το baseline, **όχι** σύσταση. Η υλοποίηση ακολουθεί το baseline (🔥 2/10).

#### Κανόνες ως δεδομένα (json-rules-engine + σχήμα Zod) — Complexity: 🔥 3/10
**What it is:** οι κανόνες §1.6 και τα όρια του `config.ts` μεταφέρονται σε JSON/YAML που επικυρώνεται με Zod και εκτελείται από το json-rules-engine.
**How it goes beyond the baseline:** ο αναλυτής αλλάζει όρια, user codes ή σειρά προτεραιότητας χωρίς release του frontend· κάθε απόφαση καταγράφει ποιος κανόνας ενεργοποιήθηκε.
**Skills developed:** rule engines, schema validation, versioning κανόνων.
**Learn more:** [json-rules-engine](https://github.com/CacheControl/json-rules-engine), [Zod](https://zod.dev/)
**Scenario where it pays off:** όταν κάθε διαγωνισμός benchmarking έχει δική του μεθοδολογία και τα όρια αλλάζουν πιο συχνά από τον κώδικα.

#### Ταξινόμηση στον FastAPI με cache σε Redis — Complexity: 🔥 5/10
**What it is:** endpoint `/api/md_classification` που τρέχει τους ίδιους κανόνες server-side (Python) για όλο το collection και κρατά τα αποτελέσματα σε Redis με κλειδί (database, SessionId, έκδοση κανόνων).
**How it goes beyond the baseline:** ένα request αντί για ~10 ανά κλήση· τα αποτελέσματα επαναχρησιμοποιούνται από άλλες σελίδες και αναφορές.
**Skills developed:** server-side batch επεξεργασία, cache invalidation ανά έκδοση κανόνων, Redis.
**Learn more:** [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/), [Redis caching patterns](https://redis.io/docs/latest/develop/use/patterns/)
**Scenario where it pays off:** collections με χιλιάδες drop/fail κλήσεις, όπου το audit στον browser (~80 s / 150 κλήσεις) δεν κλιμακώνεται.

#### Complex Event Processing σε Kafka + Flink CEP — Complexity: 🔥 7/10
**What it is:** τα L3/SIP/RRC events κάθε κλήσης ρέουν σε Kafka· patterns του Flink CEP (π.χ. `MobilityFromEUTRACommand` χωρίς `HandoverComplete` εντός 5 s πριν το τέλος) βγάζουν την αιτία σε πραγματικό χρόνο.
**How it goes beyond the baseline:** ταξινόμηση την ώρα της μέτρησης, όχι εκ των υστέρων· time-window semantics με watermarks.
**Skills developed:** event-time processing, watermarks, CEP pattern languages, exactly-once streaming.
**Learn more:** [Flink CEP](https://nightlies.apache.org/flink/flink-docs-stable/docs/libs/cep/), [Kafka docs](https://kafka.apache.org/documentation/)
**Scenario where it pays off:** live drive-test καμπάνιες με δεκάδες συσκευές, όπου ο μηχανικός πρέπει να δει την αιτία του drop πριν φύγει από την περιοχή.

#### Process mining / conformance checking σε Petri nets — Complexity: 🔥 8/10
**What it is:** το ladder RRC → NAS → SIP της §1.4 μοντελοποιείται ως Petri net· κάθε κλήση γίνεται trace και το alignment δείχνει σε ποιο transition απέκλινε (= failure stage).
**How it goes beyond the baseline:** το «τελευταίο στάδιο που ολοκληρώθηκε» βγαίνει από μαθηματική ευθυγράμμιση, όχι από χειροποίητα if.
**Skills developed:** Petri nets, alignments, conformance metrics (fitness/precision), PM4Py.
**Learn more:** [PM4Py](https://pm4py.fit.fraunhofer.de/), [van der Aalst, Process Mining (Springer)](https://link.springer.com/book/10.1007/978-3-662-49851-4)
**Scenario where it pays off:** όταν vendors/operators αλλάζουν συχνά τη ροή σηματοδοσίας και τα σκληροκωδικοποιημένα στάδια σπάνε.

#### Τυπική επαλήθευση των κανόνων με TLA+ — Complexity: 🔥 8/10
**What it is:** η μηχανή καταστάσεων της κλήσης και οι κανόνες προτεραιότητας της §1.6 περιγράφονται σε TLA+· ο TLC ελέγχει ότι κάθε ακολουθία καταλήγει σε ακριβώς μία αιτία και ότι οι user codes δεν μετρούν ποτέ ως network fail.
**How it goes beyond the baseline:** απόδειξη αμοιβαία αποκλειστικών/πλήρων κανόνων αντί για δείγματα tests.
**Skills developed:** temporal logic, model checking, invariant design.
**Learn more:** [TLA+ (Lamport)](https://lamport.azurewebsites.net/tla/tla.html), [Learn TLA+](https://learntla.com/)
**Scenario where it pays off:** όταν η ταξινόμηση μπαίνει σε επίσημες αναφορές ρυθμιστή και κάθε ασυνέπεια κοστίζει.

#### Bayesian network για απόδοση αιτίας με αβεβαιότητα — Complexity: 🔥 9/10
**What it is:** οι αιτίες (RLF, HO, core…) είναι λανθάνουσες μεταβλητές· τα παρατηρούμενα (RSRP, re-establishment, SIP codes) εξαρτώνται από αυτές· inference (NumPyro) δίνει πιθανότητα ανά αιτία αντί για high/medium/low.
**How it goes beyond the baseline:** βαθμονομημένη αβεβαιότητα και σωστός χειρισμός πολλαπλών ταυτόχρονων αιτιών.
**Skills developed:** probabilistic graphical models, variational inference, calibration.
**Learn more:** [NumPyro](https://num.pyro.ai/), [Koller & Friedman, Probabilistic Graphical Models (MIT Press)](https://mitpress.mit.edu/9780262013192/)
**Scenario where it pays off:** όταν υπάρχουν χιλιάδες επισημασμένες κλήσεις για εκμάθηση των πιθανοτήτων και οι αναφορές χρειάζονται διαστήματα εμπιστοσύνης.

## Σύγκριση — κόστος παραγωγής

| Approach | Complexity | Time to first commit | Ops burden | Hiring difficulty | Payoff horizon |
|---|---|---|---|---|---|
| Κανόνες ως δεδομένα (json-rules-engine + Zod) | 🔥 3/10 | 1–2 ημέρες | Χαμηλό: κανένα νέο runtime· χρειάζεται μόνο review/versioning των αρχείων κανόνων | Χαμηλή: κάθε TypeScript developer | ≥2 μεθοδολογίες benchmarking με διαφορετικά όρια |
| FastAPI + Redis cache | 🔥 5/10 | 3–5 ημέρες | Μέτριο: Redis με backup/monitoring, cache invalidation ανά έκδοση κανόνων, ένα ακόμη SLO | Χαμηλή–μέτρια: Python backend + Redis είναι συνηθισμένος συνδυασμός | ≥10³ drop/fail κλήσεις ανά collection ή χρήση των αποτελεσμάτων από πολλές σελίδες |
| Kafka + Flink CEP | 🔥 7/10 | 3–6 εβδομάδες (ingestion από τα εργαλεία μέτρησης + cluster) | Υψηλό: 2 distributed συστήματα, on-call, runbooks, upgrades, capacity planning | Υψηλή: λίγοι μηχανικοί streaming στην ελληνική αγορά | Live καμπάνιες, ≥10 συσκευές ταυτόχρονα, ανάγκη αιτίας σε < 1 λεπτό |
| Process mining (PM4Py) | 🔥 8/10 | 1–2 εβδομάδες για το πρώτο Petri net | Μέτριο: offline batch, αλλά το μοντέλο αναφοράς χρειάζεται συντήρηση σε κάθε αλλαγή ροής | Υψηλή: εξειδίκευση κυρίως ακαδημαϊκή | Συχνές αλλαγές ροής ανά vendor/έκδοση λογισμικού |
| TLA+ | 🔥 8/10 | 1–2 εβδομάδες για τις πρώτες προδιαγραφές | Χαμηλό σε παραγωγή (εργαλείο σχεδίασης, όχι runtime)· οι προδιαγραφές πρέπει να ακολουθούν κάθε αλλαγή κανόνα | Πολύ υψηλή: σπάνια δεξιότητα, συνήθως εκπαίδευση in-house | Αναφορές προς ρυθμιστή όπου μια λάθος ταξινόμηση έχει νομικό/εμπορικό κόστος |
| Bayesian network (NumPyro) | 🔥 9/10 | 4–8 εβδομάδες (μοντέλο + βαθμονόμηση) | Υψηλό: επανεκπαίδευση, παρακολούθηση drift, ερμηνεία πιθανοτήτων για τους μηχανικούς | Πολύ υψηλή: probabilistic ML με γνώση RF | ≥10³ επισημασμένες κλήσεις και αναφορές με διαστήματα εμπιστοσύνης |

## Μετρήσεις σε ελεγμένα δεδομένα (THESSALONIKI_26H2)

91 drop/fail κλήσεις (24 Dropped, 67 Failed), **όλες με ελεγμένο σχόλιο** · 2 collections (SAL_PERIHORA_SUBURBS, SAL_THESSALONIKI_MAJOR CITIES) · τεχνολογία GSM 67 / LTE 16 / GSM-LTE 8. Τρέξιμο του baseline στην εφαρμογή.

**Αναλυτικά:** [audit-thessaloniki.md](audit-thessaloniki.md) — πίνακας με όλα τα 91 sessions (βαθμός, ετυμηγορία, σκορ content/CF/hybrid, md, περίληψη audit) και μέσοι όροι ανά κατηγορία σχολίου, status, collection, τεχνολογία και A-side Location.

| Μέσοι όροι ανά τεχνολογία | Κλήσεις | % σωστά | Μέσος βαθμός | Μέσο hybrid |
|---|---|---|---|---|
| GSM | 67 | 87% | 82.4 | 0.65 |
| LTE | 16 | 53% | 59.3 | 0.43 |
| GSM/LTE | 8 | 50% | 62.5 | 0.41 |
| **Σύνολο** | 91 | 78% | 76.8 | 0.59 |

| Μέτρηση | THESSALONIKI_26H2 (ελεγμένα) | CYC_26H2 (σύγκριση) |
|---|---|---|
| **Audit (pptx)** — χρόνος στον browser (audit + md μαζί) | 54 s / 91 κλήσεις = **0,59 s/κλήση** | 78 s / 150 = 0,52 s/κλήση |
| **Audit (pptx)** — συμφωνία με το σχόλιο (σωστό / κρίθηκαν) | **78%** (67/86) · μερικώς 16 · λάθος 3 · ανεπαρκή 4 | 82% (121/148) |
| **Audit (pptx)** — οικογένεια χρήστη = audit | 79% (90 κλήσεις) | 88% (150) |
| **md (§1.6)** — οικογένεια χρήστη = md | 61% (23 κλήσεις εντός md) | 58% (73) |
| **md (§1.6)** — εκτός md (καθαρό CS-GSM) | 67 / 91 | 77 / 150 |
| **Audit (pptx)** — κανόνας DRB 3 στα ελεγμένα «CORE NETWORK (DRB RELEASE 3)» | **0 / 2** εντοπίστηκαν | — (κανένα τέτοιο σχόλιο) |

Audit (pptx) ανά κατηγορία σχολίου (THESSALONIKI): CORE NETWORK (DL CHANNEL RELEASE) 26/28 σωστά · LC GSM 11/16 · LQ GSM 10/11 · FAKE EOF 4/7 · FAKE UE STUCK (UL DISCONNECT) 7/7 · LC LTE 4/4 · LQ LTE 3/5 · CORE NETWORK (SIP 5xx) 0/4 (4 μερικώς) · CORE NETWORK (DRB RELEASE 3) 0/2.

### Τι αλλάζει στον πίνακα κόστους

| Approach | Payoff horizon (εκτίμηση) | Τι δείχνουν τα μετρημένα δεδομένα |
|---|---|---|
| Κανόνες ως δεδομένα | ≥2 μεθοδολογίες | **Έχει ήδη φτάσει**: σε μία ημέρα άλλαξαν όριο RxLev (−100 → −93) και 4 φορές ο ορισμός του κανόνα DRB· τα 2 ελεγμένα DRB (0/2) δείχνουν ότι ο κανόνας χρειάζεται ακόμη ρύθμιση από τον αναλυτή, χωρίς release |
| FastAPI + Redis | ≥10³ κλήσεις | Στα 0,52–0,59 s/κλήση, 10³ κλήσεις ≈ **9–10 λεπτά** στον browser· οι δύο βάσεις έχουν 91–150 drop/fail, άρα δεν έχει φτάσει ακόμα |
| Kafka + Flink CEP | live καμπάνιες | Δεν μετράται από ιστορικά δεδομένα |
| Process mining | συχνές αλλαγές ροής | Ένδειξη: το DRB release εμφανίζεται είτε στο LTE-RRC είτε στο 5GNR-RRC (`IE-RadioBearerConfig`) — η ροή διαφέρει ανά κλήση |
| TLA+ | ρυθμιστικές αναφορές | Δεν μετράται |
| Bayesian network | ≥10³ επισημασμένες κλήσεις | Διαθέσιμες σήμερα **241** σχολιασμένες drop/fail (150 CYC + 91 THESSALONIKI) — κάτω από το όριο |

## Απόφαση υλοποίησης

Baseline (🔥 2/10, χρόνος ως το πρώτο commit: ώρες, ops burden: κανένα): `src/lib/mdClassifier/` — καθαρές συναρτήσεις TS, παράμετροι σε `config.ts` (όρια, user codes), επαναχρησιμοποίηση του bundle του audit (μηδέν νέα requests). Με βάση τις μετρήσεις στα ελεγμένα δεδομένα, το επόμενο βήμα είναι οι **κανόνες ως δεδομένα** (🔥 3/10), γιατί οι κανόνες αλλάζουν πιο συχνά από τον κώδικα. Το **FastAPI + Redis** (🔥 5/10) αξίζει όταν μια βάση ξεπεράσει ~10³ drop/fail κλήσεις.
