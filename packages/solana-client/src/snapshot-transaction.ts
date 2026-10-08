import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash
} from "@solana/kit";

import type { SnapshotRegistrationInstruction } from "./snapshot-registration.js";

export type SolanaInstructionPlan = {
  programId: string;
  accounts: readonly { address: string; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
};

export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
export const DEMO_COMPUTE_UNIT_LIMIT = 400_000;

function computeBudgetInstructions(limit: number, price: bigint): SolanaInstructionPlan[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_400_000 || price < 0n || price > (1n << 64n) - 1n) {
    throw new Error("Compute unit limit or price is invalid");
  }
  const limitData = Buffer.alloc(5); limitData[0] = 2; limitData.writeUInt32LE(limit, 1);
  const priceData = Buffer.alloc(9); priceData[0] = 3; priceData.writeBigUInt64LE(price, 1);
  return [limitData, priceData].map(data => ({ programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data }));
}

function accountRole(account: { isSigner: boolean; isWritable: boolean }): AccountRole {
  if (account.isSigner) {
    return account.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  }
  return account.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

/** Serializes a v0 Solana transaction with a zeroed signature slot for the external issuer wallet. */
export function serializeUnsignedSnapshotRegistrationTransaction(input: {
  instruction: SnapshotRegistrationInstruction;
  feePayer: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  computeUnitLimit?: number;
  computeUnitPriceMicroLamports?: bigint;
}): string {
  return serializeUnsignedInstructionsTransaction({ ...input, instructions: [input.instruction] });
}

/** Serializes v0 instructions that require only the external fee-payer signature. */
export function serializeUnsignedInstructionsTransaction(input: {
  instructions: readonly SolanaInstructionPlan[];
  feePayer: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  computeUnitLimit?: number;
  computeUnitPriceMicroLamports?: bigint;
}): string {
  if (input.instructions.length === 0) throw new Error("At least one instruction is required");
  if (input.instructions.some(instruction => instruction.programId === COMPUTE_BUDGET_PROGRAM_ID)) {
    throw new Error("Compute budget must be configured through the serializer options");
  }
  // Phantom adds priority instructions when they are absent, changing the persisted message.
  // Include both before signing so exact-message verification stays authoritative.
  const instructions = [...computeBudgetInstructions(input.computeUnitLimit ?? DEMO_COMPUTE_UNIT_LIMIT,
    input.computeUnitPriceMicroLamports ?? 0n), ...input.instructions];
  const signerAddresses = new Set(input.instructions.flatMap((instruction) =>
    instruction.accounts.filter((account) => account.isSigner).map((account) => account.address)));
  if (signerAddresses.size !== 1 || !signerAddresses.has(input.feePayer)) {
    throw new Error("Transaction must have exactly the external fee payer as signer");
  }
  if (!Number.isSafeInteger(input.lastValidBlockHeight) || input.lastValidBlockHeight < 0) {
    throw new Error("Last valid block height is invalid");
  }
  const feePayer = address(input.feePayer);
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(feePayer, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: blockhash(input.recentBlockhash),
      lastValidBlockHeight: BigInt(input.lastValidBlockHeight)
    }, message),
    (message) => appendTransactionMessageInstructions(instructions.map((instruction) => ({
      programAddress: address(instruction.programId),
      accounts: instruction.accounts.map((account) => ({ address: address(account.address), role: accountRole(account) })),
      data: instruction.data
    })), message)
  );
  return getBase64EncodedWireTransaction(compileTransaction(transactionMessage));
}
