import { Prisma, type PrismaClient, type BlockchainTransaction } from "@prisma/client";
import { ACTION_RESERVE_BYTES, APPROVAL_POLICY_BYTES, associatedTokenAccount, buildActionApproval,
  decodeActionReserve, decodeApprovalPolicy, decodeConfirmedCorporateAction, decodeConfirmedEntitlement,
  decodeReserveMint, decodeFundingTreasury, deriveActionApprovalAddresses, deriveEntitlementAddress,
  fundingMessageBase64, fundingTreasuryIndex, serializeUnsignedInstructionsTransaction, SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID, type ActionApprovalPhase, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { actionInput, actionText, workflowDatabaseError } from "./corporate-action-registry.js";
import { applyConfirmedActionApproval, requireApprovedEntitlements, requireSubmittedEntitlementCalculation, type EntitlementActor } from "./entitlements.js";
import { verifyConfirmedInstrument, type InstrumentDeploymentOptions } from "./instrument-deployment.js";
import { uuidBytes } from "./snapshot-registration.js";
import { ACTIVE_TRANSACTION_STATUSES, requireAttemptSigner, requireWorkflowNetwork, resumeWorkflowAttempt, rpcNumber, rpcObject,
  submitWorkflowTransaction, TransactionWorkflowError, verifyWorkflowFinalization, workflowBlockhash, workflowProgramAccount, WORKFLOW_UUID } from "./transaction-workflow.js";

const operations = { ASSIGN_APPROVER: "ACTION_APPROVER_ASSIGN", RESERVE: "ACTION_RESERVE_FUND", RELEASE: "ACTION_RESERVE_RELEASE", APPROVE: "ACTION_APPROVAL" } as const;
const active = { in: [...ACTIVE_TRANSACTION_STATUSES] };
export type ActionApprovalOptions = InstrumentDeploymentOptions & { enabled: boolean; networkReserveLamports: bigint };
export function actionApprovalEnabled(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.ACTION_APPROVAL_RESERVE_ENABLED ?? "false";
  if (!["true", "false"].includes(value)) throw new TransactionWorkflowError("APPROVAL_CONFIGURATION_INVALID", "ACTION_APPROVAL_RESERVE_ENABLED must be true or false", 503);
  if (value === "true" && environment.ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED !== "true") {
    throw new TransactionWorkflowError("APPROVAL_CONFIGURATION_INVALID", "On-chain calculation registration is required for action approval", 503);
  }
  return value === "true";
}
type Source = Awaited<ReturnType<typeof requireSubmittedEntitlementCalculation>>;
function decodeAccount<T>(decode: (data: string) => T, data: string): T {
  try { return decode(data); }
  catch { throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "Approval account layout or version is invalid"); }
}
function checkOptions(options: ActionApprovalOptions) {
  if (!options.enabled || options.cluster !== "localnet") throw new TransactionWorkflowError("ACTION_APPROVAL_DISABLED", "Action approval and reserves require an explicitly enabled reviewed Localnet candidate", 503);
}
async function source(database: PrismaClient, id: string, options: ActionApprovalOptions, eligibility: "CURRENT" | "COMMITTED" = "COMMITTED") {
  checkOptions(options);
  if (!WORKFLOW_UUID.test(id)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action UUID is invalid", 400);
  const current = await database.corporateAction.findUnique({ where: { id }, select: { status: true } });
  const action = current?.status === "APPROVED" ? await requireApprovedEntitlements(database, id, eligibility) : await requireSubmittedEntitlementCalculation(database, id, eligibility);
  const allowedInstrumentStatuses = eligibility === "COMMITTED" ? ["ACTIVE", "PAUSED"] : ["ACTIVE"];
  if (action.type !== "COUPON_PAYMENT" || !allowedInstrumentStatuses.includes(action.instrument.status) || action.instrument.programId !== options.programId || action.instrument.network !== "SOLANA_LOCALNET") {
    throw new TransactionWorkflowError("ACTION_APPROVAL_NOT_READY", "New approval phases require an active Localnet coupon; paused instruments allow refund and confirmation only");
  }
  if (action.snapshot!.networkGenesisHash !== options.expectedGenesisHash) throw new TransactionWorkflowError("WRONG_SOLANA_NETWORK", "Snapshot belongs to a different validator genesis", 503);
  if (!await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: "CALCULATION_FINALIZE", status: "FINALIZED", signature: { not: null } } })) {
    throw new TransactionWorkflowError("ONCHAIN_CALCULATION_REQUIRED", "Confirm FINALIZE before approval or reserving funds");
  }
  const asset = await database.settlementAsset.findUniqueOrThrow({ where: { id: action.instrument.settlementAssetId } });
  if (!asset.mintAddress) throw new TransactionWorkflowError("SETTLEMENT_MINT_REQUIRED", "Settlement mint is missing");
  return { action, mint: asset.mintAddress };
}
async function account(rpc: SolanaRpc, key: string, owner: string, slot = 0) {
  const result = rpcObject(await rpc.request("getAccountInfo", [key, { commitment: "finalized", encoding: "base64", minContextSlot: slot }]));
  const context = rpcObject(result["context"]); const value = result["value"];
  if (rpcNumber(context["slot"]) < slot) throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Account slot is too old", 503);
  if (value === null) return null;
  const row = rpcObject(value);
  if (row["owner"] !== owner || row["executable"] !== false || !Array.isArray(row["data"]) || row["data"][1] !== "base64" || typeof row["data"][0] !== "string") {
    throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "Approval account owner or data differs");
  }
  return row["data"][0];
}
async function chainState(rpc: SolanaRpc, action: Source, mint: string, options: ActionApprovalOptions, minimumSlot = 0) {
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const addresses = await deriveActionApprovalAddresses(options.programId, uuidBytes(action.instrumentId), uuidBytes(action.id));
  verifyConfirmedInstrument(await workflowProgramAccount(rpc, addresses.instrumentAddress, options.programId, minimumSlot),
    { ...action.instrument, settlementAsset: { mintAddress: mint } }, action.instrument.status as "ACTIVE" | "PAUSED");
  const chain = decodeAccount(decodeConfirmedCorporateAction, await workflowProgramAccount(rpc, addresses.actionAddress, options.programId, minimumSlot));
  const hash = Buffer.from(action.snapshot!.snapshotHash).toString("hex");
  if (chain.version !== 1 || !Buffer.from(chain.actionId).equals(Buffer.from(uuidBytes(action.id))) || chain.instrumentAddress !== addresses.instrumentAddress ||
      !["UNDER_REVIEW", "RESERVED", "APPROVED"].includes(chain.status) || chain.snapshotHash !== hash || chain.totalAmountMinor !== action.totalEntitlementMinor ||
      chain.registeredEntitlements !== action.entitlements.length || chain.processedEntitlements !== 0 || chain.totalBalance !== action.snapshot!.totalBalance ||
      chain.investorCount !== action.snapshot!.investorCount || chain.walletCount !== action.snapshot!.walletCount || chain.snapshotSlot !== action.snapshot!.solanaSlot ||
      chain.type !== action.type || chain.recordAt !== BigInt(action.recordAt.getTime() / 1000) || chain.executeAt !== BigInt(action.executeAt.getTime() / 1000) ||
      chain.redemptionPercentageBps !== null || chain.redemptionPriceMinor !== null || chain.completedAt !== null) {
    throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "Action calculation or snapshot differs from the database");
  }
  for (const row of action.entitlements) {
    const key = await deriveEntitlementAddress(options.programId, addresses.actionAddress, uuidBytes(row.investorId));
    if (row.onchainPda !== key) throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "An entitlement projection is incomplete");
    const value = decodeAccount(decodeConfirmedEntitlement, await workflowProgramAccount(rpc, key, options.programId, minimumSlot));
    if (value.actionAddress !== addresses.actionAddress || value.snapshotHash !== hash || !Buffer.from(value.investorId).equals(Buffer.from(uuidBytes(row.investorId))) ||
        value.settlementWallet !== row.settlementWalletAddress || value.paymentAmountMinor !== row.amountMinor || value.balanceAtSnapshot !== row.balanceAtRecordDate ||
        value.tokensToRedeem !== 0n || value.executedAt !== null || value.status !== (row.status === "NOT_ELIGIBLE_ZERO_ROUNDING" ? row.status : "READY")) {
      throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "An immutable entitlement differs from the approved calculation");
    }
  }
  const policyData = await account(rpc, addresses.approvalPolicyAddress, options.programId, minimumSlot);
  const policy = policyData ? decodeAccount(decodeApprovalPolicy, policyData) : null;
  if (policy && (policy.instrumentAddress !== addresses.instrumentAddress || [action.instrument.issuerAuthority, action.instrument.corporateActionAuthority].includes(policy.approver))) {
    throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "Approver policy is invalid");
  }
  const reserveData = await account(rpc, addresses.reserveAddress, options.programId, minimumSlot);
  const reserve = reserveData ? decodeAccount(decodeActionReserve, reserveData) : null;
  if (reserve && (reserve.actionAddress !== addresses.actionAddress || reserve.refundAuthority !== action.instrument.issuerAuthority ||
      reserve.settlementMint !== mint || reserve.snapshotHash !== hash || reserve.amountMinor !== action.totalEntitlementMinor)) {
    throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "Reserve commitment differs from the action");
  }
  const mintData = await account(rpc, mint, TOKEN_2022_PROGRAM_ID, minimumSlot);
  if (!mintData) throw new TransactionWorkflowError("SETTLEMENT_MINT_REQUIRED", "Settlement mint does not exist");
  decodeAccount(decodeReserveMint, mintData);
  const treasuryAddress = await associatedTokenAccount(action.instrument.issuerAuthority, mint);
  const treasury = await account(rpc, treasuryAddress, TOKEN_2022_PROGRAM_ID, minimumSlot);
  const vault = await account(rpc, addresses.vaultAddress, TOKEN_2022_PROGRAM_ID, minimumSlot);
  const treasuryBalance = treasury ? decodeAccount(data => decodeFundingTreasury(Buffer.from(data, "base64"), mint, action.instrument.issuerAuthority), treasury) : 0n;
  const vaultBalance = vault ? decodeAccount(data => decodeFundingTreasury(Buffer.from(data, "base64"), mint, addresses.reserveAddress), vault) : 0n;
  if (Boolean(reserve) !== Boolean(vault)) throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "Reserve and vault must exist together");
  if (Boolean(reserve) !== ["RESERVED", "APPROVED"].includes(chain.status) || reserve && !policy ||
      chain.status === "APPROVED" && (reserve?.approvedAt === null || reserve?.approvedBy !== policy?.approver) ||
      chain.status === "RESERVED" && reserve?.approvedAt !== null) {
    throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "Action status and reserve authorization differ");
  }
  return { ...addresses, chain, hash, policy, reserve, treasuryAddress, treasuryBalance, vaultBalance };
}
function prepared(op: BlockchainTransaction, resumed: boolean) {
  return { ...rpcObject(op.preparedPayload), operationId: op.id, requiredSigner: op.requiredSigner,
    networkGenesisHash: op.networkGenesisHash, serializedTransactionBase64: op.preparedTransactionBase64,
    lastValidBlockHeight: Number(op.lastValidBlockHeight), status: op.status, signature: op.signature,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", resumed };
}
export async function getActionApproval(database: PrismaClient, rpc: SolanaRpc, id: string, options: ActionApprovalOptions) {
  if (!options.enabled) return { enabled: false };
  const { action, mint } = await source(database, id, options); const state = await chainState(rpc, action, mint, options);
  const pending = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: { in: Object.values(operations) }, status: active }, orderBy: { createdAt: "desc" } });
  return { enabled: true, actionId: id, actionVersion: action.version, issuer: action.instrument.issuerAuthority,
    instrumentId: action.instrumentId, instrumentAddress: state.instrumentAddress, actionAddress: state.actionAddress,
    programId: options.programId, networkGenesisHash: options.expectedGenesisHash,
    approver: state.policy?.approver ?? null, policyAddress: state.approvalPolicyAddress, reserveAddress: state.reserveAddress,
    vaultAddress: state.vaultAddress, settlementMint: mint, snapshotHash: state.hash, chainStatus: state.chain.status,
    amountMinor: action.totalEntitlementMinor.toString(), treasuryBalanceMinor: state.treasuryBalance.toString(),
    reservedMinor: state.vaultBalance.toString(), reserveExists: Boolean(state.reserve), approved: Boolean(state.reserve && state.reserve.approvedAt !== null),
    networkReserveLamports: (state.policy?.networkReserveLamports ?? options.networkReserveLamports).toString(),
    pending: pending ? prepared(pending, true) : null, executionAvailable: false };
}
function phase(value: unknown): ActionApprovalPhase {
  if (typeof value !== "string" || !Object.hasOwn(operations, value)) throw new TransactionWorkflowError("INVALID_REQUEST", "Approval phase is invalid", 400);
  return value as ActionApprovalPhase;
}
async function requireOperator(database: PrismaClient, wallet: string) {
  const operator = await database.wallet.findUnique({ where: { address: wallet }, include: { user: true } });
  if (!operator?.user || operator.user.role !== "ADMINISTRATOR" || operator.status !== "ACTIVE" || !operator.verifiedAt || operator.revokedAt || operator.network !== "SOLANA_LOCALNET") {
    throw new TransactionWorkflowError("APPROVER_NOT_AUTHORIZED", "Approver must be an active verified Localnet Administrator", 403);
  }
}
async function budget(rpc: SolanaRpc, action: Source, plan: Awaited<ReturnType<typeof buildActionApproval>>, wire: string,
  selectedPhase: ActionApprovalPhase, state: Awaited<ReturnType<typeof chainState>>, options: ActionApprovalOptions, mint: string) {
  const fee = BigInt(rpcNumber(rpcObject(await rpc.request("getFeeForMessage", [fundingMessageBase64(wire), { commitment: "finalized" }]))["value"]));
  const rent = async (bytes: number) => BigInt(rpcNumber(await rpc.request("getMinimumBalanceForRentExemption", [bytes])));
  const creationRent = selectedPhase === "ASSIGN_APPROVER" ? await rent(APPROVAL_POLICY_BYTES) : selectedPhase === "RESERVE" ? await rent(ACTION_RESERVE_BYTES) + await rent(165) : 0n;
  let recipientRent = 0n; let executionFees = 0n;
  if (selectedPhase === "APPROVE") {
    for (const row of action.entitlements.filter(row => row.amountMinor > 0n)) {
      const key = await associatedTokenAccount(row.settlementWalletAddress, mint);
      const existing = await account(rpc, key, TOKEN_2022_PROGRAM_ID);
      if (existing) decodeAccount(data => decodeFundingTreasury(Buffer.from(data, "base64"), mint, row.settlementWalletAddress), existing);
      else recipientRent += await rent(170);
      executionFees += fee; // Current one-signature base fee; priority fees are outside this slice.
    }
  }
  const buffer = state.policy?.networkReserveLamports ?? options.networkReserveLamports;
  const requiredLamports = fee + creationRent + recipientRent + executionFees + buffer;
  const signerValue = rpcObject(await rpc.request("getAccountInfo", [plan.requiredSigner, { commitment: "finalized", encoding: "base64" }]))["value"];
  if (signerValue === null) throw new TransactionWorkflowError("NETWORK_BUDGET_REQUIRED", "Signer needs SOL for rent, fees and the execution buffer");
  const signer = rpcObject(signerValue);
  if (signer["owner"] !== SYSTEM_PROGRAM_ID || signer["executable"] !== false) throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "Payer must be a system wallet");
  const payerLamports = BigInt(rpcNumber(signer["lamports"]));
  if (payerLamports < requiredLamports) throw new TransactionWorkflowError("NETWORK_BUDGET_REQUIRED", "Signer SOL cannot cover rent, fees and the execution buffer");
  return { feeLamports: fee.toString(), creationRentLamports: creationRent.toString(), recipientRentLamports: recipientRent.toString(),
    estimatedExecutionFeeLamports: executionFees.toString(), networkReserveLamports: buffer.toString(), requiredLamports: requiredLamports.toString(), payerLamports: payerLamports.toString() };
}
export async function prepareActionApproval(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: ActionApprovalOptions) {
  const input = actionInput(body, ["phase", "version", "approver", "note"]); const selectedPhase = phase(input["phase"]);
  const { action, mint } = await source(database, id, options, selectedPhase === "RELEASE" ? "COMMITTED" : "CURRENT");
  if (input["version"] !== action.version || action.status !== "UNDER_REVIEW") throw new TransactionWorkflowError("ACTION_CONFLICT", "Reload the action under review before preparing approval");
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const previous = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: operations[selectedPhase], status: active } });
  if (previous && await resumeWorkflowAttempt(database, rpc, previous, actor, options.expectedGenesisHash)) return prepared(previous, true);
  const state = await chainState(rpc, action, mint, options);
  const approver = selectedPhase === "ASSIGN_APPROVER" ? input["approver"] : state.policy?.approver;
  if (typeof approver !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(approver) ||
      [action.instrument.issuerAuthority, action.instrument.corporateActionAuthority].includes(approver)) throw new TransactionWorkflowError("INVALID_APPROVER", "Choose a separate approver", 400);
  if (selectedPhase !== "RELEASE") await requireOperator(database, approver);
  const requiredSigner = selectedPhase === "APPROVE" ? approver : action.instrument.issuerAuthority;
  if (actor.walletAddress !== requiredSigner) throw new TransactionWorkflowError("WALLET_MISMATCH", "This phase requires its assigned authority", 403);
  if (state.chain.status !== (["RELEASE", "APPROVE"].includes(selectedPhase) ? "RESERVED" : "UNDER_REVIEW") || selectedPhase === "ASSIGN_APPROVER" && state.policy || selectedPhase !== "ASSIGN_APPROVER" && !state.policy ||
      selectedPhase === "RESERVE" && (state.reserve || state.treasuryBalance < action.totalEntitlementMinor) ||
      ["RELEASE", "APPROVE"].includes(selectedPhase) && (!state.reserve || state.reserve.approvedAt !== null || state.vaultBalance < action.totalEntitlementMinor)) {
    throw new TransactionWorkflowError("ACTION_RESERVE_NOT_READY", "Policy, complete funded reserve or action state does not allow this phase");
  }
  const note = selectedPhase === "APPROVE" ? actionText(input["note"], "Approval note", 1000)! : null;
  const reserveLamports = state.policy?.networkReserveLamports ?? options.networkReserveLamports;
  const plan = await buildActionApproval({ phase: selectedPhase, programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(id),
    issuer: action.instrument.issuerAuthority, approver, settlementMint: mint, networkReserveLamports: reserveLamports, snapshotHash: state.hash, amountMinor: action.totalEntitlementMinor });
  const blockhash = await workflowBlockhash(rpc);
  const wire = serializeUnsignedInstructionsTransaction({ instructions: [plan.instruction], feePayer: requiredSigner, ...blockhash });
  const costs = await budget(rpc, action, plan, wire, selectedPhase, state, options, mint);
  const payload = { corporateActionId: id, actionVersion: action.version, instrumentId: action.instrumentId, phase: selectedPhase,
    programId: options.programId, cluster: "localnet", issuer: action.instrument.issuerAuthority, approver, settlementMint: mint,
    instrumentAddress: plan.instrumentAddress, actionAddress: plan.actionAddress, approvalPolicyAddress: plan.approvalPolicyAddress,
    reserveAddress: plan.reserveAddress, vaultAddress: plan.vaultAddress, treasuryAddress: plan.treasuryAddress, snapshotHash: state.hash,
    amountMinor: action.totalEntitlementMinor.toString(), vaultBalanceMinor: state.vaultBalance.toString(), note, ...costs };
  try {
    const op = await database.$transaction(async tx => {
      const current = await requireSubmittedEntitlementCalculation(tx, id, selectedPhase === "RELEASE" ? "COMMITTED" : "CURRENT");
      if (current.version !== action.version) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed during preparation");
      const blocker = await tx.blockchainTransaction.findFirst({ where: { status: active, OR: [
        { corporateActionId: id, operationType: { in: [...Object.values(operations), "ENTITLEMENT_REGISTER", "CALCULATION_RESET", "CALCULATION_FINALIZE", "COUPON_FUNDING"] } },
        { instrumentId: action.instrumentId, operationType: operations.ASSIGN_APPROVER } ] } });
      if (blocker) throw new TransactionWorkflowError("ACTION_OPERATION_PENDING", "Reconcile the active calculation, funding or approval attempt first");
      const row = await tx.blockchainTransaction.create({ data: { corporateActionId: id, instrumentId: action.instrumentId, operationType: operations[selectedPhase],
        requiredSigner, networkGenesisHash: options.expectedGenesisHash, preparedPayload: payload, preparedTransactionBase64: wire, ...blockhash,
        lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight) } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "ACTION_APPROVAL_PREPARED", entityType: "CorporateAction", entityId: id, corporateActionId: id, blockchainTransactionId: row.id,
        metadataJson: { ...payload, transactionSubmitted: false } } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return prepared(op, false);
  } catch (error) { return workflowDatabaseError(error); }
}
async function attempt(database: PrismaClient, id: string, body: unknown, actor: EntitlementActor, options: ActionApprovalOptions) {
  checkOptions(options);
  const input = actionInput(body, ["operationId", "signature", "signedTransactionBase64"]);
  if (typeof input["operationId"] !== "string" || !WORKFLOW_UUID.test(input["operationId"])) throw new TransactionWorkflowError("INVALID_REQUEST", "Operation UUID is invalid", 400);
  const op = await database.blockchainTransaction.findUnique({ where: { id: input["operationId"] } });
  if (!op || op.corporateActionId !== id || !Object.values(operations).includes(op.operationType as typeof operations[ActionApprovalPhase])) throw new TransactionWorkflowError("ATTEMPT_NOT_FOUND", "Approval attempt was not found", 404);
  requireAttemptSigner(op, actor.walletAddress, options.expectedGenesisHash);
  const payload = rpcObject(op.preparedPayload); const selectedPhase = phase(payload["phase"]);
  if (op.operationType !== operations[selectedPhase]) throw new TransactionWorkflowError("PREPARED_ATTEMPT_INVALID", "Approval phase differs from operation");
  return { input, op, payload, selectedPhase };
}
export async function submitActionApproval(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: ActionApprovalOptions) {
  const { input, op, payload, selectedPhase } = await attempt(database, id, body, actor, options);
  if (selectedPhase !== "RELEASE" && !op.signature) await requireOperator(database, String(payload["approver"]));
  if (op.status !== "FINALIZED") {
    const { action, mint } = await source(database, id, options, op.signature || selectedPhase === "RELEASE" ? "COMMITTED" : "CURRENT");
    if (action.version !== rpcObject(op.preparedPayload)["actionVersion"]) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed after preparation");
    await chainState(rpc, action, mint, options);
  }
  return submitWorkflowTransaction(database, rpc, op, input["signedTransactionBase64"] as string, actor, { ...options, confirmationOnlyAfterSubmission: true });
}
/** Checks a real transaction's immutable token history, including account closure. */
export function reserveTokenDelta(meta: Record<string, unknown>, index: number, mint: string, owner: string) {
  function balance(field: string) {
    const values = meta[field]; if (!Array.isArray(values)) throw new TransactionWorkflowError("RESERVE_BALANCE_PROOF", "Token history is unavailable");
    const matches = values.filter(value => rpcObject(value)["accountIndex"] === index);
    if (matches.length === 0) return 0n;
    if (matches.length !== 1) throw new TransactionWorkflowError("RESERVE_BALANCE_PROOF", "Token history is ambiguous");
    const row = rpcObject(matches[0]); const amount = rpcObject(row["uiTokenAmount"]);
    if (row["mint"] !== mint || row["owner"] !== owner || row["programId"] !== TOKEN_2022_PROGRAM_ID || amount["decimals"] !== 6 ||
        typeof amount["amount"] !== "string" || !/^(0|[1-9][0-9]*)$/.test(amount["amount"])) throw new TransactionWorkflowError("RESERVE_BALANCE_PROOF", "Token history identity differs");
    const result = BigInt(amount["amount"]);
    if (result > (1n << 64n) - 1n) throw new TransactionWorkflowError("RESERVE_BALANCE_PROOF", "Token history amount exceeds u64");
    return result;
  }
  return { before: balance("preTokenBalances"), after: balance("postTokenBalances") };
}
export async function confirmActionApproval(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: ActionApprovalOptions, now = new Date()) {
  const { input, op, payload, selectedPhase } = await attempt(database, id, body, actor, options);
  const signature = input["signature"];
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new TransactionWorkflowError("INVALID_REQUEST", "Signature is invalid", 400);
  if (op.status === "FINALIZED") {
    if (op.signature !== signature) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Finalized attempt has another signature");
    return { operationId: op.id, signature, status: "FINALIZED" as const };
  }
  const { action, mint } = await source(database, id, options);
  if (action.version !== payload["actionVersion"]) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed after preparation");
  const slot = await verifyWorkflowFinalization(database, rpc, op, signature, actor, options.expectedGenesisHash);
  const state = await chainState(rpc, action, mint, options, slot);
  if (!state.policy || state.policy.approver !== payload["approver"] || state.policy.networkReserveLamports.toString() !== payload["networkReserveLamports"] ||
      (selectedPhase === "APPROVE" ? state.chain.status !== "APPROVED" || state.reserve?.approvedBy !== actor.walletAddress || state.reserve.approvedAt === null : state.chain.status !== (selectedPhase === "RESERVE" ? "RESERVED" : "UNDER_REVIEW")) ||
      selectedPhase === "RESERVE" && (!state.reserve || state.reserve.approvedAt !== null || state.vaultBalance < action.totalEntitlementMinor) ||
      selectedPhase === "RELEASE" && state.reserve) throw new TransactionWorkflowError("APPROVAL_ACCOUNT_MISMATCH", "Finalized policy, reserve or approval differs");
  if (["RESERVE", "RELEASE"].includes(selectedPhase)) {
    const receipt = rpcObject(await rpc.request("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]));
    const meta = rpcObject(receipt["meta"]);
    const vault = reserveTokenDelta(meta, fundingTreasuryIndex(op.preparedTransactionBase64!, state.vaultAddress), mint, state.reserveAddress);
    const treasury = reserveTokenDelta(meta, fundingTreasuryIndex(op.preparedTransactionBase64!, state.treasuryAddress), mint, action.instrument.issuerAuthority);
    if (selectedPhase === "RESERVE" ? vault.after - vault.before !== action.totalEntitlementMinor || treasury.before - treasury.after !== action.totalEntitlementMinor :
      vault.after !== 0n || vault.before < action.totalEntitlementMinor || treasury.after - treasury.before !== vault.before) {
      throw new TransactionWorkflowError("RESERVE_BALANCE_PROOF", "Transaction did not move the exact action reserve");
    }
  }
  try {
    await database.$transaction(async tx => {
      const current = await requireSubmittedEntitlementCalculation(tx, id, "COMMITTED");
      if (current.version !== action.version) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed during confirmation");
      if (selectedPhase === "APPROVE") await applyConfirmedActionApproval(tx, id, action.version, actor, String(payload["note"]), new Date(Number(state.reserve!.approvedAt!) * 1000));
      const changed = await tx.blockchainTransaction.updateMany({ where: { id: op.id, status: active, OR: [{ signature: null }, { signature }] },
        data: { signature, status: "FINALIZED", submittedAt: op.submittedAt ?? now, finalizedAt: now, lastErrorCode: null } });
      if (changed.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Attempt changed concurrently");
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "ACTION_APPROVAL_FINALIZED", entityType: "CorporateAction", entityId: id, corporateActionId: id, blockchainTransactionId: op.id,
        metadataJson: { phase: selectedPhase, signature, finalizedSlot: slot, snapshotHash: state.hash, amountMinor: action.totalEntitlementMinor.toString(),
          reserveAddress: state.reserveAddress, vaultAddress: state.vaultAddress, chainStatus: state.chain.status, note: payload["note"] as Prisma.InputJsonValue } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return workflowDatabaseError(error); }
  return { operationId: op.id, signature, status: "FINALIZED" as const, finalizedSlot: slot, phase: selectedPhase };
}
