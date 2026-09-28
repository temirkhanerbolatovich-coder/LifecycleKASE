# Persistence architecture

Status: schema foundation implemented
Last updated: 2026-09-28

## Responsibility

PostgreSQL stores application identity, authentication hashes, issuer and investor metadata, workflow projections, canonical snapshot payloads, entitlement calculations, transaction attempts, jobs, idempotency responses, and audit events.

It does not override Solana ownership, mint supply, program state, snapshot commitments, or execution receipts. Finalized chain data wins during reconciliation as defined by ADR-004.

## Consistency boundaries

- `CorporateAction`, `Entitlement`, and `Instrument` have integer versions for compare-and-set updates.
- Snapshot ownership is one-to-one with a corporate action.
- Holder rows are unique per snapshot and wallet.
- Entitlements are unique per corporate action and holder wallet.
- Blockchain signatures are unique when present.
- Idempotency keys are unique inside an operation scope.
- Authentication challenges and sessions store hashes, not raw nonces or bearer tokens.

## Immutability

A snapshot and all holder/token-account rows are first written atomically in `PENDING_REGISTRATION`. After finalized on-chain commitment verification, the snapshot moves to `FINALIZED`. PostgreSQL triggers then reject mutation or deletion of the snapshot and its child rows, and reject new child rows.

The migration also adds PostgreSQL check constraints for nonnegative amounts, valid date ranges, fixed demo constants, action-specific parameters, hash lengths, and counter ranges.

## Validation

```powershell
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
```

Database integration tests remain pending until Docker Desktop is running and the first migration has been reviewed.
