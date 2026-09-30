# ADR-011: Domain-bound operator wallet authentication

Status: Accepted for MVP
Date: 2026-09-30

## Context

LifecycleKASE must authenticate operators without storing administrator private keys. A wallet signature must not be reusable on another origin, for another wallet, or after its short validity window. The existing database already stores users, verified wallet mappings, one-time challenges, and hashed sessions.

## Options considered

1. Store an administrator key on the API and authenticate with a password.
2. Accept any signed free-form message and return a bearer token in JSON.
3. Issue a domain/origin-bound one-time challenge, verify the Solana Ed25519 signature, and create a hashed cookie session.
4. Add an external identity provider before the first operator flow.

## Decision

Use option 3 for the MVP. A challenge is issued only to an active, verified wallet linked to an operational user role. Its message includes the configured domain, exact allowed origin, wallet address, challenge UUID, cryptographically random nonce, expiry, and a statement that signing does not authorize a transaction or payment.

The database stores only SHA-256 of the nonce and session token. Verification checks the Ed25519 signature with the wallet public key and atomically consumes the unexpired challenge before creating a short-lived session. The plaintext session token exists only in an HttpOnly, Secure-in-production, SameSite=Strict cookie. CORS accepts only configured exact origins with credentials. Authentication routes are disabled unless `AUTH_ENABLED=true`.

## Reasoning

This design uses the same wallet control that later signs prepared Solana transactions while keeping signing authority outside the backend. Binding the message to the origin and consuming the nonce limits replay. Hashing secrets reduces the impact of a read-only database disclosure.

## Consequences

- Operator wallets must be provisioned and verified before login.
- Investor wallet verification remains a separate challenge flow tied to Investor ID and network genesis hash.
- Every protected mutation must validate the session role again; successful login alone is not authorization for a specific action.
- Public deployments must configure allowed origins and secure cookies explicitly.

## Risks

- Application-level challenge rate limiting is not implemented; keep authentication disabled on public staging until an ingress or application limit is configured.
- A compromised authorized wallet can authenticate until the wallet mapping is revoked.
- SameSite cookies are not a replacement for checking the exact Origin on every state-changing request.
- The current slice does not yet write authentication audit events or provide an operator-provisioning UI.

## Future work

- Extend the implemented Wallet Standard login panel with snapshot transaction signing/submission and explicit transaction review.
- Add rate limiting, authentication audit events, session cleanup, and controlled operator provisioning.
- Add reusable authorization guards for role- and issuer-scoped domain endpoints.
- Implement the separate Investor ID wallet proof flow with genesis-hash binding.
