import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshotRegistrationInstruction, serializeUnsignedSnapshotRegistrationTransaction } from "@lifecycle-kase/solana-client";
import { preparedSnapshot, unsignedTransactionBytes } from "../apps/web/.test-dist/snapshot-workflow.js";
import { buildCouponFunding, serializeUnsignedInstructionsTransaction } from "@lifecycle-kase/solana-client";
import { preparedCouponFunding } from "../apps/web/.test-dist/coupon-workflow.js";

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

test("web accepts exact backend funding bytes and resumes a signed attempt after its deficit is covered", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const issuer = "So11111111111111111111111111111111111111112";
  const mint = "11111111111111111111111111111111";
  const plan = await buildCouponFunding({ issuer, settlementMint: mint, amountMinor: 1_750_000_000n });
  const wire = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: issuer, recentBlockhash: mint, lastValidBlockHeight: 10 });
  const budget = { corporateActionId: id, actionVersion: 6, cluster: "localnet", requiredSigner: issuer, networkGenesisHash: issuer,
    snapshotHash: "ab".repeat(32), settlementMint: mint, treasuryTokenAccount: plan.treasury, totalCouponMinor: "1750000000", deficitMinor: "1750000000" };
  const payload = { ...budget, operationId: id, phase: "COUPON_FUNDING", amountMinor: "1750000000", lastValidBlockHeight: 10,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", serializedTransactionBase64: wire, status: "PREPARED", signature: null };
  assert.equal(preparedCouponFunding(payload, budget, issuer).serializedTransactionBase64, wire);
  assert.equal(preparedCouponFunding({ ...payload, status: "FINALIZED", signature: "already-signed" }, { ...budget, deficitMinor: "0", actionVersion: 7 }, issuer).serializedTransactionBase64, wire);
});
