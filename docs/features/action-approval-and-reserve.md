# Separate approver and action reserve

Implemented for a reviewed isolated Localnet candidate. Owner rollout remains pending; the retained owner FINALIZE stays UNKNOWN_CONFIRMATION for checking. This feature reserves simulated KZT-Test and records approval; it does not pay investors or burn bonds. SIMULATED ASSET. Not issued by the National Bank of Kazakhstan.

## Flow and components

The issuer submits the immutable stored coupon calculation, confirms each entitlement and CALCULATION_FINALIZE, and funds the issuer treasury through the existing [coupon funding](coupon-funding.md) flow. The separate approval panel then supports:

| Phase | Signer | Chain effect |
| --- | --- | --- |
| ASSIGN_APPROVER | Instrument issuer | Create immutable instrument policy for another verified Administrator, distinct from issuer and CA |
| RESERVE | Instrument issuer | Transfer exactly the complete coupon total treasury → action vault; UNDER_REVIEW → RESERVED |
| RELEASE | Instrument issuer | Before approval, return entire vault balance including unsolicited deposits; close vault/reserve and return rent; RESERVED → UNDER_REVIEW |
| APPROVE | Assigned approver | Check full funded reserve/commitment and minimum SOL; record approver/time; RESERVED → APPROVED |

The Rust program enforces signer, canonical PDA, mint, snapshot hash, complete count/amount, no execution and custody. Client builders/decoders provide exact Anchor bytes and fixed account layouts. API validates registry, current calculation, finalized chain state, network genesis and budget, persists the unsigned wire and audit, verifies the exact signed/finalized wire and reconciles token deltas. Finalized APPROVE atomically updates application APPROVED, positive entitlements READY, action version, actor/note/time, attempt and audit. No Cash/Asset Leg or execution receipt is created.

The browser allows Administrator writes for the relevant signer and Auditor reads. It checks the complete fixed v0 message: the two pinned compute-budget instructions, one phase instruction, all accounts/privileges, snapshot, amount, policy and signer. An explicit review checkbox precedes a Phantom request. A returned wallet signature survives an HTTP failure during the mounted workflow; persisted signed attempts restore on reload and are confirmation-only. Signature entry remains available for manual same-signature recovery.

## Configuration and HTTP

`ACTION_APPROVAL_RESERVE_ENABLED=false` by default. Enable only with `ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED=true`, Localnet configuration/genesis, authenticated operators and the reviewed candidate containing `assign_approver`, `fund_action_reserve`, `release_action_reserve`, `approve_action`. No new migration is needed; current project migrations still apply.

`COUPON_NETWORK_RESERVE_LAMPORTS` supplies the immutable policy's initial buffer (default 50000000; minimum 5000000). Subsequent phases use the policy's value. Prepare calculates the current phase fee, creation rent, and for APPROVE missing receiver ATA rent plus estimated one-signature base execution fees. Those amounts plus buffer must fit the signer balance. SOL remains in the signer wallet; this is preflight and an on-chain minimum-balance check, not custody of SOL or a future fee guarantee. Priority price is pinned to zero in the current transaction serializer.

Routes are authenticated, same-origin, no-store; mutations also require Administrator role, reviewed Origin and existing rate/maintenance guards:

- `GET /api/v1/corporate-actions/:id/approval`: chain policy/reserve/balances and latest active attempt; disabled feature returns `{enabled:false}`.
- `POST .../approval/prepare`: `{phase, version, approver? , note?}`; approver is required for assignment, note for approval. Amount, snapshot, accounts and signer are rebuilt server-side.
- `POST .../approval/submit`: `{operationId, signedTransactionBase64}`; exact prepared message/signature only, one broadcast invocation.
- `POST .../approval/confirm`: `{operationId, signature}`; exact finalized wire and current reconciled PDAs/token history before projection.

## Failure and recovery

Wrong genesis/authority, ineligible receiver, partial calculation, unfunded treasury, incomplete reserve, unsupported mint, insufficient SOL or changed version blocks new funding/approval. The existing reset cannot change a funded calculation. Direct issuer token transfer/close from the reserve vault fails because the reserve PDA owns it. A different action gets different reserve/vault addresses and must fund its own total.

Current receiver/operator suspension blocks new APPROVE. The API rechecks the assigned approver's active verified Administrator mapping before first submission of assignment, reserve and approval; a pause blocks these new phases. An unapproved RELEASE and finalized confirmation use the immutable committed calculation; a receiver suspension, approver revocation, mint-authority revocation or paused instrument does not prevent returning the issuer's reserve. Future execution gates remain strict about current eligibility. Approval history blocks legacy calculation/review mutations on that action. Once the instrument policy is assigned, legacy review decisions cannot bypass it even if the feature is disabled; other actions can still calculate and submit for review. Legacy funding cannot race or reinterpret a started action reserve.

Only an unsigned expired PREPARED attempt may become FAILED/BLOCKHASH_EXPIRED and be rebuilt. SUBMITTED/UNKNOWN_CONFIRMATION retains the original signature; resubmission, automatic closure and a new phase are blocked. Missing/pruned history does not prove absence. Re-enable the reviewed feature to recover signed attempts; use the same signer/operation/signature. If audit fails, the application projection rolls back while chain evidence remains recoverable through the original attempt. Idempotent finalized confirmation does not add another audit.

No automatic approval, funding, refund, payout, owner upgrade or attempt cleanup exists. Policy rotation, on-chain rejection, post-approval refund/surplus cleanup and redemptions remain unimplemented. Coupon execution and receipts are implemented in the separate default-off [October 10 candidate](coupon-execution-and-receipts.md); this approval-only checkpoint proves custody and approval. Losing the assigned approver after approval is a later recovery-design gate. The operator program upgrade authority remains a separate governance risk.

## Testing and rationale

[ADR-023](../decisions/ADR-023-action-approval-and-custody-reserve.md) records the custody/account compatibility decision. [2026-10-09 acceptance](../testing/action-approval-reserve-2026-10-09.md) separates fixture, real validator, browser and preserved owner evidence. See the [testing strategy](../testing/testing-strategy.md) for standard checks. The requirements document is unchanged.
