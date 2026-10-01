import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { attachPendingWallet, createInvestor, InvestorRegistryError, listInvestors } from "./investor-registry.js";

const ID = "00000000-0000-4000-8000-000000000001";
const actor = { id: ID, walletAddress: "11111111111111111111111111111111", correlationId: ID };
const input = { displayName: " Demo A ", countryCode: "kz", type: "INDIVIDUAL", externalReference: "DEMO-A" };
function fixture() {
  let state: { investor: any; wallet: any; audit: any[] } = { investor: null, wallet: null, audit: [] };
  let failAudit = false;
  const tx = {
    investor: {
      findUnique: async () => state.investor,
      create: async ({ data }: any) => (state.investor = { id: ID, status: "ACTIVE", ...data })
    },
    wallet: {
      findUnique: async () => state.wallet,
      create: async ({ data }: any) => (state.wallet = { id: ID, ...data })
    },
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
  return { database, state: () => state, failAudit: () => { failAudit = true; } };
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
