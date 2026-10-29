# All Sessions tab — πώς λειτουργεί

Το **All Sessions** tab (`value="calls"` στο [Index.tsx](../src/pages/Index.tsx)) είναι η λίστα
όλων όσων τρέξανε σε ένα drive/walk: **voice calls** (πάνω) και **data sessions** (κάτω), με
κοινά φίλτρα. Από εκεί ανοίγεις τα δύο detail views.

Είναι **ένα tab με τρία sub-tabs**, που μοιράζονται το ίδιο fetch και την ίδια επιλογή:

```
All Sessions  ·  Call Detail  ·  Data Detail
   (list)         (detail)       (data-detail)
```

| Sub-tab | Ενεργό όταν | Doc |
| --- | --- | --- |
| `list` | πάντα | αυτό το αρχείο |
| `detail` | υπάρχει `selectedCall` | [CALL_DETAIL.md](CALL_DETAIL.md) |
| `data-detail` | υπάρχει `selectedDataSessionId` | [DATA_SESSION_DETAIL.md](DATA_SESSION_DETAIL.md) |

Τα δύο detail buttons είναι **disabled** όσο δεν έχει επιλεγεί κάτι — δεν υπάρχει τρόπος να
βρεθείς σε άδειο detail από το UI (μπορείς όμως από URL, βλ. §2).

---

## 1. Αρχεία

| Αρχείο | Ρόλος |
| --- | --- |
| [src/pages/Index.tsx](../src/pages/Index.tsx) | Όλο το tab: φίλτρα, fetch, Location Summary, ο πίνακας “All Calls”, και το wiring των detail views. Το μεγαλύτερο μέρος της λογικής ζει **εδώ**, όχι σε component. |
| [src/components/DataSessionsList.tsx](../src/components/DataSessionsList.tsx) | Η λίστα “Data Session” — grouping, cycles, KPIs ανά session, expandable breakdown. |
| [src/lib/callData.ts](../src/lib/callData.ts) | `CallRecord` — το σχήμα που περιμένει το `CallDetail`. |
| [src/lib/api.ts](../src/lib/api.ts) | `fetchAllCalls`, `fetchDataCalls`, `fetchLocations`, `fetchCollectionNames`. |

---

## 2. State & URL

Η επιλογή ταξιδεύει στο **URL**, ώστε ένα share link να ανοίγει ακριβώς την ίδια οθόνη:

```
?tab=calls&sub=detail&call=<SessionId>
```

| State | Hook | Σημείωση |
| --- | --- | --- |
| `activeTab` | `useUrlStringState("tab", …)` | + localStorage `perf-insights-active-tab` |
| `callsSubTab` | `useUrlStringState("sub", "list", { allowed })` | `list` / `detail` / `data-detail` |
| `selectedCallId` | `useUrlNullableStringState("call")` | **μόνο το id** ταξιδεύει |
| `selectedDataSessionId` | `useState` | δεν μπαίνει στο URL |

Κρίσιμο σημείο: το `selectedCall` είναι **derived**, όχι αποθηκευμένο:

```ts
const selectedCall = useMemo(
  () => (selectedCallId ? callRecords.find((c) => String(c.callId) === selectedCallId) ?? null : null),
  [callRecords, selectedCallId],
);
```

Γι’ αυτό δεν χρειάζεται συγχρονισμός μετά από κάθε fetch: όσο η κλήση υπάρχει στα νέα
αποτελέσματα, το Call Detail μένει ανοιχτό· αν την έκοψαν τα φίλτρα, γίνεται από μόνο του
`null` και το sub-tab δείχνει το empty state.

Τα `openCallDetail()` / `openDataSessionDetail()` κάνουν και τα τρία μαζί: θέτουν την επιλογή,
γυρίζουν στο `calls` tab και ανοίγουν το σωστό sub-tab.

---

## 3. Ροή δεδομένων

Δύο endpoints, **ένα** `Promise.allSettled`, σε ένα `useEffect`:

```
selectedDatabase + selectedCallsCollections + selectedLocations
                     │
                     ▼
   Promise.allSettled([ fetchAllCalls(...), fetchDataCalls(...) ])
                     │
      ┌──────────────┴───────────────┐
      ▼                              ▼
 allCallsRows                   dataCallsRows
 (AllCallsRow[])                (DataCallRow[])
      │                              │
 mapAllCallsRows                groupedDataSessions
      ▼                              ▼
 callRecords (CallRecord[])     DataSessionItem[] + cycles
      │                              │
 selectedCall → CallDetail      selectedDataSessionTests → DataSessionDetail
```

- **Το voice fetch είναι blocking για το tab**: αν αποτύχει, καθαρίζει τα πάντα και βγάζει
  toast. Το data fetch αποτυγχάνει **σιωπηλά** (μόνο `console.error`) — η λίστα των data
  sessions απλά μένει άδεια.
- `effectiveLocations`: αν δεν έχει επιλεγεί κανένα location **ή** έχουν επιλεγεί όλα, στέλνεται
  `[]` (= όλα) αντί για τη λίστα. Λιγότερο SQL, ίδιο αποτέλεσμα.
- `mapAllCallsRows` μεταφράζει το `AllCallsRow` του API στο `CallRecord` που περιμένει το
  `CallDetail`. Πεδία που δεν υπάρχουν σε voice δεδομένα (`downloadSpeed`, `jitter`,
  `packetLoss`…) γεμίζουν με `0` — είναι υπόλειμμα του mock-data σχήματος, **μην τα διαβάσεις
  ως πραγματικές μετρήσεις**.

> Το Summary tab **δεν** μοιράζεται τίποτα από αυτά — έχει δικό του database/collections state
> και δικά του queries. Βλ. [SUMMARY_TAB.md §3](SUMMARY_TAB.md).

---

## 4. Τα φίλτρα (αριστερή στήλη)

Η στήλη μαζεύεται σε ένα εικονίδιο με το `listFiltersCollapsed` (animated, framer-motion 280px → 40px).

| Φίλτρο | Τι κάνει | Επηρεάζει |
| --- | --- | --- |
| **Database** | επιλογή βάσης· καθαρίζει collections/locations | ξαναφορτώνει τα πάντα |
| **Collections** | multi-select με Select all / Clear | ξαναφορτώνει τα πάντα |
| **Locations** | multi-select· “All rows” = καθόλου φίλτρο | ξαναφορτώνει (server-side) |
| **Session Valid** | `all` / `1` / `0` πάνω στο `row.isValid` | client-side |
| **Status** | Completed / Drop / Fail / Sys Release, πολλαπλή επιλογή (OR) | client-side |
| **Location** (chips) | ομάδες `Data` (location περιέχει `data`) και `Free + GSM (Voice)` (location περιέχει `free`, `gsm` ή `voice`) — βλ. `locationGroups` | client-side, **και** τη data λίστα |
| **File Group (±5min)** | ένα “run” = voice + data αρχεία που ξεκινούν μέσα σε 5 λεπτά | client-side, και τις δύο λίστες |
| **Search** | free text πάνω στις στήλες του πίνακα | client-side, μόνο voice |

Τα πρώτα τρία είναι **server-side** (μπαίνουν στο query). Όλα τα υπόλοιπα είναι **client-side**
πάνω στα ήδη φορτωμένα rows, και συνδυάζονται με **AND**.

### File groups — τι είναι ένα “run”

Ο πιο μη-προφανής μηχανισμός του tab. Ένα drive παράγει πολλά αρχεία ταυτόχρονα (Cosmote Free +
Vodafone Free + Data…) και θέλεις να τα δεις σαν μία μονάδα.

```ts
const FILE_GROUP_GAP_MS = 5 * 60 * 1000;
```

1. Κάθε voice call γίνεται interval `[start, start + duration]`.
2. Κάθε **data session** γίνεται interval από το **πρώτο ως το τελευταίο test** της — ένα session
   είναι δεκάδες test rows με διαδοχικά timestamps, όχι ένα σημείο.
3. Όλα ταξινομούνται κατά `start` και μπαίνουν σε clusters: ένα interval μπαίνει στο τρέχον
   cluster αν ξεκινά το πολύ 5 λεπτά **μετά το τέλος** του cluster.

Το «μετά το τέλος, όχι μετά την αρχή» είναι σκόπιμο: τα data αρχεία ξεκινούν λίγο αργότερα από
τα voice της ίδιας τοποθεσίας αλλά τελειώνουν περίπου μαζί. Με σύγκριση μόνο στο `start` θα
έσπαγαν σε ξεχωριστά groups.

Κάθε group κρατάει `voiceSessionIds` και `dataSessionIds` σαν `Set`, και το chip δείχνει
`ώρα–ώρα (N free&gsm, M data)`.

> **Παγίδα**: τα `SessionId` των data rows έρχονται ως `number` (BIGINT) από το backend. Παντού
> γίνονται `String(...)` πριν μπουν σε `Set`/`Map` keys — αλλιώς το `Set.has()` αποτυγχάνει
> πάντα σιωπηλά και το φίλτρο αδειάζει τη λίστα.

---

## 5. Η λίστα “All Calls” (voice)

**Header**: τίτλος + πλήθος γραμμών, και δίπλα το **Location Summary** — ένας μικροσκοπικός
πίνακας `Complete / Sys Rel / Drop / Fail / Total` ανά location, με στήλη Total όταν υπάρχουν
≥2 locations. Υπολογίζεται πάνω στα **φιλτραρισμένα** rows, με το ίδιο substring criterion που
χρησιμοποιεί και το Summary (`system release`/`system realase` → `drop` → `fail` → αλλιώς
complete). Σε κινητό γίνεται 4 πλακίδια.

**Σώμα**: δύο εντελώς διαφορετικά renders για το ίδιο dataset —

- `sm:hidden` → κάρτες (Location, status badge, Setup/Duration/Avg MOS, collection, ώρα)
- `hidden sm:block` → πίνακας 13 στηλών (Location, SessionId, Technology, Call Mode, Call Type,
  Call Dir, Status, Comment, Setup Time, Avg MOS, Call Start Time, Call Duration, CollectionName)

Κλικ σε γραμμή/κάρτα → `openCallDetail(record)`. Το `lastClickedRowId` κρατάει ποια γραμμή
πατήθηκε τελευταία, ώστε να ξεχωρίζει οπτικά όταν γυρίσεις πίσω.

---

## 6. Η λίστα “Data Session”

Ο πίνακας των data tests **δεν** δείχνεται γραμμή-γραμμή: τα rows ομαδοποιούνται ανά `SessionId`
σε `DataSessionItem` (βλ. `groupedDataSessions`), και κάθε session γίνεται μία σειρά με τα δικά
της aggregates.

### Cycles — η αρίθμηση, όχι το πλήθος

```ts
const DATA_CYCLE_ID_SPAN = 6;
```

Ένα *cycle* είναι μια πλήρης περιστροφή των tests. Ορίζεται από την **αρίθμηση των SessionId**,
όχι από πόσες γραμμές έπεσαν μέσα:

- ταξινόμηση ανά `location`, μετά αύξον `SessionId`,
- το cycle ανοίγει στο πρώτο SessionId της location (`anchorId`) και κλείνει στο
  `anchorId + 6` (**συμπεριλαμβανομένου**),
- ένα SessionId πέρα από αυτό ανοίγει νέο cycle.

Παράδειγμα: με πρώτο `…738` το cycle πιάνει `…738`–`…744`· το `…746` ανοίγει cycle 2. Έτσι ένα
cycle όπου λείπουν sessions φαίνεται ως **μερικό** (`4/6`) αντί να «κλέψει» sessions από το επόμενο.

Το toggle **Sessions / Group by cycle** στο header αλλάζει μόνο αν μπαίνουν cycle headers μέσα
στη λίστα — δεν αλλάζει την ίδια την προβολή.

### Τι υπολογίζει το `DataSessionsList` ανά session (`buildView`)

| Πεδίο | Πώς |
| --- | --- |
| `dl` / `ul` | μέσος όρος throughput των DL / UL tests (`throughputKbps` ή `capacityThroughputKbps`), σε Mbps |
| `rtt` | μέσος `pingRttAvg` |
| `mos` | μέσος `youtubeMos` |
| `worstDl` / `worstRtt` | το **χειρότερο** νούμερο του session — εκεί κρύβεται συνήθως το πρόβλημα |
| `techPath` | η σειρά των τεχνολογιών όπως εμφανίστηκαν, π.χ. `NR → LTE` |
| `breakdown` | ανά test type: total / ok / fail / other, μέση τιμή και εύρος `min … max` |
| `status` | `invalid` (isValid=0) → `fail` (≥1 αποτυχία) → `ok` |

Παντού ισχύει ο ίδιος κανόνας: **`null` ή `0` = δεν μετρήθηκε** (βλ. `positives()`), οπότε δεν
ρίχνει τους μέσους όρους.

### Controls της λίστας

| Control | Τιμές |
| --- | --- |
| **Grouping** | `auto` (χρονολογικά αν >1 location, αλλιώς ανά location) / `time` / `location` |
| **Sort** | `natural` (σειρά συλλογής) / `newest` / `fails` / `dl` / `rtt` / `session` |
| **Only problems** | κρατάει μόνο sessions με αποτυχίες ή invalid |
| **Search** | πάνω σε `searchBlob` (sessionId, location, collection, filename, comment, test types, hosts, tech) |

Δύο κανόνες συνέπειας που είναι εύκολο να σπάσουν:

- `showCycleBlocks = groupByCycle && sortKey === "natural"` — cycle blocks έχουν νόημα **μόνο**
  στη φυσική σειρά συλλογής.
- `showDayHeaders = byTime && (sortKey === "natural" || "newest")` — headers ημέρας μόνο όταν η
  λίστα είναι όντως χρονολογική.

### Thresholds

```ts
dl:   ≥20 πράσινο · ≥5  κίτρινο · αλλιώς κόκκινο   (Mbps)
ul:   ≥10 πράσινο · ≥2  κίτρινο · αλλιώς κόκκινο   (Mbps)
rtt:  ≤50 πράσινο · ≤150 κίτρινο · αλλιώς κόκκινο  (ms)
mos:  ≥4  πράσινο · ≥3  κίτρινο · αλλιώς κόκκινο
rate: ≥98 πράσινο · ≥90 κίτρινο · αλλιώς κόκκινο   (%)
```

Όλα σε ένα αντικείμενο `kpiClass` στην κορυφή του `DataSessionsList.tsx` — **άλλαξέ τα μόνο εκεί**.

---

## 7. Παγίδες

- **Δύο renders, ένα dataset.** Κάθε αλλαγή στον πίνακα των κλήσεων πρέπει να γίνει **και** στις
  mobile κάρτες, αλλιώς οι δύο προβολές αποκλίνουν σιωπηλά.
- **`String(SessionId)` παντού.** Το backend στέλνει BIGINT· ένα `Set<string>.has(number)` δεν
  σκάει, απλά επιστρέφει πάντα `false`.
- Το `locationTableFilter` φιλτράρει **και** τη λίστα data sessions (μέσω
  `filteredGroupedDataSessions`), ενώ τα `statusFilters` / `sessionValidFilter` **όχι** — αφορούν
  μόνο κλήσεις.
- Οι μονάδες: το `throughputKbps` είναι **kbps** και διαιρείται με 1000 για την εμφάνιση.
  Μην προσθέσεις δεύτερη διαίρεση πιο κάτω στο pipeline.
