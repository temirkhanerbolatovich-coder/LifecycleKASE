# Redemption execution and receipts

## Scope

The Localnet candidate extends snapshot → calculation → approval → reserve → settlement → receipt to early/partial and maturity redemption. PAY transfers KZT-Test from the action vault and burns the committed investor bond tokens in the same transaction. KZT-Test and eligibility are simulated; Solana transfers, burns and receipts are actual isolated-validator operations.

`REDEMPTION_EXECUTION_ENABLED=false` is the default. Enabling requires `ACTION_APPROVAL_RESERVE_ENABLED=true`, finalized calculation and the reviewed redemption candidate on the configured Localnet genesis. It is independent of coupon enablement. Publishing source or passing isolated tests does not install the candidate on the retained owner program.

No database migration or changes to existing persisted account layouts are needed. New source/progress/redemption receipt PDAs carry the proof. See [ADR-025](../decisions/ADR-025-atomic-redemption.md).

## Cutoff and sources

The planned `record_at` opens the capture window. The demo ownership cutoff is the actual finalized capture slot/block time, not a reconstructed earlier timestamp. Planned and effective times remain distinct in UI/receipt. Later transfers do not recalculate entitlements.

Each REGISTER transaction also binds all positive investor token accounts, wallet owners and snapshot balances in a RedemptionSources PDA. Calculation finalization validates complete coverage and rejects duplicate sources across investors. This uses the existing trusted corporate-action authority; the program does not independently reconstruct historical ownership from a snapshot hash.

At most eight positive sources per investor are supported; transaction packet size can impose a lower practical bound. Serialization fails rather than omitting accounts. Investor-level floor rounding precedes greedy burn allocation across ascending base58 addresses. Sources allocated zero burn remain committed and reviewed.

## Execution and recovery

1. Prepare PAY after the finalized execution date: receiver eligibility, source commitment, full reserve, PermanentDelegate, actual balances, supply and SOL budget are checked.
2. Review amount, receiver, source wallets/accounts, each burn and supply before/after. The browser validates exact instructions, bytes, accounts and privileges.
3. Sign the saved wire explicitly. One broadcast atomically pays, burns, verifies deltas, marks the entitlement REDEEMED and creates its receipt.
4. Confirm the original finalized signature. Cash/source-token transaction history and receipt supply deltas precede a serializable database transaction saving required CONFIRMED cash/asset legs, MATCHED reconciliation, signatures, supply and audit.
5. After all positive rows are confirmed, prepare FINALIZE and review the canonical JSON/hash. Explicitly sign its on-chain commitment.
6. Finalization validates complete unique entitlements/receipts, totals, counts and supply. Maturity requires zero supply. Any completed redemption leaving zero supply retires the instrument; a partial action leaving bonds keeps it ACTIVE.

The progress PDA anchors snapshot supply minus cumulative burns. Another action or external burn changing supply blocks execution. Stored circulating supply updates use version and before-supply compare-and-swap. Later payments cannot bypass an unconfirmed earlier payment.

Transferred-away bonds cannot be replaced by burning another investor. Insufficient sources cause atomic failure with no payment, burn or progress. Changes after unsigned review require a fresh plan. Signed pending attempts remain confirmation-only. Lost history preserves UNKNOWN_CONFIRMATION; failed audit projection rolls back all projections and recovers by confirming the same signature.

## API compatibility

| Route under /api/v1/corporate-actions/:id | Purpose |
| --- | --- |
| GET /redemption-execution | Capability, totals, supply, sources and pending attempt |
| POST /redemption-execution/prepare | PAY or FINALIZE, version and idempotency key |
| POST /redemption-execution/submit | Exact saved signed wire, signer/role/Origin guards |
| POST /redemption-execution/confirm | Original signature and atomic reconciliation |
| GET /receipt | Canonical coupon or redemption JSON/SHA-256 |
| Existing /coupon/budget and /coupon/funding/* | Compatible demo funding for all types; redemption requires its own flag |
| Existing /approval/* | Separate approver and full action reserve for all types |

Legacy funding route names remain compatible; UI names the selected action. Auditors can inspect but cannot mutate. No route closes or resends a signed attempt automatically.

## Limits and validation

This is a three-holder Localnet candidate, not public-network, regulated-market or production acceptance. Mainnet, real fiat/KYC, Transfer Hook restrictions, historical reconstruction, workers and large-holder execution remain separate. Accelerated maturity is a disposable test instrument term; maturity includes principal plus final coupon under the existing formula. See [three-action acceptance](../testing/kase-three-actions-2026-10-10.md).
