import { createHash } from "node:crypto";
import { address, getProgramDerivedAddress } from "@solana/kit";
import { decodePublicKey, encodePublicKey } from "./base58.js";
import { deriveCorporateActionAddresses } from "./corporate-action.js";
import { associatedTokenAccount } from "./instrument-distribution.js";
import { SYSTEM_PROGRAM_ID } from "./instrument-mint-setup.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

export const APPROVAL_POLICY_BYTES = 82;
export const ACTION_RESERVE_BYTES = 187;
export type ActionApprovalPhase = "ASSIGN_APPROVER" | "RESERVE" | "RELEASE" | "APPROVE";
export type ActionApprovalInput = { phase: ActionApprovalPhase; programId: string; instrumentId: Uint8Array;
  actionId: Uint8Array; issuer: string; approver: string; settlementMint: string;
  networkReserveLamports: bigint; snapshotHash: string; amountMinor: bigint };
const discriminator = (kind: string, name: string) => createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8);
function u64(value: bigint) {
  if (typeof value !== "bigint" || value < 0n || value > (1n << 64n) - 1n) throw new Error("Approval integer exceeds u64");
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes;
}
export async function deriveActionApprovalAddresses(programId: string, instrumentId: Uint8Array, actionId: Uint8Array) {
  const accounts = await deriveCorporateActionAddresses(programId, instrumentId, actionId);
  const pda = async (seed: string, key: string) => (await getProgramDerivedAddress({ programAddress: address(programId),
    seeds: [seed, decodePublicKey(key)] }))[0];
  return { ...accounts, approvalPolicyAddress: await pda("approval-policy", accounts.instrumentAddress),
    reserveAddress: await pda("action-reserve", accounts.actionAddress), vaultAddress: await pda("action-vault", accounts.actionAddress) };
}

/** Separate one-signer authority assignment, escrow funding, pre-approval refund and approval. */
export async function buildActionApproval(input: ActionApprovalInput) {
  if (!["ASSIGN_APPROVER", "RESERVE", "RELEASE", "APPROVE"].includes(input.phase)) throw new Error("Unsupported approval phase");
  for (const key of [input.issuer, input.approver, input.settlementMint]) {
    if (decodePublicKey(key).every(byte => byte === 0)) throw new Error("Approval keys must be nonzero");
  }
  if (input.approver === input.issuer || input.networkReserveLamports < 5_000_000n || input.amountMinor <= 0n ||
      !/^[0-9a-f]{64}$/i.test(input.snapshotHash) || /^0{64}$/.test(input.snapshotHash)) throw new Error("Invalid approval facts");
  const derived = await deriveActionApprovalAddresses(input.programId, input.instrumentId, input.actionId);
  const treasuryAddress = await associatedTokenAccount(input.issuer, input.settlementMint);
  const signer = input.phase === "APPROVE" ? input.approver : input.issuer;
  const account = (value: string, writable = false, isSigner = false) => ({ address: value, isSigner, isWritable: writable });
  let accounts; let data; let name;
  if (input.phase === "ASSIGN_APPROVER") {
    name = "assign_approver";
    accounts = [account(signer, true, true), account(derived.instrumentAddress), account(derived.approvalPolicyAddress, true), account(SYSTEM_PROGRAM_ID)];
    data = Buffer.concat([decodePublicKey(input.approver), u64(input.networkReserveLamports)]);
  } else {
    data = Buffer.concat([Buffer.from(input.snapshotHash, "hex"), u64(input.amountMinor)]);
    if (input.phase === "APPROVE") {
      name = "approve_action";
      accounts = [account(signer, false, true), account(derived.instrumentAddress), account(derived.approvalPolicyAddress),
        account(derived.actionAddress, true), account(derived.reserveAddress, true), account(derived.vaultAddress), account(TOKEN_2022_PROGRAM_ID)];
    } else {
      name = input.phase === "RESERVE" ? "fund_action_reserve" : "release_action_reserve";
      accounts = [account(signer, true, true), account(derived.instrumentAddress),
        ...(input.phase === "RESERVE" ? [account(derived.approvalPolicyAddress)] : []), account(derived.actionAddress, true),
        account(derived.reserveAddress, true), account(derived.vaultAddress, true), account(treasuryAddress, true),
        account(input.settlementMint), account(TOKEN_2022_PROGRAM_ID), ...(input.phase === "RESERVE" ? [account(SYSTEM_PROGRAM_ID)] : [])];
    }
  }
  const instruction: SolanaInstructionPlan = { programId: input.programId, accounts,
    data: Buffer.concat([discriminator("global", name), data]) };
  return { ...derived, treasuryAddress, requiredSigner: signer, instruction };
}
function accountBytes(value: string, name: string, size: number) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== size || bytes.toString("base64") !== value || bytes[8] !== 1 ||
      !bytes.subarray(0, 8).equals(discriminator("account", name))) throw new Error(`Invalid ${name} account`);
  return bytes;
}
export function decodeApprovalPolicy(value: string) {
  const data = accountBytes(value, "ApprovalPolicy", APPROVAL_POLICY_BYTES);
  const approver = encodePublicKey(data.subarray(41, 73));
  const networkReserveLamports = data.readBigUInt64LE(73);
  if (decodePublicKey(approver).every(byte => byte === 0) || networkReserveLamports < 5_000_000n) throw new Error("Invalid approval policy");
  return { instrumentAddress: encodePublicKey(data.subarray(9, 41)), approver, networkReserveLamports, bump: data[81]! };
}
export function decodeActionReserve(value: string) {
  const data = accountBytes(value, "ActionReserve", ACTION_RESERVE_BYTES);
  const flag = data[177];
  if (flag !== 0 && flag !== 1) throw new Error("Invalid approval timestamp option");
  const approvedBy = encodePublicKey(data.subarray(145, 177));
  const approvedAt = flag === 1 ? data.readBigInt64LE(178) : null;
  if ((approvedAt === null) !== decodePublicKey(approvedBy).every(byte => byte === 0)) throw new Error("Invalid approval identity");
  return { actionAddress: encodePublicKey(data.subarray(9, 41)), refundAuthority: encodePublicKey(data.subarray(41, 73)),
    settlementMint: encodePublicKey(data.subarray(73, 105)), snapshotHash: data.subarray(105, 137).toString("hex"),
    amountMinor: data.readBigUInt64LE(137), approvedBy, approvedAt, bump: data[flag === 1 ? 186 : 178]! };
}
/** Custody needs an initialized extension-free mint; mint authority may already be revoked. */
export function decodeReserveMint(value: string) {
  const data = Buffer.from(value, "base64");
  if (data.length !== 82 || data.toString("base64") !== value || ![0, 1].includes(data.readUInt32LE(0)) ||
      data[44] !== 6 || data[45] !== 1 || data.readUInt32LE(46) !== 0) throw new Error("Invalid reserve settlement mint");
  return { supplyMinor: data.readBigUInt64LE(36), mintAuthority: data.readUInt32LE(0) === 1 ? encodePublicKey(data.subarray(4, 36)) : null };
}
