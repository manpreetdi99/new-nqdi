# Hallazgos
1. ACK ≠ σύνδεση: ACK και για 4xx/5xx/6xx (RFC 3261). Στο CYC οι 2 κλήσεις του κανόνα DRB-μετά-ACK έχουν ACK σε 487 μετά CANCEL.
2. DRB 3 ≠ πάντα QCI1: η φωνή ήταν DRB 3, 4 ή 5 ανάλογα την κλήση (drb-ToAddModList ↔ eps-BearerIdentity 7/8).
3. QCI1 release μετά από επιτυχές HO δεν είναι drop (32.425).
4. eNB-detected RLF → E-RAB release από MME: ο DRB release μόνος του δεν αποδεικνύει core.
5. RxLev Full vs Sub: 10–25 dB διαφορά σε κλήσεις με DTX — χρήση Sub.
