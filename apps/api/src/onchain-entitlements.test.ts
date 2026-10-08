import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import { decodePublicKey, deriveCorporateActionAddresses, deriveEntitlementAddress, encodePublicKey } from "@lifecycle-kase/solana-client";
import { onchainCalculationEnabled, prepareOnchainCalculation } from "./onchain-entitlements.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const KEY = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const GENESIS = "B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF";
const actor = { id: randomUUID(), walletAddress: KEY, correlationId: randomUUID() };
const options = { enabled: true, cluster: "localnet" as const, expectedGenesisHash: GENESIS,
  programId: PROGRAM, rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 1000 };

function actionAccount(input: { actionId: string; instrumentAddress: string; hash: string; status?: number;
  registered?: number; amount?: bigint }) {
  const data = Buffer.alloc(200); let offset = 0;
  createHash("sha256").update("account:CorporateAction").digest().copy(data, offset, 0, 8); offset += 8;
  data[offset++] = 1; Buffer.from(input.actionId.replaceAll("-", ""), "hex").copy(data, offset); offset += 16;
  Buffer.from(decodePublicKey(input.instrumentAddress)).copy(data, offset); offset += 32; data[offset++] = 0;
  data.writeBigInt64LE(1_790_000_000n, offset); offset += 8; data.writeBigInt64LE(1_790_000_060n, offset); offset += 8;
  data[offset++] = 0; data[offset++] = 0; Buffer.from(input.hash, "hex").copy(data, offset); offset += 32;
  data.writeBigUInt64LE(10n, offset); offset += 8; data.writeUInt32LE(1, offset); offset += 4;
  data.writeUInt32LE(1, offset); offset += 4; data.writeBigUInt64LE(10n, offset); offset += 8;
  data.writeBigUInt64LE(input.amount ?? 0n, offset); offset += 8; data.writeUInt32LE(input.registered ?? 0, offset); offset += 4;
  data.writeUInt32LE(0, offset); offset += 4; data[offset++] = input.status ?? 2;
  data.writeBigInt64LE(1_789_999_900n, offset); offset += 8; data[offset++] = 0; data[offset++] = 1;
  return data.toString("base64");
}

async function fixture() {
  const actionId = randomUUID(); const instrumentId = randomUUID(); const investorId = randomUUID();
  const entitlementId = randomUUID(); const snapshotInvestorId = randomUUID(); const walletId = randomUUID();
  const at = new Date("2026-10-02T12:00:00.000Z");
  const commitment = createSnapshotV2Commitment({ actionId, instrumentId, cluster: "localnet", networkGenesisHash: GENESIS,
    mintAddress: KEY, recordAt: at.toISOString(), blockTime: at.toISOString(), createdAt: at.toISOString(), solanaSlot: 10n,
    mintSupply: 10n, investors: [{ investorId, eligibilityStatus: "ELIGIBLE", wallets: [{ walletId, walletAddress: KEY,
      walletStatus: "ACTIVE", tokenAccounts: [{ address: KEY, balance: 10n }] }] }] });
  const calculationInputs = { actionType: "COUPON_PAYMENT", snapshotId: randomUUID(), snapshotHash: commitment.sha256,
    effectiveSlot: "10", effectiveBlockTime: at.toISOString(), balance: "10", faceValueMinor: "1000000",
    couponRateBps: 1000, paymentsPerYear: 2, redemptionPercentageBps: null, redemptionPriceMinor: null,
    roundingRemainder: "0", denominator: "20000", eligibilityRuleVersion: "eligibility-v1-local-demo-explicit",
    eligible: true, eligibilityReason: "LOCAL_DEMO_ELIGIBLE" };
  const entitlement = { id: entitlementId, corporateActionId: actionId, snapshotInvestorId, investorId,
    settlementWalletAddress: KEY, balanceAtRecordDate: 10n, amountMinor: 500_000n, tokensToRedeem: 0n,
    status: "CALCULATED", executionAttempts: 0, onchainPda: null as string | null, settlementSignature: null, burnSignature: null,
    lastErrorCode: null, calculationInputs, formulaVersion: "integer-entitlements-v1", eligibilityReason: "LOCAL_DEMO_ELIGIBLE",
    version: 0, createdAt: at, updatedAt: at };
  const action = { id: actionId, instrumentId, type: "COUPON_PAYMENT", recordAt: at, executeAt: new Date(at.getTime() + 60_000),
    redemptionPercentageBps: null, redemptionPriceMinor: null, status: "UNDER_REVIEW", version: 3,
    totalEntitlementMinor: 500_000n, eligibleHolders: 1, approvedById: null, approvedAt: null, reviewNote: "review",
    instrument: { id: instrumentId, network: "SOLANA_LOCALNET", status: "ACTIVE", programId: PROGRAM, mintAddress: KEY,
      corporateActionAuthority: KEY, faceValueMinor: 1_000_000n, couponRateBps: 1000, paymentsPerYear: 2 },
    entitlements: [entitlement], blockchainTransactions: [{ operationType: "REGISTER_SNAPSHOT", status: "FINALIZED", signature: "2".repeat(64) }],
    snapshot: { id: calculationInputs.snapshotId, instrumentId, corporateActionId: actionId, schemaVersion: "snapshot-v2",
      status: "FINALIZED", recordAt: at, blockTime: at, createdAt: at, networkGenesisHash: GENESIS, solanaSlot: 10n,
      snapshotHash: Buffer.from(commitment.sha256, "hex"), canonicalJson: commitment.snapshot, mintSupply: 10n,
      totalBalance: 10n, investorCount: 1, walletCount: 1, investors: [{ id: snapshotInvestorId, investorId,
        balance: 10n, eligibilityStatus: "ELIGIBLE", investor: { id: investorId, displayName: "A", status: "ACTIVE",
          kycStatus: "NOT_STARTED", eligibilityStatus: "ELIGIBLE", eligibilityReasonCode: "DEMO_CRITERIA_MET",
          eligibilityReviewedAt: at, wallets: [{ id: walletId, investorId, address: KEY, network: "SOLANA_LOCALNET",
            status: "ACTIVE", verifiedAt: at, revokedAt: null }] }, wallets: [{ id: randomUUID(), walletId, walletAddress: KEY,
          walletStatus: "ACTIVE", balance: 10n, tokenAccounts: [{ address: KEY, balance: 10n }] }] }] } };
  const addresses = await deriveCorporateActionAddresses(PROGRAM,
    Buffer.from(instrumentId.replaceAll("-", ""), "hex"), Buffer.from(actionId.replaceAll("-", ""), "hex"));
  return { action, entitlement, addresses, chain: actionAccount({ actionId, instrumentAddress: addresses.instrumentAddress, hash: commitment.sha256 }) };
}

function harness(value: Awaited<ReturnType<typeof fixture>>) {
  const created: Record<string, unknown>[] = []; const audits: Record<string, unknown>[] = [];
  const operationId = randomUUID();
  const database = {
    corporateAction: { findUnique: async () => value.action },
    blockchainTransaction: { findFirst: async (): Promise<Record<string, unknown> | null> => null },
    $transaction: async (task: (tx: unknown) => Promise<unknown>) => task({
      corporateAction: { findUnique: async () => ({ version: value.action.version, status: value.action.status }) },
      entitlement: { findUnique: async () => ({ version: value.entitlement.version, onchainPda: null }) },
      blockchainTransaction: { create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data); return { id: operationId, signature: null, updatedAt: new Date(), ...data };
      } }, auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; } }
    })
  };
  const rpc = { request: async (method: string) => {
    if (method === "getGenesisHash") return GENESIS;
    if (method === "getAccountInfo") return { context: { slot: 10 }, value: { owner: PROGRAM, executable: false, data: [value.chain, "base64"] } };
    if (method === "getLatestBlockhash") return { value: { blockhash: KEY, lastValidBlockHeight: 99 } };
    throw new Error(`Unexpected RPC ${method}`);
  } };
  return { database, rpc, created, audits };
}

test("feature flag is fail-closed and rejects malformed values", () => {
  assert.equal(onchainCalculationEnabled({}), false); assert.equal(onchainCalculationEnabled({ ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED: "false" }), false);
  assert.equal(onchainCalculationEnabled({ ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED: "true" }), true);
  assert.throws(() => onchainCalculationEnabled({ ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED: "1" }));
});

test("registration preparation persists exact immutable facts without changing the action", async () => {
  const value = await fixture(); const { database, rpc, created, audits } = harness(value);
  const result = await prepareOnchainCalculation(database as never, rpc as never, value.action.id,
    { phase: "REGISTER", version: 3, entitlementId: value.entitlement.id }, actor, options);
  assert.equal(result.phase, "REGISTER"); assert.equal(result.requiredSigner, KEY); assert.equal(result.status, "PREPARED");
  assert.equal(created[0]?.["operationType"], "ENTITLEMENT_REGISTER"); assert.equal(created[0]?.["entitlementId"], value.entitlement.id);
  const payload = created[0]?.["preparedPayload"] as Record<string, unknown>;
  assert.equal(payload["snapshotHash"], Buffer.from(value.action.snapshot.snapshotHash).toString("hex"));
  assert.equal(payload["paymentAmountMinor"], "500000"); assert.equal(payload["balanceAtSnapshot"], "10");
  assert.equal(audits[0]?.["event"], "ENTITLEMENT_ONCHAIN_PREPARED");
});

test("reset preparation closes only the canonical confirmed partial set", async () => {
  const value = await fixture();
  value.entitlement.onchainPda = await deriveEntitlementAddress(PROGRAM, value.addresses.actionAddress,
    Buffer.from(value.entitlement.investorId.replaceAll("-", ""), "hex"));
  value.chain = actionAccount({ actionId: value.action.id, instrumentAddress: value.addresses.instrumentAddress,
    hash: value.entitlement.calculationInputs.snapshotHash, status: 3, registered: 1, amount: 500_000n });
  const { database, rpc, created, audits } = harness(value);
  const result = await prepareOnchainCalculation(database as never, rpc as never, value.action.id,
    { phase: "RESET", version: 3 }, actor, options);
  assert.equal(result.phase, "RESET"); assert.equal(created[0]?.["operationType"], "CALCULATION_RESET");
  const payload = created[0]?.["preparedPayload"] as Record<string, unknown>;
  assert.deepEqual(payload["entitlementAddresses"], [value.entitlement.onchainPda]);
  assert.equal(payload["entitlementCount"], 1); assert.equal(payload["totalAmountMinor"], "500000");
  assert.equal(audits[0]?.["event"], "CALCULATION_ONCHAIN_RESET_PREPARED");
  const blocked = harness(value); let reads = 0;
  blocked.database.blockchainTransaction.findFirst = async () => ++reads === 1 ? null : { id: randomUUID() };
  await assert.rejects(prepareOnchainCalculation(blocked.database as never, blocked.rpc as never, value.action.id,
    { phase: "RESET", version: 3 }, actor, options),
  (error: unknown) => error instanceof TransactionWorkflowError && error.code === "CALCULATION_OPERATION_PENDING");
  value.entitlement.onchainPda = KEY;
  await assert.rejects(prepareOnchainCalculation(database as never, rpc as never, value.action.id,
    { phase: "RESET", version: 3 }, actor, options),
  (error: unknown) => error instanceof TransactionWorkflowError && error.code === "ENTITLEMENT_PDA_MISMATCH");
});

test("registration enforces capability, CA authority, version and finalization coverage", async () => {
  const value = await fixture(); const { database, rpc } = harness(value);
  const request = { phase: "REGISTER", version: 3, entitlementId: value.entitlement.id };
  await assert.rejects(prepareOnchainCalculation(database as never, rpc as never, value.action.id, request, actor,
    { ...options, enabled: false }), (error: unknown) => error instanceof TransactionWorkflowError && error.code === "ONCHAIN_CALCULATION_DISABLED");
  await assert.rejects(prepareOnchainCalculation(database as never, rpc as never, value.action.id, request,
    { ...actor, walletAddress: encodePublicKey(new Uint8Array(32).fill(8)) }, options),
    (error: unknown) => error instanceof TransactionWorkflowError && error.code === "WALLET_MISMATCH");
  await assert.rejects(prepareOnchainCalculation(database as never, rpc as never, value.action.id,
    { ...request, version: 2 }, actor, options), (error: unknown) => error instanceof TransactionWorkflowError && error.code === "ACTION_CONFLICT");
  await assert.rejects(prepareOnchainCalculation(database as never, rpc as never, value.action.id,
    { phase: "FINALIZE", version: 3 }, actor, options),
    (error: unknown) => error instanceof TransactionWorkflowError && error.code === "CALCULATION_INCOMPLETE");
});

test("registration cannot race pending finalization or reset", async () => {
  const value = await fixture(); const setup = harness(value); let reads = 0;
  setup.database.blockchainTransaction.findFirst = async () => ++reads === 1 ? null : { id: randomUUID() };
  await assert.rejects(prepareOnchainCalculation(setup.database as never, setup.rpc as never, value.action.id,
    { phase: "REGISTER", version: 3, entitlementId: value.entitlement.id }, actor, options),
  (error: unknown) => error instanceof TransactionWorkflowError && error.code === "CALCULATION_OPERATION_PENDING");
});
