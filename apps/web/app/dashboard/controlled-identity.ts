import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/addresses";
import { encodeBase58, isActionId } from "./snapshot-workflow";
import { transactionHex } from "./reviewed-transaction";

export type InstrumentTokenPolicy = "LEGACY_UNRESTRICTED_V1" | "CONTROLLED_FROZEN_V2";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const publicKeyBytes = (value: string) => Uint8Array.from(getAddressEncoder().encode(address(value)));
export const keyHex = (value: string) => transactionHex(publicKeyBytes(value));
export function uuidBytes(value: string): Uint8Array {
  if (!isActionId(value)) throw new Error("Некорректный UUID выбранной записи.");
  return Uint8Array.from(value.replaceAll("-", "").match(/../g)!, byte => parseInt(byte, 16));
}
export async function bytesHash(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
}
export async function instructionDiscriminator(name: string): Promise<string> {
  return transactionHex(await bytesHash(new TextEncoder().encode(`global:${name}`))).slice(0, 16);
}
export function unsignedHex(value: string | number, size = 8): string {
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text) || BigInt(text) >= 1n << BigInt(size * 8)) throw new Error("Некорректное целое значение плана.");
  let number = BigInt(text); const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index++) { bytes[index] = Number(number & 255n); number >>= 8n; }
  return transactionHex(bytes);
}
export async function derivedAddress(programId: string, seeds: readonly (string | Uint8Array)[]): Promise<string> {
  return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: [...seeds] }))[0];
}
export async function controlledInstrumentAddresses(programId: string, instrumentId: string) {
  const instrumentAddress = await derivedAddress(programId, ["instrument", uuidBytes(instrumentId)]);
  const instrumentAuthority = await derivedAddress(programId, ["instrument-authority", publicKeyBytes(instrumentAddress)]);
  const controlledPolicyAddress = await derivedAddress(programId, ["controlled-policy", publicKeyBytes(instrumentAddress)]);
  return { instrumentAddress, instrumentAuthority, controlledPolicyAddress };
}
export async function controlledActionAddresses(programId: string, instrumentId: string, actionId: string) {
  const instrument = await controlledInstrumentAddresses(programId, instrumentId);
  const actionAddress = await derivedAddress(programId, ["action", publicKeyBytes(instrument.instrumentAddress), uuidBytes(actionId)]);
  return { ...instrument, actionAddress,
    controlledCaptureAddress: await derivedAddress(programId, ["controlled-capture", publicKeyBytes(actionAddress)]) };
}
export const controlledHoldingAddress = (programId: string, instrumentAddress: string, tokenAccount: string) =>
  derivedAddress(programId, ["controlled-holding", publicKeyBytes(instrumentAddress), publicKeyBytes(tokenAccount)]);
export const unitReservationAddress = (programId: string, entitlementAddress: string) =>
  derivedAddress(programId, ["unit-reservation", publicKeyBytes(entitlementAddress)]);
export const associatedAddress = (owner: string, mint: string) =>
  derivedAddress(ASSOCIATED_PROGRAM, [publicKeyBytes(owner), publicKeyBytes(TOKEN_PROGRAM), publicKeyBytes(mint)]);
export async function seededMintAddress(owner: string, seed: string): Promise<string> {
  return encodeBase58(await bytesHash(new Uint8Array([...publicKeyBytes(owner), ...new TextEncoder().encode(seed), ...publicKeyBytes(TOKEN_PROGRAM)])));
}
