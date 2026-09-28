# Implementation status

Last verified: 2026-09-28

This is a repository status, not a claim that the full MVP or a production financial workflow is operational.

| Area | Current status | Evidence / limit |
|---|---|---|
| Investor identity, wallet mapping, approvals, legs, receipts | Schema and PostgreSQL migration implemented | Database guards run locally; no API or UI flows yet |
| Snapshot-v2, investor aggregation, eligibility and leg reconciliation | Pure TypeScript domain functions implemented | Unit tests pass; RPC collection and on-chain commitments are pending |
| Coupon, principal and early redemption math | Pure TypeScript functions implemented | Canonical KZT-Test minor-unit vectors tested; Rust parity pending |
| Corporate-action approval states | Transition contract implemented | Authentication, on-chain approval and audit writes pending |
| KZT-Test | Specified simulated settlement asset | SIMULATED ASSET. Not issued by the National Bank of Kazakhstan. Mint and transfers pending |
| Bond, Solana program, execution receipts | Specified, not implemented | No deployed program, Devnet signature or end-to-end proof |
| Transfer Hook, whitelist, freeze, role separation | Post-MVP options | Schema flags and role names do not enforce direct token transfers or permissions |
| Real KYC, bank settlement, digital tenge, KASE/CSD integration | Out of scope | No external integration or real-money claim |

The next product gate is a working Investor Registry and snapshot path connected to Token-2022 accounts, followed by a reviewed coupon execution vertical slice. The full MVP Definition of Done is in the [product requirements](requirements/PRODUCT_REQUIREMENTS.md).
