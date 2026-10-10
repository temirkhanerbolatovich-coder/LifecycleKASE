import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID, sign } from "node:crypto";
import { decodePublicKey, deriveCorporateActionAddresses, encodePublicKey, verifySignedPreparedTransaction } from "@lifecycle-kase/solana-client";
import { prepareOnchainCalculation, submitOnchainCalculation, confirmOnchainCalculation } from "../apps/api/dist/onchain-entitlements.js";
import { syntheticEntitlementAction } from "./test-entitlements-flow.mjs";

/** Real PostgreSQL regression inside the generated action-test DB; RPC evidence is synthetic. */
export async function testOnchainEntitlementsFlow({ database, instrument, administrator, request, write }) {
  const actionId = await syntheticEntitlementAction(database, instrument, administrator);
  const path = `/corporate-actions/${actionId}/entitlements`;
  const initial = (await request(path, { cookie: administrator.cookie })).payload;
  const calculated = await request(path + "/calculate", write({ version: initial.actionVersion,
    receivers: Object.fromEntries(initial.investors.map(row => [row.investorId, row.receiverWallets[0]])) }));
  assert.equal(calculated.status, 201, JSON.stringify(calculated.payload));
  const submitted = await request(path + "/review", write({ version: calculated.payload.actionVersion,
    decision: "SUBMIT", note: "Synthetic on-chain persistence regression" }));
  assert.equal(submitted.status, 201, JSON.stringify(submitted.payload));
  const view = submitted.payload;
  const action = await database.corporateAction.findUniqueOrThrow({ where: { id: actionId }, include: { snapshot: true } });
  const actor = { id: administrator.userId, walletAddress: administrator.walletAddress, correlationId: randomUUID() };
  const options = { enabled: true, cluster: "localnet", programId: instrument.programId,
    expectedGenesisHash: process.env.SOLANA_GENESIS_HASH, rpcEndpoint: "http://127.0.0.1:1", rpcTimeoutMs: 1000 };
  const uuid = value => Buffer.from(value.replaceAll("-", ""), "hex");
  const addresses = await deriveCorporateActionAddresses(instrument.programId, uuid(instrument.id), uuid(actionId));
  const chainAction = Buffer.alloc(190);
  createHash("sha256").update("account:CorporateAction").digest().copy(chainAction, 0, 0, 8);
  chainAction[8] = 1; uuid(actionId).copy(chainAction, 9);
  Buffer.from(decodePublicKey(addresses.instrumentAddress)).copy(chainAction, 25);
  chainAction.writeBigInt64LE(BigInt(action.recordAt.getTime() / 1000), 58);
  chainAction.writeBigInt64LE(BigInt(action.executeAt.getTime() / 1000), 66);
  Buffer.from(action.snapshot.snapshotHash).copy(chainAction, 76);
  chainAction.writeBigUInt64LE(action.snapshot.solanaSlot, 108);
  chainAction.writeUInt32LE(action.snapshot.investorCount, 116);
  chainAction.writeUInt32LE(action.snapshot.walletCount, 120);
  chainAction.writeBigUInt64LE(action.snapshot.totalBalance, 124);
  chainAction[148] = 2; chainAction[158] = 254;
  const accounts = new Map([[addresses.actionAddress, chainAction]]);
  const transactions = new Map(); let slot = 110; let currentPlan;
  const rpc = { request: async (method, params) => {
    if (method === "getGenesisHash") return options.expectedGenesisHash;
    if (method === "getLatestBlockhash") return { value: { blockhash: encodePublicKey(randomBytes(32)), lastValidBlockHeight: 9999 } };
    if (method === "getAccountInfo") {
      const bytes = accounts.get(params[0]);
      return { context: { slot }, value: bytes ? { owner: instrument.programId, executable: false, data: [bytes.toString("base64"), "base64"] } : null };
    }
    if (method === "getTransaction") return transactions.get(params[0]) ?? null;
    if (method === "sendTransaction") return verifySignedPreparedTransaction({
      expectedUnsignedTransactionBase64: currentPlan.serializedTransactionBase64,
      signedTransactionBase64: params[0], requiredSigner: administrator.walletAddress });
    throw new Error(`Unexpected synthetic RPC method ${method}`);
  } };
  async function failAudit(enabled) {
    if (enabled) {
      await database.$executeRawUnsafe(`CREATE FUNCTION test_onchain_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('ENTITLEMENT_ONCHAIN_PREPARED', 'ENTITLEMENT_ONCHAIN_FINALIZED', 'CALCULATION_ONCHAIN_RESET_PREPARED', 'CALCULATION_ONCHAIN_RESET', 'CALCULATION_ONCHAIN_FINALIZATION_PREPARED', 'CALCULATION_ONCHAIN_UNDER_REVIEW') THEN RAISE EXCEPTION 'synthetic on-chain audit failure'; END IF; RETURN NEW; END $$`);
      await database.$executeRawUnsafe(`CREATE TRIGGER test_onchain_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_onchain_audit_failure()`);
    } else {
      await database.$executeRawUnsafe(`DROP TRIGGER test_onchain_audit_failure ON audit_logs`);
      await database.$executeRawUnsafe(`DROP FUNCTION test_onchain_audit_failure()`);
    }
  }
  const prepare = (phase, entitlementId) => prepareOnchainCalculation(database, rpc, actionId,
    { phase, version: view.actionVersion, ...(entitlementId ? { entitlementId } : {}) }, actor, options);
  const register = view.items[0];
  await failAudit(true);
  await assert.rejects(prepare("REGISTER", register.id));
  assert.equal(await database.blockchainTransaction.count({ where: { corporateActionId: actionId, operationType: "ENTITLEMENT_REGISTER" } }), 0);
  await failAudit(false);

  async function complete(phase, entitlement, checkRollback = false) {
    const plan = await prepare(phase, entitlement?.id);
    const preparedAudit = await database.auditLog.findFirstOrThrow({ where: { blockchainTransactionId: plan.operationId } });
    assert.equal(preparedAudit.actorId, actor.id); assert.equal(preparedAudit.entityId, entitlement?.id ?? actionId);
    assert.equal(preparedAudit.corporateActionId, actionId);
    if (phase === "REGISTER") assert.equal(preparedAudit.metadataJson.entitlementId, entitlement.id);
    const wire = Buffer.from(plan.serializedTransactionBase64, "base64");
    assert.equal(wire[0], 1);
    const signatureBytes = sign(null, wire.subarray(65), administrator.privateKey);
    signatureBytes.copy(wire, 1); currentPlan = plan;
    const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: plan.serializedTransactionBase64,
      signedTransactionBase64: wire.toString("base64"), requiredSigner: administrator.walletAddress });
    const submittedOperation = await submitOnchainCalculation(database, rpc, actionId,
      { phase, operationId: plan.operationId, signedTransactionBase64: wire.toString("base64") }, actor, options);
    assert.equal(submittedOperation.signature, signature);
    slot++;
    transactions.set(signature, { slot, meta: { err: null }, transaction: [wire.toString("base64"), "base64"] });
    if (phase === "REGISTER") {
      const bytes = Buffer.alloc(155);
      createHash("sha256").update("account:Entitlement").digest().copy(bytes, 0, 0, 8); bytes[8] = 1;
      Buffer.from(decodePublicKey(addresses.actionAddress)).copy(bytes, 9); uuid(entitlement.investorId).copy(bytes, 41);
      Buffer.from(action.snapshot.snapshotHash).copy(bytes, 57);
      Buffer.from(decodePublicKey(entitlement.settlementWalletAddress)).copy(bytes, 89);
      bytes.writeBigUInt64LE(BigInt(entitlement.balanceAtRecordDate), 121);
      bytes.writeBigUInt64LE(BigInt(entitlement.amountMinor), 129);
      bytes.writeBigUInt64LE(BigInt(entitlement.tokensToRedeem), 137); bytes[147] = 254;
      accounts.set(plan.entitlementAddress, bytes);
      chainAction.writeBigUInt64LE(chainAction.readBigUInt64LE(132) + BigInt(entitlement.amountMinor), 132);
      chainAction.writeUInt32LE(chainAction.readUInt32LE(140) + 1, 140); chainAction[148] = 3;
    } else if (phase === "RESET") {
      for (const address of plan.entitlementAddresses) accounts.delete(address);
      chainAction.writeBigUInt64LE(0n, 132); chainAction.writeUInt32LE(0, 140); chainAction[148] = 2;
    } else chainAction[148] = 4;
    const confirm = () => confirmOnchainCalculation(database, rpc, actionId,
      { phase, operationId: plan.operationId, signature }, actor, options);
    if (checkRollback) {
      const before = await database.entitlement.findMany({ where: { corporateActionId: actionId }, orderBy: { id: "asc" }, select: { id: true, version: true, onchainPda: true } });
      await failAudit(true); await assert.rejects(confirm()); await failAudit(false);
      assert.deepEqual(await database.entitlement.findMany({ where: { corporateActionId: actionId }, orderBy: { id: "asc" }, select: { id: true, version: true, onchainPda: true } }), before);
      assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } })).status, "SUBMITTED");
    }
    assert.equal((await confirm()).status, "FINALIZED");
    const auditCount = await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } });
    assert.equal(auditCount, 3);
    assert.equal((await confirm()).status, "FINALIZED");
    assert.equal(await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } }), auditCount);
    return plan;
  }
  const first = await complete("REGISTER", register, true);
  assert.equal((await database.entitlement.findUniqueOrThrow({ where: { id: register.id } })).onchainPda, first.entitlementAddress);
  await complete("RESET", undefined, true);
  assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId, onchainPda: { not: null } } }), 0);
  assert.equal(accounts.has(first.entitlementAddress), false);
  for (const row of view.items) await complete("REGISTER", row);
  await complete("FINALIZE", undefined, true);
  assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId, onchainPda: { not: null } } }), 3);
  assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } })).status, "UNDER_REVIEW");
  assert.deepEqual(Buffer.from((await database.snapshot.findUniqueOrThrow({ where: { corporateActionId: actionId } })).snapshotHash), Buffer.from(action.snapshot.snapshotHash));
  console.log("PASS PostgreSQL on-chain REGISTER/RESET/re-register/FINALIZE audit, rollback and same-signature recovery (synthetic RPC)");
  return { actionId, view, action, accounts, transactions, rpc, addresses };
}
