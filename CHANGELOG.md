# Changelog

## Unreleased — isolated Localnet candidate, 2026-10-10

- Add atomic partial and maturity redemption: immutable source accounts, supply progress, Token-2022 payment/burn, per-entitlement receipts and final action receipts.
- Extend reviewed funding, separate approval/reserve and operator workflows to all three corporate-action types behind an independent default-off redemption flag. Preserve existing routes, database migrations and persisted account layouts.
- Add exact browser wire checks, required cash/asset reconciliation, original-signature recovery, safe zero-supply retirement and responsive read-only redemption evidence.
- Add the reproducible disposable three-action demo and optional real-browser video capture, with source-shortage, program rollback, replay, tampered-wire and audit/history recovery checks.
- Fix reviewed-source comparison after PostgreSQL JSONB reorders keys, and make signed funding submissions confirmation-only.
- Synchronize architecture, security, testing, audit, compliance and submission documentation. See [acceptance](docs/testing/kase-three-actions-2026-10-10.md) and [ADR-025](docs/decisions/ADR-025-atomic-redemption.md).

This source release does not install or enable the candidate on the retained owner ledger. Public-network, real integrations and production acceptance remain separate.
