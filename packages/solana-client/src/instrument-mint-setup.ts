import { createHash } from "node:crypto";

import { address, getProgramDerivedAddress } from "@solana/kit";

import { decodePublicKey, encodePublicKey } from "./base58.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const RENT_SYSVAR_ID = "SysvarRent111111111111111111111111111111111";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const BOND_MINT_SIZE = 202;
export const SETTLEMENT_MINT_SIZE = 82;

type Account = SolanaInstructionPlan["accounts"][number];

function account(address: string, isSigner = false, isWritable = false): Account {
  return { address, isSigner, isWritable };
}

function u64(value: bigint, name: string): Buffer {
  if (value < 0n || value > (1n << 64n) - 1n) throw new Error(`${name} must fit in u64`);
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes;
}

function createWithSeedAddress(base: string, seed: string, owner: string): string {
  if (Buffer.byteLength(seed) > 32) throw new Error("Mint seed must not exceed 32 bytes");
  return encodePublicKey(createHash("sha256").update(decodePublicKey(base)).update(seed).update(decodePublicKey(owner)).digest());
}

function createWithSeedInstruction(input: {
  payer: string; address: string; seed: string; lamports: bigint; space: bigint;
}): SolanaInstructionPlan {
  const seed = Buffer.from(input.seed);
  const data = Buffer.concat([
    Buffer.from([3, 0, 0, 0]), decodePublicKey(input.payer), u64(BigInt(seed.length), "Seed length"), seed,
    u64(input.lamports, "Rent"), u64(input.space, "Mint space"), decodePublicKey(TOKEN_2022_PROGRAM_ID)
  ]);
  return { programId: SYSTEM_PROGRAM_ID, accounts: [account(input.payer, true, true), account(input.address, false, true)], data };
}

function initializeMint(mint: string, decimals: number, authority: string): SolanaInstructionPlan {
  const data = Buffer.concat([Buffer.from([0, decimals]), decodePublicKey(authority), Buffer.alloc(4)]);
  return { programId: TOKEN_2022_PROGRAM_ID,
    accounts: [account(mint, false, true), account(RENT_SYSVAR_ID)], data };
}

function initializePermanentDelegate(mint: string, delegate: string): SolanaInstructionPlan {
  return { programId: TOKEN_2022_PROGRAM_ID, accounts: [account(mint, false, true)],
    data: Buffer.concat([Buffer.from([35]), decodePublicKey(delegate)]) };
}

function createAssociatedTokenAccount(payer: string, tokenAccount: string, mint: string): SolanaInstructionPlan {
  return { programId: ASSOCIATED_TOKEN_PROGRAM_ID, accounts: [
    account(payer, true, true), account(tokenAccount, false, true), account(payer), account(mint),
    account(SYSTEM_PROGRAM_ID), account(TOKEN_2022_PROGRAM_ID)
  ], data: Buffer.alloc(0) };
}

function mintTo(mint: string, destination: string, authority: string, amount: bigint): SolanaInstructionPlan {
  return { programId: TOKEN_2022_PROGRAM_ID, accounts: [
    account(mint, false, true), account(destination, false, true), account(authority, true)
  ], data: Buffer.concat([Buffer.from([7]), u64(amount, "Mint amount")]) };
}

function revokeMintAuthority(mint: string, authority: string): SolanaInstructionPlan {
  return { programId: TOKEN_2022_PROGRAM_ID,
    accounts: [account(mint, false, true), account(authority, true)],
    data: Buffer.from([6, 0, 0, 0, 0, 0]) };
}

export type InstrumentMintSetupPlan = {
  bondMint: string;
  settlementMint: string;
  treasuryTokenAccount: string;
  instrumentAddress: string;
  instrumentAuthority: string;
  instructions: readonly SolanaInstructionPlan[];
};

/** Builds deterministic mint setup instructions without reading or holding a private key. */
export async function buildInstrumentMintSetup(input: {
  programId: string;
  instrumentId: Uint8Array;
  administrator: string;
  bondRentLamports: bigint;
  settlementRentLamports: bigint;
  totalSupply: bigint;
}): Promise<InstrumentMintSetupPlan> {
  decodePublicKey(input.programId); decodePublicKey(input.administrator);
  if (input.instrumentId.length !== 16) throw new Error("Instrument ID must be 16 bytes");
  if (input.totalSupply < 1n) throw new Error("Total supply must be positive");
  const id = Buffer.from(input.instrumentId).toString("hex").slice(0, 24);
  const bondSeed = `lk-bond-${id}`;
  const settlementSeed = `lk-kzt-${id}`;
  const bondMint = createWithSeedAddress(input.administrator, bondSeed, TOKEN_2022_PROGRAM_ID);
  const settlementMint = createWithSeedAddress(input.administrator, settlementSeed, TOKEN_2022_PROGRAM_ID);
  const [instrumentAddress] = await getProgramDerivedAddress({
    programAddress: address(input.programId), seeds: ["instrument", input.instrumentId]
  });
  const [instrumentAuthority] = await getProgramDerivedAddress({
    programAddress: address(input.programId), seeds: ["instrument-authority", decodePublicKey(instrumentAddress)]
  });
  const [treasuryTokenAccount] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM_ID),
    seeds: [decodePublicKey(input.administrator), decodePublicKey(TOKEN_2022_PROGRAM_ID), decodePublicKey(bondMint)]
  });
  return {
    bondMint, settlementMint, treasuryTokenAccount, instrumentAddress, instrumentAuthority,
    instructions: [
      createWithSeedInstruction({ payer: input.administrator, address: bondMint, seed: bondSeed,
        lamports: input.bondRentLamports, space: BigInt(BOND_MINT_SIZE) }),
      initializePermanentDelegate(bondMint, instrumentAuthority),
      initializeMint(bondMint, 0, input.administrator),
      createWithSeedInstruction({ payer: input.administrator, address: settlementMint, seed: settlementSeed,
        lamports: input.settlementRentLamports, space: BigInt(SETTLEMENT_MINT_SIZE) }),
      initializeMint(settlementMint, 6, input.administrator),
      createAssociatedTokenAccount(input.administrator, treasuryTokenAccount, bondMint),
      mintTo(bondMint, treasuryTokenAccount, input.administrator, input.totalSupply),
      revokeMintAuthority(bondMint, input.administrator)
    ]
  };
}
