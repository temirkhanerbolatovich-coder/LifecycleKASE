# ADR-030: Controlled registry and assigned-unit reservations

Status: Protocol/client candidate accepted on disposable Localnet; API/database/UI integration pending. Date: 2026-10-12.

## Context

BondFlow sections 7 and 8 require an enforceable ownership capture and reservation of only the units assigned to redemption. The existing mint permits direct Token-2022 transfers and burns. Its PermanentDelegate gives burn authority but does not preserve ownership between the record-date scan and settlement. Database locks and disabled UI controls cannot enforce these requirements.

Legacy instrument v1 requires no freeze authority. Its deployed accounts, retained owner environment and exact-target action v2 must remain compatible. Instrument version and action allocation version are independent.

## Options considered

1. A transfer hook: suitable for transfer policies, but does not by itself block owner burns.
2. Frozen accounts with physical escrow: prevents assigned units moving, but introduces escrow-beneficiary positions into every later snapshot and reconciliation.
3. Frozen accounts with program-mediated movement and per-account reservation counters: chosen for the bounded operator prototype.

## Decision

New instrument v2 uses a new mint with exactly PermanentDelegate and DefaultAccountState extensions. New token accounts start Frozen. The instrument authority PDA controls freeze and permanent-delegate operations; there is no general thaw or authority-update instruction. Supply is minted through an atomic bootstrap that thaws treasury, mints the fixed supply, freezes treasury and revokes mint authority.

Holding sidecars bind instrument, token account and owner, and track reserved units. A controlled transfer requires holder and corporate-action authority signatures. The PDA performs the Token-2022 CPI, then refreezes both accounts before returning. Quantity cannot exceed actual balance minus reservations.

Accounts require ImmutableOwner and may contain typed CPI Guard or MemoTransfer flags. Owners can enable these after reservation while still frozen, so rejecting their presence would strand an otherwise valid redemption. Permanent-delegate CPI and burn preserve settlement availability. Incoming transfers to a memo-required destination fail safely until its owner disables that flag; adding a memo CPI is separate work. Unknown extensions remain unsupported.

A policy sidecar blocks all controlled movement during capture. Complete positive frozen account coverage must sum to the actual mint supply. An immutable capture sidecar stores raw token accounts, owners, balances and the actual Clock slot/time. The canonical off-chain investor mapping remains an authority-attested input, separately committed by the snapshot hash; the program does not perform KYC.

Redemption reservations bind the finalized allocation, entitlement, snapshot and immutable source commitment. Only assigned quantities increase Holding counters; zero assignments retain explicit coverage markers. Capture remains locked until every entitlement/source is covered. One unfinished redemption per instrument avoids the existing supply-progress invariant becoming stale after another burn.

Controlled settlement validates and consumes these reservations around the existing atomic cash/burn logic, thawing only positive burn sources and refreezing them on success. A failed payment, burn or refreeze rolls back all token changes, counters and receipts. A zero-assignment source may move all free units and close; execution must tolerate its absence while retaining the original source commitment.

## Consequences

Technical Frozen state routes all movement through the program. Business reservations lock only assigned units; remaining units can move through the controlled path. Standard SPL/DEX transfers cannot be used for this mint.

Existing instrument, action and entitlement layouts remain unchanged. Dedicated instructions and new sidecars preserve legacy validation rules. This candidate starts in protocol/client acceptance; API/database/UI rollout is a separate integration step. It does not migrate retained owner state or establish Devnet execution.

## Risks and limits

Capture completeness is bounded by transaction/account limits. There is no historical reconstruction at an arbitrary planned timestamp. Commitment authenticates the saved serialization, while investor identity and eligibility remain trusted registry inputs. Bootstrap and all token CPI paths must be tested against the installed Token-2022 version.

Abort is limited to an uncommitted capture without reservations. A later reversal needs its own state machine and cannot blindly unlock approved or partially settled obligations. Governance of upgrades, compliance restrictions and long-lived capture recovery remain separate work.

## Validation

Disposable runtime rejects direct transfer/burn/thaw/authority changes, omitted or duplicate capture entries, incomplete reservation coverage, reserved-boundary transfers, unsafe aborts, overlapping redemptions and replay. It demonstrates free-unit transfers, zero-source closure/recreation, owner-enabled guard liveness, exact atomic payment/burn, frozen survivors and rollback on failure. See the [dated acceptance record](../testing/controlled-registry-2026-10-12.md) for the final 63-transaction/35-rejection fixture, legacy regression and integration limits. Controlled coupon payment/maturity and application receipt projection still require integrated acceptance.

## Sources

- [Solana default account state](https://solana.com/docs/tokens/extensions/default-state)
- [Solana freeze and thaw](https://solana.com/docs/tokens/basics/freeze-account)
- [Permanent delegate](https://solana.com/docs/tokens/extensions/permanent-delegate)
- [Token-2022 processor](https://github.com/solana-program/token-2022/blob/main/program/src/processor.rs)
- [Existing atomic redemption](ADR-025-atomic-redemption.md) and [exact-target allocation](ADR-029-exact-target-redemption.md)
