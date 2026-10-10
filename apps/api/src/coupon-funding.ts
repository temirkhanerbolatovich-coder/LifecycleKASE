import { Prisma, type PrismaClient, type BlockchainTransaction } from "@prisma/client";
import { buildCouponFunding, decodeFundingMint, decodeFundingTreasury, deriveInstrumentLifecycleAddresses,
  fundingMessageBase64, fundingTreasuryIndex, serializeUnsignedInstructionsTransaction, SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID, verifyFinalizedTransaction, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { actionInput, requireActionIssuer, workflowDatabaseError } from "./corporate-action-registry.js";
import { requireCouponFundingCalculation, type EntitlementActor } from "./entitlements.js";
import { verifyConfirmedInstrument, type InstrumentDeploymentOptions } from "./instrument-deployment.js";
import { uuidBytes } from "./snapshot-registration.js";
import { ACTIVE_TRANSACTION_STATUSES, requireWorkflowNetwork, resumeWorkflowAttempt, rpcNumber, rpcObject,
  submitWorkflowTransaction, TransactionWorkflowError, verifyWorkflowFinalization, workflowBlockhash,
  workflowProgramAccount, WORKFLOW_UUID } from "./transaction-workflow.js";

const OPERATION = "COUPON_FUNDING";
const active = { in: [...ACTIVE_TRANSACTION_STATUSES] };
const MAX_INTEGER = (1n << 63n) - 1n;
export type CouponFundingOptions = InstrumentDeploymentOptions & { networkReserveLamports: bigint };

/** Configured reserve is a policy buffer, not escrow or an estimate of future execution fees. */
export function couponNetworkReserve(environment: NodeJS.ProcessEnv = process.env): bigint {
  const value = environment.COUPON_NETWORK_RESERVE_LAMPORTS ?? "50000000";
  if (!/^[1-9][0-9]{0,15}$/.test(value) || BigInt(value) < 5_000_000n || BigInt(value) > MAX_INTEGER) {
    throw new TransactionWorkflowError("FUNDING_CONFIGURATION_INVALID", "COUPON_NETWORK_RESERVE_LAMPORTS must be at least 5000000", 503);
  }
  return BigInt(value);
}
async function fundingAction(database: PrismaClient, id: string, options: CouponFundingOptions) {
  if (!WORKFLOW_UUID.test(id)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action UUID is invalid", 400);
  const action = await database.corporateAction.findUnique({ where: { id }, include: { instrument: { include: { settlementAsset: true } } } });
  if (!action) throw new TransactionWorkflowError("ACTION_NOT_FOUND", "Corporate action was not found", 404);
  const instrument = action.instrument; const asset = instrument.settlementAsset;
  if (options.cluster !== "localnet" || instrument.network !== "SOLANA_LOCALNET" || asset.network !== instrument.network ||
      instrument.programId !== options.programId) throw new TransactionWorkflowError("FUNDING_LOCALNET_ONLY", "Simulated funding requires the pinned Localnet instrument");
  if (action.type !== "COUPON_PAYMENT" || instrument.status !== "ACTIVE" || !instrument.mintAddress || !asset.active ||
      !asset.isSimulated || asset.code !== "KZT_TEST" || asset.decimals !== 6 || !asset.mintAddress || asset.mintAddress === instrument.mintAddress) {
    throw new TransactionWorkflowError("FUNDING_NOT_ALLOWED", "Funding requires an ACTIVE instrument and its simulated KZT-Test mint");
  }
  return action;
}

function tokenData(value: unknown): Buffer {
  const account = rpcObject(value); const data = account["data"];
  if (account["owner"] !== TOKEN_2022_PROGRAM_ID || account["executable"] !== false || !Array.isArray(data) ||
      data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64") throw new TransactionWorkflowError("FUNDING_ACCOUNT_MISMATCH", "Token-2022 account metadata differs");
  const decoded = Buffer.from(data[0], "base64");
  if (decoded.toString("base64") !== data[0]) throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Token data is not canonical base64", 503);
  return decoded;
}
async function treasuryState(rpc: SolanaRpc, mint: string, issuer: string, treasury: string, minimumSlot = 0) {
  const response = rpcObject(await rpc.request("getMultipleAccounts", [[mint, treasury, issuer], {
    commitment: "finalized", encoding: "base64", minContextSlot: minimumSlot }]));
  const slot = rpcNumber(rpcObject(response["context"])["slot"]); const values = response["value"];
  if (slot < minimumSlot || !Array.isArray(values) || values.length !== 3) throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Funding account context is invalid", 503);
  const payer = rpcObject(values[2]);
  if (payer["owner"] !== SYSTEM_PROGRAM_ID || payer["executable"] !== false) throw new TransactionWorkflowError("FUNDING_ACCOUNT_MISMATCH", "Funding payer must be a system wallet");
  try {
    return { slot, mintSupply: decodeFundingMint(tokenData(values[0]), issuer), treasuryExists: values[1] !== null,
      treasuryBalance: values[1] === null ? 0n : decodeFundingTreasury(tokenData(values[1]), mint, issuer),
      payerLamports: BigInt(rpcNumber(payer["lamports"])) };
  } catch (error) {
    if (error instanceof TransactionWorkflowError) throw error;
    throw new TransactionWorkflowError("FUNDING_ACCOUNT_MISMATCH", "Settlement mint or treasury state differs from the reviewed local demo");
  }
}

export async function getCouponBudget(database: PrismaClient, rpc: SolanaRpc, id: string, options: CouponFundingOptions) {
  const action = await fundingAction(database, id, options);
  const calculation = await requireCouponFundingCalculation(database, id);
  if (action.version !== calculation.version) throw new TransactionWorkflowError("ACTION_CONFLICT", "Calculation changed; refresh before funding");
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const addresses = await deriveInstrumentLifecycleAddresses(options.programId, uuidBytes(action.instrumentId));
  verifyConfirmedInstrument(await workflowProgramAccount(rpc, addresses.instrumentAddress, options.programId), action.instrument, "ACTIVE");
  const mint = action.instrument.settlementAsset.mintAddress!; const issuer = action.instrument.issuerAuthority;
  const probe = await buildCouponFunding({ issuer, settlementMint: mint, amountMinor: 1n });
  const state = await treasuryState(rpc, mint, issuer, probe.treasury);
  const required = calculation.totalEntitlementMinor; const deficit = state.treasuryBalance < required ? required - state.treasuryBalance : 0n;
  const blockhash = await workflowBlockhash(rpc);
  const wire = serializeUnsignedInstructionsTransaction({ feePayer: issuer, ...blockhash, instructions: probe.instructions });
  const fee = rpcObject(await rpc.request("getFeeForMessage", [fundingMessageBase64(wire), { commitment: "finalized" }]));
  const fundingFee = BigInt(rpcNumber(fee["value"]));
  const rent = state.treasuryExists ? 0n : BigInt(rpcNumber(await rpc.request("getMinimumBalanceForRentExemption", [170])));
  const requiredLamports = options.networkReserveLamports + (deficit > 0n ? rent + fundingFee : 0n);
  const storedFunding = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: OPERATION,
    status: { in: [...ACTIVE_TRANSACTION_STATUSES, "FINALIZED"] } }, orderBy: { createdAt: "desc" } });
  return { corporateActionId: id, actionVersion: calculation.version, cluster: options.cluster, networkGenesisHash: options.expectedGenesisHash,
    requiredSigner: issuer, settlementMint: mint, treasuryTokenAccount: probe.treasury,
    snapshotHash: Buffer.from(calculation.snapshot!.snapshotHash).toString("hex"), totalCouponMinor: required.toString(),
    treasuryBalanceMinor: state.treasuryBalance.toString(), deficitMinor: deficit.toString(), mintSupplyMinor: state.mintSupply.toString(),
    finalizedSlot: state.slot, payerLamports: state.payerLamports.toString(), networkReserveLamports: options.networkReserveLamports.toString(),
    fundingRentLamports: rent.toString(), fundingFeeLamports: fundingFee.toString(), requiredLamports: requiredLamports.toString(),
    hasNetworkBudget: state.payerLamports >= requiredLamports, hasCouponBudget: deficit === 0n,
    budgetReady: deficit === 0n && state.payerLamports >= requiredLamports, executionAvailable: false,
    fundingAttempt: storedFunding ? prepared(storedFunding, true) : null,
    disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan." };
}
function prepared(operation: BlockchainTransaction, resumed: boolean) {
  return { ...rpcObject(operation.preparedPayload), operationId: operation.id, requiredSigner: operation.requiredSigner,
    networkGenesisHash: operation.networkGenesisHash, serializedTransactionBase64: operation.preparedTransactionBase64,
    lastValidBlockHeight: Number(operation.lastValidBlockHeight), signature: operation.signature, status: operation.status,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", resumed };
}

export async function prepareCouponFunding(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown,
  actor: EntitlementActor, options: CouponFundingOptions) {
  const input = actionInput(body, ["version"]);
  if (!Number.isSafeInteger(input["version"]) || (input["version"] as number) < 0) throw new TransactionWorkflowError("INVALID_REQUEST", "Current action version is required", 400);
  const action = await fundingAction(database, id, options); requireActionIssuer(action.instrument, actor);
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const existing = await database.blockchainTransaction.findFirst({ where: { requiredSigner: actor.walletAddress, operationType: OPERATION, status: active } });
  if (existing) {
    if (existing.corporateActionId !== id) throw new TransactionWorkflowError("FUNDING_ATTEMPT_PENDING", "Confirm the issuer's existing funding attempt first");
    if (await resumeWorkflowAttempt(database, rpc, existing, actor, options.expectedGenesisHash)) return prepared(existing, true);
  }
  if (action.version !== input["version"]) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action version changed; refresh before funding");
  const budget = await getCouponBudget(database, rpc, id, options);
  if (!budget.hasNetworkBudget) throw new TransactionWorkflowError("NETWORK_BUDGET_REQUIRED", "Issuer SOL is below funding costs plus the configured reserve");
  if (budget.hasCouponBudget) {
    const finalized = await database.blockchainTransaction.findFirst({ where: { corporateActionId: id, operationType: OPERATION, status: "FINALIZED" }, orderBy: { createdAt: "desc" } });
    if (finalized) return prepared(finalized, true);
    throw new TransactionWorkflowError("TREASURY_ALREADY_FUNDED", "Treasury already covers this coupon; refresh the budget");
  }
  if (BigInt(budget.mintSupplyMinor) + BigInt(budget.deficitMinor) > MAX_INTEGER) throw new TransactionWorkflowError("CALCULATION_RANGE", "Simulated funding would exceed the database range");
  const plan = await buildCouponFunding({ issuer: actor.walletAddress, settlementMint: budget.settlementMint, amountMinor: BigInt(budget.deficitMinor) });
  const blockhash = await workflowBlockhash(rpc);
  const wire = serializeUnsignedInstructionsTransaction({ feePayer: actor.walletAddress, ...blockhash, instructions: plan.instructions });
  const { fundingAttempt: _previousAttempt, ...budgetFacts } = budget;
  const payload = { ...budgetFacts, phase: OPERATION, amountMinor: budget.deficitMinor };
  try {
    const operation = await database.$transaction(async tx => {
      const current = await tx.corporateAction.findUnique({ where: { id } });
      if (!current || current.version !== action.version || current.status !== action.status) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed during funding preparation");
      await requireCouponFundingCalculation(tx, id);
      if (await tx.blockchainTransaction.findFirst({ where: { corporateActionId: id,
        operationType: { in: ["ACTION_RESERVE_FUND", "ACTION_RESERVE_RELEASE", "ACTION_APPROVAL"] },
        status: { in: [...ACTIVE_TRANSACTION_STATUSES, "FINALIZED"] } }, select: { id: true } })) {
        throw new TransactionWorkflowError("ACTION_OPERATION_PENDING", "Action reserve funding has begun; reconcile its recorded reserve workflow");
      }
      const row = await tx.blockchainTransaction.create({ data: { instrumentId: action.instrumentId, corporateActionId: id,
        operationType: OPERATION, requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash,
        preparedTransactionBase64: wire, preparedPayload: payload, ...blockhash, lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight) } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "COUPON_FUNDING_PREPARED", entityType: "BlockchainTransaction", entityId: row.id,
        corporateActionId: id, blockchainTransactionId: row.id, metadataJson: { ...payload, operationSource: actor.operationSource ?? "HTTP", transactionSubmitted: false } } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return prepared(operation, false);
  } catch (error) { return workflowDatabaseError(error); }
}
async function fundingAttempt(database: PrismaClient, id: string, operationId: unknown, actor: EntitlementActor, options: CouponFundingOptions) {
  if (typeof operationId !== "string" || !WORKFLOW_UUID.test(operationId)) throw new TransactionWorkflowError("INVALID_REQUEST", "Funding operation UUID is invalid", 400);
  const action = await fundingAction(database, id, options); requireActionIssuer(action.instrument, actor);
  const operation = await database.blockchainTransaction.findUnique({ where: { id: operationId } });
  if (!operation || operation.corporateActionId !== id || operation.instrumentId !== action.instrumentId || operation.operationType !== OPERATION) {
    throw new TransactionWorkflowError("FUNDING_ATTEMPT_NOT_FOUND", "Funding attempt was not found", 404);
  }
  return { action, operation };
}
export async function submitCouponFunding(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: CouponFundingOptions) {
  const input = actionInput(body, ["operationId", "signedTransactionBase64"]);
  const { operation } = await fundingAttempt(database, id, input["operationId"], actor, options);
  if (operation.status !== "FINALIZED") await requireCouponFundingCalculation(database, id);
  return submitWorkflowTransaction(database, rpc, operation, input["signedTransactionBase64"] as string, actor, options);
}

/** Exact transaction token deltas prove this funding even if treasury later changes. */
export function verifyFundingDelta(meta: Record<string, unknown>, index: number, mint: string, issuer: string, amount: bigint) {
  function balance(field: string, required: boolean) {
    const entries = meta[field];
    if (!Array.isArray(entries)) throw new TransactionWorkflowError("FUNDING_BALANCE_PROOF", "Funding token balance history is unavailable");
    const found = entries.filter(value => rpcObject(value)["accountIndex"] === index);
    if (!required && found.length === 0) return 0n;
    if (found.length !== 1) throw new TransactionWorkflowError("FUNDING_BALANCE_PROOF", "Funding token balance history is ambiguous");
    const entry = rpcObject(found[0]); const tokenAmount = rpcObject(entry["uiTokenAmount"]); const value = tokenAmount["amount"];
    if (entry["mint"] !== mint || entry["owner"] !== issuer || entry["programId"] !== TOKEN_2022_PROGRAM_ID ||
        tokenAmount["decimals"] !== 6 || typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > (1n << 64n) - 1n) {
      throw new TransactionWorkflowError("FUNDING_BALANCE_PROOF", "Funding token balance mint, owner or amount differs");
    }
    return BigInt(value);
  }
  if (balance("postTokenBalances", true) - balance("preTokenBalances", false) !== amount) throw new TransactionWorkflowError("FUNDING_BALANCE_PROOF", "Finalized treasury delta differs from the exact funding amount");
}
export async function confirmCouponFunding(database: PrismaClient, rpc: SolanaRpc, id: string, body: unknown, actor: EntitlementActor, options: CouponFundingOptions) {
  const input = actionInput(body, ["operationId", "signature"]);
  const { action, operation } = await fundingAttempt(database, id, input["operationId"], actor, options);
  const signature = input["signature"];
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new TransactionWorkflowError("INVALID_REQUEST", "Signature is invalid", 400);
  if (operation.status === "FINALIZED") {
    if (operation.signature !== signature || operation.requiredSigner !== actor.walletAddress || operation.networkGenesisHash !== options.expectedGenesisHash) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Finalized funding differs from the request");
    return { operationId: operation.id, signature, status: "FINALIZED" as const };
  }
  const payload = rpcObject(operation.preparedPayload); const mint = action.instrument.settlementAsset.mintAddress!;
  if (typeof payload["amountMinor"] !== "string" || !/^[1-9][0-9]*$/.test(payload["amountMinor"]) || BigInt(payload["amountMinor"]) > MAX_INTEGER ||
      payload["settlementMint"] !== mint || payload["corporateActionId"] !== id || payload["cluster"] !== "localnet") throw new TransactionWorkflowError("FUNDING_ATTEMPT_INVALID", "Persisted funding terms differ");
  const plan = await buildCouponFunding({ issuer: actor.walletAddress, settlementMint: mint, amountMinor: BigInt(payload["amountMinor"]) });
  const amountMinor = payload["amountMinor"];
  const expected = serializeUnsignedInstructionsTransaction({ feePayer: actor.walletAddress, instructions: plan.instructions,
    recentBlockhash: operation.recentBlockhash!, lastValidBlockHeight: Number(operation.lastValidBlockHeight) });
  if (expected !== operation.preparedTransactionBase64 || payload["treasuryTokenAccount"] !== plan.treasury) throw new TransactionWorkflowError("FUNDING_ATTEMPT_INVALID", "Persisted funding wire differs from its terms");
  const slot = await verifyWorkflowFinalization(database, rpc, operation, signature, actor, options.expectedGenesisHash);
  const transaction = rpcObject(await rpc.request("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]));
  if (transaction["slot"] !== slot) throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Funding transaction slot changed", 503);
  const tuple = transaction["transaction"]; const meta = rpcObject(transaction["meta"]);
  if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== "string" || tuple[1] !== "base64" || meta["err"] !== null) {
    throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Funding balance proof is not attached to a successful exact transaction", 503);
  }
  try { verifyFinalizedTransaction({ expectedUnsignedTransactionBase64: expected, finalizedTransactionBase64: tuple[0], requiredSigner: actor.walletAddress, signature }); }
  catch { throw new TransactionWorkflowError("TRANSACTION_MISMATCH", "Funding balance proof message differs from the prepared transaction"); }
  verifyFundingDelta(meta, fundingTreasuryIndex(expected, plan.treasury), mint, actor.walletAddress, BigInt(amountMinor));
  const state = await treasuryState(rpc, mint, actor.walletAddress, plan.treasury, slot);
  if (!state.treasuryExists) throw new TransactionWorkflowError("FUNDING_ACCOUNT_MISMATCH", "Finalized funded treasury is missing");
  try {
    await database.$transaction(async tx => {
      const changed = await tx.blockchainTransaction.updateMany({ where: { id: operation.id, status: active,
        OR: [{ signature: null }, { signature }] }, data: { signature, status: "FINALIZED", finalizedAt: new Date(), lastErrorCode: null } });
      if (changed.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Funding confirmation changed concurrently");
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "COUPON_FUNDING_FINALIZED", entityType: "BlockchainTransaction", entityId: operation.id,
        corporateActionId: id, blockchainTransactionId: operation.id,
          metadataJson: { settlementMint: mint, treasuryTokenAccount: plan.treasury, amountMinor,
          finalizedSlot: slot, observedSlot: state.slot, currentTreasuryBalanceMinor: state.treasuryBalance.toString(),
          operationSource: actor.operationSource ?? "HTTP", paymentPerformed: false } } });
    });
  } catch (error) { return workflowDatabaseError(error); }
  return { operationId: operation.id, signature, status: "FINALIZED" as const, finalizedSlot: slot, treasuryTokenAccount: plan.treasury,
    currentTreasuryBalanceMinor: state.treasuryBalance.toString(), paymentPerformed: false };
}
