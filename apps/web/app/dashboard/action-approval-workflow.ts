import { encodeBase58, isActionId, unsignedTransactionForSigner } from "./snapshot-workflow";
export type ApprovalPhase = "ASSIGN_APPROVER" | "RESERVE" | "RELEASE" | "APPROVE";
export type ApprovalView = { actionId: string; actionVersion: number; issuer: string; approver: string | null;
  programId: string; networkGenesisHash: string; instrumentId: string; instrumentAddress: string; actionAddress: string;
  policyAddress: string; reserveAddress: string; vaultAddress: string; settlementMint: string; snapshotHash: string;
  amountMinor: string; treasuryBalanceMinor: string; reservedMinor: string; networkReserveLamports: string;
  reserveExists: boolean; approved: boolean; pending: Record<string, unknown> | null };
export type ApprovalPlan = Pick<ApprovalView, "actionVersion" | "issuer" | "approver" | "programId" | "networkGenesisHash" | "instrumentId" | "instrumentAddress" | "actionAddress" | "reserveAddress" | "vaultAddress" | "settlementMint" | "snapshotHash" | "amountMinor" | "networkReserveLamports"> & { corporateActionId: string; operationId: string; phase: ApprovalPhase; cluster: "localnet";
  approvalPolicyAddress: string; requiredSigner: string; serializedTransactionBase64: string; signature: string | null;
  treasuryAddress: string; feeLamports: string; creationRentLamports: string; recipientRentLamports: string;
  estimatedExecutionFeeLamports: string; requiredLamports: string; payerLamports: string; lastValidBlockHeight: number; note: string | null;
  status: "PREPARED" | "SUBMITTED" | "UNKNOWN_CONFIRMATION" | "FINALIZED" | "FAILED" };
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const discriminators = { ASSIGN_APPROVER: "e09a3076c19ad05b", RESERVE: "338308fd948e942b", RELEASE: "e9c851026b6fba02", APPROVE: "c8752c0d858b8324" };
const key = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const integer = (value: unknown) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= (1n << 64n) - 1n;
export function approvalView(payload: Record<string, unknown>): ApprovalView {
  if (!isActionId(String(payload["actionId"])) || !isActionId(String(payload["instrumentId"])) || !Number.isSafeInteger(payload["actionVersion"]) || Number(payload["actionVersion"]) < 0 ||
      !["issuer", "programId", "networkGenesisHash", "instrumentAddress", "actionAddress", "policyAddress", "reserveAddress", "vaultAddress", "settlementMint"].every(field => key(payload[field])) ||
      payload["approver"] !== null && !key(payload["approver"]) || typeof payload["snapshotHash"] !== "string" || !/^[0-9a-f]{64}$/i.test(payload["snapshotHash"]) ||
      !["amountMinor", "treasuryBalanceMinor", "reservedMinor", "networkReserveLamports"].every(field => integer(payload[field])) ||
      typeof payload["reserveExists"] !== "boolean" || typeof payload["approved"] !== "boolean" ||
      payload["pending"] !== null && (!payload["pending"] || typeof payload["pending"] !== "object" || Array.isArray(payload["pending"]))) throw new Error("Некорректное состояние approval/reserve.");
  return payload as unknown as ApprovalView;
}
function publicKeyBytes(value: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let integer = 0n;
  for (const char of value) { const digit = alphabet.indexOf(char); if (digit < 0) throw new Error("Invalid public key"); integer = integer * 58n + BigInt(digit); }
  const result = new Uint8Array(32);
  for (let index = 31; index >= 0; index--) { result[index] = Number(integer & 255n); integer >>= 8n; }
  if (integer !== 0n || encodeBase58(result) !== value) throw new Error("Invalid public key"); return result;
}
const hex = (value: Uint8Array) => [...value].map(byte => byte.toString(16).padStart(2, "0")).join("");
function u64Hex(value: string) { const result = new Uint8Array(8); new DataView(result.buffer).setBigUint64(0, BigInt(value), true); return hex(result); }
/** Exact instruction bytes, all accounts and privileges are reviewed before any wallet request. */
export function preparedActionApproval(payload: Record<string, unknown>, view: ApprovalView, wallet: string, chosenApprover?: string): ApprovalPlan {
  const fail = () => new Error("Approval-план отличается от проверенных полномочий, резерва или суммы. Подпись остановлена.");
  const phase = payload["phase"] as ApprovalPhase;
  if (!Object.hasOwn(discriminators, phase) || payload["cluster"] !== "localnet" || payload["corporateActionId"] !== view.actionId ||
      payload["actionVersion"] !== view.actionVersion || !isActionId(String(payload["operationId"])) || payload["requiredSigner"] !== wallet ||
      payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" || !Number.isSafeInteger(payload["lastValidBlockHeight"]) ||
      (payload["lastValidBlockHeight"] as number) < 0 || !key(payload["treasuryAddress"]) ||
      typeof payload["serializedTransactionBase64"] !== "string" ||
      !["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED", "FAILED"].includes(String(payload["status"])) ||
      payload["signature"] !== null && (typeof payload["signature"] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(payload["signature"])) ||
      ["SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED"].includes(String(payload["status"])) && !payload["signature"]) throw fail();
  if (phase === "APPROVE" ? typeof payload["note"] !== "string" || payload["note"].trim().length < 3 || payload["note"].length > 1000 : payload["note"] !== null) throw fail();
  for (const field of ["issuer", "programId", "networkGenesisHash", "instrumentId", "instrumentAddress", "actionAddress", "reserveAddress", "vaultAddress", "settlementMint", "snapshotHash", "amountMinor", "networkReserveLamports"] as const) {
    if (payload[field] !== view[field]) throw fail();
  }
  if (payload["approvalPolicyAddress"] !== view.policyAddress || payload["approver"] !== (phase === "ASSIGN_APPROVER" ? chosenApprover : view.approver) ||
      !key(payload["approver"]) || payload["approver"] === view.issuer || wallet !== (phase === "APPROVE" ? view.approver : view.issuer)) throw fail();
  for (const field of ["feeLamports", "creationRentLamports", "recipientRentLamports", "estimatedExecutionFeeLamports", "requiredLamports", "payerLamports"] as const) if (!integer(payload[field])) throw fail();
  const costs = ["feeLamports", "creationRentLamports", "recipientRentLamports", "estimatedExecutionFeeLamports", "networkReserveLamports"].reduce((sum, field) => sum + BigInt(String(payload[field])), 0n);
  if (BigInt(String(payload["requiredLamports"])) !== costs || BigInt(String(payload["payerLamports"])) < costs ||
      BigInt(view.amountMinor) <= 0n || BigInt(view.networkReserveLamports) < 5_000_000n) throw fail();
  const plan = payload as unknown as ApprovalPlan;
  const bytes = unsignedTransactionForSigner(plan.serializedTransactionBase64, wallet); let offset = 69;
  const read = () => { if (offset >= bytes.length) throw fail(); return bytes[offset++]!; };
  const count = () => { const result = read(); if (result >= 128) throw fail(); return result; };
  const keys = Array.from({ length: count() }, () => { const result = bytes.slice(offset, offset + 32); offset += 32; if (result.length !== 32) throw fail(); return encodeBase58(result); });
  offset += 32;
  if (bytes[67] !== 0 || count() !== 3) throw fail();
  const instructions = Array.from({ length: 3 }, () => {
    const program = keys[read()]; const accounts = Array.from({ length: count() }, () => keys[read()]);
    const length = count(); const data = bytes.slice(offset, offset + length); offset += length;
    if (data.length !== length) throw fail(); return { program, accounts, data: hex(data) };
  });
  if (count() !== 0 || offset !== bytes.length || instructions[0]!.program !== COMPUTE || instructions[0]!.accounts.length !== 0 ||
      instructions[0]!.data !== "02801a0600" || instructions[1]!.program !== COMPUTE || instructions[1]!.accounts.length !== 0 ||
      instructions[1]!.data !== "030000000000000000" || instructions[2]!.program !== plan.programId) throw fail();
  const actualAccounts = instructions[2]!.accounts; const actualData = instructions[2]!.data;
  const expectedAccounts = phase === "ASSIGN_APPROVER" ? [wallet, plan.instrumentAddress, plan.approvalPolicyAddress, SYSTEM] : phase === "APPROVE" ?
    [wallet, plan.instrumentAddress, plan.approvalPolicyAddress, plan.actionAddress, plan.reserveAddress, plan.vaultAddress, TOKEN] :
    [wallet, plan.instrumentAddress, ...(phase === "RESERVE" ? [plan.approvalPolicyAddress] : []), plan.actionAddress, plan.reserveAddress,
      plan.vaultAddress, plan.treasuryAddress, plan.settlementMint, TOKEN, ...(phase === "RESERVE" ? [SYSTEM] : [])];
  const expectedData = discriminators[phase] + (phase === "ASSIGN_APPROVER" ? hex(publicKeyBytes(plan.approver!)) + u64Hex(plan.networkReserveLamports) : plan.snapshotHash + u64Hex(plan.amountMinor));
  const writable = new Set(phase === "ASSIGN_APPROVER" ? [wallet, plan.approvalPolicyAddress] :
    phase === "APPROVE" ? [wallet, plan.actionAddress, plan.reserveAddress] : [wallet, plan.actionAddress, plan.reserveAddress, plan.vaultAddress, plan.treasuryAddress]);
  const expectedKeys = new Set([plan.programId, COMPUTE, ...expectedAccounts]);
  if (actualData !== expectedData || JSON.stringify(actualAccounts) !== JSON.stringify(expectedAccounts) || keys.length !== expectedKeys.size ||
      new Set(keys).size !== keys.length || keys.some((key, index) => !expectedKeys.has(key) || writable.has(key) !== (index === 0 || index < keys.length - bytes[68]!))) throw fail();
  return plan;
}
