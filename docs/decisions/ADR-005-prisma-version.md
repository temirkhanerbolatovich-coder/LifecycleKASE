# ADR-005: Temporary Prisma 6.12 security pin

Status: Accepted
Date: 2026-09-28

## Context

The initial schema work evaluated Prisma 7.10.0. `npm audit` reported high-severity advisories in its CLI dependency graph through `deepmerge-ts` and `mysql2`. Prisma 6.19.3 retained the affected `deepmerge-ts` dependency. Forcing a transitive major-version override would create an unsupported dependency combination, while Prisma 8 was still a release candidate.

## Options considered

1. Keep Prisma 7.10.0 and accept the high-severity audit findings.
2. Override Prisma's pinned transitive dependencies with potentially incompatible major versions.
3. Use the audit-clean Prisma 6.12.0 release temporarily and record an explicit upgrade gate.
4. Adopt the Prisma 8 release candidate.

## Decision

Pin both `prisma` and `@prisma/client` to exactly `6.12.0`. Use the Prisma 6 datasource configuration in `schema.prisma` and a small cross-platform wrapper that supplies only a safe local-development URL when `DATABASE_URL` is absent during format, validation, or generation.

Do not use automatic forced audit fixes or floating Prisma versions. Re-evaluate the current stable release before API implementation is finalized.

## Reasoning

An audit-clean supported pair is safer for the current schema foundation than knowingly retaining high findings or overriding internal dependencies across a major version boundary. Exact pins prevent an unnoticed CLI/client mismatch.

## Consequences

- The repository does not use Prisma 7 configuration files yet.
- Current Prisma documentation may show newer configuration syntax.
- The API must import the generated Prisma 6 client until an explicit upgrade is completed.
- Dependency audit remains a required CI gate.

## Risks

- Prisma 6.12.0 may miss later fixes and features.
- A future Node.js or PostgreSQL upgrade may require a newer Prisma release.
- Delaying the upgrade could increase later migration effort.

## Future work

- Re-run audit against the latest stable Prisma release before implementing the API persistence adapter.
- Upgrade only when schema validation, client generation, migrations, integration tests, and API tests pass together.
- Retire this ADR with a superseding decision after the upgrade.
