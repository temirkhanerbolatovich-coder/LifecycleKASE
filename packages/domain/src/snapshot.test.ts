import assert from "node:assert/strict";
import test from "node:test";

import { createSnapshotV1Commitment, type SnapshotV1Input } from "./snapshot.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

function createInput(): SnapshotV1Input {
  return {
    actionId: "e80212a6-46f1-4be1-a9a4-5f72bf85b031",
    instrumentId: "3d0cfe2d-d53c-4876-af79-b884d33e876c",
    cluster: "devnet",
    networkGenesisHash: SYSTEM_PROGRAM,
    mintAddress: WRAPPED_SOL_MINT,
    recordAt: "2026-09-28T10:00:00Z",
    solanaSlot: 123_456n,
    blockTime: "2026-09-28T10:00:02Z",
    createdAt: "2026-09-28T10:00:03Z",
    mintSupply: 35n,
    holders: [
      {
        walletAddress: TOKEN_2022_PROGRAM,
        tokenAccounts: [
          { address: WRAPPED_SOL_MINT, balance: 5n },
          { address: SYSTEM_PROGRAM, balance: 5n }
        ]
      },
      {
        walletAddress: ASSOCIATED_TOKEN_PROGRAM,
        tokenAccounts: [{ address: TOKEN_2022_PROGRAM, balance: 25n }]
      }
    ]
  };
}

test("produces identical canonical bytes regardless of RPC ordering", () => {
  const first = createInput();
  const second = createInput();
  second.holders = [...second.holders].reverse().map((holder) => ({
    ...holder,
    tokenAccounts: [...holder.tokenAccounts].reverse()
  }));

  const firstCommitment = createSnapshotV1Commitment(first);
  const secondCommitment = createSnapshotV1Commitment(second);

  assert.equal(firstCommitment.canonicalJson, secondCommitment.canonicalJson);
  assert.equal(firstCommitment.sha256, secondCommitment.sha256);
  assert.equal(
    firstCommitment.sha256,
    "6373c6313577781526756c0123d79b97508595367cd714ae8ebe9f3996cd3ad6"
  );
  assert.equal(firstCommitment.snapshot.total_balance, "35");
  assert.equal(firstCommitment.snapshot.holder_count, 2);
});

test("normalizes UTC timestamps and decimal-string amounts", () => {
  const commitment = createSnapshotV1Commitment(createInput());

  assert.equal(commitment.snapshot.record_at, "2026-09-28T10:00:00.000Z");
  assert.equal(commitment.snapshot.solana_slot, "123456");
  assert.equal(commitment.snapshot.holders[0]?.balance, "25");
});

test("rejects duplicate holders and token accounts", () => {
  const duplicateHolderInput = createInput();
  duplicateHolderInput.holders = [
    ...duplicateHolderInput.holders,
    duplicateHolderInput.holders[0]!
  ];
  assert.throws(
    () => createSnapshotV1Commitment(duplicateHolderInput),
    /Duplicate holder/
  );

  const duplicateAccountInput = createInput();
  duplicateAccountInput.holders = [
    duplicateAccountInput.holders[0]!,
    {
      ...duplicateAccountInput.holders[1]!,
      tokenAccounts: [{ address: SYSTEM_PROGRAM, balance: 25n }]
    }
  ];
  assert.throws(
    () => createSnapshotV1Commitment(duplicateAccountInput),
    /Duplicate token account/
  );
});

test("rejects zero balances and supply mismatch", () => {
  const zeroBalanceInput = createInput();
  zeroBalanceInput.holders = [
    {
      ...zeroBalanceInput.holders[0]!,
      tokenAccounts: [{ address: SYSTEM_PROGRAM, balance: 0n }]
    },
    zeroBalanceInput.holders[1]!
  ];
  assert.throws(
    () => createSnapshotV1Commitment(zeroBalanceInput),
    /must be excluded/
  );

  const mismatchInput = createInput();
  mismatchInput.mintSupply = 36n;
  assert.throws(
    () => createSnapshotV1Commitment(mismatchInput),
    /does not match mint supply/
  );
});

test("rejects non-UTC and inconsistent snapshot timestamps", () => {
  const nonUtcInput = createInput();
  nonUtcInput.recordAt = "2026-09-28T15:00:00+05:00";
  assert.throws(() => createSnapshotV1Commitment(nonUtcInput), /ending in Z/);

  const inconsistentInput = createInput();
  inconsistentInput.createdAt = "2026-09-28T09:59:59Z";
  assert.throws(
    () => createSnapshotV1Commitment(inconsistentInput),
    /recordAt <= blockTime <= createdAt/
  );
});
