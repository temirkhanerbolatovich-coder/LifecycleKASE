# ADR-007: Disposable Render status staging

Status: Accepted for preparation; not deployed
Date: 2026-09-29

## Context

The repository now has a read-only Next.js status page and NestJS health routes. It needs a repeatable public test environment before protected corporate-action workflows exist. No paid hosting plan, production data policy, or Render account has been selected.

## Options considered

1. Publish the frontend only as a static site, with no live API or database signal.
2. Use a free Render Blueprint for two Node web services and a disposable PostgreSQL database.
3. Provision paid web/private services with a dedicated pre-deploy migration step.

## Decision

Prepare option 2 in `render.yaml` for a status-only demo. Both Node services and PostgreSQL use the free plan. PostgreSQL blocks external connections. The web service reads the public HTTPS URL of the API from Render's `RENDER_EXTERNAL_URL`, because free web services cannot receive private-network traffic. The API exposes only health routes.

The API build command performs an explicit Prisma migration step after installation, generation, and compilation. This is a free-plan workaround: Render pre-deploy commands are available only on paid web services. Migrations do **not** run in the API start command, so a cold start cannot unexpectedly mutate the schema. The Blueprint must not be used for real investor or financial data.

## Reasoning

This creates a reproducible demo without adding container orchestration or a paid dependency before the product has authenticated workflows. Health probes use process liveness to avoid a database incident causing an application restart loop; the dashboard checks database readiness separately.

## Consequences

- A successful API build applies migrations to the disposable staging database; a failed migration fails the build.
- The API is publicly reachable. Health checks are unauthenticated; domain routes must refuse requests unless wallet authentication is explicitly enabled and succeeds.
- The web-to-API request uses public HTTPS and may show `unavailable` during a free-instance cold start. A response must contain JSON `{ "status": "ready" }`; an HTML loading page cannot be mistaken for readiness.
- The local workspace and the public deployment remain separate until the Blueprint is actually connected to a Render workspace and deployed from committed code.

## Risks

- Free PostgreSQL expires after 30 days, has a 1 GB limit and no backups. Data must be disposable.
- Free web services sleep when idle; the first status request may be slow or temporarily degraded.
- Free-plan resource and pipeline quotas can suspend services or incur charges depending on workspace billing settings.
- Running migrations during a build is not suitable for a production release process and may need coordination if multiple deploys overlap.

## Future work

- Before a persistent pilot, choose a paid database with backups, a supported migration gate, and access controls.
- Add authentication, authorization, auditing, CORS and rate limits before introducing domain API routes.
- Verify a live Render deployment and record its URLs and commit SHA only after user-controlled account setup.
