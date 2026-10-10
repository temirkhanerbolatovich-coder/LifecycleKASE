import assert from "node:assert/strict";
import { createHash, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";
import { syntheticEntitlementAction } from "./test-entitlements-flow.mjs";
import { associatedTokenAccount, decodePublicKey, deriveActionApprovalAddresses, encodePublicKey, fundingTreasuryIndex,
  SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, verifySignedPreparedTransaction } from "@lifecycle-kase/solana-client";

/** Real HTTP and isolated PostgreSQL. RPC wire/account/history evidence is synthetic, not payment proof. */
export async function testActionApprovalFlow({ database, instrument, administrator, approver, auditor, otherRole,
  actionId, view, action, accounts, transactions, rpc: calculationRpc, addresses, request, write }) {
  const saved = Object.fromEntries(["ACTION_APPROVAL_RESERVE_ENABLED", "ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED", "SOLANA_RPC_URL"].map(key => [key, process.env[key]]));
  const mint = encodePublicKey(randomBytes(32)); const uuid = value => Buffer.from(value.replaceAll("-", ""), "hex");
  await database.settlementAsset.update({ where: { id: instrument.settlementAssetId }, data: { mintAddress: mint } });
  const treasury = await associatedTokenAccount(administrator.walletAddress, mint);
  const pdas = await deriveActionApprovalAddresses(instrument.programId, uuid(instrument.id), uuid(actionId));
  const discriminator = name => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
  const keyInto = (buffer, offset, address) => Buffer.from(decodePublicKey(address)).copy(buffer, offset);
  const instrumentData = Buffer.alloc(227); discriminator("Instrument").copy(instrumentData); instrumentData[8] = 1; uuid(instrument.id).copy(instrumentData, 9);
  [administrator.walletAddress, instrument.complianceAuthority, instrument.corporateActionAuthority, instrument.mintAddress, mint].forEach((key, index) => keyInto(instrumentData, 25 + index * 32, key));
  instrumentData.writeBigUInt64LE(instrument.faceValueMinor, 185); instrumentData.writeUInt32LE(instrument.couponRateBps, 193); instrumentData[197] = instrument.paymentsPerYear;
  instrumentData.writeBigInt64LE(BigInt(instrument.issueAt.getTime() / 1000), 198); instrumentData.writeBigInt64LE(BigInt(instrument.maturityAt.getTime() / 1000), 206);
  instrumentData.writeBigUInt64LE(35n, 214); instrumentData[222] = 1; accounts.set(addresses.instrumentAddress, instrumentData);
  const tokenAccounts = new Map(); const mintData = Buffer.alloc(82); mintData.writeUInt32LE(1); keyInto(mintData, 4, administrator.walletAddress);
  mintData[44] = 6; mintData[45] = 1;
  function tokenData(owner, amount) { const data = Buffer.alloc(165); keyInto(data, 0, mint); keyInto(data, 32, owner); data.writeBigUInt64LE(amount, 64); data[108] = 1; return data; }
  tokenAccounts.set(mint, mintData); tokenAccounts.set(treasury, tokenData(administrator.walletAddress, 0n));
  let payerLamports = 1_000_000_000; let height = 100; let lastValid = 500; let broadcasts = 0;
  let plan; let expectedSigner; let rejectBroadcast = false; let wrongGenesis = false;
  const rpc = { request: async (method, params) => {
    if (method === "getGenesisHash" && wrongGenesis) return encodePublicKey(randomBytes(32));
    if (method === "getLatestBlockhash") return { value: { blockhash: encodePublicKey(randomBytes(32)), lastValidBlockHeight: lastValid } };
    if (method === "getBlockHeight") return height;
    if (method === "getFeeForMessage") return { value: 5000 };
    if (method === "getMinimumBalanceForRentExemption") return params[0] * 10_000;
    if (method === "getSignatureStatuses") return { value: [null] };
    if (method === "isBlockhashValid") return { value: height <= lastValid };
    if (method === "getAccountInfo" && [administrator.walletAddress, approver.walletAddress].includes(params[0])) {
      return { context: { slot: 1000 }, value: { owner: SYSTEM_PROGRAM_ID, executable: false, lamports: payerLamports, data: ["", "base64"] } };
    }
    if (method === "getAccountInfo" && tokenAccounts.has(params[0])) return { context: { slot: 1000 }, value: {
      owner: TOKEN_2022_PROGRAM_ID, executable: false, data: [tokenAccounts.get(params[0]).toString("base64"), "base64"] } };
    if (method === "sendTransaction") {
      broadcasts++;
      const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: plan.serializedTransactionBase64,
        signedTransactionBase64: params[0], requiredSigner: expectedSigner.walletAddress });
      if (rejectBroadcast) throw new Error("Synthetic broadcast response lost");
      return signature;
    }
    return calculationRpc.request(method, params);
  } };
  const server = createServer(async (req, res) => {
    let input = ""; for await (const chunk of req) input += chunk;
    const message = JSON.parse(input); res.setHeader("content-type", "application/json");
    try { res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: await rpc.request(message.method, message.params) })); }
    catch { res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Synthetic RPC failure" } })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const path = `/corporate-actions/${actionId}/approval`;
  process.env.ACTION_APPROVAL_RESERVE_ENABLED = "true"; process.env.ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED = "true";
  process.env.SOLANA_RPC_URL = `http://127.0.0.1:${server.address().port}`;
  const phaseBody = phase => ({ phase, version: view.actionVersion, ...(phase === "ASSIGN_APPROVER" ? { approver: approver.walletAddress } : {}), ...(phase === "APPROVE" ? { note: "Separate approver verified entire coupon" } : {}) });
  const prepare = (phase, signer = administrator, override = {}) => request(path + "/prepare", { ...write({ ...phaseBody(phase), ...override }), cookie: signer.cookie });
  const read = async () => { const response = await request(path, { cookie: auditor.cookie }); assert.equal(response.status, 200, JSON.stringify(response.payload)); return response.payload; };
  async function auditFailure(enabled) {
    if (enabled) {
      await database.$executeRawUnsafe(`CREATE FUNCTION test_approval_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('ACTION_APPROVAL_PREPARED', 'ACTION_APPROVAL_FINALIZED') THEN RAISE EXCEPTION 'synthetic approval audit failure'; END IF; RETURN NEW; END $$`);
      await database.$executeRawUnsafe(`CREATE TRIGGER test_approval_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_approval_audit_failure()`);
    } else {
      await database.$executeRawUnsafe(`DROP TRIGGER test_approval_audit_failure ON audit_logs`);
      await database.$executeRawUnsafe(`DROP FUNCTION test_approval_audit_failure()`);
    }
  }
  async function complete(phase, signer = administrator, { unknown = false, rollback = false } = {}) {
    const response = await prepare(phase, signer); assert.equal(response.status, 201, JSON.stringify(response.payload)); plan = response.payload; expectedSigner = signer;
    const wire = Buffer.from(plan.serializedTransactionBase64, "base64"); sign(null, wire.subarray(65), signer.privateKey).copy(wire, 1);
    const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: plan.serializedTransactionBase64, signedTransactionBase64: wire.toString("base64"), requiredSigner: signer.walletAddress });
    const submit = () => request(path + "/submit", { ...write({ operationId: plan.operationId, signedTransactionBase64: wire.toString("base64") }), cookie: signer.cookie });
    const confirm = () => request(path + "/confirm", { ...write({ operationId: plan.operationId, signature }), cookie: signer.cookie });
    if (["ASSIGN_APPROVER", "APPROVE"].includes(phase)) {
      await database.wallet.update({ where: { address: approver.walletAddress }, data: { revokedAt: new Date() } });
      const before = broadcasts;
      assert.equal((await submit()).payload.code, "APPROVER_NOT_AUTHORIZED");
      assert.equal(broadcasts, before);
      assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } })).signature, null);
      await database.wallet.update({ where: { address: approver.walletAddress }, data: { revokedAt: null } });
    }
    rejectBroadcast = unknown; const submitted = await submit(); rejectBroadcast = false;
    assert.equal(submitted.status, unknown ? 503 : 201, JSON.stringify(submitted.payload));
    if (unknown) {
      assert.equal((await confirm()).status, 409);
      const resumed = await prepare(phase, signer); assert.equal(resumed.payload.operationId, plan.operationId); assert.equal(resumed.payload.signature, signature);
      const before = broadcasts; assert.equal((await submit()).status, 409); assert.equal(broadcasts, before);
    }
    const meta = { err: null, preTokenBalances: [], postTokenBalances: [] };
    const balance = (address, owner, amount) => ({ accountIndex: fundingTreasuryIndex(plan.serializedTransactionBase64, address), owner, mint,
      programId: TOKEN_2022_PROGRAM_ID, uiTokenAmount: { decimals: 6, amount: amount.toString() } });
    if (phase === "ASSIGN_APPROVER") {
      const data = Buffer.alloc(82); discriminator("ApprovalPolicy").copy(data); data[8] = 1; keyInto(data, 9, addresses.instrumentAddress);
      keyInto(data, 41, approver.walletAddress); data.writeBigUInt64LE(BigInt(plan.networkReserveLamports), 73); data[81] = 254; accounts.set(pdas.approvalPolicyAddress, data);
    } else if (phase === "RESERVE") {
      const amount = BigInt(view.totalEntitlementMinor); const before = tokenAccounts.get(treasury).readBigUInt64LE(64);
      const data = Buffer.alloc(187); discriminator("ActionReserve").copy(data); data[8] = 1; keyInto(data, 9, addresses.actionAddress); keyInto(data, 41, administrator.walletAddress);
      keyInto(data, 73, mint); Buffer.from(action.snapshot.snapshotHash).copy(data, 105); data.writeBigUInt64LE(amount, 137); data[178] = 254; accounts.set(pdas.reserveAddress, data);
      tokenAccounts.set(pdas.vaultAddress, tokenData(pdas.reserveAddress, amount)); tokenAccounts.get(treasury).writeBigUInt64LE(before - amount, 64); accounts.get(addresses.actionAddress)[148] = 6;
      meta.preTokenBalances = [balance(treasury, administrator.walletAddress, before)];
      meta.postTokenBalances = [balance(treasury, administrator.walletAddress, before - amount), balance(pdas.vaultAddress, pdas.reserveAddress, amount)];
    } else if (phase === "RELEASE") {
      const amount = tokenAccounts.get(pdas.vaultAddress).readBigUInt64LE(64); const before = tokenAccounts.get(treasury).readBigUInt64LE(64);
      accounts.delete(pdas.reserveAddress); tokenAccounts.delete(pdas.vaultAddress); tokenAccounts.get(treasury).writeBigUInt64LE(before + amount, 64); accounts.get(addresses.actionAddress)[148] = 4;
      meta.preTokenBalances = [balance(treasury, administrator.walletAddress, before), balance(pdas.vaultAddress, pdas.reserveAddress, amount)];
      meta.postTokenBalances = [balance(treasury, administrator.walletAddress, before + amount)];
    } else {
      const reserve = accounts.get(pdas.reserveAddress); keyInto(reserve, 145, approver.walletAddress); reserve[177] = 1; reserve.writeBigInt64LE(1_700_000_000n, 178); reserve[186] = 254;
      accounts.get(addresses.actionAddress)[148] = 5;
    }
    transactions.set(signature, { slot: 115, meta, transaction: [wire.toString("base64"), "base64"] });
    if (phase === "RESERVE") {
      meta.postTokenBalances[1].uiTokenAmount.amount = "1";
      assert.equal((await confirm()).payload.code, "RESERVE_BALANCE_PROOF"); meta.postTokenBalances[1].uiTokenAmount.amount = view.totalEntitlementMinor;
    }
    if (rollback) {
      const before = await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } });
      await auditFailure(true); assert.equal((await confirm()).status, 500); await auditFailure(false);
      const after = await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } }); assert.deepEqual(after, before);
      assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId, status: "READY" } }), 0);
      assert.notEqual((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } })).status, "FINALIZED");
    }
    assert.equal((await confirm()).status, 201);
    const auditCount = await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } });
    assert.equal((await confirm()).status, 201); assert.equal(await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } }), auditCount);
    return plan;
  }
  try {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { cookie: otherRole.cookie })).status, 403);
    assert.equal((await request(path + "/prepare", { ...write(phaseBody("ASSIGN_APPROVER")), requestOrigin: "https://untrusted.example" })).status, 403);
    assert.equal((await prepare("ASSIGN_APPROVER", auditor)).status, 403);
    assert.equal((await prepare("ASSIGN_APPROVER", administrator, { approver: administrator.walletAddress })).payload.code, "INVALID_APPROVER");
    assert.equal((await prepare("ASSIGN_APPROVER", administrator, { approver: auditor.walletAddress })).payload.code, "APPROVER_NOT_AUTHORIZED");
    wrongGenesis = true; assert.equal((await prepare("ASSIGN_APPROVER")).payload.code, "WRONG_SOLANA_NETWORK"); wrongGenesis = false;
    payerLamports = 10; assert.equal((await prepare("ASSIGN_APPROVER")).payload.code, "NETWORK_BUDGET_REQUIRED"); payerLamports = 1_000_000_000;
    await auditFailure(true); assert.equal((await prepare("ASSIGN_APPROVER")).status, 500); await auditFailure(false);
    assert.equal(await database.blockchainTransaction.count({ where: { corporateActionId: actionId, operationType: "ACTION_APPROVER_ASSIGN" } }), 0);
    const stale = await prepare("ASSIGN_APPROVER"); assert.equal(stale.status, 201); height = 501; lastValid = 1000;
    // Refreshing only an unsigned expired attempt is allowed; signed uncertainty is tested below.
    await complete("ASSIGN_APPROVER", administrator, { unknown: true, rollback: true });
    assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: stale.payload.operationId } })).lastErrorCode, "BLOCKHASH_EXPIRED");
    const assigned = await read(); assert.equal(assigned.approver, approver.walletAddress);
    const legacy = `/corporate-actions/${actionId}/entitlements/review`;
    process.env.ACTION_APPROVAL_RESERVE_ENABLED = "false";
    assert.equal((await request(legacy, write({ version: view.actionVersion, decision: "APPROVE", note: "Cannot bypass persisted policy" }))).payload.code, "ONCHAIN_REVIEW_REQUIRED");
    const secondId = await syntheticEntitlementAction(database, instrument, administrator);
    const secondPath = `/corporate-actions/${secondId}/entitlements`;
    const secondView = (await request(secondPath, { cookie: auditor.cookie })).payload;
    const secondReceivers = Object.fromEntries(secondView.investors.map(row => [row.investorId, row.receiverWallets[0]]));
    const secondCalculated = await request(secondPath + "/calculate", write({ version: secondView.actionVersion, receivers: secondReceivers }));
    assert.equal(secondCalculated.status, 201, JSON.stringify(secondCalculated.payload));
    const secondSubmitted = await request(secondPath + "/review", write({ version: secondCalculated.payload.actionVersion, decision: "SUBMIT", note: "Second action can still calculate/submit" }));
    assert.equal(secondSubmitted.status, 201, JSON.stringify(secondSubmitted.payload));
    assert.equal((await request(secondPath + "/review", write({ version: secondSubmitted.payload.actionVersion, decision: "APPROVE", note: "Instrument policy cannot be bypassed" }))).payload.code, "ONCHAIN_REVIEW_REQUIRED");
    process.env.ACTION_APPROVAL_RESERVE_ENABLED = "true";
    assert.equal((await prepare("RESERVE")).payload.code, "ACTION_RESERVE_NOT_READY");
    tokenAccounts.get(treasury).writeBigUInt64LE(BigInt(view.totalEntitlementMinor), 64);
    assert.equal((await prepare("RESERVE", approver)).payload.code, "WALLET_MISMATCH");
    await complete("RESERVE", administrator, { rollback: true });
    assert.equal((await read()).chainStatus, "RESERVED");
    assert.equal((await prepare("APPROVE")).payload.code, "WALLET_MISMATCH");
    const investorId = view.items[0].investorId;
    const holder = await database.investor.findUniqueOrThrow({ where: { id: investorId } });
    await database.investor.update({ where: { id: investorId }, data: { status: "SUSPENDED" } });
    assert.equal((await prepare("APPROVE", approver)).payload.code, "ELIGIBILITY_BLOCKED");
    assert.equal((await read()).reserveExists, true);
    await database.wallet.update({ where: { address: approver.walletAddress }, data: { revokedAt: new Date() } });
    mintData.writeUInt32LE(0); // Revoking mint authority cannot trap existing custody or block its refund.
    await database.instrument.update({ where: { id: instrument.id }, data: { status: "PAUSED" } }); instrumentData[222] = 2;
    // Revocation cannot prevent issuer from returning a reserve that was never approved.
    await complete("RELEASE"); await database.wallet.update({ where: { address: approver.walletAddress }, data: { revokedAt: null } });
    await database.investor.update({ where: { id: investorId }, data: { status: holder.status } });
    assert.equal((await prepare("RESERVE")).payload.code, "ELIGIBILITY_BLOCKED");
    await database.instrument.update({ where: { id: instrument.id }, data: { status: "ACTIVE" } }); instrumentData[222] = 1;
    await complete("RESERVE");
    const races = await Promise.all([prepare("APPROVE", approver), prepare("APPROVE", approver)]);
    assert.ok(races.some(row => row.status === 201), JSON.stringify(races)); assert.ok(races.every(row => [201, 409].includes(row.status)));
    assert.equal(await database.blockchainTransaction.count({ where: { corporateActionId: actionId, operationType: "ACTION_APPROVAL", status: "PREPARED" } }), 1);
    const approvalPlan = races.find(row => row.status === 201).payload;
    assert.equal(BigInt(approvalPlan.recipientRentLamports), 5_100_000n); assert.equal(approvalPlan.estimatedExecutionFeeLamports, "15000");
    assert.equal((await prepare("RELEASE")).payload.code, "ACTION_OPERATION_PENDING");
    await complete("APPROVE", approver, { unknown: true, rollback: true });
    const projected = await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } });
    assert.equal(projected.status, "APPROVED"); assert.equal(projected.approvedById, approver.userId); assert.equal(projected.version, view.actionVersion + 1);
    assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId, status: "READY" } }), 3);
    assert.equal((await read()).approved, true);
    assert.equal((await prepare("RELEASE")).payload.code, "ACTION_CONFLICT");
    console.log("PASS HTTP/PostgreSQL approval: roles/Origin, distinct verified approver, exact reserve token proof, SOL/rent budget, unsigned expiry, signed uncertainty/no resend, concurrency, refund after approver revocation and atomic approval/audit recovery (synthetic RPC)");
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
