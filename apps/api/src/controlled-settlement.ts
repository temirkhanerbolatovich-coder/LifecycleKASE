import { buildControlledUnitReservation, decodeControlledCapture, decodeControlledHolding, decodeControlledPolicy,
  decodeControlledTokenPosition, decodeControlledUnitReservation, deriveControlledCaptureAddress, deriveControlledPolicyAddress,
  SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, type ControlledAccountData, type SolanaRpc } from "@lifecycle-kase/solana-client";
import type { InstrumentDeploymentOptions } from "./instrument-deployment.js";
import { requireControlledRegistry } from "./controlled-policy.js";
import { redemptionBurnAllocation, redemptionTokenSources } from "./redemption-sources.js";
import { uuidBytes } from "./snapshot-registration.js";
import { rpcNumber, rpcObject, TransactionWorkflowError, workflowProgramAccount } from "./transaction-workflow.js";
import { deriveCorporateActionAddresses } from "@lifecycle-kase/solana-client";

type ControlledAction = { id: string; instrumentId: string; type: string;
  instrument: { tokenPolicy?: string | null; mintAddress: string | null; corporateActionAuthority: string };
  snapshot: { snapshotHash: Uint8Array; mintSupply: bigint; investors: Parameters<typeof redemptionTokenSources>[0] } | null;
  entitlements: { investorId: string; snapshotInvestorId: string; tokensToRedeem: bigint; onchainPda: string | null }[] };
type ControlledOptions = InstrumentDeploymentOptions & { controlledRegistryEnabled?: boolean };
const failure = (message: string) => new TransactionWorkflowError("CONTROLLED_RESERVATION_MISMATCH", message);
const programData = async (rpc: SolanaRpc, address: string, options: ControlledOptions, slot: number): Promise<ControlledAccountData> => ({
  address, owner: options.programId, executable: false,
  dataBase64: await workflowProgramAccount(rpc, address, options.programId, slot),
});

/** Persisted evidence is accepted only when every immutable binding and reserved counter matches. */
export function requireControlledReservationProof(proof: unknown, expected: {
  unitReservationAddress: string; sourceHash: string; allocations: string[]; holdingAddresses: string[];
  tokenAccounts: { address: string; wallet: string }[]; consumed: boolean;
}) {
  const reservation = rpcObject(proof);
  if (reservation["unitReservationAddress"] !== expected.unitReservationAddress || reservation["sourceHash"] !== expected.sourceHash ||
      reservation["consumed"] !== expected.consumed || JSON.stringify(reservation["allocations"]) !== JSON.stringify(expected.allocations) ||
      !Array.isArray(reservation["holdings"]) || reservation["holdings"].length !== expected.tokenAccounts.length ||
      reservation["holdings"].some((value, index) => {
        const holding = rpcObject(value);
        return holding["address"] !== expected.holdingAddresses[index] || holding["tokenAccount"] !== expected.tokenAccounts[index]!.address ||
          holding["walletAddress"] !== expected.tokenAccounts[index]!.wallet || holding["reservedTokens"] !== (expected.consumed ? "0" : expected.allocations[index]);
      })) throw new TransactionWorkflowError("RECONCILIATION_REQUIRED", "Verified assigned-unit reservation and Holding evidence differ");
  return reservation;
}

/** Compare immutable allocations, including zero markers, rather than current free-unit balances. */
export function controlledBurnAllocations(sources: Parameters<typeof redemptionBurnAllocation>[0], tokens: bigint) {
  if (tokens === 0n) return sources.map(source => ({ ...source, burnAmount: 0n }));
  return redemptionBurnAllocation(sources, tokens);
}

export function controlledSnapshotSources(investors: Parameters<typeof redemptionTokenSources>[0]) {
  return investors.flatMap(investor => investor.wallets.flatMap(wallet => wallet.tokenAccounts.map(source => ({
    address: source.address, wallet: wallet.walletAddress, balanceAtSnapshot: source.balance,
  })))).sort((left, right) => left.address < right.address ? -1 : left.address > right.address ? 1 : 0);
}

/** Reads the canonical policy and full raw-source commitment at finalized commitment. */
export async function controlledCaptureState(rpc: SolanaRpc, action: ControlledAction, options: ControlledOptions,
  state: "CAPTURING" | "FINISHED" | "COMPLETED", slot = 0) {
  if (!requireControlledRegistry(action.instrument, options)) return null;
  if (!action.snapshot || !action.instrument.mintAddress) throw failure("Controlled snapshot or mint is missing");
  const addresses = await deriveCorporateActionAddresses(options.programId, uuidBytes(action.instrumentId), uuidBytes(action.id));
  const controlledPolicyAddress = await deriveControlledPolicyAddress(options.programId, addresses.instrumentAddress);
  const controlledCaptureAddress = await deriveControlledCaptureAddress(options.programId, addresses.actionAddress);
  const snapshotHash = Buffer.from(action.snapshot.snapshotHash).toString("hex");
  let policy; let capture;
  try {
    policy = decodeControlledPolicy(await programData(rpc, controlledPolicyAddress, options, slot), {
      programId: options.programId, accountAddress: controlledPolicyAddress, instrumentAddress: addresses.instrumentAddress,
      mintAddress: action.instrument.mintAddress,
    });
    capture = decodeControlledCapture(await programData(rpc, controlledCaptureAddress, options, slot), {
      programId: options.programId, accountAddress: controlledCaptureAddress, instrumentAddress: addresses.instrumentAddress,
      actionAddress: addresses.actionAddress, snapshotHash,
    });
  } catch (error) {
    if (error instanceof TransactionWorkflowError) throw error;
    throw failure("Controlled policy or capture layout and identity differ");
  }
  const expected = controlledSnapshotSources(action.snapshot.investors);
  const actual = [...capture.holdings].sort((left, right) => left.tokenAccount < right.tokenAccount ? -1 : left.tokenAccount > right.tokenAccount ? 1 : 0);
  if (!capture.committed || capture.finished !== (state !== "CAPTURING") || actual.length !== expected.length ||
      actual.some((holding, index) => holding.tokenAccount !== expected[index]!.address || holding.walletAddress !== expected[index]!.wallet || holding.balance !== expected[index]!.balanceAtSnapshot) ||
      expected.reduce((sum, source) => sum + source.balanceAtSnapshot, 0n) !== action.snapshot.mintSupply ||
      policy.captureAction !== (state === "CAPTURING" ? addresses.actionAddress : SYSTEM_PROGRAM_ID) ||
      action.type !== "COUPON_PAYMENT" && policy.activeRedemption !== (state === "COMPLETED" ? SYSTEM_PROGRAM_ID : addresses.actionAddress)) {
    throw failure("Controlled capture gate or complete source commitment differs from the stored snapshot");
  }
  if (action.type !== "COUPON_PAYMENT" && state !== "CAPTURING" &&
      (capture.reservedEntitlements !== action.entitlements.length || capture.reservedSources.some(value => value !== 1) ||
        capture.reservedTokens !== action.entitlements.reduce((sum, row) => sum + row.tokensToRedeem, 0n))) {
    throw failure("Complete assigned-unit reservations are required before releasing the capture gate");
  }
  return { ...addresses, controlledPolicyAddress, controlledCaptureAddress, snapshotHash, policy, capture };
}

/** Verifies sidecar bindings and counters; untouched zero allocations never inspect re-created token-account bytes. */
export async function controlledReservationState(rpc: SolanaRpc, action: ControlledAction,
  row: ControlledAction["entitlements"][number], options: ControlledOptions, consumed: boolean, slot = 0) {
  if (!requireControlledRegistry(action.instrument, options)) return null;
  if (!action.snapshot || !action.instrument.mintAddress) throw failure("Controlled snapshot or mint is missing");
  const tokenAccounts = redemptionTokenSources(action.snapshot.investors, row.snapshotInvestorId);
  const plan = await buildControlledUnitReservation({ programId: options.programId, instrumentId: uuidBytes(action.instrumentId), actionId: uuidBytes(action.id),
    corporateActionAuthority: action.instrument.corporateActionAuthority, investorId: uuidBytes(row.investorId), bondMint: action.instrument.mintAddress,
    tokenAccounts, snapshotHash: Buffer.from(action.snapshot.snapshotHash).toString("hex") });
  if (row.onchainPda !== plan.entitlementAddress) throw failure("Controlled reservation entitlement PDA differs");
  let reservation;
  try {
    reservation = decodeControlledUnitReservation(await programData(rpc, plan.unitReservationAddress, options, slot), {
      programId: options.programId, accountAddress: plan.unitReservationAddress, actionAddress: plan.actionAddress,
      entitlementAddress: plan.entitlementAddress, snapshotHash: Buffer.from(action.snapshot.snapshotHash).toString("hex"), sourceHash: plan.sourceHash,
    });
  } catch (error) {
    if (error instanceof TransactionWorkflowError) throw error;
    throw failure("Controlled unit reservation data or immutable identity differ");
  }
  const allocations = controlledBurnAllocations(tokenAccounts, row.tokensToRedeem);
  if (reservation.consumed !== consumed || reservation.allocations.length !== allocations.length ||
      reservation.allocations.some((amount, index) => amount !== allocations[index]!.burnAmount)) throw failure("Controlled reservation allocations or consumption differ");
  const holdings = await Promise.all(allocations.map(async (source, index) => {
    const address = plan.holdingAddresses[index]!; let holding;
    try { holding = decodeControlledHolding(await programData(rpc, address, options, slot), {
      programId: options.programId, accountAddress: address, instrumentAddress: plan.instrumentAddress, mintAddress: action.instrument.mintAddress!,
      tokenAccount: source.address, walletAddress: source.wallet,
    }); } catch (error) {
      if (error instanceof TransactionWorkflowError) throw error;
      throw failure("Controlled Holding identity differs from the original source");
    }
    if (holding.reservedTokens !== (consumed ? 0n : source.burnAmount)) throw failure("Holding reserved counter differs from the assigned units");
    // Once consumed, immutable transaction history proves the burn. A resulting empty account may already have been closed.
    if (source.burnAmount > 0n && !consumed) await frozenControlledSource(rpc, source.address, action.instrument.mintAddress!, source.wallet, source.burnAmount, slot);
    return { address, tokenAccount: source.address, walletAddress: source.wallet, reservedTokens: holding.reservedTokens.toString() };
  }));
  return { unitReservationAddress: plan.unitReservationAddress, controlledPolicyAddress: plan.controlledPolicyAddress,
    controlledCaptureAddress: plan.controlledCaptureAddress, sourceHash: plan.sourceHash, holdingAddresses: plan.holdingAddresses,
    allocations: reservation.allocations.map(amount => amount.toString()), consumed: reservation.consumed, holdings };
}

export async function frozenControlledSource(rpc: SolanaRpc, address: string, mint: string, wallet: string, minimumBalance: bigint, slot = 0) {
  const response = rpcObject(await rpc.request("getAccountInfo", [address, { commitment: "finalized", encoding: "base64", minContextSlot: slot }]));
  if (rpcNumber(rpcObject(response["context"])["slot"]) < slot) throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Controlled source slot is too old", 503);
  const value = rpcObject(response["value"]); const data = value["data"];
  if (!Array.isArray(data) || data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64") throw failure("Controlled source data is unavailable");
  let position;
  try { position = decodeControlledTokenPosition({ address, owner: String(value["owner"]), executable: value["executable"] as boolean, dataBase64: data[0] }, mint); }
  catch { throw failure("Controlled source raw token data is invalid"); }
  if (position.tokenProgramOwner !== TOKEN_2022_PROGRAM_ID || position.walletAddress !== wallet || position.state !== "FROZEN" || !position.immutableOwner ||
      position.delegate !== null || position.closeAuthority !== null || position.extensions.some(extension => ![7, 8, 11].includes(extension.type)) || position.balance < minimumBalance) {
    throw failure("Positive assigned source must remain frozen, immutable and cover its reserved burn");
  }
  return position.balance;
}
