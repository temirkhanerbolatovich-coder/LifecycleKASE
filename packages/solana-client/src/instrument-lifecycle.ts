import { createHash } from "node:crypto";

import { address, getProgramDerivedAddress } from "@solana/kit";

import { decodePublicKey, encodePublicKey } from "./base58.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";
import { SYSTEM_PROGRAM_ID } from "./instrument-mint-setup.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

export const UPGRADEABLE_LOADER_PROGRAM_ID = "BPFLoaderUpgradeab1e11111111111111111111111";

type Account = SolanaInstructionPlan["accounts"][number];

function account(address: string, isSigner = false, isWritable = false): Account {
  return { address, isSigner, isWritable };
}

function discriminator(namespace: "global" | "account", name: string): Buffer {
  return createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
}

function u64(value: bigint, name: string): Buffer {
  if (value < 0n || value > (1n << 64n) - 1n) throw new Error(`${name} must fit in u64`);
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes;
}

function i64(value: bigint, name: string): Buffer {
  if (value < -(1n << 63n) || value > (1n << 63n) - 1n) throw new Error(`${name} must fit in i64`);
  const bytes = Buffer.alloc(8); bytes.writeBigInt64LE(value); return bytes;
}

function u32(value: number, name: string): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`${name} must fit in u32`);
  const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes;
}

export type InstrumentLifecycleAddresses = {
  instrumentAddress: string;
  instrumentAuthority: string;
};

export async function deriveInstrumentLifecycleAddresses(
  programId: string,
  instrumentId: Uint8Array
): Promise<InstrumentLifecycleAddresses> {
  decodePublicKey(programId);
  if (instrumentId.length !== 16) throw new Error("Instrument ID must be 16 bytes");
  const [instrumentAddress] = await getProgramDerivedAddress({
    programAddress: address(programId), seeds: ["instrument", instrumentId]
  });
  const [instrumentAuthority] = await getProgramDerivedAddress({
    programAddress: address(programId), seeds: ["instrument-authority", decodePublicKey(instrumentAddress)]
  });
  return { instrumentAddress, instrumentAuthority };
}

export type InstrumentInitializationInput = {
  programId: string;
  instrumentId: Uint8Array;
  administrator: string;
  bondMint: string;
  settlementMint: string;
  complianceAuthority: string;
  corporateActionAuthority: string;
  faceValueMinor: bigint;
  couponRateBps: number;
  paymentsPerYear: number;
  issueAt: bigint;
  maturityAt: bigint;
  totalSupply: bigint;
};

/** Builds the Anchor initialize_instrument instruction without reading or holding a private key. */
export async function buildInstrumentInitialization(
  input: InstrumentInitializationInput
): Promise<InstrumentLifecycleAddresses & { programDataAddress: string; instruction: SolanaInstructionPlan }> {
  for (const key of [input.programId, input.administrator, input.bondMint, input.settlementMint,
    input.complianceAuthority, input.corporateActionAuthority]) decodePublicKey(key);
  if (input.instrumentId.length !== 16) throw new Error("Instrument ID must be 16 bytes");
  if (input.bondMint === input.settlementMint) throw new Error("Bond and settlement mint must differ");
  if (input.faceValueMinor < 1n || input.totalSupply < 1n || input.issueAt >= input.maturityAt) {
    throw new Error("Instrument terms are invalid");
  }
  if (!Number.isSafeInteger(input.couponRateBps) || input.couponRateBps < 0 || input.couponRateBps > 100_000 ||
      ![1, 2, 4].includes(input.paymentsPerYear)) throw new Error("Instrument coupon terms are invalid");
  const { instrumentAddress, instrumentAuthority } = await deriveInstrumentLifecycleAddresses(input.programId, input.instrumentId);
  const [programDataAddress] = await getProgramDerivedAddress({
    programAddress: address(UPGRADEABLE_LOADER_PROGRAM_ID), seeds: [decodePublicKey(input.programId)]
  });
  const data = Buffer.concat([
    discriminator("global", "initialize_instrument"), Buffer.from(input.instrumentId),
    decodePublicKey(input.complianceAuthority), decodePublicKey(input.corporateActionAuthority),
    u64(input.faceValueMinor, "Face value"), u32(input.couponRateBps, "Coupon rate"),
    Buffer.from([input.paymentsPerYear]), i64(input.issueAt, "Issue time"),
    i64(input.maturityAt, "Maturity time"), u64(input.totalSupply, "Total supply")
  ]);
  return {
    instrumentAddress, instrumentAuthority, programDataAddress,
    instruction: {
      programId: input.programId,
      accounts: [
        account(input.administrator, true, true), account(input.programId), account(programDataAddress),
        account(instrumentAddress, false, true), account(instrumentAuthority), account(input.bondMint),
        account(input.settlementMint), account(TOKEN_2022_PROGRAM_ID), account(SYSTEM_PROGRAM_ID)
      ],
      data
    }
  };
}

/** Builds the Anchor activate_instrument instruction for the complete positive holder set. */
export async function buildInstrumentActivation(input: {
  programId: string;
  instrumentId: Uint8Array;
  issuerAuthority: string;
  bondMint: string;
  holderTokenAccounts: readonly string[];
}): Promise<InstrumentLifecycleAddresses & { instruction: SolanaInstructionPlan }> {
  decodePublicKey(input.programId); decodePublicKey(input.issuerAuthority); decodePublicKey(input.bondMint);
  if (input.holderTokenAccounts.length < 1 || input.holderTokenAccounts.length > 64 ||
      new Set(input.holderTokenAccounts).size !== input.holderTokenAccounts.length) {
    throw new Error("Activation requires 1 to 64 unique holder token accounts");
  }
  for (const tokenAccount of input.holderTokenAccounts) decodePublicKey(tokenAccount);
  const addresses = await deriveInstrumentLifecycleAddresses(input.programId, input.instrumentId);
  return {
    ...addresses,
    instruction: {
      programId: input.programId,
      accounts: [
        account(input.issuerAuthority, true), account(addresses.instrumentAddress, false, true),
        account(addresses.instrumentAuthority), account(input.bondMint), account(TOKEN_2022_PROGRAM_ID),
        ...input.holderTokenAccounts.map(tokenAccount => account(tokenAccount))
      ],
      data: discriminator("global", "activate_instrument")
    }
  };
}

export type ConfirmedInstrumentAccount = {
  version: number;
  instrumentId: Uint8Array;
  issuerAuthority: string;
  complianceAuthority: string;
  corporateActionAuthority: string;
  bondMint: string;
  settlementMint: string;
  faceValueMinor: bigint;
  couponRateBps: number;
  paymentsPerYear: number;
  issueAt: bigint;
  maturityAt: bigint;
  totalSupply: bigint;
  status: "DEPLOYING" | "ACTIVE" | "PAUSED" | "REDEEMED";
};

/** Decodes the fixed Instrument fields written by the Anchor program. */
export function decodeConfirmedInstrumentAccount(dataBase64: string): ConfirmedInstrumentAccount {
  const data = Buffer.from(dataBase64, "base64");
  if (data.length < 225 || data.toString("base64") !== dataBase64 ||
      !data.subarray(0, 8).equals(discriminator("account", "Instrument"))) {
    throw new Error("Instrument account data is invalid");
  }
  let offset = 8;
  const version = data[offset++]!;
  const instrumentId = Uint8Array.from(data.subarray(offset, offset + 16)); offset += 16;
  const publicKey = () => { const result = encodePublicKey(data.subarray(offset, offset + 32)); offset += 32; return result; };
  const issuerAuthority = publicKey();
  const complianceAuthority = publicKey();
  const corporateActionAuthority = publicKey();
  const bondMint = publicKey();
  const settlementMint = publicKey();
  const faceValueMinor = data.readBigUInt64LE(offset); offset += 8;
  const couponRateBps = data.readUInt32LE(offset); offset += 4;
  const paymentsPerYear = data[offset++]!;
  const issueAt = data.readBigInt64LE(offset); offset += 8;
  const maturityAt = data.readBigInt64LE(offset); offset += 8;
  const totalSupply = data.readBigUInt64LE(offset); offset += 8;
  const statuses = ["DEPLOYING", "ACTIVE", "PAUSED", "REDEEMED"] as const;
  const status = statuses[data[offset]!];
  if (!status) throw new Error("Instrument account status is invalid");
  return { version, instrumentId, issuerAuthority, complianceAuthority, corporateActionAuthority,
    bondMint, settlementMint, faceValueMinor, couponRateBps, paymentsPerYear, issueAt, maturityAt,
    totalSupply, status };
}
