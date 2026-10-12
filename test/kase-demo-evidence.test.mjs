import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { address, getBase58Decoder, getProgramDerivedAddress } from "@solana/kit";
import { decodePublicKey, encodePublicKey, deriveCorporateActionAddresses, deriveEntitlementAddress,
  deriveExactRedemptionTargetAddress, deriveRedemptionAddress, redemptionSourceHash } from "@lifecycle-kase/solana-client";
import { verifyKaseDemoEvidence } from "../scripts/verify-kase-demo-evidence.mjs";

const key = value => encodePublicKey(new Uint8Array(32).fill(value));
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const bytes = value => Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
const timestamp = "2026-10-12T00:00:00.000Z";
const script = fileURLToPath(new URL("../scripts/verify-kase-demo-evidence.mjs", import.meta.url));
function commit(action, receipt) {
  action.canonicalJson = JSON.stringify(receipt);
  action.receiptHash = createHash("sha256").update(action.canonicalJson).digest("hex");
}
function editReceipt(evidence, index, mutate) {
  const receipt = JSON.parse(evidence.actions[index].canonicalJson);
  mutate(receipt);
  commit(evidence.actions[index], receipt);
}

// Synthetic saved evidence exercises the verifier without accepting any live-chain claim.
async function fixture() {
  const evidence = { schema: "kase-four-actions-demo-v2", scope: "DISPOSABLE_LOCALNET",
    simulated: ["KZT-Test", "investor eligibility"], instrumentId: id(1), programId: key(1), bondMint: key(2),
    genesisHash: key(3), completedAt: timestamp, actions: [] };
  const investors = [id(10), id(11), id(12)];
  const wallets = [key(10), key(11), key(12)];
  const accounts = [key(20), key(21), key(22)];
  const scenarios = ["COUPON_PAYMENT", "EARLY_REDEMPTION", "EXACT_EARLY_REDEMPTION", "BOND_REDEMPTION"];
  const balances = [[5n, 20n, 10n], [5n, 20n, 10n], [4n, 16n, 8n], [3n, 11n, 6n]];
  const burns = [[0n, 0n, 0n], [1n, 4n, 2n], [1n, 5n, 2n], [3n, 11n, 6n]];
  const amounts = [[250_000_000n, 1_050_000_000n, 450_000_000n], burns[1].map(n => n * 1_000_000_000n),
    burns[2].map(n => n * 1_000_000_000n), burns[3].map(n => n * 1_050_000_000n)];
  let signatureIndex = 1;
  const signature = () => getBase58Decoder().decode(new Uint8Array(64).fill(signatureIndex++));
  for (const [index, scenario] of scenarios.entries()) {
    const coupon = index === 0;
    const action = { type: coupon ? "COUPON_PAYMENT" : index === 3 ? "BOND_REDEMPTION" : "EARLY_REDEMPTION", scenario,
      actionId: id(100 + index), snapshotHash: String(index + 1).repeat(64), scheduleSignature: signature(),
      snapshotSignature: signature(), fundingSignature: signature(), approvalSignature: signature(), finalizedSignature: signature(),
      plannedRecordAt: timestamp, effectiveBlockTime: timestamp, effectiveSlot: String(100 + index),
      amountMinor: amounts[index].reduce((sum, n) => sum + n, 0n).toString(), supplyBefore: ["35", "35", "28", "20"][index],
      supplyAfter: ["35", "28", "20", "0"][index], payments: [] };
    const derived = await deriveCorporateActionAddresses(evidence.programId, bytes(evidence.instrumentId), bytes(action.actionId));
    [action.actionReceipt] = await getProgramDerivedAddress({ programAddress: address(evidence.programId), seeds: ["action-receipt", decodePublicKey(derived.actionAddress)] });
    const receipt = { schemaVersion: coupon ? "coupon-action-receipt-v1" : index === 2 ? "redemption-action-receipt-v2" : "redemption-action-receipt-v1",
      actionId: action.actionId, instrumentId: evidence.instrumentId, programId: evidence.programId, network: "SOLANA_LOCALNET",
      genesisHash: evidence.genesisHash, actionType: action.type, totalAmountMinor: action.amountMinor, reconciliation: "MATCHED", executeAt: timestamp,
      approval: { signature: action.approvalSignature }, snapshot: { hash: action.snapshotHash, slot: action.effectiveSlot,
        plannedRecordAt: timestamp, effectiveBlockTime: timestamp }, entitlements: [] };
    let supply = BigInt(action.supplyBefore);
    for (const [investorIndex, investorId] of investors.entries()) {
      const payment = { entitlementId: id(1000 + index * 10 + investorIndex), signature: signature() };
      action.payments.push(payment);
      const entitlement = await deriveEntitlementAddress(evidence.programId, derived.actionAddress, bytes(investorId));
      const [couponReceipt] = await getProgramDerivedAddress({ programAddress: address(evidence.programId),
        seeds: ["entitlement-receipt", decodePublicKey(entitlement)] });
      const row = { investorId, entitlementId: payment.entitlementId, amountMinor: amounts[index][investorIndex].toString(), status: coupon ? "PAID" : "REDEEMED",
        settlement: { signature: payment.signature, receiver: wallets[investorIndex], receiptAddress: couponReceipt,
          finalizedSlot: 200 + index, executedAt: "1791763200", cashLeg: "CONFIRMED", assetLeg: coupon ? "NOT_APPLICABLE" : "CONFIRMED", reconciliation: "MATCHED" } };
      if (!coupon) {
        const balance = balances[index][investorIndex];
        const burn = burns[index][investorIndex];
        row.tokensRedeemed = burn.toString();
        Object.assign(row.settlement, { receiptAddress: await deriveRedemptionAddress(evidence.programId, "redemption-receipt", entitlement),
          sourceHash: redemptionSourceHash(derived.actionAddress, entitlement, action.snapshotHash,
            [{ address: accounts[investorIndex], wallet: wallets[investorIndex], balanceAtSnapshot: balance }]),
          supplyBefore: supply.toString(), supplyAfter: (supply - burn).toString(), tokenAccounts: [{ address: accounts[investorIndex],
            walletAddress: wallets[investorIndex], balanceAtSnapshot: balance.toString(), balanceBefore: balance.toString(),
            burnAmount: burn.toString(), expectedBalanceAfter: (balance - burn).toString() }] });
        supply -= burn;
        if (index === 2) row.allocation = { tieAddress: wallets[investorIndex], roundingRemainder: (balance * 8n % 28n).toString(), denominator: "28", remainingTokens: (balance - burn).toString() };
      }
      receipt.entitlements.push(row);
    }
    if (!coupon) Object.assign(receipt, { bondMint: evidence.bondMint, totalTokensRedeemed: burns[index].reduce((sum, n) => sum + n, 0n).toString(), finalSupply: action.supplyAfter });
    if (!coupon) receipt.snapshot.mintSupply = action.supplyBefore;
    if (index === 2) {
      Object.assign(action, { allocationPolicy: "exact-target-largest-remainder-v2", targetTokens: "8",
        targetAddress: await deriveExactRedemptionTargetAddress(evidence.programId, derived.actionAddress),
        allocations: investors.map((investorId, i) => ({ investorId, snapshotBalance: balances[index][i].toString(), tokensToRedeem: burns[index][i].toString(), amountMinor: amounts[index][i].toString() })) });
      receipt.allocation = { policy: action.allocationPolicy, targetTokens: "8", totalBalance: "28", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" };
    }
    commit(action, receipt);
    evidence.actions.push(action);
  }
  return evidence;
}

const valid = await fixture();

test("offline verifier validates four fixture receipts and explicitly excludes a fresh-chain claim", async () => {
  const evidence = structuredClone(valid);
  const before = JSON.stringify(evidence);
  const result = await verifyKaseDemoEvidence(evidence);
  assert.equal(result.verification, "OFFLINE_EVIDENCE_CONSISTENCY_ONLY");
  assert.equal(result.reQueriedChain, false);
  assert.deepEqual(result.actions.map(row => row.supplyAfter), ["35", "28", "20", "0"]);
  assert.equal(JSON.stringify(evidence), before);
});

test("receipt hash corruption and rehashed identity changes are rejected", async t => {
  for (const [name, mutate, message] of [
    ["hash", e => { e.actions[0].canonicalJson += " "; }, /receiptHash SHA-256/],
    ["schema", e => { e.schema = "kase-three-actions-demo-v1"; }, /evidence.schema/],
    ["network", e => editReceipt(e, 0, r => { r.network = "SOLANA_DEVNET"; }), /receipt.network/],
    ["genesis", e => editReceipt(e, 1, r => { r.genesisHash = key(99); }), /receipt.genesisHash/],
    ["program", e => editReceipt(e, 1, r => { r.programId = key(99); }), /receipt.programId/],
    ["action", e => editReceipt(e, 2, r => { r.actionId = id(999); }), /receipt.actionId/],
    ["snapshot", e => editReceipt(e, 2, r => { r.snapshot.hash = "f".repeat(64); }), /receipt.snapshot.hash/],
    ["receipt PDA", e => { e.actions[1].actionReceipt = key(99); }, /actionReceipt PDA/]
  ]) await t.test(name, async () => {
    const evidence = structuredClone(valid); mutate(evidence);
    await assert.rejects(verifyKaseDemoEvidence(evidence), message);
  });
});

test("settlement signature, legs, finalization, totals and supply corruption are rejected", async t => {
  for (const [name, mutate, message] of [
    ["signature width", e => { e.actions[0].scheduleSignature = "2".repeat(64); }, /must encode a 64-byte signature/],
    ["payment signature", e => { e.actions[0].payments[0].signature = getBase58Decoder().decode(new Uint8Array(64).fill(99)); }, /settlement.signature\/payment/],
    ["duplicate payment", e => { e.actions[0].payments[1] = structuredClone(e.actions[0].payments[0]); }, /duplicate payment/],
    ["unmatched entitlement", e => editReceipt(e, 0, r => { r.entitlements[0].entitlementId = id(999); delete r.entitlements[0].settlement.signature; }), /no matching payment/],
    ["coupon receipt PDA", e => editReceipt(e, 0, r => { r.entitlements[0].settlement.receiptAddress = e.bondMint; }), /coupon receipt PDA/],
    ["cash leg", e => editReceipt(e, 0, r => { r.entitlements[0].settlement.cashLeg = "UNKNOWN"; }), /settlement.cashLeg/],
    ["asset leg", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.assetLeg = "UNKNOWN"; }), /settlement.assetLeg/],
    ["unfinalized", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.finalizedSlot = null; }), /finalizedSlot/],
    ["execution time", e => editReceipt(e, 2, r => { r.entitlements[0].settlement.executedAt = "0"; }), /executedAt precedes action execution/],
    ["fractional executeAt", e => editReceipt(e, 2, r => { r.executeAt = "2026-10-12T00:00:00.001Z"; }), /executeAt must be a canonical UTC date in whole seconds/],
    ["executeAt before snapshot", e => editReceipt(e, 2, r => { r.executeAt = "2026-10-11T00:00:00.000Z"; }), /executeAt precedes the snapshot/],
    ["cash total", e => editReceipt(e, 0, r => { r.entitlements[0].amountMinor = "250000001"; }), /cash total/],
    ["supply step", e => editReceipt(e, 1, r => { r.entitlements[1].settlement.supplyBefore = "35"; }), /supplyBefore chain/],
    ["decimal", e => editReceipt(e, 1, r => { r.entitlements[0].tokensRedeemed = "1e0"; }), /decimal u64/]
  ]) await t.test(name, async () => {
    const evidence = structuredClone(valid); mutate(evidence);
    await assert.rejects(verifyKaseDemoEvidence(evidence), message);
  });
});

test("exact allocation uses committed snapshot balances and owners and verifies remaining tokens", async t => {
  for (const [name, mutate, message] of [
    ["untrusted plan balance", e => { e.actions[2].allocations[0].snapshotBalance = "5"; }, /allocation plan.snapshotBalance/],
    ["wrong plan", e => { e.actions[2].allocations[0].tokensToRedeem = "2"; e.actions[2].allocations[2].tokensToRedeem = "1"; }, /allocation plan.tokensToRedeem/],
    ["captured balance", e => editReceipt(e, 2, r => { r.entitlements[0].settlement.tokenAccounts[0].balanceAtSnapshot = "5"; }), /captured balance chain/],
    ["captured owner", e => editReceipt(e, 2, r => { r.entitlements[0].settlement.tokenAccounts[0].walletAddress = key(99); }), /snapshot owner/],
    ["source hash", e => editReceipt(e, 2, r => { r.entitlements[0].settlement.sourceHash = "f".repeat(64); }), /sourceHash commitment/],
    ["tie owner", e => editReceipt(e, 2, r => { r.entitlements[0].allocation.tieAddress = key(99); }), /allocation.tieAddress/],
    ["remaining tokens", e => editReceipt(e, 2, r => { r.entitlements[0].allocation.remainingTokens = "2"; }), /allocation.remainingTokens/],
    ["rounding remainder", e => editReceipt(e, 2, r => { r.entitlements[0].allocation.roundingRemainder = "5"; }), /allocation.roundingRemainder/],
    ["target PDA", e => { e.actions[2].targetAddress = key(99); }, /targetAddress PDA/]
  ]) await t.test(name, async () => {
    const evidence = structuredClone(valid); mutate(evidence);
    await assert.rejects(verifyKaseDemoEvidence(evidence), message);
  });
});

test("rehashing cannot reassign an unchanged captured token source to another investor", async () => {
  const evidence = structuredClone(valid);
  const action = evidence.actions[2];
  const receipt = JSON.parse(action.canonicalJson);
  [receipt.entitlements[0].investorId, receipt.entitlements[1].investorId] = [receipt.entitlements[1].investorId, receipt.entitlements[0].investorId];
  [action.allocations[0].investorId, action.allocations[1].investorId] = [action.allocations[1].investorId, action.allocations[0].investorId];
  const derived = await deriveCorporateActionAddresses(evidence.programId, bytes(evidence.instrumentId), bytes(action.actionId));
  for (const row of receipt.entitlements.slice(0, 2)) {
    const entitlement = await deriveEntitlementAddress(evidence.programId, derived.actionAddress, bytes(row.investorId));
    row.settlement.sourceHash = redemptionSourceHash(derived.actionAddress, entitlement, action.snapshotHash,
      row.settlement.tokenAccounts.map(source => ({ address: source.address, wallet: source.walletAddress, balanceAtSnapshot: BigInt(source.balanceAtSnapshot) })));
    row.settlement.receiptAddress = await deriveRedemptionAddress(evidence.programId, "redemption-receipt", entitlement);
  }
  commit(action, receipt);
  await assert.rejects(verifyKaseDemoEvidence(evidence), /source snapshot investor/);
});

test("CLI reads saved JSON, gives bounded failures and reports offline-only scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kase-evidence-test-"));
  try {
    const path = join(directory, "evidence.json");
    await writeFile(path, JSON.stringify(valid));
    const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10_000 });
    const success = run([path]);
    assert.ifError(success.error); assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /does not re-query RPC\/database/);
    assert.match(success.stdout, /"reQueriedChain": false/);
    const usage = run([]);
    assert.equal(usage.status, 1); assert.match(usage.stderr, /Usage:/);
    await writeFile(path, "{broken");
    const invalid = run([path]);
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /invalid JSON/); assert.equal(invalid.stdout, "");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
