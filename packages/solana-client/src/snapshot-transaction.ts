import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
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
}): string {
  return serializeUnsignedInstructionsTransaction({ ...input, instructions: [input.instruction] });
}

/** Serializes v0 instructions that require only the external fee-payer signature. */
export function serializeUnsignedInstructionsTransaction(input: {
  instructions: readonly SolanaInstructionPlan[];
  feePayer: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}): string {
  if (input.instructions.length === 0) throw new Error("At least one instruction is required");
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
    (message) => appendTransactionMessageInstructions(input.instructions.map((instruction) => ({
      programAddress: address(instruction.programId),
      accounts: instruction.accounts.map((account) => ({ address: address(account.address), role: accountRole(account) })),
      data: instruction.data
    })), message)
  );
  return getBase64EncodedWireTransaction(compileTransaction(transactionMessage));
}
