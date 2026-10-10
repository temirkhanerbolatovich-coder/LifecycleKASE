import { isActionId } from "./snapshot-workflow";
import { requireReviewedTransaction, transactionHex } from "./reviewed-transaction";

export type RedemptionSource = { address: string; walletAddress: string; balanceAtSnapshot: string; burnAmount: string;
  balanceBefore?: string | null; expectedBalanceAfter?: string | null };
export type RedemptionExecutionItem = { id: string; investorId: string; displayName?: string; status: string;
  amountMinor: string; tokensToRedeem: string; receiver: string; signature: string | null; entitlementAddress: string;
  redemptionSourcesAddress: string; redemptionReceiptAddress: string; sourceHash: string; recipientAddress: string;
  burnAvailable: boolean; tokenAccounts: RedemptionSource[] };
export type RedemptionExecutionView = { enabled: boolean; actionId: string; actionVersion: number; actionType: string; status: string;
  requiredSigner: string; programId: string; networkGenesisHash: string; settlementMint: string; tokenMint: string; snapshotHash: string;
  instrumentAddress: string; instrumentAuthorityAddress: string; actionAddress: string; approvalPolicyAddress: string;
  reserveAddress: string; vaultAddress: string; redemptionProgressAddress: string; actionReceiptAddress: string;
  totalAmountMinor: string; currentTokenSupply: string; paid: number; payable: number; executeAt: string;
  pending: Record<string, unknown> | null; items: RedemptionExecutionItem[] };
export type RedemptionExecutionPlan = Pick<RedemptionExecutionView, "programId" | "networkGenesisHash" | "settlementMint" | "tokenMint" |
  "snapshotHash" | "instrumentAddress" | "instrumentAuthorityAddress" | "actionAddress" | "reserveAddress" | "vaultAddress" |
  "redemptionProgressAddress" | "actionType"> & { corporateActionId: string; operationId: string; phase: "PAY" | "FINALIZE";
  cluster: "localnet"; actionVersion: number; requiredSigner: string; serializedTransactionBase64: string; idempotencyKey: string;
  amountMinor: string; settlementWallet: string | null; entitlementId: string | null; tokensToRedeem?: string;
  tokenAccounts?: (RedemptionSource & { balanceBefore: string; expectedBalanceAfter: string })[];
  supplyBefore?: string; supplyAfter?: string; actionReceiptAddress?: string; receiptHash?: string;
  totalTokensRedeemed?: string; finalSupply?: string; status: string; signature: string | null };
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const integer = (value: unknown) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= (1n << 64n) - 1n;
const key = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value) && !/^0{64}$/.test(value);
async function sha256(value: string) { return transactionHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }

/** Load the committed source accounts independently of the unsigned transaction returned by prepare. */
export function redemptionExecutionView(payload: Record<string, unknown>, actionId: string, actionType: string): RedemptionExecutionView {
  const fail = () => new Error("Состояние погашения не соответствует выбранному действию. Обновите карточку.");
  if (payload["enabled"] === false) return payload as unknown as RedemptionExecutionView;
  if (payload["actionId"] !== actionId || payload["actionType"] !== actionType || !["EARLY_REDEMPTION", "BOND_REDEMPTION"].includes(actionType) ||
      typeof payload["enabled"] !== "boolean" || !Number.isSafeInteger(payload["actionVersion"]) || Number(payload["actionVersion"]) < 0) throw fail();
  if (!["requiredSigner", "programId", "networkGenesisHash", "settlementMint", "tokenMint", "instrumentAddress", "instrumentAuthorityAddress",
    "actionAddress", "approvalPolicyAddress", "reserveAddress", "vaultAddress", "redemptionProgressAddress", "actionReceiptAddress"].every(field => key(payload[field])) ||
      !hash(payload["snapshotHash"]) || !integer(payload["totalAmountMinor"]) || !integer(payload["currentTokenSupply"]) ||
      !Array.isArray(payload["items"]) || !Number.isSafeInteger(payload["paid"]) || !Number.isSafeInteger(payload["payable"]) ||
      Number(payload["paid"]) < 0 || Number(payload["paid"]) > Number(payload["payable"]) ||
      payload["pending"] !== null && (!payload["pending"] || typeof payload["pending"] !== "object" || Array.isArray(payload["pending"]))) throw fail();
  const view = payload as unknown as RedemptionExecutionView;
  if (new Set(view.items.map(row => row.id)).size !== view.items.length) throw fail();
  for (const row of view.items) {
    if (!isActionId(row.id) || !isActionId(row.investorId) || !integer(row.amountMinor) || !integer(row.tokensToRedeem) ||
        ![row.receiver, row.entitlementAddress, row.redemptionSourcesAddress, row.redemptionReceiptAddress, row.recipientAddress].every(key) ||
        !hash(row.sourceHash) || typeof row.burnAvailable !== "boolean" || !Array.isArray(row.tokenAccounts) || new Set(row.tokenAccounts.map(source => source.address)).size !== row.tokenAccounts.length) throw fail();
    for (const source of row.tokenAccounts) {
      if (!key(source.address) || !key(source.walletAddress) || !integer(source.balanceAtSnapshot) || !integer(source.burnAmount) ||
          BigInt(source.burnAmount) > BigInt(source.balanceAtSnapshot)) throw fail();
      if (row.status !== "REDEEMED" && row.burnAvailable && (!integer(source.balanceBefore) || !integer(source.expectedBalanceAfter))) throw fail();
      if (!row.burnAvailable && (source.balanceBefore !== null || source.expectedBalanceAfter !== null)) throw fail();
    }
    if (row.tokenAccounts.reduce((sum, source) => sum + BigInt(source.burnAmount), 0n) !== BigInt(row.tokensToRedeem) ||
        row.tokenAccounts.some((source, index) => index > 0 && source.address <= row.tokenAccounts[index - 1]!.address)) throw fail();
  }
  if (view.items.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(view.totalAmountMinor) ||
      view.payable !== view.items.filter(row => row.tokensToRedeem !== "0").length ||
      view.paid !== view.items.filter(row => row.status === "REDEEMED").length) throw fail();
  return view;
}

/** Signed/unknown attempts always restore confirmation; a malformed saved signature fails closed. */
export function redemptionExecutionSignature(payload: Record<string, unknown>): string | null {
  const signature = payload["signature"];
  if (payload["status"] === "PREPARED" && signature === null) return null;
  if (!["SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED", "FAILED"].includes(String(payload["status"])) ||
      typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    throw new Error("Сохранённая попытка не содержит исходной подписи. Повторная отправка остановлена.");
  }
  return signature;
}

/** Validate the entire payment+burn transaction, including every source, writable privilege and supply delta. */
export async function preparedRedemptionExecution(payload: Record<string, unknown>, view: RedemptionExecutionView, wallet: string): Promise<RedemptionExecutionPlan> {
  const fail = () => new Error("План выплаты и сжигания отличается от проверенных условий. Подпись остановлена.");
  const pay = payload["phase"] === "PAY";
  const row = view.items.find(item => item.id === payload["entitlementId"]);
  if (!view.enabled || payload["corporateActionId"] !== view.actionId || !isActionId(String(payload["operationId"])) ||
      !["PAY", "FINALIZE"].includes(String(payload["phase"])) || payload["cluster"] !== "localnet" || payload["requiredSigner"] !== wallet ||
      view.requiredSigner !== wallet || payload["actionVersion"] !== view.actionVersion ||
      typeof payload["idempotencyKey"] !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload["idempotencyKey"]) ||
      payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" || typeof payload["serializedTransactionBase64"] !== "string" ||
      !Number.isSafeInteger(payload["lastValidBlockHeight"]) || Number(payload["lastValidBlockHeight"]) < 0 ||
      !["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED", "FAILED"].includes(String(payload["status"]))) throw fail();
  const savedSignature = redemptionExecutionSignature(payload);
  for (const field of ["actionType", "programId", "networkGenesisHash", "settlementMint", "tokenMint", "snapshotHash", "instrumentAddress",
    "instrumentAuthorityAddress", "actionAddress", "approvalPolicyAddress", "reserveAddress", "vaultAddress", "redemptionProgressAddress"] as const) {
    if (payload[field] !== view[field]) throw fail();
  }
  if (pay) {
    if (!row || row.tokensToRedeem === "0" || row.amountMinor === "0" || payload["amountMinor"] !== row.amountMinor || payload["settlementWallet"] !== row.receiver || payload["tokensToRedeem"] !== row.tokensToRedeem ||
        !integer(payload["supplyBefore"]) || !integer(payload["supplyAfter"]) || !Array.isArray(payload["tokenAccounts"]) ||
        BigInt(String(payload["supplyBefore"])) - BigInt(String(payload["supplyAfter"])) !== BigInt(row.tokensToRedeem) ||
        !savedSignature && (!row.burnAvailable || payload["supplyBefore"] !== view.currentTokenSupply)) throw fail();
    for (const field of ["entitlementAddress", "redemptionSourcesAddress", "redemptionReceiptAddress", "recipientAddress", "sourceHash"] as const) {
      if (payload[field] !== row[field]) throw fail();
    }
    const sources = payload["tokenAccounts"] as NonNullable<RedemptionExecutionPlan["tokenAccounts"]>;
    if (sources.length !== row.tokenAccounts.length) throw fail();
    for (const [index, source] of sources.entries()) {
      const original = row.tokenAccounts[index]!;
      if (!source || ["address", "walletAddress", "balanceAtSnapshot", "burnAmount"].some(field => source[field as keyof RedemptionSource] !== original[field as keyof RedemptionSource]) ||
          !integer(source.balanceBefore) || !integer(source.expectedBalanceAfter) || BigInt(source.balanceBefore) - BigInt(source.expectedBalanceAfter) !== BigInt(source.burnAmount) ||
          !savedSignature && (source.balanceBefore !== original.balanceBefore || source.expectedBalanceAfter !== original.expectedBalanceAfter)) throw fail();
    }
  } else {
    const totalBurn = view.items.reduce((sum, item) => sum + BigInt(item.tokensToRedeem), 0n);
    if (payload["entitlementId"] !== null || payload["settlementWallet"] !== null || payload["amountMinor"] !== view.totalAmountMinor ||
        view.paid !== view.payable ||
        payload["totalTokensRedeemed"] !== totalBurn.toString() || !integer(payload["finalSupply"]) ||
        !savedSignature && payload["finalSupply"] !== view.currentTokenSupply || view.actionType === "BOND_REDEMPTION" && payload["finalSupply"] !== "0" ||
        !hash(payload["receiptHash"]) || payload["actionReceiptAddress"] !== view.actionReceiptAddress) throw fail();
  }
  const idempotencyHash = await sha256(`redemption:${view.actionId}:${pay ? row!.id : "finalize"}:${payload["idempotencyKey"]}`);
  if (payload["idempotencyHash"] !== idempotencyHash) throw fail();
  const expected = [
    { program: COMPUTE, accounts: [] as string[], data: "02801a0600" },
    { program: COMPUTE, accounts: [] as string[], data: "030000000000000000" },
    ...(pay ? [{ program: ATA, accounts: [wallet, row!.recipientAddress, row!.receiver, view.settlementMint, SYSTEM, TOKEN], data: "01" }] : []),
    { program: view.programId, accounts: pay ? [wallet, view.instrumentAddress, view.approvalPolicyAddress, view.actionAddress, view.reserveAddress,
      view.vaultAddress, row!.entitlementAddress, row!.redemptionSourcesAddress, view.redemptionProgressAddress, row!.redemptionReceiptAddress,
      row!.recipientAddress, view.settlementMint, view.tokenMint, view.instrumentAuthorityAddress, TOKEN, SYSTEM, ...row!.tokenAccounts.map(source => source.address)] :
      [wallet, view.instrumentAddress, view.actionAddress, view.redemptionProgressAddress, view.tokenMint, view.actionReceiptAddress, SYSTEM, ...view.items.map(item => item.entitlementAddress)],
      data: (await sha256(`global:${pay ? "execute_redemption" : "finalize_redemption"}`)).slice(0, 16) + (pay ? idempotencyHash : payload["receiptHash"]) }
  ];
  const writable = new Set(pay ? [wallet, view.actionAddress, view.vaultAddress, row!.entitlementAddress, view.redemptionProgressAddress,
    row!.redemptionReceiptAddress, row!.recipientAddress, view.tokenMint, ...row!.tokenAccounts.map(source => source.address)] :
    [wallet, view.instrumentAddress, view.actionAddress, view.actionReceiptAddress]);
  requireReviewedTransaction(payload["serializedTransactionBase64"], wallet, expected, writable, fail);
  return payload as unknown as RedemptionExecutionPlan;
}

export function redemptionReviewChanged(previous: RedemptionExecutionPlan, current: RedemptionExecutionPlan): boolean {
  return ["phase", "corporateActionId", "actionVersion", "actionType", "entitlementId", "idempotencyKey", "requiredSigner", "networkGenesisHash", "programId",
    "settlementMint", "tokenMint", "snapshotHash", "actionAddress", "reserveAddress", "vaultAddress", "amountMinor", "settlementWallet", "tokensToRedeem",
    "supplyBefore", "supplyAfter", "receiptHash", "actionReceiptAddress", "totalTokensRedeemed", "finalSupply"].some(field =>
    previous[field as keyof RedemptionExecutionPlan] !== current[field as keyof RedemptionExecutionPlan]) || JSON.stringify(previous.tokenAccounts) !== JSON.stringify(current.tokenAccounts);
}

/** A download is evidence only after its canonical JSON matches the confirmed hash and selected action. */
export async function finalizedRedemptionReceipt(payload: Record<string, unknown>, view: RedemptionExecutionView): Promise<string> {
  const json = payload["canonicalJson"];
  if (payload["actionId"] !== view.actionId || payload["status"] !== "FINALIZED" || typeof json !== "string" ||
      !hash(payload["sha256"]) || payload["onchainPda"] !== view.actionReceiptAddress ||
      typeof payload["signature"] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(payload["signature"]) ||
      await sha256(json) !== payload["sha256"]) throw new Error("Итоговый документ не подтверждён или его hash изменился.");
  const data: unknown = JSON.parse(json);
  if (!data || typeof data !== "object" || Array.isArray(data) || (data as Record<string, unknown>)["actionId"] !== view.actionId ||
      (data as Record<string, unknown>)["actionType"] !== view.actionType) throw new Error("Итоговый документ относится к другому действию.");
  return json;
}
