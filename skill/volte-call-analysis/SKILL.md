---
name: volte-call-analysis
description: This skill should be used when analysing VoLTE and CS-GSM call drops and call setup failures from drive-test or benchmarking data, or when judging whether engineers' call comments (LC/LQ LTE/GSM, CORE NETWORK, FAKE EOF/NO SYNC/UE STUCK, DRB RELEASE 3) are supported by the radio, L3, SIP and tracelog evidence. Covers RLF, HO fail, SRVCC, RTP timeout, SIP 4xx/5xx, QCI1 bearer and DRB release rules, and the md-vs-audit comparison tables of the new-nqdi Demo tab.
---

# VoLTE call analysis

## Purpose

Classify drop and failed calls and audit the engineers' comments with two rule sets that must stay separate:

1. **md rules** (`volte-drop-fail-analysis.md` §1.6) — drop cause priority SRVCC_FAIL → HO_FAIL → RLF → RTP_TIMEOUT → CORE_RELEASE → UNKNOWN_LOG_GAP, fail stage from the RRC → PAGING → IMS_REG → BEARER → PRECONDITION → INVITE → RINGING ladder.
2. **pptx rules** («Call Analysis.pptx») — radio first, then signalling decides which Core / Fake sub-type applies.

## Data sources

No MCP server exists. Use the tables of the new-nqdi Demo tab:

- **User comment audit** (`src/components/CommentAuditPanel.tsx`): per call, the user comment, grade 0–100, verdict, the pptx label and every evidence fact (radio A/B, L3, SIP, tracelog).
- **md vs audit comparison** (below the audit): md cause/stage with confidence, and the family (RADIO / CORE / FAKE / USER) of the user comment, the md result and the audit result.

Backend endpoints behind them: `/api/call_analysis`, `/api/call_context_signal[_b_side]`, `/api/gsm_context_signal[_b_side]`, `/api/l3_summary`, `/api/l3_messages` (layers `LTE-RRC`, `SIP`), `/api/tracelog_values`.

## Workflow

1. Start from the comparison table summary: agreement user–md, user–audit, md–audit.
2. For each disagreement family, open 2–3 calls and read the evidence facts.
3. Apply the rules in `prompts/analyst.md` (priority order, DRB checks, user codes).
4. Report with the output format of `prompts/analyst.md`; every claim carries a SessionId.

## Rules that are easy to get wrong

- RxLev thresholds apply to **RxLev Sub** (DTX makes Full 10–25 dB lower).
- A `SIP ACK: Request` also follows 487/4xx/5xx final responses; it does not prove the call was connected.
- DRB 3 is not always the QCI1 voice bearer; check `drb-ToAddModList` (drb-Identity ↔ eps-BearerIdentity).
- Measure "after the call" from the **first** CallEnd of A and B.
- 486/603/604/404 and user CANCEL are not network fails; NW CANCEL → 487 is.

## References

- `references/cause-signatures.md` — drop causes, fail stages and the pptx cases with their signatures and thresholds.
- `references/sip-codes.md` — SIP codes, network vs user, ACK semantics.
- `references/research.md` — verified findings, sources and open gaps.
- `prompts/analyst.md` — system prompt for the analyst, with examples and the self-check list.
