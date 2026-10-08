# ADR-019: Immutable on-chain calculations before approval

Status: Accepted for isolated Localnet candidate with pre-review reset; owner upgrade deferred
Date: 2026-10-07

## Context

The accepted owner coupon has a finalized snapshot and application calculations, while its Action PDA remains SNAPSHOT_CREATED. The owner's continuation request adds real entitlement records, authority separation and an action-specific reserve. Application APPROVED must not become implicit payout authority.

## Options considered

1. Let a database approval authorize token transfers directly.
2. Register immutable per-investor calculations and reconcile the complete bounded set before adding a separate approval/reserve boundary.
3. Add payment, burn, compliance hooks and account migrations in a single program upgrade.

## Decision

Implement option 2 as a separately built and tested candidate. Use existing UUID bytes for stable investor identity, consistent with ADR-006, rather than adding a second investor hash scheme. Require the existing corporate_action_authority for registration/finalization/reset; keep existing schedule/snapshot behavior unchanged in this slice. Append status variants without changing existing account layouts. Use existing checked integer formulas; register all captured investors, including zero/skipped obligations, for total coverage.

Before UNDER_REVIEW, `reset_calculation` may atomically close only the complete unique set of currently registered canonical Entitlement PDAs, reconcile their payment sum with the Action PDA counters, return rent to the corporate action authority and restore the Action PDA to SNAPSHOT_CREATED with zero calculation counters. It cannot alter the snapshot, run after finalization, close executed rows, or accept a subset. API preparation additionally requires every supplied PDA to be a database-confirmed canonical projection and blocks reset/finalization while another calculation operation is unresolved.

The snapshot hash binds the authority's certified calculation to application evidence. It does not supply per-row inclusion proofs. An isolated validator proves transaction behavior, not legal eligibility or owner acceptance. New program source and an IDL do not upgrade the persistent ledger.

## Reasoning

Immutable PDA creation prevents duplicate rows and silent amendment. Full-set ownership, identity and aggregate checks prevent incomplete or mixed-action finalization. A bounded demo avoids introducing Merkle trees, queues or a new dependency before there is a concrete need. Separate candidate artifacts preserve the working owner environment.

## Consequences and risks

- Existing owner issuance and snapshot remain usable on the retained binary.
- READY row status cannot pay: a separate on-chain action approval and funded action reserve are prerequisites for any future execution instruction.
- Authority correctness and snapshot certification remain explicit trust boundaries. This is not full on-chain compliance.
- A confirmed partial registration can be reset before UNDER_REVIEW without resetting the ledger or snapshot. The reset is destructive to the partial Entitlement PDA set and therefore requires a separately reviewed exact transaction and finalized read-back.
- A finalized registration that exists on chain but was never projected into the database still requires signature/account reconciliation before reset; the API fails closed on counter mismatch rather than guessing the missing investor mapping.
- The 64-account logical bound is not a promise that 64 investors fit one transaction; serialization must fail closed.
- Registration is a calculation slice only. Execution attempts/reference, burned amounts, receipts and multi-wallet burn-source commitments are not yet implemented in this account.
- Devnet's artifact gate now requires the new instructions. Its older artifact/hash pin is retained as historical evidence and requires a separately reviewed rebuild before use.

## Future work

Review and execute the owner upgrade separately, then run exact REGISTER/RESET/FINALIZE acceptance on the preserved environment. Add an approver role and action-specific reserve, current eligibility/source checks, atomic coupon and redemption execution, receipts and reconciliation. Add a bounded reindex procedure for a finalized on-chain entitlement whose database confirmation evidence is unavailable. Complete the user's new on-chain transfer-control requirement on a separate compatible demo mint; LKA26R1 has irrevocably revoked freeze authority.
