import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type BlockchainTransaction } from "@prisma/client";
import { reconcileSettlementLegs } from "@lifecycle-kase/domain";
import { ACTION_RECEIPT_BYTES, ENTITLEMENT_RECEIPT_BYTES, buildCouponExecution, buildCouponFinalization,
  decodeActionReceipt, decodeActionReserve, decodeApprovalPolicy, decodeConfirmedCorporateAction, decodeConfirmedEntitlement,
  decodeEntitlementReceipt, decodeFundingTreasury, decodeReserveMint, deriveActionApprovalAddresses,
  fundingMessageBase64, fundingTreasuryIndex, serializeUnsignedInstructionsTransaction, SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { actionInput, workflowDatabaseError } from "./corporate-action-registry.js";
import { requireCouponExecutionCalculation, type EntitlementActor } from "./entitlements.js";
import { verifyConfirmedInstrument, type InstrumentDeploymentOptions } from "./instrument-deployment.js";
import { reserveTokenDelta } from "./action-approval.js";
import { assertCouponReceiptIntegrity, couponReceiptDraft } from "./coupon-receipt.js";
import { uuidBytes } from "./snapshot-registration.js";
import { ACTIVE_TRANSACTION_STATUSES, requireAttemptSigner, requireWorkflowNetwork, resumeWorkflowAttempt, rpcNumber, rpcObject,
  submitWorkflowTransaction, TransactionWorkflowError, verifyWorkflowFinalization, workflowBlockhash, workflowProgramAccount, WORKFLOW_UUID } from "./transaction-workflow.js";

export type CouponExecutionOptions = InstrumentDeploymentOptions & { enabled: boolean };
const active = { in: [...ACTIVE_TRANSACTION_STATUSES] };
const operations = { PAY: "COUPON_PAYMENT", FINALIZE: "COUPON_FINALIZE" } as const;
type Source = Awaited<ReturnType<typeof requireCouponExecutionCalculation>>;
type Phase = keyof typeof operations;
export function couponExecutionEnabled(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.COUPON_EXECUTION_ENABLED ?? "false";
  if (!["true", "false"].includes(value) || value === "true" && environment.ACTION_APPROVAL_RESERVE_ENABLED !== "true") {
    throw new TransactionWorkflowError("COUPON_CONFIGURATION_INVALID", "Coupon execution requires an explicitly enabled reviewed approval candidate", 503);
  }
  return value === "true";
}
function checkOptions(options: CouponExecutionOptions) {
  if (!options.enabled || options.cluster !== "localnet") throw new TransactionWorkflowError("COUPON_EXECUTION_DISABLED", "Coupon execution is disabled until its Localnet candidate is reviewed", 503);
}
async function source(database: PrismaClient | Prisma.TransactionClient, id: string, options: CouponExecutionOptions, receiverId?: string) {
  const action = await requireCouponExecutionCalculation(database, id, receiverId);
  if (action.instrument.network !== "SOLANA_LOCALNET" || action.instrument.programId !== options.programId ||
      action.snapshot!.networkGenesisHash !== options.expectedGenesisHash) throw new TransactionWorkflowError("WRONG_SOLANA_NETWORK", "Calculation belongs to another program or genesis", 503);
  const asset = await database.settlementAsset.findUniqueOrThrow({ where: { id: action.instrument.settlementAssetId } });
  if (!asset.mintAddress || !await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: "ACTION_APPROVAL", status: "FINALIZED", signature: { not: null } } })) {
    throw new TransactionWorkflowError("ONCHAIN_APPROVAL_REQUIRED", "Finalized funded on-chain approval is required");
  }
  return { action, mint: asset.mintAddress };
}
async function tokenAccount(rpc: SolanaRpc, key: string, mint: string, owner: string, slot = 0) {
  const result = rpcObject(await rpc.request("getAccountInfo", [key, { commitment: "finalized", encoding: "base64", minContextSlot: slot }]));
  if (rpcNumber(rpcObject(result["context"])["slot"]) < slot) throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Token account slot is too old", 503);
  if (result["value"] === null) return null;
  const value = rpcObject(result["value"]); const data = value["data"];
  if (value["owner"] !== TOKEN_2022_PROGRAM_ID || value["executable"] !== false || !Array.isArray(data) || data[1] !== "base64" || typeof data[0] !== "string") {
    throw new TransactionWorkflowError("COUPON_ACCOUNT_MISMATCH", "Token account identity is invalid");
  }
  return decodeFundingTreasury(Buffer.from(data[0], "base64"), mint, owner);
}
async function chainState(rpc: SolanaRpc, action: Source, mint: string, options: CouponExecutionOptions, slot = 0) {
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const addresses = await deriveActionApprovalAddresses(options.programId, uuidBytes(action.instrumentId), uuidBytes(action.id));
  verifyConfirmedInstrument(await workflowProgramAccount(rpc, addresses.instrumentAddress, options.programId, slot),
    { ...action.instrument, settlementAsset: { mintAddress: mint } }, action.instrument.status as "ACTIVE" | "PAUSED");
  const chain = decodeConfirmedCorporateAction(await workflowProgramAccount(rpc, addresses.actionAddress, options.programId, slot));
  const hash = Buffer.from(action.snapshot!.snapshotHash).toString("hex");
  if (chain.instrumentAddress !== addresses.instrumentAddress || !Buffer.from(chain.actionId).equals(Buffer.from(uuidBytes(action.id))) ||
      chain.type !== "COUPON_PAYMENT" || !["APPROVED", "PROCESSING", "FINALIZED"].includes(chain.status) || chain.snapshotHash !== hash ||
      chain.snapshotSlot !== action.snapshot!.solanaSlot || chain.totalBalance !== action.snapshot!.totalBalance ||
      chain.investorCount !== action.snapshot!.investorCount || chain.walletCount !== action.snapshot!.walletCount ||
      chain.registeredEntitlements !== action.entitlements.length || chain.totalAmountMinor !== action.totalEntitlementMinor ||
      chain.processedEntitlements > action.eligibleHolders || chain.recordAt !== BigInt(action.recordAt.getTime() / 1000) ||
      chain.executeAt !== BigInt(action.executeAt.getTime() / 1000) || chain.redemptionPercentageBps !== null || chain.redemptionPriceMinor !== null) {
    throw new TransactionWorkflowError("COUPON_ACCOUNT_MISMATCH", "Action commitment differs from the approved calculation");
  }
  const policy = decodeApprovalPolicy(await workflowProgramAccount(rpc, addresses.approvalPolicyAddress, options.programId, slot));
  const reserve = decodeActionReserve(await workflowProgramAccount(rpc, addresses.reserveAddress, options.programId, slot));
  if (policy.instrumentAddress !== addresses.instrumentAddress || reserve.actionAddress !== addresses.actionAddress ||
      reserve.refundAuthority !== action.instrument.issuerAuthority || reserve.settlementMint !== mint || reserve.snapshotHash !== hash ||
      reserve.amountMinor !== action.totalEntitlementMinor || reserve.approvedAt === null || reserve.approvedBy !== policy.approver ||
      [action.instrument.issuerAuthority, action.instrument.corporateActionAuthority].includes(policy.approver)) {
    throw new TransactionWorkflowError("COUPON_ACCOUNT_MISMATCH", "Separate approval and reserve commitment differ");
  }
  decodeReserveMint(await workflowProgramAccount(rpc, mint, TOKEN_2022_PROGRAM_ID, slot));
  const vaultBalance = await tokenAccount(rpc, addresses.vaultAddress, mint, addresses.reserveAddress, slot);
  if (vaultBalance === null) throw new TransactionWorkflowError("COUPON_ACCOUNT_MISMATCH", "Reserve vault is missing");
  return { ...addresses, chain, hash, policy, reserve, vaultBalance };
}
function prepared(op: BlockchainTransaction, resumed: boolean) {
  return { ...rpcObject(op.preparedPayload), operationId: op.id, requiredSigner: op.requiredSigner, networkGenesisHash: op.networkGenesisHash,
    serializedTransactionBase64: op.preparedTransactionBase64, lastValidBlockHeight: Number(op.lastValidBlockHeight),
    status: op.status, signature: op.signature, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", resumed };
}
export async function getCouponExecution(database: PrismaClient, id: string, options: CouponExecutionOptions) {
  if (!options.enabled) return { enabled: false };
  const { action, mint } = await source(database, id, options);
  const pending = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: { in: Object.values(operations) }, status: active }, orderBy: { createdAt: "desc" } });
  const identity = { programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(id), corporateActionAuthority: action.instrument.corporateActionAuthority };
  const snapshotHash = Buffer.from(action.snapshot!.snapshotHash).toString("hex");
  const finalization = await buildCouponFinalization({ ...identity, investorIds: action.entitlements.map(row => uuidBytes(row.investorId)), receiptHash: snapshotHash });
  const items = await Promise.all(action.entitlements.map(async row => {
    const addresses = await buildCouponExecution({ ...identity, investorId: uuidBytes(row.investorId), settlementMint: mint,
      settlementWallet: row.settlementWalletAddress, idempotencyHash: snapshotHash });
    return { id: row.id, investorId: row.investorId, displayName: action.snapshot!.investors.find(investor => investor.id === row.snapshotInvestorId)?.investor.displayName ?? row.investorId,
      status: row.status, amountMinor: row.amountMinor.toString(), receiver: row.settlementWalletAddress, signature: row.settlementSignature,
      entitlementAddress: addresses.entitlementAddress, entitlementReceiptAddress: addresses.entitlementReceiptAddress, recipientAddress: addresses.recipientAddress };
  }));
  return { enabled: true, actionId: id, actionVersion: action.version, status: action.status, requiredSigner: action.instrument.corporateActionAuthority,
    programId: options.programId, networkGenesisHash: options.expectedGenesisHash, settlementMint: mint,
    instrumentAddress: finalization.instrumentAddress, actionAddress: finalization.actionAddress, approvalPolicyAddress: finalization.approvalPolicyAddress,
    reserveAddress: finalization.reserveAddress, vaultAddress: finalization.vaultAddress, actionReceiptAddress: finalization.actionReceiptAddress, snapshotHash,
    totalAmountMinor: action.totalEntitlementMinor.toString(), paid: action.entitlements.filter(row => row.status === "PAID").length,
    payable: action.eligibleHolders, executeAt: action.executeAt.toISOString(), pending: pending ? prepared(pending, true) : null,
    items };
}
function selection(input: Record<string, unknown>) {
  const phase = input["phase"];
  if (phase !== "PAY" && phase !== "FINALIZE" || !Number.isSafeInteger(input["version"]) || typeof input["idempotencyKey"] !== "string" ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(input["idempotencyKey"]) || phase === "PAY" && (typeof input["entitlementId"] !== "string" || !WORKFLOW_UUID.test(input["entitlementId"])) ||
      phase === "FINALIZE" && input["entitlementId"] !== undefined) throw new TransactionWorkflowError("INVALID_REQUEST", "Coupon phase, version, entitlement or idempotency key is invalid", 400);
  return { phase: phase as Phase, key: input["idempotencyKey"], entitlementId: phase === "PAY" ? input["entitlementId"] as string : null };
}
export async function prepareCouponExecution(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: CouponExecutionOptions) {
  checkOptions(options);
  const input = actionInput(body, ["phase", "version", "entitlementId", "idempotencyKey"]); const selected = selection(input);
  const { action, mint } = await source(database, id, options);
  if (actor.walletAddress !== action.instrument.corporateActionAuthority) throw new TransactionWorkflowError("WALLET_MISMATCH", "Coupon execution requires the assigned action authority", 403);
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const prior = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id,
    operationType: { in: Object.values(operations) }, preparedPayload: { path: ["idempotencyKey"], equals: selected.key } }, orderBy: { createdAt: "desc" } });
  if (prior) {
    const payload = rpcObject(prior.preparedPayload);
    if (payload["phase"] !== selected.phase || (prior.entitlementId ?? null) !== selected.entitlementId) throw new TransactionWorkflowError("IDEMPOTENCY_CONFLICT", "Idempotency key was used for different coupon terms");
    if (prior.status === "FINALIZED" || ACTIVE_TRANSACTION_STATUSES.includes(prior.status as typeof ACTIVE_TRANSACTION_STATUSES[number]) && await resumeWorkflowAttempt(database, rpc, prior, actor, options.expectedGenesisHash)) return prepared(prior, true);
  }
  if (action.version !== input["version"] || action.status === "FINALIZED") throw new TransactionWorkflowError("ACTION_CONFLICT", "Reload the current coupon before preparing execution");
  const row = selected.entitlementId ? action.entitlements.find(value => value.id === selected.entitlementId) : null;
  if (selected.entitlementId) await source(database, id, options, selected.entitlementId);
  const state = await chainState(rpc, action, mint, options);
  const paid = action.entitlements.filter(value => value.status === "PAID").length;
  if (state.chain.processedEntitlements !== paid) throw new TransactionWorkflowError("COUPON_CONFIRMATION_REQUIRED", "Reconcile the existing on-chain payment before another operation");
  const identity = { programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(id), corporateActionAuthority: actor.walletAddress };
  const idempotencyHash = createHash("sha256").update(`coupon:${id}:${selected.entitlementId ?? "finalize"}:${selected.key}`).digest("hex");
  const draft = selected.phase === "FINALIZE" ? await couponReceiptDraft(database, id) : null;
  const plan = row ? await buildCouponExecution({ ...identity, investorId: uuidBytes(row.investorId), settlementMint: mint, settlementWallet: row.settlementWalletAddress, idempotencyHash }) :
    await buildCouponFinalization({ ...identity, investorIds: action.entitlements.map(value => uuidBytes(value.investorId)), receiptHash: draft!.hash });
  if (row) {
    const slot = rpcNumber(await rpc.request("getSlot", [{ commitment: "finalized" }]));
    const time = rpcNumber(await rpc.request("getBlockTime", [slot]));
    if (time < Number(state.chain.executeAt)) throw new TransactionWorkflowError("COUPON_NOT_DUE", "The finalized chain clock has not reached the execution date");
    if (state.vaultBalance < row.amountMinor) throw new TransactionWorkflowError("COUPON_RESERVE_REQUIRED", "The action reserve cannot cover this coupon");
    const wireRow = decodeConfirmedEntitlement(await workflowProgramAccount(rpc, row.onchainPda!, options.programId));
    if (wireRow.actionAddress !== state.actionAddress || wireRow.snapshotHash !== state.hash || wireRow.status !== "READY" || wireRow.executedAt !== null ||
        wireRow.settlementWallet !== row.settlementWalletAddress || wireRow.paymentAmountMinor !== row.amountMinor || wireRow.tokensToRedeem !== 0n) throw new TransactionWorkflowError("COUPON_ACCOUNT_MISMATCH", "Unpaid entitlement differs from the approved calculation");
  }
  const blockhash = await workflowBlockhash(rpc);
  const wire = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: actor.walletAddress, ...blockhash });
  const fee = BigInt(rpcNumber(rpcObject(await rpc.request("getFeeForMessage", [fundingMessageBase64(wire), { commitment: "finalized" }]))["value"]));
  let rent = BigInt(rpcNumber(await rpc.request("getMinimumBalanceForRentExemption", [row ? ENTITLEMENT_RECEIPT_BYTES : ACTION_RECEIPT_BYTES])));
  if ("recipientAddress" in plan && await tokenAccount(rpc, plan.recipientAddress, mint, row!.settlementWalletAddress) === null) rent += BigInt(rpcNumber(await rpc.request("getMinimumBalanceForRentExemption", [170])));
  const payer = rpcObject(rpcObject(await rpc.request("getAccountInfo", [actor.walletAddress, { commitment: "finalized", encoding: "base64" }]))["value"]);
  const requiredLamports = fee + rent + state.policy.networkReserveLamports;
  if (payer["owner"] !== SYSTEM_PROGRAM_ID || payer["executable"] !== false || BigInt(rpcNumber(payer["lamports"])) < requiredLamports) throw new TransactionWorkflowError("NETWORK_BUDGET_REQUIRED", "Payer needs SOL for rent, fees and its retained reserve");
  const payload = { phase: selected.phase, idempotencyKey: selected.key, idempotencyHash, corporateActionId: id, actionVersion: action.version,
    entitlementId: selected.entitlementId, entitlementVersion: row?.version ?? null, programId: options.programId, cluster: "localnet", snapshotHash: state.hash,
    settlementMint: mint, settlementWallet: row?.settlementWalletAddress ?? null, amountMinor: (row?.amountMinor ?? action.totalEntitlementMinor).toString(),
    ...("recipientAddress" in plan ? { recipientAddress: plan.recipientAddress, entitlementAddress: plan.entitlementAddress, entitlementReceiptAddress: plan.entitlementReceiptAddress } : { actionReceiptAddress: plan.actionReceiptAddress, receiptHash: draft!.hash }),
    reserveAddress: state.reserveAddress, vaultAddress: state.vaultAddress, actionAddress: state.actionAddress,
    feeLamports: fee.toString(), rentLamports: rent.toString(), requiredLamports: requiredLamports.toString() };
  try {
    const op = await database.$transaction(async tx => {
      const current = await source(tx, id, options, selected.entitlementId ?? undefined);
      if (current.action.version !== action.version) throw new TransactionWorkflowError("ACTION_CONFLICT", "Coupon changed during preparation");
      if (await tx.blockchainTransaction.findFirst({ where: { corporateActionId: id, status: active } })) throw new TransactionWorkflowError("ACTION_OPERATION_PENDING", "Confirm the saved active attempt first");
      if (await tx.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: { in: Object.values(operations) }, preparedPayload: { path: ["idempotencyKey"], equals: selected.key }, status: { not: "FAILED" } } })) throw new TransactionWorkflowError("IDEMPOTENCY_CONFLICT", "A concurrent request already saved this key");
      if (draft) {
        const latest = await couponReceiptDraft(tx, id);
        if (latest.hash !== draft.hash) throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Settlement evidence changed during receipt preparation");
        const receipt = await tx.actionReceipt.upsert({ where: { corporateActionId: id }, create: { corporateActionId: id, payloadJson: draft.payload, payloadHash: Buffer.from(draft.hash, "hex") }, update: {} });
        assertCouponReceiptIntegrity(receipt, latest);
      }
      const created = await tx.blockchainTransaction.create({ data: { corporateActionId: id, instrumentId: action.instrumentId, entitlementId: selected.entitlementId,
        investorId: row?.investorId ?? null, operationType: operations[selected.phase], requiredSigner: actor.walletAddress,
        networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: wire, preparedPayload: payload, ...blockhash, lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight) } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "COUPON_EXECUTION_PREPARED", entityType: "CorporateAction", entityId: id, corporateActionId: id, blockchainTransactionId: created.id, metadataJson: payload } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return prepared(op, false);
  } catch (error) { return workflowDatabaseError(error); }
}
async function attempt(database: PrismaClient, id: string, body: unknown, actor: EntitlementActor, options: CouponExecutionOptions) {
  checkOptions(options); const input = actionInput(body, ["operationId", "signature", "signedTransactionBase64"]);
  if (typeof input["operationId"] !== "string" || !WORKFLOW_UUID.test(input["operationId"])) throw new TransactionWorkflowError("INVALID_REQUEST", "Operation UUID is invalid", 400);
  const op = await database.blockchainTransaction.findUnique({ where: { id: input["operationId"] } });
  if (!op || op.corporateActionId !== id || !Object.values(operations).includes(op.operationType as typeof operations[Phase])) throw new TransactionWorkflowError("ATTEMPT_NOT_FOUND", "Coupon attempt was not found", 404);
  requireAttemptSigner(op, actor.walletAddress, options.expectedGenesisHash);
  const payload = rpcObject(op.preparedPayload);
  if (payload["phase"] !== (op.operationType === "COUPON_PAYMENT" ? "PAY" : "FINALIZE")) throw new TransactionWorkflowError("PREPARED_ATTEMPT_INVALID", "Coupon operation differs from its saved phase");
  return { input, op, payload };
}
export async function submitCouponExecution(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: CouponExecutionOptions) {
  const { input, op, payload } = await attempt(database, id, body, actor, options);
  if (op.status !== "FINALIZED" && !op.signature) {
    const { action, mint } = await source(database, id, options, op.entitlementId ?? undefined);
    if (action.version !== payload["actionVersion"]) throw new TransactionWorkflowError("ACTION_CONFLICT", "Coupon changed after preparation");
    if (!op.entitlementId) {
      const draft = await couponReceiptDraft(database, id);
      assertCouponReceiptIntegrity(await database.actionReceipt.findUniqueOrThrow({ where: { corporateActionId: id } }), draft);
      if (draft.hash !== payload["receiptHash"]) throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Receipt changed after preparation");
    }
    await chainState(rpc, action, mint, options);
  }
  return submitWorkflowTransaction(database, rpc, op, input["signedTransactionBase64"] as string, actor, { ...options, confirmationOnlyAfterSubmission: true });
}
export async function confirmCouponExecution(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: CouponExecutionOptions, now = new Date()) {
  const { input, op, payload } = await attempt(database, id, body, actor, options); const signature = input["signature"];
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new TransactionWorkflowError("INVALID_REQUEST", "Signature is invalid", 400);
  if (op.status === "FINALIZED") {
    if (op.signature !== signature) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Finalized attempt has another signature");
    return { operationId: op.id, signature, status: "FINALIZED" as const };
  }
  const { action, mint } = await source(database, id, options);
  if (action.version !== payload["actionVersion"]) throw new TransactionWorkflowError("ACTION_CONFLICT", "Coupon changed after preparation");
  const slot = await verifyWorkflowFinalization(database, rpc, op, signature, actor, options.expectedGenesisHash);
  const state = await chainState(rpc, action, mint, options, slot);
  let executedAt: bigint | null = null;
  if (op.entitlementId) {
    const row = action.entitlements.find(value => value.id === op.entitlementId)!;
    const receipt = decodeEntitlementReceipt(await workflowProgramAccount(rpc, String(payload["entitlementReceiptAddress"]), options.programId, slot));
    const entitlement = decodeConfirmedEntitlement(await workflowProgramAccount(rpc, row.onchainPda!, options.programId, slot));
    const paid = action.entitlements.filter(value => value.status === "PAID").length;
    if (row.status !== "READY" || row.version !== payload["entitlementVersion"] || row.amountMinor.toString() !== payload["amountMinor"] ||
        receipt.actionAddress !== state.actionAddress || receipt.entitlementAddress !== row.onchainPda || receipt.snapshotHash !== state.hash ||
        receipt.settlementMint !== mint || receipt.settlementWallet !== row.settlementWalletAddress || receipt.amountMinor !== row.amountMinor ||
        receipt.idempotencyHash !== payload["idempotencyHash"] || receipt.executedAt < state.chain.executeAt ||
        entitlement.actionAddress !== state.actionAddress || entitlement.snapshotHash !== state.hash || entitlement.settlementWallet !== row.settlementWalletAddress ||
        entitlement.status !== "PAID" || entitlement.executedAt !== receipt.executedAt || entitlement.paymentAmountMinor !== row.amountMinor ||
        entitlement.tokensToRedeem !== 0n || state.chain.status !== "PROCESSING" || state.chain.processedEntitlements !== paid + 1) {
      throw new TransactionWorkflowError("COUPON_RECEIPT_MISMATCH", "Paid entitlement, receipt or processed count differs");
    }
    const meta = rpcObject(rpcObject(await rpc.request("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]))["meta"]);
    const vault = reserveTokenDelta(meta, fundingTreasuryIndex(op.preparedTransactionBase64!, state.vaultAddress), mint, state.reserveAddress);
    const receiver = reserveTokenDelta(meta, fundingTreasuryIndex(op.preparedTransactionBase64!, String(payload["recipientAddress"])), mint, row.settlementWalletAddress);
    if (vault.before - vault.after !== row.amountMinor || receiver.after - receiver.before !== row.amountMinor) throw new TransactionWorkflowError("COUPON_BALANCE_PROOF", "Transaction token deltas differ from the coupon amount");
    executedAt = receipt.executedAt;
  } else {
    const draft = await couponReceiptDraft(database, id);
    const receipt = decodeActionReceipt(await workflowProgramAccount(rpc, String(payload["actionReceiptAddress"]), options.programId, slot));
    if (draft.hash !== payload["receiptHash"] || receipt.receiptHash !== draft.hash || receipt.actionAddress !== state.actionAddress ||
        receipt.snapshotHash !== state.hash || receipt.amountMinor !== action.totalEntitlementMinor || receipt.processedEntitlements !== action.eligibleHolders ||
        state.chain.status !== "FINALIZED" || state.chain.processedEntitlements !== action.eligibleHolders || state.chain.completedAt !== receipt.finalizedAt) {
      throw new TransactionWorkflowError("COUPON_RECEIPT_MISMATCH", "Final action receipt and canonical settlement evidence differ");
    }
    executedAt = receipt.finalizedAt;
  }
  try {
    await database.$transaction(async tx => {
      const current = await source(tx, id, options);
      if (current.action.version !== action.version) throw new TransactionWorkflowError("ACTION_CONFLICT", "Coupon changed during confirmation");
      const changed = await tx.blockchainTransaction.updateMany({ where: { id: op.id, status: active, OR: [{ signature: null }, { signature }] },
        data: { signature, status: "FINALIZED", submittedAt: op.submittedAt ?? now, finalizedAt: now, lastErrorCode: null,
          preparedPayload: { ...payload as Prisma.InputJsonObject, finalizedSlot: slot, executedAt: executedAt!.toString() } } });
      if (changed.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Coupon attempt changed concurrently");
      if (op.entitlementId) {
        const row = current.action.entitlements.find(value => value.id === op.entitlementId)!;
        const updated = await tx.entitlement.updateMany({ where: { id: row.id, version: row.version, status: "READY", settlementSignature: null },
          data: { status: "PAID", settlementSignature: signature, executionAttempts: { increment: 1 }, version: { increment: 1 } } });
        if (updated.count !== 1) throw new TransactionWorkflowError("ENTITLEMENT_CONFLICT", "Entitlement changed concurrently");
        const legs = [
          { type: "CASH" as const, required: true, status: "CONFIRMED" as const, expectedAmountMinor: row.amountMinor, actualAmountMinor: row.amountMinor, blockchainTransactionId: op.id, confirmedAt: now },
          { type: "ASSET" as const, required: false, status: "NOT_APPLICABLE" as const, expectedAmountMinor: 0n, actualAmountMinor: null }
        ];
        if (reconcileSettlementLegs("COUPON_PAYMENT", legs).status !== "MATCHED") throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Coupon legs differ from the finalized payment");
        await tx.settlement.create({ data: { entitlementId: row.id, amountMinor: row.amountMinor, actualAmountMinor: row.amountMinor,
          status: "FINALIZED", reconciliationStatus: "MATCHED", createdAt: now, reconciledAt: now, finalizedAt: now, legs: { create: legs } } });
        const remaining = current.action.entitlements.filter(value => value.amountMinor > 0n && value.status !== "PAID" && value.id !== row.id).length;
        await tx.corporateAction.update({ where: { id }, data: { status: remaining === 0 ? "SETTLED" : "PARTIALLY_SETTLED", processedEntitlements: { increment: 1 }, version: { increment: 1 } } satisfies Prisma.CorporateActionUpdateInput });
      } else {
        const draft = await couponReceiptDraft(tx, id);
        if (draft.hash !== payload["receiptHash"]) throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Receipt changed during finalization");
        assertCouponReceiptIntegrity(await tx.actionReceipt.findUniqueOrThrow({ where: { corporateActionId: id } }), draft);
        const receipt = await tx.actionReceipt.updateMany({ where: { corporateActionId: id, status: "DRAFT", payloadHash: Buffer.from(draft.hash, "hex") },
          data: { status: "FINALIZED", onchainPda: String(payload["actionReceiptAddress"]), finalizedAt: new Date(Number(executedAt!) * 1000) } });
        if (receipt.count !== 1) throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Receipt was changed or already finalized");
        await tx.corporateAction.update({ where: { id }, data: { status: "FINALIZED", version: { increment: 1 } } satisfies Prisma.CorporateActionUpdateInput });
      }
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: op.entitlementId ? "COUPON_PAYMENT_FINALIZED" : "COUPON_ACTION_FINALIZED", entityType: "CorporateAction", entityId: id, corporateActionId: id,
        blockchainTransactionId: op.id, metadataJson: { phase: payload["phase"] as string, signature, finalizedSlot: slot, amountMinor: payload["amountMinor"] as string,
          executedAt: executedAt!.toString(), snapshotHash: state.hash, reconciliation: "MATCHED" } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return workflowDatabaseError(error); }
  return { operationId: op.id, signature, status: "FINALIZED" as const, finalizedSlot: slot };
}
