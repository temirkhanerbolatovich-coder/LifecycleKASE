# Investor Registry: first local slice

Administrator and Auditor can read `GET /api/v1/investors?limit=20&cursor=<uuid>`. Pages default to 20 and are capped at 100 investors, ordered by creation time/id; the extra row determines `nextCursor`. Each investor includes a wallet count and at most 20 wallet previews. The current UI supports continuation pages but not searching or a full wallet-detail route.

Administrator alone can call:

- `POST /api/v1/investors`: `displayName` (1–200 characters), `type` (`INDIVIDUAL`/`INSTITUTIONAL`), two-letter `countryCode`, optional unique `externalReference` (1–100 characters).
- `POST /api/v1/investors/:id/wallets`: `address`, a valid Solana public key. Network is fixed to `SOLANA_LOCALNET` in this local slice.
- `POST /api/v1/investors/:id/wallets/:walletId/verification/challenge`: create a short-lived, administrator-bound ownership message for a pending localnet wallet.
- `POST /api/v1/investors/:id/wallets/:walletId/verification/verify`: submit the exact nonce and Ed25519 message signature to activate that wallet.

Unknown fields, malformed identifiers, unsupported enums and control characters are rejected server-side. New investors use `NOT_STARTED` KYC and `PENDING_REVIEW` eligibility. An unreviewed investor record can have lifecycle status `ACTIVE`, but this is not payout eligibility. Attached wallets begin `PENDING` with null verification/revocation times and become `ACTIVE` only after ownership proof. Existing wallet ownership, including operator wallets, cannot be reassigned. Missing/inactive investors fail closed. No real KYC, private keys or personal documents may be supplied; use synthetic demo labels and references only.

Every record-changing mutation inserts an actor/correlation-linked audit event in the same Serializable Prisma transaction as the state change. Unique/reference and concurrent transaction conflicts return 409; audit failure aborts the transaction. Audit metadata omits display names, country data and wallet addresses. Existing database migration guards make stored audit rows immutable. PostgreSQL uniqueness is authoritative, not the preliminary address lookup.

Wallet ownership verification requires two independent conditions: an active Administrator session authorizes the mutation, and the exact pending wallet signs a domain/origin/investor/wallet/nonce/expiry-bound message. It is not a Solana transaction. The challenge is purpose-separated from operator login, bound to the requesting Administrator and consumed atomically with `PENDING → ACTIVE`, `verifiedAt` and `INVESTOR_WALLET_OWNERSHIP_VERIFIED` audit persistence. Invalid, expired, replayed or altered proofs fail closed. Verification does not change KYC or eligibility and does not authorize payments.

Routes require enabled authentication and an unexpired operator session. Writes additionally require an exact allowed Origin and the existing per-client mutation limiter, returning 429/Retry-After on limit. Reads are Administrator/Auditor only; responses use `no-store`. The fixed Next.js same-origin proxy exposes only the implemented route paths. No token-auth bypass or automatic role provisioning is added.

## Local usage

Start Docker/PostgreSQL and apply migrations using the [README](../../README.md). Configure `AUTH_ENABLED=true`, `AUTH_DOMAIN=localhost:3000`, `AUTH_ALLOWED_ORIGINS=http://localhost:3000` for the local environment and provision an authorized local operator through the [controlled runbook](../operations/operator-provisioning.md). Never overwrite an existing `.env` containing user configuration. Start API/web, sign into `/dashboard`, then use the registry panel. Auditor sees only the list; Administrator sees create/pending-wallet forms and an ownership button for each pending wallet. Switch Phantom to the exact attached account before signing. Use unique demo references to identify a create request after a lost response; refresh before retrying. The UI warns if a write succeeds but the subsequent reload fails. There is no idempotency-key contract yet; a duplicate reference/address is a conflict, not a second successful creation.

## Testing and limits

Run `npm run test --workspace @lifecycle-kase/api` and `npm run check` for unit, schema and type checks. Run `npm run test:registry:database` with Docker PostgreSQL available for real HTTP/PostgreSQL acceptance. The runner does not load `.env`: it defaults to the local development database on port 55432, or accepts `REGISTRY_TEST_DATABASE_URL` restricted to a loopback host, that port and the `lifecycle_kase` database. The database user needs CREATE DATABASE permission. It creates a uniquely named disposable database, deploys migrations, starts an ephemeral API and signs login messages using synthetic in-memory keys. It drops only its own database in cleanup; normal local records are untouched.

The real run covers role/session/Origin boundaries, investor and pending-wallet creation, exact Ed25519 ownership proof and replay rejection, actor/correlation audit linkage, duplicate and concurrent-reference conflicts, transaction rollback on audit failure, immutable audit rows, network/status guards, cursor pagination, rate limits and logout. On 2026-10-01 all eleven acceptance groups plus cleanup passed. These are not chain settlement tests.

Migration `20261001112000_localnet_wallet_registry` permits localnet alongside Devnet in the wallet network guard while preserving ACTIVE/REVOKED timestamp requirements and excluding mainnet. Instrument and settlement-asset network guards remain unchanged. Local Compose binds PostgreSQL only to IPv4/IPv6 loopback; set `API_LISTEN_HOST=127.0.0.1` for local API use. The API defaults to `0.0.0.0` when unset to preserve hosting compatibility.

The owner confirmed a real Phantom login, profile and registry panel at `http://localhost:3000/dashboard` on 2026-10-01. Browser form creation/attachment/ownership signing, Auditor presentation and extension recovery are not yet manually accepted; automatic HTTP coverage does not substitute for those checks.

This slice does not implement update/close, eligibility approval, wallet revocation/blocking, downloads or issuer-scoped multi-tenant access. It is for a single demo workspace. Pending wallets are not usable by the verified snapshot collector. Activation records an immutable `verifiedAt`; existing snapshot collection excludes a wallet verified after the effective finalized slot. Revocation/blocking still needs historical versioning or a snapshot-window lock before implementation. Public Devnet and real-money work are deferred under [ADR-014](../decisions/ADR-014-local-mvp-before-public-network.md).
