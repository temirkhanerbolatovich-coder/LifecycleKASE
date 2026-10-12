import { isActionId, unsignedTransactionForSigner, type SupportedSnapshotCluster } from "./snapshot-workflow";
import type { EntitlementsView } from "./entitlement-workflow";
import { redemptionAllocationMatches, type RedemptionAllocationPolicy } from "./action-workflow";
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/addresses";
import { controlledActionAddresses, unitReservationAddress, type InstrumentTokenPolicy } from "./controlled-identity";

export type PreparedOnchainCalculation = {
  corporateActionId: string; actionVersion: number; operationId: string; phase: "REGISTER" | "FINALIZE" | "RESET" | "RESERVE_UNITS";
  cluster: SupportedSnapshotCluster; requiredSigner: string; networkGenesisHash: string; programId: string;
  instrumentAddress: string; actionAddress: string; snapshotHash: string; serializedTransactionBase64: string;
  lastValidBlockHeight: number; entitlementId?: string; entitlementAddress?: string; investorId?: string;
  settlementWallet?: string; balanceAtSnapshot?: string; paymentAmountMinor?: string; tokensToRedeem?: string;
  entitlementStatus?: string; entitlementAddresses?: string[]; entitlementCount?: number; totalAmountMinor?: string;
  bondMint?: string; redemptionSourcesAddress?: string; redemptionProgressAddress?: string; sourceHash?: string; sourceAddresses?: string[];
  tokenAccounts?: { address: string; walletAddress: string; balanceAtSnapshot: string }[];
  redemptionAllocationPolicy?: RedemptionAllocationPolicy; redemptionTargetTokens?: string | null; targetAddress?: string;
  tokenPolicy?: InstrumentTokenPolicy; controlledPolicyAddress?: string; controlledCaptureAddress?: string;
  unitReservationAddress?: string; holdingAddresses?: string[]; allocations?: string[];
};

export function preparedOnchainCalculation(payload: Record<string, unknown>, view: EntitlementsView,
  corporateActionAuthority: string, walletAddress: string): PreparedOnchainCalculation {
  const invalid = () => new Error("On-chain план не совпадает с начислениями, snapshot или authority. Подпись остановлена.");
  const phase = payload["phase"];
  const publicKey = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  const exact = view.redemptionAllocationPolicy === "exact-target-largest-remainder-v2";
  if (payload["corporateActionId"] !== view.actionId || !isActionId(view.actionId) || payload["actionVersion"] !== view.actionVersion ||
      typeof payload["operationId"] !== "string" || !isActionId(payload["operationId"]) || !["REGISTER", "FINALIZE", "RESET", "RESERVE_UNITS"].includes(String(phase)) ||
      (payload["cluster"] !== "localnet" && payload["cluster"] !== "devnet") || payload["requiredSigner"] !== walletAddress ||
      corporateActionAuthority !== walletAddress || payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" ||
      !publicKey(payload["programId"]) || !publicKey(payload["instrumentAddress"]) || !publicKey(payload["actionAddress"]) ||
      !publicKey(payload["networkGenesisHash"]) || typeof payload["snapshotHash"] !== "string" || !/^[0-9a-f]{64}$/i.test(payload["snapshotHash"]) ||
      view.redemptionAllocationPolicy === "exact-target-largest-remainder-v2" && phase !== "RESET" && !publicKey(payload["targetAddress"]) ||
      view.items.length === 0 || view.items.some(item => item.calculationInputs.snapshotHash !== payload["snapshotHash"]) ||
      typeof payload["serializedTransactionBase64"] !== "string" || !Number.isSafeInteger(payload["lastValidBlockHeight"]) ||
      !redemptionAllocationMatches(payload, view) ||
      (payload["lastValidBlockHeight"] as number) < 0) throw invalid();
  if (view.tokenPolicy === "CONTROLLED_FROZEN_V2" ? payload["tokenPolicy"] !== view.tokenPolicy : payload["tokenPolicy"] !== undefined && payload["tokenPolicy"] !== "LEGACY_UNRESTRICTED_V1") throw invalid();
  if (exact && (!isActionId(view.instrumentId ?? "") || !publicKey(view.programId) ||
      !publicKey(view.networkGenesisHash) || !publicKey(view.corporateActionAuthority) ||
      !["SOLANA_LOCALNET", "SOLANA_DEVNET"].includes(view.network ?? "")) ||
      view.programId != null && payload["programId"] !== view.programId ||
      view.network != null && view.network !== (payload["cluster"] === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET") ||
      view.networkGenesisHash != null && payload["networkGenesisHash"] !== view.networkGenesisHash ||
      view.corporateActionAuthority != null && (payload["requiredSigner"] !== view.corporateActionAuthority ||
        corporateActionAuthority !== view.corporateActionAuthority)) throw invalid();
  if (phase === "REGISTER" || phase === "RESERVE_UNITS") {
    const row = view.items.find(item => item.id === payload["entitlementId"]);
    if (!row || (phase === "REGISTER" ? Boolean(row.onchainPda) : !row.onchainPda || view.tokenPolicy !== "CONTROLLED_FROZEN_V2" || !view.onchainCalculationFinalized) || payload["investorId"] !== row.investorId || payload["paymentAmountMinor"] !== row.amountMinor ||
        payload["settlementWallet"] !== row.settlementWalletAddress || payload["balanceAtSnapshot"] !== row.balanceAtRecordDate ||
        payload["tokensToRedeem"] !== row.tokensToRedeem || payload["entitlementStatus"] !== row.status ||
        !publicKey(payload["entitlementAddress"])) throw invalid();
  } else {
    const rows = phase === "FINALIZE" ? view.items : view.items.filter(item => item.onchainPda);
    if (rows.length === 0 || phase === "FINALIZE" && rows.length !== view.items.length || rows.some(item => !/^(0|[1-9][0-9]*)$/.test(item.amountMinor)) ||
        payload["entitlementCount"] !== rows.length ||
        payload["totalAmountMinor"] !== rows.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n).toString() ||
        !Array.isArray(payload["entitlementAddresses"]) || payload["entitlementAddresses"].length !== rows.length ||
        rows.some((item, index) => (payload["entitlementAddresses"] as unknown[])[index] !== item.onchainPda)) throw invalid();
  }
  unsignedTransactionForSigner(payload["serializedTransactionBase64"], walletAddress);
  return payload as unknown as PreparedOnchainCalculation;
}

/** Derive addresses from the separately loaded action, never from prepared-plan PDA metadata. */
export async function requireOnchainCalculationIdentity(plan: PreparedOnchainCalculation, view: EntitlementsView): Promise<void> {
  const invalid = () => new Error("PDA или программа расчёта отличаются от выбранного действия. Подпись остановлена.");
  const exact = view.redemptionAllocationPolicy === "exact-target-largest-remainder-v2";
  // Historical v1 responses did not expose the instrument/program identity.
  if (!exact && view.tokenPolicy !== "CONTROLLED_FROZEN_V2" && view.programId == null && view.instrumentId === undefined) return;
  if (!view.programId || !isActionId(view.instrumentId ?? "") || !isActionId(view.actionId) ||
      plan.programId !== view.programId || plan.corporateActionId !== view.actionId || plan.actionVersion !== view.actionVersion ||
      view.network != null && view.network !== (plan.cluster === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET") ||
      view.networkGenesisHash != null && plan.networkGenesisHash !== view.networkGenesisHash ||
      view.corporateActionAuthority != null && plan.requiredSigner !== view.corporateActionAuthority ||
      exact && (!view.network || !view.networkGenesisHash || !view.corporateActionAuthority)) throw invalid();
  const uuid = (value: string) => {
    if (!isActionId(value)) throw invalid();
    return Uint8Array.from(value.replaceAll("-", "").match(/../g)!, byte => parseInt(byte, 16));
  };
  const programAddress = address(view.programId);
  const encoder = getAddressEncoder();
  const pda = async (seed: string, owner: string) => (await getProgramDerivedAddress({ programAddress,
    seeds: [seed, encoder.encode(address(owner))] }))[0];
  const [instrumentAddress] = await getProgramDerivedAddress({ programAddress, seeds: ["instrument", uuid(view.instrumentId!)] });
  const [actionAddress] = await getProgramDerivedAddress({ programAddress,
    seeds: ["action", encoder.encode(instrumentAddress), uuid(view.actionId)] });
  if (plan.instrumentAddress !== instrumentAddress || plan.actionAddress !== actionAddress ||
      plan.redemptionProgressAddress !== await pda("redemption-progress", actionAddress) ||
      exact && plan.phase !== "RESET" && plan.targetAddress !== await pda("redemption_target", actionAddress)) throw invalid();
  if (view.tokenPolicy === "CONTROLLED_FROZEN_V2") {
    const controlled = await controlledActionAddresses(view.programId, view.instrumentId!, view.actionId);
    if (plan.controlledPolicyAddress !== controlled.controlledPolicyAddress || plan.controlledCaptureAddress !== controlled.controlledCaptureAddress) throw invalid();
  }
  const single = plan.phase === "REGISTER" || plan.phase === "RESERVE_UNITS";
  const rows = single ? view.items.filter(row => row.id === plan.entitlementId) :
    plan.phase === "FINALIZE" ? view.items : view.items.filter(row => row.onchainPda);
  if (rows.length === 0 || single && rows.length !== 1) throw invalid();
  for (const [index, row] of rows.entries()) {
    const [entitlementAddress] = await getProgramDerivedAddress({ programAddress,
      seeds: ["entitlement", encoder.encode(actionAddress), uuid(row.investorId)] });
    const sourceAddress = await pda("redemption-sources", entitlementAddress);
    if (single ? plan.entitlementAddress !== entitlementAddress || plan.redemptionSourcesAddress !== sourceAddress :
      row.onchainPda !== entitlementAddress || plan.entitlementAddresses?.[index] !== entitlementAddress ||
        plan.sourceAddresses?.[index] !== sourceAddress) throw invalid();
    if (plan.phase === "RESERVE_UNITS" && plan.unitReservationAddress !== await unitReservationAddress(view.programId, entitlementAddress)) throw invalid();
  }
}
