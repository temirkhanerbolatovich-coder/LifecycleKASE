import { isActionId, unsignedTransactionForSigner, type SupportedSnapshotCluster } from "./snapshot-workflow";
import { requireReviewedTransaction, transactionHex } from "./reviewed-transaction";
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/addresses";
import type { InstrumentTokenPolicy } from "./controlled-identity";

export type RedemptionAllocationPolicy = "integer-entitlements-v1" | "exact-target-largest-remainder-v2";
const MAX_TOKEN_AMOUNT = (1n << 64n) - 1n;

export type CorporateActionView = {
  id: string; version: number; instrumentId: string; type: string; intent: string; sourceType: string;
  sourceReference: string | null; sourceDocument: string | null; sourceTimestamp: string | null;
  recordAt: string; executeAt: string; status: string; reviewNote: string | null;
  couponExecutionEnabled?: boolean;
  redemptionExecutionEnabled?: boolean;
  exactTargetRedemptionEnabled?: boolean;
  eligibleHolders?: number;
  redemptionPercentageBps: number | null; redemptionPriceMinor: string | null;
  redemptionAllocationPolicy?: RedemptionAllocationPolicy;
  redemptionTargetTokens?: string | null;
  instrument: { id: string; ticker: string; name: string; issuerAuthority: string; corporateActionAuthority: string; network: string; programId?: string | null;
    tokenPolicy?: InstrumentTokenPolicy; networkGenesisHash?: string | null; mintAddress?: string | null };
  snapshot: { id: string; status: string; snapshotHash: string; solanaSlot: string;
    recordAt: string; blockTime: string; totalBalance: string; investorCount: number; walletCount: number } | null;
  blockchainTransactions: { id: string; operationType: string; status: string; signature: string | null; lastErrorCode: string | null; reason: string | null }[];
  events?: { id: string; event: string; actorWallet: string | null; createdAt: string }[];
};

/** Old responses may omit legacy metadata; exact targets always require both fields. */
export function redemptionAllocationMatches(payload: Record<string, unknown>, selected: {
  redemptionAllocationPolicy?: RedemptionAllocationPolicy;
  redemptionTargetTokens?: string | null;
}): boolean {
  const policy = selected.redemptionAllocationPolicy ?? "integer-entitlements-v1";
  if (policy === "integer-entitlements-v1") {
    return (payload["redemptionAllocationPolicy"] === undefined || payload["redemptionAllocationPolicy"] === policy) &&
      (payload["redemptionTargetTokens"] === undefined || payload["redemptionTargetTokens"] === null) && selected.redemptionTargetTokens == null;
  }
  const target = selected.redemptionTargetTokens;
  return policy === "exact-target-largest-remainder-v2" && typeof target === "string" && /^[1-9][0-9]{0,19}$/.test(target) &&
    BigInt(target) <= MAX_TOKEN_AMOUNT && payload["redemptionAllocationPolicy"] === policy && payload["redemptionTargetTokens"] === target;
}

/** Keeps exact token amounts as decimal strings throughout draft creation/retry. */
export function earlyRedemptionDraftTerms(policy: RedemptionAllocationPolicy, input: {
  percentageBps: unknown; targetTokens: unknown; priceKzt: unknown;
}): { redemptionAllocationPolicy: RedemptionAllocationPolicy; redemptionPercentageBps: number | null;
  redemptionTargetTokens: string | null; redemptionPriceKzt: string } {
  if (typeof input.priceKzt !== "string" || !/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/.test(input.priceKzt)) {
    throw new Error("Укажите положительную цену KZT-Test, максимум 6 знаков после точки.");
  }
  const [whole, fraction = ""] = input.priceKzt.split(".");
  const price = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (price === 0n || price > (1n << 63n) - 1n) throw new Error("Цена погашения вне допустимого диапазона.");
  if (policy === "exact-target-largest-remainder-v2") {
    if (typeof input.targetTokens !== "string" || !/^[1-9][0-9]{0,18}$/.test(input.targetTokens) || BigInt(input.targetTokens) > (1n << 63n) - 1n) {
      throw new Error("Укажите положительное целое количество облигаций для погашения.");
    }
    return { redemptionAllocationPolicy: policy, redemptionTargetTokens: input.targetTokens, redemptionPercentageBps: null, redemptionPriceKzt: input.priceKzt };
  }
  const percentage = typeof input.percentageBps === "string" && /^[1-9][0-9]{0,4}$/.test(input.percentageBps) ? Number(input.percentageBps) : NaN;
  if (policy !== "integer-entitlements-v1" || !Number.isSafeInteger(percentage) || percentage > 10_000) {
    throw new Error("Доля должна быть от 1 до 10000 bps.");
  }
  return { redemptionAllocationPolicy: policy, redemptionTargetTokens: null, redemptionPercentageBps: percentage, redemptionPriceKzt: input.priceKzt };
}
export function snapshotWindowMessage(payload: Record<string, unknown>, actionId: string): string {
  if (payload["actionId"] !== actionId || payload["onChainTransition"] !== false ||
      !Number.isSafeInteger(payload["version"]) || !["SCHEDULED", "SNAPSHOT_MISSED"].includes(String(payload["status"])) ||
      (payload["window"] === "MISSED") !== (payload["status"] === "SNAPSHOT_MISSED")) {
    throw new Error("Ответ проверки окна не соответствует выбранному действию. Обновите карточку.");
  }
  switch (payload["window"]) {
    case "NOT_STARTED": return "Окно ещё не открылось. Дождитесь record date.";
    case "OPEN": return "Окно открыто. Подготовьте и подпишите snapshot до его закрытия.";
    case "AWAITING_CHAIN_WINDOW_END": return "Capture закрыт, но finalized-время сети ещё не подтвердило пропуск. Повторите проверку позже.";
    case "RECOVERY_REQUIRED": return "Сохранён snapshot или незавершённая попытка. Восстановите прежнюю операцию и проверьте её подпись; статус пропуска не установлен.";
    case "MISSED": return "Окно snapshot пропущено. Создайте новое действие с будущим record date. Исходное действие и audit сохранены; состояние Solana остаётся SCHEDULED.";
    default: throw new Error("API не вернул известное состояние окна snapshot.");
  }
}
export type PreparedAction = {
  corporateActionId: string; operationId: string; phase: "SCHEDULE" | "CANCEL"; cluster: SupportedSnapshotCluster;
  requiredSigner: string; networkGenesisHash: string; programId: string; instrumentAddress: string; actionAddress: string;
  serializedTransactionBase64: string; lastValidBlockHeight: number; reason: string | null;
  redemptionAllocationPolicy?: RedemptionAllocationPolicy; redemptionTargetTokens?: string | null; targetAddress?: string;
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
      !redemptionAllocationMatches(payload, action) ||
      !Number.isSafeInteger(payload["lastValidBlockHeight"]) || (payload["lastValidBlockHeight"] as number) < 0 ||
      typeof payload["serializedTransactionBase64"] !== "string" ||
      payload["phase"] === "CANCEL" && (typeof payload["reason"] !== "string" || payload["reason"].trim().length < 3)) throw invalid();
  for (const field of ["programId", "instrumentAddress", "actionAddress", "networkGenesisHash"] as const) {
    if (typeof payload[field] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payload[field])) throw invalid();
  }
  if (action.redemptionAllocationPolicy === "exact-target-largest-remainder-v2" && payload["phase"] === "SCHEDULE" &&
      (typeof payload["targetAddress"] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payload["targetAddress"]))) throw invalid();
  unsignedTransactionForSigner(payload["serializedTransactionBase64"], walletAddress);
  return payload as unknown as PreparedAction;
}

/** Binds v2 scheduling bytes to the reviewed quantity, dates, price and complete account privileges. */
export async function requireCorporateActionTransaction(plan: PreparedAction, action: CorporateActionView): Promise<void> {
  if (action.redemptionAllocationPolicy !== "exact-target-largest-remainder-v2") return;
  const invalid = () => new Error("Транзакция точного погашения отличается от проверенных условий. Подпись остановлена.");
  if (!redemptionAllocationMatches(plan as unknown as Record<string, unknown>, action) || plan.corporateActionId !== action.id ||
      action.type !== "EARLY_REDEMPTION" || action.redemptionPercentageBps !== null || plan.requiredSigner !== action.instrument.issuerAuthority ||
      !action.instrument.programId || plan.programId !== action.instrument.programId || !isActionId(action.instrumentId)) throw invalid();
  const uuid = (value: string) => Uint8Array.from(value.replaceAll("-", "").match(/../g)!, byte => parseInt(byte, 16));
  const programAddress = address(action.instrument.programId);
  const keyEncoder = getAddressEncoder();
  const [instrumentAddress] = await getProgramDerivedAddress({ programAddress, seeds: ["instrument", uuid(action.instrumentId)] });
  const [actionAddress] = await getProgramDerivedAddress({ programAddress, seeds: ["action", keyEncoder.encode(instrumentAddress), uuid(action.id)] });
  if (plan.instrumentAddress !== instrumentAddress || plan.actionAddress !== actionAddress) throw invalid();
  const expected = [
    { program: "ComputeBudget111111111111111111111111111111", accounts: [] as string[], data: "02801a0600" },
    { program: "ComputeBudget111111111111111111111111111111", accounts: [] as string[], data: "030000000000000000" }
  ];
  const discriminator = async (name: string) => transactionHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`global:${name}`)))).slice(0, 16);
  const writable = new Set([plan.requiredSigner, plan.actionAddress]);
  if (plan.phase === "SCHEDULE") {
    if (typeof plan.targetAddress !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(plan.targetAddress) ||
        !isActionId(action.id) || typeof action.redemptionPriceMinor !== "string" || !/^[1-9][0-9]{0,19}$/.test(action.redemptionPriceMinor) ||
        BigInt(action.redemptionPriceMinor) > MAX_TOKEN_AMOUNT) throw invalid();
    const [targetAddress] = await getProgramDerivedAddress({ programAddress, seeds: ["redemption_target", keyEncoder.encode(actionAddress)] });
    if (plan.targetAddress !== targetAddress) throw invalid();
    const encodeU64 = (value: string) => {
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true); return transactionHex(bytes);
    };
    const encodeTime = (value: string) => {
      const seconds = Date.parse(value) / 1000;
      if (!Number.isSafeInteger(seconds)) throw invalid();
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigInt64(0, BigInt(seconds), true); return transactionHex(bytes);
    };
    expected.push({ program: plan.programId, accounts: [plan.requiredSigner, plan.instrumentAddress, plan.actionAddress, plan.targetAddress, "11111111111111111111111111111111"],
      data: await discriminator("create_exact_redemption_action") + action.id.replace(/-/g, "").toLowerCase() + "02" +
        encodeTime(action.recordAt) + encodeTime(action.executeAt) + "00" + "01" + encodeU64(action.redemptionPriceMinor) + encodeU64(action.redemptionTargetTokens!) });
    writable.add(plan.targetAddress);
  } else if (plan.phase === "CANCEL") {
    expected.push({ program: plan.programId, accounts: [plan.requiredSigner, plan.instrumentAddress, plan.actionAddress], data: await discriminator("cancel_action") });
  } else throw invalid();
  requireReviewedTransaction(plan.serializedTransactionBase64, plan.requiredSigner, expected, writable, invalid);
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
