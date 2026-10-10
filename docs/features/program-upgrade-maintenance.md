# Localnet program upgrade maintenance

Implemented and owner-accepted on 2026-10-09. The maintenance migration is applied to the preserved local acceptance database; separate owner Phantom EXTEND and UPGRADE transactions finalized, the pinned candidate was read back, and maintenance is `VERIFIED`. The feature defaults to disabled and never loads a private key. Use the [reviewed owner package](../deployment/owner-localnet-program-upgrade.md) before enabling it in another environment. The maintenance decision is recorded in [ADR-022](../decisions/ADR-022-durable-program-upgrade-maintenance.md).

## Configuration and signing

Apply migration `20261009120000_program_upgrade_maintenance` before starting this API revision. Enable `LOCALNET_PROGRAM_UPGRADE_ENABLED=true` only with a supported loopback `API_LISTEN_HOST`, `SOLANA_CLUSTER=localnet`, and `ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED=false`. The configured RPC/program/genesis must exactly match `docs/deployment/owner-localnet-upgrade-plan.json`; both reviewed ELF artifacts must exist on this host. Missing/false disables the panel; invalid enabling configuration stops API startup. Render must keep it disabled.

Stage and review the buffer separately. HTTP cannot upload a program, change an authority, choose an artifact/manifest/RPC, or supply arbitrary instructions. EXTEND increases ProgramData capacity while preserving retained code. After finalized extension and a later finalized slot, UPGRADE installs the candidate. Both v0 phases have explicit compute budget, zero priority price and the same reviewed wallet as the only signer, fee payer and spill recipient. The [loader checks upgrade/buffer authority and makes upgraded code effective in the next slot](https://solana.com/docs/core/programs/program-deployment).

## API and operator flow

All routes require an operator session. Administrator and Auditor may read; only Administrator with the exact upgrade-authority wallet may mutate. Mutations enforce Origin and rate limits.

- `GET /api/v1/program-upgrade`: capability, finalized public preflight and latest saved attempt.
- `POST /api/v1/program-upgrade/prepare`: `{bufferAddress}` only. Verify ELF hashes/lengths, loopback genesis, loader pointer/authority, retained bytes, exact buffer bytes/authority, extension rent and exact message fee plus policy reserve. Persist maintenance, exact unsigned phase and actor audit.
- `POST /api/v1/program-upgrade/submit`: `{operationId,signedTransactionBase64}` only. Rebuild stored instructions; recheck program/protected accounts/blockhash; verify exact message and Ed25519 signer. Persist signature/audit before trusted broadcast.
- `POST /api/v1/program-upgrade/confirm`: `{operationId,signature}` only. Require successful finalized exact transaction bytes and later-slot account reads. Save phase status and audit atomically. EXTEND retains maintenance; UPGRADE releases it only after exact candidate hash, unchanged pointer/authority, consumed buffer and preserved program accounts.

The dashboard shows network/program/ProgramData, buffer, signer/payer/spill, candidate/current hashes, extension bytes, rent, fee and reserve. It parses the complete unsigned message: exactly two fixed compute-budget instructions plus the reviewed loader instruction, exact accounts/privileges, one fee-payer signer, no lookup tables or extra instructions. Immediately before Phantom, a fresh prepare must return the same wire/operation; otherwise review resets. This checks server-produced plans; it cannot protect against compromise of the served application itself.

## Durable maintenance and failure behavior

`ProgramUpgrade(ACTIVE)` blocks business writes between phases and after interruption, failed transactions or lost responses. A global HTTP guard gives a clear 409. PostgreSQL triggers also block registry, instrument, action, snapshot, entitlement, settlement, receipt, job, idempotency and non-upgrade transaction writes, including in-flight requests and another API instance. An advisory transaction lock serializes maintenance creation with business writes. Authentication, read-only access and upgrade recovery remain available. Signed unresolved business attempts block maintenance unless the same finalized genesis freshly proves that a previously recorded `TRANSACTION_UNAVAILABLE` signature is absent from full RPC history and its blockhash is expired. This exception only proves that the old transaction cannot newly land; it preserves the historical `UNKNOWN_CONFIRMATION` row and does not claim retrospective finalization. Existing unsigned funding stays separate and frozen.

Preparation hashes the bytes, address, lamports and length of every program-owned account at one finalized context. The exact sorted set must match before submission and after each phase. This proves account preservation, not approval/payment or retrospective transaction history.

Each saved phase links an existing `BlockchainTransaction` to maintenance. Partial unique indexes enforce one ACTIVE session and one unresolved phase. Expired unsigned phases become FAILED with an expiry audit and may be replaced after fresh review. Signed/unknown phases remain confirmation-only, even after expiry or buffer consumption. There is no automatic rebroadcast or new signing prompt. The browser saves the public signature in session storage before submission and restores it after reload; it stores no signed wire, seed, key or session token.

Preparation/finalization audit failures roll back database changes. A lost broadcast response retains the original UNKNOWN_CONFIRMATION signature. Missing/pruned bytes cannot finalize or release maintenance. Changed genesis/artifact/authority/manifest/buffer/PDA facts block progress. A failed UPGRADE leaves confirmed extension rent allocated. No automatic cancel/unlock or destructive rollback endpoint exists; ambiguous recovery needs separate reviewed evidence. Restoring code/database cannot undo finalized history.

Database locks cannot stop direct wallet/CLI transactions or writers using another database. Exclude independent chain writers and use one reviewed deployment/database during maintenance. Capability disable/restart does not remove an ACTIVE lock. Enabling entitlement registration remains a separate operator decision after owner acceptance.

## Verification and limits

`npm run check` covers client/API/browser contracts and configuration. `npm run test:upgrade:database` ignores `.env` and creates/migrates/drops only a generated `upgrades_test_<uuid>` database on an explicit loopback base connection. Set `UPGRADE_TEST_DATABASE_URL` or explicit `DATABASE_URL` for the test server. Standalone mode uses signed synthetic RPC responses with real PostgreSQL; it is not validator evidence.

The retained-to-candidate validator harness also runs the production service against a real disposable validator through an ephemeral loopback proxy and generated PostgreSQL database:

```powershell
$env:UPGRADE_TEST_DATABASE_URL = 'postgresql://lifecycle_kase:local_development_only@[::1]:55433/lifecycle_kase?schema=public'
$env:ACTION_TEST_DATABASE_URL = $env:UPGRADE_TEST_DATABASE_URL
$env:WSLENV = (($env:WSLENV, 'UPGRADE_TEST_DATABASE_URL', 'ACTION_TEST_DATABASE_URL') | Where-Object { $_ }) -join ':'
.\scripts\test-initialize-instrument.ps1 -RpcPort 18940 -WslUser lifecycle-dev -Profile localnet -UpgradeCandidateProfile localnet-candidate-reset-20261008
```

Choose the explicit port/user/artifact profiles for your test host. The harness builds API/client, restricts disposable keys to its own `/tmp` directory, rejects retained owner genesis, and never reads Phantom. It exercises concurrent preparation/submission, unsigned expiry, exact signatures, lost-response/reload, audit rollback, persistent maintenance, failed-upgrade recovery, candidate hash and PDA preservation. This does not close owner Phantom/browser or retained-ledger acceptance. Funding remains deferred.

2026-10-09 acceptance: the full repository check passed 252 tests (API 100, web 36, domain 27, client 42, root 47), schema/types and 65 Markdown files. Production API/web builds, root production dependency audit (zero vulnerabilities), publishable-source Gitleaks and `git diff --check` passed. Both standalone synthetic-RPC/real-PostgreSQL recovery and the real disposable-validator/service/PostgreSQL upgrade passed. The complete post-upgrade compatibility suite also passed: issuance/activation, all action types, snapshot, isolated funding, entitlement RESET/re-registration/UNDER_REVIEW, distinct CA authority and 34/35 rejection. Owner preflight/state were read only; the owner program/database/funding were not changed. Browser/Phantom owner acceptance and publication of these local changes were not performed.

Later on 2026-10-09, a fresh readable PostgreSQL backup was retained, migration `20261009120000_program_upgrade_maintenance` brought the owner database to 19 migrations, and buffer `HLxhbJC8W6acMXxf7Ghs1Gg9stdTSmbAitQjW7wbWSqW` was staged with 344640 candidate bytes and authority `5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM`. Strict preflight at finalized slot 102338 matched candidate SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d` and selected EXTEND. The retained program bytes, LKA26R1 state and unsigned funding plan remained unchanged. No maintenance row, owner signature, EXTEND or UPGRADE transaction existed at this checkpoint.

The first authenticated owner preparation exposed one older LKA26 `INSTRUMENT_MINT_SETUP` row as an over-broad blocker. That DRAFT instrument's attempt remains `UNKNOWN_CONFIRMATION/TRANSACTION_UNAVAILABLE`; current same-genesis RPC reports no signature and an expired blockhash. Preparation now rechecks those exact facts under the maintenance advisory lock and otherwise fails closed. The historical row was not rewritten, and the rejected preparation created no maintenance or loader transaction.

Owner acceptance then finalized EXTEND signature `2G54MnWLaoa6g2xG3fik5b2Yg6YJUN3sGyC2RxrweGK3betmoRyfYJQxbfJZocSbyYLjmGTMaCky2NSPqkPevGX` at slot 105978 and UPGRADE signature `j123YBpdrp5uF25VKgyWeJpN4yCWfndVDfJaJ1Jzbkk8CAbMZa1Yfk7UjiyenaGuxEb7K4DKRh6yRXn6i2Ypr32` at slot 106314. Finalized read-back matched candidate SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d`, preserved ProgramData authority and protected-account hash, consumed the buffer and released the lock as `VERIFIED`. LKA26R1 remained ACTIVE 35/35; its Action PDA retained snapshot hash `799e44c7a9593bea19c0364cc42fa86d690b6ef6bba49f7d5f877d15dff9b76a`, status SNAPSHOT_CREATED and zero registration/processing counters. Funding remained unsigned.
