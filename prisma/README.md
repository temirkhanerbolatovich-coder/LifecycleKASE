# Persistence boundary

Current source/checkpoint — **2026-10-12**: [implemented versus simulated](../docs/IMPLEMENTED_VS_SIMULATED.md), [controlled financial acceptance](../docs/testing/controlled-workflow-integration-2026-10-12.md) and [subsequent operator/export/overview/worker acceptance](../docs/testing/operator-continuation-2026-10-12.md) define the current scope. Source has 23 migrations; recorded financial runtime used 22. New worker fresh-chain recovery and financial export download remain open; hosted/owner/public-network acceptance is separate. Earlier dated workflow observations below retain their original scope.

The Prisma schema defines users, wallet authentication state, issuers, investors, instruments, corporate actions, immutable snapshot projections, entitlements, settlements, blockchain transaction attempts, execution jobs, idempotency records, and audit logs.

PostgreSQL is an orchestration and read-model store. It is not authoritative for token ownership, supply, or finalized execution receipts.

Validate and format the schema without connecting to PostgreSQL:

```powershell
npm run prisma:validate
npm run prisma:format
npm run prisma:generate
npm run prisma:migrate:deploy
npm run test:database
```

Database-level check constraints and finalized-snapshot immutability triggers are defined in the reviewed migrations and exercised by a PostgreSQL integration test. Operator sessions retain the authenticating wallet address as nullable migration context; newly created sessions always populate it, and protected routes reject legacy rows without it.

The project currently pins Prisma `6.12.0`; see ADR-005 for the security rationale and upgrade gate.
