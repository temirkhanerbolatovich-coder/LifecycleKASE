import { EARLY_REDEMPTION_ALLOCATION_POLICY } from "@lifecycle-kase/domain";
import { decodeConfirmedExactRedemptionTarget, deriveExactRedemptionTargetAddress, type RedemptionAllocationPolicy, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { TransactionWorkflowError, workflowProgramAccount } from "./transaction-workflow.js";

export const LEGACY_ALLOCATION_POLICY = "integer-entitlements-v1";
const MAX_DB_INTEGER = (1n << 63n) - 1n;
export type RedemptionPolicyAction = {
  type: string;
  redemptionAllocationPolicy?: string;
  redemptionTargetTokens?: bigint | null;
  redemptionPercentageBps: number | null;
  redemptionPriceMinor: bigint | null;
};

/** Missing metadata is accepted only for the original version, including historical fixtures. */
export function redemptionAllocationPolicy(action: RedemptionPolicyAction): RedemptionAllocationPolicy {
  const policy = action.redemptionAllocationPolicy ?? LEGACY_ALLOCATION_POLICY;
  if (policy === LEGACY_ALLOCATION_POLICY && action.redemptionTargetTokens == null) return LEGACY_ALLOCATION_POLICY;
  if (policy === EARLY_REDEMPTION_ALLOCATION_POLICY && action.type === "EARLY_REDEMPTION" &&
      typeof action.redemptionTargetTokens === "bigint" && action.redemptionTargetTokens > 0n &&
      action.redemptionTargetTokens <= MAX_DB_INTEGER && action.redemptionPercentageBps === null &&
      typeof action.redemptionPriceMinor === "bigint" && action.redemptionPriceMinor > 0n &&
      action.redemptionTargetTokens * action.redemptionPriceMinor <= MAX_DB_INTEGER) return EARLY_REDEMPTION_ALLOCATION_POLICY;
  throw new TransactionWorkflowError("INVALID_REDEMPTION_POLICY", "Redemption policy and immutable target are inconsistent");
}

export function onchainActionVersion(action: RedemptionPolicyAction) {
  return redemptionAllocationPolicy(action) === EARLY_REDEMPTION_ALLOCATION_POLICY ? 2 : 1;
}

export function exactTargetRedemptionEnabled(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.EXACT_TARGET_REDEMPTION_ENABLED ?? "false";
  if (!["true", "false"].includes(value) || value === "true" &&
      [environment.REDEMPTION_EXECUTION_ENABLED, environment.ACTION_APPROVAL_RESERVE_ENABLED,
        environment.ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED].some(flag => flag !== "true")) {
    throw new TransactionWorkflowError("EXACT_TARGET_CONFIGURATION_INVALID", "Exact target requires explicitly enabled redemption, approval and calculation candidates", 503);
  }
  return value === "true";
}

/** A separate immutable PDA commits the target without changing historical account layouts. */
export async function verifyExactRedemptionTarget(rpc: SolanaRpc, action: RedemptionPolicyAction,
  actionAddress: string, programId: string, minimumSlot = 0) {
  if (onchainActionVersion(action) === 1) return null;
  const targetAddress = await deriveExactRedemptionTargetAddress(programId, actionAddress);
  let target;
  try { target = decodeConfirmedExactRedemptionTarget(await workflowProgramAccount(rpc, targetAddress, programId, minimumSlot)); }
  catch { throw new TransactionWorkflowError("REDEMPTION_TARGET_MISMATCH", "Immutable redemption target account is invalid"); }
  if (target.version !== 2 || target.actionAddress !== actionAddress || target.targetTokens !== action.redemptionTargetTokens) {
    throw new TransactionWorkflowError("REDEMPTION_TARGET_MISMATCH", "On-chain redemption target differs from the action");
  }
  return targetAddress;
}
