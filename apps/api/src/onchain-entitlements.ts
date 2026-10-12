import { Prisma, type BlockchainTransaction, type PrismaClient } from "@prisma/client";
import { buildCalculationFinalization, buildCalculationReset, buildControlledRedemptionSourceRegistration, buildControlledUnitReservation, buildEntitlementRegistration, buildRedemptionSourceRegistration, decodeConfirmedCorporateAction,
  decodeConfirmedEntitlement, decodeRedemptionSources, deriveCorporateActionAddresses, serializeUnsignedInstructionsTransaction,
  type SolanaRpc } from "@lifecycle-kase/solana-client";
import type { InstrumentActor } from "./instrument-registry.js";
import { actionInput, workflowDatabaseError } from "./corporate-action-registry.js";
import { requireSubmittedEntitlementCalculation } from "./entitlements.js";
import { redemptionTokenSources } from "./redemption-sources.js";
import { onchainActionVersion, redemptionAllocationPolicy, verifyExactRedemptionTarget } from "./redemption-policy.js";
import type { InstrumentDeploymentOptions } from "./instrument-deployment.js";
import { requireControlledRegistry } from "./controlled-policy.js";
import { controlledBurnAllocations, controlledCaptureState, controlledReservationState } from "./controlled-settlement.js";
import { uuidBytes } from "./snapshot-registration.js";
import { ACTIVE_TRANSACTION_STATUSES, TransactionWorkflowError, WORKFLOW_UUID, requireAttemptSigner,
  requireWorkflowNetwork, resumeWorkflowAttempt, rpcNumber, rpcObject, submitWorkflowTransaction,
  verifyWorkflowFinalization, workflowBlockhash, workflowProgramAccount } from "./transaction-workflow.js";

export type OnchainCalculationOptions = InstrumentDeploymentOptions & { enabled: boolean; redemptionEnabled?: boolean; controlledRegistryEnabled?: boolean };
type Phase = "REGISTER" | "FINALIZE" | "RESET" | "RESERVE_UNITS";
const OPERATION = { REGISTER: "ENTITLEMENT_REGISTER", FINALIZE: "CALCULATION_FINALIZE", RESET: "CALCULATION_RESET", RESERVE_UNITS: "CONTROLLED_UNIT_RESERVATION" } as const;
const active = { in: [...ACTIVE_TRANSACTION_STATUSES] };

export function onchainCalculationEnabled(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value !== "true") throw new Error("ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED must be true or false");
  return true;
}
function requireEnabled(options: OnchainCalculationOptions) {
  if (!options.enabled || options.cluster !== "localnet") {
    throw new TransactionWorkflowError("ONCHAIN_CALCULATION_DISABLED", "On-chain calculation registration is not enabled for this environment", 503);
  }
}
function requireAuthority(action: { instrument: { corporateActionAuthority: string } }, actor: InstrumentActor) {
  if (action.instrument.corporateActionAuthority !== actor.walletAddress) {
    throw new TransactionWorkflowError("WALLET_MISMATCH", "Session wallet is not the corporate action authority", 403);
  }
}
function body(value: unknown, keys: string[]) {
  return actionInput(value, keys);
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TransactionWorkflowError("INVALID_REQUEST", "Current action version is required", 400);
  return value as number;
}
function prepared(operation: BlockchainTransaction, phase: Phase, cluster: string, resumed: boolean) {
  const payload = rpcObject(operation.preparedPayload);
  return { ...payload, operationId: operation.id, phase, status: operation.status, signature: operation.signature,
    requiredSigner: operation.requiredSigner, networkGenesisHash: operation.networkGenesisHash,
    recentBlockhash: operation.recentBlockhash, lastValidBlockHeight: operation.lastValidBlockHeight === null ? null : Number(operation.lastValidBlockHeight),
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", serializedTransactionBase64: operation.preparedTransactionBase64, cluster, resumed };
}
function assertNetwork(action: Awaited<ReturnType<typeof requireSubmittedEntitlementCalculation>>, options: OnchainCalculationOptions) {
  if (action.instrument.programId !== options.programId ||
      action.instrument.network !== (options.cluster === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET") ||
      action.snapshot?.networkGenesisHash !== options.expectedGenesisHash) {
    throw new TransactionWorkflowError("WRONG_SOLANA_NETWORK", "Calculation, instrument or snapshot network differs from configuration");
  }
}
function snapshotHash(action: Awaited<ReturnType<typeof requireSubmittedEntitlementCalculation>>) {
  return Buffer.from(action.snapshot!.snapshotHash).toString("hex");
}
function chainAction(base64: string, action: Awaited<ReturnType<typeof requireSubmittedEntitlementCalculation>>,
  instrumentAddress: string) {
  let chain;
  try { chain = decodeConfirmedCorporateAction(base64); }
  catch { throw new TransactionWorkflowError("ACTION_ACCOUNT_MISMATCH", "Action PDA data is invalid"); }
  if (chain.version !== onchainActionVersion(action) || !Buffer.from(chain.actionId).equals(Buffer.from(uuidBytes(action.id))) || chain.instrumentAddress !== instrumentAddress ||
      chain.type !== action.type || chain.recordAt !== BigInt(action.recordAt.getTime() / 1000) ||
      chain.executeAt !== BigInt(action.executeAt.getTime() / 1000) || chain.redemptionPercentageBps !== action.redemptionPercentageBps ||
      chain.redemptionPriceMinor !== action.redemptionPriceMinor ||
      chain.snapshotHash !== snapshotHash(action) || chain.investorCount !== action.snapshot!.investorCount ||
      chain.walletCount !== action.snapshot!.walletCount || chain.totalBalance !== action.snapshot!.totalBalance) {
    throw new TransactionWorkflowError("ACTION_ACCOUNT_MISMATCH", "Action PDA snapshot differs from stored calculations");
  }
  return chain;
}
function registeredTotals(action: Awaited<ReturnType<typeof requireSubmittedEntitlementCalculation>>) {
  const rows = action.entitlements.filter(row => row.onchainPda);
  return { count: rows.length, amount: rows.reduce((sum, row) => sum + row.amountMinor, 0n) };
}
async function checkedSource(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  actor: InstrumentActor, options: OnchainCalculationOptions) {
  requireEnabled(options); const action = await requireSubmittedEntitlementCalculation(database, actionId);
  requireControlledRegistry(action.instrument, options);
  requireAuthority(action, actor); assertNetwork(action, options); await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  if (action.instrument.status !== "ACTIVE") throw new TransactionWorkflowError("ONCHAIN_CALCULATION_NOT_READY", "Instrument must be active");
  if (action.type !== "COUPON_PAYMENT" && !options.redemptionEnabled) throw new TransactionWorkflowError("REDEMPTION_EXECUTION_DISABLED", "Redemption source registration requires the separately enabled candidate", 503);
  const addresses = await deriveCorporateActionAddresses(options.programId, uuidBytes(action.instrumentId), uuidBytes(action.id));
  const chain = chainAction(await workflowProgramAccount(rpc, addresses.actionAddress, options.programId), action, addresses.instrumentAddress);
  const targetAddress = await verifyExactRedemptionTarget(rpc, action, addresses.actionAddress, options.programId);
  return { action, addresses, chain, targetAddress };
}

async function requireClosedEntitlements(rpc: SolanaRpc, addresses: string[], minimumSlot: number) {
  for (const address of addresses) {
    const response = rpcObject(await rpc.request("getAccountInfo", [address,
      { commitment: "finalized", encoding: "base64", minContextSlot: minimumSlot }]));
    if (rpcNumber(rpcObject(response["context"])["slot"]) < minimumSlot || response["value"] !== null) {
      throw new TransactionWorkflowError("ENTITLEMENT_ACCOUNT_MISMATCH", "Reset entitlement account still exists at finalized commitment");
    }
  }
}

async function prepareUnitReservation(database: PrismaClient, rpc: SolanaRpc,
  action: Awaited<ReturnType<typeof requireSubmittedEntitlementCalculation>>, chain: ReturnType<typeof decodeConfirmedCorporateAction>,
  input: Record<string, unknown>, actor: InstrumentActor, options: OnchainCalculationOptions, now: Date, targetAddress: string | null) {
  if (!requireControlledRegistry(action.instrument, options) || action.type === "COUPON_PAYMENT") throw new TransactionWorkflowError("CONTROLLED_RESERVATION_NOT_READY", "Assigned-unit reservation requires controlled redemption");
  const entitlementId = input["entitlementId"];
  if (typeof entitlementId !== "string" || !WORKFLOW_UUID.test(entitlementId)) throw new TransactionWorkflowError("INVALID_REQUEST", "Entitlement UUID is required", 400);
  const row = action.entitlements.find(value => value.id === entitlementId);
  if (!row?.onchainPda || !["UNDER_REVIEW", "APPROVED"].includes(chain.status) || chain.registeredEntitlements !== action.entitlements.length || chain.totalAmountMinor !== action.totalEntitlementMinor) {
    throw new TransactionWorkflowError("CONTROLLED_RESERVATION_NOT_READY", "Finalize the complete on-chain calculation before reserving assigned units");
  }
  if (!await database.blockchainTransaction.findFirst({ where: { corporateActionId: action.id, operationType: OPERATION.FINALIZE, status: "FINALIZED", signature: { not: null } } })) {
    throw new TransactionWorkflowError("ONCHAIN_CALCULATION_REQUIRED", "Confirmed calculation finalization is required before assigned-unit reservation");
  }
  const existing = await database.blockchainTransaction.findFirst({ where: { entitlementId, operationType: OPERATION.RESERVE_UNITS, status: { not: "FAILED" } }, orderBy: { createdAt: "desc" } });
  if (existing) {
    requireAttemptSigner(existing, actor.walletAddress, options.expectedGenesisHash);
    if (existing.status === "FINALIZED" || await resumeWorkflowAttempt(database, rpc, existing, actor, options.expectedGenesisHash)) return prepared(existing, "RESERVE_UNITS", options.cluster, true);
  }
  const capture = (await controlledCaptureState(rpc, action, options, "CAPTURING"))!;
  const sources = redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId);
  const plan = await buildControlledUnitReservation({ programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(action.id),
    corporateActionAuthority: actor.walletAddress, investorId: uuidBytes(row.investorId), bondMint: action.instrument.mintAddress!, tokenAccounts: sources, snapshotHash: snapshotHash(action) });
  if (row.onchainPda !== plan.entitlementAddress) throw new TransactionWorkflowError("ENTITLEMENT_PDA_MISMATCH", "Stored entitlement differs from its canonical PDA");
  const committed = decodeRedemptionSources(await workflowProgramAccount(rpc, plan.sourceAddress, options.programId));
  if (committed.actionAddress !== plan.actionAddress || committed.entitlementAddress !== plan.entitlementAddress || committed.snapshotHash !== snapshotHash(action) || committed.sourceHash !== plan.sourceHash ||
      committed.tokenAccounts.length !== sources.length || committed.tokenAccounts.some((value, index) => value.address !== sources[index]!.address || value.wallet !== sources[index]!.wallet || value.balanceAtSnapshot !== sources[index]!.balanceAtSnapshot)) {
    throw new TransactionWorkflowError("REDEMPTION_SOURCES_INVALID", "Immutable source commitment differs before assigned-unit reservation");
  }
  const blockhash = await workflowBlockhash(rpc); let wire: string;
  try { wire = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: actor.walletAddress, ...blockhash }); }
  catch { throw new TransactionWorkflowError("CALCULATION_TRANSACTION_TOO_LARGE", "Assigned-unit reservation cannot fit in a Solana packet"); }
  const payload = { phase: "RESERVE_UNITS", corporateActionId: action.id, actionVersion: action.version, entitlementId, entitlementVersion: row.version,
    redemptionAllocationPolicy: redemptionAllocationPolicy(action), redemptionTargetTokens: action.redemptionTargetTokens?.toString() ?? null,
    ...(targetAddress ? { targetAddress } : {}),
    investorId: row.investorId, tokenPolicy: action.instrument.tokenPolicy!, programId: options.programId, instrumentAddress: plan.instrumentAddress,
    actionAddress: plan.actionAddress, entitlementAddress: plan.entitlementAddress, bondMint: action.instrument.mintAddress!, snapshotHash: snapshotHash(action),
    unitReservationAddress: plan.unitReservationAddress, holdingAddresses: plan.holdingAddresses, controlledPolicyAddress: plan.controlledPolicyAddress,
    controlledCaptureAddress: plan.controlledCaptureAddress, redemptionSourcesAddress: plan.sourceAddress, sourceHash: plan.sourceHash,
    redemptionProgressAddress: plan.progressAddress, settlementWallet: row.settlementWalletAddress, balanceAtSnapshot: row.balanceAtRecordDate.toString(),
    paymentAmountMinor: row.amountMinor.toString(), entitlementStatus: row.status,
    tokenAccounts: sources.map(source => ({ address: source.address, walletAddress: source.wallet, balanceAtSnapshot: source.balanceAtSnapshot.toString() })),
    tokensToRedeem: row.tokensToRedeem.toString(), allocations: controlledBurnAllocations(sources, row.tokensToRedeem).map(source => source.burnAmount.toString()),
    reservedEntitlementsBefore: capture.capture.reservedEntitlements, reservedTokensBefore: capture.capture.reservedTokens.toString() };
  try {
    const operation = await database.$transaction(async tx => {
      const current = await tx.corporateAction.findUnique({ where: { id: action.id }, select: { version: true, status: true } });
      const currentRow = await tx.entitlement.findUnique({ where: { id: entitlementId }, select: { version: true, onchainPda: true } });
      if (!current || current.version !== action.version || current.status !== "UNDER_REVIEW" || !currentRow || currentRow.version !== row.version || currentRow.onchainPda !== row.onchainPda) throw new TransactionWorkflowError("ACTION_CONFLICT", "Calculation changed during assigned-unit preparation");
      if (await tx.blockchainTransaction.findFirst({ where: { corporateActionId: action.id, status: active } })) throw new TransactionWorkflowError("CALCULATION_OPERATION_PENDING", "Reconcile the current action attempt before reserving assigned units");
      const created = await tx.blockchainTransaction.create({ data: { instrumentId: action.instrumentId, corporateActionId: action.id, entitlementId, investorId: row.investorId,
        operationType: OPERATION.RESERVE_UNITS, status: "PREPARED", createdAt: now, requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash,
        preparedTransactionBase64: wire, preparedPayload: payload, ...blockhash, lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight) } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId, event: "CONTROLLED_UNITS_PREPARED",
        entityType: "Entitlement", entityId: entitlementId, corporateActionId: action.id, blockchainTransactionId: created.id, metadataJson: { ...payload, onChain: false } } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return prepared(operation, "RESERVE_UNITS", options.cluster, false);
  } catch (error) { return workflowDatabaseError(error); }
}

async function confirmUnitReservation(database: PrismaClient, rpc: SolanaRpc,
  action: Awaited<ReturnType<typeof requireSubmittedEntitlementCalculation>>, operation: BlockchainTransaction,
  payload: Record<string, unknown>, signature: string, slot: number, actor: InstrumentActor, options: OnchainCalculationOptions, now: Date) {
  const row = action.entitlements.find(value => value.id === operation.entitlementId)!;
  const capture = (await controlledCaptureState(rpc, action, options, "CAPTURING", slot))!;
  const reservation = (await controlledReservationState(rpc, action, row, options, false, slot))!;
  const sources = redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId);
  if (reservation.unitReservationAddress !== payload["unitReservationAddress"] || reservation.sourceHash !== payload["sourceHash"] ||
      JSON.stringify(reservation.allocations) !== JSON.stringify(payload["allocations"]) ||
      capture.capture.reservedEntitlements !== Number(payload["reservedEntitlementsBefore"]) + 1 ||
      capture.capture.reservedTokens !== BigInt(String(payload["reservedTokensBefore"])) + row.tokensToRedeem ||
      sources.some(source => capture.capture.reservedSources[capture.capture.holdings.findIndex(value => value.tokenAccount === source.address)] !== 1)) {
    throw new TransactionWorkflowError("CONTROLLED_RESERVATION_MISMATCH", "Finalized assigned-unit reservation or capture counters differ from the saved terms");
  }
  try {
    await database.$transaction(async tx => {
      const current = await tx.corporateAction.findUnique({ where: { id: action.id }, select: { version: true, status: true } });
      const currentRow = await tx.entitlement.findUnique({ where: { id: row.id }, select: { version: true, onchainPda: true } });
      if (!current || current.version !== action.version || current.status !== "UNDER_REVIEW" || !currentRow || currentRow.version !== row.version || currentRow.onchainPda !== row.onchainPda) throw new TransactionWorkflowError("ACTION_CONFLICT", "Calculation changed during assigned-unit confirmation");
      const changed = await tx.blockchainTransaction.updateMany({ where: { id: operation.id, status: active, OR: [{ signature: null }, { signature }] },
        data: { signature, status: "FINALIZED", submittedAt: operation.submittedAt ?? now, finalizedAt: now, lastErrorCode: null,
          preparedPayload: { ...payload as Prisma.InputJsonObject, finalizedSlot: slot, confirmedReservation: reservation } } });
      if (changed.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Assigned-unit attempt changed during confirmation");
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId, event: "CONTROLLED_UNITS_FINALIZED",
        entityType: "Entitlement", entityId: row.id, corporateActionId: action.id, blockchainTransactionId: operation.id,
        metadataJson: { signature, finalizedSlot: slot, ...reservation } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return workflowDatabaseError(error); }
  return { operationId: operation.id, signature, phase: "RESERVE_UNITS" as const, status: "FINALIZED" as const, finalizedSlot: slot, ...reservation };
}

export async function prepareOnchainCalculation(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  request: unknown, actor: InstrumentActor, options: OnchainCalculationOptions, now = new Date()) {
  const input = body(request, ["phase", "version", "entitlementId"]); const phase = input["phase"] as Phase;
  if (!WORKFLOW_UUID.test(actionId) || !Object.hasOwn(OPERATION, String(phase))) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Calculation phase or action UUID is invalid", 400);
  }
  const expectedVersion = version(input["version"]); const { action, addresses, chain, targetAddress } = await checkedSource(database, rpc, actionId, actor, options);
  if (action.version !== expectedVersion) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action version changed; reload before continuing");
  const controlled = requireControlledRegistry(action.instrument, options);
  if (phase === "RESERVE_UNITS") return prepareUnitReservation(database, rpc, action, chain, input, actor, options, now, targetAddress);
  const entitlementId = phase === "REGISTER" ? input["entitlementId"] : null;
  if (phase === "REGISTER" && (typeof entitlementId !== "string" || !WORKFLOW_UUID.test(entitlementId))) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Entitlement UUID is required", 400);
  }
  if (phase !== "REGISTER" && input["entitlementId"] !== undefined) throw new TransactionWorkflowError("INVALID_REQUEST", "Calculation finalization/reset does not accept an entitlement UUID", 400);
  const entitlement = phase === "REGISTER" ? action.entitlements.find(row => row.id === entitlementId) : null;
  if (phase === "REGISTER" && (!entitlement || entitlement.onchainPda)) {
    throw new TransactionWorkflowError("ENTITLEMENT_NOT_READY", "Entitlement is missing or already registered");
  }
  const existing = await database.blockchainTransaction.findFirst({ where: phase === "REGISTER" ?
    { entitlementId: entitlement!.id, operationType: OPERATION.REGISTER, status: active } :
    { corporateActionId: actionId, operationType: OPERATION[phase], status: active }, orderBy: { createdAt: "desc" } });
  if (existing && await resumeWorkflowAttempt(database, rpc, existing, actor, options.expectedGenesisHash)) return prepared(existing, phase, options.cluster, true);
  const capture = controlled ? await controlledCaptureState(rpc, action, options, action.type === "COUPON_PAYMENT" ? "FINISHED" : "CAPTURING") : null;
  if (phase === "RESET" && capture && capture.capture.reservedEntitlements !== 0) throw new TransactionWorkflowError("CONTROLLED_RESERVATION_ACTIVE", "Assigned units cannot be discarded by a calculation reset");
  const blocker = await database.blockchainTransaction.findFirst({ where: {
    corporateActionId: actionId, status: active, operationType: phase === "REGISTER" ?
    { in: [OPERATION.FINALIZE, OPERATION.RESET, OPERATION.RESERVE_UNITS] } : { in: Object.values(OPERATION) }
  }, select: { id: true } });
  if (blocker) throw new TransactionWorkflowError("CALCULATION_OPERATION_PENDING", "Finish or reconcile the pending on-chain calculation operation first");
  const totals = registeredTotals(action);
  if (phase === "REGISTER" && (!(["SNAPSHOT_CREATED", "CALCULATED"] as string[]).includes(chain.status) ||
      chain.registeredEntitlements !== totals.count || chain.totalAmountMinor !== totals.amount)) {
    throw new TransactionWorkflowError("ACTION_ACCOUNT_MISMATCH", "Action PDA registration counters differ from confirmed database records");
  }
  if (phase === "FINALIZE" && (chain.status !== "CALCULATED" || totals.count !== action.entitlements.length ||
      chain.registeredEntitlements !== action.entitlements.length || chain.totalAmountMinor !== action.totalEntitlementMinor)) {
    throw new TransactionWorkflowError("CALCULATION_INCOMPLETE", "Every entitlement must be confirmed on chain before finalization");
  }
  if (phase === "RESET" && (chain.status !== "CALCULATED" || totals.count === 0 ||
      chain.registeredEntitlements !== totals.count || chain.totalAmountMinor !== totals.amount)) {
    throw new TransactionWorkflowError("CALCULATION_RESET_MISMATCH", "Reset requires the complete confirmed partial calculation");
  }
  const identity = { programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(action.id),
    corporateActionAuthority: actor.walletAddress, allocationPolicy: redemptionAllocationPolicy(action) };
  const registeredInvestorIds = action.entitlements.filter(row => row.onchainPda).map(row => uuidBytes(row.investorId));
  const redemption = action.type !== "COUPON_PAYMENT";
  const plan = phase === "REGISTER" ? await buildEntitlementRegistration({ ...identity,
    investorId: uuidBytes(entitlement!.investorId), snapshotHash: snapshotHash(action), settlementWallet: entitlement!.settlementWalletAddress,
    balanceAtSnapshot: entitlement!.balanceAtRecordDate, eligible: true,
    paymentAmountMinor: entitlement!.amountMinor, tokensToRedeem: entitlement!.tokensToRedeem }) :
    phase === "FINALIZE" ? await buildCalculationFinalization({ ...identity, investorIds: action.entitlements.map(row => uuidBytes(row.investorId)), redemption }) :
      await buildCalculationReset({ ...identity, investorIds: registeredInvestorIds, redemption });
  const sources = redemption && entitlement ? await (controlled ? buildControlledRedemptionSourceRegistration : buildRedemptionSourceRegistration)({ ...identity,
    investorId: uuidBytes(entitlement.investorId), bondMint: action.instrument.mintAddress!, snapshotHash: snapshotHash(action),
    tokenAccounts: redemptionTokenSources(action.snapshot!.investors, entitlement.snapshotInvestorId) }) : null;
  if (phase !== "REGISTER") {
    const rows = phase === "FINALIZE" ? action.entitlements : action.entitlements.filter(row => row.onchainPda);
    const addresses = (plan as Awaited<ReturnType<typeof buildCalculationFinalization>>).entitlementAddresses;
    if (rows.some((row, index) => row.onchainPda !== addresses[index])) {
      throw new TransactionWorkflowError("ENTITLEMENT_PDA_MISMATCH", "Stored entitlement PDA differs from the canonical investor address");
    }
  }
  const blockhash = await workflowBlockhash(rpc); let wire: string;
  try {
    wire = serializeUnsignedInstructionsTransaction({ instructions: [plan.instruction, ...(sources ? [sources.instruction] : [])], feePayer: actor.walletAddress, ...blockhash });
  } catch {
    throw new TransactionWorkflowError("CALCULATION_TRANSACTION_TOO_LARGE", "Calculation transaction cannot fit in a Solana packet", 409);
  }
  const payload = { corporateActionId: action.id, actionVersion: action.version, phase, programId: options.programId,
    tokenPolicy: action.instrument.tokenPolicy ?? "LEGACY_UNRESTRICTED_V1",
    ...(capture ? { controlledPolicyAddress: capture.controlledPolicyAddress, controlledCaptureAddress: capture.controlledCaptureAddress } : {}),
    actionAddress: addresses.actionAddress, instrumentAddress: addresses.instrumentAddress, snapshotHash: snapshotHash(action),
    redemptionAllocationPolicy: redemptionAllocationPolicy(action), redemptionTargetTokens: action.redemptionTargetTokens?.toString() ?? null,
    ...("targetAddress" in plan && plan.targetAddress ? { targetAddress: plan.targetAddress } : {}),
    ...(phase === "REGISTER" ? { entitlementId: entitlement!.id, entitlementVersion: entitlement!.version,
      entitlementAddress: (plan as Awaited<ReturnType<typeof buildEntitlementRegistration>>).entitlementAddress,
      investorId: entitlement!.investorId, settlementWallet: entitlement!.settlementWalletAddress,
      balanceAtSnapshot: entitlement!.balanceAtRecordDate.toString(), paymentAmountMinor: entitlement!.amountMinor.toString(),
      tokensToRedeem: entitlement!.tokensToRedeem.toString(), entitlementStatus: entitlement!.status } :
      { entitlementAddresses: (plan as Awaited<ReturnType<typeof buildCalculationFinalization>>).entitlementAddresses,
        entitlementCount: phase === "FINALIZE" ? action.entitlements.length : totals.count,
        totalAmountMinor: (phase === "FINALIZE" ? action.totalEntitlementMinor : totals.amount).toString(),
        ...(redemption ? { redemptionProgressAddress: (plan as Awaited<ReturnType<typeof buildCalculationFinalization>>).progressAddress!,
          sourceAddresses: (plan as Awaited<ReturnType<typeof buildCalculationFinalization>>).sourceAddresses } : {}) }),
    ...(sources ? { redemptionSourcesAddress: sources.sourceAddress, redemptionProgressAddress: sources.progressAddress, sourceHash: sources.sourceHash,
      bondMint: action.instrument.mintAddress!, tokenAccounts: sources.tokenAccounts.map(value => ({ address: value.address, walletAddress: value.wallet, balanceAtSnapshot: value.balanceAtSnapshot.toString() })) } : {}) };
  try {
    const operation = await database.$transaction(async tx => {
      const current = await tx.corporateAction.findUnique({ where: { id: action.id }, select: { version: true, status: true } });
      if (!current || current.version !== action.version || current.status !== "UNDER_REVIEW") throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed during preparation");
      if (entitlement) {
        const row = await tx.entitlement.findUnique({ where: { id: entitlement.id }, select: { version: true, onchainPda: true } });
        if (!row || row.version !== entitlement.version || row.onchainPda) throw new TransactionWorkflowError("ENTITLEMENT_CONFLICT", "Entitlement changed during preparation");
      }
      const row = await tx.blockchainTransaction.create({ data: { instrumentId: action.instrumentId, corporateActionId: action.id,
        entitlementId: entitlement?.id ?? null, investorId: entitlement?.investorId ?? null, operationType: OPERATION[phase], status: "PREPARED", createdAt: now,
        ...blockhash, lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight), requiredSigner: actor.walletAddress,
        networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: wire, preparedPayload: payload } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: phase === "REGISTER" ? "ENTITLEMENT_ONCHAIN_PREPARED" : phase === "FINALIZE" ?
          "CALCULATION_ONCHAIN_FINALIZATION_PREPARED" : "CALCULATION_ONCHAIN_RESET_PREPARED",
        entityType: phase === "REGISTER" ? "Entitlement" : "CorporateAction", entityId: entitlement?.id ?? action.id,
        corporateActionId: action.id, blockchainTransactionId: row.id,
        metadataJson: { ...payload, onChain: false } } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return prepared(operation, phase, options.cluster, false);
  } catch (error) { return workflowDatabaseError(error); }
}

async function attempt(database: PrismaClient, rpc: SolanaRpc, actionId: string, request: unknown,
  actor: InstrumentActor, options: OnchainCalculationOptions, submit: boolean) {
  requireEnabled(options); const input = body(request, submit ? ["phase", "operationId", "signedTransactionBase64"] : ["phase", "operationId", "signature"]);
  const phase = input["phase"] as Phase;
  if (!WORKFLOW_UUID.test(actionId) || !Object.hasOwn(OPERATION, String(phase)) ||
      typeof input["operationId"] !== "string" || !WORKFLOW_UUID.test(input["operationId"])) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Calculation operation request is invalid", 400);
  }
  const action = await requireSubmittedEntitlementCalculation(database, actionId); requireAuthority(action, actor); assertNetwork(action, options);
  requireControlledRegistry(action.instrument, options);
  if (action.type !== "COUPON_PAYMENT" && !options.redemptionEnabled) throw new TransactionWorkflowError("REDEMPTION_EXECUTION_DISABLED", "Redemption source registration requires the separately enabled candidate", 503);
  const operation = await database.blockchainTransaction.findUnique({ where: { id: input["operationId"] } });
  if (!operation || operation.corporateActionId !== actionId || operation.operationType !== OPERATION[phase] ||
      ["REGISTER", "RESERVE_UNITS"].includes(phase) && !operation.entitlementId) throw new TransactionWorkflowError("CALCULATION_OPERATION_NOT_FOUND", "Calculation operation was not found", 404);
  requireAttemptSigner(operation, actor.walletAddress, options.expectedGenesisHash);
  const payload = rpcObject(operation.preparedPayload);
  if (payload["actionVersion"] !== action.version || payload["snapshotHash"] !== snapshotHash(action)) {
    throw new TransactionWorkflowError("ACTION_CONFLICT", "Stored calculation changed after preparation");
  }
  if (phase === "REGISTER") {
    const row = action.entitlements.find(item => item.id === operation.entitlementId);
    if (!row) throw new TransactionWorkflowError("ENTITLEMENT_CONFLICT", "Entitlement changed after preparation");
    const preparedVersion = payload["entitlementVersion"];
    const finalizedProjection = operation.status === "FINALIZED" && row.onchainPda === payload["entitlementAddress"] &&
      typeof preparedVersion === "number" && row.version === preparedVersion + 1;
    if (!finalizedProjection && (preparedVersion !== row.version || row.onchainPda)) {
      throw new TransactionWorkflowError("ENTITLEMENT_CONFLICT", "Entitlement changed after preparation");
    }
  }
  if (phase === "RESERVE_UNITS") {
    const row = action.entitlements.find(item => item.id === operation.entitlementId);
    if (!row || row.version !== payload["entitlementVersion"] || row.onchainPda !== payload["entitlementAddress"]) throw new TransactionWorkflowError("ENTITLEMENT_CONFLICT", "Reserved entitlement changed after preparation");
  }
  return { input, phase, action, operation, payload };
}

export async function submitOnchainCalculation(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  request: unknown, actor: InstrumentActor, options: OnchainCalculationOptions) {
  const { input, phase, action, operation } = await attempt(database, rpc, actionId, request, actor, options, true);
  if (typeof input["signedTransactionBase64"] !== "string") throw new TransactionWorkflowError("INVALID_REQUEST", "Signed transaction bytes are required", 400);
  return { ...await submitWorkflowTransaction(database, rpc, operation, input["signedTransactionBase64"], actor,
    { ...options, ...(requireControlledRegistry(action.instrument, options) ? { confirmationOnlyAfterSubmission: true } : {}) }), phase };
}

export async function confirmOnchainCalculation(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  request: unknown, actor: InstrumentActor, options: OnchainCalculationOptions, now = new Date()) {
  const { input, phase, action, operation, payload } = await attempt(database, rpc, actionId, request, actor, options, false);
  const signature = input["signature"];
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new TransactionWorkflowError("INVALID_REQUEST", "Transaction signature is invalid", 400);
  if (operation.status === "FINALIZED") {
    if (operation.signature !== signature) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Finalized operation has another signature");
    return { operationId: operation.id, signature, phase, status: "FINALIZED" as const };
  }
  const slot = await verifyWorkflowFinalization(database, rpc, operation, signature, actor, options.expectedGenesisHash);
  if (phase === "RESERVE_UNITS") return confirmUnitReservation(database, rpc, action, operation, payload, signature, slot, actor, options, now);
  const actionAddress = String(payload["actionAddress"]); const instrumentAddress = String(payload["instrumentAddress"]);
  const chain = chainAction(await workflowProgramAccount(rpc, actionAddress, options.programId, slot), action, instrumentAddress);
  await verifyExactRedemptionTarget(rpc, action, actionAddress, options.programId, slot);
  let entitlementAddress: string | null = null;
  if (phase === "REGISTER") {
    entitlementAddress = String(payload["entitlementAddress"]); let row;
    try { row = decodeConfirmedEntitlement(await workflowProgramAccount(rpc, entitlementAddress, options.programId, slot)); }
    catch { throw new TransactionWorkflowError("ENTITLEMENT_ACCOUNT_MISMATCH", "Finalized entitlement account is invalid"); }
    const expectedStatus = payload["entitlementStatus"] === "NOT_ELIGIBLE_ZERO_ROUNDING" ? "NOT_ELIGIBLE_ZERO_ROUNDING" : "READY";
    if (row.version !== onchainActionVersion(action) || row.actionAddress !== actionAddress || !Buffer.from(row.investorId).equals(Buffer.from(uuidBytes(String(payload["investorId"])))) ||
        row.snapshotHash !== payload["snapshotHash"] || row.settlementWallet !== payload["settlementWallet"] ||
        row.balanceAtSnapshot.toString() !== payload["balanceAtSnapshot"] || row.paymentAmountMinor.toString() !== payload["paymentAmountMinor"] ||
        row.tokensToRedeem.toString() !== payload["tokensToRedeem"] || row.status !== expectedStatus || row.executedAt !== null ||
        chain.status !== "CALCULATED" || chain.registeredEntitlements < 1 || chain.registeredEntitlements > action.entitlements.length ||
        chain.totalAmountMinor < row.paymentAmountMinor || chain.totalAmountMinor > action.totalEntitlementMinor) {
      throw new TransactionWorkflowError("ENTITLEMENT_ACCOUNT_MISMATCH", "Finalized entitlement facts differ from the prepared calculation");
    }
    if (action.type !== "COUPON_PAYMENT") {
      const committed = decodeRedemptionSources(await workflowProgramAccount(rpc, String(payload["redemptionSourcesAddress"]), options.programId, slot));
      const entitlement = action.entitlements.find(value => value.id === operation.entitlementId)!;
      const expected = redemptionTokenSources(action.snapshot!.investors, entitlement.snapshotInvestorId);
      if (committed.actionAddress !== actionAddress || committed.entitlementAddress !== entitlementAddress || committed.snapshotHash !== payload["snapshotHash"] ||
          committed.sourceHash !== payload["sourceHash"] || committed.tokenAccounts.length !== expected.length ||
          committed.tokenAccounts.some((value, index) => value.address !== expected[index]!.address || value.wallet !== expected[index]!.wallet || value.balanceAtSnapshot !== expected[index]!.balanceAtSnapshot)) {
        throw new TransactionWorkflowError("REDEMPTION_SOURCES_INVALID", "Finalized source commitment differs from the complete snapshot account set");
      }
    }
  } else if (phase === "FINALIZE") {
    if (chain.status !== "UNDER_REVIEW" || chain.registeredEntitlements !== action.entitlements.length ||
        chain.totalAmountMinor !== action.totalEntitlementMinor) {
      throw new TransactionWorkflowError("ACTION_ACCOUNT_MISMATCH", "Finalized on-chain calculation is incomplete");
    }
  } else {
    const addresses = payload["entitlementAddresses"];
    if (chain.status !== "SNAPSHOT_CREATED" || chain.registeredEntitlements !== 0 || chain.totalAmountMinor !== 0n ||
        !Array.isArray(addresses) || addresses.length === 0 || addresses.some(address => typeof address !== "string")) {
      throw new TransactionWorkflowError("ACTION_ACCOUNT_MISMATCH", "Finalized calculation reset did not clear the Action PDA");
    }
    await requireClosedEntitlements(rpc, addresses as string[], slot);
    if (action.type !== "COUPON_PAYMENT") {
      const sourceAddresses = payload["sourceAddresses"];
      if (!Array.isArray(sourceAddresses) || sourceAddresses.length !== addresses.length || sourceAddresses.some(value => typeof value !== "string") || typeof payload["redemptionProgressAddress"] !== "string") {
        throw new TransactionWorkflowError("REDEMPTION_SOURCES_INVALID", "Reset source account set is incomplete");
      }
      await requireClosedEntitlements(rpc, [...sourceAddresses as string[], payload["redemptionProgressAddress"]], slot);
    }
  }
  try {
    await database.$transaction(async tx => {
      const current = await tx.corporateAction.findUnique({ where: { id: action.id }, select: { version: true, status: true } });
      if (!current || current.version !== action.version || current.status !== "UNDER_REVIEW") throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed during confirmation");
      if (phase === "REGISTER") {
        const changed = await tx.entitlement.updateMany({ where: { id: operation.entitlementId!, version: Number(payload["entitlementVersion"]), onchainPda: null },
          data: { onchainPda: entitlementAddress!, version: { increment: 1 } } });
        if (changed.count !== 1) throw new TransactionWorkflowError("ENTITLEMENT_CONFLICT", "Entitlement changed during confirmation");
      } else if (phase === "RESET") {
        const addresses = payload["entitlementAddresses"] as string[];
        const changed = await tx.entitlement.updateMany({ where: { corporateActionId: action.id, onchainPda: { in: addresses } },
          data: { onchainPda: null, version: { increment: 1 } } });
        if (changed.count !== addresses.length) throw new TransactionWorkflowError("ENTITLEMENT_CONFLICT", "Reset entitlement projection changed during confirmation");
      }
      const confirmed = await tx.blockchainTransaction.updateMany({ where: { id: operation.id, status: active, OR: [{ signature: null }, { signature }] },
        data: { signature, status: "FINALIZED", submittedAt: operation.submittedAt ?? now, finalizedAt: now, lastErrorCode: null } });
      if (confirmed.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Calculation operation changed concurrently");
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: phase === "REGISTER" ? "ENTITLEMENT_ONCHAIN_FINALIZED" : phase === "FINALIZE" ?
          "CALCULATION_ONCHAIN_UNDER_REVIEW" : "CALCULATION_ONCHAIN_RESET",
        entityType: phase === "REGISTER" ? "Entitlement" : "CorporateAction", entityId: operation.entitlementId ?? action.id,
        corporateActionId: action.id, blockchainTransactionId: operation.id,
        metadataJson: { signature, finalizedSlot: slot, actionAddress, entitlementAddress, onChainStatus: chain.status } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return workflowDatabaseError(error); }
  return { operationId: operation.id, signature, phase, actionAddress, entitlementAddress, finalizedSlot: slot, status: "FINALIZED" as const };
}
