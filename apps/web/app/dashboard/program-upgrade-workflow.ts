import { encodeBase58, isActionId, unsignedTransactionForSigner } from "./snapshot-workflow";

export type ProgramUpgradePlan = {
  operationId: string; maintenanceId: string; phase: "EXTEND" | "UPGRADE"; cluster: "localnet";
  programId: string; programData: string; bufferAddress: string; requiredSigner: string; networkGenesisHash: string;
  feePayer: string; spillAddress: string; candidateSha256: string; retainedSha256: string; candidateBytes: number;
  additionalBytes: number; currentProgramCapacity: number; extensionRentLamports: number; phaseFeeLamports: number;
  feeReserveLamports: number; serializedTransactionBase64: string; lastValidBlockHeight: number;
  deployedAtSlot: string;
  status: string; signature: string | null;
};
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
const RENT = "SysvarRent111111111111111111111111111111111";
const CLOCK = "SysvarC1ock11111111111111111111111111111111";

/** Decode the complete bounded v0 message. No lookup tables or extra instructions are accepted. */
function verifyUpgradeInstructions(plan: ProgramUpgradePlan) {
  const bytes = unsignedTransactionForSigner(plan.serializedTransactionBase64, plan.requiredSigner);
  let offset = 69;
  const read = () => { if (offset >= bytes.length) throw new Error("Incomplete upgrade wire"); return bytes[offset++]!; };
  const count = () => { const value = read(); if (value >= 128) throw new Error("Unsupported upgrade vector"); return value; };
  const keyCount = count(); const keys: string[] = [];
  for (let index = 0; index < keyCount; index++) {
    if (offset + 32 > bytes.length) throw new Error("Incomplete upgrade key");
    keys.push(encodeBase58(bytes.slice(offset, offset + 32))); offset += 32;
  }
  offset += 32; // Recent blockhash, already part of the exact message.
  if (bytes[67] !== 0 || count() !== 3) throw new Error("Unexpected upgrade signer or instructions");
  const instructions = Array.from({ length: 3 }, () => {
    const program = keys[read()]; const accounts = Array.from({ length: count() }, () => keys[read()]);
    const length = count(); const data = bytes.slice(offset, offset + length); offset += length;
    if (data.length !== length) throw new Error("Incomplete upgrade instruction");
    return { program, accounts, data: [...data].map(value => value.toString(16).padStart(2, "0")).join("") };
  });
  if (count() !== 0 || offset !== bytes.length || instructions[0]!.program !== COMPUTE || instructions[0]!.accounts.length !== 0 ||
      instructions[0]!.data !== "02801a0600" || instructions[1]!.program !== COMPUTE || instructions[1]!.accounts.length !== 0 ||
      instructions[1]!.data !== "030000000000000000") throw new Error("Unexpected upgrade compute budget or lookup tables");
  const expectedAccounts = plan.phase === "EXTEND" ? [plan.programData, plan.programId, SYSTEM, plan.requiredSigner] :
    [plan.programData, plan.programId, plan.bufferAddress, plan.requiredSigner, RENT, CLOCK, plan.requiredSigner];
  const expectedData = new Uint8Array(plan.phase === "EXTEND" ? 8 : 4); const view = new DataView(expectedData.buffer);
  view.setUint32(0, plan.phase === "EXTEND" ? 6 : 3, true);
  if (plan.phase === "EXTEND") view.setUint32(4, plan.additionalBytes, true);
  const expectedHex = [...expectedData].map(value => value.toString(16).padStart(2, "0")).join("");
  const actual = instructions[2]!;
  const writable = new Set(plan.phase === "EXTEND" ? [plan.programData, plan.programId, plan.requiredSigner] :
    [plan.programData, plan.programId, plan.bufferAddress, plan.requiredSigner]);
  const keySet = new Set([plan.requiredSigner, LOADER, COMPUTE, ...expectedAccounts]);
  if (actual.program !== LOADER || actual.data !== expectedHex || JSON.stringify(actual.accounts) !== JSON.stringify(expectedAccounts) ||
      keys.length !== keySet.size || keys.some(key => !keySet.has(key)) || new Set(keys).size !== keys.length ||
      keys.some((key, index) => writable.has(key) !== (index === 0 || index < keyCount - bytes[68]!))) {
    throw new Error("Upgrade instruction accounts, privileges or bytes differ from review");
  }
}
export function preparedProgramUpgrade(payload: Record<string, unknown>, report: Record<string, unknown>, walletAddress: string): ProgramUpgradePlan {
  const invalid = () => new Error("План обновления не совпадает с проверенной сетью, программой или инструкциями. Подпись остановлена.");
  if (payload["cluster"] !== "localnet" || !["EXTEND", "UPGRADE"].includes(String(payload["phase"])) ||
      typeof payload["operationId"] !== "string" || !isActionId(payload["operationId"]) ||
      typeof payload["maintenanceId"] !== "string" || !isActionId(payload["maintenanceId"]) ||
      payload["requiredSigner"] !== walletAddress || report["upgradeAuthority"] !== walletAddress ||
      payload["feePayer"] !== walletAddress || payload["spillAddress"] !== walletAddress ||
      payload["networkGenesisHash"] !== report["genesisHash"] || payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64") throw invalid();
  for (const field of ["programId", "programData", "candidateSha256", "retainedSha256", "candidateBytes"] as const) {
    if (payload[field] !== report[field]) throw invalid();
  }
  for (const field of ["programId", "programData", "bufferAddress", "networkGenesisHash"] as const) {
    if (typeof payload[field] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payload[field])) throw invalid();
  }
  if (new Set([payload["programId"], payload["programData"], payload["bufferAddress"], walletAddress]).size !== 4 ||
      report["bufferAddress"] && payload["bufferAddress"] !== report["bufferAddress"]) throw invalid();
  for (const field of ["candidateSha256", "retainedSha256"] as const) if (!/^[a-f0-9]{64}$/.test(String(payload[field]))) throw invalid();
  for (const field of ["additionalBytes", "currentProgramCapacity", "candidateBytes", "extensionRentLamports", "phaseFeeLamports", "feeReserveLamports", "lastValidBlockHeight"] as const) {
    if (!Number.isSafeInteger(payload[field]) || (payload[field] as number) < 0) throw invalid();
  }
  if (payload["phase"] === "EXTEND" && ((payload["additionalBytes"] as number) <= 0 || (payload["additionalBytes"] as number) > 10 * 1024 * 1024) ||
      payload["phase"] === "UPGRADE" && payload["additionalBytes"] !== 0 || typeof payload["serializedTransactionBase64"] !== "string" ||
      !["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED", "FAILED"].includes(String(payload["status"])) ||
      payload["signature"] !== null && (typeof payload["signature"] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(payload["signature"])) ||
      ["SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED"].includes(String(payload["status"])) && !payload["signature"]) throw invalid();
  if (typeof payload["deployedAtSlot"] !== "string" || !/^(0|[1-9][0-9]*)$/.test(payload["deployedAtSlot"])) throw invalid();
  if (payload["status"] === "PREPARED" && payload["signature"] === null) {
    for (const field of ["currentProgramCapacity", "additionalBytes", "deployedAtSlot", "extensionRentLamports"] as const) {
      if (payload[field] !== report[field]) throw invalid();
    }
  }
  const plan = payload as unknown as ProgramUpgradePlan;
  try { verifyUpgradeInstructions(plan); } catch { throw invalid(); }
  return plan;
}

/** A wallet signature saved before a failed HTTP request is still confirmation-only. */
export function recoverProgramUpgrade(payload: Record<string, unknown>, report: Record<string, unknown>, walletAddress: string,
  localSignature: string | null): ProgramUpgradePlan {
  if (localSignature && payload["signature"] && payload["signature"] !== localSignature) throw new Error("Сохранённые подписи различаются. Обновление остановлено.");
  const recovered = localSignature && payload["signature"] === null && payload["status"] === "PREPARED"
    ? { ...payload, signature: localSignature, status: "UNKNOWN_CONFIRMATION" } : payload;
  return preparedProgramUpgrade(recovered, report, walletAddress);
}
