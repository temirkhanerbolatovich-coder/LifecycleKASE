import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createSnapshotV2Commitment, EARLY_REDEMPTION_ALLOCATION_POLICY } from "@lifecycle-kase/domain";
import { encodePublicKey } from "@lifecycle-kase/solana-client";
import { calculateEntitlements, getEntitlements, reviewEntitlements } from "./entitlements.js";
import { createCorporateActionDraft } from "./corporate-action-registry.js";

const key = (byte: number) => encodePublicKey(new Uint8Array(32).fill(byte));
const at = new Date("2026-10-11T12:00:00.000Z");
const actor = { id: randomUUID(), walletAddress: key(4), correlationId: randomUUID() };

function calculationFixture(balances = [1n, 1n, 1n], target = 1n) {
  const id = randomUUID(); const instrumentId = randomUUID(); const snapshotId = randomUUID();
  const investors = balances.map((balance, index) => {
    const investorId = randomUUID(); const walletId = randomUUID(); const walletAddress = key(index + 7);
    return { id: randomUUID(), investorId, balance, eligibilityStatus: "ELIGIBLE",
      investor: { id: investorId, displayName: String(index), status: "ACTIVE", kycStatus: "VERIFIED", eligibilityStatus: "ELIGIBLE",
        eligibilityReasonCode: null, eligibilityReviewedAt: null,
        wallets: [{ id: walletId, investorId, address: walletAddress, network: "SOLANA_LOCALNET", status: "ACTIVE", verifiedAt: at, revokedAt: null }] },
      wallets: [{ walletId, walletAddress, walletStatus: "ACTIVE", balance,
        tokenAccounts: [{ address: key(index + 17), balance }] }] };
  });
  const supply = balances.reduce((sum, balance) => sum + balance, 0n);
  const commitment = createSnapshotV2Commitment({ actionId: id, instrumentId, cluster: "localnet", networkGenesisHash: key(3),
    mintAddress: key(5), recordAt: at.toISOString(), blockTime: at.toISOString(), createdAt: at.toISOString(), solanaSlot: 101n,
    mintSupply: supply, investors: investors.map(row => ({ investorId: row.investorId, eligibilityStatus: "ELIGIBLE",
      wallets: row.wallets.map(wallet => ({ ...wallet, walletStatus: "ACTIVE", tokenAccounts: wallet.tokenAccounts })) })) });
  const action = { id, instrumentId, type: "EARLY_REDEMPTION", status: "SNAPSHOT_CREATED", version: 0,
    recordAt: at, redemptionAllocationPolicy: EARLY_REDEMPTION_ALLOCATION_POLICY, redemptionTargetTokens: target,
    redemptionPercentageBps: null, redemptionPriceMinor: 1_000_000n, totalEntitlementMinor: 0n, eligibleHolders: 0,
    approvedById: null, approvedAt: null, reviewNote: null, entitlements: [] as Record<string, unknown>[],
    instrument: { network: "SOLANA_LOCALNET", programId: key(6), corporateActionAuthority: actor.walletAddress,
      mintAddress: key(5), issuerAuthority: actor.walletAddress, status: "ACTIVE",
      faceValueMinor: 1_000_000n, couponRateBps: 1000, paymentsPerYear: 2 },
    blockchainTransactions: [{ operationType: "REGISTER_SNAPSHOT", status: "FINALIZED", signature: "synthetic" }],
    snapshot: { id: snapshotId, instrumentId, status: "FINALIZED", recordAt: at, blockTime: at, createdAt: at,
      networkGenesisHash: key(3), solanaSlot: 101n, snapshotHash: Buffer.from(commitment.sha256, "hex"), canonicalJson: commitment.snapshot,
      mintSupply: supply, totalBalance: supply, investorCount: investors.length, walletCount: investors.length, investors } };
  const database = {
    corporateAction: { findUnique: async () => action, updateMany: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(action, data, { version: action.version + 1 }); return { count: 1 };
    } },
    blockchainTransaction: { findFirst: async () => null }, auditLog: { create: async () => ({}) },
    entitlement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: randomUUID(), executionAttempts: 0, settlementSignature: null, burnSignature: null, onchainPda: null, version: 0, ...data };
        action.entitlements.push(row); return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = action.entitlements.find(item => item["id"] === where.id)!;
        Object.assign(row, data, { version: Number(row["version"]) + 1 }); return row;
      }
    },
    $transaction: async (task: (tx: unknown) => Promise<unknown>) => task(database)
  };
  return { action, database };
}

test("exact target 1 of three single-token holders survives floor rounding and submits complete coverage", async () => {
  const { action, database } = calculationFixture();
  const calculated = await calculateEntitlements(database as never, action.id, { version: 0 }, actor);
  const winningAddress = action.snapshot.investors.map(row => row.wallets[0]!.walletAddress).sort()[0];
  assert.equal(calculated.items.reduce((sum, row) => sum + BigInt(row.tokensToRedeem), 0n), 1n);
  for (const row of calculated.items) assert.equal(row.tokensToRedeem, row.settlementWalletAddress === winningAddress ? "1" : "0");
  assert.equal(calculated.eligibleHolders, 1); assert.equal(calculated.totalEntitlementMinor, "1000000");
  assert.deepEqual([calculated.instrumentId, calculated.programId, calculated.network, calculated.networkGenesisHash, calculated.corporateActionAuthority],
    [action.instrumentId, key(6), "SOLANA_LOCALNET", key(3), actor.walletAddress]);
  assert.equal(calculated.items.filter(row => row.status === "NOT_ELIGIBLE_ZERO_ROUNDING").length, 2);
  assert.deepEqual(calculated.exactRedemptionSummary, { policy: EARLY_REDEMPTION_ALLOCATION_POLICY,
    targetTokens: "1", allocatedTokens: "1", totalBalance: "3", remainingTokens: "2", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" });
  const submitted = await reviewEntitlements(database as never, action.id, { version: action.version, decision: "SUBMIT", note: "Exact target review" }, actor);
  assert.equal(submitted.status, "UNDER_REVIEW");
  await assert.rejects(reviewEntitlements(database as never, action.id,
    { version: action.version, decision: "APPROVE", note: "Attempt off-chain approval" }, actor), { code: "ONCHAIN_REVIEW_REQUIRED" });
  assert.equal(action.status, "UNDER_REVIEW");
});

test("largest remainder allocates 8 as 2/5/1 and receiver revision preserves immutable owner ties", async () => {
  const { action, database } = calculationFixture([10n, 20n, 5n], 8n);
  await calculateEntitlements(database as never, action.id, { version: 0 }, actor);
  assert.deepEqual(action.entitlements.map(row => row["tokensToRedeem"]), [2n, 5n, 1n]);
  const before = action.entitlements.map(row => structuredClone(row["calculationInputs"]));
  action.status = "RETURNED_FOR_REVISION";
  const receivers = Object.fromEntries(action.snapshot.investors.map((row, index) => {
    const address = key(index + 30);
    row.investor.wallets.push({ ...row.investor.wallets[0]!, id: randomUUID(), address });
    return [row.investorId, address];
  }));
  await calculateEntitlements(database as never, action.id, { version: action.version, receivers }, actor);
  assert.deepEqual(action.entitlements.map(row => row["tokensToRedeem"]), [2n, 5n, 1n]);
  assert.deepEqual(action.entitlements.map(row => row["calculationInputs"]), before);
  assert.equal((await getEntitlements(database as never, action.id)).exactRedemptionSummary?.remainingTokens, "27");
});

test("target exceeding captured supply fails before saving entitlements", async () => {
  const { action, database } = calculationFixture([1n, 1n, 1n], 4n);
  await assert.rejects(calculateEntitlements(database as never, action.id, { version: 0 }, actor), { code: "TARGET_EXCEEDS_BALANCE" });
  assert.equal(action.entitlements.length, 0); assert.equal(action.status, "SNAPSHOT_CREATED");
});

test("stored wrong allocations, tie metadata and duplicate coverage cannot be read or submitted", async () => {
  for (const change of ["allocation", "tie", "coverage"] as const) {
    const { action, database } = calculationFixture([10n, 20n, 5n], 8n);
    await calculateEntitlements(database as never, action.id, { version: 0 }, actor);
    if (change === "allocation") Object.assign(action.entitlements[0]!, { tokensToRedeem: 3n, amountMinor: 3_000_000n });
    if (change === "tie") (action.entitlements[0]!["calculationInputs"] as Record<string, unknown>)["tieAddress"] = key(99);
    if (change === "coverage") action.entitlements[1] = structuredClone(action.entitlements[0]!);
    await assert.rejects(getEntitlements(database as never, action.id), { code: "CALCULATION_CHANGED" });
    await assert.rejects(reviewEntitlements(database as never, action.id, { version: action.version, decision: "SUBMIT", note: "Review changed allocation" }, actor));
  }
});

function draftFixture() {
  const instrumentId = randomUUID();
  const body = { requestId: randomUUID(), instrumentId, type: "EARLY_REDEMPTION", intent: "Exact quantity redemption",
    recordAt: "2026-10-11T12:02:00Z", executeAt: "2026-10-11T12:03:00Z", redemptionPriceKzt: "1.000001",
    redemptionAllocationPolicy: EARLY_REDEMPTION_ALLOCATION_POLICY, redemptionTargetTokens: "8" };
  let saved: Record<string, unknown> | null = null; let created = 0;
  const database = {
    instrument: { findUnique: async () => ({ id: instrumentId, issuerAuthority: actor.walletAddress, status: "ACTIVE",
      network: "SOLANA_LOCALNET", programId: key(4), mintAddress: key(5), issueAt: new Date(at.getTime() - 60_000),
      maturityAt: new Date(at.getTime() + 86_400_000) }) },
    corporateAction: { findUnique: async () => saved, create: async ({ data }: { data: Record<string, unknown> }) => {
      created++; saved = { ...data, instrument: {}, snapshot: null, blockchainTransactions: [], totalEntitlementMinor: 0n }; return saved;
    } }, auditLog: { create: async () => ({}) },
    $transaction: async (task: (tx: unknown) => Promise<unknown>) => task(database)
  };
  return { body, database, creations: () => created };
}

test("new explicit-target drafts serialize exact integers and remain idempotent", async () => {
  const value = draftFixture();
  const draft = await createCorporateActionDraft(value.database as never, value.body, actor, "SOLANA_LOCALNET", at, true);
  assert.equal(draft.redemptionTargetTokens, "8"); assert.equal(draft.redemptionPriceMinor, "1000001");
  assert.equal(draft.redemptionPercentageBps, null);
  const repeated = await createCorporateActionDraft(value.database as never, value.body, actor, "SOLANA_LOCALNET", at, true);
  assert.equal(repeated.id, draft.id); assert.equal(value.creations(), 1);
  await assert.rejects(createCorporateActionDraft(value.database as never, { ...value.body, redemptionTargetTokens: "9" }, actor, "SOLANA_LOCALNET", at, true), { code: "ACTION_CONFLICT" });
});

test("ambiguous, unsafe and disabled exact drafts fail without writing", async () => {
  for (const changes of [{ redemptionPercentageBps: 2000 }, { redemptionTargetTokens: 8 }, { redemptionTargetTokens: "0" },
    { redemptionTargetTokens: "01" }, { redemptionTargetTokens: "18446744073709551615" }, { redemptionTargetTokens: "9223372036854775807" },
    { type: "COUPON_PAYMENT" }, { redemptionAllocationPolicy: "integer-entitlements-v1", redemptionPercentageBps: 2000 }]) {
    const value = draftFixture();
    await assert.rejects(createCorporateActionDraft(value.database as never, { ...value.body, ...changes }, actor, "SOLANA_LOCALNET", at, true), { code: "INVALID_REQUEST" });
    assert.equal(value.creations(), 0);
  }
  for (const [network, enabled] of [["SOLANA_LOCALNET", false], ["SOLANA_DEVNET", true]] as const) {
    const value = draftFixture();
    await assert.rejects(createCorporateActionDraft(value.database as never, value.body, actor, network, at, enabled), { code: "EXACT_TARGET_REDEMPTION_DISABLED" });
    assert.equal(value.creations(), 0);
  }
});
