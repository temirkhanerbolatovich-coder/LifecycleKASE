# ADR-029: Versioned exact-target partial redemption

Status: Accepted for an isolated Localnet candidate. Date: 2026-10-12.

## Context

BondFlow section 8.3 requires a specified integer quantity to be redeemed completely. Historical `integer-entitlements-v1` actions independently floor each investor's percentage. Three balances of one token at one-third therefore lose the intended one-token redemption. Changing only the API conflicts with the program's legacy formula and changes historical commitments.

## Options considered

1. Change the old formula in place: rejected because stored calculations and deployed verification would disagree.
2. Persist a full allocation vector and upload it in phases: adds phases, duplicate state and packet limits.
3. Commit a small immutable target account and verify the full allocation during finalization: selected.

## Decision

New explicit-quantity early redemptions use `exact-target-largest-remainder-v2`. Existing actions default to `integer-entitlements-v1`; migration does not reinterpret them. `CorporateAction` and `Entitlement` retain their layouts and carry paired version 2. A 50-byte `ExactRedemptionTarget` account at `["redemption_target", action]` stores version, action, positive target and bump.

`create_exact_redemption_action` requires early redemption, no percentage, positive price/target and valid dates. `register_entitlement_v2` checks the snapshot, positive captured balance, eligibility, proportional floor/ceil bounds, payment equality and quantity bounds. Registration does not authorize execution.

`finalize_calculation_v2` reads the complete entitlement/source account set, verifies coverage and recomputes largest remainder. It awards leftover tokens by descending quota remainder, then ascending **ASCII base58 snapshot owner address**. An investor with several wallets uses the minimum owner address among its positive captured source accounts. The receiver chosen for payment never enters this order. Duplicate investor/tie keys are rejected. The program checks every allocation, the exact target and target-times-price before entering `UnderReview`.

Legacy register/finalize instructions reject version 2. Reset preserves the target. Existing reserve, distinct approver, atomic payment/burn and receipt instructions accept matching action/entitlement versions. API approval for v2 always requires the on-chain workflow; the historical off-chain approval fallback cannot approve v2.

## Consequences

- Historical calculations and v1 receipt JSON/hashes remain reproducible.
- Exact totals and allocation rank are enforced in TypeScript and Solana.
- No allocation upload phase or duplicated full vector is needed.
- API, client, migration and candidate program must be rolled out together. Old programs lack the instructions. The exact-target flag defaults to false and requires calculation/approval/redemption flags.
- Percentage conversion is a separate domain preview helper; v2 scheduling accepts an explicit quantity only.

## Risks and future work

Existing finalized current-slot snapshots and holder transfers remain in effect. Source/supply checks fail safely when the committed atomic burn cannot be proved. This change does not implement controlled transfers, capture locking, historical record-date reconstruction or public Devnet acceptance.

The inherited 64-investor logical ceiling is not a transaction capacity guarantee. Full-account finalization must fit the 1232-byte packet limit; oversized plans fail before signing. Larger registries need a separate scalable commitment/finalization design. Target PDAs remain after cancellation/reset and consume rent. Public deployment and owner-state migration need their own verified rollout.
