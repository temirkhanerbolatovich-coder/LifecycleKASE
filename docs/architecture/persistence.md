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

The Prisma schema captures relationships, enums, indexes, and unique constraints. The first SQL migration must add PostgreSQL check constraints for nonnegative amounts and valid date ranges, plus a trigger preventing updates to finalized snapshots, holders, and token-account rows.

Until that migration exists and runs against PostgreSQL, snapshot immutability is a documented requirement rather than a database-verified guarantee.

## Validation

```powershell
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
```

Database integration tests remain pending until Docker Desktop is running and the first migration has been reviewed.
