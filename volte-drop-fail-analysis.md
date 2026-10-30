# VoLTE Drop & Fail Assistant: έρευνα και προδιαγραφές

> Οδηγός για τον Claude Code. Καλύπτει **drops** (retainability) και **call setup failures** (accessibility).
> Το κεφάλαιο 1 είναι η έρευνα (το `research.md` του βήματος 1). Τα κεφάλαια 2–8 είναι οι προδιαγραφές για τα επόμενα βήματα.
> Τα όρια που σημειώνονται ως *ενδεικτικά* διαφέρουν ανά operator. Πριν χρησιμοποιηθούν σε αναφορά, έλεγξέ τα με τη μεθοδολογία του benchmarking σας.

---

## 0. Πώς το χρησιμοποιείς

1. Βάλε αυτό το αρχείο σε έναν άδειο φάκελο, π.χ. `volte-call-analysis/`, κάνε `git init` και άνοιξε τον Claude Code εκεί.
2. Πρώτο μήνυμα:
   ```
   Διάβασε το volte-drop-fail-analysis.md. Θα το υλοποιήσουμε σε 8 βήματα.
   Μετά από κάθε βήμα σταμάτα, δείξε μου τι έφτιαξες και ποιο skill χρησιμοποίησες,
   και περίμενε το "συνέχισε". Commit στο τέλος κάθε βήματος.
   Ξεκίνα από το βήμα 1: επιβεβαίωσε/εμπλούτισε το κεφάλαιο 1 και γράψε το research.md.
   ```
3. Για κάθε επόμενο βήμα: «συνέχισε με το βήμα N».

| Βήμα | Skill | Παραδοτέο |
|---|---|---|
| 1 | recursive-research | `research.md` |
| 2 | overkill | Επιλογή αρχιτεκτονικής |
| 3 | mcp-builder | `server/volte_mcp.py`, `data/seed.py`, `data/sample.db` |
| 4 | pict-test-designer (pypict) | `tests/*.pict`, `tests/test_*.py` |
| 5 | subagent-driven-development | Ενοποιημένο project |
| 6 | prompt-engineering | `prompts/analyst.md` |
| 7 | skill-creator | `skill/volte-call-analysis/` |
| 8 | connect (connect-apps) | Email σύνοψης |

---

## 1. Έρευνα (research.md)

### 1.1 Ορισμοί: τι είναι drop και τι είναι fail

| | Drop (retainability) | Fail (accessibility) |
|---|---|---|
| Πότε | Η κλήση **είχε εγκατασταθεί** και τερματίστηκε χωρίς να το ζητήσει ο χρήστης | Η κλήση **δεν εγκαταστάθηκε ποτέ** (δεν έφτασε σε 180 Ringing / 200 OK) |
| Βασικό KPI | VoLTE Drop Rate / Cut-off Call Ratio | VoLTE CSSR / Service Non-Accessibility |
| Τι κοιτάμε | Radio timeline (RSRP/SINR, HO, RLF) στα ~10 s πριν το τέλος + λόγο του BYE | Ladder RRC → NAS → SIP μέχρι το σημείο που σταμάτησε + SIP κωδικό |

**Drive test / benchmarking.** Το ETSI TS 102 250-2 είναι το πρότυπο με τους ορισμούς QoS και τα trigger points για μετρήσεις υπηρεσιών όπως η τηλεφωνία.
- Ορίζει μεταξύ άλλων **Telephony Service Non-Accessibility** και **Telephony Cut-off Call Ratio**.
- Το Cut-off Call Ratio είναι ουσιαστικά το drop ratio: οι κλήσεις που τερματίστηκαν ακούσια, διαιρεμένες με όλες τις επιτυχημένες απόπειρες κλήσης.

Σε national benchmarking, **τα trigger points της μεθοδολογίας του διαγωνισμού υπερισχύουν** των γενικών ορισμών παρακάτω.

**Οπτική δικτύου (counters).** Κατά το 3GPP TS 32.450, το E-RAB Retainability δείχνει πόσο συχνά ένας χρήστης χάνει μη ομαλά ένα E-RAB ενώ το χρησιμοποιεί. Υπολογίζεται ως αριθμός E-RAB με δεδομένα στον buffer που απελευθερώθηκαν μη ομαλά, κανονικοποιημένος σε χρόνο session. Μια απελευθέρωση μετράει ως abnormal **μόνο αν ο eNodeB είχε δεδομένα σε αναμονή** στον buffer. Το TS 32.451 τονίζει ότι το E-UTRAN KPI δείχνει **μόνο τη συνεισφορά του E-UTRAN** και όχι ολόκληρη την end-to-end εμπειρία. Γι' αυτό τα drive-test KPI (end-to-end) και τα counters (RAN) δεν βγάζουν τα ίδια νούμερα.

### 1.2 KPI και όρια

| KPI | Τύπος (λογικός) | Πηγή ορισμού | Ενδεικτικό όριο |
|---|---|---|---|
| VoLTE Drop Rate / Cut-off Call Ratio | ακούσια τερματισμένες ÷ επιτυχημένες κλήσεις | ETSI TS 102 250-2 | Operator-specific· **προς επιβεβαίωση** από τη μεθοδολογία benchmarking |
| QCI1 E-RAB Retainability | abnormal releases (με data στον buffer) ÷ session time | 3GPP TS 32.450 §6.2.1 | — |
| QCI1 E-RAB drop ratio (πρακτικός) | abnormal QCI1 releases ÷ όλα τα QCI1 releases | Συνήθης πρακτική / patents | — |
| VoLTE CSSR (SIP) | (πρώτο 180 ή 200 + αποδεκτοί κωδικοί χρήστη) ÷ αρχικά INVITE | TL 9000 VSSR | ≥ 99% (ενδεικτικό) |
| QCI1 E-RAB Accessibility | επιτυχημένα QCI1 E-RAB setup ÷ απόπειρες | 3GPP TS 32.450 §6.1.1 | > 99% (ενδεικτικό, εξαρτάται από operator και GBR admission) |
| IMS Registration Success Rate | 200 OK REGISTER ÷ REGISTER (χωρίς 401) | Συνήθης πρακτική | ≥ 99% (ενδεικτικό) |
| Call Setup Time / Post-Dial Delay | INVITE → πρώτο 180 Ringing | ETSI TS 102 250-2 (setup time) | Operator-specific |
| SRVCC Success Rate | επιτυχημένα PS→CS HO ÷ απόπειρες | 3GPP TS 23.216 (διαδικασία) | — |
| NR (NSA/SA) | DRB / QoS flow retainability, DRB accessibility | 3GPP TS 28.554 | — |

Σημειώσεις για τα ενδεικτικά όρια:
- Σε οδηγό KPI του Ericsson αναφέρεται ότι το QCI1 accessibility εξαρτάται από τη στρατηγική του operator, αλλά κανονικά πρέπει να είναι > 99%.
- Σε υλικό εκπαίδευσης VoLTE, τα RSR και CSSR δίνονται με υγιές εύρος 99%+.
- Για το drop, μια μελέτη MRO δίνει ως στόχο για VoLTE το ισοδύναμο του 1% ανά 100 s του 3G CS voice, χωρίς ανάκαμψη μέσω re-establishment.

### 1.3 Αιτίες drop

| Αιτία | Μηχανισμός | Υπογραφή στα drive-test δεδομένα | Πηγή |
|---|---|---|---|
| **RTP/RTCP timeout** | Το UE δεν λαμβάνει RTP για διάστημα πάνω από τον inactivity timer και κλείνει την κλήση | SIP **BYE** από UE με Reason «RTP/RTCP timeout»· κενό στο DL RTP ≥ 10 s πριν το BYE· συχνά χαμηλό UL SINR / μεγάλο path loss | Patents Ericsson & άλλων· RADCOM |
| **RLF (Radio Link Failure)** | Λήξη T310 (μετά από N310 out-of-sync), random access problem ή max RLC retransmissions | `RRCConnectionReestablishmentRequest` με cause `otherFailure`· RSRP/SINR που πέφτουν πριν· αν αποτύχει το re-establishment (T311 / Reject) → drop | 3GPP TS 36.331 §5.3.11.3 |
| **HO failure** | Λήξη T304 χωρίς ολοκλήρωση του HO | `RRCConnectionReconfiguration` με `mobilityControlInfo` χωρίς `...Complete`, μετά re-establishment με cause `handoverFailure`· too-late (πέφτει το RSRP της serving) ή too-early / wrong cell | 3GPP TS 36.331 §5.3.5.6 |
| **SRVCC failure** | Αποτυχία PS→CS: πριν το session transfer, μετά, ή στο ράδιο μετά το HO command | `MobilityFromEUTRACommand` χωρίς επιτυχή μετάβαση σε 2G/3G και επιστροφή σε LTE· ή reject «Session Transfer leg establishment error» (π.χ. invalid STN-SR) | 3GPP TS 23.216 §8 |
| **Abnormal QCI1 E-RAB release (RAN/EPC)** | Ο eNB/MME απελευθερώνει τον bearer με μη κανονικό cause | `UEContextRelease` / `E-RAB Release` με radio ή transport cause· `Deactivate EPS bearer` στο DL με κακό SINR | 3GPP TS 32.450 / πρακτική |
| **IMS/Core initiated** | Ο κόμβος IMS τερματίζει τον διάλογο | BYE από δίκτυο με Reason 5xx· λήξη session timer (π.χ. drop σε ακριβώς 30 λεπτά) | Πρακτική (TAS/CSCF session timer) |
| **Unknown / log gap** | Λείπει signalling | Κενό στο log· drop που καταγράφεται στο τέλος του αρχείου | Πρακτική ανάλυσης drive test |

### 1.4 Αιτίες fail ανά στάδιο

Η εγκατάσταση κλήσης σπάει σε στάδια: attempt / pre-alerting → alerting (180 Ringing) → answer (200 OK, ACK). Αν κάποιο βήμα δεν ολοκληρωθεί μέσα στον χρόνο του network timer, η εγκατάσταση αποτυγχάνει.

| Στάδιο | Τι αποτυγχάνει | Υπογραφή | Αιτίες |
|---|---|---|---|
| **RRC** | Σύνδεση ραδιο | `RRCConnectionRequest` χωρίς Setup (T300) ή `RRCConnectionReject` | Κάλυψη, συμφόρηση, access barring |
| **PAGING** (μόνο MT) | Το UE δεν απαντά στο paging | Δεν εμφανίζεται Service Request / INVITE στο MT | Κάλυψη, TAU/idle προβλήματα |
| **IMS_REG** | Το UE δεν είναι registered | REGISTER με 403/408/5xx ή καθόλου εγγραφή | Provisioning, P-CSCF |
| **BEARER** | Δεν στήνεται ο dedicated QCI1 bearer | `Activate dedicated EPS bearer` λείπει ή reject· E-RAB setup failure | GBR admission, συμφόρηση, PCRF/Rx |
| **PRECONDITION** | Η ροή 183/PRACK/UPDATE δεν ολοκληρώνεται | 183 χωρίς PRACK/UPDATE, μετά CANCEL → 487 από το δίκτυο, ή 580 | Bearer δεν στήθηκε έγκαιρα, καθυστερήσεις IMS |
| **INVITE** | Αρνητική τελική απάντηση | 408, 500, 503, 504 χωρίς προηγούμενο 180 | IMS core, routing, overload |
| **RINGING_TIMEOUT** | Δεν έρχεται 180 μέσα στο όριο | INVITE → 100 → (183) → λήξη timer → CANCEL | Καθυστέρηση στην πλευρά του B |
| **FALLBACK** | Η κλήση πέφτει σε CS / άλλο RAT | CSFB / redirect πριν το 180 | Ανάλογα με τη μεθοδολογία μετράει ως fail ή όχι |

Στο μοντέλο precondition, πριν τον ringing πρέπει να έχουν στηθεί οι QCI1 bearers στις δύο πλευρές. Το terminating UE μπορεί να ακυρώσει το INVITE αν ο dedicated bearer δεν στηθεί μέσα στο χρονικό όριο.

### 1.5 SIP κωδικοί: δίκτυο ή χρήστης

| Κωδικός | Σημασία | Κατηγορία για CSSR |
|---|---|---|
| 180 / 200 | Ringing / OK | **Success** (μετράει το πρώτο από τα δύο) |
| 486 Busy Here | Ο B μιλάει | **User**: δεν μετράει ως fail (σε benchmarking συνήθως άκυρη δοκιμή) |
| 603 Decline, 604 | Απόρριψη / δεν υπάρχει | **User**: το TL 9000 VSSR τα μετράει ως success |
| 487 Request Terminated | CANCEL | Αν το CANCEL το έκανε ο χρήστης → user· αν το δίκτυο (NW initiated CANCEL) → **fail** |
| 404 | Not found | Συνήθως λάθος ρύθμισης δοκιμής → άκυρη |
| 408, 480 | Timeout, temporarily unavailable | **Network fail** (το 480 να ελεγχθεί κατά περίπτωση) |
| 500, 503, 504 | Server errors | **Network fail** |
| 580 | Precondition failure | **Network fail** (στάδιο PRECONDITION) |

> Κανόνας: η λίστα «user codes» να είναι **παράμετρος ρύθμισης**, όχι hard-coded, γιατί κάθε μεθοδολογία την ορίζει διαφορετικά.

### 1.6 Κανόνες ταξινόμησης (για τον classifier)

**Drop**, με σειρά προτεραιότητας:
1. Υπάρχει `MobilityFromEUTRACommand` / SRVCC σε εξέλιξη στα τελευταία 5 s → `SRVCC_FAIL`
2. Re-establishment με cause `handoverFailure` ή HO χωρίς Complete → `HO_FAIL`
3. Re-establishment με cause `otherFailure` ή ένδειξη T310 / RLC max retx → `RLF`
4. BYE από UE με Reason RTP/RTCP timeout ή DL RTP gap ≥ 10 s → `RTP_TIMEOUT`
5. BYE/release από δίκτυο με cause 5xx / session timer → `CORE_RELEASE`
6. Κενό signalling → `UNKNOWN_LOG_GAP`
- Confidence: high αν υπάρχει ρητό μήνυμα· medium αν υπάρχει μόνο radio pattern (RSRP < −115 dBm ή SINR < −3 dB στα τελευταία 5 s, **ενδεικτικά όρια, παραμετρικά**)· low αλλιώς.

**Fail**: εντόπισε το **τελευταίο στάδιο που ολοκληρώθηκε** και ονόμασε το επόμενο ως failure stage (RRC → PAGING → IMS_REG → INVITE → BEARER/PRECONDITION → RINGING). Μετά εφάρμοσε τον πίνακα 1.5 για network ή user.

### 1.7 Ανοιχτά σημεία προς επιβεβαίωση
- Ακριβή όρια drop rate / CSSR που ισχύουν στη δική σας μεθοδολογία benchmarking.
- Αν τα CSFB / fallback μετράνε ως fail.
- Τιμή του RTP inactivity timer στα δίκτυα που μετράτε. Στη βιβλιογραφία δίνεται συνήθως 10–30 s.
- Σε NR SA: χειρισμός EPS fallback (εκτός scope για αρχή).

---

## 2. Αρχιτεκτονική (βήμα 2, skill: overkill)

| Επιλογή | Περιγραφή | Πολυπλοκότητα |
|---|---|---|
| A. Απλό | SQL queries + prompt, χωρίς server | 1/5 |
| **B. Προτεινόμενο** | MCP server (6 εργαλεία, read-only) + classifier + skill | 3/5 |
| C. Overkill | B + RAG σε 3GPP/ETSI specs + ML classifier + auto ladder diagrams + Power BI | 5/5 |

Πρόταση: **B με κοινό schema για drop και fail** (`volte-call-analysis`). Αργότερα το SQLite αλλάζει σε SQL Server αλλάζοντας ένα αρχείο, `db.py`.

---

## 3. MCP server (βήμα 3, skill: mcp-builder)

### 3.1 Schema (SQLite, ίδιο λογικό μοντέλο για SQL Server)

```sql
CREATE TABLE calls (
  call_id TEXT PRIMARY KEY, campaign TEXT, region TEXT, operator TEXT,
  direction TEXT CHECK (direction IN ('MO','MT')),
  technology TEXT, vendor TEXT, band TEXT, mobility TEXT,
  start_ts TEXT, alert_ts TEXT, end_ts TEXT,
  result TEXT CHECK (result IN ('OK','DROP','FAIL','INVALID')),
  sip_final_code INTEGER, lat REAL, lon REAL
);
CREATE TABLE radio_samples (
  call_id TEXT, ts TEXT, rsrp REAL, rsrq REAL, sinr REAL, pci INTEGER, earfcn INTEGER
);
CREATE TABLE signalling (
  call_id TEXT, ts TEXT, layer TEXT CHECK (layer IN ('RRC','NAS','S1','SIP','RTP')),
  dir TEXT, message TEXT, cause TEXT, code INTEGER
);
CREATE TABLE classification (
  call_id TEXT PRIMARY KEY, category TEXT, stage TEXT, cause TEXT,
  confidence TEXT, evidence TEXT  -- JSON με τα μηνύματα που στήριξαν την απόφαση
);
```

### 3.2 Sample δεδομένα (`data/seed.py`)
- 5.000 κλήσεις, regions π.χ. `Epirus`, `Central Macedonia`, `Attica`, operators `OP_A/OP_B/OP_C` (συνθετικά).
- ~1% drops: RLF 35%, HO_FAIL 20%, RTP_TIMEOUT 25%, SRVCC_FAIL 10%, CORE 10%.
- ~1,5% fails: RRC 15%, PAGING 15%, BEARER/PRECONDITION 25%, INVITE 5xx 25%, RINGING 10%, IMS_REG 10%.
- ~1% user codes (486/603), για να ελεγχθεί ότι **δεν** μετράνε ως fail.
- Ρεαλιστικά radio patterns: πτώση RSRP/SINR πριν από RLF/HO, καλό ράδιο σε CORE/INVITE.
- Seed σταθερό (`random.seed(42)`) για αναπαραγώγιμα tests.

### 3.3 Εργαλεία (όλα `readOnlyHint=true`, Pydantic inputs, `format: concise|detailed`, όριο ~25k χαρακτήρες)

| Εργαλείο | Είσοδος | Έξοδος |
|---|---|---|
| `get_drops` | region, period_from, period_to, technology?, operator?, limit=50 | Λίστα drops: call_id, ώρα, cause, confidence, RSRP/SINR στο τέλος |
| `drop_causes` | call_id | Timeline 10 s πριν το drop (radio + signalling), αιτία, confidence, evidence |
| `kpi_summary` | region, period, operator? | Attempts, drops, drop %, top αιτίες, σύγκριση με παραμετρικό όριο |
| `get_failures` | region, period_from, period_to, direction?, technology?, limit=50 | Λίστα fails: call_id, στάδιο, SIP code, network/user |
| `failure_trace` | call_id | Ladder RRC→NAS→SIP μέχρι το σημείο αποτυχίας, στάδιο, αιτία |
| `cssr_summary` | region, period, operator?, direction? | CSSR, fails ανά στάδιο και κωδικό, MO/MT, εξαιρέσεις user codes |

- Τα όρια και οι user codes διαβάζονται από `config.toml`, όχι από τον κώδικα.
- Τα errors προτείνουν επόμενη ενέργεια, π.χ. «Δεν βρέθηκαν drops· δοκίμασε μεγαλύτερη περίοδο ή χωρίς φίλτρο technology».
- Δήλωση για αυτό το project μόνο: `claude mcp add volte-calls --scope project -- python server/volte_mcp.py`
- Έλεγχος: `python -m py_compile server/volte_mcp.py`, και στο `/mcp` πρέπει να δεις ✓ volte-calls · 6 tools.

---

## 4. Pairwise tests (βήμα 4, skill: pict-test-designer)

### 4.1 Drop model (`tests/drop.pict`)
```
Technology: LTE, NR-NSA
Vendor:     Ericsson, Nokia, Huawei
Cause:      RLF, HO_FAIL, SRVCC_FAIL, RTP_TIMEOUT, CORE_RELEASE
Band:       B3, B7, B20, n78
Mobility:   Static, Walk, Car, Highway

IF [Technology] = "LTE" THEN [Band] <> "n78";
IF [Cause] = "SRVCC_FAIL" THEN [Technology] = "LTE";
IF [Mobility] = "Static" THEN [Cause] <> "HO_FAIL";
```

### 4.2 Fail model (`tests/fail.pict`)
```
Direction:  MO, MT
Technology: LTE, NR-NSA
Vendor:     Ericsson, Nokia, Huawei
Stage:      RRC, PAGING, IMS_REG, BEARER, PRECONDITION, INVITE, RINGING
SipCode:    NONE, 408, 480, 486, 500, 503, 504, 580, 603
Band:       B3, B7, B20, n78

IF [Stage] = "PAGING" THEN [Direction] = "MT";
IF [Stage] IN {"RRC", "PAGING", "BEARER"} THEN [SipCode] = "NONE";
IF [Stage] IN {"INVITE", "PRECONDITION", "RINGING"} THEN [SipCode] <> "NONE";
IF [Stage] = "PRECONDITION" THEN [SipCode] IN {"580", "408", "503"};
IF [Technology] = "LTE" THEN [Band] <> "n78";
```

### 4.3 Στρατηγική
- Κάθε γραμμή του PICT γίνεται συνθετική κλήση με την αντίστοιχη υπογραφή. Το test ελέγχει ότι ο classifier βγάζει την **ίδια** αιτία / στάδιο.
- Ειδικά tests:
  - Οι 486/603 → `INVALID`/user και **όχι** στο CSSR.
  - Το NW-initiated CANCEL → fail.
  - Ένα drop με κενό log → `UNKNOWN_LOG_GAP` με confidence low.
- Unit tests για τους τύπους των KPI με χειροποίητα νούμερα (π.χ. 3 drops / 300 κλήσεις = 1,00%).
- Όλη η σουίτα: `pytest -q`.

---

## 5. Subagents (βήμα 5, skill: subagent-driven-development)

| Agent | Αρμοδιότητα | Review checkpoint |
|---|---|---|
| A: server | `db.py`, classifier, 6 εργαλεία | Τα tests του B περνούν; τα outputs είναι μέσα στο όριο χαρακτήρων; |
| B: tests | PICT models, `test_pairwise.py`, `test_kpi.py` | Καλύπτουν όλους τους κανόνες του 1.6; |
| C: docs | `README.md`, `docs/sip-codes.md`, `docs/cause-signatures.md` | Συμφωνούν με το research.md; |

Ο κύριος agent ενώνει και τρέχει όλη τη σουίτα. Αν θες λιγότερα tokens, γίνεται και σειριακά.

---

## 6. System prompt αναλυτή (βήμα 6, skill: prompt-engineering), πρώτο draft

```markdown
Είσαι αναλυτής απόδοσης VoLTE για drive-test / benchmarking δεδομένα.

Εργαλεία: kpi_summary, get_drops, drop_causes, cssr_summary, get_failures, failure_trace.

Ροή:
1. Ξεκίνα πάντα από kpi_summary ή cssr_summary για την περιοχή και την περίοδο.
2. Αν το KPI είναι εκτός ορίου: πάρε τη λίστα (get_drops / get_failures).
3. Για τα top 10 ανά αιτία/στάδιο: drop_causes / failure_trace.
4. Ομαδοποίησε ανά αιτία, cell (PCI/EARFCN), τεχνολογία και mobility.
5. Πρότεινε ενέργειες ανά ομάδα (RF/optimization, parameters, core/IMS).

Κανόνες:
- Μην εικάζεις αιτία χωρίς evidence. Αν confidence = low, πες το ρητά.
- Ανέφερε πάντα call_ids για κάθε ισχυρισμό.
- Οι κωδικοί χρήστη (486, 603, user CANCEL) δεν είναι πρόβλημα δικτύου.
- Ξεχώριζε RAN από core/IMS πριν προτείνεις λύση.
- Τα όρια είναι αυτά του config, όχι γενικές τιμές.

Μορφή απάντησης:
1. Πίνακας KPI (τιμή, όριο, κατάσταση)
2. Top 3 αιτίες/στάδια με πλήθος, % και παραδείγματα call_ids
3. Χαρακτηριστικά ευρήματα (cells, περιοχές, συνθήκες ράδιο)
4. Ενέργειες, με προτεραιότητα
5. Τι δεν μπορεί να συμπεράνει κανείς από τα δεδομένα
```
Έλεγχος: η ίδια ερώτηση δύο φορές πρέπει να δίνει την ίδια δομή απάντησης· δοκίμασε μία περιοχή εντός ορίων και μία εκτός.

---

## 7. Skill (βήμα 7, skill: skill-creator)

```
skill/volte-call-analysis/
├─ SKILL.md
├─ references/
│  ├─ research.md
│  ├─ cause-signatures.md
│  └─ sip-codes.md
└─ prompts/analyst.md
```
Frontmatter:
```yaml
---
name: volte-call-analysis
description: Analyse VoLTE call drops and call setup failures from drive-test or benchmarking data (RLF, HO fail, SRVCC, RTP timeout, CSSR, SIP 4xx/5xx, QCI1 bearer). Use with the volte-calls MCP tools.
---
```
- Το `name` πρέπει να είναι ίδιο με το όνομα του φακέλου, γιατί το OpenCode το απαιτεί.
- Έλεγχος με `quick_validate.py`, μετά αντιγραφή στο `%USERPROFILE%\.claude\skills\` και ένα `.zip` για το claude.ai.
- Δοκιμή σε νέα συνεδρία: «Ανάλυσε drops και fails στην Ήπειρο τον τελευταίο μήνα». Το skill πρέπει να ενεργοποιηθεί μόνο του.

---

## 8. Email σύνοψης (βήμα 8, skill: connect)

- Προϋπόθεση: στο `/mcp` το `connect-apps` δείχνει ✓. Αλλιώς στείλε μέσω του Gmail connector.
- Ο Claude Code δείχνει το κείμενο **πριν** στείλει.
- Template:
  ```
  Θέμα: VoLTE Call Analysis: τι φτιάχτηκε
  - MCP server volte-calls: 6 εργαλεία (drop + fail), sample SQLite
  - Tests: N pairwise + M unit, όλα πράσινα
  - Skill: volte-call-analysis (εγκατεστημένο)
  - Δείγμα ανάλυσης: drop rate X%, CSSR Y%, top αιτίες …
  - Επόμενο: σύνδεση με SQL Server data warehouse
  ```

---

## Πηγές

- 3GPP TS 32.450: E-UTRAN KPI definitions (Accessibility, Retainability). https://itecspec.com/3gpp/32.450/s/6.2.1.1
- 3GPP TS 32.451: KPI requirements. https://whatthespec.net/friendlyspec/spec/32.451/19.0.0
- 3GPP TS 36.331 §5.3.11.3: Detection of radio link failure. https://itecspec.com/3gpp/36.331/s/5.3.11.3
- 3GPP TS 36.331 §5.3.7.2: RRC re-establishment initiation. https://itecspec.com/3gpp/36.331/s/5.3.7.2
- 3GPP TS 23.216 §8: SRVCC handover failure. https://itecspec.com/spec/3gpp-23-216-8-handover-failure
- 3GPP TS 28.554: 5G end-to-end KPI. https://www.3gpp.org/ftp/tsg_sa/WG5_TM/TSGS5_160/SA108/28554-j40.docx
- ETSI TS 102 250-2: QoS parameters and computation. https://etsi.org/deliver/etsi_TS/102200_102299/10225002/02.05.01_60/ts_10225002v020501p.pdf
- TL 9000: Voice Setup Success Rate. https://www.tl9000.org/resources/documents/Voice%20Setup%20Success%20Rate.doc
- TL 9000: Voice Drop Call Rate. https://www.tl9000.org/resources/documents/Voice%20Drop%20Call%20Rate.doc
- RADCOM: Delivering Quality VoLTE Services. https://radcom.com/wp-content/uploads/2021/01/Delivering-Quality-VoLTE-Services-2.pdf
- Netmanias: Dedicated bearer setup and VoLTE precondition. https://netmanias.com/en/post/blog/11789/lte-volte/dedicated-bearer-setup-in-lte-and-impact-on-volte-precondition
- Self-Organizing MRO in LTE (drop target). https://arxiv.org/pdf/1310.6173
- VoLTE KPI (Ericsson counters, QCI1 accessibility). https://www.scribd.com/presentation/413620159/VoLTE-KPI-pptx
- VoLTE KPI performance (RSR/CSSR). https://www.slideshare.net/vikasshokeen/volte-kpi-performance
