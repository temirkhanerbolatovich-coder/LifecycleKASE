import { createHash } from "node:crypto";
import type { Entitlement, Prisma, PrismaClient } from "@prisma/client";
import { reconcileSettlementLegs } from "@lifecycle-kase/domain";
import { requireRedemptionExecutionCalculation } from "./entitlements.js";
import { assertCouponReceiptIntegrity } from "./coupon-receipt.js";
import { redemptionRetiresInstrument } from "./redemption-sources.js";
import { onchainActionVersion, redemptionAllocationPolicy } from "./redemption-policy.js";
import { CONTROLLED_TOKEN_POLICY } from "./controlled-policy.js";
import { buildControlledUnitReservation, deriveCorporateActionAddresses, deriveControlledPolicyAddress, deriveControlledCaptureAddress } from "@lifecycle-kase/solana-client";
import { controlledBurnAllocations, requireControlledReservationProof } from "./controlled-settlement.js";
import { requireControlledSnapshotEvidence } from "./controlled-snapshot.js";
import { redemptionTokenSources } from "./redemption-sources.js";
import { uuidBytes } from "./snapshot-registration.js";
import { rpcObject, TransactionWorkflowError, WORKFLOW_UUID } from "./transaction-workflow.js";

type Database = PrismaClient | Prisma.TransactionClient;
type SettlementEvidence = Prisma.SettlementGetPayload<{ include: { legs: { include: { blockchainTransaction: true } } } }>;

export { requireControlledReservationProof } from "./controlled-settlement.js";

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
  const exact = onchainActionVersion(action) === 2;
  const controlled = action.instrument.tokenPolicy === CONTROLLED_TOKEN_POLICY;
  const captureFinish = controlled ? await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: "CONTROLLED_CAPTURE_FINISH", status: "FINALIZED" } }) : null;
  if (controlled && (!captureFinish?.signature || captureFinish.networkGenesisHash !== action.snapshot!.networkGenesisHash || !action.snapshot!.captureEvidence)) {
    throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Finalized controlled capture evidence is required");
  }
  if (controlled) {
    const addresses = await deriveCorporateActionAddresses(action.instrument.programId!, uuidBytes(action.instrumentId), uuidBytes(id));
    const evidence = rpcObject(action.snapshot!.captureEvidence);
    if (evidence["controlledCaptureAddress"] !== await deriveControlledCaptureAddress(action.instrument.programId!, addresses.actionAddress) ||
        evidence["controlledPolicyAddress"] !== await deriveControlledPolicyAddress(action.instrument.programId!, addresses.instrumentAddress)) {
      throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Controlled redemption raw capture addresses differ");
    }
    requireControlledSnapshotEvidence(action.snapshot!.captureEvidence, action.snapshot!.canonicalJson);
  }
  const rowAllocation = (row: Entitlement) => exact ? { allocation: {
    tieAddress: rpcObject(row.calculationInputs)["tieAddress"], roundingRemainder: rpcObject(row.calculationInputs)["roundingRemainder"],
    denominator: rpcObject(row.calculationInputs)["denominator"], remainingTokens: rpcObject(row.calculationInputs)["remainingTokens"]
  } } : {};
  let totalRedeemed = 0n;
  for (const row of action.entitlements) {
    const sources = controlled ? redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId) : [];
    const unitPlan = controlled ? await buildControlledUnitReservation({ programId: action.instrument.programId!, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(id),
      corporateActionAuthority: action.instrument.corporateActionAuthority, investorId: uuidBytes(row.investorId), bondMint: action.instrument.mintAddress!,
      tokenAccounts: sources, snapshotHash: Buffer.from(action.snapshot!.snapshotHash).toString("hex") }) : null;
    const unitExpected = unitPlan ? { unitReservationAddress: unitPlan.unitReservationAddress, sourceHash: unitPlan.sourceHash,
      allocations: controlledBurnAllocations(sources, row.tokensToRedeem).map(source => source.burnAmount.toString()), holdingAddresses: unitPlan.holdingAddresses, tokenAccounts: sources } : null;
    if (unitPlan && rpcObject(captureFinish!.preparedPayload)["controlledCaptureAddress"] !== unitPlan.controlledCaptureAddress) throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Finalized redemption capture address differs from the canonical PDA");
    if (row.amountMinor === 0n) {
      if (row.tokensToRedeem !== 0n || row.status !== "NOT_ELIGIBLE_ZERO_ROUNDING") throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Zero rounding entitlement has an inconsistent burn");
      const unitOperation = controlled ? await database.blockchainTransaction.findFirst({ where: { entitlementId: row.id, corporateActionId: id, operationType: "CONTROLLED_UNIT_RESERVATION", status: "FINALIZED" } }) : null;
      if (controlled && (!unitOperation?.signature || unitOperation.networkGenesisHash !== action.snapshot!.networkGenesisHash)) throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Zero-rounding assigned-unit marker evidence is missing");
      const reservation = unitExpected ? requireControlledReservationProof(rpcObject(unitOperation!.preparedPayload)["confirmedReservation"], { ...unitExpected, consumed: false }) : null;
      items.push({ investorId: row.investorId, entitlementId: row.id, amountMinor: "0", tokensRedeemed: "0", status: row.status, settlement: null,
        ...(reservation ? { unitReservation: { signature: unitOperation!.signature, ...reservation } } : {}), ...rowAllocation(row) });
      continue;
    }
    const settlement = await database.settlement.findUnique({ where: { entitlementId: row.id }, include: { legs: { include: { blockchainTransaction: true } } } });
    const op = requireAtomicRedemptionSettlement(action, action.snapshot!.networkGenesisHash, row, settlement);
    const proof = rpcObject(op.preparedPayload);
    const reservation = unitExpected ? requireControlledReservationProof(proof["confirmedReservation"], { ...unitExpected, consumed: true }) : null;
    if (controlled && proof["tokenPolicy"] !== CONTROLLED_TOKEN_POLICY) throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Finalized payment token policy differs");
    if (typeof proof["redemptionReceiptAddress"] !== "string" || typeof proof["sourceHash"] !== "string" ||
        typeof proof["executedAt"] !== "string" || !/^[0-9]+$/.test(proof["executedAt"]) ||
        typeof proof["supplyBefore"] !== "string" || typeof proof["supplyAfter"] !== "string" ||
        !/^[0-9]+$/.test(proof["supplyBefore"]) || !/^[0-9]+$/.test(proof["supplyAfter"]) ||
        BigInt(proof["supplyBefore"]) - BigInt(proof["supplyAfter"]) !== row.tokensToRedeem ||
        !Array.isArray(proof["confirmedTokenAccounts"]) || !Number.isSafeInteger(proof["finalizedSlot"]) || Number(proof["finalizedSlot"]) < 0) {
      throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Finalized burn source, supply, receipt, clock and slot evidence are missing");
    }
    totalRedeemed += row.tokensToRedeem;
    items.push({ investorId: row.investorId, entitlementId: row.id, amountMinor: row.amountMinor.toString(), tokensRedeemed: row.tokensToRedeem.toString(), status: "REDEEMED", ...rowAllocation(row),
      settlement: { receiver: row.settlementWalletAddress, signature: op.signature, receiptAddress: proof["redemptionReceiptAddress"], sourceHash: proof["sourceHash"],
        ...(reservation ? { unitReservation: reservation, freezePolicy: "ATOMIC_THAW_BURN_REFREEZE" } : {}),
        tokenAccounts: proof["confirmedTokenAccounts"], supplyBefore: proof["supplyBefore"], supplyAfter: proof["supplyAfter"],
        executedAt: proof["executedAt"], finalizedSlot: proof["finalizedSlot"], cashLeg: "CONFIRMED", assetLeg: "CONFIRMED", reconciliation: "MATCHED" } });
  }
  const finalSupply = action.snapshot!.mintSupply - totalRedeemed;
  redemptionRetiresInstrument(action.type, finalSupply);
  const payload = { schemaVersion: controlled ? "redemption-controlled-action-receipt-v1" : exact ? "redemption-action-receipt-v2" : "redemption-action-receipt-v1", actionId: id, instrumentId: action.instrumentId,
    ...(controlled ? { tokenPolicy: CONTROLLED_TOKEN_POLICY, controlledRegistry: {
      captureAddress: rpcObject(captureFinish!.preparedPayload)["controlledCaptureAddress"], captureFinishSignature: captureFinish!.signature,
      captureEvidence: action.snapshot!.captureEvidence, assignedUnitPolicy: "SNAPSHOT_SOURCE_BASE58_ASC_GREEDY", untouchedZeroSources: "IMMUTABLE_COMMITMENT_ONLY",
    } } : {}),
    ...(exact ? { allocation: { policy: redemptionAllocationPolicy(action), targetTokens: action.redemptionTargetTokens!.toString(),
      totalBalance: action.snapshot!.totalBalance.toString(), tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" } } : {}),
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
