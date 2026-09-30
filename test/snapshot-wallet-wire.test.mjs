import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshotRegistrationInstruction, serializeUnsignedSnapshotRegistrationTransaction } from "@lifecycle-kase/solana-client";
import { preparedSnapshot, unsignedTransactionBytes } from "../apps/web/.test-dist/snapshot-workflow.js";

test("web accepts the actual backend snapshot serializer without changing its bytes", async () => {
  const actionId = "00000000-0000-4000-8000-000000000001";
  const issuer = "So11111111111111111111111111111111111111112";
  const programId = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
  const instruction = await buildSnapshotRegistrationInstruction({
    programId, instrumentId: new Uint8Array(16).fill(1), actionId: new Uint8Array(16).fill(2),
    issuerAuthority: issuer, bondMint: "11111111111111111111111111111111", snapshotHash: "ab".repeat(32),
    snapshotSlot: 101n, investorCount: 2, walletCount: 3, totalBalance: 35n, mintSupply: 35n
  });
  const serializedTransactionBase64 = serializeUnsignedSnapshotRegistrationTransaction({
    instruction, feePayer: issuer, recentBlockhash: issuer, lastValidBlockHeight: 200
  });
  const result = preparedSnapshot({ corporateActionId: actionId, operationId: actionId, snapshotId: actionId,
    cluster: "devnet", requiredSigner: issuer, programId, actionAddress: instruction.actionAddress,
    networkGenesisHash: issuer, snapshotHash: "ab".repeat(32), recordAt: "2026-09-30T10:00:00Z",
    effectiveBlockTime: "2026-09-30T10:01:00Z", effectiveSlot: "101", lastValidBlockHeight: 200,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", recordPointMode: "DEMO_CAPTURE_SLOT", serializedTransactionBase64
  }, actionId, issuer);
  assert.deepEqual(Buffer.from(unsignedTransactionBytes(result.serializedTransactionBase64)), Buffer.from(serializedTransactionBase64, "base64"));
});
