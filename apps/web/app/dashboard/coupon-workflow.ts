import { isActionId, resumedDeploymentSignature, unsignedTransactionForSigner } from "./snapshot-workflow";

export type CouponBudget = {
  corporateActionId: string; actionVersion: number; cluster: "localnet"; networkGenesisHash: string; requiredSigner: string;
  settlementMint: string; treasuryTokenAccount: string; snapshotHash: string; totalCouponMinor: string;
  treasuryBalanceMinor: string; deficitMinor: string; finalizedSlot: number; payerLamports: string;
  networkReserveLamports: string; requiredLamports: string; hasNetworkBudget: boolean; hasCouponBudget: boolean;
  budgetReady: boolean; executionAvailable: false; disclaimer: string;
  fundingAttempt?: Record<string, unknown> | null;
};
export type CouponFundingPlan = CouponBudget & {
  operationId: string; phase: "COUPON_FUNDING"; amountMinor: string; serializedTransactionBase64: string;
  lastValidBlockHeight: number; signature: string | null; status: string; resumed: boolean;
};

type FundingRequest = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

export function couponBudget(payload: Record<string, unknown>, actionId: string): CouponBudget {
  if (payload["corporateActionId"] !== actionId || payload["cluster"] !== "localnet" ||
      !Number.isSafeInteger(payload["actionVersion"]) || (payload["actionVersion"] as number) < 0 ||
      typeof payload["deficitMinor"] !== "string" || !/^(0|[1-9][0-9]*)$/.test(payload["deficitMinor"]) ||
      typeof payload["totalCouponMinor"] !== "string" || !/^[1-9][0-9]*$/.test(payload["totalCouponMinor"]) ||
      payload["executionAvailable"] !== false) throw new Error("API не вернул бюджет выбранного купона.");
  return payload as unknown as CouponBudget;
}

/** Read fresh facts without restoring a stale unsigned attempt before the server can refresh it. */
export async function refreshCouponFundingPlan(request: FundingRequest, path: string, actionId: string, signer: string) {
  const budget = couponBudget(await request(path + "/budget"), actionId);
  const response = await request(path + "/funding/prepare", {
    method: "POST", body: JSON.stringify({ version: budget.actionVersion })
  });
  return { budget, plan: preparedCouponFunding(response, budget, signer) };
}

export function unsignedFundingPlanIsStale(payload: Record<string, unknown>, budget: CouponBudget): boolean {
  return payload["status"] === "PREPARED" && !payload["signature"] &&
    (payload["actionVersion"] !== budget.actionVersion || payload["amountMinor"] !== budget.deficitMinor);
}

export function couponFundingSignature(plan: CouponFundingPlan): string | null {
  if (plan.status === "FINALIZED") {
    if (typeof plan.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(plan.signature)) {
      throw new Error("Подтверждённая попытка не содержит корректной подписи; повторная отправка остановлена.");
    }
    return plan.signature;
  }
  return resumedDeploymentSignature(plan);
}

export function couponFundingReviewChanged(previous: CouponFundingPlan, current: CouponFundingPlan): boolean {
  return (["corporateActionId", "actionVersion", "requiredSigner", "networkGenesisHash", "snapshotHash",
    "settlementMint", "treasuryTokenAccount", "amountMinor", "totalCouponMinor"] as const)
    .some(field => previous[field] !== current[field]);
}

export function preparedCouponFunding(payload: Record<string, unknown>, budget: CouponBudget, signer: string): CouponFundingPlan {
  const invalid = () => new Error("План финансирования не совпадает с купоном, treasury или signer. Подпись остановлена.");
  if (payload["corporateActionId"] !== budget.corporateActionId || typeof payload["operationId"] !== "string" || !isActionId(payload["operationId"]) ||
      payload["phase"] !== "COUPON_FUNDING" || payload["cluster"] !== "localnet" || budget.cluster !== "localnet" ||
      payload["requiredSigner"] !== signer || budget.requiredSigner !== signer ||
      payload["settlementMint"] !== budget.settlementMint || payload["treasuryTokenAccount"] !== budget.treasuryTokenAccount ||
      payload["snapshotHash"] !== budget.snapshotHash || payload["networkGenesisHash"] !== budget.networkGenesisHash ||
      payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" ||
      typeof payload["amountMinor"] !== "string" || !/^[1-9][0-9]*$/.test(payload["amountMinor"]) ||
      BigInt(payload["amountMinor"]) > BigInt(budget.totalCouponMinor) ||
      !Number.isSafeInteger(payload["lastValidBlockHeight"]) || (payload["lastValidBlockHeight"] as number) < 0 ||
      typeof payload["serializedTransactionBase64"] !== "string") throw invalid();
  if (!payload["signature"] && (payload["amountMinor"] !== budget.deficitMinor || payload["actionVersion"] !== budget.actionVersion)) throw invalid();
  unsignedTransactionForSigner(payload["serializedTransactionBase64"], signer);
  return payload as unknown as CouponFundingPlan;
}
