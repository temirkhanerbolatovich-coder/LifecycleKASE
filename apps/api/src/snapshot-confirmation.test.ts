import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import {
  buildSnapshotRegistrationInstruction,
  decodePublicKey,
  serializeUnsignedSnapshotRegistrationTransaction,
  type SolanaRpc
} from "@lifecycle-kase/solana-client";

import { SnapshotPreparationError } from "./snapshot-candidate.js";
import { confirmSnapshotRegistration } from "./snapshot-confirmation.js";

const ACTION_ID = "00000000-0000-4000-8000-000000000001";
const INSTRUMENT_ID = "00000000-0000-4000-8000-000000000002";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000003";
const OPERATION_ID = "00000000-0000-4000-8000-000000000004";
const ACTOR_ID = "00000000-0000-4000-8000-000000000005";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000006";
const KEY = "11111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const HASH = "ab".repeat(32);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  let number = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let encoded = "";
  while (number > 0n) {
    encoded = BASE58[Number(number % 58n)]! + encoded;
    number /= 58n;
  }
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingZeros += 1;
  }
  return "1".repeat(leadingZeros) + encoded;
}

function uuidBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

async function fixture(transactionResult: "finalized" | "missing" | "changed" = "finalized", transactionError: unknown = null) {
  const instruction = await buildSnapshotRegistrationInstruction({
    programId: PROGRAM,
    instrumentId: uuidBytes(INSTRUMENT_ID),
    actionId: uuidBytes(ACTION_ID),
    issuerAuthority: KEY,
    bondMint: MINT,
    snapshotHash: HASH,
    snapshotSlot: 101n,
    investorCount: 1,
    walletCount: 1,
    totalBalance: 10n,
    mintSupply: 10n
  });
  const unsigned = serializeUnsignedSnapshotRegistrationTransaction({
    instruction, feePayer: KEY, recentBlockhash: MINT, lastValidBlockHeight: 200
  });
  const signed = Buffer.from(unsigned, "base64");
  signed.fill(7, 1, 65);
  if (transactionResult === "changed") signed[signed.length - 1]! ^= 1;
  const transactionSignature = encodeBase58(signed.subarray(1, 65));
  const accountData = Buffer.alloc(160);
  createHash("sha256").update("account:CorporateAction").digest().copy(accountData, 0, 0, 8);
  let offset = 8;
  accountData[offset++] = 1;
  uuidBytes(ACTION_ID).copy(accountData, offset); offset += 16;
  Buffer.from(decodePublicKey(instruction.instrumentAddress)).copy(accountData, offset); offset += 32;
  offset += 1 + 8 + 8;
  accountData[offset++] = 0;
  accountData[offset++] = 0;
  Buffer.from(HASH, "hex").copy(accountData, offset); offset += 32;
  accountData.writeBigUInt64LE(101n, offset); offset += 8;
  accountData.writeUInt32LE(1, offset); offset += 4;
  accountData.writeUInt32LE(1, offset); offset += 4;
  accountData.writeBigUInt64LE(10n, offset); offset += 8;
  offset += 8 + 4 + 4;
  accountData[offset] = 2;
  const operation = {
    id: OPERATION_ID,
    corporateActionId: ACTION_ID,
    operationType: "REGISTER_SNAPSHOT",
    signature: null as string | null,
    status: "PREPARED",
    recentBlockhash: MINT,
    lastValidBlockHeight: 200n,
    corporateAction: {
      id: ACTION_ID,
      status: "SCHEDULED",
      instrument: {
        id: INSTRUMENT_ID, programId: PROGRAM, mintAddress: MINT, issuerAuthority: KEY
      },
      snapshot: {
        id: SNAPSHOT_ID,
        status: "PENDING_REGISTRATION",
        networkGenesisHash: KEY,
        snapshotHash: Buffer.from(HASH, "hex"),
        solanaSlot: 101n,
        investorCount: 1,
        walletCount: 1,
        totalBalance: 10n,
        mintSupply: 10n
      }
    }
  };
  const calls: { operation?: any; snapshot?: any; action?: any; audit?: any; unknown?: any } = {};
  const transaction = {
    blockchainTransaction: { updateMany: async (args: any) => { calls.operation = args; return { count: 1 }; } },
    snapshot: { updateMany: async (args: any) => { calls.snapshot = args; return { count: 1 }; } },
    corporateAction: { updateMany: async (args: any) => { calls.action = args; return { count: 1 }; } },
    auditLog: { create: async (args: any) => { calls.audit = args; return { id: "audit" }; } }
  };
  const database = {
    blockchainTransaction: {
      findUnique: async () => operation,
      updateMany: async (args: any) => { calls.unknown = args; return { count: 1 }; }
    },
    $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)
  } as unknown as PrismaClient;
  const methods: string[] = [];
  const rpc: SolanaRpc = {
    async request(method) {
      methods.push(method);
      if (method === "getGenesisHash") return KEY;
      if (method === "getTransaction") return transactionResult === "missing" ? null : {
        slot: 102,
        meta: { err: transactionError },
        transaction: [signed.toString("base64"), "base64"]
      };
      if (method === "getAccountInfo") return {
        context: { slot: 102 },
        value: { owner: PROGRAM, executable: false, data: [accountData.toString("base64"), "base64"] }
      };
      throw new Error("Unexpected RPC method " + method);
    }
  };
  return { database, rpc, calls, methods, transactionSignature, instruction, operation };
}

const actor = { id: ACTOR_ID, walletAddress: KEY, correlationId: CORRELATION_ID };

test("a finalized snapshot stays confirmable after calculation and review advance the application status", async () => {
  const setup = await fixture(); setup.operation.status = "FINALIZED"; setup.operation.signature = setup.transactionSignature;
  setup.operation.corporateAction.snapshot.status = "FINALIZED";
  for (const status of ["SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW", "RETURNED_FOR_REVISION", "APPROVED", "REJECTED"]) {
    setup.operation.corporateAction.status = status;
    const result = await confirmSnapshotRegistration(setup.database, setup.rpc, ACTION_ID, OPERATION_ID, setup.transactionSignature,
      actor, KEY, new Date()); assert.equal(result.status, "FINALIZED");
  }
  assert.deepEqual(setup.methods, []); assert.deepEqual(setup.calls, {});
});

test("finalizes database state only after the prepared transaction and Action PDA match", async () => {
  const setup = await fixture();
  const result = await confirmSnapshotRegistration(
    setup.database, setup.rpc, ACTION_ID, OPERATION_ID, setup.transactionSignature,
    actor, KEY, new Date("2026-09-30T10:04:00.000Z")
  );
  assert.equal(result.status, "FINALIZED");
  assert.equal(result.actionAddress, setup.instruction.actionAddress);
  assert.deepEqual(setup.methods, ["getGenesisHash", "getTransaction", "getAccountInfo"]);
  assert.equal(setup.calls.operation.data.status, "FINALIZED");
  assert.equal(setup.calls.snapshot.data.status, "FINALIZED");
  assert.equal(setup.calls.action.data.status, "SNAPSHOT_CREATED");
  assert.equal(setup.calls.audit.data.metadataJson.signature, setup.transactionSignature);
});

test("keeps an unavailable finalized transaction in unknown confirmation state", async () => {
  const setup = await fixture("missing");
  await assert.rejects(
    confirmSnapshotRegistration(
      setup.database, setup.rpc, ACTION_ID, OPERATION_ID, setup.transactionSignature,
      actor, KEY, new Date("2026-09-30T10:04:00.000Z")
    ),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "TRANSACTION_NOT_FINALIZED"
  );
  assert.equal(setup.calls.unknown.data.status, "UNKNOWN_CONFIRMATION");
  assert.equal(setup.calls.operation, undefined);
});

test("rejects a finalized transaction whose message differs from the prepared attempt", async () => {
  const setup = await fixture("changed");
  await assert.rejects(
    confirmSnapshotRegistration(
      setup.database, setup.rpc, ACTION_ID, OPERATION_ID, setup.transactionSignature,
      actor, KEY, new Date("2026-09-30T10:04:00.000Z")
    ),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "TRANSACTION_MISMATCH"
  );
  assert.equal(setup.methods.includes("getAccountInfo"), false);
  assert.equal(setup.calls.operation, undefined);
});

test("only the exact prepared transaction may mark a snapshot attempt failed", async () => {
  const failure = { InstructionError: [2, { Custom: 6000 }] };
  for (const message of ["changed", "finalized"] as const) {
    const setup = await fixture(message, failure);
    await assert.rejects(confirmSnapshotRegistration(setup.database, setup.rpc, ACTION_ID, OPERATION_ID,
      setup.transactionSignature, actor, KEY, new Date("2026-09-30T10:04:00.000Z")),
    (error: unknown) => error instanceof SnapshotPreparationError &&
      error.code === (message === "changed" ? "TRANSACTION_MISMATCH" : "TRANSACTION_FAILED"));
    assert.equal(setup.calls.unknown?.data.status, message === "changed" ? undefined : "FAILED");
    assert.equal(setup.calls.snapshot, undefined);
    assert.equal(setup.calls.action, undefined);
    assert.equal(setup.methods.includes("getAccountInfo"), false);
  }
});
