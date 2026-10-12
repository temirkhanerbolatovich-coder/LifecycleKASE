import assert from "node:assert/strict";
import test from "node:test";
import { buildProgramUpgrade, serializeUnsignedInstructionsTransaction } from "@lifecycle-kase/solana-client";
import { preparedProgramUpgrade, recoverProgramUpgrade } from "./program-upgrade-workflow";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const WALLET = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const BUFFER = "QZYBisMjqfcWA2Vk4Ygvt8SZ4Vt9rTXfnmu6DkrKFh6";
const GENESIS = "B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF";
async function fixture(phase: "EXTEND" | "UPGRADE") {
  const instruction = await buildProgramUpgrade({ phase, programId: PROGRAM, bufferAddress: BUFFER, authority: WALLET,
    currentProgramCapacity: phase === "EXTEND" ? 100 : 10340, candidateBytes: 101 });
  const report = { programId: PROGRAM, programData: instruction.programData, upgradeAuthority: WALLET, genesisHash: GENESIS,
    currentProgramCapacity: phase === "EXTEND" ? 100 : 10340, additionalBytes: instruction.additionalBytes, deployedAtSlot: "2", extensionRentLamports: 100,
    candidateSha256: "a".repeat(64), retainedSha256: "b".repeat(64), candidateBytes: 101 };
  const payload = { ...report, operationId: "00000000-0000-4000-8000-000000000001", maintenanceId: "00000000-0000-4000-8000-000000000002",
    phase, cluster: "localnet", requiredSigner: WALLET, feePayer: WALLET, spillAddress: WALLET, networkGenesisHash: GENESIS,
    bufferAddress: BUFFER,
    phaseFeeLamports: 5000, feeReserveLamports: 5000000, lastValidBlockHeight: 1000, status: "PREPARED", signature: null,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", serializedTransactionBase64: serializeUnsignedInstructionsTransaction({
      instructions: instruction.instructions, feePayer: WALLET, recentBlockhash: GENESIS, lastValidBlockHeight: 1000 }) };
  return { payload, report, instruction };
}
test("browser accepts exact production EXTEND and UPGRADE instructions with single owner fee payer", async () => {
  for (const phase of ["EXTEND", "UPGRADE"] as const) {
    const f = await fixture(phase); assert.equal(preparedProgramUpgrade(f.payload, f.report, WALLET).phase, phase);
  }
});
test("browser rejects substituted network, amount, buffer, authority and extra loader instructions before wallet signing", async () => {
  const f = await fixture("EXTEND");
  for (const change of [{ cluster: "devnet" }, { networkGenesisHash: BUFFER }, { programId: BUFFER }, { bufferAddress: PROGRAM },
    { additionalBytes: 1 }, { feePayer: BUFFER }, { candidateSha256: "c".repeat(64) }, { phase: "UPGRADE" }, { status: "UNKNOWN_CONFIRMATION" }]) {
    assert.throws(() => preparedProgramUpgrade({ ...f.payload, ...change }, f.report, WALLET));
  }
  const changed = Buffer.from(f.payload.serializedTransactionBase64, "base64"); changed[changed.length - 2]! ^= 1;
  assert.throws(() => preparedProgramUpgrade({ ...f.payload, serializedTransactionBase64: changed.toString("base64") }, f.report, WALLET));
  const added = serializeUnsignedInstructionsTransaction({ instructions: [...f.instruction.instructions, ...f.instruction.instructions],
    feePayer: WALLET, recentBlockhash: GENESIS, lastValidBlockHeight: 1000 });
  assert.throws(() => preparedProgramUpgrade({ ...f.payload, serializedTransactionBase64: added }, f.report, WALLET));
});
test("a local signature survives a lost HTTP request and stale state as confirmation-only; conflicting signatures block recovery", async () => {
  const f = await fixture("EXTEND"); const signature = "N".repeat(88);
  const changedState = { ...f.report, currentProgramCapacity: 10340, additionalBytes: 0, deployedAtSlot: "5" };
  assert.throws(() => preparedProgramUpgrade(f.payload, changedState, WALLET));
  const restored = recoverProgramUpgrade(f.payload, changedState, WALLET, signature);
  assert.equal(restored.signature, signature); assert.equal(restored.status, "UNKNOWN_CONFIRMATION");
  assert.throws(() => recoverProgramUpgrade({ ...f.payload, signature: "M".repeat(88), status: "SUBMITTED" }, f.report, WALLET, signature));
});
