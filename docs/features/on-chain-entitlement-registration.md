# On-chain entitlement registration

The program candidate was implemented on 2026-10-07, the guarded API/dashboard workflow was added on 2026-10-08, and the retained owner program was upgraded to the pinned candidate on 2026-10-09 with preserved-account read-back. The capability defaults to disabled. In the explicitly enabled owner Localnet, partial REGISTER → RESET → all three REGISTER are accepted; FINALIZE expired during signing and is retained UNKNOWN_CONFIRMATION for checking at the owner's request. See [the owner record](../testing/owner-entitlements-2026-10-09.md). Application calculation/review and its stored snapshot remain governed by [ADR-017](../decisions/ADR-017-stored-entitlements-and-demo-approval.md). See [ADR-019](../decisions/ADR-019-on-chain-calculation-registration.md) for the new boundary.

## Flow and accounts

`register_entitlement` creates `["entitlement", action PDA, investor UUID bytes]`. The program stores the immutable snapshot hash, one investor's aggregated snapshot balance, settlement wallet, exact integer payment/redemption amounts and initial status. Only the instrument's corporate action authority can sign; the instrument must be ACTIVE and the action SNAPSHOT_CREATED or CALCULATED. Each UUID can be registered once. Account creation, counter increment and total update occur in one transaction.

Coupon, maturity including final coupon, and early-redemption formulas use the existing checked Rust integer functions. An eligible recipient must be nonzero. Ineligible investors retain a coverage row with zero payable/redeemable amounts; their recipient may be the zero public key when none is available. Early-redemption floor rounding to zero produces NOT_ELIGIBLE_ZERO_ROUNDING. READY denotes a calculated row, **not payment authorization**.

`finalize_calculation` requires CALCULATED, registered count equal to snapshot investor count, and the complete unique set of canonical entitlement PDAs. It checks program ownership, discriminator, version, action/hash/bumps, initial statuses, no execution timestamp, snapshot balance sum and payment sum. It changes the action to UNDER_REVIEW. It cannot approve, reserve funds, transfer or burn tokens. Another registration or finalization after UNDER_REVIEW is rejected.

`reset_calculation` is the bounded recovery path before UNDER_REVIEW. It requires the complete unique set represented by the Action PDA counters, verifies every canonical program-owned row and their exact payment sum, closes those accounts to the corporate action authority, zeros the calculation counters and returns the Action PDA to SNAPSHOT_CREATED. A subset, duplicate, foreign row, executed row, wrong authority, wrong sum, replay or reset after finalization fails atomically. The immutable snapshot remains unchanged.

The protocol bound is 1–64 investors; the practical transaction limit is smaller. The existing unsigned v0 serializer rejects wires exceeding Solana's transaction size before signing. The three-investor demo fits without lookup tables. A future paginated commitment design requires its own review rather than increasing the limit silently.

## Trust and failure boundaries

The CA authority certifies the mapping of investor UUIDs, balances, receiver and eligibility to the canonical snapshot. The on-chain hash is a commitment, **not a Merkle membership proof**: unique IDs and reconciled totals do not independently prove registry identity, KYC or ownership of every row. The backend must reconstruct and validate the stored snapshot and current recipient eligibility before preparation and again at approval/execution.

An individual registration is immutable. A confirmed partial set can be closed only through the complete pre-review reset above; individual editing and selective deletion remain forbidden. A complete set with an incorrect total balance cannot reach UNDER_REVIEW. Approval authority, execution fields/receipts, multi-wallet burn sources and reserve lifecycle remain subsequent work. The retained owner upgrade, RESET and three registrations are accepted; the expired signed FINALIZE remains a separate unresolved attempt. No automatic expired-signed-attempt closure is implemented. The owner's explicitly approved one-time RESET reconciliation is recorded separately and does not authorize closing other attempts.

Existing Instrument and CorporateAction field layouts and enum indices 0–2 remain unchanged. CALCULATED=3 and UNDER_REVIEW=4 are appended. The client decoder recognizes all five. Existing schedule/snapshot instructions still require issuer authority; **full authority separation is not completed**.

## API and operator workflow

Set `ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED=true` only in a reviewed Localnet environment whose deployed program supports these instructions. Missing or `false` disables the capability; any other value fails closed. The routes are:

- `POST /api/v1/corporate-actions/:id/entitlements/onchain/prepare`
- `POST /api/v1/corporate-actions/:id/entitlements/onchain/submit`
- `POST /api/v1/corporate-actions/:id/entitlements/onchain/confirm`

The prepare body is `{phase:"REGISTER",version,entitlementId}`, `{phase:"FINALIZE",version}` or `{phase:"RESET",version}`. The API requires an Administrator session whose wallet is the instrument's corporate action authority, exact Localnet genesis/program/snapshot identity, an ACTIVE instrument and the stored UNDER_REVIEW calculation reconstructed from the finalized snapshot. REGISTER reconciles Action PDA counters with confirmed database PDAs. FINALIZE requires every entitlement PDA and exact count/total agreement. RESET requires at least one confirmed canonical PDA and exact partial count/total agreement. Active RESET/FINALIZE and registration operations cannot race.

Preparation persists one blockhash-bound unsigned v0 wire and audit event without changing application state. Localnet submit accepts only an Ed25519 signature over those exact bytes. Confirmation requires `finalized`, compares the exact wire, reads the program-owned Entitlement and Action PDAs at the confirmed slot, and atomically writes the PDA/operation/audit projection. Signed or unknown attempts remain confirmation-only. Application APPROVE is blocked while the feature is enabled until `CALCULATION_FINALIZE` is finalized.

The dashboard independently verifies action/version, CA signer, snapshot hash, PDA facts, amounts/counts and the unsigned fee payer before opening Phantom. It registers rows one at a time, exposes finalization only after all rows have confirmed PDAs, and exposes RESET only when a partial confirmed set exists. The workflow never stores a private key and cannot approve, fund or pay the action.

## Client and verification

The 2026-10-09 owner browser preparation exposed an audit persistence defect: REGISTER preparation and calculation confirmation passed an `entitlementId` field absent from the `AuditLog` model. Prisma rejected the insert and the preparation transaction rolled back before any wallet signature. Both writes now use the existing entity type/ID and blockchain-transaction link; REGISTER preparation metadata also retains the entitlement ID. No schema migration is required.

The generated PostgreSQL action suite includes `scripts/test-onchain-entitlements-flow.mjs`. It checks REGISTER → RESET → all three REGISTER → FINALIZE with genuinely signed test wires and controlled RPC responses, persisted preparation/submission/confirmation audit links, confirmation idempotency, unchanged snapshot, and audit-failure rollback followed by recovery using the same signature. Run `npm run test:actions:database` against the documented disposable-database base URL. This regression passed after reproducing the original Prisma failure; synthetic RPC evidence does not close the owner's Phantom acceptance.

The production client exports `deriveEntitlementAddress`, `buildEntitlementRegistration`, `buildCalculationFinalization`, `buildCalculationReset` and `decodeConfirmedEntitlement`. Builders return public instruction plans; they neither sign nor submit. They validate UUIDs/hash, u64 bounds, duplicate IDs, eligibility amounts and eligible receiver before serialization. The decoder is used during finalized server read-back.

Build the Localnet candidate without replacing accepted artifacts:

```bash
bash scripts/build-localnet-candidate.sh
```

Run this under the non-root WSL development account with Anchor/Solana installed. Outputs are ignored `generated/localnet-candidate/lifecycle_kase.so` and its IDL. An existing output directory is refused. The build does not use a wallet or send an upgrade transaction. The retained `target/deploy` and owner ledger remain intact.

```powershell
npm test --workspace @lifecycle-kase/solana-client
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-initialize-instrument.ps1 -WslUser lifecycle-dev -Profile localnet-candidate
```

The disposable validator suite compares production instruction bytes/accounts with Anchor, submits the actual v0 wires, verifies exact finalized messages and reads the resulting PDAs. Candidate cases cover 500/1000/250 (1750 total), wrong authority/hash/amount, duplicate registration, incomplete count, duplicate/foreign accounts, finalization replay, distinct CA authority and 34/35 balance coverage. All 35 groups passed without skips on 2026-10-07. Older retained artifacts explicitly skip this candidate block; a SKIP does not prove its acceptance. Runtime results are recorded in [the stage report](../testing/delivery-stage-2026-10-07.md).
