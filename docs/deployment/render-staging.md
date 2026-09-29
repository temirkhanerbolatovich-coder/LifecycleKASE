# Disposable Render staging

Status: configuration prepared; no public deployment verified.

The root [`render.yaml`](../../render.yaml) defines two free Node web services and one free PostgreSQL 17 database in Frankfurt. It is for the **read-only status page only**. It does not deploy the Solana program, create tokens, enable investors or execute payments.

## Before creating the Blueprint

1. Review the current [Render free-plan limits](https://render.com/docs/free) and workspace billing settings. Free PostgreSQL expires after 30 days, has no backups, and must contain no real investor or financial data.
2. Commit and push the reviewed application and Blueprint changes to the intended repository branch. The current local working tree alone cannot be deployed from GitHub.
3. In your own Render account, create a Blueprint from that branch and review the three proposed resources before approving creation. Do not attach an existing production database to this Blueprint.

As observed on 2026-09-29, the current Render workspace already has a Free PostgreSQL database for the separate VKO project. Render permits only one Free PostgreSQL database per workspace. Do not sync this Blueprint into that workspace unchanged: use a separate Hobby workspace if available, or explicitly choose and approve a paid isolated database. Do not delete, repurpose, or upgrade the VKO database as part of this deployment.

The API build command installs dependencies, generates Prisma Client, builds the API and then runs `prisma migrate deploy`. Free web services have no pre-deploy command; this explicit build step is only acceptable for a disposable demo. Never put migrations in the start command. If a migration fails, stop and diagnose it rather than retrying against valuable data.

The database `ipAllowList: []` blocks external connections. The API gets its connection string from Render's database reference, not from a committed secret. The web service gets the API's public HTTPS URL from a service reference. Free Render web services cannot receive private network traffic from another free web service, so the web server calls the API through its public URL.

## Verify after deployment

- API `GET /api/v1/health/live` responds with `{ "status": "live" }`.
- API `GET /api/v1/health/ready` responds with `{ "status": "ready" }`; after a database failure it responds with HTTP 503 and `DATABASE_UNAVAILABLE`.
- Web `GET /health/live` responds with `{ "status": "live" }`.
- Web `/dashboard` renders and displays the API/PostgreSQL status, while Solana remains explicitly unconnected.
- Unknown domain routes, such as `/api/v1/investors`, remain 404. Do not add them without authentication and authorization.
- Record the actual public URLs and deployed Git commit only after these checks pass. A local build is not deployment evidence.

The free API may sleep after inactivity. During wake-up, the dashboard may temporarily show `Недоступно`; refresh after the API has warmed. The dashboard validates the JSON status and will not treat a Render loading page as readiness.

For a persistent pilot, replace this temporary setup with paid/managed resources, backups, a dedicated migration gate, and a security review. See [ADR-007](../decisions/ADR-007-disposable-render-staging.md).
