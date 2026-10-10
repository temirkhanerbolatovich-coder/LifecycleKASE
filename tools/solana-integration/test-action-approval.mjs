import assert from "node:assert/strict";
import anchor from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction, createMintToInstruction,
  createTransferCheckedInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { buildActionApproval, decodeApprovalPolicy, decodeActionReserve, decodeConfirmedCorporateAction,
  buildCalculationReset, buildCorporateActionSchedule, buildSnapshotRegistrationInstruction,
  buildEntitlementRegistration, buildCalculationFinalization } from "../../packages/solana-client/dist/index.js";
import { testCouponExecution } from "./test-coupon-execution.mjs";

/** Disposable validator acceptance. All keys, tokens and ledger state belong to this harness. */
export async function testActionApproval({ connection, program, issuer, calculationAuthority, instrumentId,
  actionId, mintAddress, bondMint, allocations, investorIds, send, sendPreparedInstructions }) {
  const approver = Keypair.generate(); const foreign = Keypair.generate();
  await send(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: approver.publicKey, lamports: 100_000_000 }));
  const input = { programId: program.programId.toBase58(), instrumentId, actionId, issuer: issuer.publicKey.toBase58(),
    approver: approver.publicKey.toBase58(), settlementMint: mintAddress, networkReserveLamports: 50_000_000n,
    snapshotHash: "ef".repeat(32), amountMinor: 1_750_000_000n };
  const plan = phase => buildActionApproval({ ...input, phase });
  const assignment = await plan("ASSIGN_APPROVER");
  const pk = value => new PublicKey(value);
  const failure = pattern => error => pattern.test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`);
  const read = async address => (await connection.getAccountInfo(pk(address), "finalized"));
  const chain = async () => decodeConfirmedCorporateAction((await read(assignment.actionAddress)).data.toString("base64"));
  const beforeAction = await chain();
  for (const invalid of [issuer.publicKey, calculationAuthority]) {
    const instruction = await program.methods.assignApprover(invalid, new anchor.BN(50_000_000)).accountsStrict({
      issuer: issuer.publicKey, instrument: pk(assignment.instrumentAddress), approvalPolicy: pk(assignment.approvalPolicyAddress), systemProgram: SystemProgram.programId }).instruction();
    await assert.rejects(send(instruction), failure(/InvalidApprover/));
    assert.equal(await read(assignment.approvalPolicyAddress), null);
  }
  const anchorAssignment = await program.methods.assignApprover(approver.publicKey, new anchor.BN(50_000_000)).accountsStrict({
    issuer: issuer.publicKey, instrument: pk(assignment.instrumentAddress), approvalPolicy: pk(assignment.approvalPolicyAddress), systemProgram: SystemProgram.programId }).instruction();
  assert.deepEqual(Buffer.from(assignment.instruction.data), anchorAssignment.data);
  assert.deepEqual(assignment.instruction.accounts.map(a => [a.address, a.isSigner, a.isWritable]), anchorAssignment.keys.map(a => [a.pubkey.toBase58(), a.isSigner, a.isWritable]));
  await sendPreparedInstructions([assignment.instruction]);
  assert.equal(decodeApprovalPolicy((await read(assignment.approvalPolicyAddress)).data.toString("base64")).approver, input.approver);
  await assert.rejects(sendPreparedInstructions([assignment.instruction]));
  const funding = await plan("RESERVE"); const approval = await plan("APPROVE"); const refund = await plan("RELEASE");
  for (const [phase, built, method] of [["RESERVE", funding, "fundActionReserve"], ["APPROVE", approval, "approveAction"], ["RELEASE", refund, "releaseActionReserve"]]) {
    const keys = { issuer: issuer.publicKey, approver: approver.publicKey, instrument: pk(built.instrumentAddress), approvalPolicy: pk(built.approvalPolicyAddress),
      corporateAction: pk(built.actionAddress), actionReserve: pk(built.reserveAddress), reserveVault: pk(built.vaultAddress), issuerTreasury: pk(built.treasuryAddress),
      settlementMint: pk(mintAddress), token2022Program: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId };
    const names = phase === "APPROVE" ? ["approver", "instrument", "approvalPolicy", "corporateAction", "actionReserve", "reserveVault", "token2022Program"] :
      ["issuer", "instrument", ...(phase === "RESERVE" ? ["approvalPolicy"] : []), "corporateAction", "actionReserve", "reserveVault", "issuerTreasury", "settlementMint", "token2022Program", ...(phase === "RESERVE" ? ["systemProgram"] : [])];
    const instruction = await program.methods[method](Array(32).fill(239), new anchor.BN(1_750_000_000)).accountsStrict(Object.fromEntries(names.map(name => [name, keys[name]]))).instruction();
    assert.deepEqual(Buffer.from(built.instruction.data), instruction.data);
    assert.deepEqual(built.instruction.accounts.map(a => [a.address, a.isSigner, a.isWritable]), instruction.keys.map(a => [a.pubkey.toBase58(), a.isSigner, a.isWritable]));
  }
  await assert.rejects(sendPreparedInstructions([approval.instruction], approver));
  const treasury = getAssociatedTokenAddressSync(pk(mintAddress), issuer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  await send(createAssociatedTokenAccountInstruction(issuer.publicKey, treasury, issuer.publicKey, pk(mintAddress), TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(pk(mintAddress), treasury, issuer.publicKey, 1_750_000_000n, [], TOKEN_2022_PROGRAM_ID));
  for (const changed of [{ amountMinor: 1_749_999_999n }, { snapshotHash: "ab".repeat(32) }]) {
    const bad = await buildActionApproval({ ...input, phase: "RESERVE", ...changed });
    await assert.rejects(sendPreparedInstructions([bad.instruction]), failure(/InvalidActionReserve/));
    assert.equal(await read(funding.reserveAddress), null); assert.equal(await read(funding.vaultAddress), null);
  }
  const wrongIssuer = await buildActionApproval({ ...input, phase: "RESERVE", issuer: approver.publicKey.toBase58(), approver: foreign.publicKey.toBase58() });
  const approverTreasury = getAssociatedTokenAddressSync(pk(mintAddress), approver.publicKey, false, TOKEN_2022_PROGRAM_ID);
  await send(createAssociatedTokenAccountInstruction(issuer.publicKey, approverTreasury, approver.publicKey, pk(mintAddress), TOKEN_2022_PROGRAM_ID));
  await assert.rejects(sendPreparedInstructions([wrongIssuer.instruction], approver), failure(/UnauthorizedIssuer/));
  await sendPreparedInstructions([funding.instruction]);
  const vaultAccount = await read(funding.vaultAddress); const reserveAccount = await read(funding.reserveAddress);
  assert.equal(vaultAccount.data.length, 165); assert.equal(reserveAccount.data.length, 187);
  assert.equal((await getAccount(connection, pk(funding.vaultAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, input.amountMinor);
  assert.equal((await getAccount(connection, treasury, "finalized", TOKEN_2022_PROGRAM_ID)).amount, 0n);
  assert.equal(decodeActionReserve(reserveAccount.data.toString("base64")).approvedAt, null);
  assert.equal((await chain()).status, "RESERVED");
  const reset = await buildCalculationReset({ ...input, corporateActionAuthority: issuer.publicKey.toBase58(), investorIds });
  await assert.rejects(sendPreparedInstructions([reset.instruction]), failure(/InvalidActionStatus/));
  await assert.rejects(send(createTransferCheckedInstruction(pk(funding.vaultAddress), pk(mintAddress), treasury, issuer.publicKey, 1n, 6, [], TOKEN_2022_PROGRAM_ID)));
  await assert.rejects(send(createCloseAccountInstruction(pk(funding.vaultAddress), issuer.publicKey, issuer.publicKey, [], TOKEN_2022_PROGRAM_ID)));
  console.log("PASS approval wires match Anchor; separate immutable authority, exact custody and funded-reset guards");

  // Same instrument, second action: the first reserve cannot also fund this action.
  const secondId = new Uint8Array(16).fill(219); const nowSlot = await connection.getSlot("finalized");
  const recordAt = BigInt(Math.max(Math.floor(Date.now() / 1000), await connection.getBlockTime(nowSlot))) + 25n;
  const secondSchedule = await buildCorporateActionSchedule({ ...input, actionId: secondId, issuerAuthority: input.issuer, type: "COUPON_PAYMENT", recordAt, executeAt: recordAt + 3600n,
    redemptionPercentageBps: null, redemptionPriceMinor: null });
  await sendPreparedInstructions([secondSchedule.instruction]);
  // Scheduling may outlive the validator's history window; capture a fresh finalized slot.
  let snapshotSlot = await connection.getSlot("finalized");
  const deadline = Date.now() + 90_000;
  while ((await connection.getBlockTime(snapshotSlot)) < Number(recordAt) + 1) {
    if (Date.now() > deadline) throw new Error("Second reserve test record date timed out");
    await new Promise(resolve => setTimeout(resolve, 250)); snapshotSlot = await connection.getSlot("finalized");
  }
  const secondSnapshot = await buildSnapshotRegistrationInstruction({ ...input, actionId: secondId, issuerAuthority: input.issuer, bondMint,
    snapshotSlot: BigInt(snapshotSlot), investorCount: 3, walletCount: 3, totalBalance: 35n, mintSupply: 35n });
  await sendPreparedInstructions([secondSnapshot]);
  for (const [index, row] of allocations.entries()) {
    const entitlement = await buildEntitlementRegistration({ ...input, actionId: secondId, corporateActionAuthority: input.issuer,
      investorId: investorIds[index], settlementWallet: row.walletAddress, balanceAtSnapshot: row.amount, eligible: true, paymentAmountMinor: row.amount * 50_000_000n, tokensToRedeem: 0n });
    await sendPreparedInstructions([entitlement.instruction]);
  }
  const secondFinalization = await buildCalculationFinalization({ ...input, actionId: secondId, corporateActionAuthority: input.issuer, investorIds });
  await sendPreparedInstructions([secondFinalization.instruction]);
  const secondFund = await buildActionApproval({ ...input, actionId: secondId, phase: "RESERVE" });
  await assert.rejects(sendPreparedInstructions([secondFund.instruction]));
  assert.equal(await read(secondFund.reserveAddress), null); assert.equal(await read(secondFund.vaultAddress), null);
  const foreignReserve = { ...approval.instruction, accounts: approval.instruction.accounts.map(a => a.address === approval.reserveAddress ? { ...a, address: secondFund.reserveAddress } : a) };
  await assert.rejects(sendPreparedInstructions([foreignReserve], approver));
  console.log("PASS the same treasury balance cannot fund two independent action reserves; foreign PDA rejected");

  // Unsolicited tokens are refunded too; both accounts close and rent returns to issuer.
  await send(createMintToInstruction(pk(mintAddress), treasury, issuer.publicKey, 7n, [], TOKEN_2022_PROGRAM_ID),
    createTransferCheckedInstruction(treasury, pk(mintAddress), pk(funding.vaultAddress), issuer.publicKey, 7n, 6, [], TOKEN_2022_PROGRAM_ID));
  const lamportsBefore = await connection.getBalance(issuer.publicKey, "finalized");
  const receipt = await sendPreparedInstructions([refund.instruction]);
  assert.equal(await read(funding.reserveAddress), null); assert.equal(await read(funding.vaultAddress), null);
  assert.equal((await getAccount(connection, treasury, "finalized", TOKEN_2022_PROGRAM_ID)).amount, input.amountMinor + 7n);
  assert.equal(await connection.getBalance(issuer.publicKey, "finalized"), lamportsBefore + vaultAccount.lamports + reserveAccount.lamports - receipt.finalized.meta.fee);
  assert.equal((await chain()).status, "UNDER_REVIEW");
  await sendPreparedInstructions([funding.instruction]);
  const wrongApprover = { ...approval.instruction, accounts: approval.instruction.accounts.map((a, i) => i === 0 ? { ...a, address: input.issuer } : a) };
  await assert.rejects(sendPreparedInstructions([wrongApprover]), failure(/UnauthorizedApprover/));
  const poorApprover = await connection.getBalance(approver.publicKey, "finalized");
  const spend = await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({
    fromPubkey: approver.publicKey, toPubkey: issuer.publicKey, lamports: poorApprover - 20_000_000 })), [issuer, approver], { commitment: "finalized" });
  assert.ok(spend);
  await assert.rejects(sendPreparedInstructions([approval.instruction], approver), failure(/InvalidApprovalBudget/));
  await send(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: approver.publicKey, lamports: 50_000_000 }));
  await sendPreparedInstructions([approval.instruction], approver);
  const approved = await chain();
  assert.deepEqual({ ...approved, status: beforeAction.status }, beforeAction);
  assert.equal(approved.status, "APPROVED");
  const reserve = decodeActionReserve((await read(funding.reserveAddress)).data.toString("base64"));
  assert.equal(reserve.approvedBy, input.approver); assert.ok(reserve.approvedAt > 0n);
  await assert.rejects(sendPreparedInstructions([refund.instruction]), failure(/InvalidActionStatus/));
  await assert.rejects(sendPreparedInstructions([approval.instruction], approver), failure(/InvalidActionStatus/));
  assert.equal((await getAccount(connection, pk(funding.vaultAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, input.amountMinor);
  console.log("PASS full pre-approval refund/rent, re-reserve, approver SOL gate, finalized approval and replay/refund rejection");
  if (process.env.COUPON_ACCEPTANCE === "true") await testCouponExecution({ connection, program, issuer,
    input: { ...input, treasuryAddress: funding.treasuryAddress }, allocations, investorIds, bondMint, sendPreparedInstructions });
}
