# Remaining delivery checklist

Reviewed: 2026-10-01. This is a work plan, not proof of completed MVP functionality.
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
4. **Investor Registry** — list/create, pending localnet wallet attachment and exact Ed25519 wallet-ownership activation, Administrator writes/Auditor reads and atomic audit implemented locally. Real HTTP/PostgreSQL acceptance passed, including proof replay rejection, concurrency, rollback, audit immutability, network guards and logout. Owner confirmed the local two-account Phantom login, form creation/attachment, account switch and ownership-signing flow. Auditor presentation, update/close, eligibility, revocation and revocation-time snapshot consistency remain pending. See [feature limits](../features/investor-registry.md). No real personal/KYC data.
5. **Instrument setup** — create test Token-2022 bond and KZT-Test mints, approved authority/PDA settings, synthetic wallet distribution 10/20/5 and wallet-signed instrument initialization/activation. Verify finalized chain/database projections. The current UI does not initialize instruments.
6. **Actions and snapshot** — action creation/scheduling UI/API, future record window, real Phantom snapshot registration, finalized confirmation, idempotency and lost-response/reload recovery. Show planned record time separately from effective capture slot/time.
7. **Entitlements and approvals** — Rust/TypeScript calculation parity, eligibility, review/approve/reject/revision, stored author/approver and immutable audit; enforce approval before execution.
8. **Coupon settlement** — test funding, on-chain execution receipt, atomic state update and replay prevention; verify actual finalized balances instead of UI-only status.
9. **Redemptions** — maturity and partial early redemption, atomic payment + burn + receipt, current source-balance checks, canonical rounding and replay protection. Transfers after snapshot must not cause payout without burn.
10. **Reconciliation and evidence** — Cash/Asset Legs, MATCHED conditions, verifiable JSON Action Receipt, provenance, timeline and Explorer links.
11. **Complete operator UI** — Administrator/Auditor boundaries, instrument/action/detail routes, errors/loading/empty states and controlled signing; no investor cabinet or production custody scope expansion.
12. **Acceptance and submission** — coupon/maturity/early-redemption end-to-end demo, full CI, clean setup, negative/security/recovery checks, synchronized docs and demo materials.

## Current next action

Stage 2's isolated build/local runtime acceptance is complete. Backup decryption/matching is owner-reported; offline storage remains unconfirmed. Public funding, authority assignment and network deployment are deferred, not completed. Local registry HTTP/PostgreSQL acceptance, including wallet ownership proof, and owner-reported Phantom profile/panel display passed on 2026-10-01. Next: manually accept browser wallet signing, then implement eligibility and revocation with snapshot-window consistency. Local HTTP logout is tested; no staging logout acceptance is claimed. Snapshot HTTP/UI still require explicit localnet adaptation.

## Preflight usage and limits

Run `npm run devnet:preflight` from the repository root. The command builds the existing Solana client and reads only the public [Devnet plan](devnet-plan.json), then performs `getGenesisHash`, finalized `getBalance` and finalized `getAccountInfo`. It accepts no key paths or transaction arguments. It rejects another network, malformed responses, conflated identities and an occupied program address. Transport errors remain failures, not account-absence evidence.

The underlying checker exits 2 when funding is required, 1 on validation/RPC failure, and 0 when the narrow read-only checks pass; npm may propagate a generic nonzero exit. It always reports `deploymentAuthorized: false` and `transactionSubmitted: false`. It does not estimate deploy fees, validate a backup, verify compiled program-ID alignment, assign/check an actual on-chain upgrade authority, configure the API RPC or authorize a deployment. Observed slots need not match and do not form an atomic chain snapshot. Re-run immediately before any reviewed transaction.

Production/mainnet, real KYC/bank/KASE integration, legal issuance, multisig governance and external audit remain separate post-MVP gates, not deliverables silently included in this demo list.
