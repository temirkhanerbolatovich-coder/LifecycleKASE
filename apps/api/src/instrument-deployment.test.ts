import assert from "node:assert/strict";
import test from "node:test";

import { buildInstrumentDistribution, decodePublicKey, serializeUnsignedInstructionsTransaction,
  TOKEN_2022_PROGRAM_ID } from "@lifecycle-kase/solana-client";

import { confirmInstrumentDistribution, InstrumentDeploymentError, instrumentDeploymentOptions, prepareInstrumentDistribution,
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
