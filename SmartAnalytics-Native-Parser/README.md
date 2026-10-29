# Ανεξάρτητος SQC parser προς υπάρχοντες πίνακες SmartAnalytics

Ο parser διαβάζει `.sqc` → `.sqz` → `.mf` χωρίς εκτέλεση της εφαρμογής Smart. Δέχεται όνομα collection και ένα ή περισσότερα SQC. Ελέγχει το `.sqc.md5` όταν υπάρχει. Η προεπιλογή παράγει **μόνο σχέδιο εισαγωγής** και δεν συνδέεται στη βάση.

```powershell
python native_parser.py --collection "DOD_KOS_TOURISTIC AREAS_2026H2" `
  --output plan.json "C:\path\file1.sqc" "C:\path\file2.sqc"
```

Για εγγραφή απαιτείται `pyodbc`, εγκατεστημένος SQL Server Native Client 11 ή ODBC Driver 17 και η μεταβλητή περιβάλλοντος `SMARTANALYTICS_SQL_PASSWORD`. Προαιρετικά ορίζεται `SMARTANALYTICS_SQL_USER` (προεπιλογή `sa`). Ο κωδικός δεν γράφεται στον κώδικα, στο σχέδιο ή στα logs.

```powershell
$env:SMARTANALYTICS_SQL_PASSWORD = Read-Host "SQL password"
python native_parser.py --collection "MY_COLLECTION" --database "DOD_26H2_TEST" `
  --write --accept-partial "C:\path\new-file.sqc"
Remove-Item Env:SMARTANALYTICS_SQL_PASSWORD
```

## Τι γράφει η τρέχουσα έκδοση

Ανά MF δημιουργεί εγγραφές στους υπάρχοντες `FileList`, `FactFile`, `Sessions`, `FactSession`, `FactTest`, `Position`, `FactPosition`, `FactLTERadio`, `LTEMeasurementReport`, `FactLTENeighbors`, `FactNR5GRadio`, `FactIPThroughput`. Όλα γίνονται σε transaction ανά SQC. Απορρίπτει MF όνομα που υπάρχει ήδη στο `FileList` και κάνει rollback αν αποτύχει οποιοδήποτε βήμα. Τα IDs των Session/Test/Position/LTE report έχουν την παρατηρημένη μορφή `FileId * 2^32 + σειρά`.

Οι αντιστοιχίσεις που υλοποιήθηκαν είναι: MF MessageType `100` → όρια Session, `200/201` → Test start/end, `1001/1023` → GPS, `6206` → LTE radio, `6207` → LTE neighbors, `6604` → NR radio, `100000` → IP bytes. Η ώρα MF (Excel serial, UTC) μετατρέπεται σε `Europe/Athens` για τα native SQL πεδία. Η εγγραφή στη γνωστή παραγωγική `DOD_26H2` αποκλείεται από τον CLI όσο η native αντιστοίχιση παραμένει μερική.

Έγινε επίσης προεπισκόπηση του παρεχόμενου voice SQC με 10 MF. Τα voice MF έχουν `MeasurementType=0` και ο scanner `MeasurementType=19`. Μπορούν να αναγνωστούν ως σχέδιο, αλλά ο SQL writer δέχεται προς το παρόν μόνο το δοκιμασμένο `MeasurementType=4` (data), επειδή τα voice/scanner facts απαιτούν άλλη χαρτογράφηση.

Το `FactLTENeighbors.LTEMeasReportId` συνδέεται με το `LTEMeasurementReport`: στο πραγματικό δείγμα, τα 2.286 μηνύματα `6206` αντιστοιχούν ακριβώς σε 2.286 LTE reports και τα neighbors `6207` συνδέονται με το πιο πρόσφατο report. Η αρχική δοκιμή στη `DEMO` εντόπισε αυτή την υποχρεωτική σχέση και έκανε πλήρες rollback. Μετά τη διόρθωση, τα report/neighbor rows εισήχθησαν για τα FileId 150–152 και ο έλεγχος επέστρεψε μηδέν orphan neighbors.

## Όριο συμβατότητας

**Δεν είναι πλήρης αντικατάσταση του Smart ETL.** Το MF του δοσμένου δείγματος περιέχει 143–146 είδη μηνυμάτων και η native εισαγωγή δημιουργεί πολλούς ακόμη πίνακες `Fact*` και `Dmn*`. Δεν έχουν ανακατασκευαστεί τα παράγωγα KPI, οι dimension IDs, η επέκταση πολλαπλών carriers από ένα μήνυμα, το throughput formula, ούτε τα `ImportTasks`/`ImportFiles`/`ImportFileStatus`. Για παράδειγμα, το δείγμα έχει 2.286 μηνύματα `6206` στο Cosmote MF, ενώ το Smart ETL δημιούργησε 6.009 γραμμές `FactLTERadio`. Γι' αυτό οι νέες εγγραφές σημειώνονται `FileList.Valid=0` και `Sessions.valid=0`. Το `--accept-partial` είναι απαραίτητο για την εγγραφή και δηλώνει ότι η βάση θα περιέχει μόνο το υποστηριζόμενο υποσύνολο. Μη χρησιμοποιήσεις αυτή τη λειτουργία ως ισοδύναμη πλήρους import σε παραγωγική collection.

Υπάρχει `dbo.sqPostImport`, αλλά ο ορισμός του ενημερώνει συνολικά πίνακες όπως `Sessions` και εκτελεί πολλές άλλες procedures χωρίς παράμετρο `FileId` ή `Collection`. Ο parser δεν την καλεί, επειδή δεν αποτελεί ασφαλές post-processing ενός μόνο αρχείου.

Στο δοσμένο SQC, που υπάρχει ήδη στη `DOD_26H2`, η προεπισκόπηση αναγνωρίζει 22 sessions και 149 tests ανά MF, ίδια πλήθη με την υπάρχουσα εισαγωγή. Δεν έγιναν εγγραφές στη `DOD_26H2`.

Στη `DEMO` έγινε δοκιμαστική εγγραφή του ίδιου SQC στην collection `REA_PARSER_TEST_20261020`, με FileId 150–152. Τα τελικά πλήθη και οι έλεγχοι σχέσεων βρίσκονται στο `demo-verification.json`. Αυτή η δοκιμή δεν επαληθεύει πλήρη ισοδυναμία με το Smart ETL.

Η δοκιμαστική εισαγωγή έγινε πριν προστεθεί η αρχική συνθετική θέση στο σχέδιο. Έχει μία `Position` και μία `FactPosition` λιγότερη ανά MF (1454/1444/1457). Η τρέχουσα έκδοση του parser δίνει 1455/1445/1458, ίδια πλήθη με την αρχική εισαγωγή. Τα ήδη γραμμένα FileId 150–152 δεν τροποποιήθηκαν για αυτή τη διαφορά.

## Έλεγχος

```powershell
python -m unittest -v test_native_parser.py
```
