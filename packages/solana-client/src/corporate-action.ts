import { createHash } from "node:crypto";
import { address, getProgramDerivedAddress } from "@solana/kit";
import { decodePublicKey, encodePublicKey } from "./base58.js";
import { deriveInstrumentLifecycleAddresses } from "./instrument-lifecycle.js";
import { SYSTEM_PROGRAM_ID } from "./instrument-mint-setup.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

export const ACTION_TYPES = ["COUPON_PAYMENT", "BOND_REDEMPTION", "EARLY_REDEMPTION"] as const;
export type ActionType = typeof ACTION_TYPES[number];
export const ACTION_STATUSES = ["SCHEDULED", "CANCELLED", "SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW", "APPROVED", "RESERVED", "PROCESSING", "SETTLED", "FINALIZED"] as const;
export type ActionTerms = {
  actionId: Uint8Array; type: ActionType; recordAt: bigint; executeAt: bigint;
  redemptionPercentageBps: number | null; redemptionPriceMinor: bigint | null;
};

function discriminator(namespace: string, name: string): Buffer {
  return createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
}
function i64(value: bigint): Buffer {
  if (value < 0n || value > (1n << 63n) - 1n) throw new Error("Action timestamp is invalid");
  const bytes = Buffer.alloc(8); bytes.writeBigInt64LE(value); return bytes;
}
function option(value: number | bigint | null, length: 2 | 8): Buffer {
  if (value === null) return Buffer.from([0]);
  const bytes = Buffer.alloc(length + 1); bytes[0] = 1;
  if (length === 2) bytes.writeUInt16LE(Number(value), 1); else bytes.writeBigUInt64LE(BigInt(value), 1);
  return bytes;
}

export async function deriveCorporateActionAddresses(programId: string, instrumentId: Uint8Array, actionId: Uint8Array) {
  if (actionId.length !== 16 || actionId.every(byte => byte === 0)) throw new Error("Action ID must be 16 nonzero bytes");
  const { instrumentAddress } = await deriveInstrumentLifecycleAddresses(programId, instrumentId);
  const [actionAddress] = await getProgramDerivedAddress({ programAddress: address(programId),
    seeds: ["action", decodePublicKey(instrumentAddress), actionId] });
  return { instrumentAddress, actionAddress };
}

/** Builds create_corporate_action for the external issuer; does not sign or submit. */
export async function buildCorporateActionSchedule(input: ActionTerms & {
  programId: string; instrumentId: Uint8Array; issuerAuthority: string;
}) {
  decodePublicKey(input.issuerAuthority);
  const type = ACTION_TYPES.indexOf(input.type);
  if (type < 0 || input.recordAt > input.executeAt) throw new Error("Action terms are invalid");
  if (input.type === "EARLY_REDEMPTION") {
    if (!Number.isSafeInteger(input.redemptionPercentageBps) || input.redemptionPercentageBps! < 1 ||
        input.redemptionPercentageBps! > 10_000 || input.redemptionPriceMinor === null ||
        input.redemptionPriceMinor < 1n || input.redemptionPriceMinor > (1n << 64n) - 1n) {
      throw new Error("Early redemption parameters are invalid");
    }
  } else if (input.redemptionPercentageBps !== null || input.redemptionPriceMinor !== null) {
    throw new Error("Redemption parameters are only allowed for early redemption");
  }
  const addresses = await deriveCorporateActionAddresses(input.programId, input.instrumentId, input.actionId);
  const instruction: SolanaInstructionPlan = { programId: input.programId, accounts: [
    { address: input.issuerAuthority, isSigner: true, isWritable: true },
    { address: addresses.instrumentAddress, isSigner: false, isWritable: false },
    { address: addresses.actionAddress, isSigner: false, isWritable: true },
    { address: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }
  ], data: Buffer.concat([discriminator("global", "create_corporate_action"), Buffer.from(input.actionId),
    Buffer.from([type]), i64(input.recordAt), i64(input.executeAt),
    option(input.redemptionPercentageBps, 2), option(input.redemptionPriceMinor, 8)]) };
  return { ...addresses, instruction };
}

/** Builds cancellation of a Scheduled action; the on-chain program rejects a snapshot-bearing action. */
export async function buildCorporateActionCancellation(input: {
  programId: string; instrumentId: Uint8Array; actionId: Uint8Array; issuerAuthority: string;
}) {
  decodePublicKey(input.issuerAuthority);
  const addresses = await deriveCorporateActionAddresses(input.programId, input.instrumentId, input.actionId);
  const instruction: SolanaInstructionPlan = { programId: input.programId, accounts: [
    { address: input.issuerAuthority, isSigner: true, isWritable: false },
    { address: addresses.instrumentAddress, isSigner: false, isWritable: false },
    { address: addresses.actionAddress, isSigner: false, isWritable: true }
  ], data: discriminator("global", "cancel_action") };
  return { ...addresses, instruction };
}

export type ConfirmedCorporateAction = ActionTerms & {
  version: number; instrumentAddress: string; snapshotHash: string; snapshotSlot: bigint;
  investorCount: number; walletCount: number; totalBalance: bigint; totalAmountMinor: bigint;
  registeredEntitlements: number; processedEntitlements: number;
  status: typeof ACTION_STATUSES[number]; createdAt: bigint; completedAt: bigint | null;
};

/** Decodes every immutable Action term and its lifecycle/commitment counters. */
export function decodeConfirmedCorporateAction(base64: string): ConfirmedCorporateAction {
  const data = Buffer.from(base64, "base64");
  if (data.toString("base64") !== base64 || !data.subarray(0, 8).equals(discriminator("account", "CorporateAction"))) {
    throw new Error("Corporate action account data is invalid");
  }
  let offset = 8;
  function read(length: number): Buffer {
    if (offset + length > data.length) throw new Error("Corporate action account is truncated");
    const result = data.subarray(offset, offset + length); offset += length; return result;
  }
  function readOption(length: 2 | 8): bigint | null {
    const tag = read(1)[0];
    if (tag === 0) return null;
    if (tag !== 1) throw new Error("Corporate action option tag is invalid");
    const bytes = read(length); return length === 2 ? BigInt(bytes.readUInt16LE()) : bytes.readBigUInt64LE();
  }
  const version = read(1)[0]!;
  if (version !== 1) throw new Error("Corporate action version is unsupported");
  const actionId = Uint8Array.from(read(16));
  const instrumentAddress = encodePublicKey(read(32));
  const type = ACTION_TYPES[read(1)[0]!];
  if (!type) throw new Error("Corporate action type is invalid");
  const recordAt = read(8).readBigInt64LE(); const executeAt = read(8).readBigInt64LE();
  const percentage = readOption(2); const redemptionPriceMinor = readOption(8);
  const snapshotHash = read(32).toString("hex"); const snapshotSlot = read(8).readBigUInt64LE();
  const investorCount = read(4).readUInt32LE(); const walletCount = read(4).readUInt32LE();
  const totalBalance = read(8).readBigUInt64LE(); const totalAmountMinor = read(8).readBigUInt64LE();
  const registeredEntitlements = read(4).readUInt32LE(); const processedEntitlements = read(4).readUInt32LE();
  const status = ACTION_STATUSES[read(1)[0]!];
  if (!status) throw new Error("Corporate action status is invalid");
  const createdAt = read(8).readBigInt64LE();
  const completedTag = read(1)[0];
  const completedAt = completedTag === 0 ? null : completedTag === 1 ? read(8).readBigInt64LE() : undefined;
  if (completedAt === undefined) throw new Error("Corporate action completion tag is invalid");
  read(1); // Anchor PDA bump
  return { version, actionId, instrumentAddress, type, recordAt, executeAt,
    redemptionPercentageBps: percentage === null ? null : Number(percentage), redemptionPriceMinor,
    snapshotHash, snapshotSlot, investorCount, walletCount, totalBalance, totalAmountMinor,
    registeredEntitlements, processedEntitlements, status, createdAt, completedAt };
}
