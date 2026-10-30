# Cause signatures

## Drop causes (md §1.3, priority §1.6)

| Cause | Signature in drive-test data | Confidence |
|---|---|---|
| SRVCC_FAIL | `MobilityFromEUTRACommand` in the last 5 s; no successful move to 2G/3G | high |
| HO_FAIL | `LastHoType = HO_FAIL`, UL `Handover Failure`, or reconfiguration with mobilityControlInfo without Complete | high |
| RLF | `RRCConnectionReestablishmentRequest` (cause otherFailure / T310 / RLC max retx); Reject → drop | high |
| RTP_TIMEOUT | SIP BYE from UE with Reason RTP/RTCP timeout; DL RTP gap ≥ 10 s | high |
| CORE_RELEASE | BYE/release from network with 5xx or session timer | high |
| radio pattern only | RSRP < −115 dBm or SINR < −3 dB in the last 5 s → RLF | medium |
| UNKNOWN_LOG_GAP | no signalling evidence (often end of file) | low |

## Fail stages (md §1.4)

| Stage | Signature |
|---|---|
| RRC | `RRCConnectionRequest` without Setup, or `RRCConnectionReject` |
| PAGING (MT) | terminating side never gets INVITE / sends no Service Request |
| IMS_REG | REGISTER 403/408/5xx or no registration |
| BEARER | INVITE without `Activate dedicated EPS bearer context request` |
| PRECONDITION | 183 without PRACK/UPDATE, then NW CANCEL → 487, or 580 |
| INVITE | final 408/500/503/504 without 180 |
| RINGING | no 180 within the timer → CANCEL (487) |
| FALLBACK | CSFB / redirect before 180 (GSM/LTE calls) |

## pptx cases (radio first)

| Comment | Radio | Signalling |
|---|---|---|
| LC LTE | RSRP −123…−133, RSRQ −19…−22, SINR −10…−13 | RRC re-establishment before the drop |
| LQ LTE | RSRQ −14…−18, RSRP not extremely weak | POLQA-WB error −10 before the drop |
| LC GSM | RxLev Sub ≤ −93 (weak −108/−109 after SRVCC) | CM Re-Establishment Request |
| CORE NETWORK (DRB RELEASE 3) | acceptable | `drb-ToReleaseList {3}` in the 1st/2nd DL reconfiguration after `IMS SIP ACK: Request`, UE Reconfiguration Complete, then drop |
| CORE NETWORK (DL RELEASE) | GSM −75…−88 | first CC clearing message is DL Disconnect/Release |
| CORE NETWORK (NO PAGING) | acceptable | B→A GSM: terminating side gets no Paging Request |
| CORE NETWORK (SIP 503) | acceptable | `IMS SIP INVITE Error 503`, then Deactivate EPS Bearer |
| FAKE EOF | mostly acceptable | Test aborted / Job stopped / User stop / Closing current database; last call of the file |
| FAKE UE STUCK (UL DISCONNECT) | GSM −69…−83 | UL CC Disconnect first |
| FAKE UE STUCK (CC DISCONNECT MISSING) | good | CC Release without Disconnect while speech runs to the configured duration |
| FAKE NO SYNC | good | tool reports «No Sync found» |
| FAKE UE STUCK (NO CM SERVICE REQUEST) | GSM −61…−66 | A→B GSM without UL CM Service Request, Connect Failed |
| FAKE UE STUCK (NO RESPONSE AFTER PAGING) | good | Paging Request without Paging Response (no slide in the pptx) |
