import { Prisma, type BlockchainTransaction, type PrismaClient } from "@prisma/client";
import { buildCalculationFinalization, buildCalculationReset, buildEntitlementRegistration, decodeConfirmedCorporateAction,
  decodeConfirmedEntitlement, deriveCorporateActionAddresses, serializeUnsignedInstructionsTransaction,
  type SolanaRpc } from "@lifecycle-kase/solana-client";
import type { InstrumentActor } from "./instrument-registry.js";
import { actionInput, workflowDatabaseError } from "./corporate-action-registry.js";
import { requireSubmittedEntitlementCalculation } from "./entitlements.js";
import type { InstrumentDeploymentOptions } from "./instrument-deployment.js";
import { uuidBytes } from "./snapshot-registration.js";
import { ACTIVE_TRANSACTION_STATUSES, TransactionWorkflowError, WORKFLOW_UUID, requireAttemptSigner,
  requireWorkflowNetwork, resumeWorkflowAttempt, rpcNumber, rpcObject, submitWorkflowTransaction,
  verifyWorkflowFinalization, workflowBlockhash, workflowProgramAccount } from "./transaction-workflow.js";

export type OnchainCalculationOptions = InstrumentDeploymentOptions & { enabled: boolean };
type Phase = "REGISTER" | "FINALIZE" | "RESET";
const OPERATION = { REGISTER: "ENTITLEMENT_REGISTER", FINALIZE: "CALCULATION_FINALIZE", RESET: "CALCULATION_RESET" } as const;
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
  if (!Buffer.from(chain.actionId).equals(Buffer.from(uuidBytes(action.id))) || chain.instrumentAddress !== instrumentAddress ||
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
  requireAuthority(action, actor); assertNetwork(action, options); await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  if (action.instrument.status !== "ACTIVE") throw new TransactionWorkflowError("ONCHAIN_CALCULATION_NOT_READY", "Instrument must be active");
  const addresses = await deriveCorporateActionAddresses(options.programId, uuidBytes(action.instrumentId), uuidBytes(action.id));
  const chain = chainAction(await workflowProgramAccount(rpc, addresses.actionAddress, options.programId), action, addresses.instrumentAddress);
  return { action, addresses, chain };
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

export async function prepareOnchainCalculation(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  request: unknown, actor: InstrumentActor, options: OnchainCalculationOptions, now = new Date()) {
  const input = body(request, ["phase", "version", "entitlementId"]); const phase = input["phase"] as Phase;
  if (!WORKFLOW_UUID.test(actionId) || !["REGISTER", "FINALIZE", "RESET"].includes(String(phase))) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Calculation phase or action UUID is invalid", 400);
  }
  const expectedVersion = version(input["version"]); const { action, addresses, chain } = await checkedSource(database, rpc, actionId, actor, options);
  if (action.version !== expectedVersion) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action version changed; reload before continuing");
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
  const blocker = await database.blockchainTransaction.findFirst({ where: {
    corporateActionId: actionId, status: active, operationType: phase === "REGISTER" ?
      { in: [OPERATION.FINALIZE, OPERATION.RESET] } : { in: [OPERATION.REGISTER, OPERATION.FINALIZE, OPERATION.RESET] }
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
    corporateActionAuthority: actor.walletAddress };
  const registeredInvestorIds = action.entitlements.filter(row => row.onchainPda).map(row => uuidBytes(row.investorId));
  const plan = phase === "REGISTER" ? await buildEntitlementRegistration({ ...identity,
    investorId: uuidBytes(entitlement!.investorId), snapshotHash: snapshotHash(action), settlementWallet: entitlement!.settlementWalletAddress,
    balanceAtSnapshot: entitlement!.balanceAtRecordDate, eligible: true,
    paymentAmountMinor: entitlement!.amountMinor, tokensToRedeem: entitlement!.tokensToRedeem }) :
    phase === "FINALIZE" ? await buildCalculationFinalization({ ...identity, investorIds: action.entitlements.map(row => uuidBytes(row.investorId)) }) :
      await buildCalculationReset({ ...identity, investorIds: registeredInvestorIds });
  if (phase !== "REGISTER") {
    const rows = phase === "FINALIZE" ? action.entitlements : action.entitlements.filter(row => row.onchainPda);
    const addresses = (plan as Awaited<ReturnType<typeof buildCalculationFinalization>>).entitlementAddresses;
    if (rows.some((row, index) => row.onchainPda !== addresses[index])) {
      throw new TransactionWorkflowError("ENTITLEMENT_PDA_MISMATCH", "Stored entitlement PDA differs from the canonical investor address");
    }
  }
  const blockhash = await workflowBlockhash(rpc); let wire: string;
  try {
    wire = serializeUnsignedInstructionsTransaction({ instructions: [plan.instruction], feePayer: actor.walletAddress, ...blockhash });
  } catch {
    throw new TransactionWorkflowError("CALCULATION_TRANSACTION_TOO_LARGE", "Calculation transaction cannot fit in a Solana packet", 409);
  }
  const payload = { corporateActionId: action.id, actionVersion: action.version, phase, programId: options.programId,
    actionAddress: addresses.actionAddress, instrumentAddress: addresses.instrumentAddress, snapshotHash: snapshotHash(action),
    ...(phase === "REGISTER" ? { entitlementId: entitlement!.id, entitlementVersion: entitlement!.version,
      entitlementAddress: (plan as Awaited<ReturnType<typeof buildEntitlementRegistration>>).entitlementAddress,
      investorId: entitlement!.investorId, settlementWallet: entitlement!.settlementWalletAddress,
      balanceAtSnapshot: entitlement!.balanceAtRecordDate.toString(), paymentAmountMinor: entitlement!.amountMinor.toString(),
      tokensToRedeem: entitlement!.tokensToRedeem.toString(), entitlementStatus: entitlement!.status } :
      { entitlementAddresses: (plan as Awaited<ReturnType<typeof buildCalculationFinalization>>).entitlementAddresses,
        entitlementCount: phase === "FINALIZE" ? action.entitlements.length : totals.count,
        totalAmountMinor: (phase === "FINALIZE" ? action.totalEntitlementMinor : totals.amount).toString() }) };
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
  if (!WORKFLOW_UUID.test(actionId) || !["REGISTER", "FINALIZE", "RESET"].includes(String(phase)) ||
      typeof input["operationId"] !== "string" || !WORKFLOW_UUID.test(input["operationId"])) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Calculation operation request is invalid", 400);
  }
  const action = await requireSubmittedEntitlementCalculation(database, actionId); requireAuthority(action, actor); assertNetwork(action, options);
  const operation = await database.blockchainTransaction.findUnique({ where: { id: input["operationId"] } });
  if (!operation || operation.corporateActionId !== actionId || operation.operationType !== OPERATION[phase] ||
      phase === "REGISTER" && !operation.entitlementId) throw new TransactionWorkflowError("CALCULATION_OPERATION_NOT_FOUND", "Calculation operation was not found", 404);
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
  return { input, phase, action, operation, payload };
}

export async function submitOnchainCalculation(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  request: unknown, actor: InstrumentActor, options: OnchainCalculationOptions) {
  const { input, phase, operation } = await attempt(database, rpc, actionId, request, actor, options, true);
  if (typeof input["signedTransactionBase64"] !== "string") throw new TransactionWorkflowError("INVALID_REQUEST", "Signed transaction bytes are required", 400);
  return { ...await submitWorkflowTransaction(database, rpc, operation, input["signedTransactionBase64"], actor, options), phase };
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
  const actionAddress = String(payload["actionAddress"]); const instrumentAddress = String(payload["instrumentAddress"]);
  const chain = chainAction(await workflowProgramAccount(rpc, actionAddress, options.programId, slot), action, instrumentAddress);
  let entitlementAddress: string | null = null;
  if (phase === "REGISTER") {
    entitlementAddress = String(payload["entitlementAddress"]); let row;
    try { row = decodeConfirmedEntitlement(await workflowProgramAccount(rpc, entitlementAddress, options.programId, slot)); }
    catch { throw new TransactionWorkflowError("ENTITLEMENT_ACCOUNT_MISMATCH", "Finalized entitlement account is invalid"); }
    const expectedStatus = payload["entitlementStatus"] === "NOT_ELIGIBLE_ZERO_ROUNDING" ? "NOT_ELIGIBLE_ZERO_ROUNDING" : "READY";
    if (row.actionAddress !== actionAddress || !Buffer.from(row.investorId).equals(Buffer.from(uuidBytes(String(payload["investorId"])))) ||
        row.snapshotHash !== payload["snapshotHash"] || row.settlementWallet !== payload["settlementWallet"] ||
        row.balanceAtSnapshot.toString() !== payload["balanceAtSnapshot"] || row.paymentAmountMinor.toString() !== payload["paymentAmountMinor"] ||
        row.tokensToRedeem.toString() !== payload["tokensToRedeem"] || row.status !== expectedStatus || row.executedAt !== null ||
        chain.status !== "CALCULATED" || chain.registeredEntitlements < 1 || chain.registeredEntitlements > action.entitlements.length ||
        chain.totalAmountMinor < row.paymentAmountMinor || chain.totalAmountMinor > action.totalEntitlementMinor) {
      throw new TransactionWorkflowError("ENTITLEMENT_ACCOUNT_MISMATCH", "Finalized entitlement facts differ from the prepared calculation");
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
