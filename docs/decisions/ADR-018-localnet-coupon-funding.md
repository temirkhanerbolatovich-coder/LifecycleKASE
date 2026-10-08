# ADR-018: Exact wallet-signed Localnet coupon treasury funding

Status: Accepted
Date: 2026-10-03

## Context

The live instrument and snapshot are accepted and investor coupons are stored, but KZT-Test supply/treasury are zero. Funding must be distinguishable from approval/payment and must not mint twice after a lost wallet/API response. The current program has no execution/approval instructions; that upgrade cannot be represented by a UI status alone.

## Options considered

1. Seed balances directly in PostgreSQL or claim simulated transfers as execution.
2. Use retained issuer mint authority to fund its verified Token-2022 treasury with a separately reviewed exact wallet-signed instruction, finalized token-delta proof and audit.
3. Add program-controlled minting, escrow and the complete payout/receipt architecture in the same funding step.

## Decision

Use option 2 only on pinned Localnet simulated KZT-Test. Derive the issuer/mint ATA, read complete coupon obligations and finalized mint/treasury/SOL, and prepare only the deficit. Require existing immutable snapshot/calculation integrity and current eligibility. Use idempotent ATA creation and MintToChecked. Existing transaction transport/signature/finalization helpers and actor audit are reused; one unresolved funding attempt per issuer prevents competing deficit prompts. A new migration enforces exact prepared wire and that concurrency limit.

Confirm the complete prepared message and exact pre/post token balance delta, then record current treasury observations. Do not infer the delta from preparation-time balances, extend a wallet session, replace signed attempts, approve the action or mark any entitlement paid. Controlled OS preparation can save the unsigned plan with a distinct source; only the owner wallet signs.

## Reasoning

The issuer already retained KZT-Test mint authority. Existing transaction journals and integer calculations provide the necessary recovery boundary without a custody service or dependency. A policy SOL reserve plus actual funding rent/fee is useful now, while future execution must estimate its own costs and recheck funds immediately before on-chain approval/execution.

## Consequences

- Persistent issuance/snapshot and deployed program are unchanged; funding changes only KZT-Test on the owner's explicit signature.
- Funding preserves UNDER_REVIEW/application APPROVED and does not authorize payment.
- Repeated preparation/confirmation resumes the same signature; unsigned expired plans may refresh their blockhash before review/signing.
- An issuer can have only one unresolved funding prompt even across instruments, a conservative demo limit.
- BudgetReady means current simulated coupon funds plus funding/reserve policy, not program execution availability or escrow.

## Risks

Treasury can change after preflight. Mint authority remains with the issuer; direct wallet actions are outside API replay controls. RPC balance history may be missing, which blocks finalization rather than creating a replacement signature. Unknown extensions are rejected rather than guessed compatible. Application approval is not on-chain authorization and currently lacks the later full execution fee/rent/receipt checks.

## Future work

Implement on-chain entitlement registration/calculation/approval, full budget gate and atomic coupon transfer/receipt with replay prevention. Prepare and independently verify any persistent program upgrade under owner-controlled authority. Then add redemption burn/receipt and full reconciliation. Expand concurrency/custody only when a concrete multi-issuer deployment requires it.
