import { isActionId } from "./snapshot-workflow";
import { requireReviewedTransaction, transactionHex } from "./reviewed-transaction";
import { allocateEarlyRedemption } from "@lifecycle-kase/domain/early-redemption-allocation";
import { redemptionAllocationMatches, type RedemptionAllocationPolicy } from "./action-workflow";
import { controlledHoldingAddress, derivedAddress, publicKeyBytes, unitReservationAddress, type InstrumentTokenPolicy } from "./controlled-identity";
import { requireControlledCaptureEvidence } from "./controlled-evidence";

export type RedemptionSource = { address: string; walletAddress: string; balanceAtSnapshot: string; burnAmount: string;
  balanceBefore?: string | null; expectedBalanceAfter?: string | null; sourceUntouched?: boolean };
export type RedemptionExecutionItem = { id: string; investorId: string; displayName?: string; status: string;
  amountMinor: string; tokensToRedeem: string; receiver: string; signature: string | null; entitlementAddress: string;
  redemptionSourcesAddress: string; redemptionReceiptAddress: string; sourceHash: string; recipientAddress: string;
  burnAvailable: boolean; tokenAccounts: RedemptionSource[];
  unitReservationAddress?: string; controlledPolicyAddress?: string; holdingAddresses?: string[];
  exactAllocation?: { balanceAtRecordDate: string; tieAddress: string } };
export type RedemptionExecutionView = { enabled: boolean; actionId: string; actionVersion: number; actionType: string; status: string;
  redemptionAllocationPolicy?: RedemptionAllocationPolicy; redemptionTargetTokens?: string | null;
  snapshotSupply?: string; totalBalance?: string;
  tokenPolicy?: InstrumentTokenPolicy;
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
  tokenAccounts?: (RedemptionSource & { balanceBefore: string | null; expectedBalanceAfter: string | null })[];
  supplyBefore?: string; supplyAfter?: string; actionReceiptAddress?: string; receiptHash?: string;
  totalTokensRedeemed?: string; finalSupply?: string; status: string; signature: string | null;
  redemptionAllocationPolicy?: RedemptionAllocationPolicy; redemptionTargetTokens?: string | null;
  tokenPolicy?: InstrumentTokenPolicy; controlledPolicyAddress?: string; controlledCaptureAddress?: string;
  unitReservationAddress?: string; holdingAddresses?: string[]; assignedAllocations?: string[]; completesControlledRedemption?: boolean };
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
  if (view.tokenPolicy !== undefined && !["LEGACY_UNRESTRICTED_V1", "CONTROLLED_FROZEN_V2"].includes(view.tokenPolicy)) throw fail();
  if (!redemptionAllocationMatches(payload, view) || view.redemptionAllocationPolicy === "exact-target-largest-remainder-v2" && actionType !== "EARLY_REDEMPTION") throw fail();
  if (new Set(view.items.map(row => row.id)).size !== view.items.length) throw fail();
  for (const row of view.items) {
    if (!isActionId(row.id) || !isActionId(row.investorId) || !integer(row.amountMinor) || !integer(row.tokensToRedeem) ||
        ![row.receiver, row.entitlementAddress, row.redemptionSourcesAddress, row.redemptionReceiptAddress, row.recipientAddress].every(key) ||
        !hash(row.sourceHash) || typeof row.burnAvailable !== "boolean" || !Array.isArray(row.tokenAccounts) || new Set(row.tokenAccounts.map(source => source.address)).size !== row.tokenAccounts.length) throw fail();
    for (const source of row.tokenAccounts) {
      if (!key(source.address) || !key(source.walletAddress) || !integer(source.balanceAtSnapshot) || !integer(source.burnAmount) ||
          BigInt(source.burnAmount) > BigInt(source.balanceAtSnapshot)) throw fail();
      if (view.tokenPolicy === "CONTROLLED_FROZEN_V2" && source.burnAmount === "0" && row.burnAvailable) {
        if (source.balanceBefore !== null || source.expectedBalanceAfter !== null || source.sourceUntouched !== true) throw fail();
      } else if (row.status !== "REDEEMED" && row.burnAvailable && (!integer(source.balanceBefore) || !integer(source.expectedBalanceAfter))) throw fail();
      if (!row.burnAvailable && (source.balanceBefore !== null || source.expectedBalanceAfter !== null)) throw fail();
    }
    if (row.tokenAccounts.reduce((sum, source) => sum + BigInt(source.burnAmount), 0n) !== BigInt(row.tokensToRedeem) ||
        row.tokenAccounts.some((source, index) => index > 0 && source.address <= row.tokenAccounts[index - 1]!.address)) throw fail();
  }
  if (view.items.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(view.totalAmountMinor) ||
      view.redemptionAllocationPolicy === "exact-target-largest-remainder-v2" &&
      view.items.reduce((sum, row) => sum + BigInt(row.tokensToRedeem), 0n).toString() !== view.redemptionTargetTokens ||
      view.payable !== view.items.filter(row => row.tokensToRedeem !== "0").length ||
      view.paid !== view.items.filter(row => row.status === "REDEEMED").length) throw fail();
  if (view.redemptionAllocationPolicy === "exact-target-largest-remainder-v2") exactAllocationFromView(view, fail);
  return view;
}

/** Zero-allocation rows retain their immutable owner/balance even without live burn accounts. */
function exactAllocationFromView(view: RedemptionExecutionView, invalid: () => Error) {
  try {
    if (view.actionType !== "EARLY_REDEMPTION" || !integer(view.snapshotSupply) || !integer(view.totalBalance) ||
        view.snapshotSupply !== view.totalBalance || !integer(view.redemptionTargetTokens) || view.redemptionTargetTokens === "0") throw invalid();
    const allocation = allocateEarlyRedemption({ targetTokens: BigInt(view.redemptionTargetTokens!), rows: view.items.map(item => {
      if (!item.exactAllocation || !integer(item.exactAllocation.balanceAtRecordDate) || !key(item.exactAllocation.tieAddress)) throw invalid();
      return { investorId: item.investorId, tieAddress: item.exactAllocation.tieAddress, balance: BigInt(item.exactAllocation.balanceAtRecordDate) };
    }) });
    if (allocation.totalBalance.toString() !== view.totalBalance) throw invalid();
    for (const expected of allocation.rows) {
      const item = view.items.find(row => row.investorId.toLowerCase() === expected.investorId)!;
      if (item.tokensToRedeem !== expected.redeemedTokens.toString()) throw invalid();
    }
    return allocation;
  } catch { throw invalid(); }
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
  const controlled = view.tokenPolicy === "CONTROLLED_FROZEN_V2";
  const row = view.items.find(item => item.id === payload["entitlementId"]);
  if (!view.enabled || payload["corporateActionId"] !== view.actionId || !isActionId(String(payload["operationId"])) ||
      !["PAY", "FINALIZE"].includes(String(payload["phase"])) || payload["cluster"] !== "localnet" || payload["requiredSigner"] !== wallet ||
      view.requiredSigner !== wallet || payload["actionVersion"] !== view.actionVersion ||
      !redemptionAllocationMatches(payload, view) ||
      typeof payload["idempotencyKey"] !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload["idempotencyKey"]) ||
      payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" || typeof payload["serializedTransactionBase64"] !== "string" ||
      !Number.isSafeInteger(payload["lastValidBlockHeight"]) || Number(payload["lastValidBlockHeight"]) < 0 ||
      !["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED", "FAILED"].includes(String(payload["status"]))) throw fail();
  if (controlled ? payload["tokenPolicy"] !== view.tokenPolicy : payload["tokenPolicy"] !== undefined && payload["tokenPolicy"] !== "LEGACY_UNRESTRICTED_V1") throw fail();
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
          (controlled && source.burnAmount === "0" ? source.balanceBefore !== null || source.expectedBalanceAfter !== null || source.sourceUntouched !== true :
            !integer(source.balanceBefore) || !integer(source.expectedBalanceAfter) || BigInt(source.balanceBefore!) - BigInt(source.expectedBalanceAfter!) !== BigInt(source.burnAmount)) ||
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
      data: (await sha256(`global:${pay ? controlled ? "execute_controlled_redemption" : "execute_redemption" : "finalize_redemption"}`)).slice(0, 16) + (pay ? idempotencyHash : payload["receiptHash"]) }
  ];
  const writable = new Set(pay ? [wallet, view.actionAddress, view.vaultAddress, row!.entitlementAddress, view.redemptionProgressAddress,
    row!.redemptionReceiptAddress, row!.recipientAddress, view.tokenMint, ...row!.tokenAccounts.map(source => source.address)] :
    [wallet, view.instrumentAddress, view.actionAddress, view.actionReceiptAddress]);
  if (controlled) {
    const policyAddress = await derivedAddress(view.programId, ["controlled-policy", publicKeyBytes(view.instrumentAddress)]);
    const captureAddress = await derivedAddress(view.programId, ["controlled-capture", publicKeyBytes(view.actionAddress)]);
    if (payload["controlledPolicyAddress"] !== policyAddress || payload["controlledCaptureAddress"] !== captureAddress) throw fail();
    if (pay) {
      const reservationAddress = await unitReservationAddress(view.programId, row!.entitlementAddress);
      const holdings = await Promise.all(row!.tokenAccounts.map(source => controlledHoldingAddress(view.programId, view.instrumentAddress, source.address)));
      let remaining = BigInt(row!.tokensToRedeem);
      const allocations = row!.tokenAccounts.map(source => { const amount = BigInt(source.balanceAtSnapshot) < remaining ? BigInt(source.balanceAtSnapshot) : remaining; remaining -= amount; return amount.toString(); });
      if (remaining !== 0n || payload["unitReservationAddress"] !== reservationAddress || row!.unitReservationAddress !== reservationAddress ||
          JSON.stringify(payload["holdingAddresses"]) !== JSON.stringify(holdings) || JSON.stringify(row!.holdingAddresses) !== JSON.stringify(holdings) ||
          JSON.stringify(payload["assignedAllocations"]) !== JSON.stringify(allocations) || row!.tokenAccounts.some((source, index) => source.burnAmount !== allocations[index])) throw fail();
      expected[expected.length - 1]!.accounts.push(policyAddress, reservationAddress, ...holdings);
      writable.add(reservationAddress); holdings.forEach(value => writable.add(value));
    } else {
      if (payload["completesControlledRedemption"] !== true) throw fail();
      expected.push({ program: view.programId, accounts: [wallet, view.instrumentAddress, view.actionAddress, policyAddress], data: (await sha256("global:complete_controlled_redemption")).slice(0, 16) });
      writable.add(policyAddress);
    }
  }
  requireReviewedTransaction(payload["serializedTransactionBase64"], wallet, expected, writable, fail);
  return payload as unknown as RedemptionExecutionPlan;
}

export function redemptionReviewChanged(previous: RedemptionExecutionPlan, current: RedemptionExecutionPlan): boolean {
  return ["phase", "corporateActionId", "actionVersion", "actionType", "entitlementId", "idempotencyKey", "requiredSigner", "networkGenesisHash", "programId",
    "redemptionAllocationPolicy", "redemptionTargetTokens", "tokenPolicy", "controlledPolicyAddress", "controlledCaptureAddress", "unitReservationAddress", "completesControlledRedemption",
    "settlementMint", "tokenMint", "snapshotHash", "actionAddress", "reserveAddress", "vaultAddress", "amountMinor", "settlementWallet", "tokensToRedeem",
    "supplyBefore", "supplyAfter", "receiptHash", "actionReceiptAddress", "totalTokensRedeemed", "finalSupply"].some(field =>
    previous[field as keyof RedemptionExecutionPlan] !== current[field as keyof RedemptionExecutionPlan]) || JSON.stringify(previous.tokenAccounts) !== JSON.stringify(current.tokenAccounts) ||
    JSON.stringify(previous.holdingAddresses) !== JSON.stringify(current.holdingAddresses) || JSON.stringify(previous.assignedAllocations) !== JSON.stringify(current.assignedAllocations);
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
  const receipt = data as Record<string, unknown>;
  if (view.tokenPolicy === "CONTROLLED_FROZEN_V2") await validateControlledRedemptionReceipt(receipt, view);
  if (receipt["schemaVersion"] === "redemption-action-receipt-v2" || view.redemptionAllocationPolicy === "exact-target-largest-remainder-v2") {
    validateExactRedemptionReceipt(receipt, view);
  } else if (receipt["schemaVersion"] !== undefined && receipt["schemaVersion"] !== "redemption-action-receipt-v1" &&
      !(view.tokenPolicy === "CONTROLLED_FROZEN_V2" && receipt["schemaVersion"] === "redemption-controlled-action-receipt-v1")) {
    throw new Error("Итоговый документ содержит неподдерживаемую версию.");
  }
  return json;
}

function validateExactRedemptionReceipt(receipt: Record<string, unknown>, view: RedemptionExecutionView): void {
  const invalid = () => new Error("Итоговый документ точного погашения не совпадает с целью, snapshot или начислениями.");
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    return value as Record<string, unknown>;
  };
  try {
    const allocation = record(receipt["allocation"]); const snapshot = record(receipt["snapshot"]);
    const expected = exactAllocationFromView(view, invalid);
    if (receipt["schemaVersion"] !== (view.tokenPolicy === "CONTROLLED_FROZEN_V2" ? "redemption-controlled-action-receipt-v1" : "redemption-action-receipt-v2") || view.actionType !== "EARLY_REDEMPTION" ||
        view.redemptionAllocationPolicy !== "exact-target-largest-remainder-v2" || allocation["policy"] !== view.redemptionAllocationPolicy ||
        allocation["targetTokens"] !== view.redemptionTargetTokens || allocation["tieBreak"] !== "SNAPSHOT_OWNER_BASE58_ASC" ||
        !integer(allocation["targetTokens"]) || !integer(allocation["totalBalance"]) || !integer(snapshot["mintSupply"]) ||
        snapshot["mintSupply"] !== view.snapshotSupply || snapshot["hash"] !== view.snapshotHash ||
        allocation["totalBalance"] !== view.totalBalance || receipt["totalTokensRedeemed"] !== allocation["targetTokens"] ||
        !integer(receipt["finalSupply"]) || !Array.isArray(receipt["entitlements"])) throw invalid();
    const items = receipt["entitlements"].map(value => {
      const item = record(value); const quota = record(item["allocation"]);
      if (typeof item["investorId"] !== "string" || typeof quota["tieAddress"] !== "string" || !integer(item["tokensRedeemed"]) ||
          !integer(quota["remainingTokens"]) || !integer(quota["roundingRemainder"]) || quota["denominator"] !== allocation["totalBalance"]) throw invalid();
      const selected = view.items.find(row => row.id === item["entitlementId"] && row.investorId === item["investorId"]);
      if (!selected || selected.tokensToRedeem !== item["tokensRedeemed"] || selected.amountMinor !== item["amountMinor"] ||
          quota["tieAddress"] !== selected.exactAllocation!.tieAddress ||
          BigInt(item["tokensRedeemed"] as string) + BigInt(quota["remainingTokens"] as string) !== BigInt(selected.exactAllocation!.balanceAtRecordDate)) throw invalid();
      return { item, quota, investorId: item["investorId"] };
    });
    if (items.length !== view.items.length || expected.totalBalance.toString() !== allocation["totalBalance"] ||
        new Set(items.map(item => item.investorId.toLowerCase())).size !== items.length ||
        (expected.totalBalance - expected.targetTokens).toString() !== receipt["finalSupply"]) throw invalid();
    for (const row of expected.rows) {
      const original = items.find(item => item.investorId.toLowerCase() === row.investorId)!;
      if (original.item["tokensRedeemed"] !== row.redeemedTokens.toString() || original.quota["remainingTokens"] !== row.remainingTokens.toString() ||
          original.quota["roundingRemainder"] !== row.quotaRemainder.toString()) throw invalid();
    }
  } catch { throw invalid(); }
}

/** A governed receipt binds reservations to every immutable source, including untouched zero allocations. */
async function validateControlledRedemptionReceipt(receipt: Record<string, unknown>, view: RedemptionExecutionView) {
  const fail = () => new Error("Итог погашения не совпадает с резервами назначенных единиц или исходными счетами.");
  const record = (value: unknown) => { if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(); return value as Record<string, unknown>; };
  const signature = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);
  const controlled = record(receipt["controlledRegistry"]); const snapshot = record(receipt["snapshot"]);
  const capture = await derivedAddress(view.programId, ["controlled-capture", publicKeyBytes(view.actionAddress)]);
  await requireControlledCaptureEvidence(controlled["captureEvidence"], { programId: view.programId, instrumentAddress: view.instrumentAddress, actionAddress: view.actionAddress, tokenMint: view.tokenMint,
    sources: view.items.flatMap(item => item.tokenAccounts.map(source => ({ address: source.address, walletAddress: source.walletAddress, balanceAtSnapshot: source.balanceAtSnapshot }))) });
  const capturedSupply = view.items.reduce((sum, item) => sum + item.tokenAccounts.reduce((total, source) => total + BigInt(source.balanceAtSnapshot), 0n), 0n);
  const redeemedTokens = view.items.reduce((sum, item) => sum + BigInt(item.tokensToRedeem), 0n);
  if (receipt["schemaVersion"] !== "redemption-controlled-action-receipt-v1" || receipt["tokenPolicy"] !== view.tokenPolicy ||
      receipt["programId"] !== view.programId || receipt["genesisHash"] !== view.networkGenesisHash || receipt["bondMint"] !== view.tokenMint ||
      receipt["reconciliation"] !== "MATCHED" || receipt["totalAmountMinor"] !== view.totalAmountMinor || snapshot["hash"] !== view.snapshotHash ||
      snapshot["mintSupply"] !== capturedSupply.toString() || redeemedTokens > capturedSupply ||
      receipt["finalSupply"] !== (capturedSupply - redeemedTokens).toString() || receipt["totalTokensRedeemed"] !== redeemedTokens.toString() ||
      controlled["captureAddress"] !== capture || !signature(controlled["captureFinishSignature"]) ||
      controlled["assignedUnitPolicy"] !== "SNAPSHOT_SOURCE_BASE58_ASC_GREEDY" || controlled["untouchedZeroSources"] !== "IMMUTABLE_COMMITMENT_ONLY" || !Array.isArray(receipt["entitlements"])) throw fail();
  const rows = receipt["entitlements"].map(record);
  if (rows.length !== view.items.length || new Set(rows.map(row => row["entitlementId"])).size !== rows.length) throw fail();
  const supplySteps = new Map<bigint, bigint>();
  for (const item of view.items) {
    const row = rows.find(row => row["entitlementId"] === item.id);
    if (!row || row["investorId"] !== item.investorId || row["amountMinor"] !== item.amountMinor || row["tokensRedeemed"] !== item.tokensToRedeem) throw fail();
    const zero = item.tokensToRedeem === "0";
    const settlement = zero ? null : record(row["settlement"]);
    const reservation = record(zero ? row["unitReservation"] : settlement!["unitReservation"]);
    const reservationAddress = await unitReservationAddress(view.programId, item.entitlementAddress);
    const holdings = await Promise.all(item.tokenAccounts.map(source => controlledHoldingAddress(view.programId, view.instrumentAddress, source.address)));
    if (reservation["unitReservationAddress"] !== reservationAddress || reservation["sourceHash"] !== item.sourceHash || reservation["consumed"] !== !zero ||
        JSON.stringify(reservation["allocations"]) !== JSON.stringify(item.tokenAccounts.map(source => source.burnAmount)) || !Array.isArray(reservation["holdings"]) ||
        reservation["holdings"].length !== item.tokenAccounts.length || zero && (!signature(reservation["signature"]) || row["settlement"] !== null)) throw fail();
    for (const [index, value] of reservation["holdings"].entries()) {
      const holding = record(value); const original = item.tokenAccounts[index]!;
      if (holding["address"] !== holdings[index] || holding["tokenAccount"] !== original.address || holding["walletAddress"] !== original.walletAddress || holding["reservedTokens"] !== "0") throw fail();
    }
    if (zero) continue;
    if (settlement!["receiver"] !== item.receiver || settlement!["signature"] !== item.signature || settlement!["sourceHash"] !== item.sourceHash ||
        settlement!["receiptAddress"] !== item.redemptionReceiptAddress ||
        !integer(settlement!["supplyBefore"]) || !integer(settlement!["supplyAfter"]) ||
        BigInt(settlement!["supplyBefore"] as string) - BigInt(settlement!["supplyAfter"] as string) !== BigInt(item.tokensToRedeem) ||
        settlement!["freezePolicy"] !== "ATOMIC_THAW_BURN_REFREEZE" || settlement!["cashLeg"] !== "CONFIRMED" || settlement!["assetLeg"] !== "CONFIRMED" || settlement!["reconciliation"] !== "MATCHED" ||
        !Array.isArray(settlement!["tokenAccounts"]) || settlement!["tokenAccounts"].length !== item.tokenAccounts.length) throw fail();
    const supplyBefore = BigInt(settlement!["supplyBefore"] as string);
    if (supplySteps.has(supplyBefore)) throw fail();
    supplySteps.set(supplyBefore, BigInt(settlement!["supplyAfter"] as string));
    for (const [index, value] of settlement!["tokenAccounts"].entries()) {
      const source = record(value); const original = item.tokenAccounts[index]!;
      if (["address", "walletAddress", "balanceAtSnapshot", "burnAmount", "balanceBefore", "expectedBalanceAfter", "sourceUntouched"].some(field =>
        source[field] !== original[field as keyof RedemptionSource])) throw fail();
      if (original.burnAmount === "0") {
        if (source["sourceUntouched"] !== true || source["balanceBefore"] !== null || source["expectedBalanceAfter"] !== null) throw fail();
      } else if (source["sourceUntouched"] === true || !integer(source["balanceBefore"]) || !integer(source["expectedBalanceAfter"]) ||
          BigInt(source["balanceBefore"] as string) - BigInt(source["expectedBalanceAfter"] as string) !== BigInt(original.burnAmount)) throw fail();
    }
  }
  // Canonical investor order may differ from execution order; every burn must still form one supply chain.
  let supply = capturedSupply;
  for (let index = 0; index < supplySteps.size; index++) {
    const after = supplySteps.get(supply);
    if (after === undefined) throw fail();
    supply = after;
  }
  if (supply !== capturedSupply - redeemedTokens) throw fail();
}
