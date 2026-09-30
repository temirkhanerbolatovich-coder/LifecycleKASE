# Controlled operator provisioning

Use this procedure only for a reviewed local or demo environment. It creates a user, an active verified operator wallet and an `OPERATOR_PROVISIONED` audit event in one serializable transaction. The command accepts only a public Solana wallet address; never paste a private key or seed phrase into the terminal, environment, repository or Render dashboard.

## Preconditions

1. Confirm the target `DATABASE_URL` and wallet network. Never point the command at an unreviewed database.
2. Obtain the operator's public wallet address through an authenticated channel and have the operator verify it independently.
3. Choose the least-privileged role. `ADMINISTRATOR` is required for the current snapshot routes; `ISSUER_OPERATOR`, `COMPLIANCE_OFFICER`, `APPROVER`, and `AUDITOR` cannot call those administrator-only routes.
4. Keep `AUTH_ENABLED=false` until provisioning and deployment verification are complete.

## Command

```powershell
$env:DATABASE_URL = '<reviewed PostgreSQL connection string>'
npm run operator:provision -- `
  --wallet '<public Solana address>' `
  --display-name 'Demo Administrator' `
  --role ADMINISTRATOR `
  --email 'operator@example.com' `
  --network SOLANA_DEVNET `
  --confirm '<same public Solana address>'
```

`--email` is optional. `--confirm` must exactly repeat `--wallet`. The command rejects malformed addresses, investor roles, mainnet, duplicate email ownership, and any existing wallet whose identity, role, network or lifecycle state differs. Repeating an exact active mapping returns `created: false` without creating another audit event.

## Disposable Render Free environment

Render Free compute does not expose the service Shell or one-off jobs. For a specifically approved first-operator setup, the existing CLI can run once at the end of the API build command, after Prisma generation, API compilation and migration deployment. The build already has the target service's database configuration; do not reveal or copy its credentials, open external database access, or introduce a public bootstrap endpoint.

1. Confirm the exact API service, disposable database, public address, display name, network and administrator-role grant with the operator. Keep authentication disabled.
2. Record the existing build command and temporarily append `&& node scripts/provision-operator.mjs` with the reviewed arguments above. Use ordinary shell quoting for the display name. Do not commit the operator's identity into the shared Blueprint.
3. Saving the command can automatically trigger a deploy. Observe that deploy instead of launching a duplicate. Require successful CLI output for the exact public wallet, role and network, followed by successful deployment. The CLI transaction includes the user, wallet and audit write; a build attempt alone is not evidence of creation.
4. Restore the exact original build command after observing the result, even if registration failed. Verify the saved setting and any resulting deployment. Do not leave provisioning attached to routine builds or API startup.
5. Check public readiness and the expected AUTH_NOT_CONFIGURED boundary. Enable login only in a separately reviewed step; registration alone does not demonstrate wallet possession or an authenticated session.

This is a temporary demo operational workaround, not the pilot/production provisioning architecture. Build logs can contain the public address and generated user/wallet identifiers, but must never contain keys or session secrets. A future persistent environment should use a controlled administration job with a proper migration/provisioning gate.

## Enable and verify

After provisioning, configure the exact `AUTH_DOMAIN`, `AUTH_ALLOWED_ORIGINS`, secure cookie setting and rate-limit values. Set `AUTH_ENABLED=true`, redeploy, then verify login with the provisioned wallet. Confirm that an unregistered wallet receives `UNAUTHORIZED_WALLET`, repeated authentication attempts receive HTTP 429 plus `Retry-After`, and protected snapshot routes reject non-administrator roles.

## Failure and rollback

The transaction creates no partial user/wallet mapping when it fails. There is intentionally no CLI flag that overwrites, revokes or changes roles: those operations require a separate reviewed administration flow. Until that exists, leave authentication disabled if a provisioned wallet must be revoked or rotated; do not edit production rows ad hoc.
