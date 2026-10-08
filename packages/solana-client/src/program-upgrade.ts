import { address, getProgramDerivedAddress } from "@solana/kit";
import { decodePublicKey, encodePublicKey } from "./base58.js";
import { UPGRADEABLE_LOADER_PROGRAM_ID } from "./instrument-lifecycle.js";
import { SYSTEM_PROGRAM_ID } from "./instrument-mint-setup.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

const RENT_SYSVAR = "SysvarRent111111111111111111111111111111111";
const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111";
export const PROGRAM_DATA_METADATA_BYTES = 45;
export const BUFFER_METADATA_BYTES = 37;
const MAX_ACCOUNT_BYTES = 10 * 1024 * 1024;

function bytesWithState(data: Uint8Array, state: number, minimum: number): Buffer {
  const bytes = Buffer.from(data);
  if (bytes.length < minimum || bytes.readUInt32LE(0) !== state) throw new Error("Invalid upgradeable loader state");
  return bytes;
}

function optionalAuthority(bytes: Buffer, offset: number): string | null {
  const present = bytes[offset];
  if (present !== 0 && present !== 1) throw new Error("Invalid loader authority option");
  return present === 1 ? encodePublicKey(bytes.subarray(offset + 1, offset + 33)) : null;
}

/** Decodes loader-v3 metadata; the caller must independently check RPC account ownership. */
export function decodeUpgradeableProgram(data: Uint8Array): string {
  const bytes = bytesWithState(data, 2, 36);
  if (bytes.length !== 36) throw new Error("Invalid Program account length");
  return encodePublicKey(bytes.subarray(4));
}

export function decodeUpgradeableProgramData(data: Uint8Array) {
  const bytes = bytesWithState(data, 3, PROGRAM_DATA_METADATA_BYTES);
  if (bytes.length > MAX_ACCOUNT_BYTES) throw new Error("ProgramData exceeds loader size limit");
  return { deployedAtSlot: bytes.readBigUInt64LE(4), authority: optionalAuthority(bytes, 12),
    programBytes: bytes.subarray(PROGRAM_DATA_METADATA_BYTES) };
}

export function decodeUpgradeableBuffer(data: Uint8Array) {
  const bytes = bytesWithState(data, 1, BUFFER_METADATA_BYTES);
  if (bytes.length > MAX_ACCOUNT_BYTES) throw new Error("Buffer exceeds loader size limit");
  return { authority: optionalAuthority(bytes, 4), programBytes: bytes.subarray(BUFFER_METADATA_BYTES) };
}

export async function deriveUpgradeableProgramData(programId: string): Promise<string> {
  const [programData] = await getProgramDerivedAddress({ programAddress: address(UPGRADEABLE_LOADER_PROGRAM_ID),
    seeds: [decodePublicKey(programId)] });
  return programData;
}

export function programUpgradeCapacity(currentProgramCapacity: number, candidateBytes: number) {
  for (const size of [currentProgramCapacity, candidateBytes]) {
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ACCOUNT_BYTES - PROGRAM_DATA_METADATA_BYTES) {
      throw new Error("Program size is outside loader bounds");
    }
  }
  const requiredGrowth = Math.max(0, candidateBytes - currentProgramCapacity);
  // SIMD-0431 extension requires at least 10 KiB, except at the 10 MiB cap.
  const additionalBytes = requiredGrowth === 0 ? 0 : Math.min(
    Math.max(requiredGrowth, 10_240), MAX_ACCOUNT_BYTES - PROGRAM_DATA_METADATA_BYTES - currentProgramCapacity);
  return { additionalBytes, finalProgramCapacity: currentProgramCapacity + additionalBytes };
}

/** One externally signed phase, never a combined extension/upgrade transaction.
 * Extension advances ProgramData's slot; Upgrade must run after a later finalized slot.
 * The caller must verify current authority, ELF hashes, buffer and rent independently.
 */
export async function buildProgramUpgrade(input: {
  phase: "EXTEND" | "UPGRADE"; programId: string; bufferAddress: string; authority: string;
  currentProgramCapacity: number; candidateBytes: number;
}) {
  for (const value of [input.programId, input.bufferAddress, input.authority]) decodePublicKey(value);
  if (new Set([input.programId, input.bufferAddress, input.authority, SYSTEM_PROGRAM_ID,
    UPGRADEABLE_LOADER_PROGRAM_ID, RENT_SYSVAR, CLOCK_SYSVAR]).size !== 7) throw new Error("Upgrade addresses must be distinct");
  const capacity = programUpgradeCapacity(input.currentProgramCapacity, input.candidateBytes);
  const programData = await deriveUpgradeableProgramData(input.programId);
  if ([input.bufferAddress, input.authority].includes(programData)) throw new Error("Upgrade address aliases ProgramData");
  const { additionalBytes } = capacity;
  const meta = (address: string, isWritable = false, isSigner = false) => ({ address, isWritable, isSigner });
  const instructions: SolanaInstructionPlan[] = [];
  if (input.phase === "EXTEND") {
    if (additionalBytes === 0) throw new Error("ProgramData already has sufficient capacity");
    // This pinned validator supports ExtendProgram (6), not SDK-only checked opcode 9.
    // The payer is restricted to the reviewed authority by this plan; Upgrade itself
    // independently enforces the actual ProgramData and buffer upgrade authority.
    const data = Buffer.alloc(8); data.writeUInt32LE(6); data.writeUInt32LE(additionalBytes, 4);
    instructions.push({ programId: UPGRADEABLE_LOADER_PROGRAM_ID, data, accounts: [
      meta(programData, true), meta(input.programId, true), meta(SYSTEM_PROGRAM_ID), meta(input.authority, true, true)
    ] });
  } else if (input.phase === "UPGRADE") {
    if (additionalBytes > 0) throw new Error("Confirm extension in a separate transaction before Upgrade");
    const data = Buffer.alloc(4); data.writeUInt32LE(3);
    instructions.push({ programId: UPGRADEABLE_LOADER_PROGRAM_ID, data, accounts: [
      meta(programData, true), meta(input.programId, true), meta(input.bufferAddress, true),
      meta(input.authority, true), meta(RENT_SYSVAR), meta(CLOCK_SYSVAR), meta(input.authority, false, true)
    ] });
  } else throw new Error("Explicit EXTEND or UPGRADE phase required");
  return { phase: input.phase, programData, bufferAddress: input.bufferAddress, requiredSigner: input.authority,
    spillAddress: input.authority, ...capacity,
    instructions };
}
