# LifecycleKASE

Corporate Action Engine for tokenized securities on Solana. The repository has its **Milestone 0 foundation** and the first shared domain contracts: requirements, architecture decisions, repository boundaries, CI checks, local PostgreSQL infrastructure, checked financial calculations, state transitions, and canonical snapshot hashing. Product services and the on-chain program are not implemented yet.

## Scope

The MVP demonstrates an end-to-end lifecycle for a fixed-supply tokenized bond:

- issuance of 35 indivisible Token-2022 tokens;
- holder balances of 10, 20, and 5 tokens;
- coupon, early-redemption, and maturity-redemption corporate actions;
- finalized-slot snapshots with deterministic calculation;
- atomic payment, token burn, and execution receipt per entitlement.

The binding requirements are:

- [Product requirements](docs/requirements/PRODUCT_REQUIREMENTS.md)
- [Technical requirements](docs/requirements/TECHNICAL_REQUIREMENTS.md)
- [Solana toolchain setup](docs/development/toolchain.md)
- [Domain contracts and test vectors](docs/testing/domain-contracts.md)
- [Persistence architecture](docs/architecture/persistence.md)

## Repository layout

```text
apps/                 Future API and web applications
packages/             Shared domain and Solana client packages
programs/             Future Anchor program
prisma/               Future PostgreSQL schema and migrations
docs/architecture/    Current system boundaries
docs/decisions/       Accepted architecture decisions
docs/requirements/    Product and technical requirements
scripts/              Repeatable validation and local smoke tests
test/                 Repository-level tests
```

Each future implementation directory contains a boundary README. Empty framework projects are deliberately not generated before the corresponding milestone starts.

## Requirements

- Node.js 22 or newer;
- npm 10 or newer;
- Docker with Compose for local PostgreSQL;
- Rust, Solana CLI, and Anchor CLI for on-chain development.

Run the environment check:

```powershell
npm run check:toolchain
```

## Setup and validation

```powershell
npm install
npm run check
docker compose up -d postgres
```

Copy `.env.example` to `.env` only when local services need configuration. `.env` is ignored by Git.

PostgreSQL is exposed on host port `55432` by default to avoid collisions with an existing local PostgreSQL installation; the container still listens on its standard internal port `5432`. The default host URL uses IPv6 loopback `[::1]`, which avoids an IPv4 PostgreSQL service intercepting Docker Desktop traffic on Windows.

To verify a locally installed Solana validator:

```powershell
npm run solana:smoke
```

The smoke test starts an isolated validator on port `18899`, waits for a JSON-RPC response, and always stops the process and removes its temporary ledger. It fails with an actionable message when `solana-test-validator` is not installed.

## Current limitations

- API, frontend, Solana client, and Anchor program are not implemented.
- The Prisma schema is implemented, but its first SQL migration and database integration tests still require a running PostgreSQL instance.
- The TypeScript domain contracts are implemented; matching Rust calculations are not yet available.
- The validator smoke-test requires an external Solana CLI installation.
- Docker Compose currently provisions PostgreSQL only; application containers will be added with their implementation milestone.
- No production deployment, key custody, or real-money operation is supported.
