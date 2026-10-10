# ADR-023: Separate action approver and custody reserve

Status: Accepted for the isolated Localnet candidate; owner rollout pending.
Date: 2026-10-09.

## Context

Application APPROVED and an issuer treasury balance do not reserve funds. Two coupons could otherwise claim the same tokens. A separate approver must accept the committed snapshot/calculation after the entire coupon budget is secured. The retained owner Instrument/Action layout, ledger, snapshot and unresolved FINALIZE must be preserved.

## Options considered

- Keep an application flag and treasury preflight: no enforceable custody or independent chain authority.
- Expand existing Instrument/Action accounts: requires migration of retained accounts and adds upgrade risk.
- Add an immutable approval policy and per-action reserve/vault PDAs: enforces authority and custody without reallocating retained accounts.

## Decision and reasoning

Use `approval-policy` keyed by Instrument, `action-reserve` keyed by Action, and a Token-2022 `action-vault` keyed by Action whose authority is the reserve PDA. The issuer assigns a nonzero approver distinct from issuer and CA authority once. HTTP additionally requires an active verified Localnet Administrator mapping.

Separate one-signature transactions assign authority, reserve the complete calculated amount, return an unapproved reserve, and approve. RESERVE changes chain UNDER_REVIEW → RESERVED; RELEASE returns the entire balance, closes reserve/vault to the issuer and restores UNDER_REVIEW; APPROVE changes RESERVED → APPROVED and records the approver/time. Appended enum values preserve existing account sizes and prior status encodings. A funded action cannot use the existing calculation reset.

Only plain initialized six-decimal Token-2022 settlement mints without freeze authority/extensions are supported. Extensions such as transfer fees or permanent delegation complicate exact, exclusive custody. Revoked mint authority is compatible with custody/refund; existing simulated treasury minting has its own stricter issuer-authority rule.

Use existing durable BlockchainTransaction attempts and append-only audit, without another relational reserve model or migration. The actual PDAs and finalized token history prove custody. Exact successful finalized approval, DB APPROVED/READY and audit commit in one serializable database transaction. Current eligibility is checked before new funding/approval; confirmation/refund checks the committed calculation so later suspension or revocation cannot erase chain evidence or trap an unapproved refund. Future execution still requires current eligibility.

## Consequences and risks

- An issuer signature cannot withdraw from the vault or approve; another action cannot reuse its reserve. Program upgrade governance remains a separate trust boundary.
- SOL policy is a minimum available-balance check, **not SOL escrow**. API preflight includes exact current phase fee/creation rent, missing receiver ATA rent, estimated one-signature execution base fees and a policy buffer. It does not guarantee future priority fees, persistent SOL availability or execution.
- Policy is immutable in this slice. Lost/revoked approver cannot approve; issuer can release an unapproved reserve. After approval, payout, surplus cleanup, policy rotation and cancellation require later reviewed instructions. No automatic unlock exists.
- The feature defaults off and is Localnet-only. It requires a reviewed candidate exposing all four instructions. Disabling the flag cannot bypass persisted policy/history through legacy application review.
- The accepted owner artifact/manifest is unchanged. Installing the new candidate on that ledger is a separate governed upgrade and owner acceptance gate.

## Future work

Implement per-entitlement atomic coupon payment, receipt and counter/state reconciliation using this action vault. Repeat current eligibility/SOL/rent checks at execution; define funded-action rejection, approved surplus cleanup, approver rotation and recovery before broader deployment. Redemptions remain separate payment+burn work.

See [feature](../features/action-approval-and-reserve.md) and [acceptance](../testing/action-approval-reserve-2026-10-09.md).
