# Call Detail — πώς λειτουργεί

Το **Call Detail** είναι το sub-tab `detail` του [All Sessions tab](ALL_SESSIONS_TAB.md): όλη η
ιστορία **μιας** φωνητικής κλήσης — ραδιο-μετρήσεις, signalling, handovers, χάρτης, KPIs —
πάνω σε **έναν κοινό άξονα απόλυτου χρόνου**.

Είναι το μεγαλύτερο component του project (~3.200 γραμμές σε ένα αρχείο). Αυτό το README
εξηγεί **πώς είναι οργανωμένο**, ώστε να μη χρειάζεται να το διαβάσεις από την αρχή.

---

## 1. Αρχεία

| Αρχείο | Ρόλος |
| --- | --- |
| [src/components/CallDetail.tsx](../src/components/CallDetail.tsx) | Ο κορμός: state, τα 3 fetch effects, όλα τα derived memos, ο χάρτης, και τα περισσότερα panels. |
| [src/components/CallSignalChart.tsx](../src/components/CallSignalChart.tsx) | Το ενιαίο διάγραμμα σήματος (καμπύλη + overview + ταμπέλες event + ζώνες). |
| [src/components/SessionOverview.tsx](../src/components/SessionOverview.tsx) | Οι οριζόντιες λωρίδες (IDLE/CALL, τεχνολογία/band) πάνω από την καμπύλη. |
| [src/components/L3SignalingPanel.tsx](../src/components/L3SignalingPanel.tsx) | RRC / NAS / SIP μηνύματα: φίλτρα, timeline strip, split A/B view. |
| [src/components/CsfbTransitionPanel.tsx](../src/components/CsfbTransitionPanel.tsx) | Το CSFB ανάλογο του SRVCC panel. |
| [src/lib/signalSeries.ts](../src/lib/signalSeries.ts) | Η αριθμητική των σειρών: merge, domain, nearest, lanes, transition stats. Καθαρές συναρτήσεις, με tests. |
| [src/lib/signallingHighlights.ts](../src/lib/signallingHighlights.ts) | Severity ανά L3 μήνυμα + τα χρώματα/labels του. |
| [src/lib/signalingNavigation.ts](../src/lib/signalingNavigation.ts) | `nearestTimestampIndex`, `shouldSplitSignaling`. |
| [docs/call_detail_flow.svg](call_detail_flow.svg) · [docs/call_detail_panels_tree.svg](call_detail_panels_tree.svg) | Διαγράμματα ροής/δομής panels. |

Κανόνας: **ό,τι υπολογίζεται από σειρές χρόνου ανήκει στο `signalSeries.ts`** (testable χωρίς
render), ό,τι είναι layout μένει στο component.

---

## 2. Τι είδους κλήση είναι — οι σημαίες που ορίζουν τα πάντα

Πριν από οτιδήποτε άλλο, το component αποφασίζει **ποια σκέλη** (LTE / GSM / NR) έχει η κλήση.
Αυτές οι μεταβλητές καθορίζουν ποια endpoints θα κληθούν και ποια panels θα εμφανιστούν:

| Flag | Ορισμός | Τι οδηγεί |
| --- | --- | --- |
| `callMode` (τοπικό) | `resolveCallDetailMode(call.callMode, call.technology)` | **όλες** οι παρακάτω σημαίες το διαβάζουν, όχι το raw `call.callMode` |
| `isDualTechCall` | `callMode` = `SRVCC` ή `CSFB` | κρίνεται **μόνο** από το callMode — οδηγεί το αρχικό fetch, άρα πρέπει να είναι σταθερό |
| `wantsGsmLeg` | `CS`, dual-tech ή `UNKNOWN` | ζητάμε GSM δεδομένα; |
| `csTouchesLte` | `CS` **και** technology περιέχει LTE/4G/NR/5G | μια CS κλήση δεν σημαίνει «μόνο 2G» |
| `wantsLteLeg` | `callMode !== "CS"` ή `csTouchesLte` | ζητάμε LTE δεδομένα; |
| `isVoNRMode` | `/VoNR/i` στο callMode | χρειάζεται `FactNR5GRadio` πάνω από (ή αντί για) το LTE anchor |
| `showsGsmLeg` | dual-tech, `CS`, βρέθηκαν CSFB events εκ των υστέρων, **ή** `UNKNOWN` που γύρισε GSM δεδομένα | δείχνουμε GSM σκέλος; |
| `activeLeg` / `isGSMMode` | η επιλογή του χρήστη, **με fallback** | ποιο σκέλος δείχνουν πίνακες/καμπύλη |

Τρία σημεία που δεν είναι προφανή και έχουν διορθωθεί με κόπο:

1. **Το CSFB ανακαλύπτεται εκ των υστέρων.** Ένα CSFB σκέλος μπορεί να κρύβεται σε κλήση
   περασμένη ως VoLTE/CS (μόνο το ένα κινητό έπεσε σε 2G). Γι’ αυτό το `showsGsmLeg` είναι
   ξεχωριστή μεταβλητή από το `isDualTechCall`: μαθαίνουμε το CSFB **μετά** το fetch, αλλά δεν
   θέλουμε να ξαναγυρίσουμε πίσω και να ξαναζητήσουμε τα πάντα.
2. **Το `activeLeg` δεν εμπιστεύεται τυφλά την επιλογή του χρήστη.** Σε CSFB συχνά μόνο το ένα
   κινητό κατεβαίνει σε 2G. Αν ο χρήστης ζητήσει GSM σε πλευρά που δεν έχει GSM μετρήσεις,
   πέφτουμε στο άλλο σκέλος αντί να δείξουμε άδειο πίνακα (`sideHasGsm` / `sideHasLte`).
   Ο επιλογέας σκέλους (`canToggleLeg`) εμφανίζεται **μόνο** όταν υπάρχουν όντως και τα δύο.
3. **Πολλές κλήσεις έχουν callMode «-»** (ή κενό, που το `Index.tsx` κάνει «N/A»). Χωρίς επίλυση
   έπεφταν στην περίπτωση «VoLTE» και μια «-» κλήση σε GSM δεν ζητούσε ποτέ GSM μετρήσεις —
   άδεια σελίδα **χωρίς** banner. Το `resolveCallDetailMode()`
   ([src/lib/callDetailMode.ts](../src/lib/callDetailMode.ts)) τις επιλύει από το `technology`, με τα
   ίδια substrings (`gsm` / `umts` / `lte`) που διαβάζει το `classifyCustomCallMode` των KPI:

   | technology | resolved | φορτώνεται |
   | --- | --- | --- |
   | GSM / UMTS | `CS` | GSM (±60s παράθυρο) |
   | GSM **και** LTE (π.χ. `GSM/LTE`) | `CS` | GSM **και** LTE (μέσω `csTouchesLte`) |
   | 5G / NR (και `LTE/5G`) | `VoNR` | LTE + NR, NR γραμμές στον πίνακα/καμπύλη |
   | μόνο LTE | `VoLTE` | LTE — ίδιο με πριν |
   | κενό / N/A | `UNKNOWN` | **όλα** τα σκέλη (LTE, GSM, NR), με NR γραμμές στον πίνακα· δεν μαντεύουμε |

   Σειρά: GSM/UMTS → 5G → LTE → κενό. Το GSM είναι πρώτο γιατί ως `CS` φορτώνονται **και**
   LTE/5G (`csTouchesLte`), ενώ ως `VoNR` θα χανόταν το GSM σκέλος.

   Τα GSM scanner (κοινό και best) ζητιούνται και όταν το GSM σκέλος εμφανίζεται **εκ των
   υστέρων** (CSFB σε VoLTE ή «-» σε LTE): το κοινό ανάλογα με το αν ήρθαν GSM μετρήσεις, το
   best με `wantsGsmLeg || showsGsmLeg`.

   Η σειρά είναι **σκόπιμα αντίστροφη** από τα KPI: το `classifyCustomCallMode` (A-LEVEL) βάζει
   πρώτα το LTE, άρα `«-» + GSM/LTE` μετριέται VoLTE στο Summary. Εδώ μετράει να φορτωθούν τα
   σωστά δεδομένα, όχι η κατηγορία. Η **εμφάνιση** κρατάει το raw mode, με το resolved δίπλα
   (`Mode: - (→ CS από technology)`).

---

## 3. Τα τρία fetch effects

```
┌─ effect 1: loadRadio() ─────────── deps: [database, callId, callMode, wantsGsm/LteLeg]
│  Promise.allSettled([ 23 endpoints ])   ← όλα τα panels εκτός context, παράλληλα
│  skip-ανά-callMode: Promise.resolve({ ... άδειο }) αντί για fetch
│
├─ effect 2: loadContext() ───────── deps: [database, callId, callMode, wantsGsm/LteLeg]
│  Promise.allSettled([ 9 context endpoints ])  στα ±CONTEXT_FETCH_WINDOW_SEC (120s)
│  μία φορά ανά κλήση — το ±Ns του χρήστη ΔΕΝ το ξανατρέχει (βλ. παρακάτω)
│
└─ effect 3: antenna matching ────── deps: [cellInfo, markers/GPS]
   Cosmote Free only: ταίριασμα serving cell (PCI) με τη φυσική κεραία
```

### Effect 1 — το μεγάλο fetch

Ένα `Promise.allSettled` με **23** κλήσεις, ώστε ένα endpoint που σκάει να μη μπλοκάρει την
υπόλοιπη σελίδα. Τα fetch που δεν έχουν νόημα για το συγκεκριμένο callMode
αντικαθίστανται με ήδη-resolved άδεια τιμή:

```ts
wantsLteLeg ? fetchLteValues(database, call.callId) : Promise.resolve({ lteValues: [] })
```

Όσα αποτύχουν μαζεύονται σε `loadErrors` και εμφανίζονται ως κίτρινο banner:

> *Μερικά API panels απέτυχαν: LTE radio, Scanner comparison. Τα κενά τους δεν θεωρούνται
> «χωρίς δεδομένα».*

Αυτή η διάκριση είναι το όλο νόημα: ένας άδειος πίνακας από timeout δεν πρέπει να διαβάζεται
ως «η κλήση δεν είχε μετρήσεις».

**Ειδική περίπτωση VoNR**: το UE πηδάει μεταξύ LTE anchor και standalone NR στη μέση της
κλήσης, οπότε κανένα query μόνο του δεν λέει όλη την ιστορία. Τα δύο row sets ενώνονται
χρονολογικά, με tag `Technology: "LTE" | "NR5G"`.

### Effect 2 — το context και το ορατό παράθυρο

Δύο διαφορετικά «παράθυρα», με διαφορετικό ρόλο:

| | Τι είναι | Πού ζει | Αλλαγή του → |
| --- | --- | --- | --- |
| `CONTEXT_FETCH_WINDOW_SEC` = **120** | πόσο context ζητάμε από τη βάση | σταθερά στην κορυφή του αρχείου | 9 queries, **μία φορά ανά κλήση** |
| `viewWindowSec` (`10 / 30 / 60 / 120`) | πόσο context **δείχνουμε** | `useState`, default **±60s για CS**, **±30s** για τα άλλα | κανένα request — μόνο re-render |

Το effect 2 είναι ο **μοναδικός** ιδιοκτήτης του context state (τα 9 arrays + `contextLoadErrors`):
τα καθαρίζει στην αρχή, τα γεμίζει μετά το `allSettled`, και έχει `cancelled` guard ώστε σε
γρήγορο Prev/Next η απάντηση μιας προηγούμενης κλήσης να πετιέται. Οι αποτυχίες του μπαίνουν στο
ίδιο κίτρινο banner μέσω `contextLoadErrors` (ξεχωριστό state, για να μη σβήνει το ένα effect τα
λάθη του άλλου).

Το ψαλίδισμα γίνεται client-side:

```ts
viewRange = { from: callBounds.start − viewWindowSec·1000, to: callBounds.end + viewWindowSec·1000 }
inView(t) → !viewRange || from ≤ t ≤ to
```

και εφαρμόζεται σε **δύο** σημεία: στα LTE/GSM/NR context δείγματα του `unifiedSamples`, και στις
context γραμμές του `mergedTechnology` (πίνακας «Συμπεριφορά δικτύου»). Όλα τα υπόλοιπα — domain
του chart, Session Overview (και οι `techPeriods` του, που ψαλιδίζονται στο domain), ταμπέλες
events — παράγονται από το `unifiedSamples` και ακολουθούν αυτόματα. Χωρίς `callBounds` δεν
ξέρουμε πού να κόψουμε, οπότε εμφανίζεται ό,τι ήρθε.

Στη βάση, το παράθυρο εκτελείται ως `DATEADD(SECOND, ±window_sec, …)` στο
[backend/routers/call_context.py](../backend/routers/call_context.py), με `-N` από την αρχή και
`+N` από το τέλος της κλήσης — συνολικό εύρος `διάρκεια + 2N`. Ο server δέχεται έως 300s.

**Reset ανά κλήση κατά το render:** το `CallDetail` δεν ξαναγίνεται mount στο Prev/Next, οπότε
το `viewWindowSec` επιστρέφει στο default μέσω `viewWindowCallId` **μέσα στο render**, ώστε η νέα
κλήση να μην εμφανιστεί ούτε ένα frame με το παράθυρο της προηγούμενης.

Το NR context ζητείται και σε **μη-VoNR** κλήσεις: μια VoLTE κλήση με EN-DC (5G NSA πάνω σε LTE
anchor) έχει κι αυτή γραμμές στο `FactNR5GRadio`, και το NR σκέλος της αξίζει να φαίνεται.

### Τα endpoints

Όλα όσα ακουμπάει η σελίδα, από τα τρία effects μαζί (τα scanner/antenna queries τρέχουν σε
δικά τους effects, όχι μέσα στο μεγάλο `allSettled`):

| Ομάδα | Endpoints |
| --- | --- |
| Radio (A/B) | `lte_values`, `lte_values_b_side`, `gsm_values`, `gsm_values_b_side`, `nr5g_values` |
| Context (A/B) | `call_context_signal(_b_side)`, `gsm_context_signal(_b_side)`, `nr5g_context_signal(_b_side)`, `call_context_technology`, `technology_periods` |
| Cell / κεραίες | `cell_info`, `cell_info_b_side`, `antennas` |
| Scanner | `lte_scanner_raw`, `lte_scanner_best`, `lte_scanner_measurement`, `gsm_scanner_raw`, `gsm_scanner_best`, `lte_measurement_comparison` |
| Signalling | `l3_messages` (A & B), `tracelog_values` |
| KPI / εκβάσεις | `results_kpi`, `call_kpi_tile`, `call_side_comparison`, `handover_info`, `mos_values` |
| Μεταβάσεις | `call_srvcc_detail`, `call_csfb_detail`, `technology_timeline`, `voice_codec` |
| Λοιπά | `call_device_info`, `markers`, `call_neighbors` |
| Call Analysis (panels, `routers/call_analysis.py`) | `call_analysis` (έξοδος του native classifier A+B), `call_sessions_native` (sessions/call info/tests όπως το Scene), `speech_samples`, `speech_time_domain` |

---

## 4. Ο κοινός cursor — η βασική ιδέα της σελίδας

Όλη η σελίδα μοιράζεται **ένα** timestamp:

```ts
const [hoveredTime, setHoveredTimeValue] = useState<number | null>(null);
const [hoveredSide, setHoveredSide] = useState<"A" | "B" | null>(null);
```

Όπου κι αν περάσεις το ποντίκι — γραμμή του L3 πίνακα, TraceLog, KPI, λωρίδα του Session
Overview, σημείο του χάρτη — αναφέρεται το απόλυτο timestamp εκείνης της στιγμής. Το διάγραμμα
τραβάει εκεί κάθετη γραμμή, και **ανάποδα**: κινώντας το ποντίκι στην καμπύλη, φωτίζεται η
αντίστοιχη γραμμή σε κάθε πίνακα.

```
HOVER_TOLERANCE_MS = 1500
```

Πόσο κοντά πρέπει να είναι μια γραμμή στον cursor για να θεωρηθεί «αυτή που κοιτάς». Τα
measurement reports απέχουν ~0.5s, οπότε το 1.5s καλύπτει και τους αραιούς πίνακες (KPI,
TraceLog) χωρίς να φωτίζει άσχετες γραμμές.

Το `hoveredSide` λύνει ένα λεπτό πρόβλημα του split L3 view: ο πίνακας του B-side δίνει ώρα ενώ
η καμπύλη μπορεί να είναι A-side. Εκεί **η ώρα ταιριάζει, η μέτρηση όχι** — και το chart το
δείχνει διαφορετικά (`hoverFromOtherSide`).

### Καρφιτσωμένο διάγραμμα

Με `chartPinned` (default **on**) το διάγραμμα μένει sticky στην κορυφή όσο κυλάς τους πίνακες.
Δύο CSS variables συντονίζουν τα ύψη:

| Variable | Ποιος το γράφει | Ποιος το διαβάζει |
| --- | --- | --- |
| `--app-header-height` | `Index.tsx` (ResizeObserver στο header) | το `top` του pinned chart |
| `--pinned-chart-height` | `CallDetail` (ResizeObserver στο chart wrapper) | τα L3 panels, για να κόψουν το δικό τους max-height |

Ξεκαρφίτσωτο → το `--pinned-chart-height` μηδενίζεται, ώστε οι πίνακες να πάρουν πίσω το ύψος.

---

## 5. Το ενιαίο διάγραμμα σήματος

Πριν υπήρχαν **δύο** διαγράμματα (ένα «LTE RSRP/RSRQ» της κάρτας και ένα «Συμπεριφορά δικτύου
±Ns» παρακάτω). Ενώθηκαν σε ένα, πάνω σε κοινό **απόλυτο** άξονα χρόνου. Από πάνω προς τα κάτω:

```
┌──────────────────────────────────────────────────────────┐
│ ταμπέλες L3 / SIP / NAS / handover events  (lanes)       │
├──────────────────────────────────────────────────────────┤
│ Session Overview: IDLE/CALL · τεχνολογία/band            │
├──────────────────────────────────────────────────────────┤
│  καμπύλη ισχύος + ποιότητας                              │
│  ζώνες: πριν │ ΚΑΤΑ ΤΗΝ ΚΛΗΣΗ (σκιασμένο) │ μετά         │
└──────────────────────────────────────────────────────────┘
```

### Πώς φτιάχνεται η καμπύλη (`unifiedSamples`)

Έξι πηγές ενώνονται σε μία χρονοσειρά (`mergeSignalSamples`):

| Πηγή | Πεδία |
| --- | --- |
| LTE context (A ή B) | `RSRP`, `RSRQ` |
| GSM context (A ή B) | `RxLev`, `RxQual` |
| NR context (A ή B) | `NrRSRP`, `NrRSRQ` |
| `callRows` (τα δείγματα της ίδιας της κλήσης) | ανάλογα με `isGSMMode` / NR tag |
| `gsmLeg` / `lteLeg` (**το άλλο** σκέλος) | ώστε να φαίνεται το σκαλοπάτι της μετάβασης |

Το τελευταίο είναι το κρίσιμο: σε SRVCC/CSFB το άλλο σκέλος δεν είναι το «ενεργό», αλλά πρέπει
να σχεδιαστεί — **και προς τις δύο κατευθύνσεις**. Σε CSFB το GSM σκέλος κρατάει λίγα
δευτερόλεπτα μιας κλήσης που τρέχει σε LTE· χωρίς το LTE σκέλος η καμπύλη ήταν σχεδόν άδεια.

Το **scanner** έρχεται από άλλο query και σπάνια πέφτει στο ίδιο ακριβώς ms, οπότε
προσαρτάται με `attachNearest()` στο πλησιέστερο δείγμα αντί για exact-match merge.

**Ο άξονας είναι όλο το παράθυρο, όχι τα δεδομένα.** Το `unifiedDomain` = `[αρχή − N, τέλος + N]`
(`viewRange`, ενωμένο με τα δείγματα). Όπου δεν υπάρχουν μετρήσεις κινητού για πάνω από 5s
(`findMeasurementGaps`, και στις άκρες) μπαίνει ζώνη **«No measurements»** πάνω από τις καμπύλες —
ώστε τα `connectNulls` να μη γεφυρώνουν το κενό — αντί να «μαζεύει» ο άξονας στα δεδομένα.
Αν μια περίοδος `NetworkStatus = No service` (FactRadioTechnology, ίδια πηγή με τη λωρίδα «NO SERVICE»
του overview) καλύπτει ≥ μισό κενό, η ζώνη γράφει **«No service»** (κόκκινο περίγραμμα) — εύρημα
δικτύου, όχι απλή απουσία καταγραφής (`labelMeasurementGaps`). Επιπλέον κάθε περίοδος No service
σκιάζεται ελαφρά κόκκινη **πίσω** από την καμπύλη — φαίνεται και όταν το κινητό συνεχίζει να μετράει
μια κυψέλη χωρίς να εξυπηρετείται (limited service, π.χ. DOD Ρόδος 21/09 09:26:11–22).
Τα **best scanner** μπαίνουν με **δικά τους δείγματα** (όχι κολλημένα σε δείγματα κινητού) και
σχεδιάζονται **πάνω** από τις ζώνες κενών: το scanner μετράει και όταν το κινητό όχι. Τα κοινά
scanner μένουν κάτω — χωρίς κυψέλη κινητού δεν έχουν νόημα στο κενό. Το όριο 5s (`NO_MEASUREMENTS_GAP_MS`)
ελέγχθηκε σε CRETE_26H2 / DOD_26H2: τα reports έρχονται ανά ~0.5–0.6s και σε idle (p99 < 1.1s για
LTE/GSM), τα κενά είναι διπολικά (ελάχιστα 5–10s, τα περισσότερα > 10s), και σχεδόν όλες οι
No-service περίοδοι > 5s δεν έχουν κανένα report (36/37 DOD, 4/4 CRETE).

**Σειρές scanner: μία ανά τεχνολογία, ανεξάρτητα από το σκέλος.** Το διάγραμμα έχει 6 σειρές —
`LTE scanner` / `Best LTE scanner` (`ScannerStrength` / `BestScannerStrength`), `GSM scanner` /
`Best GSM scanner` (`GsmScannerStrength` / `GsmBestScannerStrength`), `5G scanner` / `Best 5G scanner`
— η καθεμία με δικό της checkbox (κλειστά από προεπιλογή, `SCANNER_SERIES` στο `CallSignalChart`).
Δεν αλλάζουν νόημα με το LTE/GSM toggle: σε SRVCC/CSFB βλέπεις LTE scanner στο LTE κομμάτι και GSM
scanner στο GSM κομμάτι **ταυτόχρονα**. Το κοινό scanner κάθε τεχνολογίας κολλάει μόνο σε δείγματα
της ίδιας τεχνολογίας (`attachNearest(…, onlyWhere)`: GSM → RxLev, LTE → RSRP, 5G → SS-RSRP), ώστε το
padding να μην απλωθεί π.χ. GSM scanner πάνω στο LTE κομμάτι πριν το handover· τα best κολλάνε παντού.

**Scanner και στο context (πριν/μετά).** Το scanner ζητείται με επέκταση ±`CONTEXT_FETCH_WINDOW_SEC`:
τα best (`*_scanner_best?window_sec=`) σε όλο το παράθυρο, τα κοινά (`*_scanner_raw`) με
`pad_before_sec` στο **πρώτο** τμήμα serving cell και `pad_after_sec` στο **τελευταίο**. Μετά
κόβονται στο ορατό ±Ns όπως όλα τα άλλα. Τα best κολλάνε με τη δική τους ώρα (`attachNearest`,
ανοχή 2.5s). Για τα κοινά στο context:

| | Πώς ταιριάζει έξω από την κλήση | Βεβαιότητα |
| --- | --- | --- |
| LTE | ίδιο `EARFCN`+`PCI` με το context δείγμα (≤5s) | επαληθεύεται — άλλη κυψέλη → κενό |
| GSM | πρώτο CGI της κλήσης (πριν) / τελευταίο (μετά) | **υπόθεση** idle camping: το GSM context δεν έχει κυψέλη |
| 5G | πρώτη/τελευταία κυψέλη της κλήσης, μόνο A-side | **υπόθεση**, ίδιος λόγος (το NR context έχει μόνο NRARFCN) |

Οι NR γραμμές του κινητού (`nr5gUeRows`) ζητιούνται σε **κάθε** κλήση με `wantsLteLeg` — VoNR, VoLTE
με EN-DC, «-» σε LTE/5G, CS με LTE — για τη serving κυψέλη· στον πίνακα/καμπύλη μπαίνουν ως radio
rows **μόνο** σε VoNR / `UNKNOWN`.

**Serving 5G κυψέλη = CID, αλλιώς NR-ARFCN + PCI** (`nrServingCell`). Στα δεδομένα το mapping
`DwFactNR5GRadioToDmnCellInformationMapping` είναι συχνά **άδειο** (CId/NCI = NULL — επιβεβαιώθηκε
στο CRETE_26H2), ενώ το `NRARFCN` του κινητού ταιριάζει με το `AbsFreqSSB` του scanner. Το PCI
μόνο του **δεν** αρκεί: το ίδιο PCI υπάρχει και σε άλλη συχνότητα. Το `/api/nr5g_scanner_raw`
δέχεται `cid` **ή** `arfcn` + `pci`.

Στην καμπύλη το κοινό 5G scanner κολλάει με τη δική του ώρα (τα rows είναι ήδη της serving κυψέλης
ανά τμήμα), οπότε δεν χρειάζεται NR γραμμή κινητού στο `radioValues`. Το **best 5G** ζητιέται μόνο
όταν η κλήση άγγιξε όντως 5G (`callTouchesNr`: NR γραμμές κινητού ή NR context) — αλλιώς μια
καθαρή LTE κλήση έδειχνε best 5G απλώς επειδή ο operator έχει 5G στην περιοχή.

> ⚠ **Δεν έχει δοκιμαστεί ακόμα σε VoNR κλήση στη σελίδα.** Επαληθεύτηκε μόνο σε επίπεδο
> δεδομένων (CRETE_26H2, SELECT): το mapping είναι άδειο σε όλες τις βάσεις (CRETE, HOTSPOTS,
> MTWS, DOD, EAE), το `NRARFCN` του κινητού υπάρχει ως `AbsFreqSSB` στο scanner, και στα 8 sessions
> με τις περισσότερες NR γραμμές το ταίριασμα NR-ARFCN + PCI βρήκε scanner ≤10s στο 80–100% των
> γραμμών, με μέση διαφορά κινητού–scanner 4–5.6 dB (LTE στα ίδια sessions: 3.4–3.8 dB) και χωρίς
> δεύτερη κυψέλη μέσα σε 10s. Μένει να ελεγχθεί σε VoNR κλήση: οι NR γραμμές στον πίνακα Radio
> Measurements με στήλες RSRP/RSRQ Scanner + Δt(s), και οι σειρές «5G scanner» / «Best 5G scanner»
> στο διάγραμμα, μέσα στην κλήση και στο ±N context.

`chartNetwork` = `GSM` αν `isGSMMode`, `NR` αν VoNR, αλλιώς `LTE` — ορίζει άξονες και κατώφλια.

### Οι ταμπέλες (`signalEvents`)

Από τα L3 μηνύματα της **επιλεγμένης πλευράς**, φιλτραρισμένα στο domain του διαγράμματος.
Χρώμα ανά layer:

| | |
| --- | --- |
| handover / SRVCC | `#ef4444` κόκκινο |
| SIP | `#a855f7` μωβ |
| NAS | `#f59e0b` πορτοκαλί |
| RRC / RR | `#06b6d4` κυανό |
| άλλο | `#22c55e` πράσινο |

Οι ταμπέλες **αραιώνονται** όταν στριμώχνονται (`layoutEventLanes`), αλλά τα KPI-backed
handovers (SRVCC/CSFB) είναι `priority: true` — δεν επιτρέπεται να χαθούν, είναι ακριβώς το
σημείο που κοιτάει ο αναλυτής.

Σε Dropped/Failed μπαίνει και το **`CA disconnect`** (`CallAnalysis.callDisconnectTimeStamp`,
priority): εκεί τελειώνει το παράθυρο radio του classifier (τελευταία 8 LTE reports / 20 s). Όταν
πέφτει μετά το τέλος του session (σφάλμα SIP join `SessionId + 1` του `sqCallAnalysis`, βλ.
`REA/…Gaps-Closed §9`) η ταμπέλα είναι πορτοκαλί και μπαίνει και το `CA disconnect (fixed)`.

---

## 6. Τα panels, με τη σειρά που εμφανίζονται

| # | Panel | Πότε φαίνεται | Τι δείχνει |
| --- | --- | --- | --- |
| 1 | **Top bar** | πάντα | Πίσω · inline metrics (Download/**AVG MOS**/Setup Time) · status badge. Το AVG MOS έχει tooltip με τα επιμέρους δείγματα. |
| 2 | **loadErrors banner** | αν απέτυχε ≥1 endpoint | ποια panels δεν φόρτωσαν |
| 3 | **SRVCC Transition** | `callMode === "SRVCC"` | Collapsed by default (localStorage `call-detail-srvcc-open`). Η μία γραμμή λέει `HandoverType Status · interruption ms`. Ανοιχτό: καμπύλη LTE→GSM με δικά της toggles (ισχύς/ποιότητα/SINR/κατώφλια/δείγματα, παράθυρο `all` ή ±Ns) + στατιστικά ανά σκέλος. |
| 4 | **CSFB Transition** | αν υπάρχουν CSFB events | Ίδια δομή· κάρτες ανά πλευρά, πλακίδια ανά φάση (redirect → radio fallback → technology change → service → return). **Οι διάρκειες έρχονται από τα `Voice(LTE CSFB)` KPIs**, δεν υπολογίζονται εδώ. |
| 5 | **Call Info header** | πάντα | meta + timing, signalling strip (SRVCC handovers │ voice codec │ serving cell │ A/B outcome), Prev/Next navigation, και το **σχόλιο**. |
| 6 | **Χάρτης** | μόνο Cosmote Free | Collapsed by default (`call-detail-map-open`) — τρώει 250px. Διαδρομή GPS χρωματισμένη κατά RSRP/RxLev, + matched κεραία με διακεκομμένη γραμμή. Υπάρχει και σε fullscreen popup. |
| 7 | **Ενιαίο διάγραμμα σήματος** | πάντα | §5. Controls: παράθυρο ±Ns και **επιλογή πλευράς A/B για όλη τη σελίδα**. |
| 8 | **TraceLog / KPI / Radio Measurements** | πάντα (3 στήλες) | βλ. παρακάτω |
| 9 | **Συμπεριφορά δικτύου ±Ns** | αν υπάρχουν αλλαγές | ενιαίος πίνακας αλλαγών τεχνολογίας: events της κλήσης **μαζί** με όσα έγιναν στο παράθυρο πριν/μετά, **και των δύο πλευρών**, με στήλη **Πλευρά** (A/B συσκευής από `CallAnalysis.Side`· αχνό = η απέναντι πλευρά της κλήσης που άνοιξες). Το `call_context_technology` φέρνει τα αρχεία (`FileId`) και των δύο πλευρών με `Side` + `IsCallSide`· η λωρίδα τεχνολογίας του Session Overview (fallback) κρατάει μόνο την πλευρά που δείχνει η σελίδα. |
| 10 | **L3 Signaling** | πάντα | RRC / NAS / SIP με φίλτρα, timeline strip, severity badges, expandable raw message, split A/B |
| 11 | **Call Analysis** | πάντα (κλειστό, αλλά φορτώνει) | έξοδος του native classifier ανά πλευρά: code + αιτία όπως στο Scene (`DmnCallInformation.DescriptionA/B`, `DescriptionGroup`), ή γιατί έμεινε αταξινόμητη (`I` = B-side Landunit, `S` = System Release)· παράθυρο radio native vs διορθωμένο· πίνακας A/B με χρονικά όρια, radio GSM/WCDMA/LTE/NR, SIP, release, handover, μετρητές (οι μετρητές με 0 και στις δύο πλευρές κρύβονται) |
| 11b | **Session & tests (Scene)** | lazy, όταν ανοίξει | `/api/call_sessions_native`: τα ίδια queries με το Scene (`GetSessionOverviewDataForAnalysisTab`, `FetchCallIds`, `GetSessionAdditionalDimensionData`, `GetTestsBySessions` — `REA/SmartAnalytics-Call-Analysis-Native-Queries-25.3.66.sql`). Session Id όπως το Scene (`10-50`), valid του warehouse και badge «valid/invalid» με το predicate του Scene, home **και** serving operator (roaming με πορτοκαλί — ο classic «Call Analysis» report δείχνει τον serving), τεχνολογίες, analysis comment, και η λίστα tests των sessions |
| 12 | **MOS ανά test & Speech samples** | lazy, όταν ανοίξει | ένας πίνακας, join με το `TestId` (`/api/mos_test_detail` x `/api/speech_samples` — στη DOD_26H2 1:1, ίδιο MOS και ώρα): ένα block ανά POLQA test με ένα row ανά codec (`FactSpeechCodecs`, με έντονα ο codec της κατεύθυνσης του MOS), και μία φορά ανά test MOS, Status, πλευρά, IPAudioRTT, missed voice, front clipping, delay spread, μέσες τιμές LTE μέσα στο test και LQ sub-scores. Tests μόνο στη μία πηγή μένουν. Από πάνω οι κάρτες A/B του `FactSpeech`· κλικ σε test → time-domain γράφημα (`FactSpeechTimeDomain`) |
| 13 | **Scanner & Κινητό** | αν ήρθε `deviceInfo` | ανά πλευρά: device model, IMEI, firmware, DeviceType… με fallback στα πεδία του FileList |

### Το Radio Measurements panel

Ο πίνακας που κουμπώνει με την καμπύλη. Δύο διαφορετικά σχήματα:

- **LTE**: EARFCN / RSRP / RSRQ / MsgTime — και όταν υπάρχει scanner για το ενεργό EARFCN,
  προστίθενται `RSRP Scanner`, `RSRQ Scanner` και **`Δt(s)`** (χρονική απόσταση UE → scanner sample)
- **GSM**: BCCH / Band / RxLevSub / RxQualSub — με `RxLev Scanner`, `BSIC` και **`Δt(s)`** όταν υπάρχει
  αντιστοίχιση (το scanner της ΙΔΙΑΣ CGI με το κινητό, όχι το best· το BCCH έρχεται από το scanner)

Έχει δύο toggles: `LTE ↔ GSM` (μόνο αν `canToggleLeg`) και `A-side ↔ B-side` (ορατό όσο η κλήση
έχει B-side δεδομένα σε **οποιοδήποτε** σκέλος). Αν η B δεν έχει μετρήσεις στο τρέχον σκέλος, το
κουμπί B μένει **απενεργοποιημένο με tooltip** αντί να εξαφανίζεται (π.χ. SRVCC όπου μόνο η A πέρασε
σε GSM). Η αλλαγή σκέλους κρατάει την πλευρά και γυρίζει σε `A` **μόνο** όταν η B δεν έχει το νέο σκέλος.

Η αντιστοίχιση με το scanner γίνεται με `matchNearestByTime()` — binary search μία φορά, O(1)
ανά γραμμή στο render, γιατί τα scanner rows έχουν δικό τους `FullDate` και δεν πέφτουν στα ίδια ms.

### Κατώφλια χρωματισμού

```
RSRP (χάρτης):   ≥ -115 πράσινο · ≥ -120 πορτοκαλί · αλλιώς κόκκινο
RxLev (χάρτης):  ≥ -88  πράσινο · ≥ -92  πορτοκαλί · αλλιώς κόκκινο
RxLevSub (πίνακας):  |v| ≥ 95 κόκκινο · ≥ 90 warning · αλλιώς ok
RxQualSub (πίνακας): |v| ≥ 6  κόκκινο · ≥ 5  warning · αλλιώς ok
```

> Τα `|v|` δεν είναι τυπογραφικό: RxLev/RxQual αποθηκεύονται ως αρνητικά ή θετικά μεγέθη
> ανάλογα με την πηγή, οπότε η σύγκριση γίνεται σε απόλυτη τιμή.

---

## 7. Το ταίριασμα κεραίας (Cosmote Free only)

Το PCI μόνο του **δεν** ταυτοποιεί κυψέλη — ξαναχρησιμοποιείται από πολλά sites. Το
`rankAntennaMatches()` βαθμολογεί τους υποψηφίους:

```
+4  siteId  ταιριάζει  (eNBId mod 100000)
+2  PCI     ταιριάζει
+1  συχνότητα ταιριάζει (από EARFCN, βλ. lteEarfcnFrequency)
```

Κρατάμε **όλους** όσους πιάνουν το μέγιστο score, και από αυτούς επιλέγεται ο πλησιέστερος στη
μέση θέση GPS της κλήσης. Το `lteEarfcnFrequency()` είναι ένας χάρτης εύρους EARFCN → MHz
(2100/1800/2600/900/800/700) — **αν προστεθεί νέα μπάντα στο δίκτυο, προσθέτεται εκεί**.

---

## 8. Πλοήγηση & σχόλια

- **Prev / Next call**: από `/api/call_neighbors`. Δίνουν SessionId· αν η κλήση-στόχος δεν
  υπάρχει στην τρέχουσα φιλτραρισμένη λίστα, το `Index.tsx` βγάζει toast αντί να ανοίξει κενό.
- **Σχόλιο**: dropdown με συνηθισμένα tags (η επιλογή **αντικαθιστά**, δεν προσθέτει) + free
  text. Αποθήκευση με `updateCallComment`, και το `call.comment` ενημερώνεται inline ώστε ο
  header να δείξει αμέσως το νέο κείμενο χωρίς refetch.
  > Σχόλιο που αρχίζει από `fake` + `isValid = 0` μετριέται ως **Fake Event** στο
  > [Summary tab](SUMMARY_TAB.md#6-voice-kpis-table-20--21).

---

## 9. Παγίδες

- **Μην μετακινήσεις flag από το `callMode` σε «ό,τι βρήκαμε στα δεδομένα».** Το
  `isDualTechCall` οδηγεί το αρχικό fetch, άρα πρέπει να είναι γνωστό **πριν** φτάσει
  οτιδήποτε. Ό,τι ανακαλύπτεται μετά ζει σε ξεχωριστή μεταβλητή (`showsGsmLeg`).
- **Κενό ≠ χωρίς δεδομένα.** Πριν προσθέσεις νέο fetch, βάλ’ το στο `namedResults`, αλλιώς μια
  αποτυχία του θα φαίνεται σαν «η κλήση δεν είχε τέτοιες μετρήσεις».
- **Ο άξονας είναι απόλυτος χρόνος (epoch ms), όχι index.** Κάθε νέα σειρά πρέπει να περάσει
  από `toTimestamp()` και `mergeSignalSamples()`, αλλιώς πέφτει εκτός ευθυγράμμισης με το
  Session Overview και τις ταμπέλες.
- **Το `SessionOverview` τοποθετεί index-based** πάνω στο `times[]` του chart, ώστε οι μπάρες να
  πέφτουν ακριβώς πάνω από το αντίστοιχο σημείο της καμπύλης ακόμα κι όταν τα δείγματα δεν
  είναι ισαπέχοντα. Αν αλλάξεις το domain του ενός, άλλαξε και του άλλου.
- **Το `viewWindowSec` είναι φίλτρο εμφάνισης· το `CONTEXT_FETCH_WINDOW_SEC` είναι fetch parameter.**
  Μην τα ξαναενώσεις: αν το ορατό παράθυρο μπει στα deps του effect 2, κάθε κλικ ξαναχτυπάει 9
  endpoints και επιστρέφει το πρόβλημα των απαντήσεων εκτός σειράς. Γι' αυτό το `viewWindowSec`
  μπορεί με ασφάλεια να γίνει slider ή zoom — δεν κοστίζει τίποτα στη βάση.
  - Το `viewWindowSec` **δεν μπορεί να ξεπεράσει** το `CONTEXT_FETCH_WINDOW_SEC`: πέρα από αυτό
    δεν υπάρχουν δεδομένα να δείξεις. Αν προσθέσεις επιλογή > 120s, μεγάλωσε πρώτα τη σταθερά
    (ή φέρε επιπλέον μόνο όταν το παράθυρο μεγαλώνει — με debounce **και** cancellation).
  - Νέα πηγή context; Πέρνα την από το `inView()`, αλλιώς θα δείχνει πάντα όλα τα 120s.
  - Αλλάζει το **domain του άξονα** (`unifiedSamples` → `times[]` → Session Overview, ταμπέλες,
    πίνακας «Συμπεριφορά δικτύου»), όχι απλώς την πυκνότητα δειγμάτων.
  - Μη μεταφέρεις το reset ανά κλήση σε `useEffect` (βλ. §3, Effect 2).
- **Κάθε async effect χρειάζεται `cancelled` guard** — και το μεγάλο `loadRadio`. Χωρίς αυτό, σε
  γρήγορο Prev/Next οι απαντήσεις της προηγούμενης κλήσης γράφουν πάνω στη νέα. Και σε αποτυχία
  fetch γράψε `[]`/`null`, όχι «μην αγγίξεις»: αλλιώς μένουν τα δεδομένα της προηγούμενης κλήσης.
- **Αντιστοίχιση scanner ↔ κινητό μέσα στην κλήση: πλησιέστερο δείγμα έως `SCANNER_MATCH_MAX_DT_MS`
  (10s)**, ανά CGI (LTE/GSM) ή CID (5G), με `groupTimedRows` + `nearestWithin`. Χωρίς όριο, με το
  padding ±120s του πρώτου/τελευταίου τμήματος, οι τελευταίες γραμμές ταίριαζαν με scanner έως 2
  λεπτά **μετά** την κλήση.
- **Το `CallAnalysis.setupTime` είναι σε δευτερόλεπτα** (float του MF), όχι ms. Το **99.9** είναι
  σημαία αποτυχίας του MF (Failed / System Release), όχι χρόνος: τα `/api/calls` και
  `/api/call_kpi_tile` το γυρνούν `null`.
- Τα `mapOpen` / `srvccOpen` / `csfbOpen` ζουν σε localStorage: μια αλλαγή στο default δεν
  θα φανεί σε όποιον έχει ήδη πατήσει το κουμπί.
