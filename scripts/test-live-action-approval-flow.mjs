import assert from "node:assert/strict";
import { sign } from "node:crypto";
import { verifySignedPreparedTransaction } from "@lifecycle-kase/solana-client";
import { testCouponFundingFlow } from "./test-coupon-funding-flow.mjs";
import { testLiveCouponExecution } from "./test-live-coupon-execution.mjs";

/** Called only from the disposable validator + generated database acceptance branch. */
export async function testLiveActionApprovalFlow({ database, request, write, administrator, approver, auditor, actionId, rpc, signAndSubmit, confirm }) {
  const entitlementPath = `/corporate-actions/${actionId}/entitlements`;
  const initial = (await request(entitlementPath, { cookie: auditor.cookie })).payload;
  const calculated = await request(entitlementPath + "/calculate", write({ version: initial.actionVersion,
    receivers: Object.fromEntries(initial.investors.map(row => [row.investorId, row.receiverWallets[0]])) }));
  assert.equal(calculated.status, 201, JSON.stringify(calculated.payload));
  const submitted = await request(entitlementPath + "/review", write({ version: calculated.payload.actionVersion, decision: "SUBMIT", note: "Live isolated approval acceptance" }));
  assert.equal(submitted.status, 201, JSON.stringify(submitted.payload));
  const version = submitted.payload.actionVersion;
  await testCouponFundingFlow({ database, request, write, administrator, auditor, outsider: approver, actionId, version, signAndSubmit, confirm });
  process.env.ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED = "true"; process.env.ACTION_APPROVAL_RESERVE_ENABLED = "true";
  const airdrop = await rpc.request("requestAirdrop", [approver.walletAddress, 1_000_000_000]);
  const airdropDeadline = Date.now() + 90_000;
  while (true) {
    const status = await rpc.request("getSignatureStatuses", [[airdrop], { searchTransactionHistory: true }]);
    if (status.value[0]?.confirmationStatus === "finalized") { assert.equal(status.value[0].err, null); break; }
    if (Date.now() > airdropDeadline) throw new Error("Disposable approver airdrop did not finalize");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  async function complete(path, body, signer = administrator) {
    const preparation = await request(path + "/prepare", { ...write(body), cookie: signer.cookie });
    assert.equal(preparation.status, 201, JSON.stringify(preparation.payload)); const plan = preparation.payload;
    const wire = Buffer.from(plan.serializedTransactionBase64, "base64"); sign(null, wire.subarray(65), signer.privateKey).copy(wire, 1);
    const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: plan.serializedTransactionBase64,
      signedTransactionBase64: wire.toString("base64"), requiredSigner: signer.walletAddress });
    const result = await request(path + "/submit", { ...write({ operationId: plan.operationId, ...(path.includes("/onchain") ? { phase: body.phase } : {}), signedTransactionBase64: wire.toString("base64") }), cookie: signer.cookie });
    // Approval's API has a single prepared phase in its payload; a phase is only required by calculation endpoints.
    assert.equal(result.status, 201, JSON.stringify(result.payload)); assert.equal(result.payload.signature, signature);
    const deadline = Date.now() + 90_000;
    while (true) {
      const finalized = await request(path + "/confirm", { ...write({ operationId: plan.operationId, signature,
        ...(path.includes("/onchain") ? { phase: body.phase } : {}) }), cookie: signer.cookie });
      if (finalized.status === 201) { assert.equal(finalized.payload.status, "FINALIZED"); break; }
      assert.ok(["TRANSACTION_NOT_FINALIZED", "TRANSACTION_UNAVAILABLE", "TRANSACTION_HISTORY_UNAVAILABLE"].includes(finalized.payload.code), JSON.stringify(finalized.payload));
      if (Date.now() > deadline) throw new Error("Live approval confirmation deadline reached");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const count = await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } });
    assert.equal((await request(path + "/confirm", { ...write({ operationId: plan.operationId, signature,
      ...(path.includes("/onchain") ? { phase: body.phase } : {}) }), cookie: signer.cookie })).status, 201);
    assert.equal(await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } }), count);
    return { plan, signature };
  }
  const calculationPath = entitlementPath + "/onchain";
  for (const row of submitted.payload.items) await complete(calculationPath, { phase: "REGISTER", version, entitlementId: row.id });
  await complete(calculationPath, { phase: "FINALIZE", version });
  const approvalPath = `/corporate-actions/${actionId}/approval`;
  const phase = async (value, signer = administrator) => {
    const body = { phase: value, version, ...(value === "ASSIGN_APPROVER" ? { approver: approver.walletAddress } : {}), ...(value === "APPROVE" ? { note: "Real validator separate-approver acceptance" } : {}) };
    // The approval submit contract takes operationId and exact wire; phase is already persisted.
    return complete(approvalPath, body, signer);
  };
  const policy = await phase("ASSIGN_APPROVER");
  const firstReserve = await phase("RESERVE"); await phase("RELEASE"); const reserve = await phase("RESERVE");
  const approval = await phase("APPROVE", approver);
  const state = await request(approvalPath, { cookie: auditor.cookie }); assert.equal(state.status, 200, JSON.stringify(state.payload));
  assert.equal(state.payload.chainStatus, "APPROVED"); assert.equal(state.payload.approved, true); assert.equal(state.payload.reservedMinor, "1750000000"); assert.equal(state.payload.treasuryBalanceMinor, "0");
  assert.equal(state.payload.approver, approver.walletAddress); assert.equal(state.payload.executionAvailable, false);
  const projected = await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } });
  assert.equal(projected.status, "APPROVED"); assert.equal(projected.approvedById, approver.userId); assert.equal(projected.version, version + 1);
  assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId, status: "READY", settlementSignature: null, burnSignature: null } }), 3);
  assert.equal(await database.auditLog.count({ where: { corporateActionId: actionId, event: "ACTION_APPROVAL_FINALIZED" } }), 5);
  console.log("PASS live Localnet approval through HTTP/PostgreSQL: finalized registrations/FINALIZE, immutable separate approver, real 1750 reserve/refund/refill token history, SOL/rent budget, APPROVED/READY/audit and idempotent confirmation; no investor payment/burn");
  console.log("Disposable action approval evidence", JSON.stringify({ actionId, genesisHash: process.env.SOLANA_GENESIS_HASH,
    issuer: administrator.walletAddress, approver: approver.walletAddress, policySignature: policy.signature, firstReserveSignature: firstReserve.signature,
    reserveSignature: reserve.signature, approvalSignature: approval.signature, reserveAddress: state.payload.reserveAddress, vaultAddress: state.payload.vaultAddress,
    reservedMinor: state.payload.reservedMinor, chainStatus: state.payload.chainStatus }));
  if (process.env.COUPON_ACCEPTANCE === "true") await testLiveCouponExecution({ database, request, write, administrator, auditor, outsider: approver, actionId, rpc });
}
