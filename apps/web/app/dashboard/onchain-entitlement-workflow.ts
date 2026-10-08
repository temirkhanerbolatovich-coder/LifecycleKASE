import { isActionId, unsignedTransactionForSigner, type SupportedSnapshotCluster } from "./snapshot-workflow";
import type { EntitlementsView } from "./entitlement-workflow";

export type PreparedOnchainCalculation = {
  corporateActionId: string; actionVersion: number; operationId: string; phase: "REGISTER" | "FINALIZE" | "RESET";
  cluster: SupportedSnapshotCluster; requiredSigner: string; networkGenesisHash: string; programId: string;
  instrumentAddress: string; actionAddress: string; snapshotHash: string; serializedTransactionBase64: string;
  lastValidBlockHeight: number; entitlementId?: string; entitlementAddress?: string; investorId?: string;
  settlementWallet?: string; balanceAtSnapshot?: string; paymentAmountMinor?: string; tokensToRedeem?: string;
  entitlementStatus?: string; entitlementAddresses?: string[]; entitlementCount?: number; totalAmountMinor?: string;
};

export function preparedOnchainCalculation(payload: Record<string, unknown>, view: EntitlementsView,
  corporateActionAuthority: string, walletAddress: string): PreparedOnchainCalculation {
  const invalid = () => new Error("On-chain план не совпадает с начислениями, snapshot или authority. Подпись остановлена.");
  const phase = payload["phase"];
  const publicKey = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  if (payload["corporateActionId"] !== view.actionId || !isActionId(view.actionId) || payload["actionVersion"] !== view.actionVersion ||
      typeof payload["operationId"] !== "string" || !isActionId(payload["operationId"]) || !["REGISTER", "FINALIZE", "RESET"].includes(String(phase)) ||
      (payload["cluster"] !== "localnet" && payload["cluster"] !== "devnet") || payload["requiredSigner"] !== walletAddress ||
      corporateActionAuthority !== walletAddress || payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" ||
      !publicKey(payload["programId"]) || !publicKey(payload["instrumentAddress"]) || !publicKey(payload["actionAddress"]) ||
      !publicKey(payload["networkGenesisHash"]) || typeof payload["snapshotHash"] !== "string" || !/^[0-9a-f]{64}$/i.test(payload["snapshotHash"]) ||
      view.items.length === 0 || view.items.some(item => item.calculationInputs.snapshotHash !== payload["snapshotHash"]) ||
      typeof payload["serializedTransactionBase64"] !== "string" || !Number.isSafeInteger(payload["lastValidBlockHeight"]) ||
      (payload["lastValidBlockHeight"] as number) < 0) throw invalid();
  if (phase === "REGISTER") {
    const row = view.items.find(item => item.id === payload["entitlementId"]);
    if (!row || row.onchainPda || payload["investorId"] !== row.investorId || payload["paymentAmountMinor"] !== row.amountMinor ||
        payload["settlementWallet"] !== row.settlementWalletAddress || payload["balanceAtSnapshot"] !== row.balanceAtRecordDate ||
        payload["tokensToRedeem"] !== row.tokensToRedeem || payload["entitlementStatus"] !== row.status ||
        !publicKey(payload["entitlementAddress"])) throw invalid();
  } else {
    const rows = phase === "FINALIZE" ? view.items : view.items.filter(item => item.onchainPda);
    if (rows.length === 0 || phase === "FINALIZE" && rows.length !== view.items.length || rows.some(item => !/^(0|[1-9][0-9]*)$/.test(item.amountMinor)) ||
        payload["entitlementCount"] !== rows.length ||
        payload["totalAmountMinor"] !== rows.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n).toString() ||
        !Array.isArray(payload["entitlementAddresses"]) || payload["entitlementAddresses"].length !== rows.length ||
        rows.some((item, index) => (payload["entitlementAddresses"] as unknown[])[index] !== item.onchainPda)) throw invalid();
  }
  unsignedTransactionForSigner(payload["serializedTransactionBase64"], walletAddress);
  return payload as unknown as PreparedOnchainCalculation;
}
