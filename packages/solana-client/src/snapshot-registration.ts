import { createHash } from "node:crypto";

import { address, getProgramDerivedAddress } from "@solana/kit";

import { decodePublicKey } from "./base58.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";

const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = 0xffff_ffff;

export type SnapshotRegistrationInput = {
  programId: string;
  instrumentId: Uint8Array;
  actionId: Uint8Array;
  issuerAuthority: string;
  bondMint: string;
  snapshotHash: string;
  snapshotSlot: bigint;
  investorCount: number;
  walletCount: number;
  totalBalance: bigint;
  mintSupply: bigint;
};

export type SnapshotRegistrationInstruction = {
  programId: string;
  accounts: readonly { address: string; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
  instrumentAddress: string;
  actionAddress: string;
};

function u64(value: bigint, name: string): void {
  if (value < 0n || value > U64_MAX) throw new Error(name + " must fit in u64");
}

/** Encodes the Anchor instruction and derives its account PDAs without a private key. */
export async function buildSnapshotRegistrationInstruction(
  input: SnapshotRegistrationInput
): Promise<SnapshotRegistrationInstruction> {
  decodePublicKey(input.programId);
  decodePublicKey(input.issuerAuthority);
  decodePublicKey(input.bondMint);
  if (input.instrumentId.length !== 16 || input.actionId.length !== 16) {
    throw new Error("Instrument and action IDs must be 16 bytes");
  }
  const hash = Buffer.from(input.snapshotHash, "hex");
  if (!/^[0-9a-f]{64}$/i.test(input.snapshotHash) || hash.equals(Buffer.alloc(32))) {
    throw new Error("Snapshot hash must be a nonzero 32-byte hex value");
  }
  u64(input.snapshotSlot, "Snapshot slot");
  u64(input.totalBalance, "Total balance");
  u64(input.mintSupply, "Mint supply");
  if (!Number.isSafeInteger(input.investorCount) || input.investorCount < 1 || input.investorCount > U32_MAX ||
      !Number.isSafeInteger(input.walletCount) || input.walletCount < input.investorCount || input.walletCount > U32_MAX) {
    throw new Error("Snapshot investor and wallet counts are invalid");
  }
  if (input.snapshotSlot === 0n || input.totalBalance === 0n || input.totalBalance !== input.mintSupply) {
    throw new Error("Snapshot slot, balance, or supply is invalid");
  }

  const [instrumentAddress] = await getProgramDerivedAddress({
    programAddress: address(input.programId), seeds: ["instrument", input.instrumentId]
  });
  const [actionAddress] = await getProgramDerivedAddress({
    programAddress: address(input.programId),
    seeds: ["action", decodePublicKey(instrumentAddress), input.actionId]
  });
  const [instrumentAuthority] = await getProgramDerivedAddress({
    programAddress: address(input.programId),
    seeds: ["instrument-authority", decodePublicKey(instrumentAddress)]
  });
  const data = Buffer.alloc(8 + 32 + 8 + 4 + 4 + 8 + 8);
  createHash("sha256").update("global:register_snapshot").digest().copy(data, 0, 0, 8);
  hash.copy(data, 8);
  data.writeBigUInt64LE(input.snapshotSlot, 40);
  data.writeUInt32LE(input.investorCount, 48);
  data.writeUInt32LE(input.walletCount, 52);
  data.writeBigUInt64LE(input.totalBalance, 56);
  data.writeBigUInt64LE(input.mintSupply, 64);
  return {
    programId: input.programId,
    instrumentAddress,
    actionAddress,
    accounts: [
      { address: input.issuerAuthority, isSigner: true, isWritable: false },
      { address: instrumentAddress, isSigner: false, isWritable: false },
      { address: actionAddress, isSigner: false, isWritable: true },
      { address: instrumentAuthority, isSigner: false, isWritable: false },
      { address: input.bondMint, isSigner: false, isWritable: false },
      { address: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data
  };
}
