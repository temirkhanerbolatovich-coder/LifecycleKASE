import { isActionId, unsignedTransactionForSigner, type SupportedSnapshotCluster } from "./snapshot-workflow";

export type CorporateActionView = {
  id: string; instrumentId: string; type: string; intent: string; sourceType: string;
  sourceReference: string | null; sourceDocument: string | null; sourceTimestamp: string | null;
  recordAt: string; executeAt: string; status: string; reviewNote: string | null;
  redemptionPercentageBps: number | null; redemptionPriceMinor: string | null;
  instrument: { id: string; ticker: string; name: string; issuerAuthority: string; corporateActionAuthority: string; network: string };
  snapshot: { id: string; status: string; snapshotHash: string; solanaSlot: string;
    recordAt: string; blockTime: string; totalBalance: string; investorCount: number; walletCount: number } | null;
  blockchainTransactions: { id: string; operationType: string; status: string; signature: string | null; lastErrorCode: string | null; reason: string | null }[];
  events?: { id: string; event: string; actorWallet: string | null; createdAt: string }[];
};
export type PreparedAction = {
  corporateActionId: string; operationId: string; phase: "SCHEDULE" | "CANCEL"; cluster: SupportedSnapshotCluster;
  requiredSigner: string; networkGenesisHash: string; programId: string; instrumentAddress: string; actionAddress: string;
  serializedTransactionBase64: string; lastValidBlockHeight: number; reason: string | null;
};
export function preparedActionPlan(payload: Record<string, unknown>, action: CorporateActionView, walletAddress: string): PreparedAction {
  const invalid = () => new Error("План действия не совпадает с выбранными условиями или сетью. Подпись остановлена.");
  if (payload["corporateActionId"] !== action.id || !isActionId(action.id) ||
      typeof payload["operationId"] !== "string" || !isActionId(payload["operationId"]) ||
      !["SCHEDULE", "CANCEL"].includes(String(payload["phase"])) ||
      (payload["cluster"] !== "localnet" && payload["cluster"] !== "devnet") ||
      action.instrument.network !== (payload["cluster"] === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET") ||
      payload["requiredSigner"] !== walletAddress || action.instrument.issuerAuthority !== walletAddress ||
      payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" ||
      payload["type"] !== action.type || payload["recordAt"] !== action.recordAt || payload["executeAt"] !== action.executeAt ||
      payload["redemptionPercentageBps"] !== action.redemptionPercentageBps || payload["redemptionPriceMinor"] !== action.redemptionPriceMinor ||
      !Number.isSafeInteger(payload["lastValidBlockHeight"]) || (payload["lastValidBlockHeight"] as number) < 0 ||
      typeof payload["serializedTransactionBase64"] !== "string" ||
      payload["phase"] === "CANCEL" && (typeof payload["reason"] !== "string" || payload["reason"].trim().length < 3)) throw invalid();
  for (const field of ["programId", "instrumentAddress", "actionAddress", "networkGenesisHash"] as const) {
    if (typeof payload[field] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payload[field])) throw invalid();
  }
  unsignedTransactionForSigner(payload["serializedTransactionBase64"], walletAddress);
  return payload as unknown as PreparedAction;
}

export function actionTimeUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error("Укажите дату и время действия.");
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error("Дата действия некорректна.");
  return result.toISOString();
}
export function futureLocalTime(minutes: number): string {
  const time = new Date(Date.now() + minutes * 60_000);
  time.setSeconds(0, 0);
  return new Date(time.getTime() - time.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
