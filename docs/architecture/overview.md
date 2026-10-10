# Architecture overview

Current environment availability and fresh-versus-historical evidence are recorded in the [October 10 audit](../PROJECT_AUDIT_2026-10-10.md).

Status: retained issuance/snapshot/registration history; isolated approval/reserve/coupon/receipt candidate; owner and redemption acceptance pending
Last updated: 2026-10-10

## Components

The [administrator Telegram watchdog](../features/telegram-monitoring.md) runs in a separate Node process. It reads public API/web health, owner Localnet RPC identity/finalized progress, and optional loopback read-only database aggregates, then sends hourly and incident/recovery messages to a configured administrator chat. It has no application signing/session authority, writes only ignored delivery state, and distinguishes staging health from owner execution. Initial receipt was confirmed on 2026-10-08; supervised startup and successful live owner dependency/aggregate acceptance remain pending. See [ADR-020](../decisions/ADR-020-independent-telegram-monitor.md).

| Component | Responsibility | Trust boundary |
|---|---|---|
| Next.js web | Status dashboard, Wallet Standard login, registries, phased issuance, action/snapshot and entitlement/review UI; fixed same-origin rewrite allowlist | Browser is untrusted; web server transports cookies; no private-key custody. Persistent owner issuance/snapshot accepted; payment and separate Auditor entitlement presentation remain pending |
| API package | Operator authentication, audited registries, administrator-only transaction preparation, exact Localnet broadcast/finalized reconciliation, stored investor calculations and explicit versioned review; NestJS health | Trusted application service; atomic actor audit and approval/current-eligibility execution gate; never holds administrator private keys |
| Domain package | Deterministic calculations and state rules | Pure logic with no network or persistence side effects |
| Solana client package | Token-2022 mint setup, canonical 10/20/5 distribution and holder collection, instruction/transaction serialization, exact signed-message verification and account decoding | Converts finalized chain data into validated mint, treasury, holder and confirmation evidence |
| Anchor program | Issuance/activation, scheduling/cancellation, immutable snapshot, entitlement registration/reset/finalization; newer candidate adds approval policy, vault reserve and atomic coupon receipts | Registration candidate has historical owner acceptance. Approval/coupon candidate is isolated and default-off; redemption execution and public Devnet remain pending |
| Token-2022 | Bond ownership, transfers, burns, and total supply | Authoritative token ledger |
| PostgreSQL | Identity links, workflow orchestration, immutable snapshot payloads and read projections | Recoverable projection; not authoritative for chain facts |

## Primary data flow

1. The administrator starts a workflow in the web application.
2. The API validates permissions and current finalized on-chain state.
3. The API returns an unsigned transaction with expected accounts and constraints.
4. The administrator wallet signs the transaction. Devnet submission remains wallet-owned; for Localnet instrument/action/snapshot workflows the API verifies and broadcasts only the exact signed prepared bytes through its configured loopback RPC.
5. The API confirms the signature at `finalized`, reads the resulting accounts, and updates PostgreSQL projections.
6. Each implemented confirmation checks its expected accounts before atomically saving the projection and audit. Coupon Cash/Asset Leg reconciliation and canonical receipts are implemented in the isolated candidate. Redemption reconciliation, durable execution watchers and general reindex remain pending.

Snapshot construction is a special case: the API reads Token-2022 accounts at the current finalized slot, creates canonical JSON, computes SHA-256, persists the payload, and commits the hash and slot on-chain. Historical reconstruction is intentionally unsupported in the MVP.

The implemented collector reads all mint-filtered Token-2022 accounts at one finalized context slot, decodes the base prefix with extensions, and requires positive balances to sum to mint supply. Authenticated preparation/confirmation connects these facts to the commitment instruction. The browser derives its Wallet Standard chain from an explicit validated Localnet/Devnet plan. Both disposable-validator and persistent owner Phantom 10/20/5 snapshot happy paths are accepted; remaining manual variants are separate.

The API joins that collector with Prisma action and wallet mappings, checks the configured genesis hash and record-date window, and computes canonical snapshot-v2 bytes. Persistence revalidates state, versions and wallet mappings in a serializable transaction, then writes the canonical payload and child rows as `PENDING_REGISTRATION`. Preparation rebuilds the stored commitment, creates an unsigned v0 transaction and records a blockhash-bound attempt. Confirmation fetches the supplied signature at `finalized`, compares its complete message to that attempt, reads back the program-owned Action PDA, and atomically finalizes the transaction, snapshot and action projection. The wallet remains responsible for signing; Localnet uses exact verified API broadcast while Devnet uses wallet submission.

## Authority model

Instrument deployment uses four prepare/sign/finalize phases. `MINT_SETUP` derives mint addresses without private keys, prepares both Token-2022 mints plus treasury issuance/authority revocation and records exact unsigned bytes. `DISTRIBUTION` binds three verified eligible investor wallets to 10/20/5 and reconciles treasury/recipient balances. `INITIALIZE` reads the exact program-owned Instrument PDA before DEPLOYING. `ACTIVATE` rechecks registry eligibility and complete holder coverage, then requires an Active PDA before ACTIVE. Localnet verifies exact message/signer/Ed25519 signature before broadcast; every confirmation compares finalized bytes with the stored plan. The persistent LKA26R1 issuance and new coupon snapshot happy paths passed; payment/redemption acceptance remains pending.

The fixed-supply bond mint has zero decimals. Its mint and freeze authorities are absent after issuance. The Instrument Authority PDA is the Token-2022 permanent delegate intended for future program-controlled redemption instructions. A human administrator wallet authorizes corporate actions but never shares a private key with the API.

After finalized snapshot confirmation, the API rebuilds its immutable relational canonical hash and calculates one bigint entitlement per investor, with a verified current receiver and stored inputs/formula/eligibility versions. Serializable transactions save rows, action versions and audit together. Explicit review may approve/reject/return; revision preserves the original snapshot and entitlement IDs. Application review alone cannot authorize execution. The retained owner Action PDA was historically CALCULATED after three registrations; FINALIZE remains unresolved. The isolated approval/coupon candidate enforces separate authority, funded reserve, signer/replay/payment/receipt conditions and current receiver eligibility before unsigned preparation. Atomic redemption burn remains unfinished. See [entitlement flow](../features/entitlements-and-review.md) and [ADR-017](../decisions/ADR-017-stored-entitlements-and-demo-approval.md).

Explicitly authorized Localnet OS recovery validates the original authenticated preparation actor/current wallet and pinned loopback database/RPC before confirming an already signed snapshot or preparing calculations UNDER_REVIEW. Its audit distinguishes CONTROLLED_LOCALNET_CLI from HTTP. It cannot approve, sign, broadcast or pay and does not change HTTP session requirements.

The separate Localnet coupon funding service validates stored calculations, ACTIVE Instrument PDA, mint/treasury and issuer SOL at finalized. It persists exact deficit funding bytes; the issuer signs and the API verifies/broadcasts. Confirmation proves the exact treasury token delta, reads current state at or after that slot and atomically finalizes only the funding attempt/audit. The retained KZT-Test issuer mint authority funds simulated tokens through Token-2022; no new Anchor instruction or live program upgrade is required. One unresolved attempt per issuer is enforced by migration 18. Budget reserve is policy, not execution-fee proof or escrow. Authorized local recovery can prepare unsigned funding or confirm an already audited signed attempt. Registration and the isolated approval/reserve/coupon candidate have their own budget, custody and receipt checks; owner acceptance remains a separate gate. See [funding](../features/coupon-funding.md).

## Failure model

- A transaction is not treated as complete until finalized confirmation and account reconciliation succeed.
- Coupon execution is implemented in an isolated, default-off Localnet candidate: per-entitlement atomic transfer/state/receipt, finalized exact-wire/token-delta confirmation, serializable settlement/legs/audit projection and a separate canonical ActionReceipt hash commitment. Signed partial recovery checks the original signature. Redemption execution, general execution workers/reindex and retained owner acceptance remain pending. See [feature](../features/coupon-execution-and-receipts.md).
- Missing a record-date capture window blocks preparation and invokes a guarded application SNAPSHOT_MISSED check. Explicit issuer/Administrator POST can also classify the window. Finalized Clock expiry plus an unchanged scheduled Action PDA is required; action version/status and audit commit atomically. Stored snapshots and active attempts remain on the recovery path. Page reads do not write, no background sweeper or on-chain terminal instruction is claimed, and historical holder reconstruction is unsupported. See [behavior and limits](../features/corporate-actions.md#missed-snapshot-window).

The accepted decisions are indexed in [Architecture decisions](../decisions/README.md).

The isolated [approval/reserve candidate](../features/action-approval-and-reserve.md) adds an immutable instrument ApprovalPolicy, ActionReserve and PDA-owned Token-2022 vault without reallocating existing Instrument/Action accounts. Chain UNDER_REVIEW → RESERVED → APPROVED is separate from the database review state. Successful exact finalized approval and its application APPROVED/READY/actor/audit project atomically; the vault supplies the isolated coupon execution capability; owner reserve/payment acceptance remains open. Existing durable attempts carry recovery, so no additional reserve table/migration is introduced. See [ADR-023](../decisions/ADR-023-action-approval-and-custody-reserve.md).

The current relational model and its remaining migration-level guarantees are described in [Persistence architecture](persistence.md).

Detailed flows and proof limits are in [Data flow](data-flow.md); security controls and validation layers are in the [security model](../security/security-model.md) and [testing strategy](../testing/testing-strategy.md).
