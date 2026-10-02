import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { attachPendingWallet, createInvestor, decideInvestorEligibility, InvestorRegistryError, listInvestors,
  registryMutationOptionsFromEnvironment, revokeInvestorWallet } from "./investor-registry.js";

const ID = "00000000-0000-4000-8000-000000000001";
const actor = { id: ID, walletAddress: "11111111111111111111111111111111", correlationId: ID };
const input = { displayName: " Demo A ", countryCode: "kz", type: "INDIVIDUAL", externalReference: "DEMO-A" };
function fixture() {
  let state: { investor: any; wallet: any; audit: any[] } = { investor: null, wallet: null, audit: [] };
  let failAudit = false;
  let captureLocked = false;
  const tx = {
    investor: {
      findUnique: async () => state.investor,
      findUniqueOrThrow: async () => state.investor,
      create: async ({ data }: any) => (state.investor = { id: ID, status: "ACTIVE", ...data }),
      updateMany: async ({ where, data }: any) => {
        if (!state.investor || state.investor.id !== where.id || state.investor.status !== where.status ||
            state.investor.eligibilityStatus !== where.eligibilityStatus) return { count: 0 };
        Object.assign(state.investor, data);
        return { count: 1 };
      }
    },
    wallet: {
      findUnique: async () => state.wallet,
      findUniqueOrThrow: async () => state.wallet,
      findFirst: async ({ where }: any) => state.wallet?.id === where.id && state.wallet?.investorId === where.investorId
        ? state.wallet : null,
      create: async ({ data }: any) => (state.wallet = { id: ID, ...data }),
      count: async () => state.wallet?.status === "ACTIVE" && state.wallet.verifiedAt && !state.wallet.revokedAt ? 1 : 0,
      updateMany: async ({ where, data }: any) => {
        if (!state.wallet || state.wallet.id !== where.id || state.wallet.investorId !== where.investorId ||
            state.wallet.status !== where.status || state.wallet.revokedAt !== where.revokedAt) return { count: 0 };
        Object.assign(state.wallet, data);
        return { count: 1 };
      }
    },
    corporateAction: { findFirst: async () => captureLocked ? { id: ID } : null },
    auditLog: { create: async ({ data }: any) => {
      if (failAudit) throw new Error("synthetic audit failure");
      state.audit.push(data);
      return data;
    } }
  };
  const database = { $transaction: async (callback: (value: typeof tx) => Promise<unknown>, options: any) => {
    assert.equal(options.isolationLevel, "Serializable");
    const before = structuredClone(state);
    try { return await callback(tx); } catch (error) { state = before; throw error; }
  } } as unknown as PrismaClient;
  return { database, state: () => state, failAudit: () => { failAudit = true; }, lockCapture: () => { captureLocked = true; } };
}
function code(expected: string) {
  return (error: unknown) => error instanceof InvestorRegistryError && error.code === expected;
}
test("creates a normalized unreviewed investor with atomic actor audit", async () => {
  const f = fixture();
  const result = await createInvestor(f.database, input, actor);
  assert.equal(result.displayName, "Demo A");
  assert.equal(result.countryCode, "KZ");
  assert.equal(result.kycStatus, "NOT_STARTED");
  assert.equal(result.eligibilityStatus, "PENDING_REVIEW");
  assert.equal(f.state().audit[0].actorId, actor.id);
  assert.equal(f.state().audit[0].correlationId, actor.correlationId);
  assert.equal(f.state().audit[0].event, "INVESTOR_CREATED");
  assert.equal("displayName" in f.state().audit[0].metadataJson, false);
});
test("rejects malformed investor input and privilege fields before any transaction", async () => {
  for (const body of [null, [], {}, { ...input, displayName: "\nDemo" }, { ...input, displayName: "x".repeat(201) },
    { ...input, countryCode: "123" }, { ...input, type: "OTHER" }, { ...input, externalReference: "" },
    { ...input, eligibilityStatus: "ELIGIBLE" }, { ...input, kycStatus: "VERIFIED" }, { ...input, actorId: ID }]) {
    await assert.rejects(createInvestor({} as PrismaClient, body, actor), code("INVALID_REQUEST"));
  }
});
test("an audit failure rolls back the investor creation", async () => {
  const f = fixture(); f.failAudit();
  await assert.rejects(createInvestor(f.database, input, actor), /synthetic audit failure/);
  assert.equal(f.state().investor, null);
});
test("attaches only an unverified localnet wallet and audits the mapping", async () => {
  const f = fixture(); await createInvestor(f.database, input, actor);
  const result = await attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor);
  assert.equal(result.status, "PENDING");
  assert.equal(result.network, "SOLANA_LOCALNET");
  assert.equal(result.verifiedAt, null);
  assert.equal(f.state().wallet.investorId, ID);
  assert.equal(f.state().wallet.userId, undefined);
  assert.equal(f.state().audit[1].event, "INVESTOR_WALLET_ATTACHED");
  await assert.rejects(attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor), code("REGISTRY_CONFLICT"));
  assert.equal(f.state().audit.length, 2);
});
test("refuses missing/inactive investors and attempts to supply verification or network", async () => {
  const f = fixture();
  await assert.rejects(attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor), code("INVESTOR_NOT_FOUND"));
  await createInvestor(f.database, input, actor); f.state().investor.status = "CLOSED";
  await assert.rejects(attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor), code("INVESTOR_INACTIVE"));
  for (const body of [{ address: "invalid" }, { address: actor.walletAddress, verifiedAt: "now" },
    { address: actor.walletAddress, status: "ACTIVE" }, { address: actor.walletAddress, network: "SOLANA_DEVNET" }]) {
    await assert.rejects(attachPendingWallet({} as PrismaClient, ID, body, actor), code("INVALID_REQUEST"));
  }
  await assert.rejects(attachPendingWallet({} as PrismaClient, "invalid", {}, actor), code("INVALID_REQUEST"));
});
test("wallet mapping rolls back if its audit cannot be saved", async () => {
  const f = fixture(); await createInvestor(f.database, input, actor); f.failAudit();
  await assert.rejects(attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor), /synthetic audit failure/);
  assert.equal(f.state().wallet, null);
});
test("lists bounded pages with a continuation cursor and bounded wallet previews", async () => {
  const database = { investor: { findMany: async (query: any) => {
    assert.equal(query.take, 3);
    assert.equal(query.select.wallets.take, 20);
    return [{ id: ID }, { id: "second" }, { id: "third" }];
  } } } as unknown as PrismaClient;
  const result = await listInvestors(database, "2", undefined);
  assert.equal(result.items.length, 2);
  assert.equal(result.nextCursor, "second");
  for (const limit of ["0", "101", "1.5", "-1", "1e2", ["1"]]) {
    await assert.rejects(listInvestors({} as PrismaClient, limit, undefined), code("INVALID_REQUEST"));
  }
  await assert.rejects(listInvestors({} as PrismaClient, undefined, "invalid"), code("INVALID_REQUEST"));
});
test("maps database uniqueness and serialization conflicts without leaking details", async () => {
  for (const databaseCode of ["P2002", "P2034"]) {
    const database = { $transaction: async () => {
      throw new Prisma.PrismaClientKnownRequestError("internal diagnostic", { code: databaseCode, clientVersion: "test" });
    } } as unknown as PrismaClient;
    await assert.rejects(createInvestor(database, input, actor), code("REGISTRY_CONFLICT"));
  }
});

test("decides eligibility once only after verified wallet ownership and writes atomic audit", async () => {
  const f = fixture();
  await createInvestor(f.database, input, actor);
  await attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor);
  await assert.rejects(
    decideInvestorEligibility(f.database, ID, { decision: "ELIGIBLE", reasonCode: "DEMO_CRITERIA_MET" }, actor),
    code("VERIFIED_WALLET_REQUIRED")
  );
  f.state().wallet.status = "ACTIVE";
  f.state().wallet.verifiedAt = new Date("2026-10-02T09:00:00.000Z");
  const reviewedAt = new Date("2026-10-02T09:01:00.000Z");
  const result = await decideInvestorEligibility(
    f.database, ID, { decision: "ELIGIBLE", reasonCode: "DEMO_CRITERIA_MET" }, actor,
    { now: reviewedAt, graceSeconds: 300 }
  );
  assert.equal(result.eligibilityStatus, "ELIGIBLE");
  assert.equal(result.eligibilityReasonCode, "DEMO_CRITERIA_MET");
  assert.equal(result.eligibilityReviewedAt, reviewedAt);
  assert.equal(f.state().audit.at(-1).event, "INVESTOR_ELIGIBILITY_DECIDED");
  assert.equal(f.state().audit.at(-1).metadataJson.reasonCode, "DEMO_CRITERIA_MET");
  await assert.rejects(
    decideInvestorEligibility(f.database, ID, { decision: "NOT_ELIGIBLE", reasonCode: "DEMO_CRITERIA_NOT_MET" }, actor),
    code("ELIGIBILITY_ALREADY_DECIDED")
  );
});

test("rejects invalid decisions and locks mapping or eligibility changes during snapshot capture", async () => {
  const f = fixture();
  await createInvestor(f.database, input, actor);
  for (const body of [
    {},
    { decision: "SUSPENDED", reasonCode: "DEMO_CRITERIA_NOT_MET" },
    { decision: "ELIGIBLE", reasonCode: "DEMO_CRITERIA_NOT_MET" },
    { decision: "NOT_ELIGIBLE", reasonCode: "OTHER" },
    { decision: "NOT_ELIGIBLE", reasonCode: "DEMO_CRITERIA_NOT_MET", note: "extra" }
  ]) await assert.rejects(decideInvestorEligibility({} as PrismaClient, ID, body, actor), code("INVALID_REQUEST"));
  f.lockCapture();
  await assert.rejects(
    attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor),
    code("REGISTRY_CAPTURE_LOCKED")
  );
  await assert.rejects(
    decideInvestorEligibility(f.database, ID, { decision: "NOT_ELIGIBLE", reasonCode: "DEMO_CRITERIA_NOT_MET" }, actor),
    code("REGISTRY_CAPTURE_LOCKED")
  );
  assert.equal(f.state().audit.length, 1);
});

test("validates the shared registry capture-window configuration", () => {
  assert.equal(registryMutationOptionsFromEnvironment({}, new Date("2026-10-02T09:00:00Z")).graceSeconds, 300);
  assert.equal(registryMutationOptionsFromEnvironment({ SNAPSHOT_GRACE_SECONDS: "120" }).graceSeconds, 120);
  for (const value of ["0", "301", "1.5", "invalid"]) {
    assert.throws(() => registryMutationOptionsFromEnvironment({ SNAPSHOT_GRACE_SECONDS: value }), code("REGISTRY_CONFIGURATION_INVALID"));
  }
});

test("revokes an investor wallet once with a fixed reason and atomic audit", async () => {
  const f = fixture();
  await createInvestor(f.database, input, actor);
  await attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor);
  f.state().wallet.status = "ACTIVE";
  f.state().wallet.verifiedAt = new Date("2026-10-02T09:00:00.000Z");
  f.state().investor.eligibilityStatus = "ELIGIBLE";
  const revokedAt = new Date("2026-10-02T11:00:00.000Z");
  const result = await revokeInvestorWallet(
    f.database, ID, ID, { reasonCode: "WALLET_REPLACEMENT" }, actor,
    { now: revokedAt, graceSeconds: 300 }
  );
  assert.equal(result.status, "REVOKED");
  assert.equal(result.revokedAt, revokedAt);
  assert.equal(result.revocationReasonCode, "WALLET_REPLACEMENT");
  assert.equal(f.state().investor.eligibilityStatus, "ELIGIBLE");
  assert.equal(f.state().audit.at(-1).event, "INVESTOR_WALLET_REVOKED");
  assert.deepEqual(f.state().audit.at(-1).metadataJson, {
    investorId: ID, previousStatus: "ACTIVE", reasonCode: "WALLET_REPLACEMENT", network: "SOLANA_LOCALNET"
  });
  await assert.rejects(
    revokeInvestorWallet(f.database, ID, ID, { reasonCode: "OWNER_REQUEST" }, actor),
    code("WALLET_ALREADY_REVOKED")
  );
});

test("validates wallet revocation scope and rolls state back when audit persistence fails", async () => {
  for (const body of [{}, { reasonCode: "OTHER" }, { reasonCode: "OWNER_REQUEST", note: "free text" }]) {
    await assert.rejects(revokeInvestorWallet({} as PrismaClient, ID, ID, body, actor), code("INVALID_REQUEST"));
  }
  await assert.rejects(revokeInvestorWallet({} as PrismaClient, "invalid", ID, {}, actor), code("INVALID_REQUEST"));
  const f = fixture();
  await createInvestor(f.database, input, actor);
  await attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor);
  f.failAudit();
  await assert.rejects(
    revokeInvestorWallet(f.database, ID, ID, { reasonCode: "REGISTRY_CORRECTION" }, actor),
    /synthetic audit failure/
  );
  assert.equal(f.state().wallet.status, "PENDING");
  assert.equal(f.state().wallet.revokedAt, null);
});

test("blocks wallet revocation during snapshot capture", async () => {
  const f = fixture();
  await createInvestor(f.database, input, actor);
  await attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor);
  f.lockCapture();
  await assert.rejects(
    revokeInvestorWallet(f.database, ID, ID, { reasonCode: "SECURITY_CONCERN" }, actor),
    code("REGISTRY_CAPTURE_LOCKED")
  );
  assert.equal(f.state().wallet.status, "PENDING");
});
