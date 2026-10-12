# Contributing

Read [README](README.md), the [current audit](docs/PROJECT_AUDIT_2026-10-10.md), [requirements](docs/requirements/PRODUCT_REQUIREMENTS.md), relevant [ADRs](docs/decisions/README.md) and the [testing strategy](docs/testing/testing-strategy.md) before changing a workflow. Follow applicable AGENTS.md instructions. Prefer the smallest coherent change and preserve exact signing/account/payload contracts unless the requirement explicitly changes them.

## Local changes

Use a branch such as `codex/<task>`. Install lockfile dependencies with `npm ci`; use Node.js 22+ and the pinned Rust/Anchor/Solana toolchain from the [runbook](docs/development/toolchain.md). Keep secrets, logs, generated SBF artifacts, wallets and ledgers in ignored local paths. Do not commit `.env` or keypairs.

Run relevant behavioral tests, `npm run check`, `npm run build`, `npm audit --omit=dev` and `git diff --check`. Financial changes also need isolated PostgreSQL and actual SBF/validator acceptance; Rust host tests and controlled RPC fixtures alone do not prove runtime settlement. Test both program profiles when touching shared Rust code. Verify changed Markdown links with `npm run validate`.

`npm run test:database` directly targets the Compose postgres service and ignores DATABASE_URL. Use a separate disposable Compose project or execute its SQL against a newly created disposable container. Never use the populated owner service. The other database acceptance scripts create/drop uniquely named test databases; review their host/database guards before supplying a connection string.

## Pull requests

Explain the concrete before/after behavior, validation actually performed, known limitations and any migration/compatibility effects. Update current documentation and relevant ADRs; preserve older dated evidence as history. Label fixture/disposable/owner/Render evidence separately. Publishing application source does not install an on-chain candidate or complete owner acceptance.

Report security-sensitive issues according to [SECURITY](SECURITY.md). Do not choose or assert a project license on behalf of the owner; no project-wide license grant is established here.
