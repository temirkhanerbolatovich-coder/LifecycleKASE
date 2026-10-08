import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import { encodePublicKey } from "@lifecycle-kase/solana-client";
import { requireApprovedEntitlements } from "../apps/api/dist/entitlements.js";

/** Called only inside test-corporate-actions' uniquely generated, disposable database. */
export async function syntheticEntitlementAction(database, instrument, administrator, type = "COUPON_PAYMENT") {
  const at = new Date(Math.floor(Date.now() / 1000) * 1000 - 30_000);
  const action = await database.corporateAction.create({ data: { instrumentId: instrument.id, type,
    intent: "SYNTHETIC finalized snapshot fixture, not on-chain proof", createdById: administrator.userId,
    recordAt: at, executeAt: type === "BOND_REDEMPTION" ? instrument.maturityAt : new Date(at.getTime() + 600_000),
    status: "SNAPSHOT_CREATED", ...(type === "EARLY_REDEMPTION" ? { redemptionPercentageBps: 2000, redemptionPriceMinor: 1_000_000_000n } : {}) } });
  const publicAddress = () => encodePublicKey(randomBytes(32));
  const investors = [];
  for (const balance of [10n, 20n, 5n]) {
    const investor = await database.investor.create({ data: { displayName: "Synthetic entitlement holder", type: "INDIVIDUAL", countryCode: "KZ",
      eligibilityStatus: "ELIGIBLE", eligibilityReasonCode: "DEMO_CRITERIA_MET", eligibilityReviewedAt: new Date(at.getTime() - 1000) } });
    const wallets = [];
    // Two wallets and two token accounts aggregate to one Investor entitlement.
    for (const walletBalance of balance === 10n ? [4n, 6n] : [balance]) {
      const wallet = await database.wallet.create({ data: { address: publicAddress(), investorId: investor.id,
        network: "SOLANA_LOCALNET", status: "ACTIVE", verifiedAt: new Date(at.getTime() - 1000) } });
      wallets.push({ walletId: wallet.id, walletAddress: wallet.address, walletStatus: "ACTIVE",
        tokenAccounts: [{ address: publicAddress(), balance: walletBalance - 1n }, { address: publicAddress(), balance: 1n }] });
    }
    investors.push({ investorId: investor.id, eligibilityStatus: "ELIGIBLE", wallets });
  }
  const commitment = createSnapshotV2Commitment({ actionId: action.id, instrumentId: instrument.id, cluster: "localnet",
    networkGenesisHash: process.env.SOLANA_GENESIS_HASH, mintAddress: instrument.mintAddress,
    recordAt: at.toISOString(), blockTime: at.toISOString(), createdAt: at.toISOString(), solanaSlot: 100n, mintSupply: 35n, investors });
  const snapshot = await database.snapshot.create({ data: { instrumentId: instrument.id, corporateActionId: action.id,
    recordAt: at, blockTime: at, createdAt: at, networkGenesisHash: process.env.SOLANA_GENESIS_HASH, solanaSlot: 100n,
    canonicalJson: commitment.snapshot, snapshotHash: Buffer.from(commitment.sha256, "hex"), mintSupply: 35n, totalBalance: 35n,
    investorCount: 3, walletCount: 4, investors: { create: commitment.snapshot.investors.map(row => ({
      investorId: row.investor_id, eligibilityStatus: row.eligibility_status, balance: BigInt(row.balance),
      wallets: { create: row.wallets.map(wallet => ({ walletId: wallet.wallet_id, walletAddress: wallet.wallet_address,
        walletStatus: wallet.wallet_status, balance: BigInt(wallet.balance), tokenAccounts: { create: wallet.token_accounts.map(account => ({ address: account.address, balance: BigInt(account.balance) })) } })) }
    })) } } });
  await database.snapshot.update({ where: { id: snapshot.id }, data: { status: "FINALIZED" } });
  await database.blockchainTransaction.create({ data: { corporateActionId: action.id, operationType: "REGISTER_SNAPSHOT",
    status: "FINALIZED", signature: publicAddress() + publicAddress(), networkGenesisHash: process.env.SOLANA_GENESIS_HASH,
    createdAt: at, submittedAt: at, finalizedAt: new Date(), requiredSigner: administrator.walletAddress } });
  return action.id;
}

export async function testEntitlementsFlow({ database, request, write, administrator, auditor, outsider, actionId, extensive = true, beforeApproval }) {
  const path = `/corporate-actions/${actionId}/entitlements`;
  const read = async () => {
    const response = await request(path, { cookie: auditor.cookie }); assert.equal(response.status, 200, JSON.stringify(response.payload));
    assert.equal(response.headers.get("cache-control"), "no-store"); return response.payload;
  };
  let current = await read(); const snapshot = await database.snapshot.findUniqueOrThrow({ where: { corporateActionId: actionId } });
  const receivers = Object.fromEntries(current.investors.map(row => [row.investorId, row.receiverWallets[0]]));
  const calculate = version => request(path + "/calculate", write({ version, receivers }));
  const review = async (decision, note = "Synthetic explicit review decision") => {
    const response = await request(path + "/review", write({ version: current.actionVersion, decision, note }));
    assert.equal(response.status, 201, JSON.stringify(response.payload)); current = response.payload; return current;
  };
  assert.equal((await request(path)).status, 401);
  for (const cookie of [auditor.cookie, outsider.cookie]) {
    assert.equal((await request(path + "/calculate", { ...write({ version: current.actionVersion }), cookie })).status, 403);
    assert.equal((await request(path + "/review", { ...write({ version: current.actionVersion, decision: "APPROVE", note: "Forbidden role/issuer" }), cookie })).status, 403);
  }
  assert.equal((await request(path + "/calculate", { ...write({ version: current.actionVersion }), requestOrigin: "https://untrusted.example" })).status, 403);
  assert.equal((await request(path + "/calculate", write({ version: "0" }))).status, 400);
  assert.equal((await request(path + "/calculate", write({ version: current.actionVersion, amountMinor: "999" }))).status, 400);
  const concurrent = await Promise.all([calculate(current.actionVersion), calculate(current.actionVersion)]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
  current = await read(); assert.equal(current.status, "CALCULATED"); assert.equal(current.items.length, 3);
  const type = (await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } })).type;
  const expected = type === "COUPON_PAYMENT" ? "1750000000" : type === "BOND_REDEMPTION" ? "36750000000" : "7000000000";
  assert.equal(current.totalEntitlementMinor, expected); assert.equal(current.eligibleHolders, 3);
  assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId } }), 3);
  assert.ok(current.items.every(row => row.currentEligibility.eligible && row.eligibilityReason === "LOCAL_DEMO_ELIGIBLE"));
  await assert.rejects(requireApprovedEntitlements(database, actionId), error => error.code === "APPROVAL_REQUIRED");
  assert.equal((await request(path + "/review", write({ version: current.actionVersion, decision: "APPROVE", note: "Cannot skip review" }))).status, 409);
  const ids = current.items.map(row => row.id).sort();
  await review("SUBMIT"); await review("RETURN", "Synthetic receiver/formula review requires recalculation");
  const recalc = await calculate(current.actionVersion); assert.equal(recalc.status, 201, JSON.stringify(recalc.payload)); current = recalc.payload;
  assert.deepEqual(current.items.map(row => row.id).sort(), ids);
  assert.equal(Buffer.from((await database.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).snapshotHash).toString("hex"), Buffer.from(snapshot.snapshotHash).toString("hex"));
  await review("SUBMIT");
  if (extensive) {
    const recipient = await database.wallet.findUniqueOrThrow({ where: { address: current.items[0].settlementWalletAddress } });
    await database.wallet.update({ where: { id: recipient.id }, data: { status: "REVOKED", revokedAt: new Date(), revocationReasonCode: "OWNER_REQUEST" } });
    const blocked = await request(path + "/review", write({ version: current.actionVersion, decision: "APPROVE", note: "Revoked wallet must block approval" }));
    assert.equal(blocked.status, 409); assert.equal(blocked.payload.code, "ELIGIBILITY_BLOCKED");
    // Restoring this synthetic fixture is allowed only inside the disposable test database.
    await database.wallet.update({ where: { id: recipient.id }, data: { status: "ACTIVE", revokedAt: null, revocationReasonCode: null } });
    const entitlement = current.items[0]; const amount = BigInt(entitlement.amountMinor);
    await database.entitlement.update({ where: { id: entitlement.id }, data: { amountMinor: amount + 1n } });
    const tampered = await request(path + "/review", write({ version: current.actionVersion, decision: "APPROVE", note: "Amount tampering must block approval" }));
    assert.equal(tampered.status, 409); assert.equal(tampered.payload.code, "CALCULATION_CHANGED");
    await database.entitlement.update({ where: { id: entitlement.id }, data: { amountMinor: amount } });
    await database.$executeRawUnsafe(`CREATE FUNCTION test_entitlement_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event = 'ENTITLEMENTS_REVIEW_DECIDED' THEN RAISE EXCEPTION 'synthetic approval audit failure'; END IF; RETURN NEW; END $$`);
    await database.$executeRawUnsafe(`CREATE TRIGGER test_entitlement_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_entitlement_audit_failure()`);
    assert.equal((await request(path + "/review", write({ version: current.actionVersion, decision: "APPROVE", note: "Audit rollback required" }))).status, 500);
    assert.equal((await read()).status, "UNDER_REVIEW");
    assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId, status: "READY" } }), 0);
    await database.$executeRawUnsafe(`DROP TRIGGER test_entitlement_audit_failure ON audit_logs`);
    await database.$executeRawUnsafe(`DROP FUNCTION test_entitlement_audit_failure()`);
  }
  if (beforeApproval) await beforeApproval(current);
  const previousVersion = current.actionVersion; await review("APPROVE");
  assert.equal(current.status, "APPROVED"); assert.equal(current.approvedById, administrator.userId); assert.ok(current.approvedAt);
  assert.ok(current.items.every(row => row.status === "READY")); await requireApprovedEntitlements(database, actionId);
  assert.equal((await request(path + "/review", write({ version: previousVersion, decision: "APPROVE", note: "Repeated response cannot add approval" }))).status, 409);
  assert.equal((await calculate(current.actionVersion)).status, 409);
  const events = await database.auditLog.findMany({ where: { corporateActionId: actionId, event: { in: ["ENTITLEMENTS_CALCULATED", "ENTITLEMENTS_REVIEW_DECIDED"] } } });
  assert.equal(events.filter(event => event.event === "ENTITLEMENTS_CALCULATED").length, 2);
  assert.equal(events.filter(event => event.metadataJson.decision === "APPROVE").length, 1);
  assert.ok(events.every(event => event.metadataJson.operationSource === "HTTP"));
  assert.ok(events.every(event => event.actorId === administrator.userId && event.actorWallet === administrator.walletAddress));
  const recipient = await database.wallet.findUniqueOrThrow({ where: { address: current.items[0].settlementWalletAddress } });
  await database.wallet.update({ where: { id: recipient.id }, data: { status: "BLOCKED" } });
  await assert.rejects(requireApprovedEntitlements(database, actionId), error => error.code === "ELIGIBILITY_BLOCKED");
  console.log(`PASS ${type} entitlement HTTP/PostgreSQL: investor aggregation, integer amounts, version concurrency, review/revision/approval, actor audit and current-wallet execution gate`);
}
