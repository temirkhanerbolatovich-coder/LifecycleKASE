import { bytesHash, derivedAddress, keyHex, publicKeyBytes } from "./controlled-identity";
import { encodeBase58 } from "./snapshot-workflow";
import { transactionHex } from "./reviewed-transaction";

/** Verify the saved UTF-8 registry bytes and their raw Token-2022 positions without relying on JSONB key order. */
export async function requireControlledCaptureEvidence(value: unknown, identity: { programId: string; instrumentAddress: string; actionAddress: string; tokenMint?: string;
  sources?: readonly { address: string; walletAddress: string; balanceAtSnapshot: string }[] }): Promise<void> {
  const invalid = () => new Error("Сохранённые исходные данные держателей или их hash не совпадают.");
  const record = (item: unknown): Record<string, unknown> => { if (!item || typeof item !== "object" || Array.isArray(item)) throw invalid(); return item as Record<string, unknown>; };
  const evidence = record(value);
  const policy = await derivedAddress(identity.programId, ["controlled-policy", publicKeyBytes(identity.instrumentAddress)]);
  const capture = await derivedAddress(identity.programId, ["controlled-capture", publicKeyBytes(identity.actionAddress)]);
  if (evidence["schema"] !== "controlled-capture-v1" || evidence["controlledPolicyAddress"] !== policy || evidence["controlledCaptureAddress"] !== capture ||
      typeof evidence["registryCanonicalJson"] !== "string" || typeof evidence["registrySha256"] !== "string" ||
      transactionHex(await bytesHash(new TextEncoder().encode(evidence["registryCanonicalJson"]))) !== evidence["registrySha256"] ||
      typeof evidence["startedSlot"] !== "string" || !/^[1-9][0-9]*$/.test(evidence["startedSlot"]) ||
      !Number.isSafeInteger(evidence["readSlot"]) || BigInt(Number(evidence["readSlot"])) < BigInt(evidence["startedSlot"])) throw invalid();
  const registry = record(JSON.parse(evidence["registryCanonicalJson"]));
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === "object" ?
    Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, stable(value)])) : item;
  if (JSON.stringify(stable(registry)) !== JSON.stringify(stable(evidence["registry"])) || registry["slot"] !== evidence["readSlot"] ||
      !Array.isArray(registry["positivePositions"]) || registry["positivePositions"].length === 0 || registry["positivePositions"].length > 64 ||
      typeof registry["mintAddress"] !== "string" || identity.tokenMint !== undefined && registry["mintAddress"] !== identity.tokenMint ||
      typeof registry["supply"] !== "string" || registry["supply"] !== registry["totalBalance"]) throw invalid();
  const positions = registry["positivePositions"].map(record);
  if (new Set(positions.map(position => position["address"])).size !== positions.length) throw invalid();
  let total = 0n;
  for (const position of positions) {
    if (typeof position["dataBase64"] !== "string" || typeof position["address"] !== "string" || position["tokenProgramOwner"] !== "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" ||
        position["mintAddress"] !== registry["mintAddress"] || position["state"] !== "FROZEN" || position["delegate"] !== null || position["closeAuthority"] !== null || position["immutableOwner"] !== true ||
        typeof position["balance"] !== "string" || !/^[1-9][0-9]*$/.test(position["balance"])) throw invalid();
    const binary = atob(position["dataBase64"]); if (btoa(binary) !== position["dataBase64"]) throw invalid();
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0)); const data = new DataView(bytes.buffer);
    if (bytes.length < 170 || bytes[108] !== 2 || bytes[165] !== 2 || transactionHex(bytes.slice(0, 32)) !== keyHex(String(registry["mintAddress"])) ||
        encodeBase58(bytes.slice(32, 64)) !== position["walletAddress"] || data.getBigUint64(64, true).toString() !== position["balance"] ||
        data.getUint32(72, true) !== 0 || data.getUint32(129, true) !== 0) throw invalid();
    let offset = 166; const extensions = new Set<number>();
    while (offset < bytes.length && bytes.slice(offset).some(byte => byte !== 0)) {
      if (offset + 4 > bytes.length) throw invalid();
      const type = data.getUint16(offset, true), length = data.getUint16(offset + 2, true); offset += 4;
      if (![7, 8, 11].includes(type) || extensions.has(type) || offset + length > bytes.length || type === 7 && length !== 0 ||
          type !== 7 && (length !== 1 || bytes[offset] !== 0 && bytes[offset] !== 1)) throw invalid();
      extensions.add(type); offset += length;
    }
    if (!extensions.has(7)) throw invalid(); total += BigInt(position["balance"]);
  }
  if (total.toString() !== registry["supply"]) throw invalid();
  if (identity.sources) {
    const compare = (left: { address: string }, right: { address: string }) => left.address < right.address ? -1 : left.address > right.address ? 1 : 0;
    const actual = positions.map(position => ({ address: position["address"], walletAddress: position["walletAddress"], balanceAtSnapshot: position["balance"] }));
    if (JSON.stringify([...identity.sources].sort(compare)) !== JSON.stringify(actual.sort((a, b) => compare(a as { address: string }, b as { address: string })))) throw invalid();
  }
}
