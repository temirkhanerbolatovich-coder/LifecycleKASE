import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { attachPendingWallet, createInvestor, decideInvestorEligibility, getInvestor, InvestorRegistryError, listInvestors, listInvestorWallets,
  updateInvestorProfile,
  registryMutationOptionsFromEnvironment, revokeInvestorWallet, reviewInvestorEligibility, changeInvestorWalletStatus } from "./investor-registry.js";

const ID = "00000000-0000-4000-8000-000000000001";
const actor = { id: ID, walletAddress: "11111111111111111111111111111111", correlationId: ID };
const input = { displayName: " Demo A ", countryCode: "kz", type: "INDIVIDUAL", externalReference: "DEMO-A" };
function fixture() {
  let state: { investor: any; wallet: any; audit: any[] } = { investor: null, wallet: null, audit: [] };
  let failAudit = false;
  let captureLocked = false;
  let loseInvestorUpdate = false;
  const tx = {
    investor: {
      findUnique: async () => state.investor,
      findUniqueOrThrow: async () => state.investor,
      create: async ({ data }: any) => (state.investor = { id: ID, status: "ACTIVE", registryVersion: 1, ...data }),
      updateMany: async ({ where, data }: any) => {
        if (loseInvestorUpdate || !state.investor || state.investor.id !== where.id || state.investor.status !== where.status ||
            (where.eligibilityStatus !== undefined && state.investor.eligibilityStatus !== where.eligibilityStatus) ||
            (where.registryVersion !== undefined && state.investor.registryVersion !== where.registryVersion)) return { count: 0 };
        const { registryVersion, ...fields } = data;
        Object.assign(state.investor, fields);
        state.investor.registryVersion += registryVersion?.increment ?? 0;
        return { count: 1 };
      }
    },
    wallet: {
      findUnique: async () => state.wallet,
      findUniqueOrThrow: async () => state.wallet,
      findFirst: async ({ where }: any) => state.wallet?.id === where.id && state.wallet?.investorId === where.investorId
        ? state.wallet : null,
      create: async ({ data }: any) => (state.wallet = { id: ID, registryVersion: 1, ...data }),
      count: async () => state.wallet?.status === "ACTIVE" && state.wallet.verifiedAt && !state.wallet.revokedAt ? 1 : 0,
      updateMany: async ({ where, data }: any) => {
        if (!state.wallet || state.wallet.id !== where.id || state.wallet.investorId !== where.investorId ||
            state.wallet.status !== where.status || state.wallet.revokedAt !== where.revokedAt ||
            (where.registryVersion !== undefined && state.wallet.registryVersion !== where.registryVersion)) return { count: 0 };
        const { registryVersion, ...fields } = data;
        Object.assign(state.wallet, fields);
        state.wallet.registryVersion += registryVersion?.increment ?? 0;
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
  return { database, state: () => state, failAudit: () => { failAudit = true; }, lockCapture: () => { captureLocked = true; },
    loseInvestorUpdate: () => { loseInvestorUpdate = true; } };
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
    { ...input, countryCode: "123" }, { ...input, countryCode: "ß" }, { ...input, countryCode: "ıı" },
    { ...input, type: "OTHER" }, { ...input, externalReference: "" },
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

test("search normalizes text, preserves wallet address case and keeps a stable creation/id cursor", async () => {
  const createdAt = new Date("2026-10-11T12:00:00Z");
  let query: any;
  const database = { investor: {
    findUnique: async ({ where }: any) => {
      assert.equal(where.id, ID);
      return { id: ID, createdAt };
    },
    findMany: async (value: any) => { query = value; return []; }
  } } as unknown as PrismaClient;
  await listInvestors(database, "100", ID, "  AbCKey  ");
  assert.equal(query.take, 101);
  assert.deepEqual(query.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  assert.deepEqual(query.where.AND[0], { OR: [
    { displayName: { contains: "AbCKey", mode: "insensitive" } },
    { externalReference: { contains: "AbCKey", mode: "insensitive" } },
    { wallets: { some: { address: { contains: "AbCKey" } } } }
  ] });
  assert.deepEqual(query.where.AND[1], { id: { not: ID } });
  assert.deepEqual(query.cursor, { id: ID });
  assert.equal(query.skip, undefined);
  await listInvestors(database, undefined, undefined, ID.toUpperCase());
  assert.deepEqual(query.where.AND[0].OR.at(-1), { id: ID.toUpperCase() });
  await listInvestors(database, undefined, undefined, "  ");
  assert.equal(query.where, undefined);
  for (const search of [[], {}, 1, "x".repeat(201), "key\n", "key\u0000", "key\u007f"]) {
    await assert.rejects(listInvestors({} as PrismaClient, undefined, undefined, search), code("INVALID_REQUEST"));
  }
  await assert.rejects(listInvestors({ investor: { findUnique: async () => null } } as unknown as PrismaClient,
    undefined, ID, "Demo"), code("INVALID_REQUEST"));
});

test("detail reports bounded previews and the independent full wallet count", async () => {
  const database = { investor: { findUnique: async ({ where, select }: any) => {
    assert.equal(where.id, ID);
    assert.equal(select.wallets.take, 20);
    assert.deepEqual(select.wallets.orderBy, { id: "asc" });
    assert.deepEqual(select._count, { select: { wallets: true } });
    assert.equal(select.registryVersion, true);
    return { id: ID, registryVersion: 3, wallets: Array(20).fill({ id: ID }), _count: { wallets: 27 } };
  } } } as unknown as PrismaClient;
  const detail = await getInvestor(database, ID);
  assert.equal(detail.wallets.length, 20);
  assert.equal(detail._count.wallets, 27);
  await assert.rejects(getInvestor({} as PrismaClient, "invalid"), code("INVALID_REQUEST"));
  await assert.rejects(getInvestor({ investor: { findUnique: async () => null } } as unknown as PrismaClient, ID),
    code("INVESTOR_NOT_FOUND"));
});

test("wallet pages cover more than twenty records and reject cursors from another investor", async () => {
  const records = Array.from({ length: 27 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    status: index % 2 ? "REVOKED" : "PENDING", investorId: ID
  }));
  let investorExists = true;
  const database = {
    investor: { findUnique: async () => investorExists ? { id: ID } : null },
    wallet: {
      findFirst: async ({ where }: any) => records.find(row => row.id === where.id && row.investorId === where.investorId) ?? null,
      findMany: async ({ where, take, orderBy, select }: any) => {
        assert.deepEqual(orderBy, { id: "asc" });
        assert.equal(select.registryVersion, true);
        return records.filter(row => row.investorId === where.investorId && (!where.id || row.id > where.id.gt)).slice(0, take);
      }
    }
  } as unknown as PrismaClient;
  const first = await listInvestorWallets(database, ID, undefined, undefined);
  assert.equal(first.items.length, 20);
  assert.equal(first.nextCursor, records[19]!.id);
  const second = await listInvestorWallets(database, ID, undefined, first.nextCursor);
  assert.equal(second.items.length, 7);
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items].map(row => row.id), records.map(row => row.id));
  assert.equal((await listInvestorWallets(database, ID, "100", undefined)).items.length, 27);
  for (const limit of ["0", "101", "1.5", ["1"]]) {
    await assert.rejects(listInvestorWallets({} as PrismaClient, ID, limit, undefined), code("INVALID_REQUEST"));
  }
  await assert.rejects(listInvestorWallets(database, ID, undefined, "00000000-0000-4000-8000-999999999999"), code("INVALID_REQUEST"));
  await assert.rejects(listInvestorWallets(database, "00000000-0000-4000-8000-000000000099", undefined, records[0]!.id), code("INVALID_REQUEST"));
  investorExists = false;
  await assert.rejects(listInvestorWallets(database, ID, undefined, undefined), code("INVESTOR_NOT_FOUND"));
  await assert.rejects(listInvestorWallets({} as PrismaClient, "invalid", undefined, undefined), code("INVALID_REQUEST"));
  await assert.rejects(listInvestorWallets({} as PrismaClient, ID, undefined, "invalid"), code("INVALID_REQUEST"));
});

const profileInput = (expectedVersion = 1) => ({
  displayName: " Corrected demo ", type: "INSTITUTIONAL", countryCode: "us", externalReference: null,
  expectedVersion, reasonCode: "REGISTRY_CORRECTION"
});

test("profile correction changes only explicit facts, versions once and audits field names without PII", async () => {
  const f = await reviewedFixture();
  const before = structuredClone(f.state().investor);
  const walletBefore = structuredClone(f.state().wallet);
  const result = await updateInvestorProfile(f.database, ID, profileInput(2), actor);
  assert.equal(result.displayName, "Corrected demo");
  assert.equal(result.type, "INSTITUTIONAL");
  assert.equal(result.countryCode, "US");
  assert.equal(result.externalReference, null);
  assert.equal(result.registryVersion, 3);
  for (const field of ["kycStatus", "eligibilityStatus", "eligibilityReasonCode", "eligibilityReviewedAt", "status"]) {
    assert.deepEqual((result as any)[field], before[field]);
  }
  assert.deepEqual(f.state().wallet, walletBefore);
  const audit = f.state().audit.at(-1);
  assert.equal(audit.event, "INVESTOR_PROFILE_UPDATED");
  assert.equal(audit.actorId, actor.id);
  assert.equal(audit.correlationId, actor.correlationId);
  assert.deepEqual(audit.metadataJson, {
    changedFields: ["displayName", "type", "countryCode", "externalReference"], previousVersion: 2,
    registryVersion: 3, reasonCode: "REGISTRY_CORRECTION", source: "administrator-api"
  });
  await assert.rejects(updateInvestorProfile(f.database, ID, profileInput(2), actor), code("REGISTRY_CONFLICT"));
  await assert.rejects(updateInvestorProfile(f.database, ID, profileInput(3), actor), code("REGISTRY_TRANSITION_INVALID"));
  assert.equal(f.state().audit.length, 4);
});

test("profile correction permits suspended investors, refuses closed/missing records and records only effective fields", async () => {
  const f = fixture();
  await assert.rejects(updateInvestorProfile(f.database, ID, profileInput(), actor), code("INVESTOR_NOT_FOUND"));
  await createInvestor(f.database, input, actor);
  f.state().investor.status = "CLOSED";
  await assert.rejects(updateInvestorProfile(f.database, ID, profileInput(), actor), code("INVESTOR_INACTIVE"));
  f.state().investor.status = "SUSPENDED";
  await updateInvestorProfile(f.database, ID, { ...input, displayName: "Changed", expectedVersion: 1,
    reasonCode: "PERIODIC_REVIEW" }, actor);
  assert.equal(f.state().investor.status, "SUSPENDED");
  assert.equal(f.state().investor.registryVersion, 2);
  assert.deepEqual(f.state().audit.at(-1).metadataJson.changedFields, ["displayName"]);
});

test("profile rejects omissions, overposting and malformed inputs before any transaction", async () => {
  for (const field of ["displayName", "type", "countryCode", "externalReference", "expectedVersion", "reasonCode"]) {
    const body: any = profileInput(); delete body[field];
    await assert.rejects(updateInvestorProfile({} as PrismaClient, ID, body, actor), code("INVALID_REQUEST"));
  }
  for (const body of [null, [], {},
    { ...profileInput(), displayName: "\nName" }, { ...profileInput(), displayName: "x".repeat(201) },
    { ...profileInput(), displayName: " " }, { ...profileInput(), countryCode: "123" },
    { ...profileInput(), countryCode: "КЗ" }, { ...profileInput(), countryCode: "ß" },
    { ...profileInput(), countryCode: "ıı" }, { ...profileInput(), type: "OTHER" },
    { ...profileInput(), externalReference: "" }, { ...profileInput(), externalReference: "x".repeat(101) },
    { ...profileInput(), externalReference: "ref\u007f" }, { ...profileInput(), externalReference: 1 },
    { ...profileInput(), expectedVersion: "1" }, { ...profileInput(), expectedVersion: 1.5 },
    { ...profileInput(), expectedVersion: 0 }, { ...profileInput(), expectedVersion: 2_147_483_647 },
    { ...profileInput(), reasonCode: "OTHER" }, { ...profileInput(), reasonCode: "OWNER_REQUEST\n" },
    { ...profileInput(), kycStatus: "VERIFIED" }, { ...profileInput(), eligibilityStatus: "ELIGIBLE" },
    { ...profileInput(), status: "ACTIVE" }, { ...profileInput(), wallets: [] }, { ...profileInput(), actorId: ID }
  ]) await assert.rejects(updateInvestorProfile({} as PrismaClient, ID, body, actor), code("INVALID_REQUEST"));
  await assert.rejects(updateInvestorProfile({} as PrismaClient, "invalid", profileInput(), actor), code("INVALID_REQUEST"));
});

test("profile correction is capture locked and rolls back on audit failure or lost compare-and-set", async () => {
  const locked = fixture(); await createInvestor(locked.database, input, actor); locked.lockCapture();
  await assert.rejects(updateInvestorProfile(locked.database, ID, profileInput(), actor), code("REGISTRY_CAPTURE_LOCKED"));
  assert.equal(locked.state().investor.displayName, "Demo A");
  const rollback = fixture(); await createInvestor(rollback.database, input, actor); rollback.failAudit();
  await assert.rejects(updateInvestorProfile(rollback.database, ID, profileInput(), actor), /synthetic audit failure/);
  assert.equal(rollback.state().investor.registryVersion, 1);
  assert.equal(rollback.state().investor.displayName, "Demo A");
  assert.equal(rollback.state().audit.length, 1);
  const concurrent = fixture(); await createInvestor(concurrent.database, input, actor); concurrent.loseInvestorUpdate();
  await assert.rejects(updateInvestorProfile(concurrent.database, ID, profileInput(), actor), code("REGISTRY_CONFLICT"));
  assert.equal(concurrent.state().audit.length, 1);
  for (const databaseCode of ["P2002", "P2034"]) {
    const database = { $transaction: async () => {
      throw new Prisma.PrismaClientKnownRequestError("internal profile diagnostic", { code: databaseCode, clientVersion: "test" });
    } } as unknown as PrismaClient;
    await assert.rejects(updateInvestorProfile(database, ID, profileInput(), actor), code("REGISTRY_CONFLICT"));
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

async function reviewedFixture() {
  const f = fixture();
  await createInvestor(f.database, input, actor);
  await attachPendingWallet(f.database, ID, { address: actor.walletAddress }, actor);
  f.state().wallet.status = "ACTIVE";
  f.state().wallet.verifiedAt = new Date("2026-10-01T09:00:00Z");
  await decideInvestorEligibility(f.database, ID, { decision: "ELIGIBLE", reasonCode: "DEMO_CRITERIA_MET" }, actor);
  return f;
}
const review = (decision: string, expectedVersion: number) => ({ decision, expectedVersion, reasonCode: "PERIODIC_REVIEW" });
const walletStatus = (status: string, expectedVersion: number) => ({ status, expectedVersion, reasonCode: "SECURITY_CONCERN" });

test("review suspends and restores eligibility with versions, stable demo criteria and actor audit", async () => {
  const f = await reviewedFixture();
  assert.equal(f.state().investor.registryVersion, 2);
  const suspended = await reviewInvestorEligibility(f.database, ID, review("SUSPENDED", 2), actor);
  assert.equal(suspended.registryVersion, 3);
  assert.equal(suspended.eligibilityStatus, "SUSPENDED");
  const entry = f.state().audit.at(-1);
  assert.equal(entry.event, "INVESTOR_ELIGIBILITY_REVIEWED");
  assert.equal(entry.actorId, actor.id);
  assert.equal(entry.correlationId, actor.correlationId);
  assert.deepEqual(entry.metadataJson, { previousEligibilityStatus: "ELIGIBLE", eligibilityStatus: "SUSPENDED",
    previousVersion: 2, registryVersion: 3, reasonCode: "PERIODIC_REVIEW", source: "administrator-api" });
  const restored = await reviewInvestorEligibility(f.database, ID, review("ELIGIBLE", 3), actor);
  assert.equal(restored.registryVersion, 4);
  assert.equal(restored.eligibilityReasonCode, "DEMO_CRITERIA_MET");
  await assert.rejects(reviewInvestorEligibility(f.database, ID, review("NOT_ELIGIBLE", 2), actor), code("REGISTRY_CONFLICT"));
  await assert.rejects(reviewInvestorEligibility(f.database, ID, review("ELIGIBLE", 4), actor), code("REGISTRY_TRANSITION_INVALID"));
  assert.equal(f.state().audit.length, 5);
});

test("wallet temporary block/unblock preserves ownership evidence and rejects stale ABA forms", async () => {
  const f = await reviewedFixture();
  const evidence = { address: f.state().wallet.address, investorId: f.state().wallet.investorId,
    verifiedAt: f.state().wallet.verifiedAt, network: f.state().wallet.network };
  const blocked = await changeInvestorWalletStatus(f.database, ID, ID, walletStatus("BLOCKED", 1), actor);
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.registryVersion, 2);
  assert.deepEqual(f.state().audit.at(-1).metadataJson, { investorId: ID, previousStatus: "ACTIVE", status: "BLOCKED",
    previousVersion: 1, registryVersion: 2, reasonCode: "SECURITY_CONCERN", network: "SOLANA_LOCALNET" });
  await assert.rejects(changeInvestorWalletStatus(f.database, ID, ID, walletStatus("BLOCKED", 2), actor), code("REGISTRY_TRANSITION_INVALID"));
  await reviewInvestorEligibility(f.database, ID, review("SUSPENDED", 2), actor);
  // A blocked wallet cannot be used to restore a suspended investor's eligibility.
  await assert.rejects(reviewInvestorEligibility(f.database, ID, review("ELIGIBLE", 3), actor), code("VERIFIED_WALLET_REQUIRED"));
  await changeInvestorWalletStatus(f.database, ID, ID, walletStatus("ACTIVE", 2), actor);
  assert.equal(f.state().wallet.registryVersion, 3);
  for (const [field, value] of Object.entries(evidence)) assert.deepEqual(f.state().wallet[field], value);
  assert.equal(f.state().wallet.revokedAt, null);
  await assert.rejects(changeInvestorWalletStatus(f.database, ID, ID, walletStatus("BLOCKED", 1), actor), code("REGISTRY_CONFLICT"));
});

test("review rejects malformed values, privilege fields and pending initial decisions", async () => {
  for (const body of [review("ACTIVE", 1), review("ELIGIBLE", 0), review("ELIGIBLE", 1.5), review("ELIGIBLE", 2_147_483_647),
    { ...review("ELIGIBLE", 1), expectedVersion: "1" }, { ...review("ELIGIBLE", 1), reasonCode: "OTHER" },
    { ...review("ELIGIBLE", 1), kycStatus: "VERIFIED" }, { ...walletStatus("BLOCKED", 1), note: "free text" }]) {
    const call = "status" in body ? changeInvestorWalletStatus({} as PrismaClient, ID, ID, body, actor) :
      reviewInvestorEligibility({} as PrismaClient, ID, body, actor);
    await assert.rejects(call, code("INVALID_REQUEST"));
  }
  const f = fixture(); await createInvestor(f.database, input, actor);
  await assert.rejects(reviewInvestorEligibility(f.database, ID, review("NOT_ELIGIBLE", 1), actor), code("REGISTRY_TRANSITION_INVALID"));
  await assert.rejects(changeInvestorWalletStatus(f.database, ID, ID, walletStatus("BLOCKED", 1), actor), code("WALLET_NOT_FOUND"));
});

test("temporary status never revives pending, revoked, unverified or operator wallets", async () => {
  for (const change of [{ status: "PENDING" }, { status: "REVOKED" }, { revokedAt: new Date() }, { verifiedAt: null }, { userId: ID }]) {
    const f = await reviewedFixture(); Object.assign(f.state().wallet, change);
    const before = structuredClone(f.state());
    await assert.rejects(changeInvestorWalletStatus(f.database, ID, ID, walletStatus("BLOCKED", 1), actor), code("WALLET_STATUS_TRANSITION_INVALID"));
    assert.deepEqual(f.state(), before);
  }
});

test("new registry transitions are capture-locked and atomic with audit persistence", async () => {
  for (const operation of ["review", "wallet"]) {
    for (const failure of ["capture", "audit", "inactive"]) {
      const f = await reviewedFixture();
      if (failure === "capture") f.lockCapture();
      if (failure === "audit") f.failAudit();
      if (failure === "inactive") f.state().investor.status = "SUSPENDED";
      const before = structuredClone(f.state());
      const call = operation === "review" ? reviewInvestorEligibility(f.database, ID, review("SUSPENDED", 2), actor) :
        changeInvestorWalletStatus(f.database, ID, ID, walletStatus("BLOCKED", 1), actor);
      await assert.rejects(call, failure === "audit" ? /synthetic audit failure/ :
        code(failure === "capture" ? "REGISTRY_CAPTURE_LOCKED" : "INVESTOR_INACTIVE"));
      assert.deepEqual(f.state(), before);
    }
  }
});
