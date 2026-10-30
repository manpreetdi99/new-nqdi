# research.md — VoLTE drop & fail: κανόνες ταξινομητή (βήμα 1, recursive-research)

> Επιβεβαίωση / εμπλουτισμός του κεφαλαίου 1 του `volte-drop-fail-analysis.md`.
> Εκτέλεση: μικτή (τοπικές πηγές + web), 3 κύκλοι, κλείσιμο λόγω ορίου κύκλων (όχι «επίπεδο PhD»).
> Αναλυτικά ίχνη: `memoria/investigaciones/volte-drop-fail-classifier/`.

## 1. Τι επιβεβαιώθηκε

| Θέμα (md) | Αποτέλεσμα | Πηγή |
|---|---|---|
| §1.1 Drop = κλήση που είχε στηθεί και τερματίστηκε ακούσια | Επιβεβαιώνεται· TL 9000 ορίζει το Voice Drop Call Rate ως κλήσεις που τερματίζονται πριν την αποσύνδεση από τον χρήστη | TL 9000 VDCR (T2) |
| §1.1 Fail = δεν έφτασε σε alerting | Επιβεβαιώνεται· σε ETSI-based ορισμούς CSSR, χωρίς ALERTING το δείγμα μετράει αποτυχία | ETSI TS 102 250-2 V2.2.1 (μέσω ρυθμιστικού κειμένου, T2) |
| §1.2 KPI πρέπει να είναι παραμετρικά ανά μεθοδολογία | Επιβεβαιώνεται· οι ρυθμιστές ορίζουν δικά τους trigger points (ETSI EG 202 057, ITU-T E.804) | T2 |
| §1.3 RLF → RRCConnectionReestablishmentRequest | Επιβεβαιώνεται από τα δεδομένα: 65 κλήσεις CYC με UL Reestablishment Request, 9 με Reject | Τοπικά δεδομένα (T1 τοπικό) |
| §1.3 SRVCC → MobilityFromEUTRACommand | Επιβεβαιώνεται (13 κλήσεις CYC)· pptx #6/#7: drop μετά SRVCC όταν το GSM target είναι αδύναμο | Τοπικά + pptx |
| §1.5 486/603 = χρήστης | Χωρίς αλλαγή | md |

## 2. Νέα ευρήματα (δεν υπάρχουν στο md)

1. **Το SIP ACK δεν σημαίνει σύνδεση.** Κατά το RFC 3261 §6/§17.1.1.3, ACK στέλνεται και για **μη-2xx** τελική απάντηση στο INVITE (μέρος της ίδιας transaction), ενώ το ACK του 200 OK είναι ξεχωριστή transaction. Στο CYC_26H2 οι 2 κλήσεις που πιάνει ο κανόνας «DRB 3 μετά το ACK» έχουν ACK σε **487 Request Terminated μετά από CANCEL** (781684047906, 1511828488270).
   → Ο ταξινομητής πρέπει να ξεχωρίζει «ACK μετά 200 OK» από «ACK μετά από σφάλμα».
2. **Το DRB 3 δεν είναι πάντα ο bearer φωνής.** Η αντιστοίχιση DRB → EPS bearer φαίνεται στο `drb-ToAddModList` (`drb-Identity` ↔ `eps-BearerIdentity`). Στο CYC: 781684047906 B: DRB 3 ↔ EBI 7 (φωνή)· 1520418422822 B: DRB 3 ↔ EBI 6, ενώ η φωνή είναι DRB 5 ↔ EBI 7· 1511828488270 A και 34359738410 A: φωνή = DRB 4.
   → Ο κανόνας πρέπει να βρίσκει **ποιο DRB αντιστοιχεί στον dedicated (QCI1) bearer** και όχι να υποθέτει το 3.
3. **Απελευθέρωση QCI1 μετά από handover δεν είναι drop** (3GPP TS 32.425 A.2): αν ο bearer στήθηκε στο target cell, η release στο source δεν γίνεται αντιληπτή ως drop.
4. **Release του QCI1 από το δίκτυο** συνδέεται με RLF που ανιχνεύει το eNB (E-RAB Release Command από MME), άρα «DRB release» μόνο του δεν αποδεικνύει core αιτία — χρειάζεται και καλό ράδιο (όπως λέει και το pptx #10).
5. **Όρια ράδιο τοπικά (pptx + δεδομένα)**: LC LTE με RSRP −123…−133 και RSRQ −19…−22· LQ LTE με RSRQ −14…−18· GSM «acceptable» −56…−88, «weak» −108/−109 (RxLev **Sub**, λόγω DTX το Full είναι τεχνητά χαμηλό κατά 10–25 dB στα δεδομένα).

## 3. Κανόνες για τον ταξινομητή του md (§1.6), όπως θα υλοποιηθούν

Drop (σειρά προτεραιότητας): SRVCC_FAIL → HO_FAIL → RLF → RTP_TIMEOUT → CORE_RELEASE → UNKNOWN_LOG_GAP, confidence high/medium/low όπως §1.6.
Fail: τελευταίο ολοκληρωμένο στάδιο RRC → PAGING → IMS_REG → INVITE → BEARER/PRECONDITION → RINGING, network/user από §1.5.
Ο ταξινομητής του md **δεν** χρησιμοποιεί τους κανόνες του pptx (ώστε η σύγκριση με το audit να δείχνει τη διαφορά των δύο προσεγγίσεων).

## 4. Τι δεν ξέρουμε (gaps)

- Το κείμενο του ETSI TS 102 250-2 για τα trigger points του Cut-off Call Ratio δεν ανακτήθηκε (μόνο δευτερογενείς παραπομπές).
- Το κανονιστικό κείμενο του 36.331 §5.3.10.2 (DRB release) διαβάστηκε μόνο μέσω περιγραφής conformance test.
- Δεν ελέγχθηκε ποιο QCI έχει κάθε EBI (χρειάζεται το `Activate dedicated EPS bearer context request` με το EPS QoS).

## Πηγές

- RFC 3261 (SIP), §6, §17.1.1.3 — https://www.rfc-editor.org/rfc/rfc3261 (T1)
- 3GPP TS 36.523-1 §8.2.3 Radio bearer release — https://itecspec.com/spec/3gpp-36-523-1-8-2-3-radio-bearer-release (T1, μόνο περίγραμμα)
- 3GPP TS 32.425 A.2 — https://itecspec.com/3gpp/32.425/s/a.2 (T1)
- TL 9000 Voice Drop Call Rate — https://www.tl9000.org/resources/documents/Voice%20Drop%20Call%20Rate.doc (T2)
- ETSI TS 102 250-2 V2.2.1 μέσω ρυθμιστικού κειμένου — https://ictpolicyafrica.org/fr/document/c37xjpo4i0h?page=13 (T2)
- Telecomhall: QCI1/QCI5/QCI9 DRBs — https://www.telecomhall.net/t/when-default-bearer-of-ims-signaling-is-released-in-volte-call/12010 (T3)
- Τοπικά: `volte-drop-fail-analysis.md`, `Call Analysis.pptx`, βάση CYC_26H2 (150 σχολιασμένες drop/fail κλήσεις)
