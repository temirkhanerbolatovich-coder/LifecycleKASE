import type { CorporateActionView } from "./action-workflow";
import { controlledActionAddresses, controlledHoldingAddress, COMPUTE_PROGRAM, derivedAddress, instructionDiscriminator,
  publicKeyBytes, SYSTEM_PROGRAM, TOKEN_PROGRAM, unitReservationAddress, unsignedHex, uuidBytes } from "./controlled-identity";
import { requireReviewedTransaction } from "./reviewed-transaction";
import { isActionId, resumedDeploymentSignature, type PreparedSnapshot, type SupportedSnapshotCluster } from "./snapshot-workflow";

export type CapturePhase = "BEGIN" | "FINISH" | "ABORT";
export type ControlledCaptureView = {
  actionId: string; instrumentId: string; tokenPolicy: "CONTROLLED_FROZEN_V2"; enabled: boolean;
  cluster: SupportedSnapshotCluster; networkGenesisHash: string; requiredSigner: string; programId: string;
  instrumentAddress: string; actionAddress: string; controlledPolicyAddress: string; controlledCaptureAddress: string; bondMint: string;
  investorIds: string[]; capture: null | { startedSlot: string; startedAt: string; committed: boolean; finished: boolean };
  readiness: { begin: boolean; finish: boolean; abort: boolean }; pending: Record<string, unknown> | null;
};
export type PreparedCapture = ControlledCaptureView & { corporateActionId: string; operationId: string; phase: CapturePhase;
  serializedTransactionBase64: string; lastValidBlockHeight: number; status: string; signature: string | null };
const key = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);

/** A locally saved wallet signature survives a lost submit request and a stale unsigned server projection. */
export function recoverCaptureAttempt(payload: Record<string, unknown>, local: { operationId: string; wire: string; signature: string; sent: boolean } | null) {
  const saved = resumedDeploymentSignature({ ...payload, resumed: true });
  if (local?.sent || local?.signature) {
    if (payload["operationId"] !== local.operationId || payload["serializedTransactionBase64"] !== local.wire || saved && saved !== local.signature && local.signature) {
      throw new Error("Исходная попытка или подпись изменилась. Повторная отправка остановлена.");
    }
    return { signature: saved ?? local.signature, sent: true };
  }
  return { signature: saved ?? "", sent: Boolean(saved) };
}

/** Bind capture metadata to the separately loaded corporate action and independently derived canonical addresses. */
export async function controlledCaptureView(payload: Record<string, unknown>, selected: CorporateActionView): Promise<ControlledCaptureView> {
  const invalid = () => new Error("Состояние фиксации держателей не совпадает с выбранным действием.");
  if (payload["actionId"] !== selected.id || payload["instrumentId"] !== selected.instrumentId || payload["tokenPolicy"] !== "CONTROLLED_FROZEN_V2" ||
      selected.instrument.tokenPolicy !== "CONTROLLED_FROZEN_V2" || payload["requiredSigner"] !== selected.instrument.corporateActionAuthority ||
      payload["programId"] !== selected.instrument.programId || typeof payload["enabled"] !== "boolean" ||
      payload["cluster"] !== (selected.instrument.network === "SOLANA_LOCALNET" ? "localnet" : "devnet") ||
      !["networkGenesisHash", "bondMint", "programId", "requiredSigner"].every(field => key(payload[field])) ||
      selected.instrument.networkGenesisHash != null && payload["networkGenesisHash"] !== selected.instrument.networkGenesisHash ||
      selected.instrument.mintAddress != null && payload["bondMint"] !== selected.instrument.mintAddress || !Array.isArray(payload["investorIds"])) throw invalid();
  const derived = await controlledActionAddresses(String(payload["programId"]), selected.instrumentId, selected.id);
  for (const field of ["instrumentAddress", "actionAddress", "controlledPolicyAddress", "controlledCaptureAddress"] as const) if (payload[field] !== derived[field]) throw invalid();
  const view = payload as unknown as ControlledCaptureView;
  if (view.investorIds.some(value => !isActionId(value)) || new Set(view.investorIds).size !== view.investorIds.length ||
      !view.readiness || ["begin", "finish", "abort"].some(field => typeof view.readiness[field as keyof typeof view.readiness] !== "boolean") ||
      view.pending !== null && (!view.pending || typeof view.pending !== "object" || Array.isArray(view.pending)) ||
      view.capture && (!/^[1-9][0-9]*$/.test(view.capture.startedSlot) || typeof view.capture.startedAt !== "string" ||
        typeof view.capture.committed !== "boolean" || typeof view.capture.finished !== "boolean")) throw invalid();
  return view;
}

export async function preparedControlledCapture(payload: Record<string, unknown>, view: ControlledCaptureView, wallet: string,
  entitlementInvestorIds: readonly string[] = []): Promise<PreparedCapture> {
  const invalid = () => new Error("План фиксации держателей отличается от проверенных данных. Подпись остановлена.");
  if (payload["corporateActionId"] !== view.actionId || !isActionId(String(payload["operationId"])) ||
      !["BEGIN", "FINISH", "ABORT"].includes(String(payload["phase"])) || payload["requiredSigner"] !== wallet || view.requiredSigner !== wallet ||
      payload["transactionFormat"] !== "SOLANA_V0_WIRE_TRANSACTION_BASE64" || typeof payload["serializedTransactionBase64"] !== "string" ||
      !Number.isSafeInteger(payload["lastValidBlockHeight"]) || Number(payload["lastValidBlockHeight"]) < 0) throw invalid();
  for (const field of ["instrumentId", "tokenPolicy", "cluster", "networkGenesisHash", "programId", "instrumentAddress", "actionAddress", "controlledPolicyAddress", "controlledCaptureAddress", "bondMint"] as const) {
    if (payload[field] !== view[field]) throw invalid();
  }
  const phase = payload["phase"] as CapturePhase;
  const extra: string[] = [];
  if (phase === "FINISH") {
    if (JSON.stringify(payload["investorIds"]) !== JSON.stringify(view.investorIds) || new Set(entitlementInvestorIds).size !== entitlementInvestorIds.length ||
        [...entitlementInvestorIds].sort().join("/") !== [...view.investorIds].sort().join("/")) throw invalid();
    for (const investorId of view.investorIds) {
      const entitlement = await derivedAddress(view.programId, ["entitlement", publicKeyBytes(view.actionAddress), uuidBytes(investorId)]);
      extra.push(entitlement, await unitReservationAddress(view.programId, entitlement));
    }
  }
  const accounts = [wallet, view.instrumentAddress, view.actionAddress, view.controlledPolicyAddress, view.controlledCaptureAddress,
    ...(phase === "BEGIN" ? [SYSTEM_PROGRAM] : extra)];
  requireReviewedTransaction(String(payload["serializedTransactionBase64"]), wallet, [
    { program: COMPUTE_PROGRAM, accounts: [], data: "02801a0600" }, { program: COMPUTE_PROGRAM, accounts: [], data: "030000000000000000" },
    { program: view.programId, accounts, data: await instructionDiscriminator(({ BEGIN: "begin_controlled_capture", FINISH: "finish_controlled_capture", ABORT: "abort_controlled_capture" })[phase]) }
  ], new Set([wallet, view.controlledPolicyAddress, view.controlledCaptureAddress]), invalid);
  return payload as unknown as PreparedCapture;
}

/** Inspect the full snapshot commitment instruction, including each frozen source and its Holding sidecar. */
export async function requireControlledSnapshot(plan: PreparedSnapshot, payload: Record<string, unknown>, view: ControlledCaptureView): Promise<void> {
  const invalid = () => new Error("Снимок держателей не совпадает с начатой фиксацией или счетами облигаций. Подпись остановлена.");
  if (!view.capture || view.capture.finished || plan.corporateActionId !== view.actionId || plan.programId !== view.programId ||
      plan.actionAddress !== view.actionAddress || plan.requiredSigner !== view.requiredSigner || plan.networkGenesisHash !== view.networkGenesisHash ||
      plan.cluster !== view.cluster || plan.effectiveSlot !== view.capture.startedSlot || payload["tokenPolicy"] !== view.tokenPolicy ||
      payload["controlledPolicyAddress"] !== view.controlledPolicyAddress || payload["controlledCaptureAddress"] !== view.controlledCaptureAddress ||
      !Array.isArray(payload["holderTokenAccounts"]) || payload["holderTokenAccounts"].length === 0 || payload["holderTokenAccounts"].length > 64 ||
      new Set(payload["holderTokenAccounts"]).size !== payload["holderTokenAccounts"].length || !payload["holderTokenAccounts"].every(key)) throw invalid();
  const sources = payload["holderTokenAccounts"] as string[];
  const extra: string[] = [];
  for (const source of sources) extra.push(source, await controlledHoldingAddress(view.programId, view.instrumentAddress, source));
  const investorCount = payload["investorCount"], walletCount = payload["walletCount"], totalBalance = payload["totalBalance"], mintSupply = payload["mintSupply"];
  if (!Number.isSafeInteger(investorCount) || Number(investorCount) < 1 || !Number.isSafeInteger(walletCount) || Number(walletCount) < Number(investorCount) ||
      typeof totalBalance !== "string" || typeof mintSupply !== "string" || totalBalance !== mintSupply || !/^[1-9][0-9]*$/.test(totalBalance)) throw invalid();
  requireReviewedTransaction(plan.serializedTransactionBase64, plan.requiredSigner, [
    { program: COMPUTE_PROGRAM, accounts: [], data: "02801a0600" }, { program: COMPUTE_PROGRAM, accounts: [], data: "030000000000000000" },
    { program: view.programId, accounts: [view.requiredSigner, view.instrumentAddress, view.actionAddress, view.controlledPolicyAddress, view.controlledCaptureAddress, view.bondMint, TOKEN_PROGRAM, ...extra],
      data: await instructionDiscriminator("record_controlled_snapshot") + plan.snapshotHash + unsignedHex(plan.effectiveSlot) + unsignedHex(Number(investorCount), 4) + unsignedHex(Number(walletCount), 4) + unsignedHex(totalBalance) + unsignedHex(mintSupply) }
  ], new Set([view.requiredSigner, view.actionAddress, view.controlledCaptureAddress]), invalid);
}
