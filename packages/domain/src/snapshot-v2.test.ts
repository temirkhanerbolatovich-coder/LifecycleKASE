import assert from "node:assert/strict";
import test from "node:test";

import { createSnapshotV2Commitment, type SnapshotV2Input } from "./snapshot-v2.js";

const SYSTEM = "11111111111111111111111111111111";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const WRAPPED = "So11111111111111111111111111111111111111112";

function input(): SnapshotV2Input {
  return {
    actionId: "e80212a6-46f1-4be1-a9a4-5f72bf85b031",
    instrumentId: "3d0cfe2d-d53c-4876-af79-b884d33e876c",
    cluster: "devnet",
    networkGenesisHash: SYSTEM,
    mintAddress: WRAPPED,
    recordAt: "2026-09-28T10:00:00Z",
    solanaSlot: 123456n,
    blockTime: "2026-09-28T10:00:02Z",
    createdAt: "2026-09-28T10:00:03Z",
    mintSupply: 35n,
    investors: [
      {
        investorId: "00000000-0000-4000-8000-000000000001",
        eligibilityStatus: "ELIGIBLE",
        wallets: [
          {
            walletId: "00000000-0000-4000-8000-000000000011",
            walletAddress: TOKEN_2022,
            walletStatus: "ACTIVE",
            tokenAccounts: [{ address: WRAPPED, balance: 5n }]
          },
          {
            walletId: "00000000-0000-4000-8000-000000000012",
            walletAddress: ASSOCIATED,
            walletStatus: "ACTIVE",
            tokenAccounts: [{ address: SYSTEM, balance: 5n }]
          }
        ]
      },
      {
        investorId: "00000000-0000-4000-8000-000000000002",
        eligibilityStatus: "PENDING_REVIEW",
        wallets: [{
          walletId: "00000000-0000-4000-8000-000000000013",
          walletAddress: WRAPPED,
          walletStatus: "BLOCKED",
          tokenAccounts: [{ address: TOKEN_2022, balance: 25n }]
        }]
      }
    ]
  };
}

test("aggregates two wallets into one investor and produces stable canonical bytes", () => {
  const first = input();
  const reordered = input();
  reordered.investors = [...reordered.investors].reverse().map((investor) => ({
    ...investor,
    wallets: [...investor.wallets].reverse()
  }));
  const firstCommitment = createSnapshotV2Commitment(first);
  const secondCommitment = createSnapshotV2Commitment(reordered);
  assert.equal(
    firstCommitment.sha256,
    "397cc1e3aa8f500b68afdd4338628988bd5b8583ef96ac0ea5a341cd001222b8"
  );
  assert.equal(firstCommitment.sha256, secondCommitment.sha256);
  assert.equal(firstCommitment.snapshot.schema_version, "snapshot-v2");
  assert.equal(firstCommitment.snapshot.investor_count, 2);
  assert.equal(firstCommitment.snapshot.wallet_count, 3);
  assert.equal(firstCommitment.snapshot.investors[0]?.balance, "10");
  assert.equal(firstCommitment.snapshot.total_balance, "35");
});

test("rejects duplicate investor, wallet, and token account identity", () => {
  const duplicateInvestor = input();
  duplicateInvestor.investors = [
    ...duplicateInvestor.investors,
    duplicateInvestor.investors[0]!
  ];
  assert.throws(() => createSnapshotV2Commitment(duplicateInvestor), /Duplicate investor/);

  const duplicateWallet = input();
  duplicateWallet.investors = [
    duplicateWallet.investors[0]!,
    { ...duplicateWallet.investors[1]!, wallets: [duplicateWallet.investors[0]!.wallets[0]!] }
  ];
  assert.throws(() => createSnapshotV2Commitment(duplicateWallet), /Duplicate wallet/);

  const duplicateAccount = input();
  duplicateAccount.investors = [
    duplicateAccount.investors[0]!,
    {
      ...duplicateAccount.investors[1]!,
      wallets: [{
        ...duplicateAccount.investors[1]!.wallets[0]!,
        tokenAccounts: [duplicateAccount.investors[0]!.wallets[0]!.tokenAccounts[0]!]
      }]
    }
  ];
  assert.throws(() => createSnapshotV2Commitment(duplicateAccount), /Duplicate token account/);
});

test("rejects missing supply and zero balance", () => {
  const mismatch = input();
  mismatch.mintSupply = 36n;
  assert.throws(() => createSnapshotV2Commitment(mismatch), /does not match mint supply/);

  const zero = input();
  zero.investors = [{
    ...zero.investors[0]!,
    wallets: [
      { ...zero.investors[0]!.wallets[0]!, tokenAccounts: [{ address: WRAPPED, balance: 0n }] },
      zero.investors[0]!.wallets[1]!
    ]
  }, zero.investors[1]!];
  assert.throws(() => createSnapshotV2Commitment(zero), /Zero-balance/);
});
