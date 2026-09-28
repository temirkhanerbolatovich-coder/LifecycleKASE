# Persistence boundary

The Prisma schema defines users, wallet authentication state, issuers, investors, instruments, corporate actions, immutable snapshot projections, entitlements, settlements, blockchain transaction attempts, execution jobs, idempotency records, and audit logs.

PostgreSQL is an orchestration and read-model store. It is not authoritative for token ownership, supply, or finalized execution receipts.

Validate and format the schema without connecting to PostgreSQL:

```powershell
npm run prisma:validate
npm run prisma:format
npm run prisma:generate
```

Database-level check constraints and finalized-snapshot immutability triggers will be added in the first reviewed SQL migration. They are intentionally not claimed by the schema-only foundation.

The project currently pins Prisma `6.12.0`; see ADR-005 for the security rationale and upgrade gate.
