import { address, getProgramDerivedAddress } from "@solana/kit";

import { decodePublicKey } from "./base58.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "./instrument-mint-setup.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

type Account = SolanaInstructionPlan["accounts"][number];

function account(address: string, isSigner = false, isWritable = false): Account {
  return { address, isSigner, isWritable };
}

function u64(value: bigint): Buffer {
  if (value < 1n || value > (1n << 64n) - 1n) throw new Error("Distribution amount must fit in positive u64");
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

export async function associatedTokenAccount(owner: string, mint: string): Promise<string> {
  const [tokenAccount] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM_ID),
    seeds: [decodePublicKey(owner), decodePublicKey(TOKEN_2022_PROGRAM_ID), decodePublicKey(mint)]
  });
  return tokenAccount;
}

export function createAssociatedTokenAccountIdempotent(
  payer: string,
  tokenAccount: string,
  owner: string,
  mint: string
): SolanaInstructionPlan {
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      account(payer, true, true),
      account(tokenAccount, false, true),
      account(owner),
      account(mint),
      account(SYSTEM_PROGRAM_ID),
      account(TOKEN_2022_PROGRAM_ID)
    ],
    data: Buffer.from([1])
  };
}

function transferChecked(
  source: string,
  mint: string,
  destination: string,
  authority: string,
  amount: bigint
): SolanaInstructionPlan {
  return {
    programId: TOKEN_2022_PROGRAM_ID,
    accounts: [
      account(source, false, true),
      account(mint),
      account(destination, false, true),
      account(authority, true)
    ],
    data: Buffer.concat([Buffer.from([12]), u64(amount), Buffer.from([0])])
  };
}

export type InstrumentDistributionAllocation = {
  walletAddress: string;
  amount: bigint;
};

export type InstrumentDistributionPlan = {
  treasuryTokenAccount: string;
  allocations: readonly (InstrumentDistributionAllocation & { tokenAccount: string })[];
  instructions: readonly SolanaInstructionPlan[];
};

/** Builds the canonical 10/20/5 Token-2022 distribution without holding the issuer private key. */
export async function buildInstrumentDistribution(input: {
  administrator: string;
  bondMint: string;
  allocations: readonly InstrumentDistributionAllocation[];
}): Promise<InstrumentDistributionPlan> {
  decodePublicKey(input.administrator);
  decodePublicKey(input.bondMint);
  if (input.allocations.length !== 3) throw new Error("Distribution requires exactly three wallets");
  const walletAddresses = new Set(input.allocations.map(allocation => allocation.walletAddress));
  if (walletAddresses.size !== 3) throw new Error("Distribution wallets must be unique");
  for (const allocation of input.allocations) decodePublicKey(allocation.walletAddress);
  const canonicalAmounts = input.allocations.map(allocation => allocation.amount).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (canonicalAmounts[0] !== 5n || canonicalAmounts[1] !== 10n || canonicalAmounts[2] !== 20n) {
    throw new Error("Distribution amounts must be exactly 10, 20, and 5");
  }
  const treasuryTokenAccount = await associatedTokenAccount(input.administrator, input.bondMint);
  const allocations = await Promise.all(input.allocations.map(async allocation => ({
    ...allocation,
    tokenAccount: await associatedTokenAccount(allocation.walletAddress, input.bondMint)
  })));
  return {
    treasuryTokenAccount,
    allocations,
    instructions: allocations.flatMap(allocation => [
      createAssociatedTokenAccountIdempotent(
        input.administrator,
        allocation.tokenAccount,
        allocation.walletAddress,
        input.bondMint
      ),
      transferChecked(
        treasuryTokenAccount,
        input.bondMint,
        allocation.tokenAccount,
        input.administrator,
        allocation.amount
      )
    ])
  };
}
