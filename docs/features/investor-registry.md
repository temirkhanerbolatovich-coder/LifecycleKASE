# Investor Registry: first local slice

Administrator and Auditor can read `GET /api/v1/investors?limit=20&cursor=<uuid>`. Pages default to 20 and are capped at 100 investors, ordered by creation time/id; the extra row determines `nextCursor`. Each investor includes a wallet count and at most 20 wallet previews. The current UI supports continuation pages but not searching or a full wallet-detail route.

Administrator alone can call:

- `POST /api/v1/investors`: `displayName` (1–200 characters), `type` (`INDIVIDUAL`/`INSTITUTIONAL`), two-letter `countryCode`, optional unique `externalReference` (1–100 characters).
- `POST /api/v1/investors/:id/wallets`: `address`, a valid Solana public key. Network is fixed to `SOLANA_LOCALNET` in this local slice.

Unknown fields, malformed identifiers, unsupported enums and control characters are rejected server-side. New investors use `NOT_STARTED` KYC and `PENDING_REVIEW` eligibility. A pending investor record can have lifecycle status `ACTIVE`, but this is not payout eligibility. Attached wallets remain `PENDING` with null verification/revocation times. Existing wallet ownership, including operator wallets, cannot be reassigned. Missing/inactive investors fail closed. No real KYC, private keys or personal documents may be supplied; use synthetic demo labels and references only.

Both mutations insert actor/correlation-linked audit events in the same Serializable Prisma transaction as the record. Unique/reference and concurrent transaction conflicts return 409; audit failure aborts the transaction. Audit metadata omits display names and country data. Existing database migration guards make stored audit rows immutable. PostgreSQL uniqueness is authoritative, not the preliminary address lookup.

Routes require enabled authentication and an unexpired operator session. Writes additionally require an exact allowed Origin and the existing per-client mutation limiter, returning 429/Retry-After on limit. Reads are Administrator/Auditor only; responses use `no-store`. The fixed Next.js same-origin proxy exposes only the implemented route paths. No token-auth bypass or automatic role provisioning is added.

## Local usage

Start Docker/PostgreSQL and apply migrations using the [README](../../README.md). Configure `AUTH_ENABLED=true`, `AUTH_DOMAIN=localhost:3000`, `AUTH_ALLOWED_ORIGINS=http://localhost:3000` for the local environment and provision an authorized local operator through the [controlled runbook](../operations/operator-provisioning.md). Never overwrite an existing `.env` containing user configuration. Start API/web, sign into `/dashboard`, then use the registry panel. Auditor sees only the list; Administrator sees create/pending-wallet forms. Use unique demo references to identify a create request after a lost response; refresh before retrying. The UI warns if a write succeeds but the subsequent reload fails. There is no idempotency-key contract yet; a duplicate reference/address is a conflict, not a second successful creation.

## Testing and limits

Run `npm run test --workspace @lifecycle-kase/api` and `npm run check`. Tests cover validation, defaults, read/write role boundaries, missing sessions, origin checks, rate limiting, duplicate mapping, audit transaction failure and bounded pagination with mocked Prisma. These are not real database concurrency/rollback proofs. Real PostgreSQL integration and browser acceptance remain pending while Docker is stopped.

This slice does not implement update/close, eligibility approval, wallet ownership challenge/verification, revocation, downloads or issuer-scoped multi-tenant access. It is for a single demo workspace. Pending wallets are not usable by the verified snapshot collector. Before enabling changes to verified status/eligibility, add snapshot-window locking or historical versioning; creation of unreviewed identities/pending localnet wallets does not implement those transitions. Public Devnet and real-money work are deferred under [ADR-014](../decisions/ADR-014-local-mvp-before-public-network.md).
