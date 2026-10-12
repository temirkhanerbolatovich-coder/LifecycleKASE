import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import { buildControlledRedemptionExecution, buildControlledUnitReservation, decodePublicKey, deriveCorporateActionAddresses,
  deriveEntitlementAddress, deriveExactRedemptionTargetAddress, encodePublicKey, redemptionSourceHash,
  serializeUnsignedInstructionsTransaction, CONTROLLED_CAPTURE_BYTES, CONTROLLED_POLICY_BYTES, REDEMPTION_SOURCES_BYTES,
  TOKEN_2022_PROGRAM_ID } from "@lifecycle-kase/solana-client";
import { calculateEntitlements, getEntitlements, reviewEntitlements } from "../apps/api/dist/entitlements.js";
import { prepareOnchainCalculation } from "../apps/api/dist/onchain-entitlements.js";
import { getRedemptionExecution } from "../apps/api/dist/redemption-execution.js";
import { preparedOnchainCalculation } from "../apps/web/.test-dist/onchain-entitlement-workflow.js";
import { requireRedemptionCalculationTransaction } from "../apps/web/.test-dist/redemption-calculation-workflow.js";
import { redemptionExecutionView, preparedRedemptionExecution } from "../apps/web/.test-dist/redemption-execution-workflow.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const key = value => encodePublicKey(Buffer.alloc(32, value));
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const bytes = value => Buffer.from(value.replaceAll("-", ""), "hex");
const actor = { id: id(99), walletAddress: key(40), correlationId: id(98) };
const at = new Date("2026-10-02T12:00:00.000Z");
const options = { enabled: true, redemptionEnabled: true, controlledRegistryEnabled: true, cluster: "localnet", expectedGenesisHash: key(91),
  programId: PROGRAM, rpcEndpoint: "http://127.0.0.1:1", rpcTimeoutMs: 1000 };
function writer(name, size, version = 1) {
  const data = Buffer.alloc(size); createHash("sha256").update(`account:${name}`).digest().copy(data, 0, 0, 8); data[8] = version; let offset = 9;
  const raw = value => { value.copy(data, offset); offset += value.length; };
  return { data, raw, key: value => raw(Buffer.from(decodePublicKey(value))), byte: value => { data[offset++] = value; },
    u16: value => { data.writeUInt16LE(value, offset); offset += 2; }, u32: value => { data.writeUInt32LE(value, offset); offset += 4; },
    u64: value => { data.writeBigUInt64LE(value, offset); offset += 8; } };
}
function tokenData(mint, wallet, balance) {
  const raw = Buffer.alloc(170); Buffer.from(decodePublicKey(mint)).copy(raw, 0); Buffer.from(decodePublicKey(wallet)).copy(raw, 32);
  raw.writeBigUInt64LE(balance, 64); raw[108] = 2; raw[165] = 2; raw.writeUInt16LE(7, 166); return raw;
}

async function fixture(exact, phase) {
  const balanceValues = exact ? [8n, 16n, 4n] : [10n, 20n, 5n];
  const actionId = id(exact ? 101 : 102); const instrumentId = id(100); const snapshotId = id(103);
  const investors = balanceValues.map((balance, index) => {
    const investorId = id(10 + index); const walletId = id(20 + index); const walletAddress = key(50 + index); const sourceAddress = key(60 + index);
    const wallet = { id: walletId, investorId, address: walletAddress, network: "SOLANA_LOCALNET", status: "ACTIVE", verifiedAt: at, revokedAt: null };
    return { id: id(30 + index), investorId, balance, eligibilityStatus: "ELIGIBLE", investor: { id: investorId, displayName: String(index), status: "ACTIVE",
      kycStatus: "NOT_STARTED", eligibilityStatus: "ELIGIBLE", eligibilityReasonCode: "DEMO_CRITERIA_MET", eligibilityReviewedAt: at, wallets: [wallet] },
      wallets: [{ id: id(40 + index), walletId, walletAddress, walletStatus: "ACTIVE", balance, tokenAccounts: [{ address: sourceAddress, balance }] }] };
  });
  const supply = balanceValues.reduce((sum, balance) => sum + balance, 0n); const mint = key(70); const settlementMint = key(71);
  const commitment = createSnapshotV2Commitment({ actionId, instrumentId, cluster: "localnet", networkGenesisHash: options.expectedGenesisHash,
    mintAddress: mint, recordAt: at.toISOString(), solanaSlot: 10n, blockTime: at.toISOString(), createdAt: at.toISOString(), mintSupply: supply,
    investors: investors.map(investor => ({ investorId: investor.investorId, eligibilityStatus: investor.eligibilityStatus,
      wallets: investor.wallets.map(wallet => ({ walletId: wallet.walletId, walletAddress: wallet.walletAddress, walletStatus: wallet.walletStatus, tokenAccounts: wallet.tokenAccounts })) })) });
  const action = { id: actionId, instrumentId, type: "EARLY_REDEMPTION", version: 3, status: "SNAPSHOT_CREATED", recordAt: at,
    executeAt: new Date(at.getTime() + 60_000), redemptionPercentageBps: exact ? null : 2000, redemptionPriceMinor: 1_000_000n,
    redemptionAllocationPolicy: exact ? "exact-target-largest-remainder-v2" : "integer-entitlements-v1", redemptionTargetTokens: exact ? 8n : null,
    totalEntitlementMinor: 0n, eligibleHolders: 0, approvedById: null, approvedAt: null, reviewNote: "review", processedEntitlements: 0,
    instrument: { id: instrumentId, ticker: "TEST", tokenPolicy: "CONTROLLED_FROZEN_V2", version: 1, network: "SOLANA_LOCALNET", status: "ACTIVE", programId: PROGRAM,
      mintAddress: mint, issuerAuthority: actor.walletAddress, corporateActionAuthority: actor.walletAddress, settlementAssetId: id(104),
      faceValueMinor: 1_000_000n, couponRateBps: 1000, paymentsPerYear: 2, totalSupply: supply, circulatingSupply: supply },
    entitlements: [], blockchainTransactions: [{ operationType: "REGISTER_SNAPSHOT", status: "FINALIZED", signature: "2".repeat(64) }],
    snapshot: { id: snapshotId, instrumentId, corporateActionId: actionId, schemaVersion: "snapshot-v2", status: "FINALIZED", recordAt: at,
      blockTime: at, createdAt: at, networkGenesisHash: options.expectedGenesisHash, solanaSlot: 10n, snapshotHash: Buffer.from(commitment.sha256, "hex"),
      canonicalJson: commitment.snapshot, mintSupply: supply, totalBalance: supply, investorCount: investors.length, walletCount: investors.length, investors } };
  const operations = []; const accounts = new Map(); const accountReads = [];
  const database = { corporateAction: { findUnique: async () => action, updateMany: async ({ data }) => {
    Object.assign(action, data, { version: action.version + 1 }); return { count: 1 };
  } }, entitlement: { create: async ({ data }) => {
    const row = { ...data, id: id(200 + action.entitlements.length), version: 0, onchainPda: null, settlementSignature: null, burnSignature: null };
    action.entitlements.push(row); return row;
  }, findUnique: async ({ where }) => action.entitlements.find(row => row.id === where.id) },
  blockchainTransaction: { findMany: async () => [], findFirst: async () => null, create: async ({ data }) => {
    const operation = { ...data, id: id(300 + operations.length), signature: null, updatedAt: at }; operations.push(operation); return operation;
  } }, auditLog: { create: async ({ data }) => data }, settlementAsset: { findUniqueOrThrow: async () => ({ mintAddress: settlementMint }) },
  $transaction: async task => task(database) };
  await calculateEntitlements(database, actionId, { version: action.version }, actor);
  await reviewEntitlements(database, actionId, { version: action.version, decision: "SUBMIT", note: "Synthetic cross-contract review" }, actor);
  const addresses = await deriveCorporateActionAddresses(PROGRAM, bytes(instrumentId), bytes(actionId));
  const selected = action.entitlements[0];
  const unitPlan = await buildControlledUnitReservation({ programId: PROGRAM, instrumentId: bytes(instrumentId), actionId: bytes(actionId), investorId: bytes(selected.investorId),
    corporateActionAuthority: actor.walletAddress, bondMint: mint, tokenAccounts: [{ address: investors[0].wallets[0].tokenAccounts[0].address, wallet: investors[0].wallets[0].walletAddress, balanceAtSnapshot: investors[0].balance }], snapshotHash: commitment.sha256 });
  if (phase !== "REGISTER") for (const row of action.entitlements) row.onchainPda = await deriveEntitlementAddress(PROGRAM, addresses.actionAddress, bytes(row.investorId));
  const add = (address, out, owner = PROGRAM) => accounts.set(address, { owner, data: out.data ?? out });
  const chain = writer("CorporateAction", 232, exact ? 2 : 1); chain.raw(bytes(actionId)); chain.key(addresses.instrumentAddress); chain.byte(2);
  chain.u64(BigInt(at.getTime() / 1000)); chain.u64(BigInt(action.executeAt.getTime() / 1000)); chain.byte(exact ? 0 : 1); if (!exact) chain.u16(2000);
  chain.byte(1); chain.u64(action.redemptionPriceMinor); chain.raw(Buffer.from(commitment.sha256, "hex")); chain.u64(10n); chain.u32(3); chain.u32(3); chain.u64(supply);
  chain.u64(phase === "REGISTER" ? 0n : action.totalEntitlementMinor); chain.u32(phase === "REGISTER" ? 0 : 3); chain.u32(0);
  chain.byte(phase === "REGISTER" ? 2 : phase === "RESERVE_UNITS" ? 4 : 3); chain.u64(1n); chain.byte(0); chain.byte(1); add(addresses.actionAddress, chain);
  const policy = writer("ControlledPolicy", CONTROLLED_POLICY_BYTES); policy.key(addresses.instrumentAddress); policy.key(mint); policy.key(addresses.actionAddress); policy.key(addresses.actionAddress); policy.byte(1); add(unitPlan.controlledPolicyAddress, policy);
  const capture = writer("ControlledCapture", CONTROLLED_CAPTURE_BYTES); capture.key(addresses.instrumentAddress); capture.key(addresses.actionAddress); capture.u64(10n); capture.u64(BigInt(at.getTime() / 1000));
  capture.raw(Buffer.from(commitment.sha256, "hex")); capture.byte(1); capture.byte(0); capture.u32(3);
  for (const investor of investors) { capture.key(investor.wallets[0].tokenAccounts[0].address); capture.key(investor.wallets[0].walletAddress); capture.u64(investor.balance); }
  capture.u32(3); capture.byte(0); capture.byte(0); capture.byte(0); capture.u32(0); capture.u64(0n); capture.byte(1); add(unitPlan.controlledCaptureAddress, capture);
  const sources = writer("RedemptionSources", REDEMPTION_SOURCES_BYTES); sources.key(addresses.actionAddress); sources.key(unitPlan.entitlementAddress);
  sources.raw(Buffer.from(commitment.sha256, "hex")); sources.raw(Buffer.from(unitPlan.sourceHash, "hex")); sources.u32(1);
  sources.key(investors[0].wallets[0].tokenAccounts[0].address); sources.key(investors[0].wallets[0].walletAddress); sources.u64(investors[0].balance); sources.byte(1); add(unitPlan.sourceAddress, sources);
  if (exact) {
    const target = writer("ExactRedemptionTarget", 50, 2); target.key(addresses.actionAddress); target.u64(8n); target.byte(1);
    add(await deriveExactRedemptionTargetAddress(PROGRAM, addresses.actionAddress), target);
  }
  database.blockchainTransaction.findFirst = async ({ where }) => phase === "RESERVE_UNITS" && where.operationType === "CALCULATION_FINALIZE" && where.status === "FINALIZED" ? { signature: "2".repeat(64) } : null;
  const rpc = { request: async (method, parameters) => {
    if (method === "getGenesisHash") return options.expectedGenesisHash;
    if (method === "getLatestBlockhash") return { value: { blockhash: key(90), lastValidBlockHeight: 99 } };
    if (method === "getAccountInfo") { const address = parameters[0]; accountReads.push(address); const value = accounts.get(address);
      return { context: { slot: 100 }, value: value ? { owner: value.owner, executable: false, data: [value.data.toString("base64"), "base64"] } : null }; }
    throw new Error(`Unexpected RPC ${method}`);
  } };
  return { action, selected, investors, supply, mint, settlementMint, addresses, unitPlan, accounts, accountReads, database, rpc, operations };
}

for (const exact of [false, true]) for (const phase of ["REGISTER", "FINALIZE", "RESET", "RESERVE_UNITS"]) {
  test(`API-produced controlled ${exact ? "exact" : "percentage"} ${phase} passes the real browser metadata and complete wire validators`, async () => {
    const value = await fixture(exact, phase);
    const request = { phase, version: value.action.version, ...(["REGISTER", "RESERVE_UNITS"].includes(phase) ? { entitlementId: value.selected.id } : {}) };
    const payload = await prepareOnchainCalculation(value.database, value.rpc, value.action.id, request, actor, options);
    const view = { ...await getEntitlements(value.database, value.action.id), onchainCalculationFinalized: phase === "RESERVE_UNITS", onchainRegistrationEnabled: true };
    const reviewed = preparedOnchainCalculation(payload, view, actor.walletAddress, actor.walletAddress);
    await requireRedemptionCalculationTransaction(reviewed, view);
    for (const field of ["controlledPolicyAddress", "controlledCaptureAddress", "redemptionAllocationPolicy", ...(exact && phase !== "RESET" ? ["targetAddress"] : [])]) {
      const changed = structuredClone(payload); if (field === "redemptionAllocationPolicy") changed[field] = "unsupported-policy"; else delete changed[field];
      await assert.rejects(async () => requireRedemptionCalculationTransaction(preparedOnchainCalculation(changed, view, actor.walletAddress, actor.walletAddress), view), undefined, field);
    }
    const operation = value.operations[0]; operation.signature = "2".repeat(64); operation.status = "UNKNOWN_CONFIRMATION";
    const previousFind = value.database.blockchainTransaction.findFirst;
    value.database.blockchainTransaction.findFirst = async args => args.where.status === "FINALIZED" ? previousFind(args) : operation;
    const resumed = await prepareOnchainCalculation(value.database, value.rpc, value.action.id, request, actor, options);
    assert.equal(resumed.operationId, operation.id); assert.equal(resumed.signature, operation.signature); assert.equal(resumed.serializedTransactionBase64, payload.serializedTransactionBase64);
    await requireRedemptionCalculationTransaction(preparedOnchainCalculation(resumed, view, actor.walletAddress, actor.walletAddress), view);
  });
}

test("GET redemption recovers signed pending immutable source review after the finalized burn empties and closes its account", async () => {
  const value = await fixture(false, "RESERVE_UNITS"); const { action, selected } = value;
  action.status = "APPROVED"; action.approvedById = id(999); action.approvedAt = at; action.reviewNote = "Approved synthetic";
  action.entitlements.forEach(row => { row.status = "READY"; });
  const source = value.investors[0].wallets[0].tokenAccounts[0]; const wallet = value.investors[0].wallets[0].walletAddress;
  const idempotencyKey = "recovery_test"; const idempotencyHash = createHash("sha256").update(`redemption:${action.id}:${selected.id}:${idempotencyKey}`).digest("hex");
  const plan = await buildControlledRedemptionExecution({ programId: PROGRAM, instrumentId: bytes(action.instrumentId), actionId: bytes(action.id),
    corporateActionAuthority: actor.walletAddress, investorId: bytes(selected.investorId), bondMint: value.mint, settlementMint: value.settlementMint,
    settlementWallet: wallet, idempotencyHash, tokenAccounts: [{ address: source.address, wallet, balanceAtSnapshot: source.balance }] });
  const savedAccounts = [{ address: source.address, walletAddress: wallet, balanceAtSnapshot: source.balance.toString(), burnAmount: selected.tokensToRedeem.toString(),
    balanceBefore: selected.tokensToRedeem.toString(), expectedBalanceAfter: "0" }];
  const operation = { id: id(500), status: "UNKNOWN_CONFIRMATION", signature: "3".repeat(64), operationType: "REDEMPTION_PAYMENT", instrumentId: action.instrumentId,
    corporateActionId: action.id, entitlementId: selected.id, requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash,
    recentBlockhash: key(90), lastValidBlockHeight: 99n, preparedTransactionBase64: serializeUnsignedInstructionsTransaction({ instructions: plan.instructions,
      feePayer: actor.walletAddress, recentBlockhash: key(90), lastValidBlockHeight: 99 }), preparedPayload: { phase: "PAY", idempotencyHash, idempotencyKey,
      corporateActionId: action.id, cluster: "localnet", actionType: action.type, tokenPolicy: "CONTROLLED_FROZEN_V2", programId: PROGRAM,
      instrumentAddress: plan.instrumentAddress, instrumentAuthorityAddress: plan.instrumentAuthority, actionAddress: plan.actionAddress,
      approvalPolicyAddress: plan.approvalPolicyAddress, reserveAddress: plan.reserveAddress, vaultAddress: plan.vaultAddress, redemptionProgressAddress: plan.progressAddress,
      recipientAddress: plan.recipientAddress, redemptionReceiptAddress: plan.redemptionReceiptAddress, entitlementId: selected.id,
      controlledPolicyAddress: value.unitPlan.controlledPolicyAddress, controlledCaptureAddress: value.unitPlan.controlledCaptureAddress,
      unitReservationAddress: plan.unitReservationAddress, holdingAddresses: plan.holdingAddresses, assignedAllocations: [selected.tokensToRedeem.toString()],
      redemptionAllocationPolicy: action.redemptionAllocationPolicy, redemptionTargetTokens: null,
      supplyBefore: value.supply.toString(), supplyAfter: (value.supply - selected.tokensToRedeem).toString(),
      actionVersion: action.version, entitlementVersion: selected.version, snapshotHash: Buffer.from(action.snapshot.snapshotHash).toString("hex"),
      sourceHash: redemptionSourceHash(plan.actionAddress, plan.entitlementAddress, Buffer.from(action.snapshot.snapshotHash).toString("hex"), [{ address: source.address, wallet, balanceAtSnapshot: source.balance }]),
      redemptionSourcesAddress: plan.sourceAddress, entitlementAddress: selected.onchainPda, tokenMint: value.mint, settlementMint: value.settlementMint,
      settlementWallet: wallet, amountMinor: selected.amountMinor.toString(), tokensToRedeem: selected.tokensToRedeem.toString(), tokenAccounts: savedAccounts } };
  value.database.blockchainTransaction.findFirst = async ({ where }) => where.operationType === "ACTION_APPROVAL" ? { signature: "2".repeat(64) } : operation;
  const mint = Buffer.alloc(207); mint[44] = 0; mint[45] = 1; mint.writeUInt32LE(1, 46); Buffer.from(decodePublicKey(plan.instrumentAuthority)).copy(mint, 50);
  mint.writeBigUInt64LE(value.supply - selected.tokensToRedeem, 36); mint[165] = 1; mint.writeUInt16LE(6, 166); mint.writeUInt16LE(1, 168); mint[170] = 2;
  mint.writeUInt16LE(12, 171); mint.writeUInt16LE(32, 173); Buffer.from(decodePublicKey(plan.instrumentAuthority)).copy(mint, 175);
  value.accounts.set(value.mint, { owner: TOKEN_2022_PROGRAM_ID, data: mint });
  for (const investor of value.investors.slice(1)) value.accounts.set(investor.wallets[0].tokenAccounts[0].address, { owner: TOKEN_2022_PROGRAM_ID,
    data: tokenData(value.mint, investor.wallets[0].walletAddress, investor.balance) });
  value.accounts.delete(source.address);
  const result = await getRedemptionExecution(value.database, value.rpc, action.id, options);
  assert.equal(result.pending.operationId, operation.id); assert.equal(result.pending.signature, operation.signature); assert.equal(result.pending.status, "UNKNOWN_CONFIRMATION");
  assert.deepEqual(result.items[0].tokenAccounts, savedAccounts.map(value => ({ ...value, balanceBefore: null, expectedBalanceAfter: null })));
  assert.equal(result.items[0].burnAvailable, false); assert.equal(value.accountReads.includes(source.address), false);
  const reviewed = redemptionExecutionView(result, action.id, action.type);
  const recovered = await preparedRedemptionExecution(result.pending, reviewed, actor.walletAddress);
  assert.equal(recovered.signature, operation.signature); assert.equal(recovered.serializedTransactionBase64, operation.preparedTransactionBase64);
  const priorSigner = operation.requiredSigner; operation.requiredSigner = key(99);
  await assert.rejects(getRedemptionExecution(value.database, value.rpc, action.id, options), { code: "WALLET_MISMATCH" }); operation.requiredSigner = priorSigner;
  operation.preparedPayload.tokenAccounts[0].burnAmount = "99";
  await assert.rejects(getRedemptionExecution(value.database, value.rpc, action.id, options), { code: "PREPARED_ATTEMPT_INVALID" });
});
