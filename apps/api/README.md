# API boundary

This package contains a first internal orchestration step: `prepareSnapshotCandidate`. It reads a scheduled corporate action and Investor Registry wallet mappings through Prisma, checks the record-date grace window and expected Solana genesis hash, collects finalized Token-2022 holders, and produces canonical `snapshot-v2` bytes and SHA-256. It refuses unknown/unverified wallets, a stale instrument supply projection, unavailable slot block time, and an inactive action or instrument. A blocked but verified wallet remains in the ownership snapshot; payout eligibility is a separate decision.

This is read-only preparation, not a public HTTP endpoint. It does not authenticate an actor, lock an action, persist a pending snapshot, prepare a wallet transaction, register an on-chain commitment, or claim an operational corporate-action flow. Callers must provide a trusted current time, configured network/genesis hash, wallet network, and `SNAPSHOT_GRACE_SECONDS` (demo default: 300). A future authenticated endpoint must recheck action/version and time inside the persistence transaction before writing a candidate.

Run `npm test --workspace @lifecycle-kase/api` from the repository root. Tests use deterministic Prisma/RPC fixtures; a live mint and database-backed API integration are still pending. Administrator keys must never be stored in this service.
