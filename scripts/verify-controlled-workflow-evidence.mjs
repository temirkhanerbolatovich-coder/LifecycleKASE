import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { getBase58Encoder } from "@solana/kit";
import { decodeControlledTokenPosition, deriveControlledCaptureAddress, deriveControlledHoldingAddress, deriveControlledPolicyAddress,
  deriveControlledUnitReservationAddress, deriveCorporateActionAddresses, deriveEntitlementAddress, redemptionSourceHash } from "@lifecycle-kase/solana-client";
import { verifyKaseDemoEvidence } from "./verify-kase-demo-evidence.mjs";

const POLICY = "CONTROLLED_FROZEN_V2";
const LOCALNET_CANDIDATE = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const HASH = /^[0-9a-f]{64}$/;
const PHASES = ["MINT_SETUP", "INITIALIZE", "DISTRIBUTION", "ACTIVATE"];
const uuid = value => Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const equal = (actual, expected, label) => assert.ok(actual === expected, `${label} differs`);
function object(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}
function integer(value, label) {
  assert.ok(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value), `${label} must be a decimal u64`);
  const result = BigInt(value); assert.ok(result <= (1n << 64n) - 1n, `${label} exceeds u64`); return result;
}
function signature(value, label, seen) {
  assert.ok(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value) && getBase58Encoder().encode(value).length === 64, `${label} must encode a 64-byte signature`);
  assert.ok(!seen.has(value), `${label} duplicates another signature`); seen.add(value);
}
function hashed(value, label) { assert.ok(typeof value === "string" && HASH.test(value) && value !== "0".repeat(64), `${label} must be a nonzero SHA-256 hash`); }

function rawCapture(evidence, receipt, action, expectedPolicy, expectedCapture) {
  const raw = object(receipt.controlledRegistry.captureEvidence, "captureEvidence");
  assert.ok(isDeepStrictEqual(raw, action.captureEvidence), "Receipt and runtime capture evidence differ");
  for (const [field, expected] of Object.entries({ schema: "controlled-capture-v1", controlledPolicyAddress: expectedPolicy,
    controlledCaptureAddress: expectedCapture, startedSlot: action.effectiveSlot })) equal(raw[field], expected, `captureEvidence.${field}`);
  assert.ok(typeof raw.registryCanonicalJson === "string" && raw.registryCanonicalJson.length <= 1_000_000, "Raw registry JSON must be bounded");
  equal(sha256(raw.registryCanonicalJson), raw.registrySha256, "Raw registry SHA-256");
  const registry = object(JSON.parse(raw.registryCanonicalJson), "registry");
  assert.ok(isDeepStrictEqual(registry, raw.registry), "Raw registry parsed values differ from JSONB metadata");
  const startedSlot = integer(raw.startedSlot, "capture startedSlot"); const startedAt = integer(raw.startedAt, "capture startedAt");
  equal(new Date(Number(startedAt) * 1000).toISOString(), action.effectiveBlockTime, "Capture clock/snapshot clock");
  assert.ok(Number.isSafeInteger(raw.readSlot) && BigInt(raw.readSlot) >= startedSlot && registry.slot === raw.readSlot, "Raw registry read slot precedes the lock or differs");
  const delay = Date.parse(action.effectiveBlockTime) - Date.parse(action.plannedRecordAt);
  assert.ok(delay >= 0 && delay <= 300_000, "Capture lock must begin within the record-date window");
  equal(registry.mintAddress, evidence.bondMint, "Raw registry mint");
  equal(registry.supply, action.supplyBefore, "Raw registry supply"); equal(registry.totalBalance, action.supplyBefore, "Raw registry totalBalance");
  assert.ok(Array.isArray(registry.positions) && registry.positions.length > 0 && registry.positions.length <= 64 && Array.isArray(registry.positivePositions), "Raw capture requires bounded complete positions");
  const positions = registry.positions.map(position => {
    object(position, "raw token position");
    const decoded = decodeControlledTokenPosition({ address: position.address, owner: position.tokenProgramOwner, executable: false, dataBase64: position.dataBase64 }, evidence.bondMint);
    for (const field of ["address", "tokenProgramOwner", "mintAddress", "walletAddress", "state", "delegate", "closeAuthority", "immutableOwner", "cpiGuardEnabled", "incomingMemoRequired", "dataBase64"]) {
      equal(position[field], decoded[field], `Raw token ${field}`);
    }
    for (const field of ["balance", "delegatedAmount"]) equal(position[field], decoded[field].toString(), `Raw token ${field}`);
    equal(position.nativeReserve, decoded.nativeReserve?.toString() ?? null, "Raw token nativeReserve");
    assert.ok(isDeepStrictEqual(position.extensions, decoded.extensions), "Raw token extensions disagree with bytes");
    if (decoded.balance > 0n) assert.ok(decoded.state === "FROZEN" && decoded.immutableOwner && decoded.delegate === null && decoded.closeAuthority === null &&
      decoded.extensions.every(extension => [7, 8, 11].includes(extension.type)), "Positive raw positions must remain frozen immutable-owner Token-2022 accounts");
    return decoded;
  });
  equal(new Set(positions.map(position => position.address)).size, positions.length, "Raw token source uniqueness");
  const positive = positions.filter(position => position.balance > 0n);
  assert.ok(isDeepStrictEqual(registry.positivePositions, registry.positions.filter(position => integer(position.balance, "raw balance") > 0n)), "Raw positive positions differ from complete registry");
  equal(positive.reduce((sum, position) => sum + position.balance, 0n).toString(), action.supplyBefore, "Raw capture complete supply");
  return new Map(positive.map(position => [position.address, position]));
}

/** Validates saved fixed-fixture evidence only; it never queries RPC, a database or local artifact files. */
export async function verifyControlledWorkflowEvidence(evidence) {
  object(evidence, "evidence"); equal(evidence.schema, "controlled-four-actions-workflow-v1", "evidence.schema");
  equal(evidence.tokenPolicy, POLICY, "evidence.tokenPolicy");
  equal(evidence.programId, LOCALNET_CANDIDATE, "Controlled Localnet candidate program");
  hashed(evidence.programSha256, "programSha256"); hashed(evidence.idlSha256, "idlSha256");
  const fingerprints = object(evidence.sourceFingerprints, "sourceFingerprints");
  assert.ok(Object.keys(fingerprints).length >= 8 && Object.keys(fingerprints).length <= 128, "Source fingerprints must be bounded and complete");
  for (const field of ["apps/api/src/onchain-entitlements.ts", "apps/api/src/controlled-settlement.ts", "apps/api/src/redemption-execution.ts",
    "apps/api/src/coupon-receipt.ts", "apps/api/src/redemption-receipt.ts", "apps/api/src/entitlements.ts", "scripts/test-kase-demo.mjs", "scripts/test-controlled-workflow.mjs"]) hashed(fingerprints[field], `sourceFingerprint ${field}`);
  for (const [path, value] of Object.entries(fingerprints)) { assert.ok(path.length <= 200 && !path.startsWith("/") && !path.includes(".."), "Source fingerprint path is invalid"); hashed(value, `sourceFingerprint ${path}`); }
  assert.ok(typeof evidence.startedAt === "string" && Number.isFinite(Date.parse(evidence.startedAt)) && Date.parse(evidence.startedAt) <= Date.parse(evidence.completedAt), "Runtime timestamps are invalid");
  assert.ok(Array.isArray(evidence.issuance) && evidence.issuance.length === 4, "Four controlled issuance phases are required");
  const allSignatures = new Set();
  assert.ok(Array.isArray(evidence.actions) && evidence.actions.length === 4, "Exactly four controlled actions are required");
  const instrumentId = uuid(evidence.instrumentId);
  const instrument = await deriveCorporateActionAddresses(evidence.programId, instrumentId, uuid(evidence.actions[0].actionId));
  const policyAddress = await deriveControlledPolicyAddress(evidence.programId, instrument.instrumentAddress);
  for (const [index, issuance] of evidence.issuance.entries()) {
    object(issuance, "issuance"); equal(issuance.phase, PHASES[index], "Issuance phase order");
    assert.match(issuance.operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    signature(issuance.signature, "Issuance signature", allSignatures);
    equal(issuance.instrumentAddress, instrument.instrumentAddress, "Issuance instrument PDA"); equal(issuance.controlledPolicyAddress, policyAddress, "Issuance policy PDA");
  }
  const common = structuredClone(evidence); common.schema = "kase-four-actions-demo-v2";
  for (const [index, action] of evidence.actions.entries()) {
    object(action, "action");
    for (const field of ["scheduleSignature", "snapshotSignature", "fundingSignature", "approvalSignature", "finalizedSignature", "captureBeginSignature", "captureFinishSignature"]) signature(action[field], field, allSignatures);
    for (const payment of action.payments) signature(payment.signature, "Payment signature", allSignatures);
    const derived = await deriveCorporateActionAddresses(evidence.programId, instrumentId, uuid(action.actionId));
    const captureAddress = await deriveControlledCaptureAddress(evidence.programId, derived.actionAddress);
    assert.ok(typeof action.canonicalJson === "string" && action.canonicalJson.length <= 1_000_000, "Controlled receipt must be bounded JSON");
    equal(sha256(action.canonicalJson), action.receiptHash, "Original controlled receipt SHA-256");
    const receipt = object(JSON.parse(action.canonicalJson), "receipt"); equal(JSON.stringify(receipt), action.canonicalJson, "Original controlled receipt canonical serialization");
    equal(receipt.schemaVersion, index === 0 ? "coupon-controlled-action-receipt-v1" : "redemption-controlled-action-receipt-v1", "Controlled receipt schema");
    equal(receipt.tokenPolicy, POLICY, "Controlled receipt tokenPolicy");
    const registry = object(receipt.controlledRegistry, "controlledRegistry");
    equal(registry.captureAddress, captureAddress, "Receipt capture PDA"); equal(registry.captureFinishSignature, action.captureFinishSignature, "Receipt capture FINISH signature");
    equal(registry.assignedUnitPolicy, index === 0 ? "NOT_APPLICABLE" : "SNAPSHOT_SOURCE_BASE58_ASC_GREEDY", "Assigned unit policy");
    if (index > 0) equal(registry.untouchedZeroSources, "IMMUTABLE_COMMITMENT_ONLY", "Untouched source policy");
    equal(action.registryMutationBeyondWindowRejected, true, "Runtime registry immutability assertion");
    const captured = rawCapture(evidence, receipt, action, policyAddress, captureAddress);
    const owners = new Set(); const coveredSources = new Set(); const reservations = new Map();
    assert.ok(Array.isArray(action.unitReservations) && action.unitReservations.length === (index === 0 ? 0 : 3), "Action requires its complete assigned-unit reservation set");
    for (const reservation of action.unitReservations) {
      object(reservation, "unit reservation operation"); signature(reservation.signature, "Unit reservation signature", allSignatures);
      assert.ok(!reservations.has(reservation.entitlementId), "Unit reservation entitlements are duplicated"); reservations.set(reservation.entitlementId, reservation);
    }
    for (const row of receipt.entitlements) {
      const settlement = object(row.settlement, "settlement");
      assert.ok(!owners.has(settlement.receiver), "Fixture settlement owners are duplicated"); owners.add(settlement.receiver);
      const ownerPositions = [...captured.values()].filter(position => position.walletAddress === settlement.receiver);
      assert.ok(ownerPositions.length > 0, "Settlement receiver is absent from the fixed raw capture fixture");
      if (index === 0) {
        equal(row.amountMinor, (ownerPositions.reduce((sum, position) => sum + position.balance, 0n) * 50_000_000n).toString(), "Captured coupon rights");
        ownerPositions.forEach(position => coveredSources.add(position.address)); continue;
      }
      const entitlementAddress = await deriveEntitlementAddress(evidence.programId, derived.actionAddress, uuid(row.investorId));
      assert.ok(Array.isArray(settlement.tokenAccounts) && settlement.tokenAccounts.length > 0 && settlement.tokenAccounts.length <= 8, "Controlled burn sources must be bounded");
      const sources = settlement.tokenAccounts.map(source => {
        const position = captured.get(source.address); assert.ok(position && !coveredSources.has(source.address), "Controlled source is omitted, repeated or absent from raw capture"); coveredSources.add(source.address);
        equal(source.walletAddress, position.walletAddress, "Burn/raw source owner"); equal(source.balanceAtSnapshot, position.balance.toString(), "Burn/raw captured balance");
        assert.ok(integer(source.burnAmount, "burnAmount") > 0n && source.sourceUntouched !== true,
          "Fixed fixture verifier does not support zero-assignment source history; use separate controlled-registry acceptance evidence");
        return { address: source.address, wallet: source.walletAddress, balanceAtSnapshot: position.balance };
      });
      equal(new Set(sources.map(source => source.wallet)).size, 1, "Fixed workflow source owner coverage");
      equal(sources[0].wallet, settlement.receiver, "Fixed workflow payout/source owner");
      equal(sources.length, ownerPositions.length, "Raw capture per-holder source coverage");
      const sourceHash = redemptionSourceHash(derived.actionAddress, entitlementAddress, action.snapshotHash, sources);
      equal(settlement.sourceHash, sourceHash, "Controlled source commitment"); equal(settlement.freezePolicy, "ATOMIC_THAW_BURN_REFREEZE", "Burn freeze policy");
      const reservation = object(settlement.unitReservation, "Consumed unitReservation");
      const expectedReservation = await deriveControlledUnitReservationAddress(evidence.programId, entitlementAddress);
      for (const [field, expected] of Object.entries({ unitReservationAddress: expectedReservation, controlledPolicyAddress: policyAddress,
        controlledCaptureAddress: captureAddress, sourceHash, consumed: true })) equal(reservation[field], expected, `UnitReservation.${field}`);
      let remaining = integer(row.tokensRedeemed, "tokensRedeemed");
      const assigned = sources.map(source => { const amount = source.balanceAtSnapshot < remaining ? source.balanceAtSnapshot : remaining; remaining -= amount; return amount.toString(); });
      equal(remaining, 0n, "Complete assigned burn");
      assert.deepEqual(reservation.allocations, assigned, "Consumed allocations differ from immutable greedy assignment");
      assert.ok(Array.isArray(reservation.holdingAddresses) && reservation.holdingAddresses.length === sources.length && Array.isArray(reservation.holdings) && reservation.holdings.length === sources.length, "Complete Holding proofs are required");
      for (const [sourceIndex, source] of sources.entries()) {
        const holdingAddress = await deriveControlledHoldingAddress(evidence.programId, derived.instrumentAddress, source.address);
        equal(reservation.holdingAddresses[sourceIndex], holdingAddress, "Holding PDA");
        assert.deepEqual(reservation.holdings[sourceIndex], { address: holdingAddress, tokenAccount: source.address, walletAddress: source.wallet, reservedTokens: "0" }, "Consumed Holding identity/counter differs");
      }
      const operation = object(reservations.get(row.entitlementId), "Matching unit reservation operation");
      for (const [field, expected] of Object.entries({ investorId: row.investorId, unitReservationAddress: expectedReservation, tokensToRedeem: row.tokensRedeemed })) equal(operation[field], expected, `Unit reservation operation ${field}`);
      assert.deepEqual(operation.allocations, assigned, "Reserved/consumed allocations differ"); assert.deepEqual(operation.holdingAddresses, reservation.holdingAddresses, "Reserved/consumed Holding addresses differ");
    }
    equal(coveredSources.size, captured.size, "Complete immutable raw source coverage");
    // The existing fixed legacy verifier checks the shared financial, PDA and allocation contract.
    // Only the internal schema wrapper/hash changes; original controlled hashes remain the reported evidence.
    const normalized = structuredClone(receipt); normalized.schemaVersion = index === 0 ? "coupon-action-receipt-v1" : index === 2 ? "redemption-action-receipt-v2" : "redemption-action-receipt-v1";
    common.actions[index].canonicalJson = JSON.stringify(normalized); common.actions[index].receiptHash = sha256(common.actions[index].canonicalJson);
  }
  const checked = await verifyKaseDemoEvidence(common);
  if (evidence.postBurnClosureRecovery !== undefined) {
    const closure = object(evidence.postBurnClosureRecovery, "postBurnClosureRecovery");
    signature(closure.closureSignature, "Post-burn closure signature", allSignatures);
    assert.match(closure.operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const maturity = JSON.parse(evidence.actions[3].canonicalJson);
    const payment = maturity.entitlements.find(row => row.settlement.signature === closure.paymentSignature);
    assert.ok(payment, "Post-burn closure payment is absent from maturity receipt");
    const source = payment.settlement.tokenAccounts.find(source => source.address === closure.sourceAddress);
    assert.ok(source && source.walletAddress === closure.walletAddress && source.expectedBalanceAfter === "0", "Post-burn closure source must match an emptied maturity burn account");
    equal(closure.confirmedOriginalSignature, closure.paymentSignature, "Post-burn original confirmation signature");
    equal(closure.getRecoveryVerified, true, "Post-burn GET recovery runtime assertion");
    equal(closure.sourceAbsentAfterConfirm, true, "Post-burn closed source runtime assertion");
  }
  return { schema: evidence.schema, completedAt: evidence.completedAt, tokenPolicy: POLICY, programSha256: evidence.programSha256, idlSha256: evidence.idlSha256,
    actions: checked.actions.map((action, index) => ({ ...action, receiptHash: evidence.actions[index].receiptHash })),
    verification: "OFFLINE_EVIDENCE_CONSISTENCY_ONLY", reQueriedChain: false, authenticatedRuntime: false,
    ...(evidence.postBurnClosureRecovery ? { postBurnClosureBoundToMaturityReceipt: true } : {}),
    limitations: ["Saved artifact/source hashes are checked for structure, not compared with disk or authenticated against a trusted signer.",
      "This verifier covers the fixed four-action fixture with positive per-source burns; zero-assignment/closed-source acceptance uses separate controlled-registry evidence.",
      "It does not establish present chain/database state, HTTP authorization, immutability triggers or runtime assertions."] };
}

async function main() {
  assert.ok(process.argv.length === 3, "Usage: node scripts/verify-controlled-workflow-evidence.mjs <runtime.json>");
  const path = resolve(process.argv[2]); assert.ok((await stat(path)).size <= 4_000_000, "Evidence file exceeds 4 MB");
  let evidence; try { evidence = JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error instanceof SyntaxError) throw new Error("Evidence contains invalid JSON"); throw error; }
  const result = await verifyControlledWorkflowEvidence(evidence);
  console.log("PASS offline controlled workflow consistency: four original receipt hashes, frozen raw captures, assigned-unit reservations and supply35 →35 →28 →20 →0.");
  console.log(JSON.stringify(result, null, 2));
  console.log("Saved evidence consistency only: no RPC/database re-query, current acceptance or authenticated provenance claim.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(`FAIL controlled workflow evidence: ${error.message}`); process.exitCode = 1;
});
