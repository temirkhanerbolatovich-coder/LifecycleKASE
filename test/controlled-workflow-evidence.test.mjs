import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { address, getBase58Decoder, getProgramDerivedAddress } from "@solana/kit";
import { decodeControlledTokenPosition, decodePublicKey, encodePublicKey, deriveCorporateActionAddresses, deriveEntitlementAddress,
  deriveControlledCaptureAddress, deriveControlledHoldingAddress, deriveControlledPolicyAddress, deriveControlledUnitReservationAddress,
  deriveExactRedemptionTargetAddress, deriveRedemptionAddress, redemptionSourceHash, TOKEN_2022_PROGRAM_ID } from "@lifecycle-kase/solana-client";
import { verifyControlledWorkflowEvidence } from "../scripts/verify-controlled-workflow-evidence.mjs";

const key = value => encodePublicKey(new Uint8Array(32).fill(value));
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const bytes = value => Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
const timestamp = "2026-10-12T00:00:00.000Z";
const script = fileURLToPath(new URL("../scripts/verify-controlled-workflow-evidence.mjs", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
function commit(action, receipt) { action.canonicalJson = JSON.stringify(receipt); action.receiptHash = hash(action.canonicalJson); }
function editReceipt(evidence, index, mutate) { const receipt = JSON.parse(evidence.actions[index].canonicalJson); mutate(receipt); commit(evidence.actions[index], receipt); }
function editCapture(evidence, index, mutate) {
  editReceipt(evidence, index, receipt => {
    const captured = receipt.controlledRegistry.captureEvidence; const registry = JSON.parse(captured.registryCanonicalJson); mutate(captured, registry);
    captured.registry = registry; captured.registryCanonicalJson = JSON.stringify(registry); captured.registrySha256 = hash(captured.registryCanonicalJson);
    evidence.actions[index].captureEvidence = structuredClone(captured);
  });
}

// Synthetic fixtures exercise saved-evidence validation and deliberately do not make a live-chain claim.
async function fixture() {
  const evidence = { schema: "controlled-four-actions-workflow-v1", scope: "DISPOSABLE_LOCALNET", tokenPolicy: "CONTROLLED_FROZEN_V2",
    simulated: ["KZT-Test", "investor eligibility"], instrumentId: id(1), programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", bondMint: key(2), settlementMint: key(3),
    genesisHash: key(4), startedAt: timestamp, completedAt: timestamp, programSha256: "a".repeat(64), idlSha256: "b".repeat(64),
    issuance: [], actions: [], sourceFingerprints: Object.fromEntries(["apps/api/src/onchain-entitlements.ts", "apps/api/src/controlled-settlement.ts",
      "apps/api/src/redemption-execution.ts", "apps/api/src/coupon-receipt.ts", "apps/api/src/redemption-receipt.ts", "apps/api/src/entitlements.ts",
      "scripts/test-kase-demo.mjs", "scripts/test-controlled-workflow.mjs"].map(path => [path, "c".repeat(64)])) };
  let signatureIndex = 1; const signature = () => getBase58Decoder().decode(new Uint8Array(64).fill(signatureIndex++));
  const investors = [id(10), id(11), id(12)]; const wallets = [key(10), key(11), key(12)]; const accounts = [key(20), key(21), key(22)];
  const balances = [[10n, 20n, 5n], [10n, 20n, 5n], [8n, 16n, 4n], [6n, 11n, 3n]];
  const burns = [[0n, 0n, 0n], [2n, 4n, 1n], [2n, 5n, 1n], [6n, 11n, 3n]];
  const scenarios = ["COUPON_PAYMENT", "EARLY_REDEMPTION", "EXACT_EARLY_REDEMPTION", "BOND_REDEMPTION"];
  const instrument = await deriveCorporateActionAddresses(evidence.programId, bytes(evidence.instrumentId), bytes(id(100)));
  const policyAddress = await deriveControlledPolicyAddress(evidence.programId, instrument.instrumentAddress);
  for (const phase of ["MINT_SETUP", "INITIALIZE", "DISTRIBUTION", "ACTIVATE"]) evidence.issuance.push({ phase, signature: signature(), operationId: id(900 + signatureIndex),
    instrumentAddress: instrument.instrumentAddress, controlledPolicyAddress: policyAddress });
  for (const [index, scenario] of scenarios.entries()) {
    const coupon = index === 0; const action = { type: coupon ? "COUPON_PAYMENT" : index === 3 ? "BOND_REDEMPTION" : "EARLY_REDEMPTION", scenario,
      actionId: id(100 + index), snapshotHash: String(index + 1).repeat(64), scheduleSignature: signature(), snapshotSignature: signature(), fundingSignature: signature(),
      approvalSignature: signature(), finalizedSignature: signature(), captureBeginSignature: signature(), captureFinishSignature: signature(), registryMutationBeyondWindowRejected: true,
      plannedRecordAt: timestamp, effectiveBlockTime: timestamp, effectiveSlot: String(100 + index),
      amountMinor: ["1750000000", "7000000000", "8000000000", "21000000000"][index], supplyBefore: ["35", "35", "28", "20"][index],
      supplyAfter: ["35", "28", "20", "0"][index], payments: [], unitReservations: [] };
    const derived = await deriveCorporateActionAddresses(evidence.programId, bytes(evidence.instrumentId), bytes(action.actionId));
    [action.actionReceipt] = await getProgramDerivedAddress({ programAddress: address(evidence.programId), seeds: ["action-receipt", decodePublicKey(derived.actionAddress)] });
    const captureAddress = await deriveControlledCaptureAddress(evidence.programId, derived.actionAddress);
    const positions = accounts.map((token, i) => {
      const data = Buffer.alloc(170); Buffer.from(decodePublicKey(evidence.bondMint)).copy(data, 0); Buffer.from(decodePublicKey(wallets[i])).copy(data, 32);
      data.writeBigUInt64LE(balances[index][i], 64); data[108] = 2; data[165] = 2; data.writeUInt16LE(7, 166);
      return decodeControlledTokenPosition({ address: token, owner: TOKEN_2022_PROGRAM_ID, dataBase64: data.toString("base64"), executable: false }, evidence.bondMint);
    }).sort((left, right) => left.address < right.address ? -1 : 1);
    const registry = JSON.parse(JSON.stringify({ mintAddress: evidence.bondMint, slot: 120 + index, supply: BigInt(action.supplyBefore), totalBalance: BigInt(action.supplyBefore),
      positions, positivePositions: positions }, (_, value) => typeof value === "bigint" ? value.toString() : value));
    action.captureEvidence = { schema: "controlled-capture-v1", controlledPolicyAddress: policyAddress, controlledCaptureAddress: captureAddress,
      startedSlot: action.effectiveSlot, startedAt: "1791763200", readSlot: 120 + index, registry, registryCanonicalJson: JSON.stringify(registry), registrySha256: hash(JSON.stringify(registry)) };
    const receipt = { schemaVersion: coupon ? "coupon-controlled-action-receipt-v1" : "redemption-controlled-action-receipt-v1", tokenPolicy: evidence.tokenPolicy,
      actionId: action.actionId, instrumentId: evidence.instrumentId, programId: evidence.programId, network: "SOLANA_LOCALNET", genesisHash: evidence.genesisHash,
      actionType: action.type, totalAmountMinor: action.amountMinor, reconciliation: "MATCHED", executeAt: timestamp,
      approval: { signature: action.approvalSignature }, snapshot: { hash: action.snapshotHash, slot: action.effectiveSlot, plannedRecordAt: timestamp, effectiveBlockTime: timestamp },
      controlledRegistry: { captureAddress, captureFinishSignature: action.captureFinishSignature, captureEvidence: structuredClone(action.captureEvidence),
        assignedUnitPolicy: coupon ? "NOT_APPLICABLE" : "SNAPSHOT_SOURCE_BASE58_ASC_GREEDY", ...(coupon ? {} : { untouchedZeroSources: "IMMUTABLE_COMMITMENT_ONLY" }) }, entitlements: [] };
    let supply = BigInt(action.supplyBefore);
    for (const [i, investorId] of investors.entries()) {
      const payment = { entitlementId: id(1000 + index * 10 + i), signature: signature() }; action.payments.push(payment);
      const entitlement = await deriveEntitlementAddress(evidence.programId, derived.actionAddress, bytes(investorId));
      const [couponReceipt] = await getProgramDerivedAddress({ programAddress: address(evidence.programId), seeds: ["entitlement-receipt", decodePublicKey(entitlement)] });
      const amount = coupon ? balances[index][i] * 50_000_000n : burns[index][i] * (index === 3 ? 1_050_000_000n : 1_000_000_000n);
      const row = { investorId, entitlementId: payment.entitlementId, amountMinor: amount.toString(), status: coupon ? "PAID" : "REDEEMED",
        settlement: { signature: payment.signature, receiver: wallets[i], receiptAddress: couponReceipt, finalizedSlot: 200 + index, executedAt: "1791763200",
          cashLeg: "CONFIRMED", assetLeg: coupon ? "NOT_APPLICABLE" : "CONFIRMED", reconciliation: "MATCHED" } };
      if (!coupon) {
        const committed = [{ address: accounts[i], wallet: wallets[i], balanceAtSnapshot: balances[index][i] }];
        const sourceHash = redemptionSourceHash(derived.actionAddress, entitlement, action.snapshotHash, committed);
        const unitAddress = await deriveControlledUnitReservationAddress(evidence.programId, entitlement);
        const holdingAddress = await deriveControlledHoldingAddress(evidence.programId, derived.instrumentAddress, accounts[i]);
        row.tokensRedeemed = burns[index][i].toString();
        const unitReservation = { unitReservationAddress: unitAddress, controlledPolicyAddress: policyAddress, controlledCaptureAddress: captureAddress, sourceHash,
          allocations: [row.tokensRedeemed], consumed: true, holdingAddresses: [holdingAddress], holdings: [{ address: holdingAddress, tokenAccount: accounts[i], walletAddress: wallets[i], reservedTokens: "0" }] };
        action.unitReservations.push({ entitlementId: payment.entitlementId, investorId, signature: signature(), unitReservationAddress: unitAddress,
          tokensToRedeem: row.tokensRedeemed, allocations: [row.tokensRedeemed], holdingAddresses: [holdingAddress] });
        Object.assign(row.settlement, { receiptAddress: await deriveRedemptionAddress(evidence.programId, "redemption-receipt", entitlement), sourceHash,
          supplyBefore: supply.toString(), supplyAfter: (supply - burns[index][i]).toString(), freezePolicy: "ATOMIC_THAW_BURN_REFREEZE", unitReservation,
          tokenAccounts: [{ address: accounts[i], walletAddress: wallets[i], balanceAtSnapshot: balances[index][i].toString(), balanceBefore: balances[index][i].toString(),
            burnAmount: row.tokensRedeemed, expectedBalanceAfter: (balances[index][i] - burns[index][i]).toString() }] });
        supply -= burns[index][i];
        if (index === 2) row.allocation = { tieAddress: wallets[i], roundingRemainder: (balances[index][i] * 8n % 28n).toString(), denominator: "28", remainingTokens: (balances[index][i] - burns[index][i]).toString() };
      }
      receipt.entitlements.push(row);
    }
    if (!coupon) { receipt.snapshot.mintSupply = action.supplyBefore; Object.assign(receipt, { bondMint: evidence.bondMint, totalTokensRedeemed: burns[index].reduce((sum, value) => sum + value, 0n).toString(), finalSupply: action.supplyAfter }); }
    if (index === 2) {
      Object.assign(action, { allocationPolicy: "exact-target-largest-remainder-v2", targetTokens: "8", targetAddress: await deriveExactRedemptionTargetAddress(evidence.programId, derived.actionAddress),
        allocations: investors.map((investorId, i) => ({ investorId, snapshotBalance: balances[index][i].toString(), tokensToRedeem: burns[index][i].toString(), amountMinor: receipt.entitlements[i].amountMinor })) });
      receipt.allocation = { policy: action.allocationPolicy, targetTokens: "8", totalBalance: "28", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" };
    }
    commit(action, receipt); evidence.actions.push(action);
  }
  const maturity = JSON.parse(evidence.actions[3].canonicalJson); const first = maturity.entitlements[0];
  evidence.postBurnClosureRecovery = { sourceAddress: first.settlement.tokenAccounts[0].address, walletAddress: first.settlement.receiver,
    closureSignature: signature(), paymentSignature: first.settlement.signature, operationId: id(777), getRecoveryVerified: true,
    confirmedOriginalSignature: first.settlement.signature, sourceAbsentAfterConfirm: true };
  return evidence;
}
const valid = await fixture();
test("controlled verifier checks original hashes and fixed economics without rewriting evidence or making a fresh-runtime claim", async () => {
  const evidence = structuredClone(valid); const before = JSON.stringify(evidence); const result = await verifyControlledWorkflowEvidence(evidence);
  assert.equal(result.verification, "OFFLINE_EVIDENCE_CONSISTENCY_ONLY"); assert.equal(result.reQueriedChain, false); assert.equal(result.authenticatedRuntime, false);
  assert.deepEqual(result.actions.map(action => action.receiptHash), evidence.actions.map(action => action.receiptHash));
  assert.deepEqual(result.actions.map(action => action.supplyAfter), ["35", "28", "20", "0"]); assert.equal(JSON.stringify(evidence), before);
});
test("rehashed controlled receipt tampering cannot bypass raw capture, reservation, PDA or financial checks", async t => {
  for (const [label, mutate] of [
    ["receipt hash", e => { e.actions[0].canonicalJson += " "; }],
    ["schema", e => { e.schema = "kase-four-actions-demo-v2"; }],
    ["wrong candidate", e => { e.programId = key(99); }],
    ["policy", e => editReceipt(e, 0, r => { r.tokenPolicy = "LEGACY_UNRESTRICTED_V1"; })],
    ["capture PDA", e => editReceipt(e, 1, r => { r.controlledRegistry.captureAddress = key(99); })],
    ["capture signature", e => editReceipt(e, 1, r => { r.controlledRegistry.captureFinishSignature = e.actions[1].captureBeginSignature; })],
    ["cash legs", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.cashLeg = "UNKNOWN"; })],
    ["supply", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.supplyAfter = "32"; })],
    ["economic amount", e => editReceipt(e, 2, r => { r.entitlements[0].amountMinor = "3000000000"; })],
    ["coupon rights", e => editReceipt(e, 0, r => { r.entitlements[0].amountMinor = "1000000000"; r.entitlements[1].amountMinor = "500000000"; })],
    ["unit consumed", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.unitReservation.consumed = false; })],
    ["unit PDA", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.unitReservation.unitReservationAddress = key(99); })],
    ["unit allocation", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.unitReservation.allocations = ["3"]; })],
    ["unit source hash", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.unitReservation.sourceHash = "f".repeat(64); })],
    ["Holding PDA", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.unitReservation.holdingAddresses[0] = key(99); })],
    ["Holding owner", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.unitReservation.holdings[0].walletAddress = key(99); })],
    ["Holding uncleared", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.unitReservation.holdings[0].reservedTokens = "1"; })],
    ["source owner", e => editReceipt(e, 2, r => { r.entitlements[0].settlement.tokenAccounts[0].walletAddress = key(99); })],
    ["zero source", e => editReceipt(e, 2, r => { r.entitlements[0].settlement.tokenAccounts[0].burnAmount = "0"; r.entitlements[0].settlement.tokenAccounts[0].sourceUntouched = true; })],
    ["freeze policy", e => editReceipt(e, 1, r => { r.entitlements[0].settlement.freezePolicy = "THAW_ONLY"; })],
    ["reserve operation", e => { e.actions[2].unitReservations[0].tokensToRedeem = "3"; }],
    ["reserve signature reuse", e => { e.actions[2].unitReservations[0].signature = e.actions[2].payments[0].signature; }],
    ["exact denominator", e => editReceipt(e, 2, r => { r.entitlements[0].allocation.denominator = "35"; })],
    ["exact target", e => { e.actions[2].targetAddress = key(99); }],
    ["issuance order", e => { [e.issuance[1], e.issuance[2]] = [e.issuance[2], e.issuance[1]]; }],
    ["issuance PDA", e => { e.issuance[0].instrumentAddress = key(99); }],
    ["artifact hash", e => { e.programSha256 = "short"; }],
    ["missing source fingerprint", e => { delete e.sourceFingerprints["apps/api/src/controlled-settlement.ts"]; }],
    ["closed source owner", e => { e.postBurnClosureRecovery.walletAddress = key(99); }],
    ["closed source payment", e => { e.postBurnClosureRecovery.paymentSignature = e.actions[2].payments[0].signature; }],
    ["closure signature reused", e => { e.postBurnClosureRecovery.closureSignature = e.actions[3].payments[0].signature; }],
    ["confirmation signature replaced", e => { e.postBurnClosureRecovery.confirmedOriginalSignature = e.actions[2].payments[0].signature; }],
    ["closure GET assertion", e => { e.postBurnClosureRecovery.getRecoveryVerified = false; }],
  ]) await t.test(label, async () => { const evidence = structuredClone(valid); mutate(evidence); await assert.rejects(verifyControlledWorkflowEvidence(evidence)); });
});
test("rehashing raw metadata and outer receipts cannot forge frozen token bytes, complete owners, balances or cutoff", async t => {
  for (const [label, mutate] of [
    ["registry supply", (_c, r) => { r.supply = "34"; }],
    ["read before lock", (c, r) => { c.readSlot = 1; r.slot = 1; }],
    ["clock before record", c => { c.startedAt = "1791763199"; }],
    ["raw owner metadata", (_c, r) => { r.positions[0].walletAddress = key(99); r.positivePositions[0].walletAddress = key(99); }],
    ["raw balance metadata", (_c, r) => { r.positions[0].balance = "9"; r.positivePositions[0].balance = "9"; }],
    ["thawed raw bytes", (_c, r) => { const data = Buffer.from(r.positions[0].dataBase64, "base64"); data[108] = 1;
      r.positions[0].dataBase64 = data.toString("base64"); r.positions[0].state = "INITIALIZED"; r.positivePositions[0] = structuredClone(r.positions[0]); }],
    ["unknown owner extension", (_c, r) => { const data = Buffer.from(r.positions[0].dataBase64, "base64"); data.writeUInt16LE(15, 166);
      r.positions[0].dataBase64 = data.toString("base64"); r.positivePositions[0] = structuredClone(r.positions[0]); }],
    ["omitted source", (_c, r) => { r.positions.pop(); r.positivePositions.pop(); }],
    ["duplicate source", (_c, r) => { r.positions.push(structuredClone(r.positions[0])); r.positivePositions.push(structuredClone(r.positions[0])); }],
  ]) await t.test(label, async () => { const evidence = structuredClone(valid); editCapture(evidence, 1, mutate); await assert.rejects(verifyControlledWorkflowEvidence(evidence)); });
});
test("raw canonical UTF-8 order remains independent of parsed JSONB object key order", async () => {
  const evidence = structuredClone(valid);
  editReceipt(evidence, 0, receipt => {
    const raw = receipt.controlledRegistry.captureEvidence; raw.registry = Object.fromEntries(Object.entries(raw.registry).sort(([left], [right]) => left.localeCompare(right)));
    evidence.actions[0].captureEvidence = structuredClone(raw);
  });
  await verifyControlledWorkflowEvidence(evidence);
});
test("CLI succeeds only on bounded valid controlled JSON and labels its offline scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "controlled-evidence-test-"));
  try {
    const path = join(directory, "runtime.json"); await writeFile(path, JSON.stringify(valid));
    const run = spawnSync(process.execPath, [script, path], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /OFFLINE_EVIDENCE_CONSISTENCY_ONLY/); assert.match(run.stdout, /no RPC\/database re-query/);
    await writeFile(path, "{broken"); const malformed = spawnSync(process.execPath, [script, path], { encoding: "utf8" }); assert.notEqual(malformed.status, 0); assert.match(malformed.stderr, /invalid JSON/);
    await writeFile(path, " ".repeat(4_000_001)); const oversized = spawnSync(process.execPath, [script, path], { encoding: "utf8" }); assert.notEqual(oversized.status, 0); assert.match(oversized.stderr, /exceeds 4 MB/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
