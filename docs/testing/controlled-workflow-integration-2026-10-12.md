# Controlled workflow integration — 2026-10-12

This stage connects the accepted instrument v2 protocol to API, PostgreSQL and operator UI. It preserves the uncommitted exact-target/protocol continuation and retained owner state. [ADR-031](../decisions/ADR-031-controlled-workflow-integration.md) records the persisted token policy and workflow decisions; [protocol acceptance](controlled-registry-2026-10-12.md) remains a separately fingerprinted prior checkpoint.

Implemented scope: immutable instrument token policy and raw capture evidence in migration 22; versioned issuance; saved capture begin/record/finish/abort; finalized-lock-aware raw registry collection; assigned-unit reservation; controlled payment/burn and active-redemption completion; governed receipts and independent browser wire review. The capability defaults off and requires the reviewed Localnet candidate. General secondary two-signature transfer UI is separate.

## Workspace checks

- Final `npm run check` passed types, Prisma schema, documentation and **640 tests**: API 210, web 165, domain 43, client 82, root 140; no failures/skips. Root tests include 47 controlled offline evidence checks and nine real API-to-compiled-browser contract checks. Earlier 562/607-test checkpoints are superseded by this run.
- Focused capture tests cover explicit capability/network gates, exact prepared wire, audit rollback, original-signature recovery, stale/foreign account metadata, minimum finalized slot, lock changes, unsafe abort/finish and complete canonical ownership/balances.
- Web typecheck and **165 tests** passed, including independently derived issuance/capture/reservation/settlement wires and receipt corruption cases.
- Actual API-produced percentage/exact registration, reset, global finalization and assigned-unit plans pass browser metadata and exact-wire validation. Signed pending payment GET recovers a closed source without replacing its original review/signature; historical controlled receipts remain verifiable after present supply changes to zero.
- Full production `npm run build` passed API, web, domain and client; isolated web production proxy checks passed the explicit capture route allowlist.
- The previous SBF/IDL artifact remains unchanged; no Rust source changes are required for this integration.
- Resumed final Rust validation passed formatting, **28 default / 28 Devnet host tests** and strict Clippy in both profiles. The host Devnet profile is not public-network acceptance. Fresh root production dependency audit reported zero vulnerabilities; the redacted Gitleaks scan covers publishable source and evidence.

The final browser receipt review added immutable burn-source/balance and receipt-PDA checks plus a complete captured-supply-to-final-supply burn chain, independent of receipt row order. **19 regression cases** are included in the 165 web tests. Offline revalidation accepted all **three original runtime redemption receipts** at present fixture supply zero and rejected **21 rehashed tamper cases**. It sent no transactions and queried neither RPC nor PostgreSQL. The [post-runtime result](evidence/controlled-workflow-2026-10-12/post-runtime-receipt-validation.json) binds the final source, test and compiled helper hashes to the unchanged runtime bytes. Of the 29 executed hashes, **28 still match** final files; the compiled redemption receipt validator is the sole separately validated change. The [original packaging fingerprint record](evidence/controlled-workflow-2026-10-12/runtime-source-fingerprints.json) preserves the initial 29 matches.

Integrated runtime acceptance and evidence packaging are complete. Workspace checks and the saved runtime are separate evidence levels; the run below establishes only the documented disposable Localnet scope.

## Integrated runtime

Accepted disposable runtime: **2026-10-12 13:55:16–14:19:06 Asia/Qyzylorda** (`08:55:16.785Z–09:19:06.723Z`). A fresh validator and PostgreSQL applied all **22 migrations**. Authenticated HTTP issuance completed `MINT_SETUP → INITIALIZE → DISTRIBUTION → ACTIVATE`, followed by all four controlled financial actions using prepare/sign/submit/confirm, captured raw sources, assigned-unit reservations, full cash reserve and separate approval. Fresh wallets, KZT-Test and eligibility are synthetic. No retained owner ledger/database, public Devnet or hosted rollout was used.

| Scenario | Finalized amount, KZT-Test | Units burned | Supply before → after |
| --- | --- | --- | --- |
| Coupon | 1,750 | 0 | 35 → 35 |
| Percentage partial, 20% | 7,000 | 7 | 35 → 28 |
| Exact-target partial, 8 units | 8,000 | 8 | 28 → 20 |
| Maturity, principal plus final coupon | 21,000 | 20 | 20 → 0 |

The exact partial allocation was `2/5/1` from captured balances `8/16/4`. Every action finalized its canonical receipt; PostgreSQL projections matched the reconciled token/cash legs and final supply. The runtime also passed altered-wire and unauthorized-role/Origin rejection, policy/capture-evidence immutability, registry lock beyond the original window, repeated-submit/payment protection and transactional projection/audit rollback. Missing transaction history kept the original attempt/signature in `UNKNOWN_CONFIRMATION` until that same signature reconciled.

A maturity payment finalized, its emptied bond source was then closed, and execution GET restored the saved review and original signature. Confirmation succeeded without requiring the closed account to reappear. After maturity, HTTP downloads of both earlier partial-redemption receipts retained their exact canonical bytes/hashes and passed the independent browser verifier while current supply was zero.

The [evidence package](evidence/controlled-workflow-2026-10-12/README.md) contains the runtime/log, four original canonical receipts, offline consistency result and source/SBF/IDL fingerprints. All **29 executed source/helper hashes** matched disk when the recovered runtime was packaged, and program/client sources matched the earlier controlled protocol checkpoint. SBF SHA-256: `772d8217c6395bbcd854f60f743139d756a15e7a0b7bb03396a586dc4b7b407b`; IDL SHA-256: `4d50cb17cd0c0e0d3740e4b0ec42a71e2bdb62001fc9b654093024d33f5d046f`. Subsequent browser receipt-verifier hardening is validated separately against the saved canonical receipts; those checks do not constitute another financial runtime. Offline verification checks saved consistency; it does not re-query chain/database state or authenticate runtime provenance.

The accepted run used normal **64 ticks per slot**, a **1,200-second** future maturity and a **90-second** original-signature confirmation deadline. The separate legacy zero/mixed coupon prelude is explicitly excluded; it remains in the legacy demo command and has prior acceptance on the unchanged binary. This run does not establish fresh normal-timing all-zero/mixed legacy coupon acceptance.

Earlier interrupted runs remain partial history: an incorrect capture URL, funding before FINISH and missing capture metadata were corrected in the harness/API. An eight-tick run reached supply 28 before snapshot confirmation timed out; it preserved the original signature, and its precise cause remains unconfirmed. The first normal-timing attempt stopped in the separate legacy zero-coupon prelude with `InvalidActionDates` (6017). The subsequent complete run supersedes these attempts for controlled application acceptance without relaxing financial gates or resending unknown financial mutations.

## Boundaries

Capture records the actual finalized lock slot/time, not reconstructed historical balances at an arbitrary planned timestamp. Investor grouping and eligibility remain registry/authority inputs. Incoming memo-required transfers still fail safely without a memo CPI. Atomic packet/account limits, scalable capture, general holder/operator transfer workflow, controlled scheduled cancellation, committed reversal, durable jobs, separate final-coupon period uniqueness, CSV evidence, Devnet and owner rollout remain open.

Browser wire tests and HTTP signing with disposable keys do not prove a human Phantom approval or full usability/accessibility acceptance. Manual wallet, mobile keyboard, native assistive technology and five-user usability remain separate.

The existing issuance fixture creates a per-instrument KZT-Test mint while the database settlement asset is a singleton. A second issuance against that populated asset cannot create another mint; this pre-existing limitation requires a separately designed shared settlement-mint workflow. Integrated acceptance uses a fresh disposable database and does not establish multi-instrument issuance.
