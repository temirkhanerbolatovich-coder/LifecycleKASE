# ADR-021: Phased Phantom Localnet loader upgrade

Status: Accepted for read-only preparation and disposable runtime validation; owner execution pending
Date: 2026-10-09

## Context

The retained owner program is controlled by the Phantom issuer wallet. Its ProgramData has 290136 bytes of program capacity; the reviewed entitlement candidate needs 344640. CLI deployment with a disposable test key cannot authorize the owner program, and exporting the Phantom private key is unacceptable.

## Options considered

1. Export Phantom into a CLI keypair.
2. Ask Phantom to sign hundreds of loader buffer-write transactions.
3. Stage the reviewed ELF with an isolated Localnet uploader, verify/transfer only the buffer authority, and have Phantom sign separate exact EXTEND and UPGRADE transactions.
4. Combine extension and upgrade into one transaction.

## Decision

Use option 3 as the signing procedure under review. The production client builds only public instruction plans. Read-only preflight validates the pinned loopback/genesis, loader ownership/state, canonical ProgramData pointer, current authority, retained/candidate bytes, padded tails and rent/fee policy. It emits upgrade instructions only when an actual finalized buffer matches the candidate and Phantom authority.

Use the pinned validator's supported loader-v3 ExtendProgram (opcode 6) and Upgrade (opcode 3) as two separate v0 transactions. Each has only Phantom as signer/fee payer; Upgrade sends spill to the same wallet. Confirm EXTEND, verify retained code plus zero padding/authority/capacity, and wait for a strictly later finalized slot before preparing UPGRADE. If current capacity is already sufficient, omit EXTEND. The application must verify exact signed bytes before trusted Localnet broadcast. No instruction transfers or revokes the program upgrade authority. The shared capacity calculation respects the loader's 10 KiB minimum extension and 10 MiB account limit.

The inspected Agave 4.1.2 source/runtime does not accept SDK opcode 9 (ExtendProgramChecked), even though a historical feature entry exists. ExtendProgram does not itself enforce the upgrade authority; this plan restricts its payer to the reviewed Phantom authority and Upgrade independently enforces actual ProgramData/buffer authority. Do not infer runtime support from a newer SDK enum or a feature label.

Staging and buffer-authority transfer are separate reviewed operations. An uploader can write/close its own buffer before transfer, but has no owner-program upgrade authority. After transfer, a failed/abandoned buffer requires the owner's separate reviewed close/recovery operation. No generic arbitrary-transaction signing endpoint is introduced by this stage.

## Reasoning

The owner signs compact single-signer transactions without sharing keys. Option 4 is invalid on this runtime: extension updates ProgramData's deployment slot, and Upgrade rejects a program modified in that same slot. Exact finalized byte/account read-back remains required; a successful simulation or a wallet signature is not completion.

## Consequences

The read-only command and instruction builder are available independently of buffer staging. Missing buffer evidence produces stagingRequired=true, an empty instruction list, upgradeAuthorized=false and transactionSubmitted=false. A stopped validator, changed genesis, altered artifact/authority or insufficient extension-rent/fee reserve fails closed.

The retained-to-candidate integration harness exercises the production v0 phase builder. It rejects the combined sequence and checks its allocation/rent rollback, then confirms a separate extension preserving old code/authority, a failed separate Upgrade preserving the already extended state, and a successful Upgrade candidate hash/authority plus subsequent existing-account/instruction compatibility. This remains disposable-signer evidence; it is not Phantom or owner-ledger acceptance.

## Risks

- The buffer uploader holds a disposable Localnet key. Keep it isolated/ignored and never reuse a funded/public-network key. Do not print key material or CLI-generated recovery mnemonics.
- The staged buffer can be modified while its uploader retains authority. Final preflight must verify bytes after authority transfer and again immediately before signing/submission.
- Network/rent/fee reads occur across requests; a report is a point-in-time check. It is not a stored signed attempt or authorization.
- Exact-message preparation, persisted attempt/audit, session recovery, maintenance write exclusion and owner Phantom UI remain a separate integration gate before owner broadcast.
- A confirmed separate EXTEND remains allocated and funded if UPGRADE later fails or is abandoned. Resume using the same verified buffer/retained code; do not close the program to recover extension rent. Such a close would destroy the program.
- Upgrade changes code, not finalized business history. Code rollback cannot undo newly created entitlements or state changes.

## Future work

Integrate the reviewed plan into a restricted authenticated operator maintenance workflow with durable attempts/audit and exact signed-wire/recovery checks. Stage a separately reviewed owner buffer, then obtain the owner Phantom signature and verify candidate bytes, unchanged authority and preserved account bytes before enabling entitlement registration. Keep funding/approval/payment separate.

Primary references: [Solana upgrade mechanism](https://solana.com/docs/core/programs/program-deployment), [Agave 4.1.2 loader implementation](https://github.com/anza-xyz/agave/blob/v4.1.2/programs/bpf_loader/src/lib.rs), [loader instruction interface](https://github.com/anza-xyz/solana-sdk/blob/loader-v3-interface%40v6.1.1/loader-v3-interface/src/instruction.rs) and [loader state sizes](https://github.com/anza-xyz/solana-sdk/blob/loader-v3-interface%40v6.1.1/loader-v3-interface/src/state.rs).
