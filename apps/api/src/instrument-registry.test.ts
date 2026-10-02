import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createInstrumentDraft, InstrumentRegistryError, instrumentNetworkFromEnvironment, listInstruments } from "./instrument-registry.js";

const ACTOR = {
  id: "00000000-0000-4000-8000-000000000001",
  walletAddress: "11111111111111111111111111111111",
  correlationId: "00000000-0000-4000-8000-000000000002"
};
const INPUT = {
  issuerLegalName: "LifecycleKASE Demo Issuer",
  name: "Canonical Demo Bond",
  ticker: "kdb26",
  faceValueKzt: "1000",
  couponRateBps: 1000,
  paymentsPerYear: 2,
  issueAt: "2026-10-02T00:00:00.000Z",
  maturityAt: "2027-10-02T00:00:00.000Z"
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000003", name: "Canonical Demo Bond", ticker: "KDB26",
    assetType: "BOND", network: "SOLANA_LOCALNET", programId: null, mintAddress: null,
    issuerAuthority: ACTOR.walletAddress, faceValueMinor: 1_000_000_000n, currency: "KZT_TEST",
    settlementDecimals: 6, couponRateBps: 1000, paymentsPerYear: 2,
    issueAt: new Date(INPUT.issueAt), maturityAt: new Date(INPUT.maturityAt), totalSupply: 35n,
    circulatingSupply: 0n, status: "DRAFT", createdAt: new Date("2026-10-02T01:00:00.000Z"),
    issuer: { id: "00000000-0000-4000-8000-000000000004", legalName: INPUT.issuerLegalName },
    settlementAsset: { id: "00000000-0000-4000-8000-000000000005", code: "KZT_TEST", name: "KZT-Test",
      network: "SOLANA_LOCALNET", mintAddress: null, decimals: 6, isSimulated: true,
      disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan." },
    ...overrides
  };
}

test("creates an audited local instrument draft with fixed demo supply and operator authorities", async () => {
  const audits: any[] = [];
  const instrumentCreates: any[] = [];
  const asset = { id: "00000000-0000-4000-8000-000000000005", code: "KZT_TEST", name: "KZT-Test",
    network: "SOLANA_LOCALNET", mintAddress: null, decimals: 6, isSimulated: true,
    disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan.", active: true };
  const transaction = {
    settlementAsset: { findUnique: async () => null, create: async () => asset },
    issuer: { upsert: async () => row().issuer },
    instrument: { create: async (args: any) => { instrumentCreates.push(args); return row(); } },
    auditLog: { create: async (args: any) => { audits.push(args); return { id: "audit" }; } }
  };
  const database = { $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) } as unknown as PrismaClient;
  const result = await createInstrumentDraft(database, INPUT, ACTOR, "SOLANA_LOCALNET");
  assert.equal(result.ticker, "KDB26");
  assert.equal(result.faceValueMinor, "1000000000");
  assert.equal(result.totalSupply, "35");
  assert.equal(result.circulatingSupply, "0");
  assert.deepEqual(instrumentCreates[0].data, {
    issuerId: row().issuer.id, settlementAssetId: asset.id, name: INPUT.name, ticker: "KDB26",
    network: "SOLANA_LOCALNET", issuerAuthority: ACTOR.walletAddress,
    complianceAuthority: ACTOR.walletAddress, corporateActionAuthority: ACTOR.walletAddress,
    faceValueMinor: 1_000_000_000n, couponRateBps: 1000, paymentsPerYear: 2,
    issueAt: new Date(INPUT.issueAt), maturityAt: new Date(INPUT.maturityAt), totalSupply: 35n,
    circulatingSupply: 0n, status: "DRAFT"
  });
  assert.equal(audits[0].data.event, "INSTRUMENT_DRAFT_CREATED");
  assert.deepEqual(audits[0].data.metadataJson, {
    ticker: "KDB26", network: "SOLANA_LOCALNET", status: "DRAFT", totalSupply: "35", onChain: false
  });
});

test("lists bounded instrument pages and serializes bigint fields", async () => {
  const database = { instrument: { findMany: async () => [row(), row({ id: "00000000-0000-4000-8000-000000000006" })] } } as unknown as PrismaClient;
  const result = await listInstruments(database, "1", undefined);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.faceValueMinor, "1000000000");
  assert.equal(result.nextCursor, row().id);
  await assert.rejects(listInstruments(database, "101", undefined), (error: unknown) =>
    error instanceof InstrumentRegistryError && error.code === "INVALID_REQUEST");
  await assert.rejects(listInstruments(database, undefined, "bad"), (error: unknown) =>
    error instanceof InstrumentRegistryError && error.code === "INVALID_REQUEST");
});

test("rejects invalid terms, authority, unsupported fields and incompatible settlement configuration", async () => {
  const unused = {} as PrismaClient;
  for (const [changes, actor = ACTOR] of [
    [{ ticker: "bad ticker" }], [{ faceValueKzt: "1.5" }], [{ couponRateBps: 100001 }],
    [{ paymentsPerYear: 3 }], [{ maturityAt: INPUT.issueAt }], [{ status: "ACTIVE" }],
    [{}, { ...ACTOR, walletAddress: "bad" }]
  ] as Array<[Record<string, unknown>, typeof ACTOR?]>) {
    await assert.rejects(createInstrumentDraft(unused, { ...INPUT, ...changes }, actor!, "SOLANA_LOCALNET"),
      (error: unknown) => error instanceof InstrumentRegistryError && error.code === "INVALID_REQUEST");
  }
  const existingAsset = { network: "SOLANA_DEVNET", decimals: 6, isSimulated: true,
    disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan.", active: true };
  const transaction = { settlementAsset: { findUnique: async () => existingAsset } };
  const database = { $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) } as unknown as PrismaClient;
  await assert.rejects(createInstrumentDraft(database, INPUT, ACTOR, "SOLANA_LOCALNET"),
    (error: unknown) => error instanceof InstrumentRegistryError && error.code === "SETTLEMENT_ASSET_CONFLICT");
});

test("derives only matching localnet or devnet database networks", () => {
  assert.equal(instrumentNetworkFromEnvironment({ SOLANA_CLUSTER: "localnet" }), "SOLANA_LOCALNET");
  assert.equal(instrumentNetworkFromEnvironment({ SOLANA_CLUSTER: "devnet", WALLET_NETWORK: "SOLANA_DEVNET" }), "SOLANA_DEVNET");
  for (const environment of [
    { SOLANA_CLUSTER: "mainnet" },
    { SOLANA_CLUSTER: "localnet", WALLET_NETWORK: "SOLANA_DEVNET" }
  ]) assert.throws(() => instrumentNetworkFromEnvironment(environment), (error: unknown) =>
    error instanceof InstrumentRegistryError && error.code === "INSTRUMENT_CONFIGURATION_INVALID");
});
