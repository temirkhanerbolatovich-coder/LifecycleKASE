import { Prisma, type PrismaClient, type Entitlement } from "@prisma/client";
import { calculateCouponBreakdown, calculateEarlyRedemption, calculatePrincipal, createSnapshotV2Commitment,
  evaluateInvestorEligibility, summarizeCouponBreakdowns, allocateEarlyRedemption, EARLY_REDEMPTION_ALLOCATION_POLICY,
  type EarlyRedemptionAllocation, DomainValidationError } from "@lifecycle-kase/domain";
import type { InstrumentActor } from "./instrument-registry.js";
import { actionInput, actionText, requireActionIssuer, workflowDatabaseError } from "./corporate-action-registry.js";
import { TransactionWorkflowError, WORKFLOW_UUID } from "./transaction-workflow.js";
import { redemptionTokenSources } from "./redemption-sources.js";
import { redemptionAllocationPolicy } from "./redemption-policy.js";
import { buildControlledUnitReservation } from "@lifecycle-kase/solana-client";
import { CONTROLLED_TOKEN_POLICY, LEGACY_TOKEN_POLICY } from "./controlled-policy.js";
import { controlledBurnAllocations, requireControlledReservationProof } from "./controlled-settlement.js";
import { uuidBytes } from "./snapshot-registration.js";
import { rpcObject } from "./transaction-workflow.js";

export const FORMULA_VERSION = "integer-entitlements-v1";
export const ELIGIBILITY_RULE_VERSION = "eligibility-v1-local-demo-explicit";
export type EntitlementActor = InstrumentActor & { operationSource?: "HTTP" | "CONTROLLED_LOCALNET_CLI" };
const MAX_DB_INTEGER = (1n << 63n) - 1n;
const include = {
  instrument: true,
  snapshot: { include: { investors: { orderBy: { investorId: "asc" as const }, include: {
    investor: { include: { wallets: true } }, wallets: { include: { tokenAccounts: true } }
  } } } },
  entitlements: { orderBy: { investorId: "asc" as const } },
  blockchainTransactions: { where: { operationType: "REGISTER_SNAPSHOT", status: "FINALIZED" as const } }
} satisfies Prisma.CorporateActionInclude;
type Action = Prisma.CorporateActionGetPayload<{ include: typeof include }>;
type SnapshotInvestor = NonNullable<Action["snapshot"]>["investors"][number];
type Database = PrismaClient | Prisma.TransactionClient;

function requireVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "The current action version is required", 400);
  }
  return value as number;
}
function integer(value: bigint): bigint {
  if (value < 0n || value > MAX_DB_INTEGER) throw new TransactionWorkflowError("CALCULATION_RANGE", "Calculation exceeds the supported database range", 400);
  return value;
}
async function loadAction(database: Database, id: string) {
  if (!WORKFLOW_UUID.test(id)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action UUID is invalid", 400);
  const action = await database.corporateAction.findUnique({ where: { id }, include });
  if (!action) throw new TransactionWorkflowError("ACTION_NOT_FOUND", "Corporate action was not found", 404);
  return action;
}

/** Rebuilds the immutable relational payload; a status label alone is insufficient evidence. */
export function requireFinalizedEntitlementSnapshot(action: Action) {
  const snapshot = action.snapshot;
  if (!snapshot || snapshot.status !== "FINALIZED" || action.blockchainTransactions.length !== 1 ||
      !action.blockchainTransactions[0]!.signature || !action.instrument.mintAddress) {
    throw new TransactionWorkflowError("FINALIZED_SNAPSHOT_REQUIRED", "A finalized registered snapshot is required");
  }
  const commitment = createSnapshotV2Commitment({
    actionId: action.id, instrumentId: action.instrumentId,
    cluster: action.instrument.network === "SOLANA_LOCALNET" ? "localnet" : "devnet",
    networkGenesisHash: snapshot.networkGenesisHash, mintAddress: action.instrument.mintAddress,
    recordAt: snapshot.recordAt.toISOString(), solanaSlot: snapshot.solanaSlot,
    blockTime: snapshot.blockTime.toISOString(), createdAt: snapshot.createdAt.toISOString(), mintSupply: snapshot.mintSupply,
    investors: snapshot.investors.map(row => ({ investorId: row.investorId, eligibilityStatus: row.eligibilityStatus,
      wallets: row.wallets.map(wallet => ({ walletId: wallet.walletId, walletAddress: wallet.walletAddress,
        walletStatus: wallet.walletStatus, tokenAccounts: wallet.tokenAccounts.map(account => ({ address: account.address, balance: account.balance })) })) }))
  });
  const canonical = JSON.parse(commitment.canonicalJson) as Prisma.JsonValue;
  if (commitment.sha256 !== Buffer.from(snapshot.snapshotHash).toString("hex") ||
      !sameJson(canonical, snapshot.canonicalJson) || snapshot.instrumentId !== action.instrumentId ||
      snapshot.recordAt.getTime() !== action.recordAt.getTime() || snapshot.investorCount !== snapshot.investors.length ||
      snapshot.totalBalance !== snapshot.mintSupply || commitment.snapshot.wallet_count !== snapshot.walletCount ||
      snapshot.investors.some(row => row.balance.toString() !== commitment.snapshot.investors.find(item => item.investor_id === row.investorId)?.balance ||
        row.wallets.some(wallet => wallet.balance !== wallet.tokenAccounts.reduce((sum, account) => sum + account.balance, 0n)))) {
    throw new TransactionWorkflowError("SNAPSHOT_INTEGRITY", "Stored snapshot commitment and relational facts differ");
  }
  return commitment.sha256;
}
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  const a = left as Record<string, unknown>; const b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
function receiverChoices(action: Action, row: SnapshotInvestor) {
  return row.investor.wallets.filter(wallet => wallet.network === action.instrument.network && wallet.status === "ACTIVE" &&
    wallet.verifiedAt !== null && wallet.revokedAt === null).sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
}
function eligibility(action: Action, row: SnapshotInvestor, address: string) {
  const wallet = row.investor.wallets.find(item => item.address === address);
  return evaluateInvestorEligibility({ snapshotEligibility: row.eligibilityStatus, currentEligibility: row.investor.eligibilityStatus,
    investorStatus: row.investor.status, kycStatus: row.investor.kycStatus, instrumentStatus: action.instrument.status,
    payoutWalletStatus: wallet?.status ?? "PENDING", payoutWalletVerified: wallet?.verifiedAt !== null && wallet?.verifiedAt !== undefined && wallet.revokedAt === null,
    payoutWalletBelongsToInvestor: wallet?.investorId === row.investorId && wallet.network === action.instrument.network,
    localDemoReview: { network: action.instrument.network, reasonCode: row.investor.eligibilityReasonCode,
      reviewed: row.investor.eligibilityReviewedAt !== null } });
}
export function entitlementAmounts(type: Action["type"], balance: bigint, instrument: Pick<Action["instrument"], "faceValueMinor" | "couponRateBps" | "paymentsPerYear">,
  percentage: number | null, price: bigint | null) {
  if (type === "EARLY_REDEMPTION") {
    if (percentage === null || price === null) throw new TransactionWorkflowError("INVALID_REDEMPTION", "Early redemption parameters are missing");
    const result = calculateEarlyRedemption({ balance, percentageBps: percentage, redemptionPriceMinor: price });
    return { amountMinor: integer(result.amountMinor), tokensToRedeem: integer(result.redeemedTokens), roundingRemainder: (balance * BigInt(percentage) % 10_000n).toString(), denominator: "10000" };
  }
  const coupon = calculateCouponBreakdown({ balance, faceValueMinor: instrument.faceValueMinor,
    couponRateBps: instrument.couponRateBps, paymentsPerYear: instrument.paymentsPerYear });
  const amount = type === "BOND_REDEMPTION" ? calculatePrincipal({ balance, faceValueMinor: instrument.faceValueMinor }) + coupon.amountMinor : coupon.amountMinor;
  return { amountMinor: integer(amount), tokensToRedeem: type === "BOND_REDEMPTION" ? integer(balance) : 0n,
    roundingRemainder: coupon.remainder.toString(), denominator: coupon.denominator.toString() };
}
function exactAllocation(action: Action): EarlyRedemptionAllocation | null {
  if (redemptionAllocationPolicy(action) !== EARLY_REDEMPTION_ALLOCATION_POLICY) return null;
  if (!action.snapshot) throw new TransactionWorkflowError("FINALIZED_SNAPSHOT_REQUIRED", "Exact redemption requires a captured snapshot");
  return allocateEarlyRedemption({ targetTokens: action.redemptionTargetTokens!, rows: action.snapshot.investors.map(row => ({
    investorId: row.investorId, balance: row.balance,
    // Settlement-wallet revision must never change who receives a remainder token.
    tieAddress: redemptionTokenSources(action.snapshot!.investors, row.id).map(source => source.wallet).sort()[0]!
  })) });
}
function rowCalculation(action: Action, row: SnapshotInvestor, address: string, snapshotHash: string,
  allocation: EarlyRedemptionAllocation | null) {
  const allocated = allocation?.rows.find(item => item.investorId === row.investorId.toLowerCase());
  const result = allocated ? { amountMinor: integer(allocated.redeemedTokens * action.redemptionPriceMinor!),
    tokensToRedeem: integer(allocated.redeemedTokens), roundingRemainder: allocated.quotaRemainder.toString(),
    denominator: allocation!.denominator.toString() } :
    entitlementAmounts(action.type, row.balance, action.instrument, action.redemptionPercentageBps, action.redemptionPriceMinor);
  const decision = eligibility(action, row, address);
  const zero = result.amountMinor === 0n || action.type === "EARLY_REDEMPTION" && result.tokensToRedeem === 0n;
  const inputs = { actionType: action.type, snapshotId: action.snapshot!.id, snapshotHash, effectiveSlot: action.snapshot!.solanaSlot.toString(),
    effectiveBlockTime: action.snapshot!.blockTime.toISOString(), balance: row.balance.toString(), faceValueMinor: action.instrument.faceValueMinor.toString(),
    couponRateBps: action.instrument.couponRateBps, paymentsPerYear: action.instrument.paymentsPerYear,
    redemptionPercentageBps: action.redemptionPercentageBps, redemptionPriceMinor: action.redemptionPriceMinor?.toString() ?? null,
    ...(allocated ? { allocationPolicy: allocation!.policy, targetTokens: allocation!.targetTokens.toString(),
      totalBalance: allocation!.totalBalance.toString(), tieAddress: allocated.tieAddress, remainingTokens: allocated.remainingTokens.toString() } : {}),
    roundingRemainder: result.roundingRemainder, denominator: result.denominator,
    eligibilityRuleVersion: ELIGIBILITY_RULE_VERSION, eligible: decision.eligible, eligibilityReason: decision.reason };
  return { ...result, inputs, decision, zero };
}
function serializedEntitlement(row: Entitlement) {
  return { ...row, balanceAtRecordDate: row.balanceAtRecordDate.toString(), amountMinor: row.amountMinor.toString(), tokensToRedeem: row.tokensToRedeem.toString() };
}

function storedExactRedemptionSummary(action: Action) {
  if (redemptionAllocationPolicy(action) !== EARLY_REDEMPTION_ALLOCATION_POLICY || action.entitlements.length === 0) return null;
  requireFinalizedEntitlementSnapshot(action);
  const allocation = exactAllocation(action)!;
  if (action.entitlements.length !== allocation.rows.length ||
      new Set(action.entitlements.map(row => row.investorId)).size !== allocation.rows.length) {
    throw new TransactionWorkflowError("CALCULATION_CHANGED", "Exact redemption coverage differs from the snapshot");
  }
  for (const row of action.entitlements) {
    const expected = allocation.rows.find(item => item.investorId === row.investorId);
    const inputs = row.calculationInputs;
    if (!expected || row.formulaVersion !== allocation.policy || row.balanceAtRecordDate !== expected.balance ||
        row.tokensToRedeem !== expected.redeemedTokens || row.amountMinor !== expected.redeemedTokens * action.redemptionPriceMinor! ||
        !inputs || typeof inputs !== "object" || Array.isArray(inputs) || inputs["allocationPolicy"] !== allocation.policy ||
        inputs["targetTokens"] !== allocation.targetTokens.toString() || inputs["totalBalance"] !== allocation.totalBalance.toString() ||
        inputs["tieAddress"] !== expected.tieAddress || inputs["remainingTokens"] !== expected.remainingTokens.toString() ||
        inputs["roundingRemainder"] !== expected.quotaRemainder.toString() || inputs["denominator"] !== allocation.denominator.toString()) {
      throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored exact redemption differs from its immutable allocation");
    }
  }
  if (action.totalEntitlementMinor !== allocation.targetTokens * action.redemptionPriceMinor!) {
    throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored exact redemption total differs from its target");
  }
  return { policy: allocation.policy, targetTokens: allocation.targetTokens.toString(),
    allocatedTokens: action.entitlements.reduce((sum, row) => sum + row.tokensToRedeem, 0n).toString(),
    totalBalance: allocation.totalBalance.toString(), remainingTokens: (allocation.totalBalance - allocation.targetTokens).toString(),
    tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" as const };
}

function storedCouponInteger(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value)) {
    throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored coupon integer is invalid");
  }
  return BigInt(value);
}

/** Derived response metadata uses captured terms without changing commitments or payable amounts. */
function storedCouponSummary(action: Action) {
  if (action.type !== "COUPON_PAYMENT" || action.entitlements.length === 0) return null;
  if (!action.snapshot || action.snapshot.investors.length !== action.snapshot.investorCount ||
      action.entitlements.length !== action.snapshot.investorCount) {
    throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored coupon coverage differs from the snapshot");
  }
  try {
    let capturedTerms: string | undefined;
    const investorIds = new Set<string>();
    const rows = action.entitlements.map(row => {
      const inputs = row.calculationInputs;
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) ||
          row.formulaVersion !== FORMULA_VERSION || inputs["actionType"] !== "COUPON_PAYMENT" ||
          inputs["snapshotId"] !== action.snapshot!.id ||
          inputs["snapshotHash"] !== Buffer.from(action.snapshot!.snapshotHash).toString("hex") ||
          inputs["effectiveSlot"] !== action.snapshot!.solanaSlot.toString() ||
          inputs["effectiveBlockTime"] !== action.snapshot!.blockTime.toISOString() ||
          typeof inputs["couponRateBps"] !== "number" || typeof inputs["paymentsPerYear"] !== "number") {
        throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored coupon calculation inputs are invalid");
      }
      const balance = storedCouponInteger(inputs["balance"]);
      const faceValueMinor = storedCouponInteger(inputs["faceValueMinor"]);
      const remainder = storedCouponInteger(inputs["roundingRemainder"]);
      const denominator = storedCouponInteger(inputs["denominator"]);
      const investor = action.snapshot!.investors.find(item => item.id === row.snapshotInvestorId);
      if (!investor || investor.investorId !== row.investorId || investorIds.has(row.investorId) ||
          balance !== row.balanceAtRecordDate || balance !== investor.balance || row.tokensToRedeem !== 0n) {
        throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored coupon position differs from the snapshot");
      }
      investorIds.add(row.investorId);
      const terms = `${faceValueMinor}:${inputs["couponRateBps"]}:${inputs["paymentsPerYear"]}`;
      if (capturedTerms !== undefined && capturedTerms !== terms) {
        throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored coupon rows use different economic terms");
      }
      capturedTerms = terms;
      const expected = calculateCouponBreakdown({ balance, faceValueMinor,
        couponRateBps: inputs["couponRateBps"], paymentsPerYear: inputs["paymentsPerYear"] });
      if (row.amountMinor !== expected.amountMinor || remainder !== expected.remainder || denominator !== expected.denominator) {
        throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored coupon amount or rounding differs from captured terms");
      }
      return expected;
    });
    const summary = summarizeCouponBreakdowns(rows);
    if (summary.roundedTotalMinor !== action.totalEntitlementMinor) {
      throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored coupon total differs from its rows");
    }
    return {
      roundedTotalMinor: summary.roundedTotalMinor.toString(),
      theoreticalTotal: { numerator: summary.theoreticalTotal.numerator.toString(), denominator: summary.theoreticalTotal.denominator.toString() },
      roundingResidual: { numerator: summary.roundingResidual.numerator.toString(), denominator: summary.roundingResidual.denominator.toString() },
      roundingPolicy: "FLOOR_PER_INVESTOR" as const,
      residualDestination: "TREASURY" as const,
      taxTreatment: "NOT_IMPLEMENTED" as const
    };
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored coupon calculation is outside the supported range");
    }
    throw error;
  }
}

export async function getEntitlements(database: PrismaClient, id: string) {
  const action = await loadAction(database, id);
  const controlledRedemption = action.instrument.tokenPolicy === CONTROLLED_TOKEN_POLICY && action.type !== "COUPON_PAYMENT";
  const reservations = controlledRedemption ? await database.blockchainTransaction.findMany({ where: {
    corporateActionId: id, operationType: "CONTROLLED_UNIT_RESERVATION", status: "FINALIZED", signature: { not: null },
  } }) : [];
  return { actionId: id, actionVersion: action.version, actionType: action.type, status: action.status,
    tokenPolicy: action.instrument.tokenPolicy ?? LEGACY_TOKEN_POLICY,
    ...(redemptionAllocationPolicy(action) === EARLY_REDEMPTION_ALLOCATION_POLICY || action.instrument.tokenPolicy === CONTROLLED_TOKEN_POLICY ? {
      instrumentId: action.instrumentId, programId: action.instrument.programId, network: action.instrument.network,
      networkGenesisHash: action.snapshot?.networkGenesisHash ?? null,
      corporateActionAuthority: action.instrument.corporateActionAuthority
    } : {}),
    ...(action.type !== "COUPON_PAYMENT" ? { tokenMint: action.instrument.mintAddress } : {}),
    approvedById: action.approvedById, approvedAt: action.approvedAt, reviewNote: action.reviewNote,
    totalEntitlementMinor: action.totalEntitlementMinor.toString(), eligibleHolders: action.eligibleHolders,
    formulaVersion: redemptionAllocationPolicy(action), eligibilityRuleVersion: ELIGIBILITY_RULE_VERSION,
    redemptionAllocationPolicy: redemptionAllocationPolicy(action), redemptionTargetTokens: action.redemptionTargetTokens?.toString() ?? null,
    exactRedemptionSummary: storedExactRedemptionSummary(action),
    couponSummary: storedCouponSummary(action),
    items: await Promise.all(action.entitlements.map(async row => {
      const capturedInvestor = action.snapshot?.investors.find(item => item.id === row.snapshotInvestorId);
      if (!capturedInvestor || capturedInvestor.investorId !== row.investorId) {
        throw new TransactionWorkflowError("CALCULATION_CHANGED", "Entitlement is outside the snapshot");
      }
      const sources = action.type !== "COUPON_PAYMENT" ? redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId) : [];
      const plan = controlledRedemption ? await buildControlledUnitReservation({ programId: action.instrument.programId!, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(id),
        investorId: uuidBytes(row.investorId), corporateActionAuthority: action.instrument.corporateActionAuthority, bondMint: action.instrument.mintAddress!,
        tokenAccounts: sources, snapshotHash: Buffer.from(action.snapshot!.snapshotHash).toString("hex") }) : null;
      let unitReservationConfirmed = false;
      if (plan && row.onchainPda === plan.entitlementAddress) {
        const operation = reservations.find(value => value.entitlementId === row.id && value.investorId === row.investorId && value.instrumentId === action.instrumentId &&
          value.networkGenesisHash === action.snapshot!.networkGenesisHash && value.requiredSigner === action.instrument.corporateActionAuthority);
        if (operation) try {
          const payload = rpcObject(operation.preparedPayload);
          if (payload["tokenPolicy"] === CONTROLLED_TOKEN_POLICY && payload["snapshotHash"] === Buffer.from(action.snapshot!.snapshotHash).toString("hex") &&
              payload["entitlementAddress"] === plan.entitlementAddress && payload["tokensToRedeem"] === row.tokensToRedeem.toString()) {
            requireControlledReservationProof(payload["confirmedReservation"], { unitReservationAddress: plan.unitReservationAddress, sourceHash: plan.sourceHash,
              holdingAddresses: plan.holdingAddresses, tokenAccounts: sources, allocations: controlledBurnAllocations(sources, row.tokensToRedeem).map(source => source.burnAmount.toString()), consumed: false });
            unitReservationConfirmed = true;
          }
        } catch (error) { if (!(error instanceof TransactionWorkflowError)) throw error; }
      }
      return { ...serializedEntitlement(row), currentEligibility: eligibility(action, capturedInvestor, row.settlementWalletAddress),
        ...(plan ? { unitReservationAddress: plan.unitReservationAddress, unitReservationConfirmed } : {}),
        ...(action.type !== "COUPON_PAYMENT" ? { redemptionSources: redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId).map(source => ({
          address: source.address, walletAddress: source.wallet, balanceAtSnapshot: source.balanceAtSnapshot.toString() })) } : {}) };
    })),
    investors: action.snapshot?.investors.map(row => ({ investorId: row.investorId, displayName: row.investor.displayName,
      balance: row.balance.toString(), snapshotEligibility: row.eligibilityStatus,
      receiverWallets: receiverChoices(action, row).map(wallet => wallet.address) })) ?? [] };
}
async function changeStatus(tx: Prisma.TransactionClient, action: Action, status: Action["status"], data: Prisma.CorporateActionUncheckedUpdateManyInput = {}) {
  const changed = await tx.corporateAction.updateMany({ where: { id: action.id, version: action.version, status: action.status },
    data: { ...data, status, version: { increment: 1 } } });
  if (changed.count !== 1) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed; reload before continuing");
}
async function audit(tx: Prisma.TransactionClient, action: Action, actor: EntitlementActor, event: string, metadata: Prisma.InputJsonObject) {
  await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
    event, entityType: "CorporateAction", entityId: action.id, corporateActionId: action.id,
    metadataJson: { previousStatus: action.status, previousVersion: action.version, operationSource: actor.operationSource ?? "HTTP", ...metadata } } });
}
async function mutate(database: PrismaClient, id: string, version: number, actor: EntitlementActor, task: (tx: Prisma.TransactionClient, action: Action) => Promise<void>) {
  try {
    await database.$transaction(async tx => {
      const action = await loadAction(tx, id); requireActionIssuer(action.instrument, actor);
      if (action.version !== version) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action version changed; reload before continuing");
      requireFinalizedEntitlementSnapshot(action);
      // Persisted on-chain approval history remains authoritative when its feature flag is off.
      if (await tx.blockchainTransaction.findFirst({ where: { corporateActionId: id, status: { not: "FAILED" },
        operationType: { in: ["ACTION_APPROVER_ASSIGN", "ACTION_RESERVE_FUND", "ACTION_RESERVE_RELEASE", "ACTION_APPROVAL", "CONTROLLED_UNIT_RESERVATION"] }
      }, select: { id: true } })) {
        throw new TransactionWorkflowError("ONCHAIN_REVIEW_REQUIRED", "Use the on-chain reserve and separate approver workflow for this action");
      }
      await task(tx, action);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return await getEntitlements(database, id);
  } catch (error) {
    if (error instanceof DomainValidationError) throw new TransactionWorkflowError(error.code, error.message, 400);
    return workflowDatabaseError(error);
  }
}

/** Calculates once per investor. Revision retains the same immutable snapshot and entitlement IDs. */
export async function calculateEntitlements(database: PrismaClient, id: string, body: unknown, actor: EntitlementActor) {
  const input = actionInput(body, ["version", "receivers"]); const version = requireVersion(input["version"]);
  const receivers = input["receivers"] ?? {};
  if (!receivers || typeof receivers !== "object" || Array.isArray(receivers) ||
      Object.entries(receivers).some(([key, value]) => !WORKFLOW_UUID.test(key) || typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Receivers must map investor UUIDs to verified wallet addresses", 400);
  }
  const addresses = receivers as Record<string, string>;
  return mutate(database, id, version, actor, async (tx, action) => {
    if (!["SNAPSHOT_CREATED", "RETURNED_FOR_REVISION"].includes(action.status) || action.instrument.status !== "ACTIVE") {
      throw new TransactionWorkflowError("CALCULATION_NOT_ALLOWED", "Calculate only after finalized snapshot or return for revision");
    }
    if (Object.keys(addresses).some(investorId => !action.snapshot!.investors.some(row => row.investorId === investorId))) {
      throw new TransactionWorkflowError("INVALID_REQUEST", "Receiver investor is outside this snapshot", 400);
    }
    const hash = requireFinalizedEntitlementSnapshot(action); let total = 0n; let eligibleHolders = 0;
    const allocation = exactAllocation(action);
    const evidence: Prisma.InputJsonObject[] = [];
    for (const row of action.snapshot!.investors) {
      const choices = receiverChoices(action, row);
      const address = addresses[row.investorId] ?? (choices.length === 1 ? choices[0]!.address : undefined);
      if (!address || !choices.some(wallet => wallet.address === address)) {
        throw new TransactionWorkflowError("RECEIVER_REQUIRED", "Select one active verified receiver wallet for each investor", 400);
      }
      const calc = rowCalculation(action, row, address, hash, allocation);
      total = integer(total + calc.amountMinor); if (calc.decision.eligible && !calc.zero) eligibleHolders++;
      const data = { settlementWalletAddress: address, balanceAtRecordDate: row.balance, amountMinor: calc.amountMinor,
        tokensToRedeem: calc.tokensToRedeem, status: calc.zero ? "NOT_ELIGIBLE_ZERO_ROUNDING" as const : "CALCULATED" as const,
        formulaVersion: redemptionAllocationPolicy(action), calculationInputs: calc.inputs, eligibilityReason: calc.zero ? "ZERO_ROUNDING" : calc.decision.reason };
      const existing = action.entitlements.find(item => item.investorId === row.investorId);
      if (existing && (existing.executionAttempts !== 0 || existing.settlementSignature || existing.burnSignature || existing.onchainPda)) {
        throw new TransactionWorkflowError("ENTITLEMENT_EXECUTION_EXISTS", "An execution-bearing entitlement cannot be revised");
      }
      const saved = existing ? await tx.entitlement.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } }) :
        await tx.entitlement.create({ data: { ...data, corporateActionId: id, snapshotInvestorId: row.id, investorId: row.investorId } });
      evidence.push({ entitlementId: saved.id, investorId: row.investorId, receiver: address, amountMinor: calc.amountMinor.toString(),
        tokensToRedeem: calc.tokensToRedeem.toString(), eligible: calc.decision.eligible, reason: saved.eligibilityReason, inputs: calc.inputs });
    }
    await changeStatus(tx, action, "CALCULATED", { totalEntitlementMinor: total, eligibleHolders, approvedById: null, approvedAt: null });
    await audit(tx, action, actor, "ENTITLEMENTS_CALCULATED", { snapshotHash: hash, formulaVersion: redemptionAllocationPolicy(action),
      totalEntitlementMinor: total.toString(), eligibleHolders, entitlements: evidence });
  });
}

export async function reviewEntitlements(database: PrismaClient, id: string, body: unknown, actor: EntitlementActor,
  now = new Date(), requireOnchainFinalization = false) {
  const input = actionInput(body, ["version", "decision", "note"]); const version = requireVersion(input["version"]);
  const decision = input["decision"]; const note = actionText(input["note"], "Review note", 1000)!;
  if (!["SUBMIT", "APPROVE", "REJECT", "RETURN"].includes(String(decision))) throw new TransactionWorkflowError("INVALID_REQUEST", "Review decision is unsupported", 400);
  return mutate(database, id, version, actor, async (tx, action) => {
    if (decision !== "SUBMIT" && (redemptionAllocationPolicy(action) === EARLY_REDEMPTION_ALLOCATION_POLICY || action.instrument.tokenPolicy === CONTROLLED_TOKEN_POLICY)) {
      throw new TransactionWorkflowError("ONCHAIN_REVIEW_REQUIRED", "Exact target and controlled actions require their separate on-chain approver workflow");
    }
    if (decision !== "SUBMIT" && await tx.blockchainTransaction.findFirst({ where: { instrumentId: action.instrumentId,
      operationType: "ACTION_APPROVER_ASSIGN", status: "FINALIZED" }, select: { id: true } })) {
      throw new TransactionWorkflowError("ONCHAIN_REVIEW_REQUIRED", "This instrument requires its separate on-chain approver");
    }
    if (decision === "SUBMIT" ? action.status !== "CALCULATED" : action.status !== "UNDER_REVIEW") {
      throw new TransactionWorkflowError("REVIEW_NOT_ALLOWED", "Review decision does not match the current action status");
    }
    if (!action.entitlements.length || action.entitlements.length !== action.snapshot!.investorCount) {
      throw new TransactionWorkflowError("CALCULATION_INCOMPLETE", "All snapshot investors must have a stored calculation");
    }
    if (decision === "SUBMIT") verifyStoredCalculations(action, "CALCULATED");
    if (decision === "APPROVE") {
      if (requireOnchainFinalization && !await tx.blockchainTransaction.findFirst({ where: {
        corporateActionId: id, operationType: "CALCULATION_FINALIZE", status: "FINALIZED"
      }, select: { id: true } })) {
        throw new TransactionWorkflowError("ONCHAIN_CALCULATION_REQUIRED", "Finalize the registered on-chain calculation before approval");
      }
      verifyStoredCalculations(action, "CALCULATED");
      await tx.entitlement.updateMany({ where: { corporateActionId: id, status: "CALCULATED" }, data: { status: "READY", version: { increment: 1 } } });
    }
    const status = decision === "SUBMIT" ? "UNDER_REVIEW" : decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "RETURNED_FOR_REVISION";
    await changeStatus(tx, action, status, { reviewNote: note, approvedById: decision === "APPROVE" ? actor.id : null,
      approvedAt: decision === "APPROVE" ? now : null });
    await audit(tx, action, actor, "ENTITLEMENTS_REVIEW_DECIDED", { decision: String(decision), note, status,
      snapshotHash: Buffer.from(action.snapshot!.snapshotHash).toString("hex") });
  });
}

function verifyStoredCalculations(action: Action, positiveStatus: "CALCULATED" | "READY" | "EXECUTION", currentEligibility = true) {
  const hash = requireFinalizedEntitlementSnapshot(action); let total = 0n; let count = 0;
  const allocation = exactAllocation(action);
  if (action.entitlements.length !== action.snapshot!.investorCount ||
      new Set(action.entitlements.map(row => row.snapshotInvestorId)).size !== action.snapshot!.investorCount) {
    throw new TransactionWorkflowError("CALCULATION_INCOMPLETE", "Entitlement coverage differs from the snapshot");
  }
  for (const entitlement of action.entitlements) {
    const row = action.snapshot!.investors.find(item => item.id === entitlement.snapshotInvestorId);
    if (!row || entitlement.investorId !== row.investorId) throw new TransactionWorkflowError("CALCULATION_CHANGED", "Entitlement is outside the snapshot");
    const calc = rowCalculation(action, row, entitlement.settlementWalletAddress, hash, allocation);
    if (currentEligibility && !calc.decision.eligible) throw new TransactionWorkflowError("ELIGIBILITY_BLOCKED", `Operation is blocked: ${calc.decision.reason}`);
    const storedInputs = entitlement.calculationInputs;
    if (!storedInputs || typeof storedInputs !== "object" || Array.isArray(storedInputs)) {
      throw new TransactionWorkflowError("CALCULATION_CHANGED", "Committed calculation inputs are invalid");
    }
    // Confirmation/refund preserves the committed decision. Execution still rechecks current eligibility.
    const expectedInputs = currentEligibility ? calc.inputs : { ...calc.inputs, eligible: storedInputs["eligible"], eligibilityReason: storedInputs["eligibilityReason"] };
    if (!currentEligibility && (typeof storedInputs["eligible"] !== "boolean" || typeof storedInputs["eligibilityReason"] !== "string")) {
      throw new TransactionWorkflowError("CALCULATION_CHANGED", "Committed eligibility inputs are invalid");
    }
    if (entitlement.amountMinor !== calc.amountMinor || entitlement.tokensToRedeem !== calc.tokensToRedeem ||
        entitlement.balanceAtRecordDate !== row.balance || entitlement.formulaVersion !== redemptionAllocationPolicy(action) ||
        !sameJson(entitlement.calculationInputs, expectedInputs) ||
        (calc.zero ? entitlement.status !== "NOT_ELIGIBLE_ZERO_ROUNDING" : positiveStatus === "EXECUTION"
          ? !["READY", action.type === "COUPON_PAYMENT" ? "PAID" : "REDEEMED"].includes(entitlement.status) : entitlement.status !== positiveStatus)) {
      throw new TransactionWorkflowError("CALCULATION_CHANGED", "Stored calculation differs; return it for revision");
    }
    total = integer(total + calc.amountMinor); if (!calc.zero) count++;
  }
  if (count === 0 || total !== action.totalEntitlementMinor || count !== action.eligibleHolders) {
    throw new TransactionWorkflowError("CALCULATION_INCOMPLETE", "Totals or eligible holder count differ or no positive entitlement exists");
  }
}

/** Execution retains the committed calculation; only the selected unpaid receiver is rechecked before signing. */
export async function requireCouponExecutionCalculation(database: Database, id: string, receiverId?: string) {
  return requireExecutionCalculation(database, id, "COUPON", receiverId);
}

export async function requireRedemptionExecutionCalculation(database: Database, id: string, receiverId?: string) {
  return requireExecutionCalculation(database, id, "REDEMPTION", receiverId);
}

async function requireExecutionCalculation(database: Database, id: string, kind: "COUPON" | "REDEMPTION", receiverId?: string) {
  const action = await loadAction(database, id);
  if ((kind === "COUPON" ? action.type !== "COUPON_PAYMENT" : !["EARLY_REDEMPTION", "BOND_REDEMPTION"].includes(action.type)) ||
      !["APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "FINALIZED"].includes(action.status) ||
      !action.approvedById || !action.approvedAt || !action.reviewNote) {
    throw new TransactionWorkflowError("APPROVAL_REQUIRED", "Explicit on-chain action approval is required");
  }
  verifyStoredCalculations(action, "EXECUTION", false);
  if (action.processedEntitlements !== action.entitlements.filter(row => row.status === (kind === "COUPON" ? "PAID" : "REDEEMED")).length) {
    throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Application processed count differs from confirmed entitlements");
  }
  if (receiverId) {
    const entitlement = action.entitlements.find(row => row.id === receiverId);
    const investor = action.snapshot!.investors.find(row => row.id === entitlement?.snapshotInvestorId);
    if (!entitlement || !investor) throw new TransactionWorkflowError("ENTITLEMENT_NOT_FOUND", "Entitlement was not found", 404);
    if (entitlement.status !== "READY") throw new TransactionWorkflowError("ENTITLEMENT_ALREADY_EXECUTED", "Entitlement cannot be paid again");
    const decision = eligibility(action, investor, entitlement.settlementWalletAddress);
    if (!decision.eligible) throw new TransactionWorkflowError("ELIGIBILITY_BLOCKED", `Action execution is blocked: ${decision.reason}`);
  }
  return action;
}

/** Mandatory application gate for the subsequent execution slice; this function performs no payment. */
export async function requireApprovedEntitlements(database: Database, id: string, eligibility: "CURRENT" | "COMMITTED" = "CURRENT") {
  const action = await loadAction(database, id); requireFinalizedEntitlementSnapshot(action);
  if (action.status !== "APPROVED" || !action.approvedById || !action.approvedAt || !action.reviewNote ||
      !action.entitlements.some(row => row.status === "READY")) {
    throw new TransactionWorkflowError("APPROVAL_REQUIRED", "Explicit action approval is required before execution");
  }
  verifyStoredCalculations(action, "READY", eligibility === "CURRENT");
  return action;
}

/** Source gate for immutable on-chain registration; approval remains a later, separate decision. */
export async function requireSubmittedEntitlementCalculation(database: Database, id: string, eligibility: "CURRENT" | "COMMITTED" = "CURRENT") {
  const action = await loadAction(database, id);
  if (action.status !== "UNDER_REVIEW") {
    throw new TransactionWorkflowError("ONCHAIN_CALCULATION_NOT_READY", "On-chain registration requires submitted calculations under review");
  }
  verifyStoredCalculations(action, "CALCULATED", eligibility === "CURRENT");
  return action;
}

/** Called only inside the exact finalized on-chain approval projection transaction. */
export async function applyConfirmedActionApproval(database: Prisma.TransactionClient, id: string, version: number,
  actor: EntitlementActor, note: string, approvedAt: Date) {
  const action = await requireSubmittedEntitlementCalculation(database, id, "COMMITTED");
  if (action.version !== version) throw new TransactionWorkflowError("ACTION_CONFLICT", "Calculation changed during approval confirmation");
  await database.entitlement.updateMany({ where: { corporateActionId: id, status: "CALCULATED" },
    data: { status: "READY", version: { increment: 1 } } });
  await changeStatus(database, action, "APPROVED", { approvedById: actor.id, approvedAt, reviewNote: note });
}

/** Funding uses reviewed action calculations but cannot itself approve or execute them. */
export async function requireCouponFundingCalculation(database: Database, id: string) {
  const action = await loadAction(database, id);
  if (!["UNDER_REVIEW", "APPROVED"].includes(action.status)) {
    throw new TransactionWorkflowError("COUPON_CALCULATION_REQUIRED", "Action funding requires submitted or approved stored calculations");
  }
  verifyStoredCalculations(action, action.status === "APPROVED" ? "READY" : "CALCULATED");
  return action;
}
