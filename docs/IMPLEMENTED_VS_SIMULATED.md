# Implementation status

Last verified: 2026-10-01 (local checks and public operator challenge boundary; real-wallet login and Devnet acceptance pending)

This is a repository status, not a claim that the full MVP or a production financial workflow is operational.

| Area | Current status | Evidence / limit |
|---|---|---|
| Web and HTTP service | Next.js dashboard with same-origin Wallet Standard login and administrator Devnet snapshot review/sign/send/confirm/recovery UI; NestJS health, rate-limited authentication, snapshot routes, and audited first-operator CLI | Authentication remains default-off; one operator was provisioned and login explicitly enabled in disposable staging. Real wallet acceptance is pending; limiter is process-local and proxy egress can group clients; broader admin/auditor workflows remain pending |
| Public staging | Render Blueprint deployed in separate Hobby workspace with two free Node services and disposable PostgreSQL | Both services verified Live at `fd6cb81` on 2026-10-01; health and challenge/unauthenticated-denial boundaries passed, not real signed login. Free DB is not durable and no real data is permitted. See [deployment record](deployment/render-staging.md) |
| Devnet program preparation | Separate Cargo/Anchor identity profile, isolated SBF/IDL build, public plan and artifact hash/identity gate implemented | Both host Rust profiles pass 8 tests each; Devnet build verified locally, not deployed or runtime-accepted. Backup, funding and local end-to-end rerun remain pending. See [build procedure](deployment/devnet-build.md) |
| Investor identity, wallet mapping, approvals, legs, receipts | Schema and PostgreSQL migration implemented | Database guards run locally; no domain API or UI flows yet |
| Snapshot-v2, investor aggregation, eligibility and leg reconciliation | Pure TypeScript contracts plus authenticated prepare/finalized-confirm API and Devnet wallet UI implemented | Unit and fixture tests pass; local on-chain commitment instruction exists, but no real wallet/Devnet snapshot proof |
| Token-2022 holder collection | RPC collector and investor grouping implemented | Used by internal API candidate service; no live mint yet |
| Snapshot registration transaction flow | Administrator prepare records a blockhash-bound unsigned v0 attempt; UI reviews it and submits through a Devnet wallet; confirm verifies the exact finalized message, signer, successful result and Action PDA before atomically finalizing projections | Boundary/fixture and serializer compatibility tests pass, not live wallet acceptance. PostgreSQL integration and live-mint/live-RPC proof remain pending. Capture rejects a finalized slot before `record_at` or after capture; current-slot capture does not prove ownership at the earlier planned `record_at`. |
| Coupon, principal and early redemption math | Pure TypeScript functions implemented | Canonical KZT-Test minor-unit vectors tested; Rust parity pending |
| Corporate-action approval states | Transition contract implemented | Authentication, on-chain approval and audit writes pending |
| KZT-Test | Specified simulated settlement asset | SIMULATED ASSET. Not issued by the National Bank of Kazakhstan. Mint and transfers pending |
| Bond, Solana program, execution receipts | Instrument initialization/activation, action scheduling/cancellation and snapshot commitment implemented and local-validator tested; activation checks a 10/20/5 distribution against supply 35 | Snapshot API/UI is locally tested, but there is no application-side investor identity gate, payment/burn/receipt, separate administrator delegation, or Devnet deployment/signature proof |
| Transfer Hook, whitelist, freeze, role separation | Post-MVP options | Schema flags and role names do not enforce direct token transfers or permissions; after-snapshot transfers can make a redemption burn fail and must not be hidden by a payout. |
| Real KYC, bank settlement, digital tenge, KASE/CSD integration | Out of scope | No external integration or real-money claim |

The next product gate is real operator-wallet acceptance and a Devnet snapshot proof for the implemented API/UI, followed by authenticated Investor Registry management and a reviewed coupon execution vertical slice. The full MVP Definition of Done is in the [product requirements](requirements/PRODUCT_REQUIREMENTS.md).
