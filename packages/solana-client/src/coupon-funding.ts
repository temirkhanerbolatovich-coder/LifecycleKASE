import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { decodePublicKey, encodePublicKey } from "./base58.js";
import { associatedTokenAccount, createAssociatedTokenAccountIdempotent } from "./instrument-distribution.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";

/** Creates the issuer treasury if absent and mints only the requested simulated funding. */
export async function buildCouponFunding(input: { issuer: string; settlementMint: string; amountMinor: bigint }) {
  decodePublicKey(input.issuer); decodePublicKey(input.settlementMint);
  if (input.amountMinor < 1n || input.amountMinor > (1n << 63n) - 1n) throw new Error("Funding amount must fit in a positive database bigint");
  const treasury = await associatedTokenAccount(input.issuer, input.settlementMint);
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(input.amountMinor);
  return { treasury, instructions: [createAssociatedTokenAccountIdempotent(input.issuer, treasury, input.issuer, input.settlementMint), {
    programId: TOKEN_2022_PROGRAM_ID,
    accounts: [{ address: input.settlementMint, isSigner: false, isWritable: true },
      { address: treasury, isSigner: false, isWritable: true }, { address: input.issuer, isSigner: true, isWritable: false }],
    data: Buffer.concat([Buffer.from([14]), amount, Buffer.from([6])])
  }] };
}

/** The local demo mint has no extensions or freeze authority; unknown layouts are rejected. */
export function decodeFundingMint(data: Buffer, issuer: string): bigint {
  if (data.length !== 82 || data.readUInt32LE(0) !== 1 || encodePublicKey(data.subarray(4, 36)) !== issuer ||
      data[44] !== 6 || data[45] !== 1 || data.readUInt32LE(46) !== 0) throw new Error("Settlement mint authority, precision or layout differs from the local demo");
  return data.readBigUInt64LE(36);
}

export function decodeFundingTreasury(data: Buffer, mint: string, issuer: string): bigint {
  if (![165, 170].includes(data.length) || encodePublicKey(data.subarray(0, 32)) !== mint ||
      encodePublicKey(data.subarray(32, 64)) !== issuer || data[108] !== 1 || data.readUInt32LE(72) !== 0 ||
      data.readUInt32LE(109) !== 0 || data.readBigUInt64LE(121) !== 0n || data.readUInt32LE(129) !== 0 ||
      data.length === 170 && (data[165] !== 2 || data.readUInt16LE(166) !== 7 || data.readUInt16LE(168) !== 0)) {
    throw new Error("Treasury mint, owner, state, delegation or extensions differ from the local demo");
  }
  return data.readBigUInt64LE(64);
}

export function fundingMessageBase64(wire: string): string {
  return Buffer.from(getTransactionDecoder().decode(Buffer.from(wire, "base64")).messageBytes).toString("base64");
}

/** Locates the exact treasury in a fixed v0 message without address-table resolution. */
export function fundingTreasuryIndex(wire: string, treasury: string): number {
  const decoded = getTransactionDecoder().decode(Buffer.from(wire, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  if (message.version !== 0 || message.addressTableLookups?.length) throw new Error("Funding message must be v0 without address tables");
  const index = message.staticAccounts.findIndex(key => key === treasury);
  if (index < 0) throw new Error("Funding message does not contain its treasury");
  return index;
}
