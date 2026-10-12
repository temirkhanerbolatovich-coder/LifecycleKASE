# BondFlow exact-target redemption — 2026-10-12

## Scope

The allocation and exact-quantity part of [BondFlow section 8.3](../requirements/KASE_BondFlow_TZ.md) is implemented as a versioned Localnet candidate on top of `8368d68`, branch `codex/full-project-audit-20261010`. Reservation of assigned units remains open. Changes remain in the working tree. Historical v1 percentage calculations and receipts keep their semantics. See [feature/configuration](../features/exact-target-redemption.md), [ADR-029](../decisions/ADR-029-exact-target-redemption.md) and [remaining requirements](../features/bondflow-implementation-plan.md).

A positive immutable target is allocated by floor quotas and largest remainders. Ties use each investor's smallest positive captured source owner in ASCII base58 order, independently of payment receivers. Full coverage includes zero-allocation rows. Target PDA, paired action/entitlement version, price-times-quantity and global allocation are checked before approval/execution. Receipt v2 binds the allocation to atomic reconciled payment/burn evidence.

Owner ledger, database, wallets, deployed program and hosted services were not used or modified. Real chain writes use generated disposable wallets and a separate validator. KZT-Test and eligibility are synthetic. No commit, push, public deployment or owner migration was performed.

## Source verification

| Check | Performed result |
| --- | --- |
| Resumed final `npm run check` | PASS scaffold, Markdown links/fences, Prisma, workspace typechecks and **498 tests**: API 181, web 131, domain 43, client 59, root 84; failed/skipped 0 |
| Final `npm run build` | PASS API, production Next.js web, domain and Solana client |
| `cargo test -p lifecycle_kase` | PASS 25, default Localnet profile |
| Same Rust tests with `--no-default-features --features devnet` | PASS 25; host profile check, no public Devnet execution |
| `cargo clippy -p lifecycle_kase --all-targets -- -D warnings`, repeated with `--features devnet` | PASS both profiles |
| `cargo check -p lifecycle_kase --features idl-build`; `cargo fmt --all -- --check` | PASS |
| Fresh SBF candidate build and IDL generation | PASS isolated `localnet-candidate-kase-20261012-042236318`; SHA-256 `609b5d25800671fdf4084ccc402e47f5a065dd1a7c6b9b956efd4bb5546a9815`, identical to the preceding candidate |
| Shared TS/Rust allocation TSV | Exercised by both suites, including reversed order, equal quotas, zero/full targets, ASCII ties and products near u128 bounds |
| Changed JS harness syntax and Git whitespace | `node --check` both harnesses and `git diff --check` PASS |
| `npm audit --omit=dev` | 0 advisories in the root production dependency graph; isolated legacy integration dependencies are outside this audit |
| Checksum-pinned Gitleaks 8.30.1 | Fresh PASS across changed publishable source and evidence, existing configuration/precise public-address exceptions and 100% redaction; ignored owner artifacts and full Git history were not scanned in this run |
| Independent source review | Rust/migration and API compatibility reviewed; browser program/PDA substitution and self-consistent receipt corruption findings fixed with regressions |
| Offline four-action evidence verifier | 37 tests PASS, included in the 498 total; validates hashes, identities/PDA, signatures, due execution time, settlement legs, source/investor continuity and exact allocation. It makes no RPC/database queries or authenticity claim |

The resumed run rebuilt SBF/IDL from current source and repeated the production build, both Rust profiles, Clippy, IDL check, format and dependency audit. Migration 21 preserves valid v1 and prevents target/policy or exact economic-term edits. Historical malformed EARLY rows that passed an old SQL CHECK through NULL semantics need read-only preflight before owner rollout; the owner database was not inspected or migrated.

Tests cover `10/20/5` target 8 → `2/5/1`, `1/1/1` target 1 → `1/0/0`, permutation invariance, receiver changes preserving owner ties, complete coverage, duplicates, bounds and overflow. API rejects ambiguous policy/percentage, inconsistent configuration, unsupported network, corrupted saved calculations and off-chain v2 approval. Before signing, the browser derives canonical identities from the separately loaded action and checks actual instruction bytes/privileges. Receipt verification compares immutable snapshot hash/supply and every original owner/balance, including zero rows; a later live supply cannot rewrite historical evidence.

## Disposable execution

**PASS: the fresh rebuilt run completed on 2026-10-12 at 04:39:13 Asia/Qyzylorda** (`2026-10-11T23:39:13.219Z`). It applied all 21 migrations to a new disposable database and finalized all four actions. The wrapper exited with code 0 and stopped its own PostgreSQL/validator. Retained owner and hosted services were not used. See the [runtime package](evidence/bondflow-exact-2026-10-12/runtime.json), [full run log](evidence/bondflow-exact-2026-10-12/runtime.txt) and [source/SBF/IDL fingerprints](evidence/bondflow-exact-2026-10-12/source-fingerprints.json).

Four sequential actions share one disposable 35-token instrument:

| Action | Expected cash | Burn | Supply after |
| --- | --- | --- | --- |
| Coupon | 1750 KZT-Test | 0 | 35 |
| Historical partial 20% | 7000 KZT-Test | 7 | 28 |
| Exact partial target 8 | 8000 KZT-Test | 8 | 20 |
| Maturity with historical combined final coupon | 21000 KZT-Test | 20 | 0 |

Exact redemption captures `8/16/4`, allocates `2/5/1` and leaves `6/11/3`. Independent per-row floors would redeem seven; largest remainder assigns all eight. The browser uses an independent `10/20/5` fixture, leaving 27.

The runtime coupon intentionally transfers one bond before capture: captured positions are `9/21/5`, with payments `450/1050/250` and total 1750 KZT-Test. Restoring current balances to `10/20/5` after capture leaves these coupon rights unchanged. The standard `500/1000/250` fixture is covered separately by calculation tests; it is not the per-row result of this transfer-boundary run.

All four exact canonical receipt byte strings are retained with the runtime package, and their SHA-256, settlement signatures, source commitments, allocation and supply transitions passed the [offline verifier](../../scripts/verify-kase-demo-evidence.mjs). Its [result](evidence/bondflow-exact-2026-10-12/verification.json) explicitly records that RPC/database were not queried during this additional check. Reproduce it after building the domain/client packages:

```bash
npm run demo:evidence:verify -- docs/testing/evidence/bondflow-exact-2026-10-12/runtime.json
```

This is fixed-fixture evidence consistency verification, not independent authentication or a new live-chain acceptance. Fresh chain proof was checked by the disposable harness before its ledger was removed. [Node/type/schema checks](evidence/bondflow-exact-2026-10-12/check.txt), [production build](evidence/bondflow-exact-2026-10-12/build.txt), [Rust profiles/Clippy/IDL/format](evidence/bondflow-exact-2026-10-12/rust.txt) and [root production dependency audit](evidence/bondflow-exact-2026-10-12/dependency-audit.json) are retained.

The [redacted secret scan](evidence/bondflow-exact-2026-10-12/secret-scan.txt) ran from the curated publishable directory so the existing relative-path allowlists applied. The first invocation from outside that directory reported the two already-reviewed public issuer addresses because its absolute file paths did not match those allowlists; the configuration was not weakened or changed.

Acceptance checks immutable target/price/dates/instrument database guards; v1 instructions rejecting v2; wrong same-total `3/4/1` allocation failing global finalization; reset preserving target and restoring registration; separate approval/full reserve; reviewed schedule/calculation/payment/finalization wires; role/Origin/replay guards; finalized insufficient-source atomic failure without cash/burn projection; missing-history recovery on the original signature; database/audit rollback/reconciliation; canonical hashes, target read-back and supply retirement.

An earlier attempt failed on an expired cached blockhash in a generated-holder transfer. Accelerated slots can outlive the SDK's 30-second cache. The test transfer now fetches a fresh finalized blockhash, signs once and confirms that signature; production retry rules were not loosened. A subsequent reviewed run completed coupon, legacy partial and exact partial, then failed with `RPC_TRANSPORT_FAILED` while reading the maturity clock before payments. The harness permits three bounded retries only for these read-only `getSlot/getBlockTime` transport failures, retaining its 600-second deadline; sends are not retried. The next attempt ended at 04:18:32 Asia/Qyzylorda with a 25-second HTTP timeout during maturity snapshot preparation, after the same three completed actions. These were distinct failures; their underlying causes were not proved. No generic mutation/send retries were added. A preliminary complete run passed all four actions; fresh resumed acceptance is recorded separately above.

## Browser QA

Production `/qa` at `127.0.0.1:3020`: Russian desktop 1440×1000 and English mobile 390×844. Created target 8 at 1000 KZT-Test; captured `10/20/5`, calculated `2/5/1`, showed 8000 total and 27 remaining, then submitted, funded/reserved, switched to a distinct approver, paid all three simulated holders and finalized. Every action remained page-local with explicit QA labels.

Mobile DOM width was 375 at a 390 viewport; the table used its own 342-wide scroll region for 749-wide content, without page-wide overflow. Full screenshots are retained separately. The QA receipt button was present; automation timed out waiting for download, so actual browser download completion is **unverified**. A fresh production `/qa` at `127.0.0.1:3021` also timed out waiting for the QA results download, with no browser error/warning logs. This observation does not establish the underlying download cause. API canonical receipt verification is tested independently. Keyboard focus reached the table; full accessibility/native zoom/contrast/usability acceptance remain open. Both temporary local web processes were stopped after their checks.

## Remaining requirements

Controlled direct transfers, capture freeze/resume and reservation of assigned redemption units are the next P0. Current snapshots bind actual finalized capture slot/time and recheck sources/supply at execution; historical planned-record-date reconstruction and transfer enforcement are absent. Scalable finalization, durable workers, separate final-coupon period obligations, public Devnet execution, the full operator wizard, KK localization and measured performance/usability remain open. The new capability defaults off until a separate reviewed rollout.
