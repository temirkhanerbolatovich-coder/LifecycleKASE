# Security policy

LifecycleKASE is a Localnet MVP under development. Use synthetic identities and test assets only. Mainnet, real cash, legal issuance and production KYC are outside its accepted scope. See the [security model](docs/security/security-model.md) and [current audit](docs/PROJECT_AUDIT_2026-10-10.md) for implemented controls and open gates.

## Reporting a vulnerability

Do not include private keys, seed phrases, PATs, database credentials, session cookies, personal investor data or an exploit against a live financial environment in a public issue. Use GitHub private vulnerability reporting if enabled, otherwise contact the repository owner through a private channel. Availability of a reporting channel and a response SLA are not guaranteed by this prototype.

Include the affected commit, component, prerequisite, a minimal reproduction using disposable Localnet data, expected/actual behavior and likely impact. Preserve uncertainty: a submitted signature or SQL projection is not finalized proof. For an exposed credential, revoke/rotate it through its provider; deleting source does not remove Git history.

## Required validation

Follow the [testing strategy](docs/testing/testing-strategy.md): deployed dependency audit, full-history and reviewed publishable-content secret scanning, authentication/Origin/role negatives, exact transaction verification and atomic audit rollback. Root production dependencies and the separate legacy integration harness have different audit results; never import the latter into deployed application dependencies to bypass a tool limitation.

Owner upgrades, authority changes, signing and funding require a separately reviewed operation. Never reset the preserved owner ledger or export a Phantom key to reproduce a test. Use disposable validators and generated test databases.
