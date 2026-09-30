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

## Enable and verify

After provisioning, configure the exact `AUTH_DOMAIN`, `AUTH_ALLOWED_ORIGINS`, secure cookie setting and rate-limit values. Set `AUTH_ENABLED=true`, redeploy, then verify login with the provisioned wallet. Confirm that an unregistered wallet receives `UNAUTHORIZED_WALLET`, repeated authentication attempts receive HTTP 429 plus `Retry-After`, and protected snapshot routes reject non-administrator roles.

## Failure and rollback

The transaction creates no partial user/wallet mapping when it fails. There is intentionally no CLI flag that overwrites, revokes or changes roles: those operations require a separate reviewed administration flow. Until that exists, leave authentication disabled if a provisioned wallet must be revoked or rotated; do not edit production rows ad hoc.
