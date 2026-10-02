import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildInstrumentActivation, buildInstrumentDistribution, buildInstrumentInitialization, decodePublicKey, serializeUnsignedInstructionsTransaction,
  TOKEN_2022_PROGRAM_ID } from "@lifecycle-kase/solana-client";

import { confirmInstrumentActivation, confirmInstrumentDistribution, confirmInstrumentInitialization, InstrumentDeploymentError, instrumentDeploymentOptions,
  prepareInstrumentActivation, prepareInstrumentDistribution, prepareInstrumentInitialization,
  prepareInstrumentMintSetup } from "./instrument-deployment.js";

const KEY = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";

test("accepts explicit Localnet and Devnet deployment configuration", () => {
  assert.deepEqual(instrumentDeploymentOptions({ SOLANA_CLUSTER: "localnet", WALLET_NETWORK: "SOLANA_LOCALNET",
    SOLANA_GENESIS_HASH: KEY, PROGRAM_ID: PROGRAM, SOLANA_RPC_URL: "http://127.0.0.1:8899" }), {
    cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM
  });
  assert.equal(instrumentDeploymentOptions({ SOLANA_CLUSTER: "devnet", WALLET_NETWORK: "SOLANA_DEVNET",
    SOLANA_GENESIS_HASH: KEY, PROGRAM_ID: PROGRAM, SOLANA_RPC_URL: "https://api.devnet.solana.com",
    SOLANA_RPC_TIMEOUT_MS: "20000" }).cluster, "devnet");
});

test("fails closed for missing identities, mainnet, or mismatched wallet network", () => {
  for (const environment of [
    { SOLANA_CLUSTER: "mainnet", SOLANA_GENESIS_HASH: KEY, PROGRAM_ID: PROGRAM, SOLANA_RPC_URL: "https://example.com" },
    { SOLANA_CLUSTER: "localnet", SOLANA_GENESIS_HASH: KEY, PROGRAM_ID: PROGRAM, SOLANA_RPC_URL: "http://127.0.0.1:8899", WALLET_NETWORK: "SOLANA_DEVNET" },
    { SOLANA_CLUSTER: "localnet", PROGRAM_ID: PROGRAM, SOLANA_RPC_URL: "http://127.0.0.1:8899" }
  ]) assert.throws(() => instrumentDeploymentOptions(environment),
    (error: unknown) => error instanceof InstrumentDeploymentError && error.code === "INSTRUMENT_CONFIGURATION_INVALID");
});

test("prepares and audits an exact unsigned mint setup without changing the instrument", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const calls: Array<{ method: string; params: readonly unknown[] }> = [];
  const rpc = { request: async (method: string, params: readonly unknown[]) => {
    calls.push({ method, params });
    if (method === "getGenesisHash") return KEY;
    if (method === "getMinimumBalanceForRentExemption") return params[0] === 202 ? 2_000_000 : 1_500_000;
    if (method === "getAccountInfo") return { value: null };
    if (method === "getLatestBlockhash") return { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 } };
    throw new Error("unexpected RPC method");
  } };
  const created: Record<string, unknown>[] = [];
  const database = {
    blockchainTransaction: { findFirst: async () => null },
    instrument: { findUnique: async () => ({ id: instrumentId, status: "DRAFT", mintAddress: null,
      issuerAuthority: KEY, totalSupply: 35n, circulatingSupply: 0n,
      settlementAsset: { mintAddress: null } }) },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data); return { id: "00000000-0000-4000-8000-000000000004" };
      } },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; } }
    })
  };
  const result = await prepareInstrumentMintSetup(database as never, rpc, instrumentId, actor, {
    cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM
  });
  assert.equal(result.phase, "MINT_SETUP");
  assert.equal(result.requiredSigner, KEY);
  assert.equal(result.resumed, false);
  assert.ok(result.serializedTransactionBase64.length > 500);
  assert.equal(created[0]?.["operationType"], "INSTRUMENT_MINT_SETUP");
  assert.equal(created[1]?.["event"], "INSTRUMENT_MINT_SETUP_PREPARED");
  assert.equal(calls.filter(call => call.method === "getAccountInfo").length, 3);
});

test("resumes the winning mint setup attempt when concurrent prepare hits the active-attempt constraint", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const operationId = "00000000-0000-4000-8000-000000000004";
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  let reads = 0;
  const stored = { id: operationId, status: "PREPARED", preparedTransactionBase64: Buffer.alloc(200).toString("base64"),
    requiredSigner: KEY, networkGenesisHash: KEY, recentBlockhash: KEY, lastValidBlockHeight: 9n };
  const database = {
    blockchainTransaction: { findFirst: async () => ++reads === 1 ? null : stored },
    instrument: { findUnique: async () => ({ id: instrumentId, status: "DRAFT", mintAddress: null,
      issuerAuthority: KEY, totalSupply: 35n, circulatingSupply: 0n, settlementAsset: { mintAddress: null } }) },
    $transaction: async () => { throw Object.assign(new Error("unique"), { code: "P2002" }); }
  };
  const rpc = { request: async (method: string, params: readonly unknown[]) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "getMinimumBalanceForRentExemption") return params[0] === 202 ? 2_000_000 : 1_500_000;
    if (method === "getAccountInfo") return { value: null };
    if (method === "getLatestBlockhash") return { value: { blockhash: KEY, lastValidBlockHeight: 9 } };
    throw new Error(`unexpected RPC method ${method}`);
  } };

  const result = await prepareInstrumentMintSetup(database as never, rpc, instrumentId, actor, {
    cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM
  });
  assert.equal(result.operationId, operationId);
  assert.equal(result.resumed, true);
  assert.equal(reads, 2);
});

function tokenAccount(mint: string, owner: string, amount: bigint) {
  const data = Buffer.alloc(165);
  Buffer.from(decodePublicKey(mint)).copy(data, 0);
  Buffer.from(decodePublicKey(owner)).copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return { value: { owner: TOKEN_2022_PROGRAM_ID, executable: false, data: [data.toString("base64"), "base64"] } };
}

test("prepares and audits an exact eligible 10/20/5 distribution", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const wallets = [
    "9bHwb1ghrc3e1ntCyrgccNHVAppbtRJu1bAwHybjpAWK",
    "6heq5Nw2ErTWsaAYxWS8ZKtzorgpNdwNNeH4QMXWD3Bk",
    "C8LAzJwa6XyecAnjC9XkSHNm28M242qBSmacUytvBKb5"
  ];
  const allocations = wallets.map((walletAddress, index) => ({ walletAddress, amount: ["10", "20", "5"][index]! }));
  const created: Record<string, unknown>[] = [];
  let accountRead = 0;
  const rpc = { request: async (method: string) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "getAccountInfo") return accountRead++ === 0 ? tokenAccount(PROGRAM, KEY, 35n) : { value: null };
    if (method === "getLatestBlockhash") return { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 } };
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const database = {
    blockchainTransaction: { findFirst: async ({ where }: { where: { operationType: string } }) =>
      where.operationType === "INSTRUMENT_MINT_SETUP" ? { id: "setup" } : null },
    instrument: { findUnique: async () => ({ id: instrumentId, status: "DRAFT", mintAddress: PROGRAM,
      issuerAuthority: KEY, totalSupply: 35n, circulatingSupply: 0n, settlementAsset: { mintAddress: KEY } }) },
    wallet: { findMany: async () => wallets.map((address, index) => ({ address, network: "SOLANA_LOCALNET",
      status: "ACTIVE", verifiedAt: new Date(), revokedAt: null, investor: {
        id: `00000000-0000-4000-8000-00000000000${index + 5}`, displayName: `Investor ${index + 1}`,
        status: "ACTIVE", eligibilityStatus: "ELIGIBLE"
      } })) },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data); return { id: "00000000-0000-4000-8000-000000000004" };
      } },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; } }
    })
  };

  const result = await prepareInstrumentDistribution(database as never, rpc, instrumentId, actor, {
    cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM
  }, { allocations });

  assert.equal(result.phase, "DISTRIBUTION");
  assert.deepEqual(result.allocations.map(allocation => allocation.amount), ["10", "20", "5"]);
  assert.ok(result.serializedTransactionBase64.length > 500);
  assert.equal(created[0]?.["operationType"], "INSTRUMENT_DISTRIBUTION");
  assert.equal(created[1]?.["event"], "INSTRUMENT_DISTRIBUTION_PREPARED");
  assert.equal(accountRead, 4);
});

test("rejects a distribution that is not exactly three unique 10/20/5 wallets", async () => {
  await assert.rejects(prepareInstrumentDistribution({} as never, {} as never,
    "00000000-0000-4000-8000-000000000002",
    { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
      correlationId: "00000000-0000-4000-8000-000000000003" },
    { cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
      expectedGenesisHash: KEY, programId: PROGRAM },
    { allocations: [{ walletAddress: KEY, amount: "10" }] }),
  (error: unknown) => error instanceof InstrumentDeploymentError && error.code === "INVALID_REQUEST");
});

function base58(bytes: Buffer): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let encoded = "";
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; encoded = "1" + encoded; }
  return encoded;
}

test("finalizes only the exact distribution transaction and reconciled 10/20/5 balances", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const operationId = "00000000-0000-4000-8000-000000000004";
  const wallets = [
    "9bHwb1ghrc3e1ntCyrgccNHVAppbtRJu1bAwHybjpAWK",
    "6heq5Nw2ErTWsaAYxWS8ZKtzorgpNdwNNeH4QMXWD3Bk",
    "C8LAzJwa6XyecAnjC9XkSHNm28M242qBSmacUytvBKb5"
  ];
  const plan = await buildInstrumentDistribution({ administrator: KEY, bondMint: PROGRAM,
    allocations: wallets.map((walletAddress, index) => ({ walletAddress, amount: [10n, 20n, 5n][index]! })) });
  const unsigned = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: KEY,
    recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 });
  const signed = Buffer.from(unsigned, "base64");
  signed.fill(7, 1, 65);
  const signature = base58(signed.subarray(1, 65));
  const preparedPayload = { bondMint: PROGRAM, treasuryTokenAccount: plan.treasuryTokenAccount,
    allocations: plan.allocations.map((allocation, index) => ({
      investorId: `00000000-0000-4000-8000-00000000000${index + 5}`,
      walletAddress: allocation.walletAddress, tokenAccount: allocation.tokenAccount,
      amount: allocation.amount.toString()
    })) };
  let accountRead = 0;
  const balances = [0n, 10n, 20n, 5n];
  const owners = [KEY, ...wallets];
  const rpc = { request: async (method: string) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "getTransaction") return { slot: 42, meta: { err: null }, transaction: [signed.toString("base64"), "base64"] };
    if (method === "getAccountInfo") return { context: { slot: 42 },
      ...tokenAccount(PROGRAM, owners[accountRead]!, balances[accountRead++]!) };
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const writes: Record<string, unknown>[] = [];
  const database = {
    blockchainTransaction: { findUnique: async () => ({ id: operationId, instrumentId, operationType: "INSTRUMENT_DISTRIBUTION",
      status: "PREPARED", signature: null, requiredSigner: KEY, networkGenesisHash: KEY,
      preparedTransactionBase64: unsigned, preparedPayload, instrument: { id: instrumentId, issuerAuthority: KEY,
        mintAddress: PROGRAM, status: "DRAFT", circulatingSupply: 0n, totalSupply: 35n } }) },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; } },
      instrument: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; } },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return data; } }
    })
  };

  const result = await confirmInstrumentDistribution(database as never, rpc, instrumentId, operationId, signature,
    { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
      correlationId: "00000000-0000-4000-8000-000000000003" },
    { cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
      expectedGenesisHash: KEY, programId: PROGRAM });

  assert.equal(result.status, "FINALIZED");
  assert.equal(result.nextPhase, "INITIALIZE");
  assert.equal(accountRead, 4);
  assert.equal(writes[1]?.["circulatingSupply"], 35n);
  assert.equal(writes[2]?.["event"], "INSTRUMENT_DISTRIBUTION_FINALIZED");
});

function lifecycleInstrument(instrumentId: string, status: "DRAFT" | "DEPLOYING") {
  return { id: instrumentId, status, programId: PROGRAM, mintAddress: PROGRAM, issuerAuthority: KEY,
    complianceAuthority: KEY, corporateActionAuthority: KEY, faceValueMinor: 1_000_000n,
    couponRateBps: 1000, paymentsPerYear: 2, issueAt: new Date("2026-01-01T00:00:00.000Z"),
    maturityAt: new Date("2027-01-01T00:00:00.000Z"), totalSupply: 35n, circulatingSupply: 35n,
    settlementAsset: { mintAddress: KEY } };
}

function instrumentAccount(instrumentId: string, status: 0 | 1) {
  const instrument = lifecycleInstrument(instrumentId, status === 0 ? "DEPLOYING" : "DEPLOYING");
  const data = Buffer.alloc(225);
  createHash("sha256").update("account:Instrument").digest().copy(data, 0, 0, 8);
  let offset = 8; data[offset++] = 1;
  Buffer.from(instrumentId.replaceAll("-", ""), "hex").copy(data, offset); offset += 16;
  for (const key of [instrument.issuerAuthority, instrument.complianceAuthority,
    instrument.corporateActionAuthority, instrument.mintAddress!, instrument.settlementAsset.mintAddress!]) {
    Buffer.from(decodePublicKey(key)).copy(data, offset); offset += 32;
  }
  data.writeBigUInt64LE(instrument.faceValueMinor, offset); offset += 8;
  data.writeUInt32LE(instrument.couponRateBps, offset); offset += 4; data[offset++] = instrument.paymentsPerYear;
  data.writeBigInt64LE(BigInt(Math.floor(instrument.issueAt.getTime() / 1000)), offset); offset += 8;
  data.writeBigInt64LE(BigInt(Math.floor(instrument.maturityAt.getTime() / 1000)), offset); offset += 8;
  data.writeBigUInt64LE(instrument.totalSupply, offset); offset += 8; data[offset] = status;
  return { context: { slot: 42 }, value: { owner: PROGRAM, executable: false,
    data: [data.toString("base64"), "base64"] } };
}

test("prepares initialization only after finalized distribution", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const created: Record<string, unknown>[] = [];
  const database = {
    blockchainTransaction: { findFirst: async ({ where }: { where: { operationType: string } }) =>
      where.operationType === "INSTRUMENT_DISTRIBUTION" ? { id: "distribution" } : null },
    instrument: { findUnique: async () => lifecycleInstrument(instrumentId, "DRAFT") },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data); return { id: "00000000-0000-4000-8000-000000000004" };
      } },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; } }
    })
  };
  const rpc = { request: async (method: string) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "getAccountInfo") return { value: null };
    if (method === "getLatestBlockhash") return { value: { blockhash: KEY, lastValidBlockHeight: 9 } };
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const result = await prepareInstrumentInitialization(database as never, rpc, instrumentId, actor, {
    cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM
  });
  assert.equal(result.phase, "INITIALIZE");
  assert.equal(created[0]?.["operationType"], "INSTRUMENT_INITIALIZE");
  assert.equal(created[1]?.["event"], "INSTRUMENT_INITIALIZE_PREPARED");
});

test("finalizes initialization only after the exact transaction and Deploying PDA match", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const operationId = "00000000-0000-4000-8000-000000000004";
  const instrument = lifecycleInstrument(instrumentId, "DRAFT");
  const plan = await buildInstrumentInitialization({ programId: PROGRAM,
    instrumentId: Uint8Array.from(Buffer.from(instrumentId.replaceAll("-", ""), "hex")), administrator: KEY,
    bondMint: PROGRAM, settlementMint: KEY, complianceAuthority: KEY, corporateActionAuthority: KEY,
    faceValueMinor: instrument.faceValueMinor, couponRateBps: instrument.couponRateBps,
    paymentsPerYear: instrument.paymentsPerYear, issueAt: BigInt(Math.floor(instrument.issueAt.getTime() / 1000)),
    maturityAt: BigInt(Math.floor(instrument.maturityAt.getTime() / 1000)), totalSupply: 35n });
  const unsigned = serializeUnsignedInstructionsTransaction({ instructions: [plan.instruction], feePayer: KEY,
    recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 });
  const signed = Buffer.from(unsigned, "base64"); signed.fill(11, 1, 65);
  const signature = base58(signed.subarray(1, 65));
  const writes: Record<string, unknown>[] = [];
  const database = {
    blockchainTransaction: { findUnique: async () => ({ id: operationId, instrumentId,
      operationType: "INSTRUMENT_INITIALIZE", status: "PREPARED", signature: null, requiredSigner: KEY,
      networkGenesisHash: KEY, preparedTransactionBase64: unsigned,
      preparedPayload: { instrumentAddress: plan.instrumentAddress }, instrument }) },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; } },
      instrument: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; } },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return data; } }
    })
  };
  const rpc = { request: async (method: string) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "getTransaction") return { slot: 42, meta: { err: null }, transaction: [signed.toString("base64"), "base64"] };
    if (method === "getAccountInfo") return instrumentAccount(instrumentId, 0);
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const result = await confirmInstrumentInitialization(database as never, rpc, instrumentId, operationId, signature,
    { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
      correlationId: "00000000-0000-4000-8000-000000000003" },
    { cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
      expectedGenesisHash: KEY, programId: PROGRAM });
  assert.equal(result.nextPhase, "ACTIVATE");
  assert.equal(writes[1]?.["status"], "DEPLOYING");
  assert.equal(writes[2]?.["event"], "INSTRUMENT_INITIALIZED");
});

test("activation prepare rechecks eligibility and exact holder balances", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const wallets = [
    "9bHwb1ghrc3e1ntCyrgccNHVAppbtRJu1bAwHybjpAWK",
    "6heq5Nw2ErTWsaAYxWS8ZKtzorgpNdwNNeH4QMXWD3Bk",
    "C8LAzJwa6XyecAnjC9XkSHNm28M242qBSmacUytvBKb5"
  ];
  const plan = await buildInstrumentDistribution({ administrator: KEY, bondMint: PROGRAM,
    allocations: wallets.map((walletAddress, index) => ({ walletAddress, amount: [10n, 20n, 5n][index]! })) });
  const payload = { bondMint: PROGRAM, treasuryTokenAccount: plan.treasuryTokenAccount,
    allocations: plan.allocations.map((allocation, index) => ({
      investorId: `00000000-0000-4000-8000-00000000000${index + 5}`,
      walletAddress: allocation.walletAddress, tokenAccount: allocation.tokenAccount,
      amount: allocation.amount.toString()
    })) };
  const created: Record<string, unknown>[] = [];
  const database = {
    blockchainTransaction: { findFirst: async ({ where }: { where: { operationType: string; status?: string } }) => {
      if (where.operationType === "INSTRUMENT_ACTIVATE") return null;
      if (where.operationType === "INSTRUMENT_INITIALIZE") return { id: "initialize" };
      return { preparedPayload: payload };
    } },
    instrument: { findUnique: async () => lifecycleInstrument(instrumentId, "DEPLOYING") },
    wallet: { findMany: async () => payload.allocations.map(allocation => ({ address: allocation.walletAddress,
      network: "SOLANA_LOCALNET", status: "ACTIVE", verifiedAt: new Date(), revokedAt: null,
      investor: { id: allocation.investorId, status: "ACTIVE", eligibilityStatus: "ELIGIBLE" } })) },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data); return { id: "00000000-0000-4000-8000-000000000004" };
      } },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; } }
    })
  };
  let account = 0;
  const rpc = { request: async (method: string) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "getAccountInfo") {
      const allocation = payload.allocations[account++]!;
      return tokenAccount(PROGRAM, allocation.walletAddress, BigInt(allocation.amount));
    }
    if (method === "getLatestBlockhash") return { value: { blockhash: KEY, lastValidBlockHeight: 9 } };
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const result = await prepareInstrumentActivation(database as never, rpc, instrumentId, actor, {
    cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM
  });
  assert.equal(result.phase, "ACTIVATE");
  assert.equal((result as unknown as { allocations: unknown[] }).allocations.length, 3);
  assert.equal(created[0]?.["operationType"], "INSTRUMENT_ACTIVATE");
  assert.equal(created[1]?.["event"], "INSTRUMENT_ACTIVATION_PREPARED");
});

test("finalizes activation only after eligibility, balances, and Active PDA match", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const operationId = "00000000-0000-4000-8000-000000000004";
  const wallets = [
    "9bHwb1ghrc3e1ntCyrgccNHVAppbtRJu1bAwHybjpAWK",
    "6heq5Nw2ErTWsaAYxWS8ZKtzorgpNdwNNeH4QMXWD3Bk",
    "C8LAzJwa6XyecAnjC9XkSHNm28M242qBSmacUytvBKb5"
  ];
  const distribution = await buildInstrumentDistribution({ administrator: KEY, bondMint: PROGRAM,
    allocations: wallets.map((walletAddress, index) => ({ walletAddress, amount: [10n, 20n, 5n][index]! })) });
  const allocations = distribution.allocations.map((allocation, index) => ({
    investorId: `00000000-0000-4000-8000-00000000000${index + 5}`,
    walletAddress: allocation.walletAddress, tokenAccount: allocation.tokenAccount,
    amount: allocation.amount.toString()
  }));
  const activation = await buildInstrumentActivation({ programId: PROGRAM,
    instrumentId: Uint8Array.from(Buffer.from(instrumentId.replaceAll("-", ""), "hex")),
    issuerAuthority: KEY, bondMint: PROGRAM, holderTokenAccounts: allocations.map(row => row.tokenAccount) });
  const unsigned = serializeUnsignedInstructionsTransaction({ instructions: [activation.instruction], feePayer: KEY,
    recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9 });
  const signed = Buffer.from(unsigned, "base64"); signed.fill(13, 1, 65);
  const signature = base58(signed.subarray(1, 65));
  const instrument = lifecycleInstrument(instrumentId, "DEPLOYING");
  const writes: Record<string, unknown>[] = [];
  const database = {
    blockchainTransaction: { findUnique: async () => ({ id: operationId, instrumentId,
      operationType: "INSTRUMENT_ACTIVATE", status: "PREPARED", signature: null, requiredSigner: KEY,
      networkGenesisHash: KEY, preparedTransactionBase64: unsigned,
      preparedPayload: { instrumentAddress: activation.instrumentAddress, bondMint: PROGRAM,
        treasuryTokenAccount: distribution.treasuryTokenAccount, allocations }, instrument }) },
    wallet: { findMany: async () => allocations.map(allocation => ({ address: allocation.walletAddress,
      network: "SOLANA_LOCALNET", status: "ACTIVE", verifiedAt: new Date(), revokedAt: null,
      investor: { id: allocation.investorId, status: "ACTIVE", eligibilityStatus: "ELIGIBLE" } })) },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; } },
      instrument: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; } },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return data; } }
    })
  };
  let accountRead = -1;
  const rpc = { request: async (method: string) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "getTransaction") return { slot: 42, meta: { err: null }, transaction: [signed.toString("base64"), "base64"] };
    if (method === "getAccountInfo") {
      accountRead += 1;
      if (accountRead === 0) return instrumentAccount(instrumentId, 1);
      const allocation = allocations[accountRead - 1]!;
      return { context: { slot: 42 }, ...tokenAccount(PROGRAM, allocation.walletAddress, BigInt(allocation.amount)) };
    }
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const result = await confirmInstrumentActivation(database as never, rpc, instrumentId, operationId, signature,
    { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
      correlationId: "00000000-0000-4000-8000-000000000003" },
    { cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
      expectedGenesisHash: KEY, programId: PROGRAM });
  assert.equal(result.phase, "ACTIVATE");
  assert.equal(writes[1]?.["status"], "ACTIVE");
  assert.equal(writes[2]?.["event"], "INSTRUMENT_ACTIVATED");
});
