# ADR-024: Atomic coupon receipts and finalized database projection

Status: Accepted for the isolated Localnet candidate; retained owner rollout pending.

Date: 2026-10-10

## Context

An approved reserve and stored calculation do not prove payment. A transfer may finalize while its HTTP response or database audit fails. Execution must prevent another payment while allowing reconciliation of the original signature. The final action document must commit to confirmed investor results.

## Options considered

- Separate transfer, entitlement update and receipt transactions: exposes partially committed results and replay risk.
- Database-only payment receipts: cannot prove the atomic chain result after missing RPC/HTTP responses.
- One chain transaction per entitlement with a PDA receipt, followed by a separate all-results action commitment: uses the existing wallet-signed workflow and bounded demo.

## Decision

Use `execute_coupon` to transfer from the approved PDA-owned vault, mark PAID, increment the action count and create an EntitlementReceipt atomically. Its PDA depends on the entitlement, so a different client key cannot bypass replay prevention. Require exact finalized saved transaction bytes, receipt identity and token history before a serializable payment/legs/audit projection.

Finalize the action separately after every positive entitlement has a MATCHED finalized settlement. A deterministic versioned JSON includes the committed calculation, approval and every payment proof. `finalize_coupon` validates unique entitlements/count/amount and writes its SHA-256 into an immutable ActionReceipt PDA. The database and UI claim FINALIZED only after verifying that PDA and signature. Validate the stored JSON's values as well as its hash despite jsonb key reordering.

Keep signed recovery confirmation-only and keep the capability default-off. Preserve the retained owner's program/artifact and held FINALIZE. Reuse existing tables, roles, transport and audit constraints; add no queue, custody service or migration.

## Consequences and risks

Per-entitlement fees/rent and a final signing step are required. A failed projection is recoverable through the saved finalized signature; missing RPC history remains an explicit unknown state. The signer still commits the canonical hash through the reviewed API plan; the chain cannot independently reconstruct external provenance JSON.

The three-holder demo is accepted independently of owner deployment. General execution workers, large account sets/address lookup tables, reserve rent cleanup, redemptions, owner upgrade/Phantom acceptance and public Devnet are future gates. This decision does not approve a retained-environment transaction.

See [feature](../features/coupon-execution-and-receipts.md) and [acceptance](../testing/coupon-execution-2026-10-10.md).
