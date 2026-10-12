import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import { encodePublicKey } from "@lifecycle-kase/solana-client";
import { calculateEntitlements, requireCouponExecutionCalculation, reviewEntitlements } from "../apps/api/dist/entitlements.js";

/** HTTP/database acceptance inside the existing runner's generated database; no blockchain proof. */
export async function testRegistryGovernance({ database, request, administrator, auditor, publicAddress,
  revokedInvestorId, revokedWalletId }) {
  const post = (path, body, options = {}) => request(path, { cookie: administrator.cookie, method: "POST", body, ...options });
  const ok = response => { assert.equal(response.status, 201, JSON.stringify(response.payload)); return response.payload; };
  const denied = (response, code, status = 409) => {
    assert.equal(response.status, status, JSON.stringify(response.payload)); assert.equal(response.payload.code, code);
  };
  const investor = ok(await post("/investors", { displayName: "Synthetic Governed Investor", type: "INDIVIDUAL",
    countryCode: "KZ", externalReference: "REGISTRY-GOVERNANCE" }));
  assert.equal(investor.registryVersion, 1);
  const keys = generateKeyPairSync("ed25519");
  const walletAddress = encodePublicKey(keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
  const wallet = ok(await post(`/investors/${investor.id}/wallets`, { address: walletAddress }));
  assert.equal(wallet.registryVersion, 1);
  const verification = `/investors/${investor.id}/wallets/${wallet.id}/verification`;
  const challenge = ok(await post(`${verification}/challenge`, {}));
  const verified = ok(await post(`${verification}/verify`, { challengeId: challenge.challengeId, nonce: challenge.nonce,
    signature: sign(null, Buffer.from(challenge.message), keys.privateKey).toString("base64") }));
  assert.equal(verified.registryVersion, 2); assert.equal(verified.status, "ACTIVE");
  const initiallyEligible = ok(await post(`/investors/${investor.id}/eligibility`, { decision: "ELIGIBLE", reasonCode: "DEMO_CRITERIA_MET" }));
  assert.equal(initiallyEligible.registryVersion, 2);
  const eligibilityPath = `/investors/${investor.id}/eligibility/review`;
  const statusPath = `/investors/${investor.id}/wallets/${wallet.id}/status`;
  const review = { decision: "SUSPENDED", expectedVersion: 2, reasonCode: "PERIODIC_REVIEW" };
  const block = { status: "BLOCKED", expectedVersion: 2, reasonCode: "SECURITY_CONCERN" };
  for (const [path, body] of [[eligibilityPath, review], [statusPath, block]]) {
    assert.equal((await post(path, body, { cookie: undefined })).status, 401);
    assert.equal((await post(path, body, { cookie: auditor.cookie })).status, 403);
    assert.equal((await post(path, body, { requestOrigin: null })).status, 403);
    assert.equal((await post(path, body, { requestOrigin: "https://untrusted.example" })).status, 403);
    for (const changed of [{ expectedVersion: 0 }, { expectedVersion: 1.5 }, { reasonCode: "arbitrary text" }, { amount: "999" }]) {
      denied(await post(path, { ...body, ...changed }), "INVALID_REQUEST", 400);
    }
  }
  const pending = await database.investor.create({ data: { displayName: "Synthetic Pending Investor", type: "INDIVIDUAL", countryCode: "KZ" } });
  denied(await post(`/investors/${pending.id}/eligibility/review`, { ...review, expectedVersion: 1 }), "REGISTRY_TRANSITION_INVALID");
  const pendingWallet = await database.wallet.create({ data: { address: publicAddress(), investorId: pending.id, network: "SOLANA_LOCALNET" } });
  denied(await post(`/investors/${pending.id}/wallets/${pendingWallet.id}/status`, { ...block, expectedVersion: 1 }), "WALLET_STATUS_TRANSITION_INVALID");
  denied(await post(`/investors/${revokedInvestorId}/wallets/${revokedWalletId}/status`, {
    status: "ACTIVE", expectedVersion: (await database.wallet.findUniqueOrThrow({ where: { id: revokedWalletId } })).registryVersion,
    reasonCode: "OWNER_REQUEST" }), "WALLET_STATUS_TRANSITION_INVALID");
  assert.equal((await post(`/investors/${pending.id}/wallets/${wallet.id}/status`, block)).status, 404);
  const inactive = await database.investor.create({ data: { displayName: "Synthetic Inactive Investor", type: "INDIVIDUAL",
    countryCode: "KZ", status: "SUSPENDED", eligibilityStatus: "NOT_ELIGIBLE", eligibilityReasonCode: "DEMO_CRITERIA_NOT_MET",
    eligibilityReviewedAt: new Date() } });
  denied(await post(`/investors/${inactive.id}/eligibility/review`, { ...review, expectedVersion: 1 }), "INVESTOR_INACTIVE");
  denied(await post(`/investors/${inactive.id}/wallets/${pendingWallet.id}/status`, { ...block, expectedVersion: 1 }), "INVESTOR_INACTIVE");
  const noWallet = await database.investor.create({ data: { displayName: "Synthetic No Wallet Investor", type: "INDIVIDUAL",
    countryCode: "KZ", eligibilityStatus: "NOT_ELIGIBLE", eligibilityReasonCode: "DEMO_CRITERIA_NOT_MET", eligibilityReviewedAt: new Date() } });
  denied(await post(`/investors/${noWallet.id}/eligibility/review`, {
    decision: "ELIGIBLE", expectedVersion: 1, reasonCode: "REGISTRY_CORRECTION" }), "VERIFIED_WALLET_REQUIRED");
  console.log("PASS governed registry endpoints preserve role/Origin/input, pending/revoked and ownership boundaries");

  // Synthetic finalized snapshot/projection exercises actual database/API gates, not RPC/chain execution.
  const now = new Date(); const recordAt = new Date(now.getTime() - 1000); const instrumentId = randomUUID(); const actionId = randomUUID();
  const mintAddress = publicAddress(); const tokenAddress = publicAddress(); const genesis = publicAddress();
  const issuer = await database.issuer.create({ data: { legalName: `Governance fixture ${instrumentId}` } });
  const asset = await database.settlementAsset.findUniqueOrThrow({ where: { code: "KZT_TEST" } });
  await database.instrument.create({ data: { id: instrumentId, issuerId: issuer.id, settlementAssetId: asset.id,
    name: "Synthetic Governance Bond", ticker: "GOVERNANCE", network: "SOLANA_LOCALNET", status: "ACTIVE", mintAddress,
    issuerAuthority: administrator.walletAddress, complianceAuthority: administrator.walletAddress,
    corporateActionAuthority: administrator.walletAddress, faceValueMinor: 1_000_000_000n, couponRateBps: 1000,
    paymentsPerYear: 2, issueAt: new Date(now.getTime() - 86_400_000), maturityAt: new Date(now.getTime() + 86_400_000),
    totalSupply: 35n, circulatingSupply: 35n } });
  await database.corporateAction.create({ data: { id: actionId, instrumentId, type: "COUPON_PAYMENT", intent: "Synthetic governance gate regression",
    createdById: administrator.userId, recordAt, executeAt: new Date(now.getTime() + 3600_000), status: "SNAPSHOT_CREATED" } });
  const commitment = createSnapshotV2Commitment({ actionId, instrumentId, cluster: "localnet", networkGenesisHash: genesis,
    mintAddress, recordAt: recordAt.toISOString(), blockTime: now.toISOString(), createdAt: now.toISOString(), solanaSlot: 101n,
    mintSupply: 35n, investors: [{ investorId: investor.id, eligibilityStatus: "ELIGIBLE", wallets: [{ walletId: wallet.id,
      walletAddress, walletStatus: "ACTIVE", tokenAccounts: [{ address: tokenAddress, balance: 35n }] }] }] });
  const snapshot = await database.snapshot.create({ data: { instrumentId, corporateActionId: actionId, recordAt,
    networkGenesisHash: genesis, solanaSlot: 101n, blockTime: now, createdAt: now, canonicalJson: commitment.snapshot,
    snapshotHash: Buffer.from(commitment.sha256, "hex"), investorCount: 1, walletCount: 1, totalBalance: 35n, mintSupply: 35n,
    investors: { create: [{ investorId: investor.id, eligibilityStatus: "ELIGIBLE", balance: 35n,
      wallets: { create: [{ walletId: wallet.id, walletAddress, walletStatus: "ACTIVE", balance: 35n,
        tokenAccounts: { create: [{ address: tokenAddress, balance: 35n }] } }] } }] } } });
  await database.snapshot.update({ where: { id: snapshot.id }, data: { status: "FINALIZED" } });
  await database.blockchainTransaction.create({ data: { instrumentId, corporateActionId: actionId,
    operationType: "REGISTER_SNAPSHOT", signature: "3".repeat(64), status: "FINALIZED" } });
  const actor = { id: administrator.userId, walletAddress: administrator.walletAddress, correlationId: randomUUID() };
  await calculateEntitlements(database, actionId, { version: 0 }, actor);
  await reviewEntitlements(database, actionId, { version: 1, decision: "SUBMIT", note: "Synthetic API regression" }, actor);
  await reviewEntitlements(database, actionId, { version: 2, decision: "APPROVE", note: "Synthetic API regression" }, actor);
  const approved = await requireCouponExecutionCalculation(database, actionId);
  const entitlementId = approved.entitlements[0].id;
  await requireCouponExecutionCalculation(database, actionId, entitlementId);
  const beforeSnapshot = await database.snapshot.findUniqueOrThrow({ where: { id: snapshot.id },
    include: { investors: { include: { wallets: { include: { tokenAccounts: true } } } } } });

  const suspendedResponse = await post(eligibilityPath, review); const suspended = ok(suspendedResponse);
  assert.equal(suspended.eligibilityStatus, "SUSPENDED"); assert.equal(suspended.registryVersion, 3);
  const reviewAudit = await database.auditLog.findFirstOrThrow({ where: { entityId: investor.id, event: "INVESTOR_ELIGIBILITY_REVIEWED" } });
  assert.equal(reviewAudit.actorId, administrator.userId); assert.equal(reviewAudit.correlationId, suspendedResponse.headers.get("x-correlation-id"));
  assert.deepEqual(reviewAudit.metadataJson, { previousEligibilityStatus: "ELIGIBLE", eligibilityStatus: "SUSPENDED",
    previousVersion: 2, registryVersion: 3, reasonCode: "PERIODIC_REVIEW", source: "administrator-api" });
  await assert.rejects(requireCouponExecutionCalculation(database, actionId, entitlementId), { code: "ELIGIBILITY_BLOCKED" });
  denied(await post(eligibilityPath, { ...review, expectedVersion: 3 }), "REGISTRY_TRANSITION_INVALID");
  const restored = ok(await post(eligibilityPath, { decision: "ELIGIBLE", expectedVersion: 3, reasonCode: "REGISTRY_CORRECTION" }));
  assert.equal(restored.registryVersion, 4);
  await requireCouponExecutionCalculation(database, actionId, entitlementId);
  denied(await post(eligibilityPath, review), "REGISTRY_CONFLICT");
  const notEligible = ok(await post(eligibilityPath, { decision: "NOT_ELIGIBLE", expectedVersion: 4, reasonCode: "OWNER_REQUEST" }));
  await assert.rejects(requireCouponExecutionCalculation(database, actionId, entitlementId), { code: "ELIGIBILITY_BLOCKED" });
  let eligibleAgain = ok(await post(eligibilityPath, { decision: "ELIGIBLE", expectedVersion: notEligible.registryVersion, reasonCode: "REGISTRY_CORRECTION" }));
  await requireCouponExecutionCalculation(database, actionId, entitlementId);
  const reviewedTogether = await Promise.all([1, 2].map(() => post(eligibilityPath, { ...review, expectedVersion: eligibleAgain.registryVersion })));
  assert.deepEqual(reviewedTogether.map(row => row.status).sort(), [201, 409]);
  assert.equal(await database.auditLog.count({ where: { entityId: investor.id, event: "INVESTOR_ELIGIBILITY_REVIEWED" } }), 5);
  eligibleAgain = ok(await post(eligibilityPath, { decision: "ELIGIBLE", expectedVersion: eligibleAgain.registryVersion + 1,
    reasonCode: "REGISTRY_CORRECTION" }));
  await requireCouponExecutionCalculation(database, actionId, entitlementId);
  console.log("PASS eligibility review/reasons/audit and ABA versions block or restore only future selected-receiver execution");

  const blockedResponse = await post(statusPath, block); const blocked = ok(blockedResponse);
  assert.equal(blocked.status, "BLOCKED"); assert.equal(blocked.registryVersion, 3); assert.equal(blocked.verifiedAt, verified.verifiedAt);
  await assert.rejects(requireCouponExecutionCalculation(database, actionId, entitlementId), { code: "ELIGIBILITY_BLOCKED" });
  const walletAudit = await database.auditLog.findFirstOrThrow({ where: { entityId: wallet.id, event: "INVESTOR_WALLET_STATUS_CHANGED" } });
  assert.equal(walletAudit.actorId, administrator.userId); assert.equal(walletAudit.correlationId, blockedResponse.headers.get("x-correlation-id"));
  assert.deepEqual(walletAudit.metadataJson, { investorId: investor.id, previousStatus: "ACTIVE", status: "BLOCKED", previousVersion: 2,
    registryVersion: 3, reasonCode: "SECURITY_CONCERN", network: "SOLANA_LOCALNET" });
  denied(await post(statusPath, { ...block, expectedVersion: 3 }), "REGISTRY_TRANSITION_INVALID");
  const unblocked = ok(await post(statusPath, { status: "ACTIVE", expectedVersion: 3, reasonCode: "REGISTRY_CORRECTION" }));
  assert.equal(unblocked.registryVersion, 4); assert.equal(unblocked.verifiedAt, verified.verifiedAt); assert.equal(unblocked.revokedAt, null);
  await requireCouponExecutionCalculation(database, actionId, entitlementId);
  denied(await post(statusPath, block), "REGISTRY_CONFLICT");
  const raced = await Promise.all([1, 2].map(() => post(statusPath, { ...block, expectedVersion: 4 })));
  assert.deepEqual(raced.map(row => row.status).sort(), [201, 409]);
  assert.equal(await database.auditLog.count({ where: { entityId: wallet.id, event: "INVESTOR_WALLET_STATUS_CHANGED" } }), 3);
  ok(await post(statusPath, { status: "ACTIVE", expectedVersion: 5, reasonCode: "REGISTRY_CORRECTION" }));
  assert.deepEqual(await database.snapshot.findUniqueOrThrow({ where: { id: snapshot.id },
    include: { investors: { include: { wallets: { include: { tokenAccounts: true } } } } } }), beforeSnapshot);
  const unchangedEntitlement = await database.entitlement.findUniqueOrThrow({ where: { id: entitlementId } });
  assert.equal(unchangedEntitlement.status, "READY"); assert.equal(unchangedEntitlement.amountMinor, 1_750_000_000n);
  assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } })).status, "APPROVED");
  await assert.rejects(database.snapshot.update({ where: { id: snapshot.id }, data: { canonicalJson: {} } }),
    error => /finalized snapshot .* immutable/.test(error.message));
  console.log("PASS wallet block/unblock, OCC race and ABA retain ownership proof, committed snapshot and approved obligations");

  // Inject only the two new audit events in this generated database; a real HTTP failure must roll back state/version.
  await database.$executeRawUnsafe(`CREATE FUNCTION registry_governance_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event IN ('INVESTOR_ELIGIBILITY_REVIEWED', 'INVESTOR_WALLET_STATUS_CHANGED') THEN
      RAISE EXCEPTION 'synthetic registry governance audit failure'; END IF; RETURN NEW; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER registry_governance_test_audit_failure BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION registry_governance_test_audit_failure()`);
  try {
    for (const [path, body, readRow] of [
      [eligibilityPath, { ...review, expectedVersion: eligibleAgain.registryVersion }, () => database.investor.findUniqueOrThrow({ where: { id: investor.id } })],
      [statusPath, { ...block, expectedVersion: 6 }, () => database.wallet.findUniqueOrThrow({ where: { id: wallet.id } })]
    ]) {
      const before = await readRow(); const count = await database.auditLog.count();
      assert.equal((await post(path, body)).status, 500);
      assert.deepEqual(await readRow(), before); assert.equal(await database.auditLog.count(), count);
    }
  } finally {
    await database.$executeRawUnsafe("DROP TRIGGER registry_governance_test_audit_failure ON audit_logs");
    await database.$executeRawUnsafe("DROP FUNCTION registry_governance_test_audit_failure()");
  }
  const listed = await request("/investors?limit=100", { cookie: auditor.cookie });
  const listedInvestor = listed.payload.items.find(row => row.id === investor.id);
  assert.equal(listedInvestor.registryVersion, eligibleAgain.registryVersion);
  assert.equal(listedInvestor.wallets.find(row => row.id === wallet.id).registryVersion, 6);
  console.log("PASS real HTTP audit insert failures roll back both transitions/versions; Auditor reads additive versions");

  const triggerInvestor = await database.investor.create({ data: { displayName: "Synthetic Trigger Investor",
    type: "INDIVIDUAL", countryCode: "KZ" } });
  const triggerWallet = await database.wallet.create({ data: { address: publicAddress(), investorId: triggerInvestor.id,
    network: "SOLANA_LOCALNET", status: "ACTIVE", verifiedAt: new Date() } });
  for (const [model, id, changed, original] of [
    [database.investor, triggerInvestor.id, { displayName: "Synthetic Trigger Correction" }, { displayName: triggerInvestor.displayName }],
    [database.wallet, triggerWallet.id, { status: "BLOCKED" }, { status: "ACTIVE" }]
  ]) {
    const before = await model.findUniqueOrThrow({ where: { id } });
    const changedRow = await model.update({ where: { id }, data: changed });
    assert.equal(changedRow.registryVersion, before.registryVersion + 1);
    const restoredRow = await model.update({ where: { id }, data: original });
    assert.equal(restoredRow.registryVersion, before.registryVersion + 2);
    for (const [key, value] of Object.entries(original)) assert.equal(restoredRow[key], value);
    const noOp = await model.update({ where: { id }, data: original });
    assert.equal(noOp.registryVersion, restoredRow.registryVersion);
    const beforeDenied = await model.findUniqueOrThrow({ where: { id } });
    await assert.rejects(model.update({ where: { id }, data: { registryVersion: beforeDenied.registryVersion + 1 } }),
      error => /Registry version cannot change without a registry change/.test(error.message));
    assert.deepEqual(await model.findUniqueOrThrow({ where: { id } }), beforeDenied);
  }
  console.log("PASS PostgreSQL registry triggers version direct Investor/Wallet changes and ABA exactly once, preserve no-op versions and reject version-only writes atomically");
  return { investorId: investor.id, walletId: wallet.id, investorVersion: eligibleAgain.registryVersion, walletVersion: 6 };
}
