import { createHash } from "node:crypto";
import type { ActionReceipt, Prisma, PrismaClient } from "@prisma/client";
import { reconcileSettlementLegs } from "@lifecycle-kase/domain";
import { requireCouponExecutionCalculation } from "./entitlements.js";
import { rpcObject, TransactionWorkflowError, WORKFLOW_UUID } from "./transaction-workflow.js";

type Database = PrismaClient | Prisma.TransactionClient;
/** Explicit field order and investor sorting form the versioned canonical JSON contract. */
export async function couponReceiptDraft(database: Database, id: string) {
  const action = await requireCouponExecutionCalculation(database, id);
  if (action.entitlements.some(row => row.amountMinor > 0n && row.status !== "PAID")) {
    throw new TransactionWorkflowError("COUPON_INCOMPLETE", "Confirm every coupon payment before creating the final receipt");
  }
  const approval = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: "ACTION_APPROVAL", status: "FINALIZED" } });
  if (!approval?.signature) throw new TransactionWorkflowError("ONCHAIN_APPROVAL_REQUIRED", "Finalized approval evidence is missing");
  const items = [];
  for (const row of action.entitlements) {
    if (row.amountMinor === 0n) {
      items.push({ investorId: row.investorId, entitlementId: row.id, amountMinor: "0", status: row.status, settlement: null });
      continue;
    }
    const settlement = await database.settlement.findUnique({ where: { entitlementId: row.id }, include: { legs: { include: { blockchainTransaction: true } } } });
    const cash = settlement?.legs.find(leg => leg.type === "CASH");
    const asset = settlement?.legs.find(leg => leg.type === "ASSET");
    const op = cash?.blockchainTransaction;
    if (!settlement || settlement.status !== "FINALIZED" || settlement.reconciliationStatus !== "MATCHED" ||
        settlement.amountMinor !== row.amountMinor || settlement.actualAmountMinor !== row.amountMinor ||
        !cash?.required || asset?.required !== false || !op?.signature || op.status !== "FINALIZED" ||
        op.operationType !== "COUPON_PAYMENT" || op.entitlementId !== row.id || op.corporateActionId !== id ||
        op.networkGenesisHash !== action.snapshot!.networkGenesisHash || op.signature !== row.settlementSignature || row.burnSignature ||
        reconcileSettlementLegs("COUPON_PAYMENT", settlement.legs).status !== "MATCHED") {
      throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Payment, Cash/Asset Legs and finalized evidence must match");
    }
    const proof = rpcObject(op.preparedPayload);
    if (typeof proof["entitlementReceiptAddress"] !== "string" || typeof proof["executedAt"] !== "string" ||
        !/^[0-9]+$/.test(proof["executedAt"]) || !Number.isSafeInteger(proof["finalizedSlot"]) || Number(proof["finalizedSlot"]) < 0) {
      throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Finalized receipt address, clock and slot evidence are missing");
    }
    items.push({ investorId: row.investorId, entitlementId: row.id, amountMinor: row.amountMinor.toString(), status: "PAID",
      settlement: { receiver: row.settlementWalletAddress, signature: op.signature, receiptAddress: proof["entitlementReceiptAddress"],
        executedAt: proof["executedAt"], finalizedSlot: proof["finalizedSlot"], cashLeg: "CONFIRMED", assetLeg: "NOT_APPLICABLE", reconciliation: "MATCHED" } });
  }
  const payload = { schemaVersion: "coupon-action-receipt-v1", actionId: id, instrumentId: action.instrumentId,
    ticker: action.instrument.ticker, actionType: "COUPON_PAYMENT", programId: action.instrument.programId,
    network: action.instrument.network, genesisHash: action.snapshot!.networkGenesisHash,
    source: { type: action.sourceType, reference: action.sourceReference, document: action.sourceDocument },
    approval: { actorId: action.approvedById, approvedAt: action.approvedAt!.toISOString(), note: action.reviewNote, signature: approval.signature },
    snapshot: { hash: Buffer.from(action.snapshot!.snapshotHash).toString("hex"), slot: action.snapshot!.solanaSlot.toString(),
      plannedRecordAt: action.recordAt.toISOString(), effectiveBlockTime: action.snapshot!.blockTime.toISOString() },
    executeAt: action.executeAt.toISOString(), totalAmountMinor: action.totalEntitlementMinor.toString(),
    reconciliation: "MATCHED", entitlements: items };
  const json = JSON.stringify(payload);
  return { payload: JSON.parse(json) as Prisma.InputJsonObject, hash: createHash("sha256").update(json).digest("hex"), json };
}

export function assertCouponReceiptIntegrity(receipt: Pick<ActionReceipt, "payloadHash" | "payloadJson">, draft: Pick<Awaited<ReturnType<typeof couponReceiptDraft>>, "hash" | "payload">) {
  if (draft.hash !== Buffer.from(receipt.payloadHash).toString("hex") ||
      !receipt.payloadJson || typeof receipt.payloadJson !== "object") {
    throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Receipt hash differs from the confirmed settlement evidence");
  }
  // Compare values independently of jsonb key order.
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equal(value, b[i]));
    const left = a as Record<string, unknown>; const right = b as Record<string, unknown>;
    return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => equal(left[key], right[key]));
  };
  if (!equal(receipt.payloadJson, draft.payload)) throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Receipt payload was changed");
}

export async function getCouponReceipt(database: PrismaClient, id: string) {
  if (!WORKFLOW_UUID.test(id)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action UUID is invalid", 400);
  const receipt = await database.actionReceipt.findUnique({ where: { corporateActionId: id } });
  if (!receipt) throw new TransactionWorkflowError("RECEIPT_NOT_READY", "The action receipt is available after all payments are reconciled", 404);
  // PostgreSQL jsonb reorders keys; rebuilding the canonical field order verifies the saved hash.
  const draft = await couponReceiptDraft(database, id);
  assertCouponReceiptIntegrity(receipt, draft);
  const confirmation = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: "COUPON_FINALIZE", status: "FINALIZED" } });
  return { actionId: id, status: receipt.status, payload: draft.payload, canonicalJson: draft.json, sha256: draft.hash,
    onchainPda: receipt.onchainPda, finalizedAt: receipt.finalizedAt?.toISOString() ?? null, signature: confirmation?.signature ?? null };
}
