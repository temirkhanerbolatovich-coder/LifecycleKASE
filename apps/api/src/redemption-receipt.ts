import { createHash } from "node:crypto";
import type { Entitlement, Prisma, PrismaClient } from "@prisma/client";
import { reconcileSettlementLegs } from "@lifecycle-kase/domain";
import { requireRedemptionExecutionCalculation } from "./entitlements.js";
import { assertCouponReceiptIntegrity } from "./coupon-receipt.js";
import { redemptionRetiresInstrument } from "./redemption-sources.js";
import { rpcObject, TransactionWorkflowError, WORKFLOW_UUID } from "./transaction-workflow.js";

type Database = PrismaClient | Prisma.TransactionClient;
type SettlementEvidence = Prisma.SettlementGetPayload<{ include: { legs: { include: { blockchainTransaction: true } } } }>;

export function requireAtomicRedemptionSettlement(action: { id: string; type: "EARLY_REDEMPTION" | "BOND_REDEMPTION" | "COUPON_PAYMENT" },
  genesis: string, row: Pick<Entitlement, "id" | "amountMinor" | "tokensToRedeem" | "settlementSignature" | "burnSignature">, settlement: SettlementEvidence | null) {
  const cash = settlement?.legs.find(leg => leg.type === "CASH");
  const asset = settlement?.legs.find(leg => leg.type === "ASSET");
  const op = cash?.blockchainTransaction;
  if (action.type === "COUPON_PAYMENT" || !settlement || settlement.status !== "FINALIZED" || settlement.reconciliationStatus !== "MATCHED" ||
      settlement.amountMinor !== row.amountMinor || settlement.actualAmountMinor !== row.amountMinor || !cash?.required || !asset?.required ||
      !op?.signature || op.status !== "FINALIZED" || op.operationType !== "REDEMPTION_PAYMENT" ||
      asset.blockchainTransactionId !== op.id || op.entitlementId !== row.id || op.corporateActionId !== action.id ||
      op.networkGenesisHash !== genesis || op.signature !== row.settlementSignature || op.signature !== row.burnSignature ||
      asset.expectedAmountMinor !== row.tokensToRedeem || asset.actualAmountMinor !== row.tokensToRedeem ||
      reconcileSettlementLegs(action.type, settlement.legs).status !== "MATCHED") {
    throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Payment and burn must share one finalized transaction and confirmed settlement legs");
  }
  return op;
}

/** Versioned canonical evidence binds each payment to the same atomic bond burn and source commitment. */
export async function redemptionReceiptDraft(database: Database, id: string) {
  const action = await requireRedemptionExecutionCalculation(database, id);
  if (action.entitlements.some(row => row.amountMinor > 0n && row.status !== "REDEEMED")) {
    throw new TransactionWorkflowError("REDEMPTION_INCOMPLETE", "Confirm every payment and burn before creating the final redemption receipt");
  }
  const approval = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: "ACTION_APPROVAL", status: "FINALIZED" } });
  if (!approval?.signature) throw new TransactionWorkflowError("ONCHAIN_APPROVAL_REQUIRED", "Finalized approval evidence is missing");
  const items = [];
  let totalRedeemed = 0n;
  for (const row of action.entitlements) {
    if (row.amountMinor === 0n) {
      if (row.tokensToRedeem !== 0n || row.status !== "NOT_ELIGIBLE_ZERO_ROUNDING") throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Zero rounding entitlement has an inconsistent burn");
      items.push({ investorId: row.investorId, entitlementId: row.id, amountMinor: "0", tokensRedeemed: "0", status: row.status, settlement: null });
      continue;
    }
    const settlement = await database.settlement.findUnique({ where: { entitlementId: row.id }, include: { legs: { include: { blockchainTransaction: true } } } });
    const op = requireAtomicRedemptionSettlement(action, action.snapshot!.networkGenesisHash, row, settlement);
    const proof = rpcObject(op.preparedPayload);
    if (typeof proof["redemptionReceiptAddress"] !== "string" || typeof proof["sourceHash"] !== "string" ||
        typeof proof["executedAt"] !== "string" || !/^[0-9]+$/.test(proof["executedAt"]) ||
        typeof proof["supplyBefore"] !== "string" || typeof proof["supplyAfter"] !== "string" ||
        !/^[0-9]+$/.test(proof["supplyBefore"]) || !/^[0-9]+$/.test(proof["supplyAfter"]) ||
        BigInt(proof["supplyBefore"]) - BigInt(proof["supplyAfter"]) !== row.tokensToRedeem ||
        !Array.isArray(proof["confirmedTokenAccounts"]) || !Number.isSafeInteger(proof["finalizedSlot"]) || Number(proof["finalizedSlot"]) < 0) {
      throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Finalized burn source, supply, receipt, clock and slot evidence are missing");
    }
    totalRedeemed += row.tokensToRedeem;
    items.push({ investorId: row.investorId, entitlementId: row.id, amountMinor: row.amountMinor.toString(), tokensRedeemed: row.tokensToRedeem.toString(), status: "REDEEMED",
      settlement: { receiver: row.settlementWalletAddress, signature: op.signature, receiptAddress: proof["redemptionReceiptAddress"], sourceHash: proof["sourceHash"],
        tokenAccounts: proof["confirmedTokenAccounts"], supplyBefore: proof["supplyBefore"], supplyAfter: proof["supplyAfter"],
        executedAt: proof["executedAt"], finalizedSlot: proof["finalizedSlot"], cashLeg: "CONFIRMED", assetLeg: "CONFIRMED", reconciliation: "MATCHED" } });
  }
  const finalSupply = action.snapshot!.mintSupply - totalRedeemed;
  redemptionRetiresInstrument(action.type, finalSupply);
  const payload = { schemaVersion: "redemption-action-receipt-v1", actionId: id, instrumentId: action.instrumentId,
    ticker: action.instrument.ticker, actionType: action.type, programId: action.instrument.programId,
    network: action.instrument.network, genesisHash: action.snapshot!.networkGenesisHash, bondMint: action.instrument.mintAddress,
    source: { type: action.sourceType, reference: action.sourceReference, document: action.sourceDocument },
    approval: { actorId: action.approvedById, approvedAt: action.approvedAt!.toISOString(), note: action.reviewNote, signature: approval.signature },
    snapshot: { hash: Buffer.from(action.snapshot!.snapshotHash).toString("hex"), slot: action.snapshot!.solanaSlot.toString(),
      plannedRecordAt: action.recordAt.toISOString(), effectiveBlockTime: action.snapshot!.blockTime.toISOString(), mintSupply: action.snapshot!.mintSupply.toString() },
    executeAt: action.executeAt.toISOString(), totalAmountMinor: action.totalEntitlementMinor.toString(),
    totalTokensRedeemed: totalRedeemed.toString(), finalSupply: finalSupply.toString(), reconciliation: "MATCHED", entitlements: items };
  const json = JSON.stringify(payload);
  return { payload: JSON.parse(json) as Prisma.InputJsonObject, hash: createHash("sha256").update(json).digest("hex"), json };
}

export async function getRedemptionReceipt(database: PrismaClient, id: string) {
  if (!WORKFLOW_UUID.test(id)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action UUID is invalid", 400);
  const receipt = await database.actionReceipt.findUnique({ where: { corporateActionId: id } });
  if (!receipt) throw new TransactionWorkflowError("RECEIPT_NOT_READY", "The receipt is available after all payments and burns are reconciled", 404);
  const draft = await redemptionReceiptDraft(database, id);
  assertCouponReceiptIntegrity(receipt, draft);
  const confirmation = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: "REDEMPTION_FINALIZE", status: "FINALIZED" } });
  return { actionId: id, status: receipt.status, payload: draft.payload, canonicalJson: draft.json, sha256: draft.hash,
    onchainPda: receipt.onchainPda, finalizedAt: receipt.finalizedAt?.toISOString() ?? null, signature: confirmation?.signature ?? null };
}
