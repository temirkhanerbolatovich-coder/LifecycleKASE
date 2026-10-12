import assert from "node:assert/strict";
import anchor from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getAccount, getMint, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { buildCouponExecution, buildCouponFinalization, decodeConfirmedCorporateAction, decodeEntitlementReceipt, decodeActionReceipt } from "../../packages/solana-client/dist/index.js";

/** All authorities, mints, funds and receipts belong to the disposable test validator. */
export async function testCouponExecution({ connection, program, issuer, input, allocations, investorIds, bondMint, sendPreparedInstructions }) {
  const pk = value => new PublicKey(value);
  const read = async address => (await connection.getAccountInfo(pk(address), "finalized"));
  const identity = { programId: input.programId, instrumentId: input.instrumentId, actionId: input.actionId, corporateActionAuthority: input.issuer };
  const plans = await Promise.all(allocations.map((row, index) => buildCouponExecution({ ...identity, investorId: investorIds[index],
    settlementMint: input.settlementMint, settlementWallet: row.walletAddress, idempotencyHash: String(index + 1).repeat(64) })));
  const chain = async () => decodeConfirmedCorporateAction((await read(plans[0].actionAddress)).data.toString("base64"));
  const bondSupply = (await getMint(connection, pk(bondMint), "finalized", TOKEN_2022_PROGRAM_ID)).supply;
  const first = plans[0];
  const anchorInstruction = await program.methods.executeCoupon(Array(32).fill(17)).accountsStrict({
    corporateActionAuthority: issuer.publicKey, instrument: pk(first.instrumentAddress), approvalPolicy: pk(first.approvalPolicyAddress),
    corporateAction: pk(first.actionAddress), actionReserve: pk(first.reserveAddress), reserveVault: pk(first.vaultAddress),
    entitlement: pk(first.entitlementAddress), entitlementReceipt: pk(first.entitlementReceiptAddress), recipient: pk(first.recipientAddress),
    settlementMint: pk(input.settlementMint), token2022Program: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction();
  assert.deepEqual(Buffer.from(first.instruction.data), anchorInstruction.data);
  assert.deepEqual(first.instruction.accounts.map(a => [a.address, a.isSigner, a.isWritable]), anchorInstruction.keys.map(a => [a.pubkey.toBase58(), a.isSigner, a.isWritable]));
  const before = await chain();
  const now = await connection.getBlockTime(await connection.getSlot("finalized"));
  const prematureAttemptTested = BigInt(now) < before.executeAt;
  if (prematureAttemptTested) {
    await assert.rejects(sendPreparedInstructions(first.instructions));
    assert.equal(await read(first.entitlementReceiptAddress), null);
    assert.equal((await chain()).processedEntitlements, 0);
  }
  const deadline = Date.now() + 150_000;
  while (BigInt(await connection.getBlockTime(await connection.getSlot("finalized"))) < before.executeAt) {
    if (Date.now() > deadline) throw new Error("Disposable coupon execute_at was not reached");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const final = await buildCouponFinalization({ ...identity, investorIds, receiptHash: "ab".repeat(32) });
  await assert.rejects(sendPreparedInstructions(final.instructions));
  assert.equal(await read(final.actionReceiptAddress), null);
  const wrongReceiver = { ...first.instruction, accounts: first.instruction.accounts.map((value, index) => index === 8 ? { ...value, address: input.treasuryAddress } : value) };
  await assert.rejects(sendPreparedInstructions([first.instructions[0], wrongReceiver]));
  assert.equal(await read(first.entitlementReceiptAddress), null);
  assert.equal((await chain()).processedEntitlements, 0);
  const signatures = [];
  for (const [index, plan] of plans.entries()) {
    const result = await sendPreparedInstructions(plan.instructions); signatures.push(result.signature);
    const receipt = decodeEntitlementReceipt((await read(plan.entitlementReceiptAddress)).data.toString("base64"));
    const expected = allocations[index].amount * 50_000_000n;
    assert.equal(receipt.amountMinor, expected); assert.equal(receipt.settlementWallet, allocations[index].walletAddress);
    assert.equal((await getAccount(connection, pk(plan.recipientAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, expected);
    assert.equal((await chain()).processedEntitlements, index + 1);
    await assert.rejects(sendPreparedInstructions(plan.instructions));
    const differentKey = await buildCouponExecution({ ...identity, investorId: investorIds[index], settlementMint: input.settlementMint,
      settlementWallet: allocations[index].walletAddress, idempotencyHash: "cd".repeat(32) });
    await assert.rejects(sendPreparedInstructions(differentKey.instructions));
    assert.equal((await getAccount(connection, pk(plan.recipientAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, expected);
  }
  const finalInstruction = await program.methods.finalizeCoupon(Array(32).fill(171)).accountsStrict({
    corporateActionAuthority: issuer.publicKey, instrument: pk(final.instrumentAddress), corporateAction: pk(final.actionAddress),
    actionReceipt: pk(final.actionReceiptAddress), systemProgram: SystemProgram.programId }).remainingAccounts(final.instruction.accounts.slice(5)
      .map(a => ({ pubkey: pk(a.address), isSigner: a.isSigner, isWritable: a.isWritable }))).instruction();
  assert.deepEqual(Buffer.from(final.instruction.data), finalInstruction.data);
  assert.deepEqual(final.instruction.accounts.map(a => [a.address, a.isSigner, a.isWritable]), finalInstruction.keys.map(a => [a.pubkey.toBase58(), a.isSigner, a.isWritable]));
  await sendPreparedInstructions(final.instructions);
  assert.equal((await chain()).status, "FINALIZED");
  const receipt = decodeActionReceipt((await read(final.actionReceiptAddress)).data.toString("base64"));
  assert.equal(receipt.receiptHash, "ab".repeat(32)); assert.equal(receipt.amountMinor, 1_750_000_000n); assert.equal(receipt.processedEntitlements, 3);
  assert.equal((await getAccount(connection, pk(first.vaultAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, 0n);
  assert.equal((await getMint(connection, pk(bondMint), "finalized", TOKEN_2022_PROGRAM_ID)).supply, bondSupply);
  await assert.rejects(sendPreparedInstructions(final.instructions));
  console.log("PASS real coupon transfers 500/1000/250; exact Anchor wires, incomplete/wrong-receiver rollback, same and different-key replay denial, three immutable receipts, no bond burn, final action hash and zero vault", JSON.stringify({ signatures, actionReceipt: final.actionReceiptAddress, prematureAttemptTested }));
}
