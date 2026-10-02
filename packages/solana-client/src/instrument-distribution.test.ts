import assert from "node:assert/strict";
import test from "node:test";

import { buildInstrumentDistribution } from "./instrument-distribution.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "./instrument-mint-setup.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";

const ADMINISTRATOR = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const BOND_MINT = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const WALLETS = [
  "9bHwb1ghrc3e1ntCyrgccNHVAppbtRJu1bAwHybjpAWK",
  "6heq5Nw2ErTWsaAYxWS8ZKtzorgpNdwNNeH4QMXWD3Bk",
  "C8LAzJwa6XyecAnjC9XkSHNm28M242qBSmacUytvBKb5"
];

test("builds the canonical wallet-signed 10/20/5 Token-2022 distribution", async () => {
  const plan = await buildInstrumentDistribution({
    administrator: ADMINISTRATOR,
    bondMint: BOND_MINT,
    allocations: WALLETS.map((walletAddress, index) => ({ walletAddress, amount: [10n, 20n, 5n][index]! }))
  });

  assert.equal(plan.allocations.length, 3);
  assert.equal(plan.instructions.length, 6);
  assert.equal(new Set(plan.allocations.map(allocation => allocation.tokenAccount)).size, 3);
  for (let index = 0; index < plan.instructions.length; index += 2) {
    const create = plan.instructions[index]!;
    const transfer = plan.instructions[index + 1]!;
    assert.equal(create.programId, ASSOCIATED_TOKEN_PROGRAM_ID);
    assert.deepEqual([...create.data], [1]);
    assert.equal(transfer.programId, TOKEN_2022_PROGRAM_ID);
    assert.equal(transfer.data[0], 12);
    assert.equal(Buffer.from(transfer.data).readBigUInt64LE(1), plan.allocations[index / 2]!.amount);
    assert.equal(transfer.data[9], 0);
    assert.equal(transfer.accounts[0]?.address, plan.treasuryTokenAccount);
    assert.equal(transfer.accounts[2]?.address, plan.allocations[index / 2]!.tokenAccount);
  }
});

test("rejects non-canonical or duplicate distribution input", async () => {
  await assert.rejects(buildInstrumentDistribution({
    administrator: ADMINISTRATOR,
    bondMint: BOND_MINT,
    allocations: WALLETS.slice(0, 2).map(walletAddress => ({ walletAddress, amount: 10n }))
  }), /exactly three/);
  await assert.rejects(buildInstrumentDistribution({
    administrator: ADMINISTRATOR,
    bondMint: BOND_MINT,
    allocations: [
      { walletAddress: WALLETS[0]!, amount: 10n },
      { walletAddress: WALLETS[0]!, amount: 20n },
      { walletAddress: WALLETS[2]!, amount: 5n }
    ]
  }), /unique/);
  await assert.rejects(buildInstrumentDistribution({
    administrator: ADMINISTRATOR,
    bondMint: BOND_MINT,
    allocations: WALLETS.map((walletAddress, index) => ({ walletAddress, amount: [9n, 20n, 6n][index]! }))
  }), /exactly 10, 20, and 5/);
});
