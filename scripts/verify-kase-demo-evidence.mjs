import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { address, getBase58Encoder, getProgramDerivedAddress } from "@solana/kit";
import { allocateEarlyRedemption, EARLY_REDEMPTION_ALLOCATION_POLICY } from "@lifecycle-kase/domain/early-redemption-allocation";
import { decodePublicKey, deriveCorporateActionAddresses, deriveEntitlementAddress,
  deriveExactRedemptionTargetAddress, deriveRedemptionAddress, redemptionSourceHash } from "@lifecycle-kase/solana-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const U64_MAX = (1n << 64n) - 1n;
const FIXTURE = [
  ["COUPON_PAYMENT", "COUPON_PAYMENT", "coupon-action-receipt-v1", "1750000000", "35", "35", "0"],
  ["EARLY_REDEMPTION", "EARLY_REDEMPTION", "redemption-action-receipt-v1", "7000000000", "35", "28", "7"],
  ["EARLY_REDEMPTION", "EXACT_EARLY_REDEMPTION", "redemption-action-receipt-v2", "8000000000", "28", "20", "8"],
  ["BOND_REDEMPTION", "BOND_REDEMPTION", "redemption-action-receipt-v1", "21000000000", "20", "0", "20"]
];

function object(value, field) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${field} must be an object`);
  return value;
}
function equal(value, expected, field) {
  assert.ok(value === expected, `${field} does not match`);
}
function integer(value, field) {
  assert.ok(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value), `${field} must be a decimal u64 string`);
  const result = BigInt(value);
  assert.ok(result <= U64_MAX, `${field} exceeds u64`);
  return result;
}
function uuid(value, field) {
  assert.ok(typeof value === "string" && UUID.test(value), `${field} must be a canonical UUID`);
  return Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
}
function publicKey(value, field) {
  try { decodePublicKey(value); } catch { throw new Error(`${field} must be a base58 32-byte public key`); }
}
function hash(value, field) {
  assert.ok(typeof value === "string" && HASH.test(value) && value !== "0".repeat(64), `${field} must be a nonzero SHA-256 hash`);
}
function signature(value, field, seen) {
  assert.ok(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value), `${field} must be a base58 signature`);
  assert.ok(getBase58Encoder().encode(value).length === 64, `${field} must encode a 64-byte signature`);
  assert.ok(!seen.has(value), `${field} repeats another transaction signature`);
  seen.add(value);
}

/** Checks the fixed disposable demo's saved evidence; never re-queries a chain or database. */
export async function verifyKaseDemoEvidence(evidence) {
  object(evidence, "evidence");
  equal(evidence.schema, "kase-four-actions-demo-v2", "evidence.schema");
  equal(evidence.scope, "DISPOSABLE_LOCALNET", "evidence.scope");
  assert.ok(Array.isArray(evidence.simulated) && ["KZT-Test", "investor eligibility"].every(value => evidence.simulated.includes(value)), "Simulated fixture labels are missing");
  const instrumentId = uuid(evidence.instrumentId, "instrumentId");
  for (const key of ["programId", "bondMint", "genesisHash"]) publicKey(evidence[key], key);
  assert.ok(Array.isArray(evidence.actions) && evidence.actions.length === 4, "Exactly four demo actions are required");
  assert.ok(typeof evidence.completedAt === "string" && Number.isFinite(Date.parse(evidence.completedAt)), "completedAt must be a date");
  const actionIds = new Set();
  const signatures = new Set();
  const summaries = [];
  let priorSources = null;
  let priorInvestors = null;

  for (const [index, action] of evidence.actions.entries()) {
    const label = `actions[${index}]`;
    object(action, label);
    const [type, scenario, schema, total, supplyBefore, supplyAfter, redeemed] = FIXTURE[index];
    const actionId = uuid(action.actionId, `${label}.actionId`);
    assert.ok(!actionIds.has(action.actionId), `${label}.actionId is duplicated`);
    actionIds.add(action.actionId);
    for (const [key, expected] of Object.entries({ type, scenario, amountMinor: total, supplyBefore, supplyAfter })) equal(action[key], expected, `${label}.${key}`);
    for (const key of ["scheduleSignature", "snapshotSignature", "fundingSignature", "approvalSignature", "finalizedSignature"]) signature(action[key], `${label}.${key}`, signatures);
    hash(action.snapshotHash, `${label}.snapshotHash`);
    hash(action.receiptHash, `${label}.receiptHash`);
    assert.ok(typeof action.canonicalJson === "string" && action.canonicalJson.length <= 1_000_000, `${label}.canonicalJson must be a bounded string`);
    equal(createHash("sha256").update(action.canonicalJson, "utf8").digest("hex"), action.receiptHash, `${label}.receiptHash SHA-256`);
    let receipt;
    try { receipt = JSON.parse(action.canonicalJson); } catch { throw new Error(`${label}.canonicalJson is invalid JSON`); }
    object(receipt, `${label}.receipt`);
    equal(JSON.stringify(receipt), action.canonicalJson, `${label}.canonicalJson serialization`);
    for (const [key, expected] of Object.entries({ schemaVersion: schema, actionId: action.actionId, instrumentId: evidence.instrumentId,
      programId: evidence.programId, network: "SOLANA_LOCALNET", genesisHash: evidence.genesisHash, actionType: type,
      totalAmountMinor: total, reconciliation: "MATCHED" })) equal(receipt[key], expected, `${label}.receipt.${key}`);
    object(receipt.approval, `${label}.receipt.approval`);
    equal(receipt.approval.signature, action.approvalSignature, `${label}.receipt.approval.signature`);
    object(receipt.snapshot, `${label}.receipt.snapshot`);
    for (const [key, expected] of Object.entries({ hash: action.snapshotHash, slot: action.effectiveSlot,
      plannedRecordAt: action.plannedRecordAt, effectiveBlockTime: action.effectiveBlockTime })) equal(receipt.snapshot[key], expected, `${label}.receipt.snapshot.${key}`);
    const snapshotSlot = integer(action.effectiveSlot, `${label}.effectiveSlot`);
    for (const key of ["plannedRecordAt", "effectiveBlockTime"]) assert.ok(typeof action[key] === "string" && Number.isFinite(Date.parse(action[key])), `${label}.${key} must be a date`);
    const executeAt = Date.parse(receipt.executeAt);
    assert.ok(typeof receipt.executeAt === "string" && Number.isFinite(executeAt) && executeAt % 1000 === 0 &&
      new Date(executeAt).toISOString() === receipt.executeAt, `${label}.receipt.executeAt must be a canonical UTC date in whole seconds`);
    assert.ok(executeAt >= Date.parse(action.effectiveBlockTime), `${label}.receipt.executeAt precedes the snapshot`);
    assert.ok(Array.isArray(receipt.entitlements) && receipt.entitlements.length === 3, `${label} requires three fixture entitlements`);
    assert.ok(Array.isArray(action.payments) && action.payments.length === 3, `${label} requires three payments`);
    const payments = new Map();
    for (const payment of action.payments) {
      object(payment, `${label}.payment`);
      uuid(payment.entitlementId, `${label}.payment.entitlementId`);
      assert.ok(!payments.has(payment.entitlementId), `${label} has duplicate payment entitlements`);
      signature(payment.signature, `${label}.payment.signature`, signatures);
      payments.set(payment.entitlementId, payment.signature);
    }
    const derived = await deriveCorporateActionAddresses(evidence.programId, instrumentId, actionId);
    const [actionReceipt] = await getProgramDerivedAddress({ programAddress: address(evidence.programId), seeds: ["action-receipt", decodePublicKey(derived.actionAddress)] });
    equal(action.actionReceipt, actionReceipt, `${label}.actionReceipt PDA`);
    const investors = new Set();
    const entitlementIds = new Set();
    const sources = new Map();
    const allocationRows = [];
    let amountSum = 0n;
    let tokenSum = 0n;
    let runningSupply = BigInt(supplyBefore);
    for (const row of receipt.entitlements) {
      object(row, `${label}.entitlement`);
      const investorId = uuid(row.investorId, `${label}.investorId`);
      uuid(row.entitlementId, `${label}.entitlementId`);
      assert.ok(!investors.has(row.investorId) && !entitlementIds.has(row.entitlementId), `${label} has duplicate entitlements or investors`);
      investors.add(row.investorId); entitlementIds.add(row.entitlementId);
      amountSum += integer(row.amountMinor, `${label}.entitlement.amountMinor`);
      equal(row.status, index === 0 ? "PAID" : "REDEEMED", `${label}.entitlement.status`);
      const settlement = object(row.settlement, `${label}.settlement`);
      assert.ok(payments.has(row.entitlementId), `${label}.entitlement has no matching payment`);
      equal(settlement.signature, payments.get(row.entitlementId), `${label}.settlement.signature/payment`);
      publicKey(settlement.receiver, `${label}.settlement.receiver`);
      publicKey(settlement.receiptAddress, `${label}.settlement.receiptAddress`);
      equal(settlement.cashLeg, "CONFIRMED", `${label}.settlement.cashLeg`);
      equal(settlement.assetLeg, index === 0 ? "NOT_APPLICABLE" : "CONFIRMED", `${label}.settlement.assetLeg`);
      equal(settlement.reconciliation, "MATCHED", `${label}.settlement.reconciliation`);
      assert.ok(Number.isSafeInteger(settlement.finalizedSlot) && BigInt(settlement.finalizedSlot) >= snapshotSlot, `${label}.settlement.finalizedSlot precedes snapshot or is invalid`);
      const executedAt = integer(settlement.executedAt, `${label}.settlement.executedAt`);
      assert.ok(executedAt >= BigInt(executeAt / 1000), `${label}.settlement.executedAt precedes action execution`);
      const entitlementAddress = await deriveEntitlementAddress(evidence.programId, derived.actionAddress, investorId);
      if (index === 0) {
        const [couponReceipt] = await getProgramDerivedAddress({ programAddress: address(evidence.programId),
          seeds: ["entitlement-receipt", decodePublicKey(entitlementAddress)] });
        equal(settlement.receiptAddress, couponReceipt, `${label}.coupon receipt PDA`);
        continue;
      }
      const tokens = integer(row.tokensRedeemed, `${label}.tokensRedeemed`);
      assert.ok(tokens > 0n, `${label}.tokensRedeemed must be positive`);
      equal(row.amountMinor, (tokens * (index === 3 ? 1_050_000_000n : 1_000_000_000n)).toString(), `${label}.redemption cash amount`);
      tokenSum += tokens;
      equal(settlement.supplyBefore, runningSupply.toString(), `${label}.settlement.supplyBefore chain`);
      runningSupply -= tokens;
      equal(settlement.supplyAfter, runningSupply.toString(), `${label}.settlement.supplyAfter chain`);
      assert.ok(Array.isArray(settlement.tokenAccounts) && settlement.tokenAccounts.length > 0 && settlement.tokenAccounts.length <= 8, `${label}.tokenAccounts must contain 1 to 8 sources`);
      const committed = [];
      let balance = 0n;
      let remainingBurn = tokens;
      let lastAddress = "";
      for (const source of settlement.tokenAccounts) {
        object(source, `${label}.tokenAccount`);
        publicKey(source.address, `${label}.tokenAccount.address`);
        publicKey(source.walletAddress, `${label}.tokenAccount.walletAddress`);
        assert.ok(source.address > lastAddress && !sources.has(source.address), `${label}.tokenAccounts must be unique and sorted`);
        lastAddress = source.address;
        const captured = integer(source.balanceAtSnapshot, `${label}.balanceAtSnapshot`);
        assert.ok(captured > 0n, `${label}.balanceAtSnapshot must be positive`);
        const before = integer(source.balanceBefore, `${label}.balanceBefore`);
        const burn = integer(source.burnAmount, `${label}.burnAmount`);
        const expectedBurn = captured < remainingBurn ? captured : remainingBurn;
        equal(burn, expectedBurn, `${label}.snapshot source burn allocation`);
        assert.ok(before >= burn, `${label}.source balance cannot cover burn`);
        equal(source.expectedBalanceAfter, (before - burn).toString(), `${label}.expectedBalanceAfter`);
        if (priorSources) {
          const prior = priorSources.get(source.address);
          assert.ok(prior, `${label}.source is absent from the preceding redemption`);
          equal(row.investorId, prior.investorId, `${label}.source snapshot investor`);
          equal(source.walletAddress, prior.wallet, `${label}.source snapshot owner`);
          equal(captured, prior.remaining, `${label}.source captured balance chain`);
        }
        remainingBurn -= burn;
        balance += captured;
        committed.push({ address: source.address, wallet: source.walletAddress, balanceAtSnapshot: captured });
        sources.set(source.address, { investorId: row.investorId, wallet: source.walletAddress, remaining: captured - burn });
      }
      equal(remainingBurn, 0n, `${label}.total source burn`);
      equal(settlement.sourceHash, redemptionSourceHash(derived.actionAddress, entitlementAddress, action.snapshotHash, committed), `${label}.sourceHash commitment`);
      equal(settlement.receiptAddress, await deriveRedemptionAddress(evidence.programId, "redemption-receipt", entitlementAddress), `${label}.redemption receipt PDA`);
      if (index === 1) equal(tokens, balance / 5n, `${label}.legacy 20% floor allocation`);
      if (index === 3) equal(tokens, balance, `${label}.maturity full allocation`);
      const tieAddress = committed.map(source => source.wallet).sort()[0];
      allocationRows.push({ investorId: row.investorId, tieAddress, balance });
    }
    equal(amountSum.toString(), total, `${label}.entitlement cash total`);
    if (priorInvestors) assert.ok(investors.size === priorInvestors.size && [...investors].every(value => priorInvestors.has(value)), `${label}.snapshot investors changed`);
    priorInvestors = investors;
    if (index > 0) {
      equal(receipt.bondMint, evidence.bondMint, `${label}.receipt.bondMint`);
      equal(receipt.snapshot.mintSupply, supplyBefore, `${label}.snapshot.mintSupply`);
      equal(receipt.totalTokensRedeemed, redeemed, `${label}.totalTokensRedeemed`);
      equal(receipt.finalSupply, supplyAfter, `${label}.finalSupply`);
      equal(tokenSum.toString(), redeemed, `${label}.entitlement token total`);
      equal(allocationRows.reduce((sum, row) => sum + row.balance, 0n).toString(), supplyBefore, `${label}.captured source balance total`);
      equal(runningSupply.toString(), supplyAfter, `${label}.settlement final supply`);
      if (priorSources) equal(sources.size, priorSources.size, `${label}.snapshot source count`);
      priorSources = sources;
    }
    if (index === 2) {
      object(receipt.allocation, `${label}.allocation`);
      equal(action.allocationPolicy, EARLY_REDEMPTION_ALLOCATION_POLICY, `${label}.allocationPolicy`);
      equal(action.targetTokens, "8", `${label}.targetTokens`);
      equal(action.targetAddress, await deriveExactRedemptionTargetAddress(evidence.programId, derived.actionAddress), `${label}.targetAddress PDA`);
      for (const [key, expected] of Object.entries({ policy: action.allocationPolicy, targetTokens: "8", totalBalance: "28", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" })) equal(receipt.allocation[key], expected, `${label}.allocation.${key}`);
      assert.ok(Array.isArray(action.allocations) && action.allocations.length === 3, `${label}.allocations must contain three rows`);
      const plans = new Map(action.allocations.map(row => [object(row, `${label}.allocation row`).investorId, row]));
      equal(plans.size, 3, `${label}.allocation investor uniqueness`);
      const allocation = allocateEarlyRedemption({ rows: allocationRows, targetTokens: 8n });
      for (const allocated of allocation.rows) {
        const row = receipt.entitlements.find(value => value.investorId === allocated.investorId);
        const plan = object(plans.get(allocated.investorId), `${label}.allocation plan`);
        object(row.allocation, `${label}.entitlement.allocation`);
        for (const [key, expected] of Object.entries({ snapshotBalance: allocated.balance.toString(), tokensToRedeem: allocated.redeemedTokens.toString(), amountMinor: row.amountMinor })) equal(plan[key], expected, `${label}.allocation plan.${key}`);
        equal(row.tokensRedeemed, allocated.redeemedTokens.toString(), `${label}.largest remainder allocation`);
        for (const [key, expected] of Object.entries({ tieAddress: allocated.tieAddress, roundingRemainder: allocated.quotaRemainder.toString(), denominator: "28", remainingTokens: allocated.remainingTokens.toString() })) equal(row.allocation[key], expected, `${label}.entitlement.allocation.${key}`);
      }
    }
    summaries.push({ scenario, receiptHash: action.receiptHash, amountMinor: total, tokensRedeemed: redeemed, supplyBefore, supplyAfter });
  }
  return { schema: evidence.schema, completedAt: evidence.completedAt, actions: summaries,
    verification: "OFFLINE_EVIDENCE_CONSISTENCY_ONLY", reQueriedChain: false };
}

async function main() {
  assert.ok(process.argv.length === 3, "Usage: node scripts/verify-kase-demo-evidence.mjs <runtime.json>");
  const path = resolve(process.argv[2]);
  assert.ok((await stat(path)).size <= 4_000_000, "Evidence file exceeds 4 MB");
  let evidence;
  try { evidence = JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Evidence file contains invalid JSON");
    throw error;
  }
  const result = await verifyKaseDemoEvidence(evidence);
  console.log("PASS offline KASE demo evidence consistency: four receipt hashes, identities, settlement signatures/legs, allocations and supply chain 35 → 28 → 20 → 0.");
  console.log(JSON.stringify(result, null, 2));
  console.log("This verifies saved evidence consistency only. It does not re-query RPC/database, prove current chain state or establish fresh acceptance.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`FAIL KASE demo evidence: ${error.message}`); process.exitCode = 1; });
}
