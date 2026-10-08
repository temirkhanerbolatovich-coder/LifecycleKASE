import { createHash } from "node:crypto";
import { address, getProgramDerivedAddress } from "@solana/kit";
import { decodePublicKey, encodePublicKey } from "./base58.js";
import { deriveCorporateActionAddresses } from "./corporate-action.js";
import { SYSTEM_PROGRAM_ID } from "./instrument-mint-setup.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

export const MAX_CALCULATION_INVESTORS = 64;
export const ENTITLEMENT_STATUSES = ["READY", "NOT_ELIGIBLE", "NOT_ELIGIBLE_ZERO_ROUNDING", "PAID", "REDEEMED"] as const;
type CalculationIdentity = {
  programId: string; instrumentId: Uint8Array; actionId: Uint8Array; corporateActionAuthority: string;
};
export type EntitlementRegistration = {
  investorId: Uint8Array; snapshotHash: string; settlementWallet: string;
  balanceAtSnapshot: bigint; eligible: boolean; paymentAmountMinor: bigint; tokensToRedeem: bigint;
};
export type ConfirmedEntitlement = {
  version: number; actionAddress: string; investorId: Uint8Array; snapshotHash: string;
  settlementWallet: string; balanceAtSnapshot: bigint; paymentAmountMinor: bigint;
  tokensToRedeem: bigint; status: typeof ENTITLEMENT_STATUSES[number]; executedAt: bigint | null; bump: number;
};

function discriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}
function u64(value: bigint): Buffer {
  if (typeof value !== "bigint" || value < 0n || value > (1n << 64n) - 1n) throw new Error("Entitlement integer exceeds u64");
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes;
}

export async function deriveEntitlementAddress(programId: string, actionAddress: string, investorId: Uint8Array) {
  if (investorId.length !== 16 || investorId.every(byte => byte === 0)) throw new Error("Investor UUID must be nonzero");
  const [entitlementAddress] = await getProgramDerivedAddress({ programAddress: address(programId),
    seeds: ["entitlement", decodePublicKey(actionAddress), investorId] });
  return entitlementAddress;
}

/** Encodes immutable integer calculations; no signing, submission or approval. */
export async function buildEntitlementRegistration(input: CalculationIdentity & EntitlementRegistration) {
  decodePublicKey(input.corporateActionAuthority);
  const settlementWallet = decodePublicKey(input.settlementWallet);
  if (!/^[0-9a-f]{64}$/i.test(input.snapshotHash) || /^0{64}$/.test(input.snapshotHash) ||
      input.balanceAtSnapshot <= 0n || typeof input.eligible !== "boolean" ||
      (!input.eligible && (input.paymentAmountMinor !== 0n || input.tokensToRedeem !== 0n)) ||
      (input.eligible && settlementWallet.every(byte => byte === 0))) {
    throw new Error("Entitlement snapshot, balance or eligibility is invalid");
  }
  const addresses = await deriveCorporateActionAddresses(input.programId, input.instrumentId, input.actionId);
  const entitlementAddress = await deriveEntitlementAddress(input.programId, addresses.actionAddress, input.investorId);
  const instruction: SolanaInstructionPlan = { programId: input.programId, accounts: [
    { address: input.corporateActionAuthority, isSigner: true, isWritable: true },
    { address: addresses.instrumentAddress, isSigner: false, isWritable: false },
    { address: addresses.actionAddress, isSigner: false, isWritable: true },
    { address: entitlementAddress, isSigner: false, isWritable: true },
    { address: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }
  ], data: Buffer.concat([discriminator("register_entitlement"), Buffer.from(input.investorId),
    Buffer.from(input.snapshotHash, "hex"), Buffer.from(settlementWallet),
    u64(input.balanceAtSnapshot), Buffer.from([input.eligible ? 1 : 0]),
    u64(input.paymentAmountMinor), u64(input.tokensToRedeem)]) };
  return { ...addresses, entitlementAddress, instruction };
}

/** Finalization supplies the complete unique set; account/transaction limits still apply to its wire. */
export async function buildCalculationFinalization(input: CalculationIdentity & { investorIds: Uint8Array[] }) {
  decodePublicKey(input.corporateActionAuthority);
  if (input.investorIds.length === 0 || input.investorIds.length > MAX_CALCULATION_INVESTORS) {
    throw new Error("Calculation requires 1 to 64 investors");
  }
  const addresses = await deriveCorporateActionAddresses(input.programId, input.instrumentId, input.actionId);
  const entitlementAddresses = await Promise.all(input.investorIds.map(id => deriveEntitlementAddress(input.programId, addresses.actionAddress, id)));
  if (new Set(entitlementAddresses).size !== entitlementAddresses.length) throw new Error("Calculation contains duplicate investors");
  const instruction: SolanaInstructionPlan = { programId: input.programId, accounts: [
    { address: input.corporateActionAuthority, isSigner: true, isWritable: false },
    { address: addresses.instrumentAddress, isSigner: false, isWritable: false },
    { address: addresses.actionAddress, isSigner: false, isWritable: true },
    ...entitlementAddresses.map(entitlementAddress => ({ address: entitlementAddress, isSigner: false, isWritable: false }))
  ], data: discriminator("finalize_calculation") };
  return { ...addresses, entitlementAddresses, instruction };
}

/** Resets only a complete supplied partial set and returns its account rent to the CA authority. */
export async function buildCalculationReset(input: CalculationIdentity & { investorIds: Uint8Array[] }) {
  decodePublicKey(input.corporateActionAuthority);
  if (input.investorIds.length === 0 || input.investorIds.length > MAX_CALCULATION_INVESTORS) {
    throw new Error("Calculation reset requires 1 to 64 registered investors");
  }
  const addresses = await deriveCorporateActionAddresses(input.programId, input.instrumentId, input.actionId);
  const entitlementAddresses = await Promise.all(input.investorIds.map(id => deriveEntitlementAddress(input.programId, addresses.actionAddress, id)));
  if (new Set(entitlementAddresses).size !== entitlementAddresses.length) throw new Error("Calculation reset contains duplicate investors");
  const instruction: SolanaInstructionPlan = { programId: input.programId, accounts: [
    { address: input.corporateActionAuthority, isSigner: true, isWritable: true },
    { address: addresses.instrumentAddress, isSigner: false, isWritable: false },
    { address: addresses.actionAddress, isSigner: false, isWritable: true },
    ...entitlementAddresses.map(entitlementAddress => ({ address: entitlementAddress, isSigner: false, isWritable: true }))
  ], data: discriminator("reset_calculation") };
  return { ...addresses, entitlementAddresses, instruction };
}

/** Decodes the complete immutable calculation account for finalized read-back. */
export function decodeConfirmedEntitlement(base64: string): ConfirmedEntitlement {
  const data = Buffer.from(base64, "base64");
  const accountDiscriminator = createHash("sha256").update("account:Entitlement").digest().subarray(0, 8);
  if (data.toString("base64") !== base64 || !data.subarray(0, 8).equals(accountDiscriminator)) {
    throw new Error("Entitlement account data is invalid");
  }
  let offset = 8;
  function read(length: number): Buffer {
    if (offset + length > data.length) throw new Error("Entitlement account is truncated");
    const result = data.subarray(offset, offset + length); offset += length; return result;
  }
  const version = read(1)[0]!;
  if (version !== 1) throw new Error("Entitlement version is unsupported");
  const actionAddress = encodePublicKey(read(32)); const investorId = Uint8Array.from(read(16));
  const snapshotHash = read(32).toString("hex"); const settlementWallet = encodePublicKey(read(32));
  const balanceAtSnapshot = read(8).readBigUInt64LE(); const paymentAmountMinor = read(8).readBigUInt64LE();
  const tokensToRedeem = read(8).readBigUInt64LE(); const status = ENTITLEMENT_STATUSES[read(1)[0]!];
  if (!status) throw new Error("Entitlement status is invalid");
  const executedTag = read(1)[0];
  const executedAt = executedTag === 0 ? null : executedTag === 1 ? read(8).readBigInt64LE() : undefined;
  if (executedAt === undefined) throw new Error("Entitlement execution tag is invalid");
  const bump = read(1)[0]!;
  return { version, actionAddress, investorId, snapshotHash, settlementWallet, balanceAtSnapshot,
    paymentAmountMinor, tokensToRedeem, status, executedAt, bump };
}
