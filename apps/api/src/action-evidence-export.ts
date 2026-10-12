import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { allocateEarlyRedemption, calculateCouponBreakdown, createSnapshotV2Commitment,
  DomainValidationError, EARLY_REDEMPTION_ALLOCATION_POLICY, reconcileSettlementLegs } from "@lifecycle-kase/domain";
import { assertCouponReceiptIntegrity, couponReceiptDraft } from "./coupon-receipt.js";
import { redemptionReceiptDraft } from "./redemption-receipt.js";
import { requireControlledSnapshotEvidence } from "./controlled-snapshot.js";
import { CONTROLLED_TOKEN_POLICY } from "./controlled-policy.js";
import { FORMULA_VERSION } from "./entitlements.js";
import { TransactionWorkflowError, WORKFLOW_UUID } from "./transaction-workflow.js";

export const ACTION_EVIDENCE_SCHEMA = "action-evidence-export-v1";
export const ACTION_EVIDENCE_CANONICALIZATION = "SORTED_OBJECT_KEYS_UTF8_JSON_V1";
const transactionSelect = { id: true, instrumentId: true, corporateActionId: true, entitlementId: true,
  operationType: true, signature: true, status: true, lastErrorCode: true, requiredSigner: true,
  networkGenesisHash: true, createdAt: true, submittedAt: true, finalizedAt: true } as const;
const evidenceInclude = {
  instrument: { include: { settlementAsset: true } },
  snapshot: { include: { investors: { orderBy: { investorId: "asc" as const },
    include: { wallets: { orderBy: { walletAddress: "asc" as const }, include: {
      tokenAccounts: { orderBy: { address: "asc" as const } } } } } } } },
  entitlements: { orderBy: { investorId: "asc" as const }, include: {
    settlement: { include: { legs: { orderBy: { type: "asc" as const }, include: { blockchainTransaction: { select: transactionSelect } } } } }
  } },
  blockchainTransactions: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], select: transactionSelect },
  actionReceipt: true
} satisfies Prisma.CorporateActionInclude;
export type ActionEvidenceRecord = Prisma.CorporateActionGetPayload<{ include: typeof evidenceInclude }>;
type ReceiptDraft = Awaited<ReturnType<typeof couponReceiptDraft>>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type UnresolvedItem = { code: string; entitlementId: string | null; operationId: string | null };
const textOrder = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const hash = (bytes: string) => createHash("sha256").update(bytes, "utf8").digest("hex");

/** Export hashing is independent of PostgreSQL JSONB key order. Receipt strings retain their original bytes. */
export function canonicalEvidenceJson(value: unknown): string {
  const normalize = (item: unknown): Json => {
    if (item === null || typeof item === "boolean" || typeof item === "string") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.keys(item).sort(textOrder).map(key => [key, normalize((item as Record<string, unknown>)[key])]));
    }
    throw new TransactionWorkflowError("EVIDENCE_INTEGRITY", "Evidence contains a value outside the JSON contract");
  };
  return JSON.stringify(normalize(value));
}
function integrity(message: string): never { throw new TransactionWorkflowError("EVIDENCE_INTEGRITY", message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) integrity("Stored calculation inputs are invalid");
  return value as Record<string, unknown>;
}
function integer(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value)) integrity("Stored calculation integer is invalid");
  return BigInt(value);
}
function number(value: unknown): number {
  if (!Number.isSafeInteger(value)) integrity("Stored calculation parameter is invalid");
  return value as number;
}
function snapshotEvidence(action: ActionEvidenceRecord) {
  const snapshot = action.snapshot;
  if (!snapshot) return null;
  if (!action.instrument.mintAddress) integrity("Stored snapshot mint is missing");
  const commitment = createSnapshotV2Commitment({ actionId: action.id, instrumentId: action.instrumentId,
    cluster: action.instrument.network === "SOLANA_LOCALNET" ? "localnet" : "devnet",
    networkGenesisHash: snapshot.networkGenesisHash, mintAddress: action.instrument.mintAddress,
    recordAt: snapshot.recordAt.toISOString(), blockTime: snapshot.blockTime.toISOString(), createdAt: snapshot.createdAt.toISOString(),
    solanaSlot: snapshot.solanaSlot, mintSupply: snapshot.mintSupply,
    investors: snapshot.investors.map(row => ({ investorId: row.investorId, eligibilityStatus: row.eligibilityStatus,
      wallets: row.wallets.map(wallet => ({ walletId: wallet.walletId, walletAddress: wallet.walletAddress, walletStatus: wallet.walletStatus,
        tokenAccounts: wallet.tokenAccounts.map(account => ({ address: account.address, balance: account.balance })) })) })) });
  if (snapshot.schemaVersion !== "snapshot-v2" || snapshot.instrumentId !== action.instrumentId || snapshot.corporateActionId !== action.id ||
      snapshot.recordAt.getTime() !== action.recordAt.getTime() || commitment.sha256 !== Buffer.from(snapshot.snapshotHash).toString("hex") ||
      canonicalEvidenceJson(commitment.snapshot) !== canonicalEvidenceJson(snapshot.canonicalJson) || snapshot.investorCount !== snapshot.investors.length ||
      snapshot.walletCount !== commitment.snapshot.wallet_count || snapshot.totalBalance !== snapshot.mintSupply ||
      snapshot.investors.some(row => row.balance.toString() !== commitment.snapshot.investors.find(value => value.investor_id === row.investorId)?.balance ||
        row.wallets.some(wallet => wallet.balance !== wallet.tokenAccounts.reduce((total, account) => total + account.balance, 0n)))) {
    integrity("Stored snapshot hash, canonical payload and relational balances differ");
  }
  if (action.instrument.tokenPolicy === CONTROLLED_TOKEN_POLICY) requireControlledSnapshotEvidence(snapshot.captureEvidence, snapshot.canonicalJson);
  const registration = action.blockchainTransactions.filter(operation => operation.operationType === "REGISTER_SNAPSHOT" && operation.status === "FINALIZED" &&
    operation.signature && operation.networkGenesisHash === snapshot.networkGenesisHash);
  return { id: snapshot.id, status: snapshot.status, schemaVersion: snapshot.schemaVersion,
    sha256: commitment.sha256, canonicalJson: commitment.canonicalJson, canonicalPayload: commitment.snapshot,
    recordedRelationalFacts: snapshot.investors.map(row => ({ snapshotInvestorId: row.id, investorId: row.investorId,
      eligibilityStatus: row.eligibilityStatus, balance: row.balance.toString(), wallets: row.wallets.map(wallet => ({
        walletId: wallet.walletId, walletAddress: wallet.walletAddress, walletStatus: wallet.walletStatus, balance: wallet.balance.toString(),
        tokenAccounts: wallet.tokenAccounts.map(account => ({ address: account.address, balance: account.balance.toString() })) })) })),
    rawCaptureAvailability: snapshot.captureEvidence ? "SAVED_CONTROLLED_RAW_CAPTURE" : "LEGACY_RAW_ACCOUNT_BYTES_NOT_RECORDED",
    rawCaptureEvidence: snapshot.captureEvidence, registrationVerified: snapshot.status === "FINALIZED" && registration.length === 1,
    registrationSignatures: registration.map(operation => operation.signature!), recordAt: snapshot.recordAt.toISOString(),
    effectiveBlockTime: snapshot.blockTime.toISOString(), effectiveSlot: snapshot.solanaSlot.toString(),
    mintSupply: snapshot.mintSupply.toString(), totalBalance: snapshot.totalBalance.toString(),
    investorCount: snapshot.investorCount, walletCount: snapshot.walletCount };
}

const calculationFields = ["actionType", "snapshotId", "snapshotHash", "effectiveSlot", "effectiveBlockTime", "balance", "faceValueMinor",
  "couponRateBps", "paymentsPerYear", "redemptionPercentageBps", "redemptionPriceMinor", "allocationPolicy", "targetTokens", "totalBalance",
  "tieAddress", "remainingTokens", "roundingRemainder", "denominator", "eligibilityRuleVersion", "eligible", "eligibilityReason"] as const;
function calculationEvidence(action: ActionEvidenceRecord, snapshot: ReturnType<typeof snapshotEvidence>) {
  if (!action.entitlements.length) return { verified: false, capturedTerms: null, totalObligationMinor: null,
    totalTokensToRedeem: null, rounding: null, rows: [] };
  if (!snapshot || action.entitlements.length !== action.snapshot!.investors.length ||
      new Set(action.entitlements.map(row => row.investorId)).size !== action.entitlements.length) integrity("Stored calculation coverage differs from the snapshot");
  const exact = action.type === "EARLY_REDEMPTION" && action.redemptionAllocationPolicy === EARLY_REDEMPTION_ALLOCATION_POLICY;
  const firstInputs = object(action.entitlements[0]!.calculationInputs);
  const allocation = exact ? allocateEarlyRedemption({ targetTokens: integer(firstInputs["targetTokens"]),
    rows: action.snapshot!.investors.map(row => ({ investorId: row.investorId, balance: row.balance,
      tieAddress: row.wallets.map(wallet => wallet.walletAddress).sort(textOrder)[0]! })) }) : null;
  let capturedTerms: Record<string, Json> | null = null;
  let amount = 0n, tokens = 0n, remainder = 0n, denominator: bigint | null = null;
  const rows = action.entitlements.map(row => {
    const inputs = object(row.calculationInputs);
    if (calculationFields.some(key => Object.hasOwn(inputs, key) && inputs[key] !== null &&
        !["string", "number", "boolean"].includes(typeof inputs[key])) ||
        typeof inputs["eligible"] !== "boolean" || typeof inputs["eligibilityReason"] !== "string" ||
        typeof inputs["eligibilityRuleVersion"] !== "string") integrity("Stored eligibility and calculation fields are invalid");
    const captured = action.snapshot!.investors.find(value => value.id === row.snapshotInvestorId);
    if (!captured || captured.investorId !== row.investorId || row.corporateActionId !== action.id || inputs["actionType"] !== action.type ||
        inputs["snapshotId"] !== snapshot.id || inputs["snapshotHash"] !== snapshot.sha256 || inputs["effectiveSlot"] !== snapshot.effectiveSlot ||
        inputs["effectiveBlockTime"] !== snapshot.effectiveBlockTime || integer(inputs["balance"]) !== row.balanceAtRecordDate ||
        captured.balance !== row.balanceAtRecordDate || row.formulaVersion !== (exact ? EARLY_REDEMPTION_ALLOCATION_POLICY : FORMULA_VERSION)) {
      integrity("Stored obligation lineage differs from its captured snapshot");
    }
    const faceValueMinor = integer(inputs["faceValueMinor"]), couponRateBps = number(inputs["couponRateBps"]), paymentsPerYear = number(inputs["paymentsPerYear"]);
    const terms = { faceValueMinor: faceValueMinor.toString(), couponRateBps, paymentsPerYear,
      redemptionPercentageBps: inputs["redemptionPercentageBps"] == null ? null : number(inputs["redemptionPercentageBps"]),
      redemptionPriceMinor: inputs["redemptionPriceMinor"] == null ? null : integer(inputs["redemptionPriceMinor"]).toString(),
      allocationPolicy: exact ? EARLY_REDEMPTION_ALLOCATION_POLICY : FORMULA_VERSION,
      targetTokens: exact ? allocation!.targetTokens.toString() : null };
    if (capturedTerms && canonicalEvidenceJson(capturedTerms) !== canonicalEvidenceJson(terms)) integrity("Stored obligations use different captured terms");
    capturedTerms = terms;
    let expectedAmount: bigint, expectedTokens: bigint, expectedRemainder: bigint, expectedDenominator: bigint;
    if (action.type === "EARLY_REDEMPTION") {
      if (terms.redemptionPriceMinor === null || BigInt(terms.redemptionPriceMinor) === 0n) integrity("Captured redemption price is missing");
      if (allocation) {
        const allocated = allocation.rows.find(value => value.investorId === row.investorId)!;
        if (inputs["allocationPolicy"] !== allocation.policy || inputs["totalBalance"] !== allocation.totalBalance.toString() ||
            inputs["tieAddress"] !== allocated.tieAddress || inputs["remainingTokens"] !== allocated.remainingTokens.toString() ||
            action.redemptionTargetTokens !== allocation.targetTokens || terms.redemptionPercentageBps !== null) integrity("Exact allocation inputs differ from the captured positions");
        expectedTokens = allocated.redeemedTokens; expectedRemainder = allocated.quotaRemainder; expectedDenominator = allocation.denominator;
      } else {
        const bps = terms.redemptionPercentageBps;
        if (bps === null || bps < 1 || bps > 10_000) integrity("Captured redemption percentage is invalid");
        expectedTokens = row.balanceAtRecordDate * BigInt(bps) / 10_000n;
        expectedRemainder = row.balanceAtRecordDate * BigInt(bps) % 10_000n; expectedDenominator = 10_000n;
      }
      expectedAmount = expectedTokens * BigInt(terms.redemptionPriceMinor);
    } else {
      const coupon = calculateCouponBreakdown({ balance: row.balanceAtRecordDate, faceValueMinor, couponRateBps, paymentsPerYear });
      expectedTokens = action.type === "BOND_REDEMPTION" ? row.balanceAtRecordDate : 0n;
      expectedAmount = coupon.amountMinor + (action.type === "BOND_REDEMPTION" ? row.balanceAtRecordDate * faceValueMinor : 0n);
      expectedRemainder = coupon.remainder; expectedDenominator = coupon.denominator;
    }
    if (row.amountMinor !== expectedAmount || row.tokensToRedeem !== expectedTokens || integer(inputs["roundingRemainder"]) !== expectedRemainder ||
        integer(inputs["denominator"]) !== expectedDenominator || denominator !== null && denominator !== expectedDenominator) integrity("Stored obligation amount or rounding differs from captured inputs");
    amount += row.amountMinor; tokens += row.tokensToRedeem; remainder += expectedRemainder; denominator = expectedDenominator;
    const safeInputs = Object.fromEntries(calculationFields.filter(key => Object.hasOwn(inputs, key)).map(key => [key, inputs[key]]));
    return { entitlementId: row.id, investorId: row.investorId, snapshotInvestorId: row.snapshotInvestorId,
      balanceAtRecordDate: row.balanceAtRecordDate.toString(), amountMinor: row.amountMinor.toString(), tokensToRedeem: row.tokensToRedeem.toString(),
      formulaVersion: row.formulaVersion, calculationInputs: safeInputs, eligibilityReason: row.eligibilityReason,
      status: row.status, version: row.version, settlementWalletAddress: row.settlementWalletAddress,
      onchainPda: row.onchainPda, settlementSignature: row.settlementSignature, burnSignature: row.burnSignature,
      lastErrorCode: row.lastErrorCode, updatedAt: row.updatedAt.toISOString() };
  });
  if (amount !== action.totalEntitlementMinor || action.eligibleHolders !== action.entitlements.filter(row => row.amountMinor > 0n).length) integrity("Stored action obligation totals differ from its full entitlement set");
  return { verified: true, capturedTerms, totalObligationMinor: amount.toString(), totalTokensToRedeem: tokens.toString(),
    rounding: { policy: exact ? "LARGEST_REMAINDER_EXACT_TARGET" : "FLOOR_PER_INVESTOR", numerator: remainder.toString(),
      denominator: denominator!.toString(), unit: action.type === "EARLY_REDEMPTION" ? "BOND_TOKEN" : "SETTLEMENT_MINOR_UNIT",
      remainderMeaning: exact ? "PRE_ALLOCATION_QUOTA_REMAINDERS" : "UNDISTRIBUTED_FRACTIONAL_UNITS",
      residualDestination: exact ? "DISTRIBUTED_BY_LARGEST_REMAINDER" : action.type === "EARLY_REDEMPTION" ? "NOT_REDEEMED" : "TREASURY",
      taxTreatment: "NOT_IMPLEMENTED" }, rows };
}

function settlementEvidence(action: ActionEvidenceRecord, unresolved: UnresolvedItem[]) {
  let confirmedAmount = 0n, confirmedTokens = 0n, confirmedRows = 0;
  const rows = action.entitlements.map(row => {
    const settlement = row.settlement;
    let verification = row.amountMinor === 0n && row.tokensToRedeem === 0n && row.status === "NOT_ELIGIBLE_ZERO_ROUNDING" ? "ZERO_OBLIGATION" : "UNRESOLVED";
    let reconciliation = { status: "PENDING", reason: "SETTLEMENT_MISSING" };
    if (settlement) {
      try { reconciliation = reconcileSettlementLegs(action.type, settlement.legs); }
      catch (error) { if (!(error instanceof DomainValidationError)) throw error; reconciliation = { status: "MISMATCH", reason: "INVALID_STORED_LEGS" }; }
      if (row.amountMinor === 0n && row.tokensToRedeem === 0n) {
        verification = "UNRESOLVED"; reconciliation = { status: "MISMATCH", reason: "ZERO_OBLIGATION_SETTLEMENT_UNEXPECTED" };
      }
      const cash = settlement.legs.find(leg => leg.type === "CASH"), asset = settlement.legs.find(leg => leg.type === "ASSET");
      const transaction = cash?.blockchainTransaction;
      const requiredAsset = action.type !== "COUPON_PAYMENT";
      const validLegs = reconciliation.status === "MATCHED" && cash?.required && asset?.required === requiredAsset &&
        cash.expectedAmountMinor === row.amountMinor && asset.expectedAmountMinor === row.tokensToRedeem &&
        Boolean(cash.confirmedAt && (!requiredAsset || asset.confirmedAt));
      const projection = settlement.status === "FINALIZED" && settlement.reconciliationStatus === "MATCHED" &&
        settlement.amountMinor === row.amountMinor && settlement.actualAmountMinor === row.amountMinor && validLegs &&
        Boolean(settlement.finalizedAt && settlement.reconciledAt) && row.status === (requiredAsset ? "REDEEMED" : "PAID");
      const onchain = projection && transaction?.status === "FINALIZED" && Boolean(transaction.signature && transaction.finalizedAt) &&
        transaction.corporateActionId === action.id && transaction.entitlementId === row.id && transaction.instrumentId === action.instrumentId &&
        cash?.blockchainTransactionId === transaction.id &&
        transaction.networkGenesisHash === action.snapshot?.networkGenesisHash && transaction.signature === row.settlementSignature &&
        transaction.operationType === (requiredAsset ? "REDEMPTION_PAYMENT" : "COUPON_PAYMENT") &&
        (requiredAsset ? asset?.blockchainTransactionId === transaction.id && row.burnSignature === transaction.signature : row.burnSignature === null);
      if (action.settlementType === "ON_CHAIN" && onchain) verification = "STORED_FINALIZED_ONCHAIN_EVIDENCE";
      if (action.settlementType === "SIMULATED_FIAT" && projection) verification = "SIMULATED_SETTLEMENT";
      if (verification === "STORED_FINALIZED_ONCHAIN_EVIDENCE" || verification === "SIMULATED_SETTLEMENT") {
        confirmedAmount += row.amountMinor; confirmedTokens += row.tokensToRedeem; confirmedRows += 1;
      }
    }
    if (verification === "UNRESOLVED") unresolved.push({ code: reconciliation.status === "MISMATCH" ? "SETTLEMENT_MISMATCH" : "ENTITLEMENT_NOT_RECONCILED", entitlementId: row.id, operationId: null });
    return { entitlementId: row.id, verification, calculatedReconciliation: reconciliation,
      settlement: settlement ? { id: settlement.id, status: settlement.status, reconciliationStatus: settlement.reconciliationStatus,
        amountMinor: settlement.amountMinor.toString(), actualAmountMinor: settlement.actualAmountMinor?.toString() ?? null,
        finalizedAt: settlement.finalizedAt?.toISOString() ?? null, reconciledAt: settlement.reconciledAt?.toISOString() ?? null,
        legs: settlement.legs.map(leg => ({ type: leg.type, required: leg.required, status: leg.status,
          expectedAmountMinor: leg.expectedAmountMinor.toString(), actualAmountMinor: leg.actualAmountMinor?.toString() ?? null,
          confirmedAt: leg.confirmedAt?.toISOString() ?? null, blockchainTransactionId: leg.blockchainTransactionId,
          signature: leg.blockchainTransaction?.signature ?? null, transactionStatus: leg.blockchainTransaction?.status ?? null })) } : null };
  });
  return { confirmedAmountMinor: confirmedAmount.toString(), confirmedTokensRedeemed: confirmedTokens.toString(), confirmedRows, rows };
}

/** Builds a single-action export without live reads, sends, investor names, session data or transaction wires. */
export function buildActionEvidenceExport(action: ActionEvidenceRecord, receiptDraft: ReceiptDraft | null = null) {
  const unresolved: UnresolvedItem[] = [];
  const snapshot = snapshotEvidence(action), calculation = calculationEvidence(action, snapshot), settlement = settlementEvidence(action, unresolved);
  if (!snapshot) unresolved.push({ code: "SNAPSHOT_MISSING", entitlementId: null, operationId: null });
  else if (!snapshot.registrationVerified) unresolved.push({ code: "SNAPSHOT_REGISTRATION_NOT_FINALIZED", entitlementId: null, operationId: null });
  if (!calculation.verified) unresolved.push({ code: "CALCULATION_NOT_AVAILABLE", entitlementId: null, operationId: null });
  const finalizationType = action.type === "COUPON_PAYMENT" ? "COUPON_FINALIZE" : "REDEMPTION_FINALIZE";
  const finalizations = action.blockchainTransactions.filter(operation => operation.operationType === finalizationType && operation.status === "FINALIZED" &&
    operation.signature && operation.networkGenesisHash === action.snapshot?.networkGenesisHash);
  let receipt = null;
  if (action.actionReceipt) {
    if (!receiptDraft || hash(receiptDraft.json) !== receiptDraft.hash) integrity("Stored receipt requires its verified original canonical bytes");
    assertCouponReceiptIntegrity(action.actionReceipt, receiptDraft);
    receipt = { id: action.actionReceipt.id, status: action.actionReceipt.status, sha256: receiptDraft.hash,
      canonicalJson: receiptDraft.json, payload: receiptDraft.payload, onchainPda: action.actionReceipt.onchainPda,
      finalizedAt: action.actionReceipt.finalizedAt?.toISOString() ?? null,
      finalizationSignature: finalizations.length === 1 ? finalizations[0]!.signature : null,
      integrity: "VERIFIED_STORED_CANONICAL_RECEIPT" };
  } else if (receiptDraft) integrity("Canonical receipt has no stored receipt record");
  if (!receipt) unresolved.push({ code: "RECEIPT_NOT_AVAILABLE", entitlementId: null, operationId: null });
  else if (receipt.status !== "FINALIZED" || !receipt.onchainPda || !receipt.finalizedAt || !receipt.finalizationSignature) {
    unresolved.push({ code: "RECEIPT_FINALIZATION_NOT_CONFIRMED", entitlementId: null, operationId: null });
  }
  for (const operation of action.blockchainTransactions) if (["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"].includes(operation.status)) {
    unresolved.push({ code: operation.status === "UNKNOWN_CONFIRMATION" ? "ORIGINAL_SIGNATURE_CONFIRMATION_UNKNOWN" : "TRANSACTION_NOT_FINALIZED", entitlementId: operation.entitlementId, operationId: operation.id });
  }
  if (action.processedEntitlements !== settlement.confirmedRows) unresolved.push({ code: "PROCESSED_COUNT_MISMATCH", entitlementId: null, operationId: null });
  if (action.status !== "FINALIZED") unresolved.push({ code: "ACTION_NOT_FINALIZED", entitlementId: null, operationId: null });
  unresolved.sort((a, b) => textOrder(`${a.code}/${a.entitlementId ?? ""}/${a.operationId ?? ""}`, `${b.code}/${b.entitlementId ?? ""}/${b.operationId ?? ""}`));
  const payload = {
    schemaVersion: ACTION_EVIDENCE_SCHEMA,
    metadata: { scope: "ONE_CORPORATE_ACTION_COMPLETE_RECORD_SET", dataSource: "REPEATABLE_READ_DATABASE_RECORDS",
      liveRpcRevalidated: false, actionVersion: action.version, actionUpdatedAt: action.updatedAt.toISOString(),
      immutableSections: [...(snapshot?.status === "FINALIZED" ? ["FINALIZED_SNAPSHOT"] : []),
        ...(receipt?.status === "FINALIZED" ? ["FINALIZED_CANONICAL_RECEIPT"] : [])],
      mutableSections: ["CURRENT_ACTION_STATUS", "CURRENT_INSTRUMENT_RECORD", "CURRENT_SETTLEMENT_AND_TRANSACTION_PROJECTIONS"],
      currency: action.instrument.currency, settlementDecimals: action.instrument.settlementDecimals,
      limitations: ["NO_LIVE_RPC_REVALIDATION", "TAX_NOT_IMPLEMENTED", ...(action.instrument.settlementAsset.isSimulated ? ["TEST_SETTLEMENT_ASSET_NOT_FIAT"] : [])] },
    action: { id: action.id, instrumentId: action.instrumentId, type: action.type, intent: action.intent, status: action.status,
      version: action.version, recordAt: action.recordAt.toISOString(), executeAt: action.executeAt.toISOString(),
      source: { type: action.sourceType, reference: action.sourceReference, document: action.sourceDocument,
        timestamp: action.sourceTimestamp?.toISOString() ?? null },
      approval: { actorId: action.approvedById, approvedAt: action.approvedAt?.toISOString() ?? null, note: action.reviewNote },
      redemptionAllocationPolicy: action.redemptionAllocationPolicy, redemptionPercentageBps: action.redemptionPercentageBps,
      redemptionPriceMinor: action.redemptionPriceMinor?.toString() ?? null, redemptionTargetTokens: action.redemptionTargetTokens?.toString() ?? null,
      recordedTotalEntitlementMinor: action.totalEntitlementMinor.toString(), eligibleHolders: action.eligibleHolders,
      recordedProcessedEntitlements: action.processedEntitlements, recordedFailedEntitlements: action.failedEntitlements },
    instrumentRecord: { id: action.instrument.id, ticker: action.instrument.ticker, name: action.instrument.name,
      network: action.instrument.network, programId: action.instrument.programId, mintAddress: action.instrument.mintAddress,
      tokenPolicy: action.instrument.tokenPolicy, issuerAuthority: action.instrument.issuerAuthority,
      faceValueMinor: action.instrument.faceValueMinor.toString(), couponRateBps: action.instrument.couponRateBps,
      paymentsPerYear: action.instrument.paymentsPerYear, issueAt: action.instrument.issueAt.toISOString(), maturityAt: action.instrument.maturityAt.toISOString(),
      status: action.instrument.status, totalSupply: action.instrument.totalSupply.toString(), circulatingSupply: action.instrument.circulatingSupply.toString() },
    settlementMode: { type: action.settlementType, assetCode: action.instrument.settlementAsset.code,
      mintAddress: action.instrument.settlementAsset.mintAddress, decimals: action.instrument.settlementAsset.decimals,
      assetIsSimulated: action.instrument.settlementAsset.isSimulated, disclaimer: action.instrument.settlementAsset.disclaimer },
    snapshot, calculation, settlement, transactions: action.blockchainTransactions.map(operation => ({ id: operation.id,
      instrumentId: operation.instrumentId, corporateActionId: operation.corporateActionId, entitlementId: operation.entitlementId,
      operationType: operation.operationType, signature: operation.signature, status: operation.status, lastErrorCode: operation.lastErrorCode,
      requiredSigner: operation.requiredSigner, networkGenesisHash: operation.networkGenesisHash,
      createdAt: operation.createdAt.toISOString(), submittedAt: operation.submittedAt?.toISOString() ?? null, finalizedAt: operation.finalizedAt?.toISOString() ?? null })),
    receipt, outcome: { evidenceComplete: unresolved.length === 0, settlementMode: action.settlementType, unresolved }
  };
  const canonicalPayloadJson = canonicalEvidenceJson(payload), payloadSha256 = hash(canonicalPayloadJson);
  return { schemaVersion: ACTION_EVIDENCE_SCHEMA, canonicalization: ACTION_EVIDENCE_CANONICALIZATION, payloadSha256,
    payload, canonicalJson: canonicalEvidenceJson({ schemaVersion: ACTION_EVIDENCE_SCHEMA, canonicalization: ACTION_EVIDENCE_CANONICALIZATION, payloadSha256, payload }) };
}

/** All source records and receipt verification use one consistent read; export access creates no business mutation. */
export async function getActionEvidenceExport(database: PrismaClient, id: string) {
  if (!WORKFLOW_UUID.test(id)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action UUID is invalid", 400);
  return database.$transaction(async tx => {
    const action = await tx.corporateAction.findUnique({ where: { id }, include: evidenceInclude });
    if (!action) throw new TransactionWorkflowError("ACTION_NOT_FOUND", "Corporate action was not found", 404);
    const draft = action.actionReceipt ? await (action.type === "COUPON_PAYMENT" ? couponReceiptDraft(tx, id) : redemptionReceiptDraft(tx, id)) : null;
    try { return buildActionEvidenceExport(action, draft); }
    catch (error) {
      if (error instanceof DomainValidationError) integrity("Stored evidence is outside the supported domain contract");
      throw error;
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** Quoting alone does not stop spreadsheet formulas. The escaped flag permits lossless reconstruction. */
export function evidenceCsvCell(value: string): { encoded: string; escaped: boolean } {
  const escaped = /^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value);
  return { encoded: `"${(escaped ? "'" + value : value).replaceAll('"', '""')}"`, escaped };
}
export function actionEvidenceCsv(bundle: ReturnType<typeof buildActionEvidenceExport>): string {
  const lines = ['"schema_version","action_id","payload_sha256","json_pointer","json_type","value","value_escaped"'];
  const visit = (value: unknown, pointer: string) => {
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const scalar = type === "string" ? value as string : type === "array" ? "[]" : type === "object" ? "{}" : JSON.stringify(value);
    const cell = evidenceCsvCell(scalar);
    lines.push([ACTION_EVIDENCE_SCHEMA, bundle.payload.action.id, bundle.payloadSha256, pointer, type].map(item => evidenceCsvCell(item).encoded).join(",") + `,${cell.encoded},"${cell.escaped}"`);
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${pointer}/${index}`));
    else if (value && typeof value === "object") {
      for (const key of Object.keys(value).sort(textOrder)) visit((value as Record<string, unknown>)[key], `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
    }
  };
  visit(bundle.payload, "");
  return lines.join("\r\n") + "\r\n";
}
export function actionEvidenceFile(bundle: ReturnType<typeof buildActionEvidenceExport>, format: unknown) {
  if (format !== "json" && format !== "csv") throw new TransactionWorkflowError("INVALID_REQUEST", "Evidence format must be json or csv", 400);
  const body = format === "json" ? bundle.canonicalJson : actionEvidenceCsv(bundle);
  return { body, filename: `action-evidence-${bundle.payload.action.id}.${format}`, mimeType: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8",
    fileSha256: hash(body), payloadSha256: bundle.payloadSha256 };
}
