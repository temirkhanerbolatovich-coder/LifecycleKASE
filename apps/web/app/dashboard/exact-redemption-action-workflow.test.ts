import assert from "node:assert/strict";
import test from "node:test";
import { buildCorporateActionCancellation, buildCorporateActionSchedule, encodePublicKey,
  serializeUnsignedInstructionsTransaction, type SolanaInstructionPlan } from "@lifecycle-kase/solana-client";
import { preparedActionPlan, requireCorporateActionTransaction, type CorporateActionView, type PreparedAction } from "./action-workflow";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const ACTION_ID = "00000000-0000-4000-8000-000000000001";
const INSTRUMENT_ID = "00000000-0000-4000-8000-000000000002";
const OPERATION_ID = "00000000-0000-4000-8000-000000000003";
const key = (value: number) => encodePublicKey(new Uint8Array(32).fill(value));
const SIGNER = key(3);
const uuidBytes = (value: string) => Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));

async function fixture(phase: "SCHEDULE" | "CANCEL" = "SCHEDULE") {
  const action = { id: ACTION_ID, instrumentId: INSTRUMENT_ID, type: "EARLY_REDEMPTION",
    recordAt: "2026-10-12T10:00:00.000Z", executeAt: "2026-10-12T11:00:00.000Z",
    redemptionAllocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: "7",
    redemptionPercentageBps: null, redemptionPriceMinor: "1000000000",
    instrument: { id: INSTRUMENT_ID, programId: PROGRAM, issuerAuthority: SIGNER, network: "SOLANA_LOCALNET" }
  } as unknown as CorporateActionView;
  const identity = { programId: PROGRAM, instrumentId: uuidBytes(INSTRUMENT_ID), actionId: uuidBytes(ACTION_ID), issuerAuthority: SIGNER };
  const schedule = await buildCorporateActionSchedule({ ...identity, type: "EARLY_REDEMPTION",
    recordAt: BigInt(Date.parse(action.recordAt) / 1000), executeAt: BigInt(Date.parse(action.executeAt) / 1000),
    allocationPolicy: "exact-target-largest-remainder-v2", redemptionPercentageBps: null,
    redemptionPriceMinor: 1_000_000_000n, redemptionTargetTokens: 7n });
  const cancellation = await buildCorporateActionCancellation(identity);
  const instruction = phase === "SCHEDULE" ? schedule.instruction : cancellation.instruction;
  const serialize = (instructions: SolanaInstructionPlan[], options: {
    computeUnitLimit?: number; computeUnitPriceMicroLamports?: bigint;
  } = {}) => serializeUnsignedInstructionsTransaction({ instructions, feePayer: SIGNER,
    recentBlockhash: key(8), lastValidBlockHeight: 100, ...options });
  const payload = { corporateActionId: ACTION_ID, operationId: OPERATION_ID, phase, cluster: "localnet",
    requiredSigner: SIGNER, networkGenesisHash: key(7), programId: PROGRAM,
    instrumentAddress: schedule.instrumentAddress, actionAddress: schedule.actionAddress,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", serializedTransactionBase64: serialize([instruction]),
    lastValidBlockHeight: 100, type: action.type, recordAt: action.recordAt, executeAt: action.executeAt,
    redemptionPercentageBps: null, redemptionPriceMinor: "1000000000",
    redemptionAllocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: "7",
    ...(phase === "SCHEDULE" ? { targetAddress: schedule.targetAddress } : {}),
    reason: phase === "SCHEDULE" ? null : "Synthetic cancellation request" };
  const plan = preparedActionPlan(payload, action, SIGNER);
  return { action, instruction, payload, plan, serialize };
}

test("v2 scheduling and cancellation accept the real client wire and canonical account privileges", async () => {
  for (const phase of ["SCHEDULE", "CANCEL"] as const) {
    const fixtureValue = await fixture(phase);
    await requireCorporateActionTransaction(fixtureValue.plan, fixtureValue.action);
  }
});

test("scheduling rejects altered target, dates, price, action UUID, type and option tags in the actual wire", async () => {
  const f = await fixture();
  for (const offset of [8, 24, 25, 33, 41, 42, 43, 51]) {
    const data = Uint8Array.from(f.instruction.data); data[offset]! ^= 1;
    const wire = f.serialize([{ ...f.instruction, data }]);
    // Metadata still claims the original seven-token obligation.
    const plan = preparedActionPlan({ ...f.payload, serializedTransactionBase64: wire }, f.action, SIGNER);
    await assert.rejects(requireCorporateActionTransaction(plan, f.action));
  }
});

test("scheduling rejects different programs, swapped/omitted accounts and changed writable privileges", async () => {
  const f = await fixture();
  const swapped = [...f.instruction.accounts]; [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
  const instructions: SolanaInstructionPlan[] = [
    { ...f.instruction, programId: key(20) }, { ...f.instruction, accounts: swapped },
    { ...f.instruction, accounts: f.instruction.accounts.slice(0, -1) },
    { ...f.instruction, accounts: f.instruction.accounts.map((account, index) => index === 1 ? { ...account, isWritable: true } : account) },
    { ...f.instruction, accounts: f.instruction.accounts.map((account, index) => index === 3 ? { ...account, isWritable: false } : account) }
  ];
  for (const instruction of instructions) {
    await assert.rejects(requireCorporateActionTransaction({ ...f.plan, serializedTransactionBase64: f.serialize([instruction]) }, f.action));
  }
});

test("v2 review rejects coordinated metadata-and-wire substitutions for program and every canonical PDA", async () => {
  const f = await fixture();
  for (const [field, accountIndex] of [["instrumentAddress", 1], ["actionAddress", 2], ["targetAddress", 3]] as const) {
    const replacement = key(20 + accountIndex);
    const instruction = { ...f.instruction, accounts: f.instruction.accounts.map((account, index) =>
      index === accountIndex ? { ...account, address: replacement } : account) };
    const plan = { ...f.plan, [field]: replacement, serializedTransactionBase64: f.serialize([instruction]) };
    await assert.rejects(requireCorporateActionTransaction(plan, f.action));
  }
  const otherProgram = key(20);
  const other = await buildCorporateActionSchedule({ programId: otherProgram, instrumentId: uuidBytes(INSTRUMENT_ID),
    actionId: uuidBytes(ACTION_ID), issuerAuthority: SIGNER, type: "EARLY_REDEMPTION",
    recordAt: BigInt(Date.parse(f.action.recordAt) / 1000), executeAt: BigInt(Date.parse(f.action.executeAt) / 1000),
    allocationPolicy: "exact-target-largest-remainder-v2", redemptionPercentageBps: null,
    redemptionPriceMinor: 1_000_000_000n, redemptionTargetTokens: 7n });
  await assert.rejects(requireCorporateActionTransaction({ ...f.plan, programId: otherProgram,
    instrumentAddress: other.instrumentAddress, actionAddress: other.actionAddress, targetAddress: other.targetAddress!,
    serializedTransactionBase64: f.serialize([other.instruction]) }, f.action));
});

test("v2 review rejects hidden instructions, priority fees, changed compute budget and cancellation wire tampering", async () => {
  const f = await fixture();
  for (const wire of [f.serialize([f.instruction, f.instruction]),
    f.serialize([f.instruction], { computeUnitPriceMicroLamports: 1n }),
    f.serialize([f.instruction], { computeUnitLimit: 400_001 })]) {
    await assert.rejects(requireCorporateActionTransaction({ ...f.plan, serializedTransactionBase64: wire }, f.action));
  }
  const cancel = await fixture("CANCEL");
  const data = Uint8Array.from(cancel.instruction.data); data[0]! ^= 1;
  await assert.rejects(requireCorporateActionTransaction({ ...cancel.plan,
    serializedTransactionBase64: cancel.serialize([{ ...cancel.instruction, data }]) }, cancel.action));
  const changedAccount = { ...cancel.instruction, accounts: cancel.instruction.accounts.map((account, index) =>
    index === 2 ? { ...account, address: key(20) } : account) };
  await assert.rejects(requireCorporateActionTransaction({ ...cancel.plan,
    serializedTransactionBase64: cancel.serialize([changedAccount]) }, cancel.action));
});

test("exact review rechecks selected obligation and issuer while keeping legacy review behavior unchanged", async () => {
  const f = await fixture();
  for (const change of [{ redemptionTargetTokens: "8" }, { redemptionAllocationPolicy: "integer-entitlements-v1" },
    { requiredSigner: key(20) }, { corporateActionId: OPERATION_ID }, { phase: "OTHER" }]) {
    await assert.rejects(requireCorporateActionTransaction({ ...f.plan, ...change } as PreparedAction, f.action));
  }
  const legacy = { ...f.action, redemptionAllocationPolicy: "integer-entitlements-v1" as const,
    redemptionTargetTokens: null, redemptionPercentageBps: 2000 };
  await requireCorporateActionTransaction({ ...f.plan, serializedTransactionBase64: "legacy API contract unchanged" }, legacy);
});
