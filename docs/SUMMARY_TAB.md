# Summary tab — πώς λειτουργεί

Το **Summary tab** αναπαράγει live, μέσα από την εφαρμογή, το φύλλο **ATTACHMENT C** του
A-LEVEL workbook — δηλαδή τους τρεις πίνακες όπου οι **γραμμές είναι KPIs** και οι
**στήλες operators** (COSMOTE / VODAFONE / NOVA), συν μία στήλη `Total`:

| Attachment C | Κάρτα στο UI |
| --- | --- |
| TABLE 20 — GSM CALL STATS | `GSM Call Stats` |
| TABLE 21 — FREE (2G-3G-LTE) CALL STATS | `Free (2G-3G-LTE-VoNR) Call Stats` |
| TABLE 22 — PS DATA STATS | `PS Data Stats` |

Κανένα Excel δεν εμπλέκεται: τα ίδια νούμερα βγαίνουν κατευθείαν από τα rows που φέρνει το
API και υπολογίζονται στον browser.

---

## 1. Αρχεία

| Αρχείο | Ρόλος |
| --- | --- |
| [src/components/SummaryTab.tsx](../src/components/SummaryTab.tsx) | Όλο το UI: header, KPI tiles, `KpiTable`, κάρτες, toggles, compact/full λογική εμφάνισης. **Δεν κάνει fetch.** |
| [src/lib/attachmentC.ts](../src/lib/attachmentC.ts) | Όλη η αριθμητική: operators, ταξινόμηση κλήσεων, `buildVoiceStats`/`buildVoiceTable`, `buildDataSections`, mappers, technology/codec mix, formatters. Καθαρές συναρτήσεις, χωρίς React. |
| [src/lib/servingPies.ts](../src/lib/servingPies.ts) | Slices + σταθερά χρώματα για τα δύο Serving Band / Serving Technology pies. Ξεχωριστό αρχείο ώστε να testάρεται χωρίς render. |
| [src/pages/Index.tsx](../src/pages/Index.tsx) | Το data layer: 11 ανεξάρτητα react-query queries, debounce, mappers, `summaryLoading`, και το `<SummaryTab … />` render. |
| [src/components/SummaryTab.test.tsx](../src/components/SummaryTab.test.tsx) | Render tests (compact/full, incl. SR, progressive loading, pies). |
| [src/lib/attachmentC.test.ts](../src/lib/attachmentC.test.ts) | Unit tests της αριθμητικής. |

Χρυσός κανόνας: **αν είναι νούμερο → `attachmentC.ts`. Αν είναι pixel → `SummaryTab.tsx`.**

---

## 2. Ροή δεδομένων

```
          Index.tsx (useQueries — 11 πηγές, παράλληλα)
                     │
   ┌─────────────────┴───────────────────────────────────────────┐
   │ /api/calls             → summaryAllCallsRows                │
   │ /api/data_calls     ┐                                       │
   │ /api/ookla          │                                       │
   │ /api/ping_1000      ├─► mappers → summaryDataCallsWithOokla │
   │ /api/interactivity  │                                       │
   │ /api/dns            │                                       │
   │ /api/capacity_link  ┘                                       │
   │ /api/technology_mix    → technologyMixRows                  │
   │ /api/serving_band_tech → servingBandTechRows                │
   │ /api/cell_band_count   → cellBandCountRows   (μόνο GSM)     │
   │ /api/srvcc             → srvccRows           (μόνο FREE)    │
   └─────────────────┬───────────────────────────────────────────┘
                     ▼
              <SummaryTab … loading={summaryLoading} />
                     │  (useMemo ανά toggle / dataset)
                     ▼
   attachmentC:  buildVoiceTable(GSM)  ─┐
                 buildVoiceTable(FREE)  ├─► KpiTable (rows × operators)
                 buildDataSections     ─┘
                 buildTechnologyMixTable / buildServingBandTechTable
```

### Οι πηγές

| # | Query key | Endpoint | Ταΐζει | Τρέχει σε compact; |
| --- | --- | --- | --- | --- |
| 1 | `calls` | `/api/calls` | GSM + FREE tables, KPI tiles, hero CSR | ναι |
| 2 | `dataCalls` | `/api/data_calls` | PS Data sections (CDRCombined) | ναι |
| 3 | `technologyMix` | `/api/technology_mix` | γραμμή “Technology mix” ανά band | **όχι** |
| 4 | `servingBandTech` | `/api/serving_band_tech` | τα δύο pies | ναι |
| 5 | `cellBandCount` | `/api/cell_band_count` | “Number of 900/1800 band Cells” (GSM only) | ναι |
| 6 | `srvcc` | `/api/srvcc` | Total/Successful/Failed SRVCC (FREE only) | ναι |
| 7 | `ookla` | `/api/ookla` | sections “Ookla DL/UL” | ναι |
| 8 | `ping1000` | `/api/ping_1000` (aggregate) | sections “Ping 40 B / 800 B / 1000 B” | ναι |
| 9 | `interactivity` | `/api/interactivity` | section “Interactivity (eGaming)” | **όχι** |
| 10 | `dns` | `/api/dns` | section “DNS Resolution” | **όχι** |
| 11 | `capacityLink` | `/api/capacity_link` | sections “Capacity DL/UL (grx)/(akamai)” | **όχι** |

> Μερικά σχόλια στον κώδικα λένε ακόμα «10 πηγές» — είναι παλιά. Οι πραγματικές είναι **11**,
> και το chip `Loading n/N` δείχνει `summaryQueries.length`, άρα `n/11`.

Γιατί 11 ξεχωριστά queries και όχι ένα `Promise.allSettled`: **κάθε πηγή βάφει το δικό της
κομμάτι μόλις γυρίσει.** Το `/api/srvcc` είναι 3 γραμμές, το `/api/ping_1000` χιλιάδες — δεν
έχει νόημα να περιμένει το ένα το άλλο. Το react-query δίνει επιπλέον cache ανά
`(database, collections)` και race-safety (παλιό response δεν γράφει πάνω σε νεότερο).

### Οι mappers (πώς γίνονται «PS Data sections» πράγματα που δεν είναι `data_calls`)

Όλα τα extra endpoints μετατρέπονται σε `DataCallRow[]` και μπαίνουν στο **ίδιο array** που
τρώει το `buildDataSections`. Έτσι εμφανίζονται σαν επιπλέον sections **χωρίς να αλλάξει
γραμμή το `SummaryTab`**:

```ts
summaryDataCallsWithOokla = [
  ...excludeCdrPingDuplicates(summaryDataCallsRows),  // βγάζει τα παλιά "ICMP Ping 40/800"
  ...mapOoklaRowsToDataCallRows(...),                 // → testType "Ookla", direction DL/UL
  ...mapPing1000RowsToDataCallRows(...),              // → "Ping 40"/"Ping 800"/"Ping 1000" βάσει packetSize
  ...mapInteractivityRowsToDataCallRows(...),
  ...mapDnsRowsToDataCallRows(...),
  ...mapCapacityLinkRowsToDataCallRows(...),          // ΕΠΙΠΛΕΟΝ breakdown, όχι υποκατάστατο
];
```

Το `excludeCdrPingDuplicates` είναι απαραίτητο: μετά το 2026-08-31 το `/api/ping_1000` είναι η
**μόνη** πηγή και για τα 40/800/1000 B, οπότε τα παλιά `ICMP Ping 40/800` του CDRCombined θα
μετρούσαν διπλά.

---

## 3. Επιλογή database / collections

Το Summary έχει **δικό του, ανεξάρτητο** state — δεν μοιράζεται τίποτα με το “All Calls” tab ή
το “Edit Filters” panel, και τρέχει πάντα με `locations = []` (όλα τα locations):

| localStorage key | Τι κρατάει |
| --- | --- |
| `perf-insights-summary-db` | επιλεγμένη database |
| `perf-insights-summary-collections` | επιλεγμένα collections |
| `perf-insights-summary-compact` | Compact (`true`) vs Full (`false`) — default `true` |

**Debounce 600 ms** (`useDebouncedValue`): τα queries κρέμονται από το *debounced* value, όχι
από το raw. Χωρίς αυτό, κάθε κλικ σε checkbox έστελνε 11 βαριά SQL queries — και ο SQL Server
τα τελειώνει ό,τι κι αν κάνει ο browser. Ένα “Select all” σε 20 collections έριχνε ~220 queries
στον server· από εκεί έρχονταν τα timeouts. Τώρα: ένα πέρασμα επιλογών = ένα κύμα 11 queries.

Τα collections που έχουν έστω **μία dropped/failed κλήση χωρίς comment** βάφονται κόκκινα στο
dropdown και στη λίστα του header (`flaggedCollections`).

---

## 4. Progressive loading & σφάλματα

Το prop `loading: SummaryLoading` λέει ποιο κομμάτι περιμένει ακόμα:

```ts
{ voice, data, technologyMix, servingBandTech, done, totalSources, failed }
```

- `voice` → skeletons στα GSM/FREE tables και στο hero (αλλιώς το hero θα έδειχνε ένα σίγουρο
  `0.0%` πριν καν έρθουν οι κλήσεις).
- `data` → pending όσο τρέχει **έστω μία** από τις 6 PS Data πηγές, αλλιώς ο πίνακας θα
  φαινόταν μισός σαν να ήταν πλήρης.
- `done/totalSources` → chip `Loading n/11 sources`.
- `failed` → κόκκινο chip + κουμπί **Retry**, που ξανατρέχει **μόνο** τις αποτυχημένες
  (`onRetryFailedSources`). Πριν από αυτό, μια πηγή σε timeout φαινόταν ακριβώς ίδια με «δεν
  υπάρχουν δεδομένα».

Καμία αποτυχία δεν βγάζει toast: το tab **υποβαθμίζεται σιωπηλά** (το block που λείπει δεν
εμφανίζεται ή δείχνει `—`) αντί να διακόψει τη σελίδα.

Δύο λεπτομέρειες που εύκολα σπάνε αν τις πειράξεις:

- Το `isQueryLoading` ελέγχει `isPending && fetchStatus !== "idle"`. Ένα `enabled: false` query
  μένει `isPending: true` **για πάντα** — χωρίς αυτόν τον έλεγχο, το chip και τα skeletons
  κολλάνε σε μόνιμο loading όταν είσαι σε compact.
- Τα `EMPTY_*` arrays είναι **module-level**. Ένα inline `?? []` φτιάχνει νέο array σε κάθε
  render και ακυρώνει κάθε `useMemo` μέσα στο `SummaryTab`.

---

## 5. Τι βλέπεις στην οθόνη

```
┌ Report header ─────────────────────────────────────────────────────┐
│ A-Level Analysis / Statistics Tables                               │
│ chips: Week · Period · Loading n/11 · Failed n/11 [Retry]          │
│ database dropdown · collections multi-select                       │
│ HERO: Overall call success rate (excl. SR)      ← heroCsrColor()   │
├ legend + controls ─────────────────────────────────────────────────┤
│ operator swatches | Compact/Full · Valid calls · Avoid system      │
│                     release · Hide incl. SR · Highlight best ·     │
│                     Hide empty rows                                │
└────────────────────────────────────────────────────────────────────┘

[Full only] KPI tiles ανά operator — “GSM+FREE call success rate”

┌ GSM Call Stats ─────────┐  ┌ Free (2G-3G-LTE-VoNR) Call Stats ─────────┐
│ KpiTable (gsmRows)      │  │ KpiTable (freeRows)                  │
└─────────────────────────┘  └──────────────────────────────────────┘
      (compact: δίπλα-δίπλα, μισό πλάτος · full: η μία κάτω από την άλλη)

┌ PS Data Stats ──────────────────────────────────────────────────────┐
│ [Full only] Serving Band / Serving Technology pies (2 ανά operator)  │
│ sections: Ε1 … Ε5 (full: με group headers · compact: 2-στηλο grid)   │
└─────────────────────────────────────────────────────────────────────┘
```

### Τα toggles

| Toggle | Τι αλλάζει | Default |
| --- | --- | --- |
| **Compact / Full** | Αλλάζει το **σχήμα όλης της αναφοράς** (βλ. §8). Segmented control, όχι checkbox, ακριβώς γι’ αυτό. Controlled από το `Index.tsx`, γιατί καθορίζει και **ποια queries τρέχουν**. | Compact |
| **Valid calls** | Πετάει έξω τις γραμμές με `isValid = 0`. | on |
| **Avoid system release** | Τα ποσοστά υπολογίζονται με τις system releases **εκτός βάσης** (ούτε επιτυχία ούτε αποτυχία). | on |
| **Hide incl. SR** | Κρύβει μόνο τη δευτερεύουσα γραμμή `incl. SR …` κάτω από κάθε rate/count. Καθαρά εμφάνιση — δεν αγγίζει υπολογισμό. Disabled όταν το “Avoid system release” είναι off. | on |
| **Highlight best** | Σημάδι `best` στην καλύτερη στήλη — **μόνο** στις `emphasis` γραμμές, αλλιώς γεμίζει ο πίνακας σημάδια. Χρειάζεται ≥2 διαφορετικές τιμές. | on |
| **Hide empty rows** | Κρύβει γραμμές που είναι παντού 0 ή παντού `null`. | off |

---

## 6. Voice KPIs (TABLE 20 / 21)

Η ταξινόμηση μιας κλήσης γίνεται στο `classifyCallStatus(row.status)`:

| Outcome | Κριτήριο (substring, case-insensitive) |
| --- | --- |
| `sysRelease` | `"system release"` ή `"system realase"` (sic — υπάρχει έτσι στα δεδομένα) |
| `dropped` | `"drop"` |
| `failed` | `"fail"` |
| `completed` | οτιδήποτε άλλο |

Τύποι (`buildVoiceStats`):

```
attempts    = πλήθος γραμμών
connections = attempts − failed                 // "Total Calls"

CSR = completed  / attempts
DCR = dropped    / connections(completed + dropped)
AFR = failed     / attempts(failed + completed + dropped)
SRR = sysRelease / connections                  // ΠΑΝΤΑ στην πλήρη βάση

// "Avoid system release" → withoutSysRelease:
attemptsExcl    = attempts − sysRelease
connectionsExcl = attemptsExcl − failed
CSR/DCR/AFR ξαναϋπολογίζονται πάνω σε αυτές τις βάσεις
```

Άλλα σημεία που αξίζει να ξέρεις:

- **Low Speech Quality Calls (< 2.2)**: προτιμάται το per-sample `BadCall` του backend (>15%
  κακά/silence δείγματα στο session — ίδιο με το `LQStatisticData.sql`). Fallback στο
  `Avg_mos < 2.2` μόνο αν λείπει το πεδίο.
- **Low Speech Quality Calls (< 1.3)**: `BadQualityCall` του backend (2 από 3 διαδοχικά δείγματα
  < 1.3 ή silence, σε Completed κλήση — `LOW MOS 1_3.sql`).
- **MOS UL / DL**: raw `ResultsLQ08Avg` δείγματα ανά `TestInfo.direction` (A→B = UL, B→A = DL) —
  **δείγματα, όχι κλήσεις**. Γι’ αυτό δείχνουν `n=…` και `min–max`.
- **Setup times**: MOC = A→B, MTC = B→A (μόνο UMTS/GSM — γι’ αυτό κρύβονται στο FREE table),
  VoLTE/CS setup με `callMode` σε VoLTE/SRVCC ή CSFB/CS.
- **Fake Event(s)**: sessions με `isValid = 0` **και** comment που αρχίζει από `fake`. Μετριέται
  πάνω στις **ανεπεξέργαστες** γραμμές, ώστε να φαίνεται ακόμα κι όταν το “Valid calls” τις
  κρύβει από όλα τα υπόλοιπα.
- **Codec Type Usage %**: τα counts έρχονται ήδη bucketed από το backend (`CODEC OUTER APPLY`,
  ίδιο CASE με το `CallCodecTypeUsageGSM.sql`). Το % κάθε bucket είναι το μερίδιό του στο σύνολο
  των **tests**, όχι το ποσοστό των sessions με αυτόν ως dominant.
- **Technology mix**: αν έχει φορτώσει το `/api/technology_mix`, κερδίζει το πραγματικό ανά-band
  mix (GSM 900 / GSM 1800 / κάθε LTE band ξεχωριστά). Αλλιώς fallback στο χοντρικό
  `CA.technology` του ίδιου του row.

### Ποιες γραμμές πάνε πού

| | Λόγος |
| --- | --- |
| GSM table **χωρίς** SRVCC, VoLTE/CS attempts/dropped | υπάρχουν μόνο στο FREE table |
| FREE table **χωρίς** MOC/MTC setup, “Number of 900/1800 band Cells” | είναι πάντα `—` εκεί |

---

## 7. PS Data (TABLE 22)

Κάθε **section** = ένα `(testType, direction)` ζευγάρι, με label φτιαγμένο από το
`sectionLabel()`. Εκεί ζουν όλες οι «ιδιοτροπίες» των raw ονομάτων:

- `Capacity DL` (γυμνό) → `Capacity DL 10GB`, `Capacity UL` → `Capacity UL 1GB` (ασύμμετρο
  payload — το testType απλά δεν το γράφει).
- `HTTP Transfer (DL)` → `HTTP Transfer (DL) 10MB`, `HTTP UL` → `HTTP Transfer (UL) 5MB` (και τα
  walk-DB variants `HTTP TRANSFER DL/UL`).
- `Kepler 2` / `Kepler_2` / `HTTP Browser (Kepler_2)` → `Kepler +30s Pause`.
- HTTPS Browser και YouTube Service **δεν** παίρνουν `DL` suffix — τρέχουν μόνο downlink.
- `Payload Ping BIDIRECTIONAL` αποκλείεται εντελώς (`isExcludedSection`).

Τα sections μπαίνουν σε **5 groups** (πρόταση πελάτη 2026-08-26, «QoS → QoE»):

| Group | Περιεχόμενο |
| --- | --- |
| **Ε1 · Bulk throughput** | Capacity DL/UL, HTTP Transfer DL/UL, Ookla DL/UL |
| **Ε2 · Latency / Responsiveness** | Ping 40/800/1000 B, DNS Resolution, Interactivity (eGaming) |
| **Ε3 · Browser engines** | Kepler, Kepler +30s Pause, Newton |
| **Ε4 · HTTPS sites** | 9 site tests (alpha, amazon, car.gr, ebay, google, imdb, in.gr, yahoo, youtube) |
| **Ε5 · Video streaming** | YouTube Service / 4K / Live |

Ό,τι δεν ταιριάζει πουθενά πέφτει στο `UNMATCHED_RANK` (ακριβώς πριν το Ping group) — ένα νέο
test type **εμφανίζεται**, δεν χάνεται σιωπηλά.

**Ε3 · Browser engines — throughput 0 = failed:** ένα Newton / Kepler / Kepler +30s Pause test
του οποίου το throughput (A-LEVEL `refThroughputKbps` του KPI 30407, αλλιώς το CDR
`throughputKbps`) είναι **0** μετράει ως `failed` στο `classifyDataTest`, ακόμα κι αν το CDR
`TransferStatus` λέει success. Αλλιώς το Test Success Rate του section παρέμενε 100% ενώ ο
μέσος όρος throughput αγνοούσε το 0 (το `collect` πετάει τα 0) — δύο γραμμές να λένε
διαφορετικά πράγματα για το ίδιο test. Ισχύει μόνο για το Ε3 group· σε HTTPS sites / άλλα
tests το 0 εξακολουθεί να σημαίνει «δεν υπάρχει τιμή».

### Μετρικές ανά test type (`buildDataMetrics`)

| Το testType περιέχει | Μετρικές |
| --- | --- |
| `dns` | Mean DNS Resolution Time (ms) |
| `ping` | Mean RTT (ms) |
| `interactivity` | eGaming ThroughputKbps / RTT / PacketsLostRate (%) / PacketDelay / QoEScore (%) |
| `youtube` | Mean video MOS (TestQualityAvg), Mean first delay (s), Mean / Max IP throughput (Mbps, ανά δείγμα FactIPThroughput DL, όλα τα tests), Mean freezing (%) — όπως το Attachment C. Total/Successful = streams με αποτέλεσμα VQ / stream status "ok" (όχι CDR tests)· αν μια location δεν έχει κανένα VQ08 αποτέλεσμα, μετράνε όλα τα streams της. Fallback σε παλιότερο API: MOS + Mean interruptions |
| `capacity` | Mean application capacity DL/UL throughput (Mbps) |
| *default* | Mean application throughput (Mbps) |

```
successRate = success / (success + failed)    // μόνο τα scored tests· τα "other" δεν κρίθηκαν
```

Δύο βάρη, για τις ήδη-αθροισμένες πηγές (π.χ. το ping aggregate): `rowWeight` = πόσα tests
αντιπροσωπεύει η γραμμή, `rowMetricSamples` = πόσα από αυτά έχουν έγκυρη τιμή στη μετρική (ένα
failed ping μετράει στο Total αλλά **δεν** έχει RTT). Για raw rows και τα δύο είναι 1, άρα το
αποτέλεσμα είναι ακριβώς ίδιο με απλό `++`.

`PacketsLostRate = 0` και `interruptions = 0` είναι **έγκυρες** τιμές (τέλειο τεστ) — γι’ αυτό
περνάνε με `allowZero`, ενώ παντού αλλού το `0` σημαίνει «δεν υπάρχει τιμή».

---

## 8. Compact vs Full — ακριβώς τι αλλάζει

**Voice tables** — μένουν μόνο 6 labels, με τη σειρά του `COMPACT_VOICE_ROW_ORDER`:

```
Total Calls (ή "Total Calls (excl. SR)") → Call Success Rate → Dropped Call Rate
→ Access Failure Rate → POLQA avg
```

Τα counts δεν χάνονται: μπαίνουν **μέσα** στο rate cell σαν δεύτερη γραμμή `sum=…`
(`Cell.kind === "rate"`, πεδίο `count`). Οι δύο κάρτες πάνε δίπλα-δίπλα, μισό πλάτος η καθεμιά.
Τα per-operator KPI tiles φεύγουν — ήδη καλύπτονται από αυτές τις γραμμές.

**PS Data**:

| Ενέργεια | Πού γίνεται |
| --- | --- |
| Capacity DL+UL και Ookla DL+UL ενώνονται σε ένα directional table το καθένα (όλα τα DL rows πρώτα, μετά όλα τα UL) | `buildDirectionalDataSections` + `directionalDataRows` |
| Τα 9 HTTPS sites γίνονται ένα `HTTPS sites (all sites combined)` | `buildHttpsSitesTotal` |
| Τα Ping 40/800/1000 γίνονται ένα `Ping (all sizes combined)` | `buildPingTotal` |
| Φεύγουν ολόκληρα τα Ε3 · Browser engines και Ε5 · Video streaming | `COMPACT_EXCLUDED_GROUPS` |
| Φεύγουν HTTP Transfer DL/UL, DNS Resolution, Interactivity, Capacity (grx)/(akamai) | `COMPACT_EXCLUDED_SECTION_LABELS` |
| Φεύγουν οι Serving Band/Tech πίτες και τα group headers | render στο `SummaryTab` |
| Κάθε section: μόνο Success Rate / Total Tests / metric — χωρίς ξεχωριστά Successful/Failed | `compactDataRows` |

> Γιατί άλλα φιλτράρονται **by group** και άλλα **by label**: το Ε2 περιέχει και το merged
> “Ping (all sizes combined)”, που **πρέπει** να μείνει. Ένα filter by group θα το έσβηνε μαζί.

**Full-only**: το γυμνό `Capacity DL 10GB` / `Capacity UL 1GB` κρύβεται **μόνο αν** υπάρχουν
πραγματικά τα (grx)/(akamai) breakdowns στα δεδομένα
(`FULL_BARE_CAPACITY_HIDDEN_WHEN_BROKEN_DOWN`). Αν το `/api/capacity_link` αποτύχει, το γυμνό
μένει ορατό αντί να εξαφανιστεί το Capacity εντελώς.

---

## 9. Serving Band / Serving Technology pies (Full only)

Δύο πίτες ανά operator στην κορυφή του PS Data card — 5G band mix (NR28/NR1/NR78) και συνολικό
technology mix (incl. `No data transfer`), πάνω σε FTP/HTTP/CAPACITY DL tests.

Δύο αποφάσεις που φαίνονται περίεργες αλλά είναι σκόπιμες:

1. **Το ποσοστό ζωγραφίζεται μέσα στη φέτα**, όχι έξω με connector line — έτσι δεν κόβεται ποτέ
   στην άκρη του chart, όσο στενή κι αν είναι η στήλη. Φέτες <6% δεν παίρνουν label (μένουν
   μόνο στο legend).
2. **Το χρώμα δένεται στη μετρική (`ord`), όχι στη θέση της φέτας.** Με positional index, ο
   operator που δεν είχε 5G SA «μάζευε» τις φέτες προς τα πάνω και το πράσινο ήταν “5G NR CA”
   στη μία στήλη και “LTE-5GNR” στη διπλανή — οι πίτες δεν συγκρίνονταν μεταξύ τους.

---

## 10. Χρώματα

Δύο ξεχωριστά συστήματα, που δεν μπερδεύονται ποτέ:

- **Ταυτότητα (operator)**: σταθερά brand χρώματα — COSMOTE `#3ab54a`, VODAFONE `#e60000`,
  NOVA `#111318`, άγνωστος `#898781`. Ένα φίλτρο που κόβει operator **δεν** ξαναβάφει τους
  υπόλοιπους. Το μαύρο της NOVA παίρνει λεπτό φωτεινό περίγραμμα για να διαβάζεται πάνω σε dark
  surface.
- **Κατάσταση (status)**: `good #0ca30c` / `warning #fab219` / `serious #ec835a` /
  `critical #d03b3b`. Κατώφλια στο `rateSeverity()`: higher-is-better ≥98/95/90 %,
  lower-is-better ≤1/2/5 %. Το hero έχει δικά του (`heroCsrColor`): >95 πράσινο, 90–95
  πορτοκαλί, <90 κόκκινο.

**Αν αλλάξει το target, άλλαξε μόνο το `rateSeverity` / `heroCsrColor`.**

---

## 11. Συνταγές

**Νέο voice KPI row** → entry στο `voiceRows()` (`SummaryTab.tsx`). Αν χρειάζεται νέο νούμερο,
πρόσθεσέ το πρώτα στο `VoiceStats` + `buildVoiceStats` + `EMPTY_VOICE_STATS`. Αν πρέπει να
φαίνεται και σε compact, βάλε το **ακριβές** label στο `COMPACT_VOICE_ROW_ORDER`.

**Νέο PS Data test** → συνήθως δεν χρειάζεται τίποτα: αρκεί το `testType` να φτάσει στο
`DataCallRow[]`. Για ωραίο label → `SECTION_LABEL_RENAMES`. Για σωστή θέση → `sectionGroupOf`.
Για δικές του μετρικές → νέος κλάδος στο `buildDataMetrics`.

**Νέο endpoint** → query στο `useQueries` του `Index.tsx` + mapper `…RowsToDataCallRows` στο
`attachmentC.ts` + πρόσθεσέ το στο `summaryDataCallsWithOokla` και (αν είναι PS Data) στη λίστα
του `dataPending`.

**Νέο toggle** → `useState` στο `SummaryTab`, checkbox στη γραμμή controls, και πέρασέ το στο
`KpiTable`. Αν επηρεάζει **ποια queries τρέχουν**, πρέπει να γίνει controlled prop όπως το
`compact`.

---

## 12. Παγίδες

- **Τα labels είναι κλειδιά.** `COMPACT_VOICE_ROW_ORDER`, `COMPACT_EXCLUDED_SECTION_LABELS` και
  `DIRECTIONAL_MERGE_PAIRS` κάνουν match σε **ακριβή strings**. Ένα rename στο `voiceRows` /
  `SECTION_LABEL_RENAMES` χωρίς ενημέρωση εδώ = η γραμμή εξαφανίζεται σιωπηλά από το compact.
- Το `"Total Calls"` αλλάζει label με το `excludeSysRelease` — γι’ αυτό **και τα δύο** variants
  υπάρχουν στο `COMPACT_VOICE_ROW_ORDER`.
- Το `compact` ζει σε **δύο** σημεία με το ίδιο localStorage key (`Index.tsx` controlled +
  internal fallback για τα tests). Μην αλλάξεις το key μόνο στο ένα.
- Τα `fakeEvents` θέλουν τα **ανεπεξέργαστα** `allCallsRows` — αν περάσεις τα φιλτραρισμένα,
  είναι πάντα 0.
- Το `%` κολλάει στην τιμή (`0.668%`), κάθε άλλο unit πάει στο label (`Mean RTT (ms)`) — βλ.
  `cellText`.

---

## 13. Tests

```bash
npx vitest run src/components/SummaryTab.test.tsx src/lib/attachmentC.test.ts
```

Τα render tests κάνουν `<SummaryTab />` χωρίς γονέα, οπότε πέφτουν στο uncontrolled `compact`
state — κάθε test δηλώνει ρητά ποιο mode δοκιμάζει.
