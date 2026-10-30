# Ανάλυση σχολίων χρηστών — CYC_26H2

Βάση: CYC_26H2 (7 collections, 3.303 κλήσεις συνολικά).

## Κατανομή κλήσεων (status)
| Status | Πλήθος |
|---|---|
| Completed | 2.959 |
| System Release | 194 |
| Failed | 107 |
| Dropped | 43 |

## Σχόλια χρηστών (347 κλήσεις με σχόλιο)
| Σχόλιο | Πλήθος | Status κλήσεων | Γιατί το έγραψε |
|---|---|---|---|
| System Release call | 194 | system release (194) | Για να επισημάνει κανονικά system releases που δεν πρέπει να μετρηθούν ως drop/fail. |
| LC GSM | 51 | dropped 22, failed 29 | Χαμηλή κάλυψη GSM → κλήσεις πέφτουν ή αποτυγχάνουν σε GSM. |
| LC LTE | 50 | dropped 15, failed 35 | Χαμηλή κάλυψη LTE → πρόβλημα σε LTE (περισσότερα fails). |
| FAKE EOF | 13 | failed 13 | Ψευδές drop/fail: η κλήση φαίνεται αποτυχία αλλά στην πραγματικότητα έκλεισε κανονικά (end of file). |
| CORE NETWORK (DL CHANNEL RELEASE) | 13 | dropped 2, failed 11 | Απελευθέρωση καναλιού από core → κυρίως fails. |
| CORE NETWORK (SIP 500/504) | 5 | failed 5 | Server errors (5xx) από IMS/core. |
| FAKE NO SYNC | 3 | failed 3 | Ψευδές: χωρίς συγχρονισμό. |
| FAKE UE STUCK (+ UL DISCONNECT) | 3 | failed 3 | Ψευδές: το UE "κόλλησε". |
| LC LTE (A/B-SIDE) | 5 | failed 4, dropped 1 | Χαμηλή κάλυψη LTE σε συγκεκριμένη πλευρά (A ή B). |
| LC GSM (B-SIDE) | 3 | dropped 2, failed 1 | Χαμηλή κάλυψη GSM στη B πλευρά. |
| LQ LTE / LQ GSM | 3 | dropped 1, failed 2 | Χαμηλή ποιότητα (όχι κάλυψη) → drop/fail. |
| Called side did not expect a call | 1 | failed 1 | Η απέναντι πλευρά δεν περίμενε κλήση (user-side). |
| CORE NETWORK (DEACTIVATE BEARER) | 1 | dropped 1 | Απελευθέρωση bearer από core → drop. |

## Συμπεράσματα
- **Συστηματικά (System Release call, 194):** Ο χρήστης επισημαίνει κανονικά system releases ώστε να εξαιρεθούν από τα KPIs (drop rate / CSSR).
- **Κάλυψη (LC GSM/LTE, ~100):** Η κύρια αιτία drops/fails είναι χαμηλή κάλυψη, κυρίως σε GSM (περισσότερα drops) και LTE (περισσότερα fails).
- **Core/IMS (~20):** Απελευθερώσεις bearer/channel και SIP 5xx από το core.
- **Ψευδή (FAKE *, ~20):** Κλήσεις που φαίνονται drop/fail αλλά στην πραγματικότητα δεν είναι πραγματικά προβλήματα δικτύου (EOF, no sync, UE stuck).
- **Ποιότητα (LQ, 3):** Σπάνια χαμηλή ποιότητα (όχι κάλυψη).

## Ευρήματα για το Demo tab
- Τα user comments ευθυγραμμίζονται με τις κατηγορίες του AI (LC → RLF/RTP, CORE → CORE_RELEASE, FAKE → FAKE_EOF).
- Το AI Comment μπορεί να συμπληρωθεί με το είδος του user comment, ώστε να επιβεβαιώνει ή να αμφισβητεί την εκτίμηση του χρήστη.