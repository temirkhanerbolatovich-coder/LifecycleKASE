# ADR-017: Stored investor entitlements and explicit demo approval

Status: Accepted
Date: 2026-10-02

## Context

The finalized snapshot and pure integer calculations existed, but the application could not store investor entitlements or review them. The Localnet registry deliberately records synthetic eligibility without marking real KYC as VERIFIED. Applying the strict public-network KYC contract without an explicit demo policy would block the accepted local workflow.

## Options considered

1. Calculate amounts only in the browser and approve a UI label.
2. Store integer results against the immutable snapshot, require explicit versioned review, and distinguish synthetic Localnet review from KYC.
3. Add settlement instructions, on-chain approvals and a new custody architecture in the same slice.

## Decision

Use the existing Entitlement/CorporateAction schema and Serializable transactions. Calculate one entitlement per snapshot investor, aggregate all captured wallets/accounts, reconstruct the relational canonical commitment, and preserve inputs, formula/rule versions and actor audit. A receiver must be an active verified wallet of that investor on the instrument network; multiple choices require explicit selection. RETURNED_FOR_REVISION retains the same snapshot and entitlement IDs; each calculation's full evidence remains in immutable audit.

Approval is an explicit Administrator issuer-wallet application decision under ADR-006. It requires UNDER_REVIEW, a reason, matching action version, recalculated amounts/totals/coverage and current recipient eligibility. Positive entitlements become READY; zero-rounding rows never do. Rejected actions are terminal. No new instruction, payment or on-chain approval is introduced here: the Action PDA remains SNAPSHOT_CREATED while application review progresses. Future execution must call the application gate and add its own on-chain authorization/replay/current-source checks.

The existing strict eligibility policy remains the default. Only SOLANA_LOCALNET with KYC NOT_STARTED, an actual reviewed DEMO_CRITERIA_MET decision and otherwise valid investor/snapshot/wallet facts may return LOCAL_DEMO_ELIGIBLE. Pending, rejected or expired KYC, public Devnet and an unreviewed demo decision cannot use this exception. KYC rows are never changed to VERIFIED for convenience.

## Reasoning

Existing schema and domain functions are sufficient. Explicit policy avoids representing synthetic acceptance as legal eligibility. Optimistic versions and atomic audit prevent stale review and duplicate concurrent writes. Shared TSV vectors check Rust/TypeScript rounding and overflow without adding a parser dependency or upgrading the retained program.

## Consequences

- No schema migration, new dependency or program deployment is required for application calculation/review.
- Money remains bigint/string minor units, including browser formatting.
- Lost mutation responses require refreshing the stored result; a stale version returns 409 and cannot create another entitlement or approval event.
- Approval and the subsequent application execution gate recheck current eligibility, selected receivers and stored calculation integrity. An approved action cannot be recalculated through the API.
- The demo permits the same Administrator to author and approve, with separate audit events. This is not production maker/checker separation.
- Explicitly authorized Localnet OS recovery can confirm a previously signed snapshot and prepare its calculations UNDER_REVIEW, with original authenticated preparation evidence, current role/wallet/network guards and a distinct CLI audit source. It cannot sign, broadcast, approve/reject/return or pay, and cannot operate against public networks or external databases. HTTP session controls stay intact.

## Risks

Application approval cannot authorize or prevent a direct future on-chain instruction by itself. Settlement must enforce a reviewed commitment and appropriate signer on-chain. Current-wallet checks before preparing a transaction do not replace checks at execution. Registry corrections/suspension and cancellation after RETURNED_FOR_REVISION remain separate governed workflows.

## Future work

Implement reviewed on-chain execution, test funding, atomic per-investor payment/burn/receipt, replay prevention and reconciliation. Add separate maker/checker roles and public-network KYC governance before production. Complete persistent owner and separate Auditor UI acceptance.
