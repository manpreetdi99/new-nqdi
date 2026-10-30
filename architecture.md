# architecture.md — ταξινομητής του md (βήμα 2, overkill --advanced)

**Baseline:** ένας καθαρός TypeScript ταξινομητής (`src/lib/mdClassifier/`) που εφαρμόζει μόνο τους κανόνες του `volte-drop-fail-analysis.md` §1.3–1.6 πάνω στα δεδομένα που ήδη φέρνει το User comment audit (call_analysis, σήμα A/B, L3 summary, tracelog) και δείχνει πίνακα σύγκρισης κάτω από το audit. Χωρίς MCP server και email (απόφαση χρήστη).

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

## Απόφαση υλοποίησης

Baseline (🔥 2/10, χρόνος ως το πρώτο commit: ώρες, ops burden: κανένα): `src/lib/mdClassifier/` — καθαρές συναρτήσεις TS, παράμετροι σε `config.ts` (όρια, user codes), επαναχρησιμοποίηση του bundle του audit (μηδέν νέα requests). Πρώτο λογικό επόμενο βήμα αν αλλάζουν συχνά τα όρια: **κανόνες ως δεδομένα** (🔥 3/10)· αν μεγαλώσει ο όγκος: **FastAPI + Redis** (🔥 5/10).
