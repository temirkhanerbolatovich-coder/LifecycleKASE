# Remaining delivery checklist

Reviewed: 2026-10-09. This is a work plan, not proof of completed MVP functionality. Current evidence and priorities are in the [2026-10-09 full audit](../PROJECT_AUDIT_2026-10-09.md).
Continuation reviewed: 2026-10-07. [Recovery and candidate evidence](../testing/delivery-stage-2026-10-07.md) supersedes the old unsigned attempt/security/UI observations without erasing their chronology. The owner's new development plan is integrated below; full MVP remains open.

2026-10-08 observability addition: [administrator Telegram monitoring](../features/telegram-monitoring.md) is implemented locally for published health, owner Localnet identity/finalized progress, and optional read-only failure aggregates, with hourly summaries and incident/recovery delivery state. The administrator confirmed the initial summary, and unavailable owner RPC/database dependencies were reported. This partially supports row 14; process supervision, broader metrics and publication verification remain open. Existing owner financial gates and dated evidence below are unchanged.

Owner-approved active mode: local MVP first. Public Devnet funding/deployment is deferred until MVP approval under [ADR-014](../decisions/ADR-014-local-mvp-before-public-network.md); numbered network stages below are retained as later gates, not current blockers.
The [implementation status](../IMPLEMENTED_VS_SIMULATED.md) and [requirements](../requirements/PRODUCT_REQUIREMENTS.md) remain authoritative for current evidence and target scope.

## Ordered stages

1. **Deployment preparation**
   - [x] Non-root toolchain, local build and fresh candidate keys prepared.
   - [x] User-approved fee-payer/Phantom authority plan recorded in [ADR-013](../decisions/ADR-013-devnet-demo-authorities.md).
   - [x] Read-only `npm run devnet:preflight` implemented and live-tested: correct Devnet, unoccupied program address, payer has zero lamports.
   - [x] Owner screenshot confirms encrypted key backup decrypts and matches both source keys. See [procedure](devnet-key-backup.md).
   - [ ] Owner retains the passphrase/checksum separately and safely ejects/stores the disk offline; not independently confirmed. Never send secrets to chat, GitHub or Render.
   - [ ] Obtain test SOL and re-check funding. Nonzero balance alone does not prove sufficient deployment funding.
2. **Program identity and build**
   - [x] Separate Devnet Cargo profile, Anchor mapping, isolated SBF/IDL build and public artifact hash/identity gate implemented and locally verified. See [build procedure](devnet-build.md).
   - [x] Both Rust profiles select the expected ID and pass their unit tests; default localnet ID and artifacts preserved.
   - [x] Re-run local-validator end-to-end integration with the reviewed Devnet-profile artifacts: all 25 reported scenario groups passed on 2026-10-01. This is local runtime acceptance, not public Devnet/deployment acceptance.
3. **Devnet deployment** — obtain explicit transaction approval, deploy with the CLI payer and Phantom upgrade authority, verify loader/ProgramData/current authority and finalized signature. Do not confuse the program keypair with upgrade authority.
4. **Investor Registry** — list/create, pending localnet wallet attachment, exact Ed25519 wallet-ownership activation, one-time local-demo eligibility and terminal reasoned wallet revocation implemented in API/UI. Administrator writes/Auditor reads, atomic reason/time/actor audit and a global single-workspace snapshot capture lock are enforced. Real HTTP/PostgreSQL acceptance covers proof replay rejection, eligibility, revocation, capture locking, concurrency, rollback, audit immutability, network guards and logout. Owner confirmed the local Administrator two-account flow through activation/revocation and the separate Account 3 read-only Auditor presentation. Update/close, eligibility correction/suspension and temporary blocking remain pending. See [feature limits](../features/investor-registry.md). No real personal/KYC data.
5. **Instrument setup**
   - [x] Administrator database-draft create and Administrator/Auditor list UI/API with fixed local demo invariants, operator-wallet authority binding and atomic audit.
   - [x] Implement wallet-signed `MINT_SETUP` prepare/confirm for Token-2022 bond and KZT-Test mint creation, 35-token treasury issuance and mint-authority revocation. Exact finalized transaction/mint/treasury reconciliation passed live with Phantom for LKA26R1.
   - [x] Add separate wallet-signed 10/20/5 distribution preparation/finalized reconciliation for three active verified eligible investor wallets; fixture-tested and passed live for LKA26R1.
   - [x] Add separate wallet-signed `INITIALIZE` and `ACTIVATE` phases with exact transaction/PDA reconciliation, repeated activation-time Investor Registry eligibility checks and complete 10/20/5 holder-balance coverage; fixture-tested and passed live for LKA26R1.
   - [x] Add Localnet-only trusted broadcast: Phantom signs the exact prepared transaction, API verifies message/signer/Ed25519 signature and submits it to the configured loopback RPC. Devnet remains wallet-submitted.
   - [x] Run all four live Localnet phases with owner-controlled Phantom signatures before accepting ACTIVE: LKA26R1, exact finalized messages, matching ACTIVE PDA/database, 35/35 supply, treasury 0, holders 10/20/5 and same-wallet session recovery. See [recorded evidence](../testing/localnet-instrument-acceptance.md).
   - [ ] Complete remaining owner-controlled negative scenarios, including cancellation and wrong signer/network; current runtime/unit evidence does not replace all manual cases.
6. **Actions and snapshot**
   - [x] Snapshot HTTP/UI boundary accepts only explicit Localnet/Devnet plans, rejects cluster/wallet-network mismatch, derives the Wallet Standard chain from the validated plan and preserves finalized confirmation/recovery safeguards.
   - [x] Add action draft/list/detail/cancel UI/API, all three action types, future record window, audited idempotent creation and exact wallet-signed schedule/cancel reconciliation. Snapshot is embedded in the selected action. See [feature and limits](../features/corporate-actions.md).
   - [x] Extend Localnet trusted signed-byte broadcast and signed-attempt recovery to action and snapshot workflows; keep session/issuer/Origin controls.
   - [x] Run isolated real HTTP/PostgreSQL/validator acceptance: all three action types SCHEDULE/CANCEL, actual 10/20/5 capture, canonical hash and exact finalized Action PDA commitment, database immutability, idempotency and signed-attempt recovery. This uses a disposable signer/ledger/database, not the owner's persistent Phantom flow.
   - [x] Run a real owner Phantom Localnet snapshot registration and verify exact finalized transaction, canonical hash/rows and chain/database projections. New coupon `464a832a…` has snapshot `6a322373…` FINALIZED and matching SNAPSHOT_CREATED Action PDA. An explicitly authorized controlled Localnet CLI completed delayed database confirmation without signing or resending. Planned/effective times are separate; signed-attempt recovery and idempotency also passed isolated acceptance.
   - [ ] Complete remaining owner manual negative/lost-response/reload variants and separate Auditor action UI acceptance.
7. **Entitlements and approvals**
   - [x] Store one checked integer entitlement per snapshot investor, aggregate all captured wallets/accounts, preserve canonical snapshot integrity, inputs/formula/rule versions and atomic actor audit.
   - [x] Implement authenticated Administrator issuer-wallet calculation and explicit submit/approve/reject/revision API/UI; Auditor reads. Preserve entitlement IDs on revision and require approved metadata/integrity/current eligibility before future execution.
   - [x] Check Rust/TypeScript parity with shared coupon/maturity/early, rounding/zero/overflow vectors; both Rust profiles pass. No live program upgrade or execution instruction is implied.
   - [x] Pass isolated real HTTP/PostgreSQL flows for all three types, concurrency, tampering, revoked receiver and audit rollback; pass coupon calculation/review using an actual finalized disposable-validator snapshot.
   - [x] Prepare the persistent owner coupon: 500/1000/250 KZT-Test, total 1750, three eligible synthetic Localnet holders, UNDER_REVIEW. No payment/burn/signature or approval is performed by preparation.
   - [ ] Obtain the owner's explicit decision on this stored calculation and complete persistent approval/Auditor presentation acceptance.
8. **Coupon settlement**
   - [x] Implement Localnet whole-coupon budget and exact deficit funding API/UI, saved-attempt recovery, issuer/Origin controls, Token-2022 validation and policy SOL reserve. See [feature](../features/coupon-funding.md) and [ADR-018](../decisions/ADR-018-localnet-coupon-funding.md).
   - [x] Pass isolated real-validator/HTTP/PostgreSQL 1750 KZT-Test funding: exact message/token delta, concurrency, prepare/confirm audit rollback, replay/resume and no approval/payment.
   - [x] Apply migration 18 and prepare the owner's unsigned 1750 funding plan on the preserved ledger/database; independent exact-wire/budget/audit verification passed.
   - [ ] Owner signs funding in Phantom; verify finalized token delta/current treasury and atomic database/audit confirmation.
    - [x] Implement feature-flagged Localnet entitlement REGISTER/FINALIZE API/UI with exact prepared-wire signing, finalized PDA/counter/total reconciliation, atomic audit and an approval gate. Candidate runtime passed; owner program upgrade and owner registration remain separate pending gates.
    - [x] Implement and accept isolated partial-registration recovery: exact complete-set RESET closes only pre-review entitlement PDAs, preserves snapshot, clears counters, prevents phase races and permits exact re-registration.
    - [x] Prepare and disposable-test the [owner upgrade package](owner-localnet-program-upgrade.md): exact deployed/candidate hashes, ProgramData/authority, old→new loader transition, existing-PDA byte preservation, rollback limits and post-upgrade checks.
    - [ ] Review a Phantom-compatible signing procedure, then upgrade the retained owner program and complete owner REGISTER/RESET/FINALIZE acceptance without resetting its ledger/database or exporting the Phantom key.
    - [ ] Implement separate approver authority and repeat full-coupon budget plus execution rent/fees at that boundary. Application APPROVED alone cannot pay.
   - [ ] Implement coupon execution with an on-chain receipt, atomic payment/state update and replay prevention; verify real finalized recipient balances.
9. **Redemptions** — maturity and partial early redemption, atomic payment + burn + receipt, current source-balance checks, canonical rounding and replay protection. Transfers after snapshot must not cause payout without burn.
10. **Reconciliation and evidence** — Cash/Asset Legs, MATCHED conditions, verifiable JSON Action Receipt, provenance, timeline and Explorer links.
11. **Complete operator UI** — Administrator/Auditor boundaries, instrument/action/detail routes, errors/loading/empty states and controlled signing; no investor cabinet or production custody scope expansion.
12. **Acceptance and submission** — coupon/maturity/early-redemption end-to-end demo, full CI, clean setup, negative/security/recovery checks, synchronized docs and demo materials.

## Current next action

2026-10-08: exact entitlement REGISTER/FINALIZE API and dashboard integration is implemented behind a fail-closed Localnet feature flag. It validates corporate action authority, stored snapshot/calculation facts, exact wallet bytes and finalized PDA/counters/totals; approval is gated when enabled. Owner program upgrade/registration, approver authority, reserve and execution remain open. Owner funding signature is still explicitly deferred.

Stages 5 and 6's live happy paths are accepted for persistent LKA26R1: ACTIVE 35/35, holders 10/20/5, new action `464a832a-2c55-4e22-bb7a-6be93b429c78`, exact finalized SCHEDULE/REGISTER_SNAPSHOT messages and immutable snapshot/PDA commitment. The old `09d229a4…` missed-window action is preserved. Stage 7 passed isolated acceptance; the owner coupon remains UNDER_REVIEW with total 1750 KZT-Test. Stage 8 budget/funding passed isolated acceptance and the owner's unsigned funding plan is ready for Phantom. Funding and the explicit calculation decision are separate gates. Next engineering step is reviewed on-chain coupon execution/receipt with its own budget checks. See [live evidence](../testing/localnet-action-acceptance.md), [entitlements](../features/entitlements-and-review.md) and [funding](../features/coupon-funding.md). No investor payment/burn/receipt exists yet. Manual negative cases and publication remain. Public funding, authority assignment and Devnet deployment stay deferred.

## Preflight usage and limits

Run `npm run devnet:preflight` from the repository root. The command builds the existing Solana client and reads only the public [Devnet plan](devnet-plan.json), then performs `getGenesisHash`, finalized `getBalance` and finalized `getAccountInfo`. It accepts no key paths or transaction arguments. It rejects another network, malformed responses, conflated identities and an occupied program address. Transport errors remain failures, not account-absence evidence.

The underlying checker exits 2 when funding is required, 1 on validation/RPC failure, and 0 when the narrow read-only checks pass; npm may propagate a generic nonzero exit. It always reports `deploymentAuthorized: false` and `transactionSubmitted: false`. It does not estimate deploy fees, validate a backup, verify compiled program-ID alignment, assign/check an actual on-chain upgrade authority, configure the API RPC or authorize a deployment. Observed slots need not match and do not form an atomic chain snapshot. Re-run immediately before any reviewed transaction.

Production/mainnet, real KYC/bank/KASE integration, legal issuance, multisig governance and external audit remain separate post-MVP gates, not deliverables silently included in this demo list.

## Combined continuation plan (owner attachment + audit)

| Order | Deliverable and completion gate | Current status |
| --- | --- | --- |
| 0 | Audit repository/specs/tests, GitHub/Render and preserved owner checkpoint; distinguish fixture/runtime/owner evidence | Audit completed; refresh evidence for each stage |
| 1 | Fix deployable dependency gate and unsigned funding recovery; restore/backup owner environment | Code/checks and DB restore complete; Phantom recovery acceptance pending; isolated legacy tool advisories remain |
| 2 | Entitlement PDA + full calculation reconciliation; exact-message API/UI preparation/confirmation and safe recovery | Program/client/API/UI and pre-review RESET pass disposable-validator acceptance; owner upgrade package and old→new dry-run complete; Phantom signing procedure and live owner acceptance pending |
| 3 | Explicit approver authority and action-specific funded reserve; separate calculation/review/funding facts | Pending; must precede payout. An issuer treasury balance cannot fund two open actions simultaneously |
| 4 | Coupon: 500/1000/250, three finalized exact payments, no burn, atomic record/counters and replay denial | Pending; owner funding signature also deferred |
| 5 | Maturity: current source balances, atomic payment/full burn, supply 0, REDEEMED only after all records | Pending; accelerated disposable demo needed; preserve existing dates/ledger |
| 6 | Early: 20% integer floor, burn 2/4/1 and supply 28, explicit zero rounding, atomic payment/partial burn | Pending; independent three-action demos plus sequential lifecycle must both be reproducible |
| 7 | Cash/Asset Legs, mismatch handling, reconciliation, finalization, canonical downloadable JSON receipt + on-chain hash/PDA | Pending; mismatch/incomplete processing must block FINALIZED |
| 8 | Durable execution attempts/jobs, same-signature unknown recovery, restart/reindex, audit rollback and concurrent-attempt gates | Pending; no blind resend or false finalized label |
| 9 | Dashboard/Instruments/Investors/Corporate Actions/Audit & Evidence routes; selectable objects, detail timeline, balances, signatures/Explorer/JSON, role/error/loading/empty states | Existing panels partial; new workflow/detail routes pending |
| 10 | Registry search/detail/update/close, eligibility correction/suspension and temporary wallet block with immutable history | Pending beyond existing ownership/demo-review/revoke flows |
| 11 | Real on-chain transfer policy and issuer/compliance/CA/approver/upgrade roles; bounded multi-wallet burn legs | Pending. Existing LKA26R1 cannot regain revoked freeze authority; new controlled-transfer demo uses a separate compatible mint. Minimum CA registration authority exists in candidate |
| 12 | Browser Administrator/Auditor acceptance, refresh/direct URL, no console errors, negative mint/receiver/reserve/balance/pay-burn/replay tests | Existing accepted gates retained; new end-to-end gates pending |
| 13 | Safe `demo:reset`, `demo:seed`, `demo:validate`, canonical identities/35 supply/10–20–5/three actions/funding/genesis; clean setup and restore | Pending; reset must target a separately owned disposable environment, never the retained owner ledger/database |
| 14 | Metrics/RPC degraded status/p95, SBF/runtime + secret/dependency CI, recoverable release; review/publish current changes and verify actual GitHub CI plus Render revision/config/routes | In progress; pre-publication baseline was 112bdb1 and Render health alone is insufficient. See the current audit and deployment record |
| 15 | Public Devnet after complete Localnet acceptance: reviewed binary/authorities/funding/upgrade and all mint/PDA/payment/burn/receipt signatures + Explorer evidence | Deferred under ADR-014; mainnet/real money excluded |
| 16 | P2: UX polish, current primary-source CMTAT/IncomeVault/Polymesh/ERC-3643/Tokeny/DTCC/Securitize comparison, capability gap file, threat model, README/demo video/guide, SECURITY/CONTRIBUTING and pilot roadmap | After P0. Choose LICENSE explicitly before publication; do not invent licensing intent or claim official compliance/integration |

Per financial gate preserve signer/network/genesis, exact transaction, finalized slot, expected/actual accounts and amounts, atomic DB/audit result and reconciliation. Fixture tests remain useful but cannot close real-validator or owner Phantom acceptance. Security/authority/reserve prerequisites must be completed before the related payout even where the attached plan labels them P1. Necessary stage documentation is updated with implementation; broad P2 research/polish stays deferred.
