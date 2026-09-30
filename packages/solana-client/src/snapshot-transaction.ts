import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash
} from "@solana/kit";

import type { SnapshotRegistrationInstruction } from "./snapshot-registration.js";

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
  const signerAccounts = input.instruction.accounts.filter((account) => account.isSigner);
  if (signerAccounts.length !== 1 || signerAccounts[0]?.address !== input.feePayer) {
    throw new Error("Snapshot registration must have exactly the issuer fee payer as signer");
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
    (message) => appendTransactionMessageInstruction({
      programAddress: address(input.instruction.programId),
      accounts: input.instruction.accounts.map((account) => ({
        address: address(account.address),
        role: accountRole(account)
      })),
      data: input.instruction.data
    }, message)
  );
  return getBase64EncodedWireTransaction(compileTransaction(transactionMessage));
}
