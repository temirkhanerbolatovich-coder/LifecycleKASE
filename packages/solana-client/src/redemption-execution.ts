import { createHash } from "node:crypto";
import { address, getProgramDerivedAddress } from "@solana/kit";
import { decodePublicKey, encodePublicKey } from "./base58.js";
import { deriveActionApprovalAddresses } from "./action-approval.js";
import { deriveEntitlementAddress } from "./entitlement-registration.js";
import { associatedTokenAccount, createAssociatedTokenAccountIdempotent } from "./instrument-distribution.js";
import { SYSTEM_PROGRAM_ID } from "./instrument-mint-setup.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

export const MAX_REDEMPTION_SOURCES = 8;
export const REDEMPTION_SOURCES_BYTES = 718;
export const REDEMPTION_PROGRESS_BYTES = 94;
export const REDEMPTION_RECEIPT_BYTES = 306;
export type RedemptionTokenAccount = { address: string; wallet: string; balanceAtSnapshot: bigint };
type Identity = { programId: string; instrumentId: Uint8Array; actionId: Uint8Array; corporateActionAuthority: string };
const discriminator = (kind: string, name: string) => createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8);
const account = (value: string, writable = false, signer = false) => ({ address: value, isWritable: writable, isSigner: signer });
function nonzeroKey(value: string) {
  const bytes = decodePublicKey(value);
  if (bytes.every(byte => byte === 0)) throw new Error("Redemption public keys must be nonzero");
  return bytes;
}
function hash(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value) || /^0{64}$/.test(value)) throw new Error("Redemption hash must be nonzero SHA-256");
  return Buffer.from(value, "hex");
}
function u64(value: bigint) {
  if (typeof value !== "bigint" || value <= 0n || value > (1n << 64n) - 1n) throw new Error("Redemption source balance must be a positive u64");
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes;
}
function canonicalSources(values: RedemptionTokenAccount[]) {
  if (!values.length || values.length > MAX_REDEMPTION_SOURCES || new Set(values.map(value => value.address)).size !== values.length) {
    throw new Error("Redemption requires 1 to 8 unique snapshot token accounts");
  }
  const tokenAccounts = [...values].sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  const count = Buffer.alloc(4); count.writeUInt32LE(tokenAccounts.length);
  const encoded = Buffer.concat([count, ...tokenAccounts.map(value => Buffer.concat([
    Buffer.from(nonzeroKey(value.address)), Buffer.from(nonzeroKey(value.wallet)), u64(value.balanceAtSnapshot),
  ]))]);
  return { tokenAccounts, encoded };
}
export async function deriveRedemptionAddress(programId: string, seed: "redemption-sources" | "redemption-progress" | "redemption-receipt", owner: string) {
  return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: [seed, decodePublicKey(owner)] }))[0];
}
export function redemptionSourceHash(actionAddress: string, entitlementAddress: string, snapshotHash: string, tokenAccounts: RedemptionTokenAccount[]) {
  const { encoded } = canonicalSources(tokenAccounts);
  return createHash("sha256").update(Buffer.concat([Buffer.from("LifecycleKASE:RedemptionSources:v1"),
    Buffer.from(decodePublicKey(actionAddress)), Buffer.from(decodePublicKey(entitlementAddress)), hash(snapshotHash), encoded])).digest("hex");
}
async function derive(input: Identity & { investorId: Uint8Array }) {
  nonzeroKey(input.corporateActionAuthority);
  const derived = await deriveActionApprovalAddresses(input.programId, input.instrumentId, input.actionId);
  const entitlementAddress = await deriveEntitlementAddress(input.programId, derived.actionAddress, input.investorId);
  return { ...derived, entitlementAddress,
    sourceAddress: await deriveRedemptionAddress(input.programId, "redemption-sources", entitlementAddress),
    progressAddress: await deriveRedemptionAddress(input.programId, "redemption-progress", derived.actionAddress),
  };
}

/** Append to register_entitlement in the same transaction, before calculation finalization and approval. */
export async function buildRedemptionSourceRegistration(input: Identity & { investorId: Uint8Array; bondMint: string; tokenAccounts: RedemptionTokenAccount[]; snapshotHash: string }) {
  nonzeroKey(input.bondMint);
  const derived = await derive(input);
  const { tokenAccounts, encoded } = canonicalSources(input.tokenAccounts);
  const sourceHash = redemptionSourceHash(derived.actionAddress, derived.entitlementAddress, input.snapshotHash, tokenAccounts);
  const instruction: SolanaInstructionPlan = { programId: input.programId,
    data: Buffer.concat([discriminator("global", "register_redemption_sources"), encoded]), accounts: [
      account(input.corporateActionAuthority, true, true), account(derived.instrumentAddress), account(derived.actionAddress),
      account(derived.entitlementAddress), account(derived.sourceAddress, true), account(derived.progressAddress, true), account(input.bondMint),
      account(TOKEN_2022_PROGRAM_ID), account(SYSTEM_PROGRAM_ID), ...tokenAccounts.map(value => account(value.address)),
    ] };
  return { ...derived, sourceHash, tokenAccounts, instruction, instructions: [instruction] };
}

/** A single transaction pays the exact reserve amount and burns from immutable snapshot sources atomically. */
export async function buildRedemptionExecution(input: Identity & { investorId: Uint8Array; bondMint: string; settlementMint: string;
  settlementWallet: string; idempotencyHash: string; tokenAccounts: RedemptionTokenAccount[] }) {
  for (const key of [input.bondMint, input.settlementMint, input.settlementWallet]) nonzeroKey(key);
  if (input.bondMint === input.settlementMint) throw new Error("Bond and settlement mint must differ");
  const derived = await derive(input);
  const { tokenAccounts } = canonicalSources(input.tokenAccounts);
  const redemptionReceiptAddress = await deriveRedemptionAddress(input.programId, "redemption-receipt", derived.entitlementAddress);
  const instrumentAuthority = (await getProgramDerivedAddress({ programAddress: address(input.programId),
    seeds: ["instrument-authority", decodePublicKey(derived.instrumentAddress)] }))[0];
  const recipientAddress = await associatedTokenAccount(input.settlementWallet, input.settlementMint);
  const instruction: SolanaInstructionPlan = { programId: input.programId,
    data: Buffer.concat([discriminator("global", "execute_redemption"), hash(input.idempotencyHash)]), accounts: [
      account(input.corporateActionAuthority, true, true), account(derived.instrumentAddress), account(derived.approvalPolicyAddress),
      account(derived.actionAddress, true), account(derived.reserveAddress), account(derived.vaultAddress, true), account(derived.entitlementAddress, true),
      account(derived.sourceAddress), account(derived.progressAddress, true), account(redemptionReceiptAddress, true), account(recipientAddress, true),
      account(input.settlementMint), account(input.bondMint, true), account(instrumentAuthority), account(TOKEN_2022_PROGRAM_ID), account(SYSTEM_PROGRAM_ID),
      ...tokenAccounts.map(value => account(value.address, true)),
    ] };
  return { ...derived, redemptionReceiptAddress, instrumentAuthority, recipientAddress, tokenAccounts, instruction,
    instructions: [createAssociatedTokenAccountIdempotent(input.corporateActionAuthority, recipientAddress, input.settlementWallet, input.settlementMint), instruction] };
}

export async function buildRedemptionFinalization(input: Identity & { bondMint: string; investorIds: Uint8Array[]; receiptHash: string }) {
  nonzeroKey(input.corporateActionAuthority); nonzeroKey(input.bondMint);
  if (!input.investorIds.length || input.investorIds.length > 64 || new Set(input.investorIds.map(value => Buffer.from(value).toString("hex"))).size !== input.investorIds.length) {
    throw new Error("Redemption finalization requires unique snapshot investors");
  }
  const derived = await deriveActionApprovalAddresses(input.programId, input.instrumentId, input.actionId);
  const progressAddress = await deriveRedemptionAddress(input.programId, "redemption-progress", derived.actionAddress);
  const actionReceiptAddress = (await getProgramDerivedAddress({ programAddress: address(input.programId),
    seeds: ["action-receipt", decodePublicKey(derived.actionAddress)] }))[0];
  const entitlementAddresses = await Promise.all(input.investorIds.map(id => deriveEntitlementAddress(input.programId, derived.actionAddress, id)));
  const instrumentAuthority = (await getProgramDerivedAddress({ programAddress: address(input.programId),
    seeds: ["instrument-authority", decodePublicKey(derived.instrumentAddress)] }))[0];
  const instruction: SolanaInstructionPlan = { programId: input.programId,
    data: Buffer.concat([discriminator("global", "finalize_redemption"), hash(input.receiptHash)]), accounts: [
      account(input.corporateActionAuthority, true, true), account(derived.instrumentAddress, true), account(derived.actionAddress, true),
      account(progressAddress), account(input.bondMint), account(actionReceiptAddress, true), account(SYSTEM_PROGRAM_ID),
      ...entitlementAddresses.map(value => account(value)),
    ] };
  return { ...derived, progressAddress, actionReceiptAddress, instrumentAuthority, entitlementAddresses, instruction, instructions: [instruction] };
}

function bytes(value: string, name: string, size: number) {
  const data = Buffer.from(value, "base64");
  if (data.length !== size || data.toString("base64") !== value || data[8] !== 1 || !data.subarray(0, 8).equals(discriminator("account", name))) {
    throw new Error(`Invalid ${name} account`);
  }
  return data;
}
export function decodeRedemptionSources(value: string) {
  const data = bytes(value, "RedemptionSources", REDEMPTION_SOURCES_BYTES);
  const actionAddress = encodePublicKey(data.subarray(9, 41)); const entitlementAddress = encodePublicKey(data.subarray(41, 73));
  const snapshotHash = data.subarray(73, 105).toString("hex"); const sourceHash = data.subarray(105, 137).toString("hex");
  const count = data.readUInt32LE(137);
  if (!count || count > MAX_REDEMPTION_SOURCES) throw new Error("Invalid redemption source count");
  const tokenAccounts = Array.from({ length: count }, (_, index) => {
    const offset = 141 + index * 72;
    return { address: encodePublicKey(data.subarray(offset, offset + 32)), wallet: encodePublicKey(data.subarray(offset + 32, offset + 64)),
      balanceAtSnapshot: data.readBigUInt64LE(offset + 64) };
  });
  const canonical = canonicalSources(tokenAccounts).tokenAccounts;
  if (canonical.some((source, index) => source.address !== tokenAccounts[index]!.address) ||
      redemptionSourceHash(actionAddress, entitlementAddress, snapshotHash, tokenAccounts) !== sourceHash) throw new Error("Invalid redemption source commitment");
  return { actionAddress, entitlementAddress, snapshotHash, sourceHash, tokenAccounts, bump: data[141 + count * 72]! };
}
export function decodeRedemptionProgress(value: string) {
  const data = bytes(value, "RedemptionProgress", REDEMPTION_PROGRESS_BYTES);
  const snapshotSupply = data.readBigUInt64LE(73); const tokensRedeemed = data.readBigUInt64LE(81);
  if (!snapshotSupply || tokensRedeemed > snapshotSupply) throw new Error("Invalid redemption supply progress");
  return { actionAddress: encodePublicKey(data.subarray(9, 41)), snapshotHash: data.subarray(41, 73).toString("hex"),
    snapshotSupply, tokensRedeemed, processedEntitlements: data.readUInt32LE(89), bump: data[93]! };
}
export function decodeRedemptionReceipt(value: string) {
  const data = bytes(value, "RedemptionReceipt", REDEMPTION_RECEIPT_BYTES);
  const amountMinor = data.readBigUInt64LE(169); const tokensRedeemed = data.readBigUInt64LE(281);
  const mintSupplyBefore = data.readBigUInt64LE(289); const mintSupplyAfter = data.readBigUInt64LE(297);
  if (!amountMinor || !tokensRedeemed || mintSupplyBefore < tokensRedeemed || mintSupplyBefore - tokensRedeemed !== mintSupplyAfter) throw new Error("Invalid redemption receipt token deltas");
  return { actionAddress: encodePublicKey(data.subarray(9, 41)), entitlementAddress: encodePublicKey(data.subarray(41, 73)),
    snapshotHash: data.subarray(73, 105).toString("hex"), settlementMint: encodePublicKey(data.subarray(105, 137)),
    settlementWallet: encodePublicKey(data.subarray(137, 169)), amountMinor, idempotencyHash: data.subarray(177, 209).toString("hex"),
    executedAt: data.readBigInt64LE(209), bondMint: encodePublicKey(data.subarray(217, 249)), sourceHash: data.subarray(249, 281).toString("hex"),
    tokensRedeemed, mintSupplyBefore, mintSupplyAfter, bump: data[305]! };
}
