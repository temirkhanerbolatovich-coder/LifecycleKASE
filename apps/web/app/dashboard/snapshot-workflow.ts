const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function isActionId(value: string): boolean { return UUID.test(value); }

export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = "";
  while (value > 0n) {
    result = BASE58[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}

export function transactionSignature(bytes: Uint8Array): string {
  if (bytes.length !== 64 || bytes.every((byte) => byte === 0)) {
    throw new Error("Кошелёк не вернул корректную подпись транзакции.");
  }
  return encodeBase58(bytes);
}

export type SupportedSnapshotCluster = "localnet" | "devnet";

/** Restore a submitted deployment for confirmation without prompting another transaction signature. */
export function resumedDeploymentSignature(payload: Record<string, unknown>): string | null {
  if (payload["resumed"] !== true) return null;
  const signature = payload["signature"];
  if (payload["status"] === "PREPARED" && (signature === null || signature === undefined)) return null;
  if (!["SUBMITTED", "UNKNOWN_CONFIRMATION"].includes(String(payload["status"])) ||
      typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    throw new Error("Подписанная попытка не содержит корректной подписи; повторная отправка остановлена.");
  }
  return signature;
}

export function walletChainForCluster(cluster: SupportedSnapshotCluster): `solana:${SupportedSnapshotCluster}` {
  return `solana:${cluster}`;
}

export type PreparedSnapshot = {
  corporateActionId: string;
  operationId: string;
  snapshotId: string;
  cluster: SupportedSnapshotCluster;
  requiredSigner: string;
  snapshotHash: string;
  programId: string;
  actionAddress: string;
  networkGenesisHash: string;
  recordAt: string;
  effectiveBlockTime: string;
  effectiveSlot: string;
  lastValidBlockHeight: number;
  serializedTransactionBase64: string;
};

/** Validate the API boundary before asking a wallet to submit anything. */
export function preparedSnapshot(payload: Record<string, unknown>, actionId: string, walletAddress: string): PreparedSnapshot {
  const invalid = () => new Error("Некорректный план регистрации; подпись остановлена.");
  if (!isActionId(actionId) || payload.corporateActionId !== actionId ||
      typeof payload.operationId !== "string" || !UUID.test(payload.operationId) ||
      typeof payload.snapshotId !== "string" || !UUID.test(payload.snapshotId) ||
      (payload.cluster !== "localnet" && payload.cluster !== "devnet") || payload.requiredSigner !== walletAddress ||
      payload.transactionFormat !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" ||
      payload.recordPointMode !== "DEMO_CAPTURE_SLOT" ||
      typeof payload.snapshotHash !== "string" || !/^[0-9a-f]{64}$/i.test(payload.snapshotHash) ||
      !Number.isSafeInteger(payload.lastValidBlockHeight) || (payload.lastValidBlockHeight as number) < 0 ||
      typeof payload.effectiveSlot !== "string" || !/^[1-9][0-9]*$/.test(payload.effectiveSlot)) throw invalid();
  for (const field of ["programId", "actionAddress", "networkGenesisHash", "requiredSigner"] as const) {
    if (typeof payload[field] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payload[field])) throw invalid();
  }
  for (const field of ["recordAt", "effectiveBlockTime"] as const) {
    if (typeof payload[field] !== "string" || !Number.isFinite(Date.parse(payload[field]))) throw invalid();
  }
  if (typeof payload.serializedTransactionBase64 !== "string") throw invalid();
  const plan = payload as PreparedSnapshot;
  try { unsignedTransactionForSigner(plan.serializedTransactionBase64, walletAddress); }
  catch { throw invalid(); }
  return plan;
}

/** Validate the unsigned v0 wire transaction and its only required signer before opening a wallet prompt. */
export function unsignedTransactionForSigner(base64: string, walletAddress: string): Uint8Array {
  const bytes = unsignedTransactionBytes(base64);
  // The backend serializer uses one zeroed signature, a v0 message and a single fee-payer signer.
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress) || bytes[66] !== 1 ||
      encodeBase58(bytes.slice(70, 102)) !== walletAddress) {
    throw new Error("Fee payer транзакции не совпадает с выбранным кошельком.");
  }
  return bytes;
}

export function unsignedTransactionBytes(base64: string): Uint8Array {
  if (base64.length > 1644 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("Некорректные байты транзакции.");
  let binary: string;
  try { binary = atob(base64); } catch { throw new Error("Некорректные байты транзакции."); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (btoa(binary) !== base64 || bytes.length < 102 || bytes.length > 1232 || bytes[0] !== 1 ||
      bytes.slice(1, 65).some((byte) => byte !== 0) || bytes[65] !== 128 ||
      bytes[69] === undefined || bytes[69] < 1 || bytes[69] > 127) {
    throw new Error("Ожидалась неподписанная Solana v0 транзакция.");
  }
  return bytes;
}

/** Accept only a signature over the exact prepared wire transaction. */
export function signedPreparedTransaction(
  signedBytes: Uint8Array,
  unsignedBase64: string,
  walletAddress: string
): { signedTransactionBase64: string; signature: string } {
  const unsignedBytes = unsignedTransactionForSigner(unsignedBase64, walletAddress);
  if (signedBytes.length !== unsignedBytes.length) {
    throw new Error(`Phantom изменил длину подготовленной транзакции (${signedBytes.length} вместо ${unsignedBytes.length}); отправка остановлена.`);
  }
  const changedMessageOffset = signedBytes.slice(65).findIndex((byte, index) => byte !== unsignedBytes[index + 65]);
  if (signedBytes[0] !== 1 || changedMessageOffset !== -1) {
    const detail = changedMessageOffset === -1 ? "signature count" : `message byte ${changedMessageOffset}`;
    throw new Error(`Phantom изменил подготовленную транзакцию (${detail}); отправка остановлена.`);
  }
  const signature = transactionSignature(signedBytes.slice(1, 65));
  let binary = "";
  for (const byte of signedBytes) binary += String.fromCharCode(byte);
  return { signedTransactionBase64: btoa(binary), signature };
}

export function requireFinalizedResponse(payload: Record<string, unknown>, operationId: string, signature: string): void {
  if (payload.status !== "FINALIZED" || payload.operationId !== operationId || payload.signature !== signature) {
    throw new Error("API не подтвердил финализацию этой операции.");
  }
}
