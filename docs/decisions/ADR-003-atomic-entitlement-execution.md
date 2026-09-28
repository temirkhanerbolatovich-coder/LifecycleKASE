# ADR-003: Atomic per-entitlement execution

Status: Accepted
Date: 2026-09-28

## Context

Redemption requires a payment, a token burn, and an auditable receipt. Performing these as independent operations can pay without burning, burn without paying, or create duplicate execution during retries. A single transaction for every holder may exceed Solana account and compute limits.

## Options considered

1. Execute payment, burn, and receipt as separate transactions.
2. Execute the complete corporate action for all holders in one transaction.
3. Execute one atomic transaction per entitlement and aggregate action progress across entitlements.
4. Use an off-chain payment ledger and burn tokens separately.

## Decision

Execute each investor entitlement in one Solana transaction. The instruction validates the action, snapshot commitment, recipient, amounts, and prior execution state; transfers payment; burns tokens when required; and creates an immutable Execution Receipt PDA.

The receipt PDA is derived from the corporate-action address and stable Investor UUID, making replay protection enforceable on-chain. API idempotency keys and transaction-attempt records provide a second, off-chain retry boundary.

The corporate action supports partial progress across holders. Failed entitlements remain retryable, while already created receipt PDAs make completed entitlements no-ops or explicit duplicates rather than double payments.

## Reasoning

Per-entitlement atomicity preserves the critical payment-versus-burn invariant and fits Solana transaction constraints better than an all-holders transaction. On-chain receipt derivation protects against retries from any client, not only the API.

## Consequences

- An action can be partially complete and requires progress reporting.
- Finalization is allowed only after aggregate receipt reconciliation satisfies the action totals.
- Transaction fees and signatures scale with holder count.
- Coupon actions use the same receipt/idempotency model but omit token burn.

## Risks

- A payment treasury can become insufficient after some entitlements have executed.
- Account locking or congestion can delay individual holders.
- Incorrect PDA seeds or entitlement identity rules could create collisions or block retries.

## Future work

- Add safe batching when measured account and compute limits permit it.
- Define treasury reservation controls for larger actions.
- Benchmark compute units and priority-fee behavior before production use.
