# Owner Localnet entitlement acceptance — 2026-10-09

Status: partial acceptance; FINALIZE retained for checking at the owner's request. This record covers the retained owner's Phantom registration/reset/finalization gate, not funding, action approval, payment, burn or complete MVP acceptance.

## Preserved starting point

- Localnet genesis: `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF`.
- Program: `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo`; finalized candidate hash `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d`, deployed at slot 106314, verified again at slot 128024.
- LKA26R1 ACTIVE, circulation 35; coupon `464a832a-2c55-4e22-bb7a-6be93b429c78` UNDER_REVIEW, version 6, three CALCULATED entitlements 500/1000/250 KZT-Test (1750000000 minor units).
- Action PDA: `2QEdxyHXkmkd7Lq6YivoG6iMmEmvUnMrgC3U9SWPZhaz`.
- Immutable snapshot hash: `799e44c7a9593bea19c0364cc42fa86d690b6ef6bba49f7d5f877d15dff9b76a`, effective slot 44222.
- Treasury 0; funding attempt `84805071-7904-4f84-a923-82d74490c407` PREPARED, signature absent. No funding/approval/payout is authorized by this registration run.

## Browser/API correction and regression

The first authenticated REGISTER preparation failed before signing because the API passed a nonexistent `AuditLog.entitlementId`. Prisma rejected the audit insert and the transaction rolled back. Preparation and confirmation now use the existing entity ID and blockchain-transaction link; no migration or program change is needed.

Validation performed: API build, all five focused on-chain API tests, the generated PostgreSQL action suite, Markdown links/fences and `git diff --check`. The new PostgreSQL regression reproduced the original failure before the fix and passes REGISTER → RESET → all three REGISTER → FINALIZE, signed-wire validation, audit links, audit-failure rollback and same-signature confirmation recovery. Its RPC responses are controlled fixtures; the owner signatures below provide a separate live boundary.

## Owner signatures

| Step | Operation | Finalized slot | Signature |
| --- | --- | --- | --- |
| Partial registration, 500 KZT-Test | `cbcd7ede-656a-45b5-b0cd-e542e1674bad` | 129391 | `4yHbXqmC22RMhxg2RA62gTetbZnyzxMvnNAZxRQ3zcKeGWoTVyYdQFvGs9zcK71RCVv7167c7ym8v6zHUVoiS2F4` |
| Complete partial-set RESET | `3302abb5-aaea-42a0-8bec-743fd2955cd1` | 131098 | `3iNo88MYMCBAqzSG1wUGX9NQ8mj26HiQaGqaxCWtKUzvcaSKMYtSKfh1dq3p6YYikG5UXvNw85Veezj6XqpPZViM` |
| Re-registration, 500 KZT-Test | `1b601dad-05d1-4771-a5d5-96bcdb832268` | 131267 | `3ndGRmVLip6i1gGGptdwpQCpVoivA9ZTEpGybGEEnryYB58TUYzzk9WzhZ6U8bBuM6ASkaa58kuc1yFpVfHBiZcG` |
| Registration, 1000 KZT-Test | `35da9e26-9161-401b-b00d-2988fd061152` | 131963 | `3gHVxXoXXSR5zRNb3U8ckYzMSnxANwer2da1yZk8DVCjGFYNAQnQ6T6ymz9k4GHy8QCrKd24TpGFyAUnqjvmKxvW` |
| Registration, 250 KZT-Test | `becba85a-ccdb-4edf-bdc0-a0f07295e1c0` | 132101 | `2ANFA5iQnDaw2fatVhfUsMdSgqXRQV4WxVkuy2CsZEHAHNeHAN56YCpNLtBoYMWPyQydrAkvbnpvtnEDL9YoKm2M` |

The first REGISTER was independently re-read at finalized slot 129590: canonical entitlement PDA `63xWPWMCPCVMwZkh3msA4QkNTq8g1pKe1mN1VUdePcKx`, exact recipient/10-bond balance/500000000 minor units, READY and unexecuted. Action counters are registered=1, total=500000000, processed=0. Database projection and preparation/submission/finalization audit agree. Registered and processed counters are separate.

The fresh RESET was independently re-read at finalized slot 131168: all three canonical entitlement addresses are absent, registered/total/processed counters are zero and Action PDA is SNAPSHOT_CREATED. The one confirmed database PDA projection was cleared and its version advanced to 2; calculation amounts, application UNDER_REVIEW version 6, original snapshot hash and unsigned funding remain unchanged. The exact finalized wire and all three RESET audit events agree.

## Expired signed RESET recovery

RESET attempt `26bc42f4-2b95-4599-80d3-c78f7cd1ad3b` retained signature `2FKPNS2o1hBJTfTUdnKHnuiCW757T4AUq2CP9cjPdrbxGL6g4VNYDEUj2u4Yr31HvbKrMiijb9VWfF89DxXKHimk` after RPC submission failed. Normal confirmation returned TRANSACTION_UNAVAILABLE and kept UNKNOWN_CONFIRMATION; no blind resend occurred.

Read-only reconciliation verified the original signed wire, same genesis, expired blockhash, absent transaction/signature status, readable retained history and every finalized block in the wire's entire valid lifetime. The recent blockhash was found at slot 129625 / height 129620, and last valid height was 129770: all 151 consecutive lifetime blocks were available and excluded this signature. The final sweep inspected 1534 blocks from slots 129391–130924; action read-back at slot 130927 still showed the original partial calculation/snapshot. The owner explicitly approved closing only this failed attempt. A serializable controlled Localnet transaction marked it FAILED / EXPIRED_NO_LANDING_PROVEN and appended CALCULATION_RESET_EXPIRY_RECONCILED with the proof and original signature retained. No chain transaction or action/entitlement mutation was performed by reconciliation.

This was a bounded, owner-approved OS recovery for one identified attempt using an ignored local helper. It is not a new public recovery endpoint, automatic retry or proof that pruned/partial history can be treated as failure. The normal API continues to hold unresolved signed attempts for confirmation. Preparing/signing a new RESET remains a separate owner action.

## Expired signed FINALIZE — retained at owner request

FINALIZE attempt `436213b5-cd0c-44f9-8fb3-9547ec91b496` retained signature `vurkNSEfgrTLB9xyE9uXi5PcMB2Wms6pt6CeUJE7eprHQtysDVkwdhXC83KWjCX7Bz1hetiw4t56diS2ism9WgY` after submission failed. Normal confirmation returned TRANSACTION_UNAVAILABLE and retained UNKNOWN_CONFIRMATION. The read-only proof inspected 588 finalized blocks, slots 132101–132688: recent blockhash slot 132291 / height 132286, last valid height 132436, all 151 consecutive lifetime blocks present, signature absent. Read-back at slot 132689 retained CALCULATED, three registered entitlements, 1750000000 minor units, processed=0 and the original snapshot. No database closure or new submission has been performed at this checkpoint; this one attempt requires explicit owner reconciliation before another FINALIZE can be prepared.

The owner selected **leave for checking** instead of the proposed one-attempt FAILED closure. The final read-only sweep inspected 761 blocks, slots 132101–132861, and reconfirmed absence across the entire lifetime. The attempt remains UNKNOWN_CONFIRMATION / TRANSACTION_UNAVAILABLE with its original signature; no close, retry or replacement preparation was performed. The complete owner gate remains open.

## Preserved checkpoint after the owner decision

At finalized slot 132863, independent read-back verified all five successful transaction wires and their three linked audit events each. All three canonical entitlement PDAs match the database, snapshot, investor IDs, receivers, balances and integer amounts; each is READY, unexecuted and has zero tokens to redeem:

| Snapshot balance | KZT-Test | Canonical entitlement PDA |
| --- | --- | --- |
| 10 | 500 | `63xWPWMCPCVMwZkh3msA4QkNTq8g1pKe1mN1VUdePcKx` |
| 20 | 1000 | `6f3YBqnBsxdc1juHMCLtqC3kSQKFRarwEfBwP6kPy2jU` |
| 5 | 250 | `7PapkkauyG1KZXfZFTdBPUf5b6taNopkz1rx5LJE5XJe` |

Chain Action PDA remains CALCULATED with registered=3, total=1750000000 and processed=0. The application remains UNDER_REVIEW version 6. Snapshot hash/effective slot are unchanged. The deployed candidate hash and authority were reverified at slot 132497. A separate finalized account set at slot 133014 verified ACTIVE instrument, bond supply 35, settlement mint supply 0, treasury 0, unsigned PREPARED funding and 19 applied migrations. These observed slots are separate checks, not one atomic cross-system snapshot.

Ignored local evidence contains the exact history proof and read-back; this document records public transaction IDs and the verified checkpoint. No source publication or additional program upgrade was performed in this continuation.

## Remaining gate

The fresh RESET and registrations of all three entitlements are confirmed. FINALIZE is held for checking under the owner's instruction; normal API recovery remains confirmation-only. Any separately authorized reconciliation must preserve the signature, proof and audit before a new exact wire can be prepared. A later successful FINALIZE must independently reconcile chain/database/audit and preserve the snapshot/application review/funding state. The [delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md) remains open.
