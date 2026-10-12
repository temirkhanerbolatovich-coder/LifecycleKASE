import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { buildInstrumentActivation, buildInstrumentDistribution, buildInstrumentInitialization, decodePublicKey, encodePublicKey, serializeUnsignedInstructionsTransaction,
  buildInstrumentMintSetup, buildControlledMintSetup, buildControlledInstrumentInitialization,
  deriveControlledPolicyAddress, deriveControlledHoldingAddress, TOKEN_2022_PROGRAM_ID } from "@lifecycle-kase/solana-client";

import { confirmInstrumentActivation, confirmInstrumentDistribution, confirmInstrumentInitialization, InstrumentDeploymentError, instrumentDeploymentOptions,
  prepareInstrumentActivation, prepareInstrumentDistribution, prepareInstrumentInitialization,
  prepareInstrumentMintSetup, confirmInstrumentMintSetup, submitInstrumentDeployment, verifyControlledMint } from "./instrument-deployment.js";
import { CONTROLLED_TOKEN_POLICY, ControlledRegistryError, controlledRegistryEnabled, requireControlledRegistry } from "./controlled-policy.js";

const KEY = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";

test("controlled registry fails closed unless explicitly enabled for the Localnet candidate", () => {
  const controlled = { tokenPolicy: CONTROLLED_TOKEN_POLICY };
  assert.equal(controlledRegistryEnabled({}), false);
  assert.equal(controlledRegistryEnabled({ CONTROLLED_REGISTRY_ENABLED: "false" }), false);
  assert.equal(controlledRegistryEnabled({ CONTROLLED_REGISTRY_ENABLED: "true" }), true);
  assert.throws(() => controlledRegistryEnabled({ CONTROLLED_REGISTRY_ENABLED: "1" }), ControlledRegistryError);
  assert.equal(requireControlledRegistry({}, { cluster: "devnet", programId: KEY }), false);
  assert.equal(requireControlledRegistry(controlled, { cluster: "localnet", programId: PROGRAM, controlledRegistryEnabled: true }), true);
  for (const options of [
    { cluster: "localnet" as const, programId: PROGRAM },
    { cluster: "devnet" as const, programId: PROGRAM, controlledRegistryEnabled: true },
    { cluster: "localnet" as const, programId: KEY, controlledRegistryEnabled: true }
  ]) assert.throws(() => requireControlledRegistry(controlled, options), ControlledRegistryError);
  assert.throws(() => requireControlledRegistry({ tokenPolicy: "unknown" }, { cluster: "localnet", programId: PROGRAM }),
    (error: unknown) => error instanceof ControlledRegistryError && error.code === "INSTRUMENT_TOKEN_POLICY_INVALID");
});

test("disabled controlled registry cannot resume any saved issuance signature", async () => {
  const id = "00000000-0000-4000-8000-000000000002";
  const actor = { id, walletAddress: KEY, correlationId: id };
  const database = { blockchainTransaction: { findFirst: async () => ({ id, status: "UNKNOWN_CONFIRMATION", signature: "2".repeat(64),
    requiredSigner: KEY, instrument: { tokenPolicy: CONTROLLED_TOKEN_POLICY }, preparedTransactionBase64: "original-wire",
    networkGenesisHash: KEY, recentBlockhash: KEY, lastValidBlockHeight: 9n }) } };
  const rpc = { request: async () => { throw new Error("Disabled controlled attempt must not reach RPC"); } };
  const options = { cluster: "localnet" as const, rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000, expectedGenesisHash: KEY, programId: PROGRAM };
  for (const prepare of [
    () => prepareInstrumentMintSetup(database as never, rpc, id, actor, options),
    () => prepareInstrumentInitialization(database as never, rpc, id, actor, options),
    () => prepareInstrumentActivation(database as never, rpc, id, actor, options),
    () => prepareInstrumentDistribution(database as never, rpc, id, actor, options, { allocations: [
      { walletAddress: KEY, amount: "10" }, { walletAddress: PROGRAM, amount: "20" },
      { walletAddress: "9bHwb1ghrc3e1ntCyrgccNHVAppbtRJu1bAwHybjpAWK", amount: "5" }
    ] })
  ]) await assert.rejects(prepare(), (error: unknown) => error instanceof ControlledRegistryError && error.code === "CONTROLLED_REGISTRY_DISABLED");
});

function controlledMint(authority: string, supply: bigint, mintAuthority?: string): Buffer {
  const data = Buffer.alloc(207); data.writeUInt32LE(mintAuthority ? 1 : 0, 0);
  if (mintAuthority) Buffer.from(decodePublicKey(mintAuthority)).copy(data, 4);
  data.writeBigUInt64LE(supply, 36); data[45] = 1; data.writeUInt32LE(1, 46);
  Buffer.from(decodePublicKey(authority)).copy(data, 50); data[165] = 1;
  data.writeUInt16LE(12, 166); data.writeUInt16LE(32, 168);
  Buffer.from(decodePublicKey(authority)).copy(data, 170);
  data.writeUInt16LE(6, 202); data.writeUInt16LE(1, 204); data[206] = 2;
  return data;
}

test("controlled mint verification rejects unlocked authority, default state, extra TLV and supply drift", () => {
  const valid = controlledMint(KEY, 35n);
  verifyControlledMint(valid, { supply: 35n, instrumentAuthority: KEY });
  for (const [offset, value] of [[46, 0], [50, 0], [206, 1], [202, 9], [165, 2], [36, 34], [82, 1], [0, 1]] as const) {
    const changed = Buffer.from(valid); changed[offset] = value;
    assert.throws(() => verifyControlledMint(changed, { supply: 35n, instrumentAuthority: KEY }), InstrumentDeploymentError);
  }
  assert.throws(() => verifyControlledMint(Buffer.concat([valid, Buffer.alloc(4)]), { supply: 35n, instrumentAuthority: KEY }), InstrumentDeploymentError);
});

test("controlled issuance advances mint-zero → initialize → frozen 10/20/5 distribution → activate with finalized readbacks", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const options = { cluster: "localnet" as const, rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM, controlledRegistryEnabled: true };
  const instrument = { ...lifecycleInstrument(instrumentId, "DRAFT"), tokenPolicy: CONTROLLED_TOKEN_POLICY, version: 0,
    mintAddress: null as string | null, circulatingSupply: 0n, programId: null as string | null,
    settlementAssetId: "00000000-0000-4000-8000-000000000004", settlementAsset: { mintAddress: null as string | null } };
  const instrumentBytes = Uint8Array.from(Buffer.from(instrumentId.replaceAll("-", ""), "hex"));
  const setup = await buildControlledMintSetup({ programId: PROGRAM, instrumentId: instrumentBytes, administrator: KEY,
    bondRentLamports: 2_000_000n, settlementRentLamports: 1_500_000n, totalSupply: 35n });
  const walletAddresses = ["9bHwb1ghrc3e1ntCyrgccNHVAppbtRJu1bAwHybjpAWK",
    "6heq5Nw2ErTWsaAYxWS8ZKtzorgpNdwNNeH4QMXWD3Bk", "C8LAzJwa6XyecAnjC9XkSHNm28M242qBSmacUytvBKb5"];
  const wallets = walletAddresses.map((address, index) => ({ address, network: "SOLANA_LOCALNET", status: "ACTIVE",
    verifiedAt: new Date(), revokedAt: null, investor: { id: `00000000-0000-4000-8000-00000000000${index + 5}`,
      status: "ACTIVE", eligibilityStatus: "ELIGIBLE" } }));
  const requested = { allocations: walletAddresses.map((walletAddress, index) => ({ walletAddress, amount: ["10", "20", "5"][index]! })) };
  const distribution = await buildInstrumentDistribution({ administrator: KEY, bondMint: setup.bondMint,
    allocations: requested.allocations.map(row => ({ walletAddress: row.walletAddress, amount: BigInt(row.amount) })) });
  const operations: Record<string, any>[] = []; const audits: Record<string, any>[] = []; const accounts = new Map<string, unknown>();
  const reads: readonly unknown[][] = [];
  const accountResponse = (data: Buffer, owner = TOKEN_2022_PROGRAM_ID) => ({ context: { slot: 42 },
    value: { owner, executable: false, data: [data.toString("base64"), "base64"] } });
  const token = (mint: string, wallet: string, amount: bigint) => {
    const data = Buffer.alloc(170); Buffer.from(decodePublicKey(mint)).copy(data, 0);
    Buffer.from(decodePublicKey(wallet)).copy(data, 32); data.writeBigUInt64LE(amount, 64); data[108] = 2;
    data[165] = 2; data.writeUInt16LE(7, 166); return accountResponse(data);
  };
  const sidecar = (name: string, keys: readonly string[], trailing: Buffer) => {
    const data = Buffer.concat([createHash("sha256").update(`account:${name}`).digest().subarray(0, 8), Buffer.from([1]),
      ...keys.map(key => Buffer.from(decodePublicKey(key))), trailing]); return accountResponse(data, PROGRAM);
  };
  const database = {
    instrument: { findUnique: async () => instrument }, wallet: { findMany: async () => wallets },
    blockchainTransaction: {
      findFirst: async ({ where }: any) => operations.find(row => row.operationType === where.operationType &&
        (typeof where.status === "string" ? row.status === where.status : where.status.in.includes(row.status))) ?? null,
      findUnique: async ({ where }: any) => operations.find(row => row.id === where.id)
    },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: {
        create: async ({ data }: any) => { const row = { ...data, id: `00000000-0000-4000-8000-0000000000${String(10 + operations.length).padStart(2, "0")}`,
          signature: null, instrument }; operations.push(row); return row; },
        updateMany: async ({ where, data }: any) => { Object.assign(operations.find(row => row.id === where.id)!, data); return { count: 1 }; }
      },
      instrument: { updateMany: async ({ where, data }: any) => {
        assert.equal(where.status, instrument.status); if (where.circulatingSupply !== undefined) assert.equal(where.circulatingSupply, instrument.circulatingSupply);
        Object.assign(instrument, { ...data, version: instrument.version + 1 }); return { count: 1 };
      } },
      settlementAsset: { updateMany: async ({ data }: any) => { Object.assign(instrument.settlementAsset, data); return { count: 1 }; } },
      auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } }
    })
  };
  const rpc = { request: async (method: string, params: readonly unknown[]) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "getMinimumBalanceForRentExemption") return params[0] === 207 ? 2_000_000 : 1_500_000;
    if (method === "getLatestBlockhash") return { value: { blockhash: KEY, lastValidBlockHeight: 99 } };
    if (method === "getAccountInfo") { (reads as unknown[][]).push([...params]); return accounts.get(String(params[0])) ?? { context: { slot: 42 }, value: null }; }
    if (method === "getTransaction") { const op = operations.find(row => row.signature === params[0]); return { slot: 42, meta: { err: null }, transaction: [op!.signed, "base64"] }; }
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const signPrepared = (prepared: { operationId: string; serializedTransactionBase64: string }) => {
    const operation = operations.find(row => row.id === prepared.operationId)!;
    const signed = Buffer.from(prepared.serializedTransactionBase64, "base64"); signed.fill(23 + operations.indexOf(operation), 1, 65);
    operation.signature = base58(signed.subarray(1, 65)); operation.signed = signed.toString("base64"); return operation.signature as string;
  };
  const mintPrepared = await prepareInstrumentMintSetup(database as never, rpc, instrumentId, actor, options);
  assert.equal(mintPrepared.serializedTransactionBase64, serializeUnsignedInstructionsTransaction({ instructions: setup.instructions, feePayer: KEY, recentBlockhash: KEY, lastValidBlockHeight: 99 }));
  accounts.set(setup.bondMint, accountResponse(controlledMint(setup.instrumentAuthority, 0n, KEY)));
  const settlement = Buffer.alloc(82); settlement.writeUInt32LE(1, 0); Buffer.from(decodePublicKey(KEY)).copy(settlement, 4); settlement[44] = 6; settlement[45] = 1;
  accounts.set(setup.settlementMint, accountResponse(settlement)); accounts.set(setup.treasuryTokenAccount, token(setup.bondMint, KEY, 0n));
  const mintResult = await confirmInstrumentMintSetup(database as never, rpc, instrumentId, mintPrepared.operationId, signPrepared(mintPrepared), actor, options);
  assert.equal(mintResult.nextPhase, "INITIALIZE"); assert.equal(instrument.circulatingSupply, 0n);
  await assert.rejects(prepareInstrumentDistribution(database as never, rpc, instrumentId, actor, options, requested),
    (error: unknown) => error instanceof InstrumentDeploymentError && error.code === "DISTRIBUTION_NOT_AVAILABLE");
  const initialized = await prepareInstrumentInitialization(database as never, rpc, instrumentId, actor, options);
  const initialization = await buildControlledInstrumentInitialization({ programId: PROGRAM, instrumentId: instrumentBytes,
    administrator: KEY, bondMint: setup.bondMint, settlementMint: setup.settlementMint, complianceAuthority: KEY,
    corporateActionAuthority: KEY, faceValueMinor: instrument.faceValueMinor, couponRateBps: instrument.couponRateBps,
    paymentsPerYear: instrument.paymentsPerYear, issueAt: BigInt(instrument.issueAt.getTime() / 1000),
    maturityAt: BigInt(instrument.maturityAt.getTime() / 1000), totalSupply: 35n });
  assert.equal(initialized.serializedTransactionBase64, serializeUnsignedInstructionsTransaction({ instructions: initialization.instructions, feePayer: KEY, recentBlockhash: KEY, lastValidBlockHeight: 99 }));
  const chainInstrument = () => { const result = instrumentAccount(instrumentId, 0); const data = Buffer.from(result.value.data[0]!, "base64"); data[8] = 2;
    Buffer.from(decodePublicKey(setup.bondMint)).copy(data, 121); Buffer.from(decodePublicKey(setup.settlementMint)).copy(data, 153); return accountResponse(data, PROGRAM); };
  accounts.set(setup.instrumentAddress, chainInstrument());
  const policyAddress = await deriveControlledPolicyAddress(PROGRAM, setup.instrumentAddress);
  accounts.set(policyAddress, sidecar("ControlledPolicy", [setup.instrumentAddress, setup.bondMint, "11111111111111111111111111111111", "11111111111111111111111111111111"], Buffer.alloc(1)));
  accounts.set(setup.bondMint, accountResponse(controlledMint(setup.instrumentAuthority, 35n)));
  accounts.set(setup.treasuryTokenAccount, token(setup.bondMint, KEY, 35n));
  const initResult = await confirmInstrumentInitialization(database as never, rpc, instrumentId, initialized.operationId, signPrepared(initialized), actor, options);
  assert.equal(initResult.nextPhase, "DISTRIBUTION"); assert.equal(instrument.status, "DEPLOYING"); assert.equal(instrument.circulatingSupply, 0n);
  const distributed = await prepareInstrumentDistribution(database as never, rpc, instrumentId, actor, options, requested);
  assert.ok(Buffer.from(distributed.serializedTransactionBase64, "base64").length <= 1232);
  accounts.set(setup.treasuryTokenAccount, token(setup.bondMint, KEY, 0n));
  for (const row of [{ tokenAccount: setup.treasuryTokenAccount, walletAddress: KEY, amount: 0n }, ...distribution.allocations]) {
    accounts.set(row.tokenAccount, token(setup.bondMint, row.walletAddress, row.amount));
    accounts.set(await deriveControlledHoldingAddress(PROGRAM, setup.instrumentAddress, row.tokenAccount),
      sidecar("ControlledHolding", [setup.instrumentAddress, setup.bondMint, row.tokenAccount, row.walletAddress], Buffer.alloc(9)));
  }
  const distributionSignature = signPrepared(distributed);
  accounts.set(distribution.allocations[0]!.tokenAccount, token(setup.bondMint, KEY, 10n));
  await assert.rejects(confirmInstrumentDistribution(database as never, rpc, instrumentId, distributed.operationId, distributionSignature, actor, options), InstrumentDeploymentError);
  assert.equal(instrument.circulatingSupply, 0n, "Wrong holder must not finalize the projection");
  accounts.set(distribution.allocations[0]!.tokenAccount, token(setup.bondMint, walletAddresses[0]!, 10n));
  const distResult = await confirmInstrumentDistribution(database as never, rpc, instrumentId, distributed.operationId, distributionSignature, actor, options);
  assert.equal(distResult.nextPhase, "ACTIVATE"); assert.equal(instrument.circulatingSupply, 35n);
  const activated = await prepareInstrumentActivation(database as never, rpc, instrumentId, actor, options);
  const active = chainInstrument(); const activeBytes = Buffer.from(active.value.data[0]!, "base64"); activeBytes[222] = 1;
  accounts.set(setup.instrumentAddress, accountResponse(activeBytes, PROGRAM));
  const activationSignature = signPrepared(activated);
  const holdingAddress = await deriveControlledHoldingAddress(PROGRAM, setup.instrumentAddress, distribution.allocations[0]!.tokenAccount);
  const validHolding = accounts.get(holdingAddress); accounts.delete(holdingAddress);
  await assert.rejects(confirmInstrumentActivation(database as never, rpc, instrumentId, activated.operationId, activationSignature, actor, options), InstrumentDeploymentError);
  assert.equal(instrument.status, "DEPLOYING"); accounts.set(holdingAddress, validHolding);
  assert.equal((await confirmInstrumentActivation(database as never, rpc, instrumentId, activated.operationId, activationSignature, actor, options)).status, "FINALIZED");
  assert.equal(instrument.status, "ACTIVE"); assert.equal(operations.length, 4);
  assert.ok(reads.some(params => (params[1] as Record<string, unknown>)["minContextSlot"] === 42));
  assert.equal(audits.at(-1)!["event"], "INSTRUMENT_ACTIVATED");
});

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

test("broadcasts only the exact Ed25519-signed prepared transaction through Localnet", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const operationId = "00000000-0000-4000-8000-000000000004";
  const keypair = generateKeyPairSync("ed25519");
  const publicDer = keypair.publicKey.export({ type: "spki", format: "der" });
  const signer = encodePublicKey(publicDer.subarray(-32));
  const unsigned = serializeUnsignedInstructionsTransaction({ instructions: [{
    programId: PROGRAM,
    accounts: [{ address: signer, isSigner: true, isWritable: true }],
    data: Uint8Array.from([1])
  }], feePayer: signer, recentBlockhash: KEY, lastValidBlockHeight: 9 });
  const signed = Buffer.from(unsigned, "base64");
  sign(null, signed.subarray(65), keypair.privateKey).copy(signed, 1);
  const expectedSignature = base58(signed.subarray(1, 65));
  const audit: Record<string, unknown>[] = [];
  let sent = 0;
  const operation = { id: operationId, operationType: "INSTRUMENT_MINT_SETUP", status: "PREPARED",
    signature: null, preparedTransactionBase64: unsigned, requiredSigner: signer, networkGenesisHash: KEY,
    instrument: { id: instrumentId, issuerAuthority: signer } };
  const database = {
    blockchainTransaction: { findUnique: async () => operation, updateMany: async () => ({ count: 1 }) },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { updateMany: async () => ({ count: 1 }) },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audit.push(data); return data; } }
    })
  };
  const rpc = { request: async (method: string, params: readonly unknown[]) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "sendTransaction") {
      sent += 1;
      assert.equal(params[0], signed.toString("base64"));
      return expectedSignature;
    }
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: signer,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const options = { cluster: "localnet" as const, rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM };
  const result = await submitInstrumentDeployment(database as never, rpc, instrumentId, operationId,
    "MINT_SETUP", signed.toString("base64"), actor, options);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(result.signature, expectedSignature);
  assert.equal(sent, 1);
  assert.equal(audit[0]?.["event"], "INSTRUMENT_TRANSACTION_SUBMISSION_REQUESTED");

  const changed = Buffer.from(signed); changed[changed.length - 1]! ^= 1;
  await assert.rejects(submitInstrumentDeployment(database as never, rpc, instrumentId, operationId,
    "MINT_SETUP", changed.toString("base64"), actor, options),
  (error: unknown) => error instanceof InstrumentDeploymentError && error.code === "SIGNED_TRANSACTION_INVALID");
  assert.equal(sent, 1);
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

test("distinguishes pending confirmation from unavailable history without finalizing or replacing a signature", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const operationId = "00000000-0000-4000-8000-000000000004";
  const signature = "2".repeat(64);
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const options = { cluster: "localnet" as const, rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM };
  for (const [status, validBlockhash, expectedCode] of [
    [null, true, "TRANSACTION_NOT_FINALIZED"],
    [{ confirmationStatus: "confirmed" }, false, "TRANSACTION_NOT_FINALIZED"],
    [{ confirmationStatus: "finalized" }, false, "TRANSACTION_HISTORY_UNAVAILABLE"],
    [null, false, "TRANSACTION_UNAVAILABLE"]
  ] as const) {
    const writes: Record<string, unknown>[] = [];
    const database = { blockchainTransaction: {
      findUnique: async () => ({ id: operationId, operationType: "INSTRUMENT_MINT_SETUP", status: "SUBMITTED",
        signature, preparedTransactionBase64: "stored-wire", requiredSigner: KEY, networkGenesisHash: KEY,
        recentBlockhash: KEY, instrument: { id: instrumentId, issuerAuthority: KEY } }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        assert.deepEqual(where["OR"], [{ signature: null }, { signature }]);
        writes.push(data); return { count: 1 };
      }
    } };
    const rpc = { request: async (method: string) => {
      if (method === "getGenesisHash") return KEY;
      if (method === "getTransaction") return null;
      if (method === "getSignatureStatuses") return { value: [status] };
      if (method === "isBlockhashValid") return { value: validBlockhash };
      throw new Error(`unexpected RPC method ${method}`);
    } };
    await assert.rejects(confirmInstrumentMintSetup(database as never, rpc, instrumentId, operationId,
      signature, actor, options), (error: unknown) => error instanceof InstrumentDeploymentError && error.code === expectedCode);
    assert.deepEqual(writes, [{ signature, status: "UNKNOWN_CONFIRMATION", lastErrorCode: expectedCode }]);
  }
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

test("expires an unobserved UNKNOWN_CONFIRMATION after its blockhash lifetime and prepares a fresh attempt", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const expired = { id: "00000000-0000-4000-8000-000000000004", status: "UNKNOWN_CONFIRMATION",
    signature: "2".repeat(64), preparedTransactionBase64: Buffer.alloc(200).toString("base64"),
    requiredSigner: KEY, networkGenesisHash: KEY, recentBlockhash: KEY, lastValidBlockHeight: 9n };
  const writes: Record<string, unknown>[] = [];
  let reads = 0;
  const database = {
    blockchainTransaction: {
      findFirst: async () => ++reads === 1 ? expired : null,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; }
    },
    instrument: { findUnique: async () => ({ id: instrumentId, status: "DRAFT", mintAddress: null,
      issuerAuthority: KEY, totalSupply: 35n, circulatingSupply: 0n, settlementAsset: { mintAddress: null } }) },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { create: async () => ({ id: "00000000-0000-4000-8000-000000000005" }) },
      auditLog: { create: async () => ({}) }
    })
  };
  const rpc = { request: async (method: string, params: readonly unknown[]) => {
    if (method === "getBlockHeight") return 10;
    if (method === "getSignatureStatuses") return { value: [null] };
    if (method === "getGenesisHash") return KEY;
    if (method === "getMinimumBalanceForRentExemption") return params[0] === 202 ? 2_000_000 : 1_500_000;
    if (method === "getAccountInfo") return { value: null };
    if (method === "getLatestBlockhash") return { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 20 } };
    throw new Error(`unexpected RPC method ${method}`);
  } };

  const result = await prepareInstrumentMintSetup(database as never, rpc, instrumentId, actor, {
    cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM
  });

  assert.equal(result.operationId, "00000000-0000-4000-8000-000000000005");
  assert.equal(result.resumed, false);
  assert.deepEqual(writes, [{ status: "FAILED", lastErrorCode: "BLOCKHASH_EXPIRED_UNCONFIRMED" }]);
});

test("never resumes a prepared attempt from an earlier Localnet genesis", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const stale = { id: "00000000-0000-4000-8000-000000000004", status: "PREPARED",
    signature: null, preparedTransactionBase64: Buffer.alloc(200).toString("base64"),
    requiredSigner: KEY, networkGenesisHash: PROGRAM, recentBlockhash: KEY, lastValidBlockHeight: 9_999n };
  const writes: Record<string, unknown>[] = [];
  let reads = 0;
  const database = {
    blockchainTransaction: {
      findFirst: async () => ++reads === 1 ? stale : null,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; }
    },
    instrument: { findUnique: async () => ({ id: instrumentId, status: "DRAFT", mintAddress: null,
      issuerAuthority: KEY, totalSupply: 35n, circulatingSupply: 0n, settlementAsset: { mintAddress: null } }) },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      blockchainTransaction: { create: async () => ({ id: "00000000-0000-4000-8000-000000000005" }) },
      auditLog: { create: async () => ({}) }
    })
  };
  const rpc = { request: async (method: string, params: readonly unknown[]) => {
    if (method === "getBlockHeight") throw new Error("stale genesis must be rejected before height lookup");
    if (method === "getGenesisHash") return KEY;
    if (method === "getMinimumBalanceForRentExemption") return params[0] === 202 ? 2_000_000 : 1_500_000;
    if (method === "getAccountInfo") return { value: null };
    if (method === "getLatestBlockhash") return { value: { blockhash: KEY, lastValidBlockHeight: 20 } };
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const result = await prepareInstrumentMintSetup(database as never, rpc, instrumentId, actor, {
    cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM
  });
  assert.equal(result.operationId, "00000000-0000-4000-8000-000000000005");
  assert.equal(result.resumed, false);
  assert.deepEqual(writes, [{ status: "FAILED", lastErrorCode: "NETWORK_GENESIS_CHANGED" }]);
});

test("never replaces a signed attempt whose RPC history is unavailable", async () => {
  const database = { blockchainTransaction: { findFirst: async () => ({
    id: "00000000-0000-4000-8000-000000000004", status: "UNKNOWN_CONFIRMATION",
    signature: "2".repeat(64), lastErrorCode: "TRANSACTION_UNAVAILABLE",
    preparedTransactionBase64: "stored-wire", requiredSigner: KEY, networkGenesisHash: KEY,
    recentBlockhash: KEY, lastValidBlockHeight: 9n
  }) } };
  const rpc = { request: async () => { throw new Error("must stop before expiry or new account checks"); } };
  await assert.rejects(prepareInstrumentMintSetup(database as never, rpc,
    "00000000-0000-4000-8000-000000000002",
    { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
      correlationId: "00000000-0000-4000-8000-000000000003" },
    { cluster: "localnet", rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
      expectedGenesisHash: KEY, programId: PROGRAM }),
    (error: unknown) => error instanceof InstrumentDeploymentError && error.code === "TRANSACTION_HISTORY_UNAVAILABLE");
});

test("all deployment phases return the stored signed attempt for confirmation after blockhash expiry", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const operationId = "00000000-0000-4000-8000-000000000004";
  const signature = "2".repeat(64);
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const options = { cluster: "localnet" as const, rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM };
  const wallets = ["9bHwb1ghrc3e1ntCyrgccNHVAppbtRJu1bAwHybjpAWK",
    "6heq5Nw2ErTWsaAYxWS8ZKtzorgpNdwNNeH4QMXWD3Bk", "C8LAzJwa6XyecAnjC9XkSHNm28M242qBSmacUytvBKb5"];
  const allocations = wallets.map((walletAddress, index) => ({ walletAddress, tokenAccount: walletAddress,
    investorId: `00000000-0000-4000-8000-00000000000${index + 5}`, amount: ["10", "20", "5"][index]! }));
  for (const status of ["SUBMITTED", "UNKNOWN_CONFIRMATION"]) {
    for (const phase of ["MINT_SETUP", "DISTRIBUTION", "INITIALIZE", "ACTIVATE"] as const) {
      const stored = { id: operationId, status, signature, requiredSigner: KEY, networkGenesisHash: KEY,
        recentBlockhash: KEY, lastValidBlockHeight: 9n, preparedTransactionBase64: "persisted-wire",
        preparedPayload: { instrumentAddress: KEY, bondMint: PROGRAM, treasuryTokenAccount: KEY, allocations } };
      const database = { blockchainTransaction: { findFirst: async () => stored } };
      const rpc = { request: async (method: string) => {
        if (method === "getBlockHeight") return 10;
        if (method === "getSignatureStatuses") return { value: [{ confirmationStatus: "finalized", err: null }] };
        throw new Error(`resume must not prepare a new transaction: ${method}`);
      } };
      const result = phase === "MINT_SETUP" ? await prepareInstrumentMintSetup(database as never, rpc, instrumentId, actor, options)
        : phase === "DISTRIBUTION" ? await prepareInstrumentDistribution(database as never, rpc, instrumentId, actor, options, { allocations: allocations.map(({ walletAddress, amount }) => ({ walletAddress, amount })) })
        : phase === "INITIALIZE" ? await prepareInstrumentInitialization(database as never, rpc, instrumentId, actor, options)
        : await prepareInstrumentActivation(database as never, rpc, instrumentId, actor, options);
      assert.equal(result.operationId, operationId);
      assert.equal(result.resumed, true);
      assert.equal("signature" in result && result.signature, signature);
      assert.equal("status" in result && result.status, status);
      assert.equal(result.serializedTransactionBase64, stored.preparedTransactionBase64);
    }
  }
});

function tokenAccount(mint: string, owner: string, amount: bigint) {
  const data = Buffer.alloc(165);
  Buffer.from(decodePublicKey(mint)).copy(data, 0);
  Buffer.from(decodePublicKey(owner)).copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return { value: { owner: TOKEN_2022_PROGRAM_ID, executable: false, data: [data.toString("base64"), "base64"] } };
}

test("mint setup confirmation requires revoked bond authority and retained issuer KZT-Test authority", async () => {
  const instrumentId = "00000000-0000-4000-8000-000000000002";
  const operationId = "00000000-0000-4000-8000-000000000004";
  const actor = { id: "00000000-0000-4000-8000-000000000001", walletAddress: KEY,
    correlationId: "00000000-0000-4000-8000-000000000003" };
  const plan = await buildInstrumentMintSetup({ programId: PROGRAM,
    instrumentId: Uint8Array.from(Buffer.from(instrumentId.replaceAll("-", ""), "hex")), administrator: KEY,
    bondRentLamports: 1n, settlementRentLamports: 1n, totalSupply: 35n });
  const unsigned = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions,
    feePayer: KEY, recentBlockhash: KEY, lastValidBlockHeight: 9 });
  const signed = Buffer.from(unsigned, "base64"); signed.fill(7, 1, 65);
  const signature = base58(signed.subarray(1, 65));
  const bond = Buffer.alloc(202); bond.writeBigUInt64LE(35n, 36); bond[45] = 1;
  bond[165] = 1; bond.writeUInt16LE(12, 166); bond.writeUInt16LE(32, 168);
  Buffer.from(decodePublicKey(plan.instrumentAuthority)).copy(bond, 170);
  const settlement = Buffer.alloc(82); settlement.writeUInt32LE(1, 0);
  Buffer.from(decodePublicKey(KEY)).copy(settlement, 4); settlement[44] = 6; settlement[45] = 1;
  const operation = { id: operationId, operationType: "INSTRUMENT_MINT_SETUP", status: "SUBMITTED",
    preparedTransactionBase64: unsigned, requiredSigner: KEY, networkGenesisHash: KEY,
    instrument: { id: instrumentId, issuerAuthority: KEY, totalSupply: 35n, settlementAssetId: operationId } };
  let writes = 0;
  const database = { blockchainTransaction: { findUnique: async () => operation },
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => {
      writes += 1;
      const updateMany = async () => ({ count: 1 });
      return work({ blockchainTransaction: { updateMany }, instrument: { updateMany }, settlementAsset: { updateMany },
        auditLog: { create: async () => ({}) } });
    }
  };
  const rpc = { request: async (method: string, params: readonly unknown[]) => {
    if (method === "getGenesisHash") return KEY;
    if (method === "getTransaction") return { slot: 10, meta: { err: null }, transaction: [signed.toString("base64"), "base64"] };
    if (method === "getAccountInfo") {
      if (params[0] === plan.treasuryTokenAccount) return { context: { slot: 10 }, ...tokenAccount(plan.bondMint, KEY, 35n) };
      const data = params[0] === plan.bondMint ? bond : settlement;
      return { context: { slot: 10 }, value: { owner: TOKEN_2022_PROGRAM_ID, executable: false, data: [data.toString("base64"), "base64"] } };
    }
    throw new Error(`unexpected RPC method ${method}`);
  } };
  const options = { cluster: "localnet" as const, rpcEndpoint: "http://127.0.0.1:8899", rpcTimeoutMs: 15_000,
    expectedGenesisHash: KEY, programId: PROGRAM };
  assert.equal((await confirmInstrumentMintSetup(database as never, rpc, instrumentId, operationId, signature, actor, options)).status, "FINALIZED");
  assert.equal(writes, 1);
  for (const wrongAuthority of [null, PROGRAM]) {
    settlement.writeUInt32LE(wrongAuthority ? 1 : 0, 0);
    if (wrongAuthority) Buffer.from(decodePublicKey(wrongAuthority)).copy(settlement, 4);
    await assert.rejects(confirmInstrumentMintSetup(database as never, rpc, instrumentId, operationId, signature, actor, options),
      (error: unknown) => error instanceof InstrumentDeploymentError && error.code === "MINT_STATE_MISMATCH");
  }
  assert.equal(writes, 1, "Invalid settlement authority must never update projections");
});

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
