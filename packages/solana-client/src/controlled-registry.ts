import { createHash } from "node:crypto";
import { address, getProgramDerivedAddress } from "@solana/kit";

import { decodePublicKey, encodePublicKey } from "./base58.js";
import { deriveCorporateActionAddresses } from "./corporate-action.js";
import { deriveEntitlementAddress } from "./entitlement-registration.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";
import { associatedTokenAccount, createAssociatedTokenAccountIdempotent } from "./instrument-distribution.js";
import { buildInstrumentInitialization, deriveInstrumentLifecycleAddresses, type InstrumentInitializationInput } from "./instrument-lifecycle.js";
import { RENT_SYSVAR_ID, SETTLEMENT_MINT_SIZE, SYSTEM_PROGRAM_ID } from "./instrument-mint-setup.js";
import { buildRedemptionExecution, buildRedemptionSourceRegistration, type RedemptionTokenAccount } from "./redemption-execution.js";
import { buildSnapshotRegistrationInstruction, type SnapshotRegistrationInput } from "./snapshot-registration.js";
import { SolanaRpcError, type SolanaRpc } from "./rpc.js";
import type { SolanaInstructionPlan } from "./snapshot-transaction.js";

export const CONTROLLED_BOND_MINT_SIZE = 207;
export const MAX_CONTROLLED_HOLDINGS = 64;
export const CONTROLLED_POLICY_BYTES = 138;
export const CONTROLLED_HOLDING_BYTES = 146;
export const CONTROLLED_CAPTURE_BYTES = 4816;
export const CONTROLLED_UNIT_RESERVATION_BYTES = 207;

type Account = SolanaInstructionPlan["accounts"][number];
type InstrumentIdentity = { programId: string; instrumentId: Uint8Array };
type ActionIdentity = InstrumentIdentity & { actionId: Uint8Array; corporateActionAuthority: string };
type InvestorIdentity = ActionIdentity & { investorId: Uint8Array };

const account = (value: string, writable = false, signer = false): Account => ({ address: value, isWritable: writable, isSigner: signer });
const discriminator = (namespace: "global" | "account", name: string) => createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);

function key(value: string): Uint8Array {
  const bytes = decodePublicKey(value);
  if (bytes.every(byte => byte === 0)) throw new Error("Controlled public key must be nonzero");
  return bytes;
}

function u64(value: bigint, name: string, positive = false): Buffer {
  if (typeof value !== "bigint" || value < (positive ? 1n : 0n) || value > (1n << 64n) - 1n) throw new Error(`${name} must fit in ${positive ? "positive " : ""}u64`);
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes;
}

async function pda(programId: string, seeds: readonly (string | Uint8Array)[]): Promise<string> {
  key(programId);
  return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: [...seeds] }))[0];
}

export async function deriveControlledPolicyAddress(programId: string, instrumentAddress: string): Promise<string> {
  return pda(programId, ["controlled-policy", key(instrumentAddress)]);
}

export async function deriveControlledHoldingAddress(programId: string, instrumentAddress: string, tokenAccount: string): Promise<string> {
  return pda(programId, ["controlled-holding", key(instrumentAddress), key(tokenAccount)]);
}

export async function deriveControlledCaptureAddress(programId: string, actionAddress: string): Promise<string> {
  return pda(programId, ["controlled-capture", key(actionAddress)]);
}

export async function deriveControlledUnitReservationAddress(programId: string, entitlementAddress: string): Promise<string> {
  return pda(programId, ["unit-reservation", key(entitlementAddress)]);
}

async function instrumentAddresses(input: InstrumentIdentity) {
  const derived = await deriveInstrumentLifecycleAddresses(input.programId, input.instrumentId);
  return { ...derived, controlledPolicyAddress: await deriveControlledPolicyAddress(input.programId, derived.instrumentAddress) };
}

async function actionAddresses(input: ActionIdentity) {
  key(input.corporateActionAuthority);
  const derived = await deriveCorporateActionAddresses(input.programId, input.instrumentId, input.actionId);
  return { ...derived, controlledPolicyAddress: await deriveControlledPolicyAddress(input.programId, derived.instrumentAddress),
    controlledCaptureAddress: await deriveControlledCaptureAddress(input.programId, derived.actionAddress) };
}

function uniqueAccounts(values: readonly string[], name: string, maximum = MAX_CONTROLLED_HOLDINGS): void {
  if (!values.length || values.length > maximum || new Set(values).size !== values.length) throw new Error(`${name} requires 1 to ${maximum} unique accounts`);
  values.forEach(key);
}

function plan(programId: string, name: string, accounts: readonly Account[], extra: Uint8Array = Buffer.alloc(0)): SolanaInstructionPlan {
  return { programId, accounts, data: Buffer.concat([discriminator("global", name), extra]) };
}

function createSeededMint(payer: string, seed: string, mint: string, lamports: bigint, size: number): SolanaInstructionPlan {
  const encodedSeed = Buffer.from(seed);
  return { programId: SYSTEM_PROGRAM_ID, accounts: [account(payer, true, true), account(mint, true)],
    data: Buffer.concat([Buffer.from([3, 0, 0, 0]), key(payer), u64(BigInt(encodedSeed.length), "Seed length"), encodedSeed,
      u64(lamports, "Mint rent", true), u64(BigInt(size), "Mint size"), decodePublicKey(TOKEN_2022_PROGRAM_ID)]) };
}

function seededMintAddress(payer: string, seed: string): string {
  return encodePublicKey(createHash("sha256").update(key(payer)).update(seed).update(decodePublicKey(TOKEN_2022_PROGRAM_ID)).digest());
}

function initializeMint(mint: string, decimals: number, authority: string, freezeAuthority?: string): SolanaInstructionPlan {
  // Token instruction COption is a one-byte tag; account-state COption uses four bytes.
  return { programId: TOKEN_2022_PROGRAM_ID, accounts: [account(mint, true), account(RENT_SYSVAR_ID)],
    data: Buffer.concat([Buffer.from([0, decimals]), key(authority), Buffer.from([freezeAuthority ? 1 : 0]), ...(freezeAuthority ? [key(freezeAuthority)] : [])]) };
}

/** Creates a supply-zero mint. The program initializer mints once, freezes treasury and revokes mint authority atomically. */
export async function buildControlledMintSetup(input: InstrumentIdentity & {
  administrator: string; bondRentLamports: bigint; settlementRentLamports: bigint; totalSupply: bigint;
}) {
  key(input.administrator); u64(input.totalSupply, "Total supply", true);
  const derived = await instrumentAddresses(input);
  // Retain all UUID bytes in the seeds, while keeping each seed under the System Program's 32-byte limit.
  const encodedId = Buffer.from(input.instrumentId).toString("base64url");
  const bondSeed = `lk-v2b-${encodedId}`; const settlementSeed = `lk-v2s-${encodedId}`;
  const bondMint = seededMintAddress(input.administrator, bondSeed);
  const settlementMint = seededMintAddress(input.administrator, settlementSeed);
  const treasuryTokenAccount = await associatedTokenAccount(input.administrator, bondMint);
  const instructions: SolanaInstructionPlan[] = [
    createSeededMint(input.administrator, bondSeed, bondMint, input.bondRentLamports, CONTROLLED_BOND_MINT_SIZE),
    { programId: TOKEN_2022_PROGRAM_ID, accounts: [account(bondMint, true)], data: Buffer.concat([Buffer.from([35]), key(derived.instrumentAuthority)]) },
    { programId: TOKEN_2022_PROGRAM_ID, accounts: [account(bondMint, true)], data: Buffer.from([28, 0, 2]) },
    initializeMint(bondMint, 0, input.administrator, derived.instrumentAuthority),
    createSeededMint(input.administrator, settlementSeed, settlementMint, input.settlementRentLamports, SETTLEMENT_MINT_SIZE),
    initializeMint(settlementMint, 6, input.administrator),
    createAssociatedTokenAccountIdempotent(input.administrator, treasuryTokenAccount, input.administrator, bondMint),
  ];
  return { ...derived, bondMint, settlementMint, treasuryTokenAccount, bondSeed, settlementSeed, instructions };
}

export async function buildControlledInstrumentInitialization(input: InstrumentInitializationInput & { treasuryTokenAccount?: string }) {
  const legacy = await buildInstrumentInitialization(input);
  const controlledPolicyAddress = await deriveControlledPolicyAddress(input.programId, legacy.instrumentAddress);
  const treasuryTokenAccount = input.treasuryTokenAccount ?? await associatedTokenAccount(input.administrator, input.bondMint);
  key(treasuryTokenAccount);
  const instruction = plan(input.programId, "initialize_controlled_instrument", [
    account(input.administrator, true, true), account(input.programId), account(legacy.programDataAddress),
    account(legacy.instrumentAddress, true), account(legacy.instrumentAuthority), account(controlledPolicyAddress, true),
    account(input.bondMint, true), account(input.settlementMint), account(treasuryTokenAccount, true),
    account(TOKEN_2022_PROGRAM_ID), account(SYSTEM_PROGRAM_ID),
  ], Buffer.from(legacy.instruction.data).subarray(8));
  return { ...legacy, controlledPolicyAddress, treasuryTokenAccount, instruction, instructions: [instruction] };
}

export async function buildControlledHoldingRegistration(input: InstrumentIdentity & { corporateActionAuthority: string; bondTokenAccount: string }) {
  key(input.corporateActionAuthority); key(input.bondTokenAccount);
  const derived = await instrumentAddresses(input);
  const controlledHoldingAddress = await deriveControlledHoldingAddress(input.programId, derived.instrumentAddress, input.bondTokenAccount);
  const instruction = plan(input.programId, "register_controlled_holding", [
    account(input.corporateActionAuthority, true, true), account(derived.instrumentAddress), account(derived.controlledPolicyAddress),
    account(controlledHoldingAddress, true), account(input.bondTokenAccount), account(TOKEN_2022_PROGRAM_ID), account(SYSTEM_PROGRAM_ID),
  ]);
  return { ...derived, controlledHoldingAddress, instruction, instructions: [instruction] };
}

export async function buildControlledInstrumentActivation(input: InstrumentIdentity & {
  issuerAuthority: string; bondMint: string; holderTokenAccounts: readonly string[];
}) {
  key(input.issuerAuthority); key(input.bondMint); uniqueAccounts(input.holderTokenAccounts, "Controlled activation");
  const derived = await instrumentAddresses(input);
  const holdingAddresses = await Promise.all(input.holderTokenAccounts.map(value => deriveControlledHoldingAddress(input.programId, derived.instrumentAddress, value)));
  const instruction = plan(input.programId, "activate_controlled_instrument", [
    account(input.issuerAuthority, false, true), account(derived.instrumentAddress, true), account(derived.controlledPolicyAddress),
    account(derived.instrumentAuthority), account(input.bondMint), account(TOKEN_2022_PROGRAM_ID),
    ...input.holderTokenAccounts.flatMap((value, index) => [account(value), account(holdingAddresses[index]!)]),
  ]);
  return { ...derived, holdingAddresses, instruction, instructions: [instruction] };
}

/** Both holder and CA signatures are required; the instrument PDA delegates Token-2022 transfer and refreezes atomically. */
export async function buildControlledTransfer(input: InstrumentIdentity & {
  corporateActionAuthority: string; holder: string; bondMint: string; sourceTokenAccount: string; destinationTokenAccount: string; amount: bigint;
}) {
  [input.corporateActionAuthority, input.holder, input.bondMint, input.sourceTokenAccount, input.destinationTokenAccount].forEach(key);
  if (input.sourceTokenAccount === input.destinationTokenAccount) throw new Error("Controlled transfer source and destination must differ");
  const derived = await instrumentAddresses(input);
  const sourceHoldingAddress = await deriveControlledHoldingAddress(input.programId, derived.instrumentAddress, input.sourceTokenAccount);
  const destinationHoldingAddress = await deriveControlledHoldingAddress(input.programId, derived.instrumentAddress, input.destinationTokenAccount);
  const instruction = plan(input.programId, "controlled_transfer", [
    account(input.corporateActionAuthority, false, true), account(input.holder, false, true), account(derived.instrumentAddress),
    account(derived.controlledPolicyAddress), account(derived.instrumentAuthority), account(input.bondMint), account(input.sourceTokenAccount, true),
    account(input.destinationTokenAccount, true), account(sourceHoldingAddress), account(destinationHoldingAddress), account(TOKEN_2022_PROGRAM_ID),
  ], u64(input.amount, "Transfer amount", true));
  return { ...derived, sourceHoldingAddress, destinationHoldingAddress, instruction, instructions: [instruction] };
}

export async function buildControlledCaptureBegin(input: ActionIdentity) {
  const derived = await actionAddresses(input);
  const instruction = plan(input.programId, "begin_controlled_capture", [
    account(input.corporateActionAuthority, true, true), account(derived.instrumentAddress), account(derived.actionAddress),
    account(derived.controlledPolicyAddress, true), account(derived.controlledCaptureAddress, true), account(SYSTEM_PROGRAM_ID),
  ]);
  return { ...derived, instruction, instructions: [instruction] };
}

export async function buildControlledCaptureRecord(input: Omit<SnapshotRegistrationInput, "issuerAuthority"> & {
  corporateActionAuthority: string; holderTokenAccounts: readonly string[];
}) {
  uniqueAccounts(input.holderTokenAccounts, "Controlled capture");
  const snapshot = await buildSnapshotRegistrationInstruction({ ...input, issuerAuthority: input.corporateActionAuthority });
  const derived = await actionAddresses(input);
  const holdingAddresses = await Promise.all(input.holderTokenAccounts.map(value => deriveControlledHoldingAddress(input.programId, derived.instrumentAddress, value)));
  const instruction = plan(input.programId, "record_controlled_snapshot", [
    account(input.corporateActionAuthority, false, true), account(derived.instrumentAddress), account(derived.actionAddress, true),
    account(derived.controlledPolicyAddress), account(derived.controlledCaptureAddress, true), account(input.bondMint), account(TOKEN_2022_PROGRAM_ID),
    ...input.holderTokenAccounts.flatMap((value, index) => [account(value), account(holdingAddresses[index]!)]),
  ], Buffer.from(snapshot.data).subarray(8));
  return { ...derived, holdingAddresses, instruction, instructions: [instruction] };
}

export async function buildControlledCaptureFinish(input: ActionIdentity & { investorIds?: readonly Uint8Array[] }) {
  const derived = await actionAddresses(input);
  const investors = input.investorIds ?? [];
  if (investors.length > MAX_CONTROLLED_HOLDINGS || new Set(investors.map(value => Buffer.from(value).toString("hex"))).size !== investors.length) throw new Error("Capture finish investor identities must be unique");
  const entitlementAddresses = await Promise.all(investors.map(value => deriveEntitlementAddress(input.programId, derived.actionAddress, value)));
  const unitReservationAddresses = await Promise.all(entitlementAddresses.map(value => deriveControlledUnitReservationAddress(input.programId, value)));
  const instruction = plan(input.programId, "finish_controlled_capture", [
    account(input.corporateActionAuthority, false, true), account(derived.instrumentAddress), account(derived.actionAddress),
    account(derived.controlledPolicyAddress, true), account(derived.controlledCaptureAddress, true),
    ...entitlementAddresses.flatMap((value, index) => [account(value), account(unitReservationAddresses[index]!)]),
  ]);
  return { ...derived, entitlementAddresses, unitReservationAddresses, instruction, instructions: [instruction] };
}

export async function buildControlledCaptureAbort(input: ActionIdentity) {
  const derived = await actionAddresses(input);
  const instruction = plan(input.programId, "abort_controlled_capture", [
    account(input.corporateActionAuthority, true, true), account(derived.instrumentAddress), account(derived.actionAddress),
    account(derived.controlledPolicyAddress, true), account(derived.controlledCaptureAddress, true),
  ]);
  return { ...derived, instruction, instructions: [instruction] };
}

export async function buildControlledRedemptionSourceRegistration(input: InvestorIdentity & {
  bondMint: string; tokenAccounts: RedemptionTokenAccount[]; snapshotHash: string;
}) {
  const legacy = await buildRedemptionSourceRegistration(input);
  const derived = await actionAddresses(input);
  const instruction = plan(input.programId, "register_controlled_redemption_sources", [
    ...legacy.instruction.accounts, account(derived.controlledPolicyAddress), account(derived.controlledCaptureAddress),
  ], Buffer.from(legacy.instruction.data).subarray(8));
  return { ...legacy, ...derived, instruction, instructions: [instruction] };
}

export async function buildControlledUnitReservation(input: InvestorIdentity & { bondMint: string; tokenAccounts: RedemptionTokenAccount[]; snapshotHash: string }) {
  const legacy = await buildRedemptionSourceRegistration(input);
  const derived = await actionAddresses(input);
  const unitReservationAddress = await deriveControlledUnitReservationAddress(input.programId, legacy.entitlementAddress);
  const holdingAddresses = await Promise.all(legacy.tokenAccounts.map(value => deriveControlledHoldingAddress(input.programId, derived.instrumentAddress, value.address)));
  const instruction = plan(input.programId, "reserve_controlled_redemption", [
    account(input.corporateActionAuthority, true, true), account(derived.instrumentAddress), account(derived.actionAddress),
    account(derived.controlledPolicyAddress), account(derived.controlledCaptureAddress, true), account(legacy.entitlementAddress),
    account(legacy.sourceAddress), account(legacy.progressAddress), account(unitReservationAddress, true), account(input.bondMint),
    account(TOKEN_2022_PROGRAM_ID), account(SYSTEM_PROGRAM_ID), ...legacy.tokenAccounts.map(value => account(value.address)),
    ...holdingAddresses.map(value => account(value, true)),
  ]);
  return { ...legacy, ...derived, unitReservationAddress, holdingAddresses, instruction, instructions: [instruction] };
}

/** Preserves legacy payment/receipt accounts and adds the immutable per-source unit reservation. */
export async function buildControlledRedemptionExecution(input: InvestorIdentity & {
  bondMint: string; settlementMint: string; settlementWallet: string; idempotencyHash: string; tokenAccounts: RedemptionTokenAccount[];
}) {
  const legacy = await buildRedemptionExecution(input);
  const controlledPolicyAddress = await deriveControlledPolicyAddress(input.programId, legacy.instrumentAddress);
  const unitReservationAddress = await deriveControlledUnitReservationAddress(input.programId, legacy.entitlementAddress);
  const holdingAddresses = await Promise.all(legacy.tokenAccounts.map(value => deriveControlledHoldingAddress(input.programId, legacy.instrumentAddress, value.address)));
  const instruction = plan(input.programId, "execute_controlled_redemption", [
    ...legacy.instruction.accounts, account(controlledPolicyAddress), account(unitReservationAddress, true),
    ...holdingAddresses.map(value => account(value, true)),
  ], Buffer.from(legacy.instruction.data).subarray(8));
  return { ...legacy, controlledPolicyAddress, unitReservationAddress, holdingAddresses, instruction, instructions: [legacy.instructions[0]!, instruction] };
}

export async function buildControlledRedemptionCompletion(input: ActionIdentity) {
  const derived = await actionAddresses(input);
  const instruction = plan(input.programId, "complete_controlled_redemption", [
    account(input.corporateActionAuthority, false, true), account(derived.instrumentAddress), account(derived.actionAddress), account(derived.controlledPolicyAddress, true),
  ]);
  return { ...derived, instruction, instructions: [instruction] };
}

export type ControlledAccountData = {
  address: string; owner: string; dataBase64: string; executable: boolean;
};

export type ControlledTokenPosition = {
  address: string; tokenProgramOwner: string; mintAddress: string; walletAddress: string; balance: bigint;
  state: "INITIALIZED" | "FROZEN"; delegate: string | null; delegatedAmount: bigint;
  nativeReserve: bigint | null; closeAuthority: string | null; immutableOwner: boolean; cpiGuardEnabled: boolean | null;
  incomingMemoRequired: boolean | null;
  extensions: readonly { type: number; dataHex: string }[]; dataBase64: string;
};

function rawData(value: string): Buffer {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Controlled account encoding is invalid");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("Controlled account encoding is not canonical");
  return bytes;
}

/** Decodes actual Token-2022 source bytes, retaining owner, state, delegate and extension metadata for the snapshot. */
export function decodeControlledTokenPosition(input: ControlledAccountData, expectedMintAddress: string): ControlledTokenPosition {
  key(input.address); key(expectedMintAddress);
  if (input.owner !== TOKEN_2022_PROGRAM_ID || input.executable !== false) throw new Error("Controlled token account owner is invalid");
  const data = rawData(input.dataBase64);
  if (data.length < 165 || !data.subarray(0, 32).equals(Buffer.from(key(expectedMintAddress)))) throw new Error("Controlled token account mint or data is invalid");
  if (data[108] !== 1 && data[108] !== 2) throw new Error("Controlled token account is not initialized");
  const option = (offset: number): string | null => {
    const tag = data.readUInt32LE(offset);
    if (tag !== 0 && tag !== 1) throw new Error("Controlled token-account option is invalid");
    return tag === 0 ? null : encodePublicKey(data.subarray(offset + 4, offset + 36));
  };
  const nativeTag = data.readUInt32LE(109);
  if (nativeTag !== 0 && nativeTag !== 1) throw new Error("Controlled token-account native option is invalid");
  const extensions: { type: number; dataHex: string }[] = [];
  if (data.length > 165) {
    if (data[165] !== 2) throw new Error("Controlled token account extension type is invalid");
    let offset = 166;
    while (offset < data.length) {
      if (data.subarray(offset).every(byte => byte === 0)) break;
      if (offset + 4 > data.length) throw new Error("Controlled token account extension header is truncated");
      const type = data.readUInt16LE(offset); const length = data.readUInt16LE(offset + 2); offset += 4;
      if (type === 0 || extensions.some(value => value.type === type) || offset + length > data.length || (type === 7 && length !== 0) ||
          ((type === 8 || type === 11) && (length !== 1 || (data[offset] !== 0 && data[offset] !== 1)))) throw new Error("Controlled token account extension is invalid");
      extensions.push({ type, dataHex: data.subarray(offset, offset + length).toString("hex") }); offset += length;
    }
  }
  return { address: input.address, tokenProgramOwner: input.owner, mintAddress: expectedMintAddress,
    walletAddress: encodePublicKey(data.subarray(32, 64)), balance: data.readBigUInt64LE(64),
    state: data[108] === 2 ? "FROZEN" : "INITIALIZED", delegate: option(72), delegatedAmount: data.readBigUInt64LE(121),
    nativeReserve: nativeTag === 0 ? null : data.readBigUInt64LE(113), closeAuthority: option(129),
    immutableOwner: extensions.some(value => value.type === 7),
    cpiGuardEnabled: extensions.find(value => value.type === 11)?.dataHex === "01" ? true : extensions.some(value => value.type === 11) ? false : null,
    incomingMemoRequired: extensions.find(value => value.type === 8)?.dataHex === "01" ? true : extensions.some(value => value.type === 8) ? false : null,
    extensions, dataBase64: input.dataBase64 };
}

function rpcObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SolanaRpcError("INVALID_RPC_RESPONSE", `${name} must be an object`);
  return value as Record<string, unknown>;
}

function rpcSlot(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Controlled RPC slot is invalid");
  return value as number;
}

function rpcMintSupply(value: unknown): { slot: number; supply: bigint } {
  const result = rpcObject(value, "Controlled mint"); const context = rpcObject(result["context"], "Mint context");
  const mint = rpcObject(result["value"], "Mint account"); const encoded = mint["data"];
  if (mint["owner"] !== TOKEN_2022_PROGRAM_ID || mint["executable"] !== false || !Array.isArray(encoded) || encoded.length !== 2 ||
      typeof encoded[0] !== "string" || encoded[1] !== "base64") throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Controlled mint metadata is invalid");
  const data = rawData(encoded[0]);
  if (data.length !== CONTROLLED_BOND_MINT_SIZE || data[44] !== 0 || data[45] !== 1 || data[165] !== 1) throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Controlled mint supply data is invalid");
  return { slot: rpcSlot(context["slot"]), supply: data.readBigUInt64LE(36) };
}

/**
 * Caller must first verify the capture PDA and policy gate at finalized commitment and pass its startedSlot.
 * Reads cannot precede that slot. Supply/slot checks alone do not prove that the capture gate is held.
 */
export async function collectControlledTokenPositions(rpc: SolanaRpc, mintAddress: string, minimumContextSlot: number) {
  key(mintAddress);
  if (!Number.isSafeInteger(minimumContextSlot) || minimumContextSlot < 1) throw new SolanaRpcError("INVALID_CAPTURE_SLOT", "Finalized capture minimum context slot must be a positive safe integer");
  const options = { commitment: "finalized", encoding: "base64", minContextSlot: minimumContextSlot };
  // getTokenSupply has no minContextSlot option; raw mint reads enforce the same lower bound as the registry.
  const before = rpcMintSupply(await rpc.request("getAccountInfo", [mintAddress, options]));
  const result = rpcObject(await rpc.request("getProgramAccounts", [TOKEN_2022_PROGRAM_ID,
    { ...options, withContext: true, filters: [{ memcmp: { offset: 0, bytes: mintAddress } }] }]), "Controlled token positions");
  const context = rpcObject(result["context"], "Positions context"); const captureSlot = rpcSlot(context["slot"]);
  const after = rpcMintSupply(await rpc.request("getAccountInfo", [mintAddress, options]));
  if ([before.slot, captureSlot, after.slot].some(value => value < minimumContextSlot) || before.slot > captureSlot || captureSlot > after.slot ||
      before.supply !== after.supply || after.supply === 0n) throw new SolanaRpcError("INCONSISTENT_FINALIZED_CONTEXT", "Controlled supply or slots changed or precede the finalized capture");
  if (!Array.isArray(result["value"])) throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Controlled token positions are invalid");
  const seen = new Set<string>();
  const positions = result["value"].map((value: unknown) => {
    const entry = rpcObject(value, "Token position"); const data = rpcObject(entry["account"], "Token account");
    const encoded = data["data"];
    if (typeof entry["pubkey"] !== "string" || typeof data["owner"] !== "string" || typeof data["executable"] !== "boolean" || !Array.isArray(encoded) || encoded.length !== 2 || typeof encoded[0] !== "string" || encoded[1] !== "base64") throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Controlled token position metadata is invalid");
    const position = decodeControlledTokenPosition({ address: entry["pubkey"], owner: data["owner"], executable: data["executable"], dataBase64: encoded[0] }, mintAddress);
    if (seen.has(position.address)) throw new SolanaRpcError("DUPLICATE_TOKEN_ACCOUNT", "Controlled capture contains duplicate accounts");
    seen.add(position.address); return position;
  }).sort((left, right) => left.address < right.address ? -1 : left.address > right.address ? 1 : 0);
  const positivePositions = positions.filter(value => value.balance > 0n);
  // Holders may toggle these extensions while frozen. Neither prevents permanent-delegate burns or outgoing transfers.
  if (positivePositions.some(value => value.state !== "FROZEN" || !value.immutableOwner || value.extensions.some(extension => extension.type !== 7 && extension.type !== 8 && extension.type !== 11) ||
      value.delegate !== null || value.closeAuthority !== null)) throw new SolanaRpcError("INVALID_TOKEN_ACCOUNT", "Controlled positive positions must be frozen immutable-owner accounts with only optional CPI Guard or MemoTransfer and without delegates or close authorities");
  const totalBalance = positivePositions.reduce((total, value) => total + value.balance, 0n);
  if (totalBalance !== after.supply) throw new SolanaRpcError("SUPPLY_MISMATCH", "Controlled balances do not equal mint supply");
  return { mintAddress, slot: captureSlot, supply: after.supply, totalBalance, positions, positivePositions };
}

type ProgramAccountExpectation = { programId: string; accountAddress: string };

function programAccountReader(input: ControlledAccountData, expected: ProgramAccountExpectation, name: string, size: number) {
  key(expected.programId); key(expected.accountAddress);
  if (input.owner !== expected.programId || input.address !== expected.accountAddress || input.executable !== false) throw new Error(`${name} owner or address is invalid`);
  const data = rawData(input.dataBase64);
  if (data.length !== size || data[8] !== 1 || !data.subarray(0, 8).equals(discriminator("account", name))) throw new Error(`${name} data or version is invalid`);
  let offset = 9;
  const read = (length: number) => {
    if (offset + length > data.length) throw new Error(`${name} is truncated`);
    const bytes = data.subarray(offset, offset + length); offset += length; return bytes;
  };
  return {
    publicKey: () => encodePublicKey(read(32)), hash: () => read(32).toString("hex"),
    u64: () => read(8).readBigUInt64LE(), i64: () => read(8).readBigInt64LE(), u32: () => read(4).readUInt32LE(),
    byte: () => read(1)[0]!, boolean: () => { const value = read(1)[0]; if (value !== 0 && value !== 1) throw new Error(`${name} boolean is invalid`); return value === 1; },
  };
}

function identity(actual: string, expected: string, name: string): void {
  key(expected);
  if (actual !== expected) throw new Error(`${name} identity is invalid`);
}

function expectedHash(actual: string, expected: string, name: string): void {
  if (!/^[0-9a-f]{64}$/.test(expected) || actual !== expected) throw new Error(`${name} commitment is invalid`);
}

/** Caller supplies the derived canonical address plus the expected program owner and instrument identities. */
export function decodeControlledPolicy(input: ControlledAccountData, expected: ProgramAccountExpectation & { instrumentAddress: string; mintAddress: string }) {
  const reader = programAccountReader(input, expected, "ControlledPolicy", CONTROLLED_POLICY_BYTES);
  const instrumentAddress = reader.publicKey(); const mintAddress = reader.publicKey();
  const captureAction = reader.publicKey(); const activeRedemption = reader.publicKey(); const bump = reader.byte();
  identity(instrumentAddress, expected.instrumentAddress, "Controlled policy instrument"); identity(mintAddress, expected.mintAddress, "Controlled policy mint");
  return { version: 1 as const, instrumentAddress, mintAddress, captureAction, activeRedemption, bump };
}

export function decodeControlledHolding(input: ControlledAccountData, expected: ProgramAccountExpectation & {
  instrumentAddress: string; mintAddress: string; tokenAccount: string; walletAddress: string;
}) {
  const reader = programAccountReader(input, expected, "ControlledHolding", CONTROLLED_HOLDING_BYTES);
  const instrumentAddress = reader.publicKey(); const mintAddress = reader.publicKey(); const tokenAccount = reader.publicKey();
  const walletAddress = reader.publicKey(); const reservedTokens = reader.u64(); const bump = reader.byte();
  identity(instrumentAddress, expected.instrumentAddress, "Controlled holding instrument"); identity(mintAddress, expected.mintAddress, "Controlled holding mint");
  identity(tokenAccount, expected.tokenAccount, "Controlled holding token account"); identity(walletAddress, expected.walletAddress, "Controlled holding wallet");
  return { version: 1 as const, instrumentAddress, mintAddress, tokenAccount, walletAddress, reservedTokens, bump };
}

export function decodeControlledCapture(input: ControlledAccountData, expected: ProgramAccountExpectation & {
  instrumentAddress: string; actionAddress: string; snapshotHash?: string;
}) {
  const reader = programAccountReader(input, expected, "ControlledCapture", CONTROLLED_CAPTURE_BYTES);
  const instrumentAddress = reader.publicKey(); const actionAddress = reader.publicKey(); const startedSlot = reader.u64();
  const startedAt = reader.i64(); const snapshotHash = reader.hash(); const committed = reader.boolean(); const finished = reader.boolean();
  const count = reader.u32();
  if (count > MAX_CONTROLLED_HOLDINGS) throw new Error("Controlled capture source count is invalid");
  const holdings = Array.from({ length: count }, () => ({ tokenAccount: reader.publicKey(), walletAddress: reader.publicKey(), balance: reader.u64() }));
  const reservedCount = reader.u32();
  if (reservedCount > MAX_CONTROLLED_HOLDINGS || reservedCount !== count) throw new Error("Controlled capture reservation count is invalid");
  const reservedSources = Array.from({ length: reservedCount }, () => reader.byte());
  const reservedEntitlements = reader.u32(); const reservedTokens = reader.u64(); const bump = reader.byte();
  identity(instrumentAddress, expected.instrumentAddress, "Controlled capture instrument"); identity(actionAddress, expected.actionAddress, "Controlled capture action");
  if (expected.snapshotHash !== undefined) expectedHash(snapshotHash, expected.snapshotHash, "Controlled capture snapshot");
  if (startedSlot === 0n || reservedEntitlements > MAX_CONTROLLED_HOLDINGS || reservedSources.some(value => value !== 0 && value !== 1) ||
      new Set(holdings.map(value => value.tokenAccount)).size !== count || holdings.some(value => value.balance === 0n) ||
      reservedTokens > holdings.reduce((total, value) => total + value.balance, 0n) ||
      (committed ? count === 0 || /^0{64}$/.test(snapshotHash) : count !== 0 || !/^0{64}$/.test(snapshotHash) || finished || reservedEntitlements !== 0 || reservedTokens !== 0n)) {
    throw new Error("Controlled capture state is invalid");
  }
  return { version: 1 as const, instrumentAddress, actionAddress, startedSlot, startedAt, snapshotHash, committed, finished, holdings, reservedSources, reservedEntitlements, reservedTokens, bump };
}

export function decodeControlledUnitReservation(input: ControlledAccountData, expected: ProgramAccountExpectation & {
  actionAddress: string; entitlementAddress: string; snapshotHash: string; sourceHash: string;
}) {
  const reader = programAccountReader(input, expected, "UnitReservation", CONTROLLED_UNIT_RESERVATION_BYTES);
  const actionAddress = reader.publicKey(); const entitlementAddress = reader.publicKey(); const snapshotHash = reader.hash(); const sourceHash = reader.hash();
  const count = reader.u32();
  if (count === 0 || count > 8) throw new Error("Controlled unit reservation allocation count is invalid");
  const allocations = Array.from({ length: count }, () => reader.u64()); const consumed = reader.boolean(); const bump = reader.byte();
  identity(actionAddress, expected.actionAddress, "Controlled reservation action"); identity(entitlementAddress, expected.entitlementAddress, "Controlled reservation entitlement");
  expectedHash(snapshotHash, expected.snapshotHash, "Controlled reservation snapshot"); expectedHash(sourceHash, expected.sourceHash, "Controlled reservation source");
  if (/^0{64}$/.test(snapshotHash) || /^0{64}$/.test(sourceHash) || allocations.reduce((total, value) => total + value, 0n) > (1n << 64n) - 1n) throw new Error("Controlled unit reservation is invalid");
  return { version: 1 as const, actionAddress, entitlementAddress, snapshotHash, sourceHash, allocations, consumed, bump };
}
