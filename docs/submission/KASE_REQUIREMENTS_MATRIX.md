# KASE side-track requirements matrix

Status captured: **2026-10-11**. Official source: [Superteam Kazakhstan × KASE — Corporate Actions on Blockchain](https://superteam.fun/earn/listing/superteam-kazakhstan-x-kase-side-track-corporate-actions-on-blockchain/).

The listing deadline is `2026-10-13T06:59:00.000Z`, which is **2026-10-13 11:59 Asia/Qyzylorda (UTC+5)**. At capture time the listing was open, showed seven submissions and marked submission access `HUMAN_ONLY`. The count and open status can change; the timestamp is the controlling deadline.

## Current requirement coverage

| Official requirement | Status | Current evidence | Boundary |
| --- | --- | --- | --- |
| Core flow: identify holders → calculate → execute/initiate → record on-chain | **Implemented on Localnet** | Verified-wallet registry, finalized holder snapshot, integer entitlements, settlement/redemption and ActionReceipt PDA hash commitment. See the [technical overview](TECHNICAL_OVERVIEW.md). | The validator and signers are disposable. This is not a public-network or retained-owner acceptance claim. |
| Core on-chain components on Solana | **Implemented on Localnet** | Anchor program, Solana transactions, Token-2022 transfers/burns, instrument/action/snapshot/receipt PDAs. | Localnet signatures cannot be opened in a public Explorer after ledger cleanup. |
| Test tokenized financial instrument | **Implemented** | Fixed 35-bond, zero-decimal Token-2022 mint; mint/freeze authority revoked; program instrument PDA is PermanentDelegate. | Test instrument only. |
| Holder registry | **Implemented with simulated eligibility** | Investors map to verified wallets; snapshot collection aggregates positive Token-2022 accounts and requires complete supply coverage. | Registry and eligibility fixtures are synthetic, not production KYC/CSD data. |
| Record-date mechanism | **Implemented with stated cutoff semantics** | `record_at` opens a maximum 300-second capture window; the immutable effective cutoff is the finalized snapshot slot/block time. A post-capture transfer did not change the coupon snapshot. | Historical ownership at an earlier planned timestamp is not reconstructed. Transfers during the open window can affect the finalized capture. |
| Entitlement calculation | **Implemented** | Checked integer minor-unit coupon, partial-redemption and maturity formulas are shared across TypeScript/Rust vectors and persisted per investor. | Division rounds down. Inputs use the test instrument's face value, rate and timing. |
| Coupon payment | **Implemented and executed** | Holdings 9/21/5 paid 450/1050/250 KZT-Test, total **1750**; supply remained 35. | KZT-Test funding is simulated; the Token-2022 transfers and receipts executed on-chain. |
| Bond redemption at maturity | **Implemented and executed** | Remaining 8/16/4 bonds paid 8400/16800/4200, total **29400** including final coupon; 28 burned; supply reached 0; instrument became `REDEEMED`. | Real fiat settlement and production custody are not integrated. |
| One additional corporate action | **Implemented: early/partial redemption** | 20% redemption paid 2000/4000/1000, total **7000**; 2/4/1 bonds burned atomically; supply 35 → 28. | The current program supports at most eight positive source token accounts for one investor in a redemption instruction. |
| Verifiable on-chain outcome | **Implemented** | Each action has finalized transaction evidence and a versioned canonical JSON receipt whose exact UTF-8 SHA-256 is committed to an ActionReceipt PDA. Redemption cash and burn legs share one signature and reconcile `MATCHED`. | Saved JSON preserves the disposable run; the removed ledger is reproducible with `npm run demo:verify`, not continuously queryable. |
| Working prototype | **Implemented and reproducible** | [Acceptance record](../testing/kase-three-actions-2026-10-10.md), [evidence JSON](../testing/evidence/kase-three-actions-2026-10-10.json), production builds and automated tests. | Docker Desktop and the documented Solana/WSL toolchain are required to rerun it. |
| Demo video | **Available** | [43.28-second English-captioned presentation](kase-three-actions-captioned.webm), unchanged [44.64-second recording](kase-three-actions.webm), [desktop screenshot](bond_redemption.png), [mobile screenshot](maturity-mobile.png). | Silent read-only Auditor tour after automated execution; it does not show the prepare → sign → confirm operator sequence. Captions clarify historical action supply versus current post-maturity supply. |
| Source repository | **Available at pinned revision** | [Commit `8c0f4f1`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/8c0f4f1d250c2e1acfb73c60f7e1143fba71e9b1) includes source, current package and captioned video; [PR #1](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/pull/1). | The repository default branch is older; submission must use the pinned commit unless the owner merges/publishes it. |
| Project website, optional form field | **Application staging available** | [Public dashboard](https://lifecyclekase-web.onrender.com/dashboard); both Render services Live at `bc62abfd947db6bc854624dccdcac61ec13036a3`, migration 19 and public health/protected routes verified on 2026-10-11. See the [deployment record](../deployment/render-staging.md). | Registered operator wallet required; no authenticated signing or financial execution rerun. Render cannot reach the owner's loopback validator. The Localnet badge does not establish a cloud chain connection. |
| Short technical overview | **Available** | [Technical overview](TECHNICAL_OVERVIEW.md). | Describes prototype boundaries rather than production readiness. |
| Main Colosseum registration | **User-confirmed** | Owner confirmed team registration on 2026-10-10; on 2026-10-11 confirmed registration/stages are complete but the project has not yet been submitted. | Main project submission remains. The current side-track answer is `No`; change to `Yes` and add public links after actual submission. |

## Judging evidence

| Criterion | Weight | What judges can inspect now | Material limitation |
| --- | ---: | --- | --- |
| Technical execution | 30% | Exact signed-wire validation, separate approval/reserve, atomic payment plus burn, replay protection, reconciliation, recovery, 320 Node tests and 18 unique Rust host tests in each profile. | CI does not start a live Solana validator; the saved Localnet acceptance is a separate reproducible run. |
| Corporate-action logic | 25% | All three required scenarios, immutable effective snapshots, deterministic integer formulas, funding/approval gates, token retirement and hash-committed receipts. | The effective cutoff is capture finalization, not historical reconstruction at the planned timestamp. |
| Product and UX | 20% | Responsive Administrator/Auditor terminal, role boundaries, action state, payouts, token effects, cutoff and receipt downloads; English-captioned result review. | Video shows the read-only result review and has no audio. The full prepare/sign/confirm sequence still needs a separate operator recording. |
| Real-world applicability | 15% | Separation of issuer, approver, operator and auditor concerns; PostgreSQL projection and append-only audit around Solana settlement. | No real KYC, fiat, digital tenge, KASE or CSD integration; scale and production operations are not accepted. |
| Innovation | 10% | Canonical off-chain receipt is byte-hashed on-chain; redemption payment and program-authorized burn are atomic and recoverable without replay. | Innovation claim is limited to the implemented prototype design. |

## Evidence index

- [Exact financial results and negative cases](../testing/kase-three-actions-2026-10-10.md)
- [Machine-readable run evidence](../testing/evidence/kase-three-actions-2026-10-10.json)
- [Coupon canonical receipt](../testing/evidence/coupon_payment-2026-10-10.json)
- [Early-redemption canonical receipt](../testing/evidence/early_redemption-2026-10-10.json)
- [Maturity canonical receipt](../testing/evidence/bond_redemption-2026-10-10.json)
- [Implemented versus simulated boundary](../IMPLEMENTED_VS_SIMULATED.md)

This matrix is the current submission view. Dated compliance and engineering documents remain valid only for the checkpoints they explicitly describe.
