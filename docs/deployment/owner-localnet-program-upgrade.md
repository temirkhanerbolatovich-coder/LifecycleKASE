# Owner Localnet program upgrade package

Status: prepared and disposable-upgrade tested on 2026-10-08; owner transaction not submitted.

This package covers the retained owner Localnet program upgrade needed before the guarded entitlement REGISTER/RESET/FINALIZE workflow can be enabled. It does not authorize funding, calculation approval, payout, burn, Devnet deployment, or a ledger/database reset.

## Exact reviewed identities and artifacts

| Fact | Reviewed value |
| --- | --- |
| Genesis | `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF` |
| Program | `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo` |
| ProgramData | `7NagSKwRazhqVzfPm6wYJbMAUsb5Gaovz4AM5UpADukF` |
| Current upgrade authority | `5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM` |
| Current deployed binary | 290136 bytes, SHA-256 `cd502cfd217036548700c334b472b544ee7275ef1585870e4268bb34492e049b` |
| Retained local artifact | `target/deploy/lifecycle_kase.so`, same size and SHA-256 as the deployed binary |
| Upgrade candidate | `generated/localnet-candidate-reset-20261008/lifecycle_kase.so`, 344640 bytes, SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d` |

The candidate adds `register_entitlement`, `reset_calculation`, and `finalize_calculation`. Existing Instrument and CorporateAction field order and allocation are unchanged. New status variants are appended, so existing owner accounts need neither realloc nor a data migration.

## Evidence already completed

The disposable upgrade test starts the retained binary as an upgradeable program, creates a real ACTIVE instrument and a `SNAPSHOT_CREATED` action, deploys the reviewed candidate over the same program ID, and then continues against the upgraded program. It passed:

- exact MINT_SETUP, 10/20/5 DISTRIBUTION, INITIALIZE, ACTIVATE, action schedule/cancel, and snapshot before upgrade;
- byte-for-byte preservation and successful decoding of the existing Action PDA after upgrade;
- all retained authority, supply, duplicate, replay, snapshot, and relationship guards after upgrade;
- partial entitlement registration, complete-set RESET with PDA closure, exact re-registration, 500/1000/250 registration and UNDER_REVIEW finalization;
- rejection of incomplete reset/finalization, wrong authority, changed hash/amount, foreign/duplicate accounts, and 34/35 coverage.

Reproduce without touching the owner environment:

```powershell
.\scripts\test-initialize-instrument.ps1 `
  -RpcPort 18920 `
  -Profile localnet `
  -UpgradeCandidateProfile localnet-candidate-reset-20261008
```

The test uses a temporary ledger and disposable authority under WSL `/tmp`, then removes them. It does not use Phantom, the owner ledger, or the owner database.

## Required owner preflight

Immediately before any owner transaction:

1. Stop calculation writes and keep `ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED=false`.
2. Verify the RPC genesis, Program/ProgramData relationship, upgrade authority, current deployed hash, candidate hash, and current finalized slot against the table above.
3. Verify LKA26R1 remains ACTIVE and action `464a832a-2c55-4e22-bb7a-6be93b429c78` remains on-chain `SNAPSHOT_CREATED` with zero registered/processed entitlement counters.
4. Verify the database action remains UNDER_REVIEW with three stored calculations totalling `1750000000` minor units and no `onchainPda` values.
5. Verify the unsigned funding operation remains separate and has no signature. Do not combine program upgrade and treasury funding.
6. Preserve the existing stopped ledger copy and PostgreSQL dump. Check free disk space before creating any additional full ledger copy.

Any mismatch stops the upgrade and requires a new reviewed package.

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
