# Coupon execution and receipts

## Scope and prerequisites

The October 10, 2026 Localnet candidate implements actual Token-2022 coupon transfers from the action's approved reserve. Each payment creates an immutable entitlement receipt in the same transaction. The API verifies finalized signed bytes, accounts and token deltas before atomically updating PostgreSQL, Cash/Asset Legs and audit. It does not implement redemption or burn.

`COUPON_EXECUTION_ENABLED=false` is the default. Enabling requires `ACTION_APPROVAL_RESERVE_ENABLED=true`, the reviewed candidate, finalized calculation/approval and the configured Localnet program/genesis. The retained owner program has not been upgraded to this candidate. Its held calculation FINALIZE remains untouched. Do not enable the capability on that program or use the acceptance harness against its ledger.

There is no schema migration. Existing instrument/action/entitlement layouts and enum ordinals are preserved; new action states are appended. [ADR-024](../decisions/ADR-024-atomic-coupon-receipts.md) explains the protocol and projection boundary.

## Operator flow

1. Inspect the approved coupon and its eligible receivers. Read-only Auditors can inspect payments and evidence.
2. Prepare PAY for one READY entitlement with the current action version and a new idempotency key. The API checks current receiver eligibility, the finalized execution date, exact reserve, mint and SOL/rent budget.
3. Review the network, signer, receiver and amount. Phantom signs the saved v0 transaction. The API verifies its exact message before a single broadcast.
4. Check the original signature. On-chain `execute_coupon` transfers the exact amount, marks the entitlement PAID, increments the processed count and creates its receipt atomically. Coupon execution cannot burn bond tokens.
5. Finalized confirmation verifies the immutable receipt and the transaction's vault/receiver balance deltas. One serializable database transaction saves the payment, a CONFIRMED Cash Leg, a NOT_APPLICABLE Asset Leg, reconciliation and audit. The Asset Leg has expected amount zero and actual amount null under the existing domain contract.
6. After every positive entitlement is confirmed, the application becomes SETTLED. Prepare FINALIZE; download/inspect the DRAFT canonical JSON if needed, then explicitly sign its hash commitment.
7. `finalize_coupon` validates every unique registered entitlement, totals and processed count before creating the ActionReceipt PDA and setting the chain action FINALIZED. The API verifies that commitment before finalizing its receipt and action together with audit. The final JSON is available through the authenticated receipt endpoint.

The chain remains PROCESSING between payments and final receipt creation; application SETTLED means all payments have been reconciled, not that the final hash is already on-chain.

## Identity, replay and recovery

An EntitlementReceipt is derived from `entitlement-receipt` and its entitlement PDA. Changing the client idempotency key cannot produce another payment receipt for the same entitlement. A receipt records action, entitlement, snapshot hash, settlement mint, receiver, amount, idempotency hash and chain execution time. Receipt creation, transfer and counters roll back together on failure.

The API persists the exact unsigned transaction, blockhash lifetime, signer, program/genesis, immutable terms and key before signing. The same key restores the same attempt; reusing it for other terms fails. Another active action attempt blocks preparation. Expired unsigned attempts may be replaced through the existing workflow recovery; signed SUBMITTED/UNKNOWN_CONFIRMATION attempts permit confirmation only. Neither UI reload nor a retry broadcasts again.

Finalized chain state can outlive a failed database projection. A failed audit insert rolls back payment projection, legs and status. Rechecking the same finalized signature completes that projection without paying again. Current eligibility is checked before payment; its later revocation cannot erase an already committed transfer during confirmation.

## Canonical document and evidence

The versioned `coupon-action-receipt-v1` JSON has an explicit field order and investor ordering. It includes source provenance, application/on-chain approval, planned/effective snapshot time and slot/hash, amounts, receiver, signatures, entitlement receipt addresses, executed times, finalized slots and both-leg reconciliation.

SHA-256 is computed over the exact UTF-8 canonical JSON. PostgreSQL jsonb may reorder keys; validation rebuilds the canonical document and compares values independently of object-key ordering. Altered payloads/hashes block retrieval, unsigned submission and finalization. Finalized database receipts retain the existing immutability trigger. Authenticated Administrator/Auditor receipt access appends `ACTION_RECEIPT_ACCESSED`; it does not trigger payment.

## API and UI

All routes use the existing same-origin proxy and session:

| Route under `/api/v1` | Behavior |
| --- | --- |
| GET `/corporate-actions/:id/coupon/execution` | Capability, amounts, paid counts and saved pending attempt |
| POST `/corporate-actions/:id/coupon/execution/prepare` | Administrator + assigned CA signer; version/key + PAY entitlement or FINALIZE |
| POST `/corporate-actions/:id/coupon/execution/submit` | Exact signed saved wire; Origin/rate limits; no repeated broadcast |
| POST `/corporate-actions/:id/coupon/execution/confirm` | Original finalized signature and account/delta reconciliation |
| GET `/corporate-actions/:id/receipt` | Administrator/Auditor canonical JSON, hash, DRAFT/FINALIZED, PDA and signature; access audit |
| GET `/transactions`, `/transactions/:signature` | Authenticated bounded safe transaction projection; prepared wire/payload excluded |
| GET `/audit`, `/corporate-actions/:id/audit` | Authenticated bounded append-only event history |

Journal lists accept limit 1–100, UUID cursor and optional action UUID; transactions additionally accept a validated status. Ordering uses created time and UUID descending. They use `Cache-Control: no-store`. UI search/status/sort applies to loaded records only. Technical identifiers are disclosed in record details. Journals cannot submit, close or replace an attempt.

The payment view shows names, exact minor-unit amounts and confirmed progress. The calculation is folded after approval when execution is enabled. The original signer can restore pending payment/receipt plans from GET; signed plans show confirmation controls. New plans still require an explicit review and wallet signature. [Workspace UI](operator-workspace-ui.md) documents responsive navigation and state retention.

GET also supplies program-derived instrument/action/reserve/vault, receipt and recipient addresses for independent browser review. Before signing, the browser checks all instruction bytes and accounts, account privileges, the Token-2022 ATA receiver, idempotency commitment and complete finalization account list. Extra instructions or changed accounts fail closed. A refreshed blockhash may preserve the review; a change in financial identity or commitment requires review again.

## Validation and limitations

See [October 10 acceptance](../testing/coupon-execution-2026-10-10.md) for artifact identity, actual finalized 500/1000/250 transfers, replay/receiver/rollback checks, HTTP/PostgreSQL recovery and browser scope.

Only the plain six-decimal unfrozen Token-2022 settlement mint is supported. SOL buffer checks are preflight, not escrow. Acceptance covers the three-holder demo; the instruction's logical 64-holder bound does not provide large-holder scalability or address lookup tables within Solana packet limits. Reserve/receipt rent cleanup, background execution jobs, general restart/reindex, PDF/CSV receipt export and public Explorer evidence are separate work. Maturity and early redemption still require atomic payment + burn and their own acceptance. KZT-Test is simulated, with no real funds or real KYC.
