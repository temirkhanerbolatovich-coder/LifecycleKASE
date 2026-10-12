import { createHash } from "node:crypto";
import { address, getProgramDerivedAddress } from "@solana/kit";
import { decodePublicKey, encodePublicKey } from "./base58.js";
import { deriveActionApprovalAddresses } from "./action-approval.js";
import { deriveEntitlementAddress } from "./entitlement-registration.js";
import { associatedTokenAccount, createAssociatedTokenAccountIdempotent } from "./instrument-distribution.js";
import { SYSTEM_PROGRAM_ID } from "./instrument-mint-setup.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

export const ENTITLEMENT_RECEIPT_BYTES = 218;
export const ACTION_RECEIPT_BYTES = 126;
type Identity = { programId: string; instrumentId: Uint8Array; actionId: Uint8Array; corporateActionAuthority: string };
const discriminator = (kind: string, name: string) => createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8);
const account = (value: string, writable = false, signer = false) => ({ address: value, isWritable: writable, isSigner: signer });
function hash(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value) || /^0{64}$/.test(value)) throw new Error("Receipt hash must be nonzero SHA-256");
  return Buffer.from(value, "hex");
}
async function receiptAddress(programId: string, seed: string, owner: string) {
  return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: [seed, decodePublicKey(owner)] }))[0];
}

/** One exact transaction creates the recipient ATA, transfers the coupon and records its immutable receipt. */
export async function buildCouponExecution(input: Identity & { investorId: Uint8Array; settlementMint: string; settlementWallet: string; idempotencyHash: string }) {
  decodePublicKey(input.corporateActionAuthority); decodePublicKey(input.settlementWallet); decodePublicKey(input.settlementMint);
  const derived = await deriveActionApprovalAddresses(input.programId, input.instrumentId, input.actionId);
  const entitlementAddress = await deriveEntitlementAddress(input.programId, derived.actionAddress, input.investorId);
  const entitlementReceiptAddress = await receiptAddress(input.programId, "entitlement-receipt", entitlementAddress);
  const recipientAddress = await associatedTokenAccount(input.settlementWallet, input.settlementMint);
  const instruction: SolanaInstructionPlan = { programId: input.programId,
    data: Buffer.concat([discriminator("global", "execute_coupon"), hash(input.idempotencyHash)]), accounts: [
      account(input.corporateActionAuthority, true, true), account(derived.instrumentAddress), account(derived.approvalPolicyAddress),
      account(derived.actionAddress, true), account(derived.reserveAddress), account(derived.vaultAddress, true), account(entitlementAddress, true),
      account(entitlementReceiptAddress, true), account(recipientAddress, true), account(input.settlementMint), account(TOKEN_2022_PROGRAM_ID), account(SYSTEM_PROGRAM_ID)
    ] };
  return { ...derived, entitlementAddress, entitlementReceiptAddress, recipientAddress, instruction,
    instructions: [createAssociatedTokenAccountIdempotent(input.corporateActionAuthority, recipientAddress, input.settlementWallet, input.settlementMint), instruction] };
}

export async function buildCouponFinalization(input: Identity & { investorIds: Uint8Array[]; receiptHash: string }) {
  decodePublicKey(input.corporateActionAuthority);
  if (!input.investorIds.length || input.investorIds.length > 64 || new Set(input.investorIds.map(value => Buffer.from(value).toString("hex"))).size !== input.investorIds.length) {
    throw new Error("Finalization requires unique snapshot investors within the transaction account limit");
  }
  const derived = await deriveActionApprovalAddresses(input.programId, input.instrumentId, input.actionId);
  const actionReceiptAddress = await receiptAddress(input.programId, "action-receipt", derived.actionAddress);
  const entitlements = await Promise.all(input.investorIds.map(id => deriveEntitlementAddress(input.programId, derived.actionAddress, id)));
  const instruction: SolanaInstructionPlan = { programId: input.programId,
    data: Buffer.concat([discriminator("global", "finalize_coupon"), hash(input.receiptHash)]), accounts: [
      account(input.corporateActionAuthority, true, true), account(derived.instrumentAddress), account(derived.actionAddress, true),
      account(actionReceiptAddress, true), account(SYSTEM_PROGRAM_ID), ...entitlements.map(value => account(value))
    ] };
  return { ...derived, actionReceiptAddress, instruction, instructions: [instruction] };
}

function bytes(value: string, name: string, size: number) {
  const data = Buffer.from(value, "base64");
  if (data.length !== size || data.toString("base64") !== value || data[8] !== 1 || !data.subarray(0, 8).equals(discriminator("account", name))) throw new Error("Invalid coupon receipt account");
  return data;
}
export function decodeEntitlementReceipt(value: string) {
  const data = bytes(value, "EntitlementReceipt", ENTITLEMENT_RECEIPT_BYTES);
  return { actionAddress: encodePublicKey(data.subarray(9, 41)), entitlementAddress: encodePublicKey(data.subarray(41, 73)),
    snapshotHash: data.subarray(73, 105).toString("hex"), settlementMint: encodePublicKey(data.subarray(105, 137)),
    settlementWallet: encodePublicKey(data.subarray(137, 169)), amountMinor: data.readBigUInt64LE(169),
    idempotencyHash: data.subarray(177, 209).toString("hex"), executedAt: data.readBigInt64LE(209), bump: data[217]! };
}
export function decodeActionReceipt(value: string) {
  const data = bytes(value, "ActionReceipt", ACTION_RECEIPT_BYTES);
  return { actionAddress: encodePublicKey(data.subarray(9, 41)), snapshotHash: data.subarray(41, 73).toString("hex"),
    receiptHash: data.subarray(73, 105).toString("hex"), amountMinor: data.readBigUInt64LE(105),
    processedEntitlements: data.readUInt32LE(113), finalizedAt: data.readBigInt64LE(117), bump: data[125]! };
}
