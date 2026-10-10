import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type PrismaClient, type BlockchainTransaction } from "@prisma/client";
import { reconcileSettlementLegs } from "@lifecycle-kase/domain";
import { ACTION_RECEIPT_BYTES, REDEMPTION_RECEIPT_BYTES, buildRedemptionExecution, buildRedemptionFinalization,
  decodeActionReceipt, decodeActionReserve, decodeApprovalPolicy, decodeConfirmedCorporateAction, decodeConfirmedEntitlement,
  decodeRedemptionReceipt, decodeRedemptionSources, decodeRedemptionProgress, decodeFundingTreasury, decodeReserveMint, deriveActionApprovalAddresses,
  fundingMessageBase64, fundingTreasuryIndex, redemptionSourceHash, serializeUnsignedInstructionsTransaction, verifyFinalizedTransaction, SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { actionInput, workflowDatabaseError } from "./corporate-action-registry.js";
import { requireRedemptionExecutionCalculation, type EntitlementActor } from "./entitlements.js";
import { verifyConfirmedInstrument, verifyMint, type InstrumentDeploymentOptions } from "./instrument-deployment.js";
import { reserveTokenDelta } from "./action-approval.js";
import { redemptionReceiptDraft } from "./redemption-receipt.js";
import { assertCouponReceiptIntegrity } from "./coupon-receipt.js";
import { redemptionBurnAllocation, redemptionRetiresInstrument, redemptionTokenSources, requireRedemptionSupply } from "./redemption-sources.js";
import { uuidBytes } from "./snapshot-registration.js";
import { ACTIVE_TRANSACTION_STATUSES, requireAttemptSigner, requireWorkflowNetwork, resumeWorkflowAttempt, rpcNumber, rpcObject,
  submitWorkflowTransaction, TransactionWorkflowError, verifyWorkflowFinalization, workflowBlockhash, workflowProgramAccount, WORKFLOW_UUID } from "./transaction-workflow.js";

export type RedemptionExecutionOptions = InstrumentDeploymentOptions & { enabled: boolean };
const active = { in: [...ACTIVE_TRANSACTION_STATUSES] };
const operations = { PAY: "REDEMPTION_PAYMENT", FINALIZE: "REDEMPTION_FINALIZE" } as const;
type Source = Awaited<ReturnType<typeof requireRedemptionExecutionCalculation>>;
type Phase = keyof typeof operations;
export function redemptionExecutionEnabled(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.REDEMPTION_EXECUTION_ENABLED ?? "false";
  if (!["true", "false"].includes(value) || value === "true" && environment.ACTION_APPROVAL_RESERVE_ENABLED !== "true") {
    throw new TransactionWorkflowError("REDEMPTION_CONFIGURATION_INVALID", "Redemption execution requires an explicitly enabled reviewed approval candidate", 503);
  }
  return value === "true";
}
function checkOptions(options: RedemptionExecutionOptions) {
  if (!options.enabled || options.cluster !== "localnet") throw new TransactionWorkflowError("REDEMPTION_EXECUTION_DISABLED", "Redemption execution is disabled until its Localnet candidate is reviewed", 503);
}
async function source(database: PrismaClient | Prisma.TransactionClient, id: string, options: RedemptionExecutionOptions, receiverId?: string) {
  const action = await requireRedemptionExecutionCalculation(database, id, receiverId);
  if (!action.instrument.mintAddress || !["ACTIVE", "PAUSED", "REDEEMED"].includes(action.instrument.status)) throw new TransactionWorkflowError("REDEMPTION_NOT_READY", "Redemption requires an initialized bond instrument");
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
    throw new TransactionWorkflowError("REDEMPTION_ACCOUNT_MISMATCH", "Token account identity is invalid");
  }
  return decodeFundingTreasury(Buffer.from(data[0], "base64"), mint, owner);
}
async function bondMintSupply(rpc: SolanaRpc, mint: string, authority: string, slot = 0) {
  const data = Buffer.from(await workflowProgramAccount(rpc, mint, TOKEN_2022_PROGRAM_ID, slot), "base64");
  if (data.length < 82) throw new TransactionWorkflowError("REDEMPTION_ACCOUNT_MISMATCH", "Bond mint layout is invalid");
  const supply = data.readBigUInt64LE(36);
  verifyMint(data, { decimals: 0, supply, permanentDelegate: authority });
  return supply;
}
async function executionPlan(action: Source, row: Source["entitlements"][number], mint: string, options: RedemptionExecutionOptions, idempotencyHash: string) {
  const tokenAccounts = redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId);
  const plan = await buildRedemptionExecution({ programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(action.id),
    corporateActionAuthority: action.instrument.corporateActionAuthority, investorId: uuidBytes(row.investorId), bondMint: action.instrument.mintAddress!,
    settlementMint: mint, settlementWallet: row.settlementWalletAddress, idempotencyHash, tokenAccounts });
  return { ...plan, sourceHash: redemptionSourceHash(plan.actionAddress, plan.entitlementAddress, Buffer.from(action.snapshot!.snapshotHash).toString("hex"), tokenAccounts) };
}
async function sourceState(rpc: SolanaRpc, action: Source, row: Source["entitlements"][number], plan: Awaited<ReturnType<typeof executionPlan>>, options: RedemptionExecutionOptions, slot = 0) {
  const committed = decodeRedemptionSources(await workflowProgramAccount(rpc, plan.sourceAddress, options.programId, slot));
  const expected = redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId);
  if (committed.actionAddress !== plan.actionAddress || committed.entitlementAddress !== plan.entitlementAddress ||
      committed.snapshotHash !== Buffer.from(action.snapshot!.snapshotHash).toString("hex") || committed.sourceHash !== plan.sourceHash ||
      committed.tokenAccounts.length !== expected.length || committed.tokenAccounts.some((value, index) =>
        value.address !== expected[index]!.address || value.wallet !== expected[index]!.wallet || value.balanceAtSnapshot !== expected[index]!.balanceAtSnapshot)) {
    throw new TransactionWorkflowError("REDEMPTION_SOURCES_INVALID", "Approved redemption source commitment differs from snapshot accounts");
  }
  return committed;
}
async function burnAccountState(rpc: SolanaRpc, action: Source, row: Source["entitlements"][number]) {
  const allocations = redemptionBurnAllocation(redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId), row.tokensToRedeem);
  return Promise.all(allocations.map(async value => {
    const balance = await tokenAccount(rpc, value.address, action.instrument.mintAddress!, value.wallet);
    if (balance === null || balance < value.burnAmount) throw new TransactionWorkflowError("REDEMPTION_BALANCE_CHANGED", "A snapshot token account cannot cover its committed burn; resolve the transfer before execution");
    return { address: value.address, walletAddress: value.wallet, balanceAtSnapshot: value.balanceAtSnapshot.toString(), burnAmount: value.burnAmount.toString(),
      balanceBefore: balance.toString(), expectedBalanceAfter: (balance - value.burnAmount).toString() };
  }));
}
/** JSONB may reorder object keys; source order and every reviewed value must still match. */
export function requireReviewedBurnAccounts(current: Awaited<ReturnType<typeof burnAccountState>>, saved: unknown) {
  if (!isDeepStrictEqual(current, saved)) throw new TransactionWorkflowError("REDEMPTION_BALANCE_CHANGED", "Snapshot source balances changed after review; prepare a fresh unsigned attempt");
}
/** Read finalized transaction history, never present account balances, as the burn evidence. */
export function verifyRedemptionBurnHistory(meta: Record<string, unknown>, wire: string, mint: string,
  sources: Parameters<typeof redemptionBurnAllocation>[0], tokensToRedeem: bigint) {
  return redemptionBurnAllocation(sources, tokensToRedeem).map(value => {
    const delta = reserveTokenDelta(meta, fundingTreasuryIndex(wire, value.address), mint, value.wallet, 0, true);
    if (delta.before - delta.after !== value.burnAmount) throw new TransactionWorkflowError("REDEMPTION_BALANCE_PROOF", "A committed source account does not prove the exact atomic bond burn");
    return { address: value.address, walletAddress: value.wallet, balanceAtSnapshot: value.balanceAtSnapshot.toString(), burnAmount: value.burnAmount.toString(),
      balanceBefore: delta.before.toString(), expectedBalanceAfter: delta.after.toString() };
  });
}
async function chainState(rpc: SolanaRpc, action: Source, mint: string, options: RedemptionExecutionOptions, slot = 0, expectedInstrumentStatus = action.instrument.status) {
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const addresses = await deriveActionApprovalAddresses(options.programId, uuidBytes(action.instrumentId), uuidBytes(action.id));
  verifyConfirmedInstrument(await workflowProgramAccount(rpc, addresses.instrumentAddress, options.programId, slot),
    { ...action.instrument, settlementAsset: { mintAddress: mint } }, expectedInstrumentStatus as "ACTIVE" | "PAUSED" | "REDEEMED");
  const chain = decodeConfirmedCorporateAction(await workflowProgramAccount(rpc, addresses.actionAddress, options.programId, slot));
  const hash = Buffer.from(action.snapshot!.snapshotHash).toString("hex");
  if (chain.instrumentAddress !== addresses.instrumentAddress || !Buffer.from(chain.actionId).equals(Buffer.from(uuidBytes(action.id))) ||
      chain.type !== action.type || !["APPROVED", "PROCESSING", "FINALIZED"].includes(chain.status) || chain.snapshotHash !== hash ||
      chain.snapshotSlot !== action.snapshot!.solanaSlot || chain.totalBalance !== action.snapshot!.totalBalance ||
      chain.investorCount !== action.snapshot!.investorCount || chain.walletCount !== action.snapshot!.walletCount ||
      chain.registeredEntitlements !== action.entitlements.length || chain.totalAmountMinor !== action.totalEntitlementMinor ||
      chain.processedEntitlements > action.eligibleHolders || chain.recordAt !== BigInt(action.recordAt.getTime() / 1000) ||
      chain.executeAt !== BigInt(action.executeAt.getTime() / 1000) || chain.redemptionPercentageBps !== action.redemptionPercentageBps || chain.redemptionPriceMinor !== action.redemptionPriceMinor) {
    throw new TransactionWorkflowError("REDEMPTION_ACCOUNT_MISMATCH", "Action commitment differs from the approved calculation");
  }
  const policy = decodeApprovalPolicy(await workflowProgramAccount(rpc, addresses.approvalPolicyAddress, options.programId, slot));
  const reserve = decodeActionReserve(await workflowProgramAccount(rpc, addresses.reserveAddress, options.programId, slot));
  if (policy.instrumentAddress !== addresses.instrumentAddress || reserve.actionAddress !== addresses.actionAddress ||
      reserve.refundAuthority !== action.instrument.issuerAuthority || reserve.settlementMint !== mint || reserve.snapshotHash !== hash ||
      reserve.amountMinor !== action.totalEntitlementMinor || reserve.approvedAt === null || reserve.approvedBy !== policy.approver ||
      [action.instrument.issuerAuthority, action.instrument.corporateActionAuthority].includes(policy.approver)) {
    throw new TransactionWorkflowError("REDEMPTION_ACCOUNT_MISMATCH", "Separate approval and reserve commitment differ");
  }
  decodeReserveMint(await workflowProgramAccount(rpc, mint, TOKEN_2022_PROGRAM_ID, slot));
  const vaultBalance = await tokenAccount(rpc, addresses.vaultAddress, mint, addresses.reserveAddress, slot);
  if (vaultBalance === null) throw new TransactionWorkflowError("REDEMPTION_ACCOUNT_MISMATCH", "Reserve vault is missing");
  const plan = await buildRedemptionFinalization({ programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(action.id),
    corporateActionAuthority: action.instrument.corporateActionAuthority, bondMint: action.instrument.mintAddress!,
    investorIds: action.entitlements.map(row => uuidBytes(row.investorId)), receiptHash: hash });
  const progress = decodeRedemptionProgress(await workflowProgramAccount(rpc, plan.progressAddress, options.programId, slot));
  if (progress.actionAddress !== addresses.actionAddress || progress.snapshotHash !== hash || progress.snapshotSupply !== action.snapshot!.mintSupply ||
      progress.processedEntitlements !== chain.processedEntitlements || progress.tokensRedeemed > progress.snapshotSupply) {
    throw new TransactionWorkflowError("REDEMPTION_ACCOUNT_MISMATCH", "Redemption progress differs from the action commitment");
  }
  return { ...addresses, chain, hash, policy, reserve, vaultBalance, progress, progressAddress: plan.progressAddress, instrumentAuthority: plan.instrumentAuthority };
}
function prepared(op: BlockchainTransaction, resumed: boolean) {
  return { ...rpcObject(op.preparedPayload), operationId: op.id, requiredSigner: op.requiredSigner, networkGenesisHash: op.networkGenesisHash,
    serializedTransactionBase64: op.preparedTransactionBase64, lastValidBlockHeight: Number(op.lastValidBlockHeight),
    status: op.status, signature: op.signature, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", resumed };
}
export async function getRedemptionExecution(database: PrismaClient, rpc: SolanaRpc, id: string, options: RedemptionExecutionOptions) {
  if (!options.enabled) return { enabled: false };
  checkOptions(options);
  const { action, mint } = await source(database, id, options);
  const pending = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: { in: Object.values(operations) }, status: active }, orderBy: { createdAt: "desc" } });
  const identity = { programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(id), corporateActionAuthority: action.instrument.corporateActionAuthority };
  const snapshotHash = Buffer.from(action.snapshot!.snapshotHash).toString("hex");
  const finalization = await buildRedemptionFinalization({ ...identity, bondMint: action.instrument.mintAddress!, investorIds: action.entitlements.map(row => uuidBytes(row.investorId)), receiptHash: snapshotHash });
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const currentTokenSupply = await bondMintSupply(rpc, action.instrument.mintAddress!, finalization.instrumentAuthority);
  const items = await Promise.all(action.entitlements.map(async row => {
    const addresses = await executionPlan(action, row, mint, options, snapshotHash);
    const prior = row.status === "REDEEMED" ? await database.blockchainTransaction.findFirst({ where: { entitlementId: row.id, operationType: operations.PAY, status: "FINALIZED" } }) : null;
    let tokenAccounts: unknown[] = [];
    let burnAvailable = true;
    if (prior) { const payload = rpcObject(prior.preparedPayload); tokenAccounts = (payload["confirmedTokenAccounts"] ?? payload["tokenAccounts"]) as unknown[]; }
    else if (row.tokensToRedeem > 0n) {
      try { tokenAccounts = await burnAccountState(rpc, action, row); }
      catch (error) {
        if (!(error instanceof TransactionWorkflowError) || error.code !== "REDEMPTION_BALANCE_CHANGED") throw error;
        burnAvailable = false;
        tokenAccounts = redemptionBurnAllocation(redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId), row.tokensToRedeem).map(value => ({
          address: value.address, walletAddress: value.wallet, balanceAtSnapshot: value.balanceAtSnapshot.toString(), burnAmount: value.burnAmount.toString(),
          balanceBefore: null, expectedBalanceAfter: null }));
      }
    }
    return { id: row.id, investorId: row.investorId, displayName: action.snapshot!.investors.find(investor => investor.id === row.snapshotInvestorId)?.investor.displayName ?? row.investorId,
      status: row.status, amountMinor: row.amountMinor.toString(), receiver: row.settlementWalletAddress, signature: row.settlementSignature,
      tokensToRedeem: row.tokensToRedeem.toString(), burnSignature: row.burnSignature, burnAvailable, tokenAccounts,
      sourceHash: addresses.sourceHash, redemptionSourcesAddress: addresses.sourceAddress, redemptionProgressAddress: addresses.progressAddress,
      entitlementAddress: addresses.entitlementAddress, entitlementReceiptAddress: addresses.redemptionReceiptAddress,
      redemptionReceiptAddress: addresses.redemptionReceiptAddress, recipientAddress: addresses.recipientAddress };
  }));
  return { enabled: true, actionId: id, actionVersion: action.version, status: action.status, requiredSigner: action.instrument.corporateActionAuthority,
    programId: options.programId, networkGenesisHash: options.expectedGenesisHash, settlementMint: mint, actionType: action.type,
    tokenMint: action.instrument.mintAddress, currentTokenSupply: currentTokenSupply.toString(),
    instrumentAuthorityAddress: finalization.instrumentAuthority, redemptionProgressAddress: finalization.progressAddress,
    instrumentAddress: finalization.instrumentAddress, actionAddress: finalization.actionAddress, approvalPolicyAddress: finalization.approvalPolicyAddress,
    reserveAddress: finalization.reserveAddress, vaultAddress: finalization.vaultAddress, actionReceiptAddress: finalization.actionReceiptAddress, snapshotHash,
    totalAmountMinor: action.totalEntitlementMinor.toString(), paid: action.entitlements.filter(row => row.status === "REDEEMED").length,
    payable: action.eligibleHolders, executeAt: action.executeAt.toISOString(), pending: pending ? prepared(pending, true) : null,
    items };
}
function selection(input: Record<string, unknown>) {
  const phase = input["phase"];
  if (phase !== "PAY" && phase !== "FINALIZE" || !Number.isSafeInteger(input["version"]) || typeof input["idempotencyKey"] !== "string" ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(input["idempotencyKey"]) || phase === "PAY" && (typeof input["entitlementId"] !== "string" || !WORKFLOW_UUID.test(input["entitlementId"])) ||
      phase === "FINALIZE" && input["entitlementId"] !== undefined) throw new TransactionWorkflowError("INVALID_REQUEST", "Redemption phase, version, entitlement or idempotency key is invalid", 400);
  return { phase: phase as Phase, key: input["idempotencyKey"], entitlementId: phase === "PAY" ? input["entitlementId"] as string : null };
}
export async function prepareRedemptionExecution(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: RedemptionExecutionOptions) {
  checkOptions(options);
  const input = actionInput(body, ["phase", "version", "entitlementId", "idempotencyKey"]); const selected = selection(input);
  const { action, mint } = await source(database, id, options);
  if (actor.walletAddress !== action.instrument.corporateActionAuthority) throw new TransactionWorkflowError("WALLET_MISMATCH", "Redemption execution requires the assigned action authority", 403);
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const prior = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id,
    operationType: { in: Object.values(operations) }, preparedPayload: { path: ["idempotencyKey"], equals: selected.key } }, orderBy: { createdAt: "desc" } });
  if (prior) {
    requireAttemptSigner(prior, actor.walletAddress, options.expectedGenesisHash);
    const payload = rpcObject(prior.preparedPayload);
    if (payload["phase"] !== selected.phase || (prior.entitlementId ?? null) !== selected.entitlementId) throw new TransactionWorkflowError("IDEMPOTENCY_CONFLICT", "Idempotency key was used for different redemption terms");
    if (prior.status === "FINALIZED" || ACTIVE_TRANSACTION_STATUSES.includes(prior.status as typeof ACTIVE_TRANSACTION_STATUSES[number]) && await resumeWorkflowAttempt(database, rpc, prior, actor, options.expectedGenesisHash)) return prepared(prior, true);
  }
  if (action.version !== input["version"] || action.status === "FINALIZED") throw new TransactionWorkflowError("ACTION_CONFLICT", "Reload the current redemption before preparing execution");
  const row = selected.entitlementId ? action.entitlements.find(value => value.id === selected.entitlementId) : null;
  if (selected.entitlementId) await source(database, id, options, selected.entitlementId);
  const state = await chainState(rpc, action, mint, options);
  const paid = action.entitlements.filter(value => value.status === "REDEEMED").length;
  const redeemed = action.entitlements.filter(value => value.status === "REDEEMED").reduce((sum, value) => sum + value.tokensToRedeem, 0n);
  if (state.chain.processedEntitlements !== paid || state.progress.tokensRedeemed !== redeemed) throw new TransactionWorkflowError("REDEMPTION_CONFIRMATION_REQUIRED", "Reconcile the existing on-chain payment and burn before another operation");
  const identity = { programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(id), corporateActionAuthority: actor.walletAddress };
  const idempotencyHash = createHash("sha256").update(`redemption:${id}:${selected.entitlementId ?? "finalize"}:${selected.key}`).digest("hex");
  const draft = selected.phase === "FINALIZE" ? await redemptionReceiptDraft(database, id) : null;
  const plan = row ? await executionPlan(action, row, mint, options, idempotencyHash) :
    await buildRedemptionFinalization({ ...identity, bondMint: action.instrument.mintAddress!, investorIds: action.entitlements.map(value => uuidBytes(value.investorId)), receiptHash: draft!.hash });
  const supplyBefore = await bondMintSupply(rpc, action.instrument.mintAddress!, plan.instrumentAuthority);
  const supplyAfter = requireRedemptionSupply(state.progress.snapshotSupply, state.progress.tokensRedeemed, supplyBefore, row?.tokensToRedeem ?? 0n);
  if (supplyBefore !== action.instrument.circulatingSupply) throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Stored circulating supply differs from the committed mint before execution");
  const tokenAccounts = row ? await burnAccountState(rpc, action, row) : [];
  if (row) {
    await sourceState(rpc, action, row, plan as Awaited<ReturnType<typeof executionPlan>>, options);
    const slot = rpcNumber(await rpc.request("getSlot", [{ commitment: "finalized" }]));
    const time = rpcNumber(await rpc.request("getBlockTime", [slot]));
    if (time < Number(state.chain.executeAt)) throw new TransactionWorkflowError("REDEMPTION_NOT_DUE", "The finalized chain clock has not reached the execution date");
    if (state.vaultBalance < row.amountMinor) throw new TransactionWorkflowError("REDEMPTION_RESERVE_REQUIRED", "The action reserve cannot cover this redemption");
    const wireRow = decodeConfirmedEntitlement(await workflowProgramAccount(rpc, row.onchainPda!, options.programId));
    if (wireRow.actionAddress !== state.actionAddress || wireRow.snapshotHash !== state.hash || wireRow.status !== "READY" || wireRow.executedAt !== null ||
        wireRow.settlementWallet !== row.settlementWalletAddress || wireRow.paymentAmountMinor !== row.amountMinor || wireRow.tokensToRedeem !== row.tokensToRedeem) throw new TransactionWorkflowError("REDEMPTION_ACCOUNT_MISMATCH", "Unpaid entitlement differs from the approved calculation");
  }
  const blockhash = await workflowBlockhash(rpc);
  const wire = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: actor.walletAddress, ...blockhash });
  const fee = BigInt(rpcNumber(rpcObject(await rpc.request("getFeeForMessage", [fundingMessageBase64(wire), { commitment: "finalized" }]))["value"]));
  let rent = BigInt(rpcNumber(await rpc.request("getMinimumBalanceForRentExemption", [row ? REDEMPTION_RECEIPT_BYTES : ACTION_RECEIPT_BYTES])));
  if ("recipientAddress" in plan && await tokenAccount(rpc, plan.recipientAddress, mint, row!.settlementWalletAddress) === null) rent += BigInt(rpcNumber(await rpc.request("getMinimumBalanceForRentExemption", [170])));
  const payer = rpcObject(rpcObject(await rpc.request("getAccountInfo", [actor.walletAddress, { commitment: "finalized", encoding: "base64" }]))["value"]);
  const requiredLamports = fee + rent + state.policy.networkReserveLamports;
  if (payer["owner"] !== SYSTEM_PROGRAM_ID || payer["executable"] !== false || BigInt(rpcNumber(payer["lamports"])) < requiredLamports) throw new TransactionWorkflowError("NETWORK_BUDGET_REQUIRED", "Payer needs SOL for rent, fees and its retained reserve");
  const payload = { phase: selected.phase, idempotencyKey: selected.key, idempotencyHash, corporateActionId: id, actionVersion: action.version,
    entitlementId: selected.entitlementId, entitlementVersion: row?.version ?? null, programId: options.programId, cluster: "localnet", snapshotHash: state.hash,
    settlementMint: mint, settlementWallet: row?.settlementWalletAddress ?? null, amountMinor: (row?.amountMinor ?? action.totalEntitlementMinor).toString(),
    actionType: action.type, instrumentAddress: state.instrumentAddress, approvalPolicyAddress: state.approvalPolicyAddress,
    tokenMint: action.instrument.mintAddress!, instrumentAuthorityAddress: plan.instrumentAuthority, redemptionProgressAddress: plan.progressAddress,
    supplyBefore: supplyBefore.toString(), supplyAfter: supplyAfter.toString(), tokenAccounts,
    ...("recipientAddress" in plan ? { recipientAddress: plan.recipientAddress, entitlementAddress: plan.entitlementAddress,
      entitlementReceiptAddress: plan.redemptionReceiptAddress, redemptionReceiptAddress: plan.redemptionReceiptAddress,
      redemptionSourcesAddress: plan.sourceAddress, sourceHash: plan.sourceHash, tokensToRedeem: row!.tokensToRedeem.toString() } : {
      actionReceiptAddress: plan.actionReceiptAddress, receiptHash: draft!.hash,
      totalTokensRedeemed: state.progress.tokensRedeemed.toString(), finalSupply: supplyAfter.toString() }),
    reserveAddress: state.reserveAddress, vaultAddress: state.vaultAddress, actionAddress: state.actionAddress,
    feeLamports: fee.toString(), rentLamports: rent.toString(), requiredLamports: requiredLamports.toString() };
  try {
    const op = await database.$transaction(async tx => {
      const current = await source(tx, id, options, selected.entitlementId ?? undefined);
      if (current.action.version !== action.version) throw new TransactionWorkflowError("ACTION_CONFLICT", "Redemption changed during preparation");
      if (current.action.instrument.circulatingSupply !== supplyBefore) throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Circulating supply changed during preparation");
      if (await tx.blockchainTransaction.findFirst({ where: { instrumentId: action.instrumentId, operationType: { in: Object.values(operations) }, status: active } })) throw new TransactionWorkflowError("ACTION_OPERATION_PENDING", "Confirm the existing instrument redemption attempt first");
      if (await tx.blockchainTransaction.findFirst({ where: { corporateActionId: id, status: active } })) throw new TransactionWorkflowError("ACTION_OPERATION_PENDING", "Confirm the saved active attempt first");
      if (await tx.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: { in: Object.values(operations) }, preparedPayload: { path: ["idempotencyKey"], equals: selected.key }, status: { not: "FAILED" } } })) throw new TransactionWorkflowError("IDEMPOTENCY_CONFLICT", "A concurrent request already saved this key");
      if (draft) {
        const latest = await redemptionReceiptDraft(tx, id);
        if (latest.hash !== draft.hash) throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Settlement evidence changed during receipt preparation");
        const receipt = await tx.actionReceipt.upsert({ where: { corporateActionId: id }, create: { corporateActionId: id, payloadJson: draft.payload, payloadHash: Buffer.from(draft.hash, "hex") }, update: {} });
        assertCouponReceiptIntegrity(receipt, latest);
      }
      const created = await tx.blockchainTransaction.create({ data: { corporateActionId: id, instrumentId: action.instrumentId, entitlementId: selected.entitlementId,
        investorId: row?.investorId ?? null, operationType: operations[selected.phase], requiredSigner: actor.walletAddress,
        networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: wire, preparedPayload: payload, ...blockhash, lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight) } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "REDEMPTION_EXECUTION_PREPARED", entityType: "CorporateAction", entityId: id, corporateActionId: id, blockchainTransactionId: created.id, metadataJson: payload } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return prepared(op, false);
  } catch (error) { return workflowDatabaseError(error); }
}
async function attempt(database: PrismaClient, id: string, body: unknown, actor: EntitlementActor, options: RedemptionExecutionOptions) {
  checkOptions(options); const input = actionInput(body, ["operationId", "signature", "signedTransactionBase64"]);
  if (typeof input["operationId"] !== "string" || !WORKFLOW_UUID.test(input["operationId"])) throw new TransactionWorkflowError("INVALID_REQUEST", "Operation UUID is invalid", 400);
  const op = await database.blockchainTransaction.findUnique({ where: { id: input["operationId"] } });
  if (!op || op.corporateActionId !== id || !Object.values(operations).includes(op.operationType as typeof operations[Phase])) throw new TransactionWorkflowError("ATTEMPT_NOT_FOUND", "Redemption attempt was not found", 404);
  requireAttemptSigner(op, actor.walletAddress, options.expectedGenesisHash);
  const payload = rpcObject(op.preparedPayload);
  if (payload["phase"] !== (op.operationType === "REDEMPTION_PAYMENT" ? "PAY" : "FINALIZE")) throw new TransactionWorkflowError("PREPARED_ATTEMPT_INVALID", "Redemption operation differs from its saved phase");
  return { input, op, payload };
}
export async function submitRedemptionExecution(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: RedemptionExecutionOptions) {
  const { input, op, payload } = await attempt(database, id, body, actor, options);
  if (op.status !== "FINALIZED" && !op.signature) {
    const { action, mint } = await source(database, id, options, op.entitlementId ?? undefined);
    if (action.version !== payload["actionVersion"]) throw new TransactionWorkflowError("ACTION_CONFLICT", "Redemption changed after preparation");
    if (!op.entitlementId) {
      const draft = await redemptionReceiptDraft(database, id);
      assertCouponReceiptIntegrity(await database.actionReceipt.findUniqueOrThrow({ where: { corporateActionId: id } }), draft);
      if (draft.hash !== payload["receiptHash"]) throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Receipt changed after preparation");
    }
    const state = await chainState(rpc, action, mint, options);
    const supply = await bondMintSupply(rpc, action.instrument.mintAddress!, state.instrumentAuthority);
    requireRedemptionSupply(state.progress.snapshotSupply, state.progress.tokensRedeemed, supply);
    if (supply.toString() !== payload["supplyBefore"]) throw new TransactionWorkflowError("REDEMPTION_SUPPLY_CHANGED", "Mint supply changed after preparation");
    if (op.entitlementId) {
      const row = action.entitlements.find(value => value.id === op.entitlementId)!;
      await sourceState(rpc, action, row, await executionPlan(action, row, mint, options, String(payload["idempotencyHash"])), options);
      const balances = await burnAccountState(rpc, action, row);
      requireReviewedBurnAccounts(balances, payload["tokenAccounts"]);
    }
  }
  return submitWorkflowTransaction(database, rpc, op, input["signedTransactionBase64"] as string, actor, { ...options, confirmationOnlyAfterSubmission: true });
}
export async function confirmRedemptionExecution(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: RedemptionExecutionOptions, now = new Date()) {
  const { input, op, payload } = await attempt(database, id, body, actor, options); const signature = input["signature"];
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new TransactionWorkflowError("INVALID_REQUEST", "Signature is invalid", 400);
  if (op.status === "FINALIZED") {
    if (op.signature !== signature) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Finalized attempt has another signature");
    return { operationId: op.id, signature, status: "FINALIZED" as const };
  }
  const { action, mint } = await source(database, id, options);
  if (action.version !== payload["actionVersion"]) throw new TransactionWorkflowError("ACTION_CONFLICT", "Redemption changed after preparation");
  const slot = await verifyWorkflowFinalization(database, rpc, op, signature, actor, options.expectedGenesisHash);
  const finalSupply = action.snapshot!.mintSupply - action.entitlements.filter(value => value.status === "REDEEMED").reduce((sum, value) => sum + value.tokensToRedeem, 0n);
  const retires = !op.entitlementId && redemptionRetiresInstrument(action.type, finalSupply);
  const state = await chainState(rpc, action, mint, options, slot, retires ? "REDEEMED" : action.instrument.status);
  let executedAt: bigint | null = null;
  let confirmedTokenAccounts: Prisma.InputJsonObject[] | null = null;
  if (op.entitlementId) {
    const row = action.entitlements.find(value => value.id === op.entitlementId)!;
    const receipt = decodeRedemptionReceipt(await workflowProgramAccount(rpc, String(payload["redemptionReceiptAddress"]), options.programId, slot));
    const entitlement = decodeConfirmedEntitlement(await workflowProgramAccount(rpc, row.onchainPda!, options.programId, slot));
    const paid = action.entitlements.filter(value => value.status === "REDEEMED").length;
    if (row.status !== "READY" || row.version !== payload["entitlementVersion"] || row.amountMinor.toString() !== payload["amountMinor"] ||
        receipt.actionAddress !== state.actionAddress || receipt.entitlementAddress !== row.onchainPda || receipt.snapshotHash !== state.hash ||
        receipt.settlementMint !== mint || receipt.settlementWallet !== row.settlementWalletAddress || receipt.amountMinor !== row.amountMinor ||
        receipt.idempotencyHash !== payload["idempotencyHash"] || receipt.executedAt < state.chain.executeAt ||
        entitlement.actionAddress !== state.actionAddress || entitlement.snapshotHash !== state.hash || entitlement.settlementWallet !== row.settlementWalletAddress ||
        entitlement.status !== "REDEEMED" || entitlement.executedAt !== receipt.executedAt || entitlement.paymentAmountMinor !== row.amountMinor ||
        entitlement.tokensToRedeem !== row.tokensToRedeem || receipt.bondMint !== action.instrument.mintAddress || receipt.tokensRedeemed !== row.tokensToRedeem ||
        receipt.sourceHash !== payload["sourceHash"] || receipt.mintSupplyBefore.toString() !== payload["supplyBefore"] ||
        receipt.mintSupplyAfter.toString() !== payload["supplyAfter"] || receipt.mintSupplyBefore - receipt.mintSupplyAfter !== row.tokensToRedeem ||
        receipt.mintSupplyAfter !== state.progress.snapshotSupply - state.progress.tokensRedeemed ||
        state.progress.tokensRedeemed !== action.entitlements.filter(value => value.status === "REDEEMED").reduce((sum, value) => sum + value.tokensToRedeem, 0n) + row.tokensToRedeem ||
        state.chain.status !== "PROCESSING" || state.chain.processedEntitlements !== paid + 1) {
      throw new TransactionWorkflowError("REDEMPTION_RECEIPT_MISMATCH", "Paid entitlement, receipt or processed count differs");
    }
    const transaction = rpcObject(await rpc.request("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]));
    const tuple = transaction["transaction"]; const meta = rpcObject(transaction["meta"]);
    if (transaction["slot"] !== slot || meta["err"] !== null || !Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== "string" || tuple[1] !== "base64") {
      throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Burn history is not attached to the same successful finalized transaction", 503);
    }
    try { verifyFinalizedTransaction({ expectedUnsignedTransactionBase64: op.preparedTransactionBase64!, finalizedTransactionBase64: tuple[0], requiredSigner: actor.walletAddress, signature }); }
    catch { throw new TransactionWorkflowError("TRANSACTION_MISMATCH", "Burn proof transaction differs from the exact saved message"); }
    const plan = await executionPlan(action, row, mint, options, String(payload["idempotencyHash"]));
    await sourceState(rpc, action, row, plan, options, slot);
    const vault = reserveTokenDelta(meta, fundingTreasuryIndex(op.preparedTransactionBase64!, state.vaultAddress), mint, state.reserveAddress);
    const receiver = reserveTokenDelta(meta, fundingTreasuryIndex(op.preparedTransactionBase64!, String(payload["recipientAddress"])), mint, row.settlementWalletAddress);
    if (vault.before - vault.after !== row.amountMinor || receiver.after - receiver.before !== row.amountMinor) throw new TransactionWorkflowError("REDEMPTION_BALANCE_PROOF", "Transaction token deltas differ from the redemption amount");
    confirmedTokenAccounts = verifyRedemptionBurnHistory(meta, op.preparedTransactionBase64!, action.instrument.mintAddress!,
      redemptionTokenSources(action.snapshot!.investors, row.snapshotInvestorId), row.tokensToRedeem);
    executedAt = receipt.executedAt;
  } else {
    const draft = await redemptionReceiptDraft(database, id);
    const receipt = decodeActionReceipt(await workflowProgramAccount(rpc, String(payload["actionReceiptAddress"]), options.programId, slot));
    if (draft.hash !== payload["receiptHash"] || receipt.receiptHash !== draft.hash || receipt.actionAddress !== state.actionAddress ||
        receipt.snapshotHash !== state.hash || receipt.amountMinor !== action.totalEntitlementMinor || receipt.processedEntitlements !== action.eligibleHolders ||
        state.chain.status !== "FINALIZED" || state.chain.processedEntitlements !== action.eligibleHolders || state.chain.completedAt !== receipt.finalizedAt ||
        state.progress.tokensRedeemed.toString() !== draft.payload["totalTokensRedeemed"] ||
        (state.progress.snapshotSupply - state.progress.tokensRedeemed).toString() !== draft.payload["finalSupply"] ||
        action.type === "BOND_REDEMPTION" && state.progress.snapshotSupply !== state.progress.tokensRedeemed) {
      throw new TransactionWorkflowError("REDEMPTION_RECEIPT_MISMATCH", "Final action receipt and canonical settlement evidence differ");
    }
    executedAt = receipt.finalizedAt;
  }
  try {
    await database.$transaction(async tx => {
      const current = await source(tx, id, options);
      if (current.action.version !== action.version) throw new TransactionWorkflowError("ACTION_CONFLICT", "Redemption changed during confirmation");
      const changed = await tx.blockchainTransaction.updateMany({ where: { id: op.id, status: active, OR: [{ signature: null }, { signature }] },
        data: { signature, status: "FINALIZED", submittedAt: op.submittedAt ?? now, finalizedAt: now, lastErrorCode: null,
          preparedPayload: { ...payload as Prisma.InputJsonObject, finalizedSlot: slot, executedAt: executedAt!.toString(),
            ...(confirmedTokenAccounts ? { confirmedTokenAccounts } : {}) } } });
      if (changed.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Redemption attempt changed concurrently");
      if (op.entitlementId) {
        const row = current.action.entitlements.find(value => value.id === op.entitlementId)!;
        const updated = await tx.entitlement.updateMany({ where: { id: row.id, version: row.version, status: "READY", settlementSignature: null },
          data: { status: "REDEEMED", settlementSignature: signature, burnSignature: signature, executionAttempts: { increment: 1 }, version: { increment: 1 } } });
        if (updated.count !== 1) throw new TransactionWorkflowError("ENTITLEMENT_CONFLICT", "Entitlement changed concurrently");
        const legs = [
          { type: "CASH" as const, required: true, status: "CONFIRMED" as const, expectedAmountMinor: row.amountMinor, actualAmountMinor: row.amountMinor, blockchainTransactionId: op.id, confirmedAt: now },
          { type: "ASSET" as const, required: true, status: "CONFIRMED" as const, expectedAmountMinor: row.tokensToRedeem, actualAmountMinor: row.tokensToRedeem, blockchainTransactionId: op.id, confirmedAt: now }
        ];
        if (reconcileSettlementLegs(current.action.type, legs).status !== "MATCHED") throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Redemption legs differ from the finalized payment and burn");
        await tx.settlement.create({ data: { entitlementId: row.id, amountMinor: row.amountMinor, actualAmountMinor: row.amountMinor,
          status: "FINALIZED", reconciliationStatus: "MATCHED", createdAt: now, reconciledAt: now, finalizedAt: now, legs: { create: legs } } });
        const supply = await tx.instrument.updateMany({ where: { id: action.instrumentId, version: current.action.instrument.version, circulatingSupply: BigInt(String(payload["supplyBefore"])) },
          data: { circulatingSupply: BigInt(String(payload["supplyAfter"])), version: { increment: 1 } } });
        if (supply.count !== 1) throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Circulating supply projection changed concurrently");
        const remaining = current.action.entitlements.filter(value => value.amountMinor > 0n && value.status !== "REDEEMED" && value.id !== row.id).length;
        await tx.corporateAction.update({ where: { id }, data: { status: remaining === 0 ? "SETTLED" : "PARTIALLY_SETTLED", processedEntitlements: { increment: 1 }, version: { increment: 1 } } satisfies Prisma.CorporateActionUpdateInput });
      } else {
        const draft = await redemptionReceiptDraft(tx, id);
        if (draft.hash !== payload["receiptHash"]) throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Receipt changed during finalization");
        assertCouponReceiptIntegrity(await tx.actionReceipt.findUniqueOrThrow({ where: { corporateActionId: id } }), draft);
        const receipt = await tx.actionReceipt.updateMany({ where: { corporateActionId: id, status: "DRAFT", payloadHash: Buffer.from(draft.hash, "hex") },
          data: { status: "FINALIZED", onchainPda: String(payload["actionReceiptAddress"]), finalizedAt: new Date(Number(executedAt!) * 1000) } });
        if (receipt.count !== 1) throw new TransactionWorkflowError("RECEIPT_INTEGRITY", "Receipt was changed or already finalized");
        await tx.corporateAction.update({ where: { id }, data: { status: "FINALIZED", version: { increment: 1 } } satisfies Prisma.CorporateActionUpdateInput });
        if (retires) {
          const instrument = await tx.instrument.updateMany({ where: { id: action.instrumentId, version: current.action.instrument.version, status: "ACTIVE", circulatingSupply: 0n },
            data: { status: "REDEEMED", version: { increment: 1 } } });
          if (instrument.count !== 1) throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Maturity instrument cannot be marked redeemed until the verified supply is zero");
        }
      }
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: op.entitlementId ? "REDEMPTION_PAYMENT_FINALIZED" : "REDEMPTION_ACTION_FINALIZED", entityType: "CorporateAction", entityId: id, corporateActionId: id,
        blockchainTransactionId: op.id, metadataJson: { phase: payload["phase"] as string, signature, finalizedSlot: slot, amountMinor: payload["amountMinor"] as string,
          executedAt: executedAt!.toString(), snapshotHash: state.hash, reconciliation: "MATCHED" } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return workflowDatabaseError(error); }
  return { operationId: op.id, signature, status: "FINALIZED" as const, finalizedSlot: slot };
}
