# Redemption execution and receipts

Controlled instrument integration — **2026-10-12**: `CONTROLLED_FROZEN_V2` requires finished raw capture, per-entitlement assigned-unit reservations and program-authorized thaw/burn/refreeze. Finalization writes the action receipt and clears the active redemption gate atomically. New `redemption-controlled-action-receipt-v1` documents bind raw capture provenance, source commitments and consumed Holding/reservation counters; legacy schemas remain separate. Signed pending GET restores the original reviewed wire without requiring an emptied closed source to reappear, and historical receipt supply is checked against its captured supply minus that action's burns. See [controlled workflow](controlled-registry.md#integration-limits), [ADR-031](../decisions/ADR-031-controlled-workflow-integration.md) and [dated acceptance](../testing/controlled-workflow-integration-2026-10-12.md) for current default-off Localnet scope and limits.

Exact-target continuation — **2026-10-12**: [partial redemption v2](exact-target-redemption.md) adds an explicit positive quantity, immutable Target PDA and complete largest-remainder validation before reserve/approval. [ADR-029](../decisions/ADR-029-exact-target-redemption.md) preserves v1 action/entitlement layouts and historical calculations; migration **21** stores policy/target and freezes exact action terms. Existing atomic PAY, progress and finalization paths accept paired v2 action/entitlement versions. Fresh validation belongs in the [dated acceptance record](../testing/bondflow-exact-redemption-2026-10-12.md); the October 10 paragraphs below retain their historical candidate scope.

## Scope

The Localnet candidate extends snapshot → calculation → approval → reserve → settlement → receipt to early/partial and maturity redemption. PAY transfers KZT-Test from the action vault and burns the committed investor bond tokens in the same transaction. KZT-Test and eligibility are simulated; Solana transfers, burns and receipts are actual isolated-validator operations.

`REDEMPTION_EXECUTION_ENABLED=false` is the default. Enabling requires `ACTION_APPROVAL_RESERVE_ENABLED=true`, finalized calculation and the reviewed redemption candidate on the configured Localnet genesis. It is independent of coupon enablement. Publishing source or passing isolated tests does not install the candidate on the retained owner program.

The original **2026-10-10** redemption candidate needed no database migration or changes to existing persisted account layouts. New source/progress/redemption receipt PDAs carry its proof. See [ADR-025](../decisions/ADR-025-atomic-redemption.md). The v2 continuation adds migration 21 and its separate Target PDA while keeping those layouts intact.

## Cutoff and sources

The planned `record_at` opens the capture window. The demo ownership cutoff is the actual finalized capture slot/block time, not a reconstructed earlier timestamp. Planned and effective times remain distinct in UI/receipt. Later transfers do not recalculate entitlements.

Each REGISTER transaction also binds all positive investor token accounts, wallet owners and snapshot balances in a RedemptionSources PDA. Calculation finalization validates complete coverage and rejects duplicate sources across investors. This uses the existing trusted corporate-action authority; the program does not independently reconstruct historical ownership from a snapshot hash.

At most eight positive sources per investor are supported; transaction packet size can impose a lower practical bound. Serialization fails rather than omitting accounts. Legacy v1 uses investor-level percentage floor; v2 first allocates the exact global target using largest remainder and the investor's minimum positive captured source owner as an ASCII base58 tie. Both use greedy burn allocation across ascending source-account base58 addresses after the investor quantity is fixed. Sources allocated zero burn remain committed and reviewed.

## Execution and recovery

1. Prepare PAY after the finalized execution date: receiver eligibility, source commitment, full reserve, PermanentDelegate, actual balances, supply and SOL budget are checked.
2. Review amount, receiver, source wallets/accounts, each burn and supply before/after. The browser validates exact instructions, bytes, accounts and privileges.
3. Sign the saved wire explicitly. One broadcast atomically pays, burns, verifies deltas, marks the entitlement REDEEMED and creates its receipt.
4. Confirm the original finalized signature. Cash/source-token transaction history and receipt supply deltas precede a serializable database transaction saving required CONFIRMED cash/asset legs, MATCHED reconciliation, signatures, supply and audit.
5. After all positive rows are confirmed, prepare FINALIZE and review the canonical JSON/hash. Explicitly sign its on-chain commitment.
6. Finalization validates complete unique entitlements/receipts, totals, counts and supply. Maturity requires zero supply. Any completed redemption leaving zero supply retires the instrument; a partial action leaving bonds keeps it ACTIVE.

The progress PDA anchors snapshot supply minus cumulative burns. Another action or external burn changing supply blocks execution. Stored circulating supply updates use version and before-supply compare-and-swap. Later payments cannot bypass an unconfirmed earlier payment.

For v2, calculation finalization requires every row's assigned quantity to match the global target plan and every payment to equal quantity times the immutable price. Final redemption receipt validation checks cumulative burned quantity times that price against the approved action amount, in addition to progress, row totals and remaining mint supply. Zero-assigned investor rows remain part of coverage and require no PAY. Exact actions use canonical `redemption-action-receipt-v2`; legacy actions retain the v1 JSON/hash contract.

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

`EXACT_TARGET_REDEMPTION_ENABLED` defaults to `false` and requires on-chain registration, separate approval/reserve and redemption execution flags. V2 scheduling supports an explicit quantity only, with no percentage, and rejects the historical off-chain approval fallback. Enable it only with the reviewed candidate program on its configured Localnet genesis. Configuration, create-body fields and target read-back rules are in [the v2 feature contract](exact-target-redemption.md).

## Migration 21 rollout preflight

The new columns default all existing actions to `integer-entitlements-v1` with a null target. Correct legacy calculations remain unchanged. The replacement constraint requires non-null percentage and price for legacy EARLY_REDEMPTION: the old SQL CHECK could admit malformed rows through SQL NULL/UNKNOWN. Before migrating an existing database, inspect for early actions with null percentage/price and resolve them through a reviewed data-repair plan; do not silently reinterpret them as v2. Exact policy, target, type, instrument, dates and price are immutable from insertion. Fresh disposable migration results and owner/staging migration state are separate evidence.

## Limits and validation

This is a three-holder Localnet candidate, not public-network, regulated-market or production acceptance. The updated disposable harness checks four actions: coupon → legacy partial 20% → exact partial 8 → maturity, supply `35 → 28 → 20 → 0`. Exact allocation from `8/16/4` is `2/5/1`, while independent floor would assign only seven. It also rejects legacy v2 registration/finalization and a same-total wrong `3/4/1` plan, then resets without changing Target bytes. Performed results are tracked in [exact-target acceptance](../testing/bondflow-exact-redemption-2026-10-12.md); [October 10 three-action acceptance](../testing/kase-three-actions-2026-10-10.md) remains historical evidence.

The next protocol work is controlled transfers, enforceable capture and reservation of only assigned redemption units. Mainnet, real fiat/KYC, historical reconstruction, workers and large-holder execution remain separate. Accelerated maturity is a disposable test instrument term; maturity includes principal plus final coupon under the existing formula. The retained owner ledger/program and public Devnet require their own reviewed rollout and acceptance.
