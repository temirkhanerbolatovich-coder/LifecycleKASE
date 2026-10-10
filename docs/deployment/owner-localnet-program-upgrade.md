# Owner Localnet program upgrade package

October 10 audit: the manifest remains pinned to the registration/reset candidate accepted on October 9. It is not the newer approval/coupon artifact. Owner API/RPC were unavailable for fresh chain verification; SQL still has VERIFIED maintenance and held UNKNOWN_CONFIRMATION FINALIZE. Partial REGISTER/RESET/three REGISTER acceptance is in the [owner record](../testing/owner-entitlements-2026-10-09.md). Any newer candidate requires a separate review and owner rollout decision. See the [current audit](../PROJECT_AUDIT_2026-10-10.md).

Status: owner EXTEND/UPGRADE accepted on the preserved Localnet on 2026-10-09.

2026-10-09 owner continuation: a fresh readable PostgreSQL dump was retained before migration, migration `20261009120000_program_upgrade_maintenance` brought the preserved owner database to 19 migrations, and the local API capability was enabled with entitlement registration still false. Disposable uploader `9Pyj44FgsTP64x2wMS8j18sg5RXUoxFi2gBHd7yCzpwT` staged buffer `HLxhbJC8W6acMXxf7Ghs1Gg9stdTSmbAitQjW7wbWSqW`, verified the complete 344640-byte candidate hash, then transferred buffer authority to the existing Phantom address. Strict finalized preflight at slot 102338 selected EXTEND. The retained program/code, ProgramData authority, LKA26R1 accounts, UNDER_REVIEW calculation and unsigned funding attempt remained unchanged. The first authenticated preparation was rejected before creating maintenance because an older DRAFT LKA26 mint-setup attempt remained `UNKNOWN_CONFIRMATION`. Same-genesis full-history and blockhash checks proved that the recorded `TRANSACTION_UNAVAILABLE` attempt cannot newly land, so the guard was narrowed without rewriting that historical row. No maintenance attempt or owner-signed loader transaction had been created; authenticated Chrome/Phantom review remains the next gate.

2026-10-09 subsequent integration checkpoint: the [restricted maintenance API/dashboard](../features/program-upgrade-maintenance.md) was implemented with durable phase attempts, exact-message signing, expiry/reload recovery, atomic audit and a database business-write lock spanning EXTEND and UPGRADE. [ADR-022](../decisions/ADR-022-durable-program-upgrade-maintenance.md) records this boundary. At that checkpoint the retained owner database/program had not been migrated/upgraded and owner buffer staging, feature enablement and Phantom acceptance were pending. Earlier preparation observations below remain dated evidence.

2026-10-09 continuation: a [public pinned manifest](owner-localnet-upgrade-plan.json), read-only preflight and production single-signer EXTEND/UPGRADE phase builders have been added. The signing design and runtime constraints are recorded in [ADR-021](../decisions/ADR-021-phantom-localnet-program-upgrade.md). The restricted owner signing/persisted-attempt UI is still a separate pending integration gate; the command below never stages, signs or broadcasts.

This package covers the retained owner Localnet program upgrade needed before the guarded entitlement REGISTER/RESET/FINALIZE workflow can be enabled. It does not authorize funding, calculation approval, payout, burn, Devnet deployment, or a ledger/database reset.

## Owner acceptance — 2026-10-09

The authenticated owner flow finalized EXTEND at slot 105978 with signature `2G54MnWLaoa6g2xG3fik5b2Yg6YJUN3sGyC2RxrweGK3betmoRyfYJQxbfJZocSbyYLjmGTMaCky2NSPqkPevGX`, increasing ProgramData capacity from 290136 to 344640 bytes while retaining the old code and authority. A separate UPGRADE finalized at slot 106314 with signature `j123YBpdrp5uF25VKgyWeJpN4yCWfndVDfJaJ1Jzbkk8CAbMZa1Yfk7UjiyenaGuxEb7K4DKRh6yRXn6i2Ypr32`.

Post-upgrade finalized read-back matched candidate SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d`, the same Program/ProgramData pointer and Phantom authority, consumed buffer, and the same protected-account digest recorded before both phases. Maintenance `a19a0171-c8bc-4c52-a2e3-b38285b73717` is `VERIFIED`. At finalized slot 107691, LKA26R1 remained ACTIVE 35/35 and Action PDA `2QEdxyHXkmkd7Lq6YivoG6iMmEmvUnMrgC3U9SWPZhaz` remained SNAPSHOT_CREATED with the original snapshot hash, balance 35 and zero registered/processed entitlements. PostgreSQL remained UNDER_REVIEW version 6 with three CALCULATED rows totalling 1750000000 minor units and no on-chain entitlement addresses. Funding remained unsigned. REGISTER/RESET/FINALIZE is the next separate owner gate.

## Pre-upgrade reviewed identities and artifacts (historical)

| Fact | Reviewed value |
| --- | --- |
| Genesis | `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF` |
| Program | `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo` |
| ProgramData | `7NagSKwRazhqVzfPm6wYJbMAUsb5Gaovz4AM5UpADukF` |
| Current upgrade authority | `5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM` |
| Deployed binary before October 9 upgrade | 290136 bytes, SHA-256 `cd502cfd217036548700c334b472b544ee7275ef1585870e4268bb34492e049b` |
| Retained local artifact | `target/deploy/lifecycle_kase.so`, same size and SHA-256 as the pre-upgrade binary |
| Upgrade candidate | `generated/localnet-candidate-reset-20261008/lifecycle_kase.so`, 344640 bytes, SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d` |

The candidate adds `register_entitlement`, `reset_calculation`, and `finalize_calculation`. Existing Instrument and CorporateAction field order and allocation are unchanged. New status variants are appended, so existing owner accounts need neither realloc nor a data migration.

## Evidence already completed

The disposable upgrade test starts the retained binary as an upgradeable program, creates a real ACTIVE instrument and a `SNAPSHOT_CREATED` action, deploys the reviewed candidate over the same program ID, and then continues against the upgraded program. It passed:

- exact MINT_SETUP, 10/20/5 DISTRIBUTION, INITIALIZE, ACTIVATE, action schedule/cancel, and snapshot before upgrade;
- byte-for-byte preservation and successful decoding of the existing Action PDA after upgrade;
- all retained authority, supply, duplicate, replay, snapshot, and relationship guards after upgrade;
- partial entitlement registration, complete-set RESET with PDA closure, exact re-registration, 500/1000/250 registration and UNDER_REVIEW finalization;
- rejection of incomplete reset/finalization, wrong authority, changed hash/amount, foreign/duplicate accounts, and 34/35 coverage.

2026-10-09 phased-loader continuation passed all 41 disposable runtime groups using the production v0 builder:

- a combined valid EXTEND/UPGRADE is rejected at Upgrade and rolls back ProgramData allocation/rent;
- a separately finalized EXTEND retains old code, zero-fills the extension and preserves authority;
- a failed separate UPGRADE preserves the confirmed extended ProgramData/rent for recovery;
- a successful separate UPGRADE matches the pinned candidate hash, retains authority, consumes its buffer and preserves the existing Action PDA bytes; the full subsequent entitlement RESET/registration/finalization and 34/35 rejection checks pass.

Local validation at this checkpoint: `npm run check` passed 244 tests (API 95, web 33, domain 27, client 42, root 47), schema/types and 63 Markdown files; `npm run build` passed API/web/domain/client; `npm audit --omit=dev` reported zero vulnerabilities. Publishable-source and staged Gitleaks scans passed. Fresh owner preflight at finalized slot 92526 and database/chain read-back at slot 92624 still match retained code and the unsigned owner checkpoint. These observations precede GitHub CI publication and do not claim Render or owner upgrade acceptance.

Reproduce without touching the owner environment:

```powershell
.\scripts\test-initialize-instrument.ps1 `
  -RpcPort 18920 `
  -WslUser lifecycle-dev `
  -Profile localnet `
  -UpgradeCandidateProfile localnet-candidate-reset-20261008
```

The example uses this checkout's non-root WSL toolchain user `lifecycle-dev`; select your configured toolchain user elsewhere. The test uses a temporary ledger and disposable authority under WSL `/tmp`, then removes them. It does not use Phantom, the owner ledger, or the owner database.

## Required owner preflight

Immediately before any owner transaction:

1. Stop calculation writes and keep `ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED=false`.
2. Verify the RPC genesis, Program/ProgramData relationship, upgrade authority, current deployed hash, candidate hash, and current finalized slot against the table above.
3. Verify LKA26R1 remains ACTIVE and action `464a832a-2c55-4e22-bb7a-6be93b429c78` remains on-chain `SNAPSHOT_CREATED` with zero registered/processed entitlement counters.
4. Verify the database action remains UNDER_REVIEW with three stored calculations totalling `1750000000` minor units and no `onchainPda` values.
5. Verify the unsigned funding operation remains separate and has no signature. Do not combine program upgrade and treasury funding.
6. Preserve the existing stopped ledger copy and PostgreSQL dump. Check free disk space before creating any additional full ledger copy.

Any mismatch stops the upgrade and requires a new reviewed package.

### Repeatable program preflight

```powershell
npm run localnet:upgrade:preflight
# Only after a reviewed buffer has been staged and its authority transferred:
npm run localnet:upgrade:preflight -- --buffer PUBLIC_BUFFER_ADDRESS
```

The command accepts no key, signer or transaction arguments. It checks retained/candidate ELF size/hash, plain loopback RPC, exact genesis, canonical ProgramData pointer, loader owner/executable flags, current upgrade authority, current deployed bytes including zero padding, and sufficient authority balance for extension rent plus a policy fee reserve. With a buffer it also verifies finalized loader state, authority and complete candidate bytes before emitting public instruction hex/accounts. Without a buffer it reports `stagingRequired=true` and emits no instructions. Both forms report `upgradeAuthorized=false` and `transactionSubmitted=false`.

Earlier read-only owner observation on 2026-10-09, before buffer staging: capacity 290136, required extension 54504, additional ProgramData rent 379347840 lamports (0.37934784 Localnet SOL), policy fee reserve 5000000 lamports and authority balance 99975370320 lamports. These costs/balances are point-in-time readings, not a signed fee quote or payment. The old owner action remains UNDER_REVIEW in PostgreSQL and SNAPSHOT_CREATED on-chain; funding remains unsigned PREPARED. Historical SCHEDULE and REGISTER_SNAPSHOT bytes are now pruned from the owner RPC; their earlier acceptance records are historical evidence, and this preflight does not invent fresh transaction proof.

### Wallet signing procedure under preparation

1. Complete the owner-state/backups checks above and exclude other calculation/chain writes during maintenance.
2. Prepare a distinct disposable Localnet uploader and buffer. Review their public addresses, candidate hash, buffer rent/upload fees and any faucet request before staging. Do not use Phantom's key, the compromised localnet program key or a public-network authority.
3. Upload only the exact pinned candidate with explicit `solana program write-buffer` RPC/payer/buffer arguments. Verify finalized buffer bytes/hash before transferring the buffer authority to the existing Phantom address. Do not change ProgramData authority.
4. Re-run buffer preflight. Show Localnet genesis, program, ProgramData, candidate hash, buffer/authority, fee payer, spill receiver, extension bytes/rent and exact instruction accounts before signing.
5. The client first builds a separate `EXTEND` v0 wire using this validator's supported `ExtendProgram` instruction (opcode 6), explicit compute budget and Phantom as its only payer/signer. Confirm finalized capacity, rent, unchanged authority and retained code with zero padding. Wait until finalized slot is strictly later than this extension's slot, then repeat buffer preflight to prepare the separate `UPGRADE` v0 wire. Combining both instructions is rejected by the loader's same-slot rule. The newer SDK's checked opcode 9 is not supported by this inspected runtime.
6. Use the restricted maintenance integration to persist each exact phase/attempt/audit before Phantom, verify signed message/Ed25519 signer before Localnet broadcast and retain any ambiguous signature for confirmation-only recovery. The ACTIVE maintenance lock spans phases and survives restarts; only successful candidate/authority/buffer/protected-account acceptance plus atomic audit releases it. Neither phase changes/revokes program authority, closes the program or performs a financial operation. Failed UPGRADE retains confirmed extension/rent. Owner review and disposable acceptance precede any retained-ledger loader broadcast.

## Signing boundary

The owner upgrade authority is a Phantom address. The Solana CLI used in the disposable test signs with a local disposable keypair and therefore cannot be reused with the owner authority. Do not export the Phantom seed or private key into the CLI, repository, environment variables, logs, or chat.

The owner upgrade requires a separately reviewed Phantom-compatible procedure. It must show the exact Localnet genesis, program ID, current ProgramData authority, candidate SHA-256, buffer address/authority, program-data extension cost, fee payer, and every transaction before signature. The standard loader flow stages bytes in a buffer and then replaces ProgramData; interruption can leave a recoverable buffer. Solana documents that the Program account pointer remains unchanged and the upgraded bytecode becomes effective in the next slot: [Program Deployment](https://solana.com/docs/core/programs/program-deployment).

No authority transfer, buffer write, program extension, or upgrade transaction is authorized by this document.

## Post-upgrade acceptance

Keep the application feature flag disabled until all checks pass:

1. Confirm the upgrade transaction at `finalized`, wait at least one additional slot, and re-read ProgramData.
2. Dump deployed bytes and require SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d`.
3. Require the ProgramData address and upgrade authority to remain exactly unchanged.
4. Re-read LKA26R1 and its Action PDA; compare all pre-upgrade account bytes and decoded fields.
5. Run read-only API/dashboard health and owner budget/state checks.
6. Enable `ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED=true`, restart API/web, then prepare and sign one REGISTER operation at a time through Phantom.
7. Exercise RESET after one registered row, confirm the PDA is closed and counters return to zero, then re-register all three rows and FINALIZE.
8. Require exact finalized messages, three canonical Entitlement PDAs, Action total `1750000000`, status UNDER_REVIEW, atomic database projections, and audit records.
9. Leave calculation approval and funding pending until their separate reviewed gates are satisfied.

## Rollback limits

While the upgrade authority remains set, the retained binary can be deployed again as a code rollback. This does not undo state changes already made by new instructions. In particular, finalized entitlement creation/reset/finalization and database/audit projections require their own reconciliation; restoring program bytes or a database dump cannot reverse finalized chain history. For that reason, the first owner operation after upgrade is read-only verification, followed by the bounded REGISTER → RESET recovery acceptance before full registration.

The upgrade authority must not be revoked or transferred as part of this stage. Making the program immutable is permanent.
