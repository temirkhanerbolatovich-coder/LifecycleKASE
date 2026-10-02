# LifecycleKASE

Corporate Action Engine for tokenized securities on Solana. The repository has its **Milestone 0 foundation** and partial Milestone 1/2 work: requirements, architecture decisions, CI checks, local PostgreSQL migrations, checked financial calculations, approval state transitions, a fixture-tested Token-2022 holder collector, authenticated snapshot preparation/finalized confirmation, five locally built and validator-tested Anchor instructions (initialize/activate instrument, create/cancel action, register snapshot), Wallet Standard login, [Investor Registry](docs/features/investor-registry.md), and audited [instrument database drafts](docs/features/instrument-drafts.md). Full corporate-action acceptance remains incomplete. The owner approved local MVP delivery first; public Devnet deployment is deferred until MVP approval, and mainnet/real assets remain excluded. The snapshot HTTP/UI boundary accepts only explicit Localnet or Devnet plans and derives the Wallet Standard chain from the validated plan; live Localnet wallet/validator acceptance is still pending. See [ADR-014](docs/decisions/ADR-014-local-mvp-before-public-network.md).

## Scope

The MVP demonstrates an end-to-end lifecycle for a fixed-supply tokenized bond:

- issuance of 35 indivisible Token-2022 tokens;
- three investors with balances of 10, 20, and 5 tokens, each potentially using several wallets;
- coupon, early-redemption, and maturity-redemption corporate actions;
- finalized-slot snapshots with deterministic calculation;
- review and approval, atomic KZT-Test payment and burn legs, reconciliation, and receipts per entitlement and action.

The binding requirements are:

- [Product requirements](docs/requirements/PRODUCT_REQUIREMENTS.md)
- [Technical requirements](docs/requirements/TECHNICAL_REQUIREMENTS.md)
- [Solana toolchain setup](docs/development/toolchain.md)
- [Domain contracts and test vectors](docs/testing/domain-contracts.md)
- [Persistence architecture](docs/architecture/persistence.md)
- [Implemented, simulated, and pending scope](docs/IMPLEMENTED_VS_SIMULATED.md)
- [Disposable Render staging deployment](docs/deployment/render-staging.md)
- [Ordered Devnet-to-MVP checklist and read-only preflight](docs/deployment/DEVNET_TO_MVP_CHECKLIST.md)

## Repository layout

```text
apps/                 Internal API preparation service, health HTTP layer, and status web app
packages/             Shared domain contracts and Token-2022 holder collector
programs/             Anchor instrument, action, and snapshot-commitment instructions
prisma/               PostgreSQL schema and guarded migrations
docs/architecture/    Current system boundaries
docs/decisions/       Accepted architecture decisions
docs/requirements/    Product and technical requirements
scripts/              Repeatable validation and local smoke tests
test/                 Repository-level tests
```

Implementation boundaries and limitations are documented in each component README.

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
npm run prisma:migrate:deploy
npm run test:database
npm run test:api:database
npm run test:registry:database
```

Copy `.env.example` to `.env` only when local services need configuration. `.env` is ignored by Git.

To run the status slice locally, start PostgreSQL and apply migrations as above, then use two terminals:

```powershell
npm run build --workspace @lifecycle-kase/api
npm run start:api
```

```powershell
npm run dev:web
```

Open `http://localhost:3000/dashboard`. The API listens on port `4000` by default and exposes health plus operator authentication routes. Authentication requires `AUTH_ENABLED=true`, exact `AUTH_DOMAIN`/`AUTH_ALLOWED_ORIGINS`, and a verified operator wallet in the database; see [API documentation](apps/api/README.md) and the [controlled provisioning runbook](docs/operations/operator-provisioning.md). Challenge, signature verification and protected mutation endpoints have bounded per-client in-memory limits with configurable windows. Readiness checks PostgreSQL and returns 503 when unavailable. The web app checks it server-side using `API_INTERNAL_URL` (default `http://127.0.0.1:4000`); it still renders when the API is down. For a deployment, set `DATABASE_URL`, `PORT` and `API_SERVER_URL` for that environment; the Render Blueprint wires the URL automatically. Never expose database credentials in `NEXT_PUBLIC_*` variables. The web liveness route is `GET /health/live`.

PostgreSQL is exposed only on IPv4/IPv6 loopback host port `55432` by default to avoid collisions with an existing local PostgreSQL installation; the container still listens on its standard internal port `5432`. The default host URL uses IPv6 loopback `[::1]`, which avoids an IPv4 PostgreSQL service intercepting Docker Desktop traffic on Windows. Set `API_LISTEN_HOST=127.0.0.1` for a local-only API; when unset, the hosted-service default remains `0.0.0.0`.

The registry database test ignores `.env`, requires local database CREATE DATABASE permission, and creates/migrates/drops only a uniquely named test database. It exercises real HTTP authentication, role/Origin controls, registry persistence, concurrency, rollback, audit immutability and logout using synthetic in-memory signing keys. See [test configuration and limits](docs/features/investor-registry.md). Owner-reported local Phantom login/profile/registry display passed; manual browser form acceptance and public network acceptance are separate pending checks.

To verify a locally installed Solana validator:

```powershell
npm run solana:smoke
```

The smoke test starts an isolated validator on port `18899`, waits for a JSON-RPC response, and always stops the process and removes its temporary ledger. It fails with an actionable message when `solana-test-validator` is not installed.

## Current limitations

- The API supports domain-bound operator wallet authentication and administrator-only snapshot preparation/confirmation routes. The dashboard discovers Wallet Standard wallets and includes Localnet/Devnet snapshot review, explicit sign/send and finalized-confirm/recovery. The requested chain comes from the validated API plan, while cluster/wallet-network mismatches fail closed. A controlled CLI can create the first operator from a public wallet address, and authentication requests are rate-limited per client. See the [wallet workflow and recovery limits](apps/web/README.md). The confirmation path is fixture-tested but has no live Localnet or public Devnet mint/transaction proof. The owner accepted local signed Administrator and Auditor login flows; disposable staging has only challenge and unauthenticated-denial evidence. See the [deployment record](docs/deployment/render-staging.md).
- Twelve SQL migrations and database guard tests are implemented. The third migration requires an empty pre-MVP domain database; it stops when domain records exist. Later migrations add Localnet wallet/instrument compatibility without permitting mainnet, purpose-separate authentication challenges, eligibility/revocation audit rules and unique issuer names for the single demo workspace.
- The TypeScript domain contracts are implemented; matching Rust calculations are not yet available.
- The validator smoke-test requires an external Solana CLI installation.
- Docker Compose currently provisions PostgreSQL only; application containers will be added with their implementation milestone.
- No production deployment, key custody, or real-money operation is supported.
- The status-only staging dashboard is publicly deployed at <https://lifecyclekase-web.onrender.com/dashboard>; it is not a production application. Its free PostgreSQL has a short lifetime and no backups; do not store real data there. See the [deployment record](docs/deployment/render-staging.md).
