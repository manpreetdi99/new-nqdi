"""Κεντρικό router file.

Δημιουργεί το FastAPI app (+ CORS) και κάνει include ένα router ανά σελίδα
του frontend. Τα ίδια τα endpoints/queries ζουν στο backend/routers/,
ομαδοποιημένα βάσει των queries που απαιτεί κάθε σελίδα:

  filters          -> κοινά dropdowns όλων των σελίδων (databases/collections/locations)
  calls            -> σελίδα Voice Calls (λίστα + σχόλια)
  data_calls       -> σελίδα Data Sessions
  call_detail      -> Call Detail: KPIs, details, MOS, devices, markers, handovers κ.λπ.
  call_radio_lte   -> Call Detail: LTE radio charts (A & B side, neighbors, cell info)
  call_radio_gsm   -> Call Detail: GSM radio charts
  call_radio_other -> Call Detail: WCDMA/NR5G, coverage, ping
  call_context     -> Call Detail: ±window σήμα/τεχνολογία γύρω από την κλήση
  call_scanner     -> Call Detail: scanner tab (FactLTEScanner/FactGSMScanner)
  call_l3          -> Call Detail: L3 signalling log + summary + tracelog
  antennas         -> σελίδα Antennas Map (geo4g.xlsx)
  benchmark        -> σελίδα Query Builder / Benchmark
  validation       -> σελίδα Validation (run_map)
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from routers import (
    antennas,
    benchmark,
    call_context,
    call_detail,
    call_l3,
    call_radio_5g,
    call_radio_gsm,
    call_radio_lte,
    call_radio_other,
    call_scanner,
    calls,
    data_calls,
    filters,
    validation,
)

app = FastAPI()

# Τα rows endpoints (/api/calls, /api/data_calls, /api/ping_1000, ...) στέλνουν
# επαναλαμβανόμενο JSON — ίδια κλειδιά σε κάθε γραμμή — οπότε συμπιέζονται πολύ καλά.
# ΠΡΙΝ το CORS: το Starlette χτίζει το τελευταίο-προστιθέμενο middleware ως εξωτερικότερο,
# άρα έτσι το CORS μένει outermost και δεν συμπιέζονται τα preflight responses.
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # μετά μπορείς να το περιορίσεις
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for _module in (
    filters,
    calls,
    data_calls,
    call_detail,
    call_radio_lte,
    call_radio_gsm,
    call_radio_5g,
    call_radio_other,
    call_context,
    call_scanner,
    call_l3,
    antennas,
    benchmark,
    validation,
):
    app.include_router(_module.router)
