import assert from "node:assert/strict";
import test from "node:test";

import { InstrumentDeploymentError, instrumentDeploymentOptions, prepareInstrumentMintSetup } from "./instrument-deployment.js";

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
