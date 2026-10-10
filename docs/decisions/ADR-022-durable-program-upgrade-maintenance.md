# ADR-022: Durable Localnet upgrade maintenance

Status: Accepted for application integration; owner execution pending
Date: 2026-10-09

## Context

The [phased loader procedure](ADR-021-phantom-localnet-program-upgrade.md) needs separate EXTEND and UPGRADE signatures. Restart, lost response or audit failure must not open business writes between phases or turn an ambiguous signature into another upgrade attempt.

## Options considered

1. In-memory lock or environment flag alone.
2. Independent attempts without a durable maintenance boundary.
3. Persistent maintenance plus existing exact-wire attempts/audit, database guards and a restricted operator panel.

## Decision and reasoning

Use option 3. Add `ProgramUpgrade`, link existing `BlockchainTransaction`, and keep one ACTIVE session until finalized candidate hash, unchanged pointer/authority, consumed buffer and preserved program-account set pass. PostgreSQL advisory locking and write triggers cover in-flight and other-instance domain writes; an HTTP guard provides clear errors. Authentication and reads remain available.

Reuse the shared preflight, phase builders, exact-message verification, Wallet Standard signing and audit. HTTP accepts only a reviewed buffer or saved operation/signature. Browser parsing excludes extra instructions/privileges. Signature persistence precedes broadcast; compare-and-set prevents concurrent submission. Recorded signatures are confirmation-only. Only expired unsigned phases can be replaced with audit.

## Consequences and risks

- Business writes pause across the shared database until acceptance; login/read/recovery remain available.
- Failed/ambiguous operations retain maintenance. No automatic unlock or destructive recovery exists.
- Migration precedes this API revision. The loopback-only capability stays disabled on staging.
- The database cannot exclude direct wallet/CLI writes or another database; operators freeze them separately.
- Account preservation/audit do not substitute for owner approval, financial receipts or reconciliation.
- EXTEND rent remains allocated after UPGRADE failure. Code rollback cannot undo finalized business changes.

## Future work

Review owner buffer staging/transfer and complete Phantom browser acceptance. Keep registration, funding, governance, reserves and payout behind separate gates. Add narrowly reviewed recovery only for a concrete interrupted-owner case; do not expose generic unlocking.
