import { encodeBase58, isActionId, unsignedTransactionForSigner } from "./snapshot-workflow";
export type CouponExecutionView = { enabled: boolean; actionId: string; actionVersion: number; status: string;
  requiredSigner: string; programId: string; networkGenesisHash: string; settlementMint: string; snapshotHash: string;
  instrumentAddress: string; actionAddress: string; approvalPolicyAddress: string; reserveAddress: string; vaultAddress: string; actionReceiptAddress: string;
  totalAmountMinor: string; paid: number; payable: number; executeAt: string; pending: Record<string, unknown> | null;
  items: { id: string; investorId: string; displayName?: string; status: string; amountMinor: string; receiver: string; signature: string | null;
    entitlementAddress: string; entitlementReceiptAddress: string; recipientAddress: string }[] };
export type CouponExecutionPlan = Pick<CouponExecutionView, "programId" | "settlementMint" | "snapshotHash" | "actionAddress" | "reserveAddress" | "vaultAddress"> & { corporateActionId: string; operationId: string; phase: "PAY" | "FINALIZE"; cluster: "localnet";
  requiredSigner: string; serializedTransactionBase64: string; idempotencyKey: string; networkGenesisHash: string;
  amountMinor: string; settlementWallet: string | null; actionReceiptAddress?: string; receiptHash?: string; entitlementId: string | null };
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const hex = (value: Uint8Array) => [...value].map(byte => byte.toString(16).padStart(2, "0")).join("");
/** Compare every instruction, account and privilege with the independently loaded action before opening the wallet. */
export async function preparedCouponExecution(payload: Record<string, unknown>, view: CouponExecutionView, walletAddress: string): Promise<CouponExecutionPlan> {
  const invalid = () => new Error("План выплаты изменился или не соответствует выбранному действию. Обновите данные перед подписью.");
  const pay = payload["phase"] === "PAY";
  const row = view.items.find(value => value.id === payload["entitlementId"]);
  if (!view.enabled || payload["corporateActionId"] !== view.actionId || !isActionId(String(payload["operationId"])) ||
      payload["actionVersion"] !== view.actionVersion || (payload["lastValidBlockHeight"] as number) < 0 ||
      !["PAY", "FINALIZE"].includes(String(payload["phase"])) || payload["cluster"] !== "localnet" ||
      payload["requiredSigner"] !== walletAddress || view.requiredSigner !== walletAddress ||
      payload["programId"] !== view.programId || payload["networkGenesisHash"] !== view.networkGenesisHash ||
      payload["settlementMint"] !== view.settlementMint || payload["snapshotHash"] !== view.snapshotHash ||
      typeof payload["idempotencyKey"] !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload["idempotencyKey"]) ||
      payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" ||
      typeof payload["serializedTransactionBase64"] !== "string" || !Number.isSafeInteger(payload["lastValidBlockHeight"]) ||
      pay && (!row || payload["amountMinor"] !== row.amountMinor || payload["settlementWallet"] !== row.receiver) ||
      !pay && (payload["entitlementId"] !== null || payload["settlementWallet"] !== null || payload["amountMinor"] !== view.totalAmountMinor ||
        typeof payload["receiptHash"] !== "string" || !/^[0-9a-f]{64}$/.test(payload["receiptHash"]) || /^0{64}$/.test(payload["receiptHash"]) || payload["actionReceiptAddress"] !== view.actionReceiptAddress) ||
      !["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED", "FAILED"].includes(String(payload["status"])) ||
      payload["signature"] !== null && (typeof payload["signature"] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(payload["signature"])) ||
      ["SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED"].includes(String(payload["status"])) && !payload["signature"]) throw invalid();
  for (const field of ["actionAddress", "reserveAddress", "vaultAddress"] as const) if (payload[field] !== view[field]) throw invalid();
  if (pay && ["entitlementAddress", "entitlementReceiptAddress", "recipientAddress"].some(field => payload[field] !== row![field as keyof typeof row])) throw invalid();
  const idempotencyHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
    `coupon:${view.actionId}:${pay ? row!.id : "finalize"}:${payload["idempotencyKey"]}`))));
  if (payload["idempotencyHash"] !== idempotencyHash) throw invalid();
  const expected = [
    { program: COMPUTE, accounts: [] as string[], data: "02801a0600" },
    { program: COMPUTE, accounts: [] as string[], data: "030000000000000000" },
    ...(pay ? [{ program: ATA, accounts: [walletAddress, row!.recipientAddress, row!.receiver, view.settlementMint, SYSTEM, TOKEN], data: "01" }] : []),
    { program: view.programId, accounts: pay ? [walletAddress, view.instrumentAddress, view.approvalPolicyAddress, view.actionAddress,
      view.reserveAddress, view.vaultAddress, row!.entitlementAddress, row!.entitlementReceiptAddress, row!.recipientAddress, view.settlementMint, TOKEN, SYSTEM] :
      [walletAddress, view.instrumentAddress, view.actionAddress, view.actionReceiptAddress, SYSTEM, ...view.items.map(item => item.entitlementAddress)],
      data: pay ? "44ab8c98365c2100" + idempotencyHash : "4574aaf4692bdec2" + payload["receiptHash"] }
  ];
  const writable = new Set(pay ? [walletAddress, view.actionAddress, view.vaultAddress, row!.entitlementAddress, row!.entitlementReceiptAddress, row!.recipientAddress] :
    [walletAddress, view.actionAddress, view.actionReceiptAddress]);
  const bytes = unsignedTransactionForSigner(payload["serializedTransactionBase64"], walletAddress); let offset = 69;
  const read = () => { if (offset >= bytes.length) throw invalid(); return bytes[offset++]!; };
  const count = () => { const value = read(); if (value >= 128) throw invalid(); return value; };
  const keys = Array.from({ length: count() }, () => { const key = bytes.slice(offset, offset + 32); offset += 32; if (key.length !== 32) throw invalid(); return encodeBase58(key); });
  offset += 32;
  if (bytes[67] !== 0 || count() !== expected.length) throw invalid();
  for (const instruction of expected) {
    const program = keys[read()]; const accounts = Array.from({ length: count() }, () => keys[read()]);
    const length = count(); const data = bytes.slice(offset, offset + length); offset += length;
    if (data.length !== length || program !== instruction.program || hex(data) !== instruction.data ||
        JSON.stringify(accounts) !== JSON.stringify(instruction.accounts)) throw invalid();
  }
  const expectedKeys = new Set(expected.flatMap(instruction => [instruction.program, ...instruction.accounts]));
  if (count() !== 0 || offset !== bytes.length || keys.length !== expectedKeys.size || new Set(keys).size !== keys.length ||
      keys.some((key, index) => !expectedKeys.has(key) || writable.has(key) !== (index === 0 || index < keys.length - bytes[68]!))) throw invalid();
  return payload as CouponExecutionPlan;
}
export function couponReviewChanged(a: CouponExecutionPlan, b: CouponExecutionPlan) {
  return ["phase", "corporateActionId", "entitlementId", "idempotencyKey", "requiredSigner", "networkGenesisHash", "programId", "settlementMint", "snapshotHash", "actionAddress", "reserveAddress", "vaultAddress", "amountMinor", "settlementWallet", "receiptHash", "actionReceiptAddress"]
    .some(key => a[key as keyof CouponExecutionPlan] !== b[key as keyof CouponExecutionPlan]);
}
