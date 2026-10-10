import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { buildRedemptionExecution, encodePublicKey, fundingTreasuryIndex, serializeUnsignedInstructionsTransaction, TOKEN_2022_PROGRAM_ID } from "@lifecycle-kase/solana-client";
import { getRedemptionExecution, prepareRedemptionExecution, redemptionExecutionEnabled, verifyRedemptionBurnHistory, requireReviewedBurnAccounts } from "./redemption-execution.js";
import { redemptionBurnAllocation, redemptionRetiresInstrument, redemptionTokenSources, requireRedemptionSupply } from "./redemption-sources.js";

const options = { enabled: false, cluster: "localnet" as const, expectedGenesisHash: "", programId: "", rpcEndpoint: "http://127.0.0.1:1", rpcTimeoutMs: 1000 };
test("reviewed burn accounts survive PostgreSQL JSONB key ordering while rejecting any changed source or balance", () => {
  const current = [{ address: "source-a", walletAddress: "holder-a", balanceAtSnapshot: "10", burnAmount: "2", balanceBefore: "10", expectedBalanceAfter: "8" },
    { address: "source-b", walletAddress: "holder-b", balanceAtSnapshot: "5", burnAmount: "0", balanceBefore: "5", expectedBalanceAfter: "5" }];
  const jsonb = JSON.parse(JSON.stringify(current.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))));
  requireReviewedBurnAccounts(current, jsonb);
  for (const field of Object.keys(current[0]!)) {
    const changed = structuredClone(jsonb); changed[0][field] = "changed";
    assert.throws(() => requireReviewedBurnAccounts(current, changed), { code: "REDEMPTION_BALANCE_CHANGED" });
  }
  for (const changed of [jsonb.slice(1), [...jsonb].reverse(), [...jsonb, jsonb[0]], [{ ...jsonb[0], balanceBefore: 10 }, jsonb[1]]]) {
    assert.throws(() => requireReviewedBurnAccounts(current, changed), { code: "REDEMPTION_BALANCE_CHANGED" });
  }
});
test("redemption execution is independent of coupon enablement and stays disabled unless its own reviewed approval candidate is enabled", () => {
  assert.equal(redemptionExecutionEnabled({ COUPON_EXECUTION_ENABLED: "true", ACTION_APPROVAL_RESERVE_ENABLED: "true" }), false);
  for (const value of ["1", "TRUE", "true"]) assert.throws(() => redemptionExecutionEnabled({ REDEMPTION_EXECUTION_ENABLED: value }));
  assert.equal(redemptionExecutionEnabled({ REDEMPTION_EXECUTION_ENABLED: "true", ACTION_APPROVAL_RESERVE_ENABLED: "true" }), true);
});
test("disabled redemption reads and mutations never touch database or RPC", async () => {
  const database = new Proxy({}, { get: () => { throw new Error("Unexpected database access"); } }) as PrismaClient;
  const rpc = { request: async () => { throw new Error("Unexpected RPC access"); } };
  assert.deepEqual(await getRedemptionExecution(database, rpc, "", options), { enabled: false });
  await assert.rejects(prepareRedemptionExecution(database, rpc, "", {}, { id: "", walletAddress: "", correlationId: "" }, options), { code: "REDEMPTION_EXECUTION_DISABLED" });
});
test("multi-wallet redemption commits all accounts and allocates aggregate rounding in canonical order", () => {
  const investors = [{ id: "investor", balance: 10n, wallets: [
    { walletAddress: "wallet-b", tokenAccounts: [{ address: "c", balance: 5n }] },
    { walletAddress: "wallet-a", tokenAccounts: [{ address: "b", balance: 3n }, { address: "a", balance: 2n }] }
  ] }];
  const sources = redemptionTokenSources(investors, "investor");
  assert.deepEqual(sources.map(value => value.address), ["a", "b", "c"]);
  assert.deepEqual(redemptionBurnAllocation(sources, 4n).map(value => value.burnAmount), [2n, 2n, 0n]);
  assert.deepEqual(redemptionBurnAllocation(sources, 10n).map(value => value.burnAmount), [2n, 3n, 5n]);
  assert.throws(() => redemptionBurnAllocation(sources, 11n));
  assert.throws(() => redemptionBurnAllocation(sources, 0n));
});
test("source preparation rejects missing, duplicate, zero, oversized or incomplete committed accounts", () => {
  const make = (values: { address: string; balance: bigint }[], balance = 10n) => [{ id: "i", balance, wallets: [{ walletAddress: "w", tokenAccounts: values }] }];
  for (const investors of [make([]), make([{ address: "a", balance: 9n }]), make([{ address: "a", balance: 5n }, { address: "a", balance: 5n }]),
    make([{ address: "a", balance: 10n }, { address: "b", balance: 0n }]), make(Array.from({ length: 9 }, (_, i) => ({ address: String(i), balance: 1n })), 9n)]) {
    assert.throws(() => redemptionTokenSources(investors, "i"), { code: "REDEMPTION_SOURCES_INVALID" });
  }
  assert.throws(() => redemptionTokenSources(make([{ address: "a", balance: 10n }]), "other"));
});
test("mint supply checks reject overlapping stale actions and external burns", () => {
  assert.equal(requireRedemptionSupply(35n, 0n, 35n, 2n), 33n);
  assert.equal(requireRedemptionSupply(35n, 7n, 28n), 28n);
  assert.equal(requireRedemptionSupply(28n, 24n, 4n, 4n), 0n);
  for (const args of [[35n, 0n, 28n, 2n], [35n, 7n, 27n, 2n], [28n, 24n, 4n, 5n], [28n, -1n, 29n, 1n]]) {
    assert.throws(() => requireRedemptionSupply(args[0]!, args[1]!, args[2]!, args[3]!), { code: "REDEMPTION_SUPPLY_CHANGED" });
  }
});
test("full early redemption retires the instrument just like maturity, while partial early redemption remains active", () => {
  assert.equal(redemptionRetiresInstrument("EARLY_REDEMPTION", 28n), false);
  assert.equal(redemptionRetiresInstrument("EARLY_REDEMPTION", 0n), true);
  assert.equal(redemptionRetiresInstrument("BOND_REDEMPTION", 0n), true);
  assert.throws(() => redemptionRetiresInstrument("BOND_REDEMPTION", 1n));
  assert.throws(() => redemptionRetiresInstrument("EARLY_REDEMPTION", -1n));
  assert.throws(() => redemptionRetiresInstrument("COUPON_PAYMENT", 0n));
});

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const wallet = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const mint = "B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF";
test("burn evidence requires every committed source's exact zero-decimal finalized history including zero allocation", async () => {
  const accountA = encodePublicKey(Buffer.alloc(32, 11)); const accountB = encodePublicKey(Buffer.alloc(32, 12)); const bondMint = encodePublicKey(Buffer.alloc(32, 13));
  const sources = [{ address: accountA, wallet, balanceAtSnapshot: 3n }, { address: accountB, wallet, balanceAtSnapshot: 7n }].sort((a, b) => a.address < b.address ? -1 : 1);
  const plan = await buildRedemptionExecution({ programId: PROGRAM, instrumentId: Buffer.alloc(16, 1), actionId: Buffer.alloc(16, 2),
    investorId: Buffer.alloc(16, 3), corporateActionAuthority: wallet, bondMint, settlementMint: mint, settlementWallet: wallet,
    idempotencyHash: "a".repeat(64), tokenAccounts: sources });
  const wire = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: wallet, recentBlockhash: mint, lastValidBlockHeight: 99 });
  const row = (address: string, amount: string) => ({ accountIndex: fundingTreasuryIndex(wire, address), mint: bondMint, owner: wallet,
    programId: TOKEN_2022_PROGRAM_ID, uiTokenAmount: { amount, decimals: 0 } });
  const meta = { preTokenBalances: [row(accountA, "3"), row(accountB, "7")], postTokenBalances: [row(accountA, "1"), row(accountB, "7")] };
  const proof = verifyRedemptionBurnHistory(meta, wire, bondMint, sources, 2n);
  assert.deepEqual(proof.map(value => value.burnAmount), ["2", "0"]);
  assert.equal(proof[0]!.balanceBefore, "3"); assert.equal(proof[0]!.expectedBalanceAfter, "1");
  for (const changed of [
    { ...meta, postTokenBalances: [row(accountA, "2"), row(accountB, "7")] },
    { ...meta, postTokenBalances: [row(accountA, "1")] },
    { ...meta, preTokenBalances: [{ ...row(accountA, "3"), owner: mint }, row(accountB, "7")] },
    { ...meta, preTokenBalances: [{ ...row(accountA, "3"), uiTokenAmount: { amount: "3", decimals: 6 } }, row(accountB, "7")] },
    { ...meta, preTokenBalances: [row(accountA, "3"), row(accountA, "3"), row(accountB, "7")] }
  ]) assert.throws(() => verifyRedemptionBurnHistory(changed, wire, bondMint, sources, 2n));
});
