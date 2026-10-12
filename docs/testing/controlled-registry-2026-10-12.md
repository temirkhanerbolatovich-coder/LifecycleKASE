# Controlled registry protocol candidate — 2026-10-12

## Scope

This continuation adds [controlled registry](../features/controlled-registry.md) for a new instrument v2 and new mint, preserving prior exact-target action v2 and legacy instrument v1. See [ADR-030](../decisions/ADR-030-controlled-registry-and-unit-reservations.md). It is protocol/client source and disposable Localnet acceptance, not API/database/UI integration or a retained-owner/hosted/Devnet rollout.

The program keeps holder accounts Frozen, routes authorized transfers through atomic thaw/transfer/refreeze, captures complete raw holders under a movement gate and reserves only assigned units. Shared cash reserve, approval and atomic payment/burn are reused. New sidecar PDAs preserve existing account layouts. Legacy instrument paths reject controlled instruments instead of weakening their absent-freeze-authority checks.

## Source verification

| Check | Actual result |
| --- | --- |
| Final `npm run check` | PASS types, schema, scaffold/docs and **521 tests**: API 181, web 131, domain 43, client 82, root 84; zero failed/skipped |
| New client tests | **23** included above: PDA/metas/bytes, identity-bound decoders, actual token metadata, capture minimum finalized slot, stale/duplicate/corrupt inputs and account guard extensions |
| Production `npm run build` | PASS API, web, domain and client; this does not demonstrate a new UI capability |
| Rust tests | **28 default and 28 Devnet host** passed; host Devnet profile is not public-network execution |
| Strict Clippy, IDL-feature check and formatting | PASS both Clippy profiles; `cargo check --features idl-build` and `cargo fmt --all -- --check` passed |
| Candidate C SBF/IDL | Fresh isolated `localnet-candidate-controlled-20261012-c`, SHA-256 `772d8217c6395bbcd854f60f743139d756a15e7a0b7bb03396a586dc4b7b407b` |
| Instruction encoding | Controlled 207-byte mint and extension/default-Frozen/freeze-option bytes compared with installed `@solana/spl-token` 0.4.14 constructors |
| Review | Client/Rust cross-review; minimum finalized capture slot, owner-enabled guard liveness and zero-source independence addressed with regressions |
| Production dependencies | Root `npm audit --omit=dev`: zero reported vulnerabilities; no new dependency. The separately isolated legacy integration dependency graph is outside this audit |
| Secret scan | Gitleaks 8.30.1 passed all changed publishable source/evidence. Five exact public token addresses are excepted only for this runtime file and `generic-api-key`; treasury ATA derivation and raw captured sources were verified. Negative scope check still detects an unmatched value in the same path and an allowed value in another path |

`CpiGuard` and `MemoTransfer` flags can be enabled by holders while Frozen. Rejecting them after reservations would strand otherwise valid settlement. The candidate supports these known typed flags, uses its permanent delegate, and ignores current bytes of zero-assignment source accounts after validating their immutable identity and zero reserved count. Required incoming memos still cause a safe Token-2022 transfer failure; this stage does not emit a memo CPI.

## Disposable controlled execution

Final Candidate C run **passed at 05:46:40 Asia/Qyzylorda**: **63 distinct finalized transactions** and **35 expected preflight/simulation rejections** with unchanged protected account hashes. Genesis was `5MAbDmYLZL4eqG6UyH8fkgivEWFZCtv6EiyL1ZzCvok7`. The freshly built client, current harness, SBF/IDL and runtime are bound by hashes in the [evidence package](evidence/controlled-registry-2026-10-12/README.md). Runtime SHA-256 is `f049fab3b3fd39c163a58d7ec4cc6f03e93f942d447a86265be0132593851166`.

The completed run verifies Frozen bootstrap/activation; direct transfer/burn/thaw/delegate/authority and wrong-signature rejection; complete finalized-lock-aware raw capture; omitted/duplicate/wrong-PDA inputs; safe pre-commit abort and rejected post-commit abort; full reservation coverage; reserved-unit transfer rejection; all free units moving; full cash reserve with a distinct approver; exact atomic payment/burn; both replay forms; finalized on-chain receipts; zero remaining reserved counters; and clearing the active redemption only after Finalized. Guard settings enabled both before and after capture/reservation preserve outgoing movement and burns. The temporary validator, signer and ledger were removed after success.

An earlier Candidate A run passed default-frozen bootstrap, distribution 10/20/5, direct bypass rejection, capture and exact redemption: 57 finalized transactions and 34 rejection/unchanged-state assertions. It predates the final minContextSlot and owner-guard/zero-source regression additions, so it is historical partial evidence only. A preceding Candidate C run exercised the final product code but omitted its genesis stamp; the fresh run above records that identity at execution time instead of retroactively inventing it.

Final fixture: supply 35, three synthetic holders, four positive token sources. Exact target 8 assigns `2/5/1`, paying 8000 KZT-Test and leaving supply 27. One holder has two source accounts. Every unassigned unit can move through the controlled path; the entirely unassigned source may close and be recreated with another wallet without affecting the assigned burn.

The controlled fixture reads back on-chain entitlement/action receipts and verifies payment, burn, counters and finality. Its action receipt commitment is a synthetic fixture hash, not the application's canonical JSON receipt workflow. Coupon capture/calculation rights are checked at `500/1000/250`, but coupon payment is not executed on instrument v2 here. Canonical application receipts and the four full financial actions belong to the separate legacy compatibility run. Controlled maturity execution and the operator receipt projection still need integrated acceptance.

Wrong-recipient validation rejects before the settlement handler and proves unchanged protected state. The memo-required destination failure reaches Token-2022 after thaw CPI in simulation and proves atomic rollback to unchanged finalized bytes and Frozen states. These are different negative paths; neither is presented as a landed failed transaction.

Reproduction uses `npm run test:controlled:integration` or the new PowerShell wrapper with a reviewed candidate profile. It uses a freshly generated temporary signer and separate owned ledger, preserves owner artifacts, and never accepts a retained key path. All financial sends obtain a fresh blockhash, submit once with `maxRetries: 0`, and verify the original finalized signature and transaction read-back. Failed negative tests compare protected account hashes before and after; these rejections are preflight/simulation evidence unless a finalized failed signature is explicitly saved.

## Legacy regression

The first four-action compatibility rerun on Candidate A finalized coupon and legacy partial redemption, then failed at exact action snapshot preparation with `RPC_HTTP_ERROR`. It does not establish a full pass. The underlying transport cause was not identified. The disposable RPC relay now logs only method, error type and sanitized cause code, without request params, signed bytes or secrets. No generic mutation or send retries were added.

The final Candidate C four-action compatibility run **passed at 05:43:48 Asia/Qyzylorda** on a separate generated-wallet validator and fresh PostgreSQL with all 21 migrations. Coupon `1750`, legacy partial `7000`, exact partial `8000` and maturity `21000` KZT-Test finalized; supply `35 → 35 → 28 → 20 → 0`. Exact allocation `2/5/1`, immutable target/reset, original-signature recovery and transactional projection/audit rollback passed. Genesis was `FsiceXrUN9qn4gx4VbHzm2JNdTbKpaapToSJzSZx1DrW`; temporary services were stopped. The offline evidence verifier passed all four canonical receipt hashes, signatures, settlement legs and supply transitions. That verifier establishes saved consistency, not independent authenticity or a fresh chain query.

Historical [04:39 exact-target acceptance](bondflow-exact-redemption-2026-10-12.md) remains separately fingerprinted. The new compatibility run explicitly exercises the final controlled candidate binary with legacy instruments and action versions.

## Integration and remaining work

The operator API/database/web issuance and settlement still use the legacy instrument contract. No new UI flag, owner migration, deployed program update, public-network transaction or commit/push was performed here. Browser UI checks were not run because this iteration adds no web presentation or routes.

Feature documentation, ADR-030, root/program/client READMEs, architecture overview and the BondFlow requirement/next-step matrix were updated. The [evidence package](evidence/controlled-registry-2026-10-12/README.md) keeps these two new executions separate from prior accepted snapshots; its source fingerprints include the preserved uncommitted continuation, final program/IDL/client and both runtime identities.

Next integration must connect controlled mint bootstrap, saved policy/capture plans, raw captured positions, unit reservation progress and the new exact execution wires through the existing prepare/sign/submit/confirm pipeline, including restart-safe audit/projection. Then repeat the full operator/HTTP/PostgreSQL workflow with controlled instruments.

Atomic capture has a source-level cap of 64 accounts, but each raw account also needs a Holding meta. Actual packet/account constraints are lower without lookup tables. Acceptance uses four sources, not a measured large-holder workload. Committed capture reversal, controlled scheduled cancellation, durable jobs, final-coupon period uniqueness, full wizard, evidence CSV, Devnet, accessibility/performance/usability and owner rollout remain open.
