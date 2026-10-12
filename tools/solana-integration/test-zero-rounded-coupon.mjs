import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction, createMintToInstruction,
  getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { buildInstrumentMintSetup, buildInstrumentDistribution, buildInstrumentInitialization,
  buildInstrumentActivation, buildCorporateActionSchedule, buildSnapshotRegistrationInstruction,
  buildEntitlementRegistration, buildCalculationFinalization, buildCalculationReset,
  buildActionApproval, buildCouponExecution, buildCouponFinalization,
  decodeConfirmedEntitlement, decodeConfirmedCorporateAction, decodeActionReceipt, decodeEntitlementReceipt
} from "../../packages/solana-client/dist/index.js";

/** Generated keys and instruments are confined to the fresh disposable demo validator. */
export async function testZeroRoundedCoupon({ connection, program, issuer, send, sendPreparedInstructions }) {
  const programId = program.programId.toBase58(); const authority = issuer.publicKey.toBase58();
  const pk = value => new PublicKey(value);
  const read = async address => connection.getAccountInfo(pk(address), "finalized");
  const clock = async () => BigInt(await connection.getBlockTime(await connection.getSlot("finalized")));
  const approver = Keypair.generate();
  await send(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: approver.publicKey, lamports: 100_000_000 }));

  for (const [caseIndex, rate] of [1, 1000].entries()) {
    const instrumentId = new Uint8Array(16).fill(241 + caseIndex);
    const actionId = new Uint8Array(16).fill(243 + caseIndex);
    const investorIds = [1, 2, 3].map(value => new Uint8Array(16).fill(value));
    const snapshotHash = String(caseIndex + 7).repeat(64);
    const identity = { programId, instrumentId, actionId, corporateActionAuthority: authority };
    const setup = await buildInstrumentMintSetup({ programId, instrumentId, administrator: authority, totalSupply: 35n,
      bondRentLamports: BigInt(await connection.getMinimumBalanceForRentExemption(202)),
      settlementRentLamports: BigInt(await connection.getMinimumBalanceForRentExemption(82)) });
    await sendPreparedInstructions(setup.instructions);
    const distribution = await buildInstrumentDistribution({ administrator: authority, bondMint: setup.bondMint,
      allocations: [10n, 20n, 5n].map(amount => ({ walletAddress: Keypair.generate().publicKey.toBase58(), amount })) });
    await sendPreparedInstructions(distribution.instructions);
    const initialized = await buildInstrumentInitialization({ programId, instrumentId, administrator: authority,
      bondMint: setup.bondMint, settlementMint: setup.settlementMint, complianceAuthority: authority,
      corporateActionAuthority: authority, faceValueMinor: 1n, couponRateBps: rate, paymentsPerYear: 1,
      issueAt: 1_700_000_000n, maturityAt: (await clock()) + 3600n, totalSupply: 35n });
    await sendPreparedInstructions([initialized.instruction]);
    const activation = await buildInstrumentActivation({ programId, instrumentId, issuerAuthority: authority,
      bondMint: setup.bondMint, holderTokenAccounts: distribution.allocations.map(row => row.tokenAccount) });
    await sendPreparedInstructions([activation.instruction]);
    const recordAt = (await clock()) + 8n; const executeAt = recordAt + 10n;
    const scheduled = await buildCorporateActionSchedule({ programId, instrumentId, actionId, issuerAuthority: authority,
      type: "COUPON_PAYMENT", recordAt, executeAt, redemptionPercentageBps: null, redemptionPriceMinor: null });
    await sendPreparedInstructions([scheduled.instruction]);
    const deadline = Date.now() + 60_000;
    while (await clock() < recordAt) {
      if (Date.now() > deadline) throw new Error("Disposable zero-coupon record window was not reached");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const snapshot = await buildSnapshotRegistrationInstruction({ programId, instrumentId, actionId, issuerAuthority: authority,
      bondMint: setup.bondMint, snapshotHash, snapshotSlot: BigInt(await connection.getSlot("finalized")),
      investorCount: 3, walletCount: 3, totalBalance: 35n, mintSupply: 35n });
    await sendPreparedInstructions([snapshot]);
    const amounts = distribution.allocations.map(row => row.amount * BigInt(rate) / 10_000n);
    const registrations = [];
    for (const [index, row] of distribution.allocations.entries()) {
      const registration = await buildEntitlementRegistration({ ...identity, investorId: investorIds[index], snapshotHash,
        settlementWallet: row.walletAddress, balanceAtSnapshot: row.amount, eligible: true,
        paymentAmountMinor: amounts[index], tokensToRedeem: 0n });
      await sendPreparedInstructions([registration.instruction]); registrations.push(registration);
      const entitlement = decodeConfirmedEntitlement((await read(registration.entitlementAddress)).data.toString("base64"));
      assert.equal(entitlement.status, amounts[index] === 0n ? "NOT_ELIGIBLE_ZERO_ROUNDING" : "READY");
      assert.equal(entitlement.paymentAmountMinor, amounts[index]); assert.equal(entitlement.executedAt, null);
    }
    const chain = async () => decodeConfirmedCorporateAction((await read(scheduled.actionAddress)).data.toString("base64"));
    const total = amounts.reduce((sum, amount) => sum + amount, 0n);
    assert.equal((await chain()).registeredEntitlements, 3); assert.equal((await chain()).totalAmountMinor, total);
    const finalCalculation = await buildCalculationFinalization({ ...identity, investorIds });
    if (total === 0n) {
      await assert.rejects(sendPreparedInstructions([finalCalculation.instruction]),
        error => /IncompleteCalculation/.test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`));
      assert.equal((await chain()).status, "CALCULATED"); assert.equal((await chain()).processedEntitlements, 0);
      await assert.rejects(buildActionApproval({ ...identity, phase: "RESERVE", issuer: authority,
        approver: approver.publicKey.toBase58(), settlementMint: setup.settlementMint, networkReserveLamports: 5_000_000n,
        snapshotHash, amountMinor: total }));
      const reset = await buildCalculationReset({ ...identity, investorIds });
      await sendPreparedInstructions([reset.instruction]);
      assert.equal((await chain()).status, "SNAPSHOT_CREATED"); assert.equal((await chain()).registeredEntitlements, 0);
      for (const row of registrations) assert.equal(await read(row.entitlementAddress), null);
      console.log("PASS all-zero coupon preserves three skipped rows, rejects calculation finalization/reserve and permits full reset");
      continue;
    }

    assert.deepEqual(amounts, [1n, 2n, 0n]); await sendPreparedInstructions([finalCalculation.instruction]);
    const approvalInput = { programId, instrumentId, actionId, issuer: authority, approver: approver.publicKey.toBase58(),
      settlementMint: setup.settlementMint, networkReserveLamports: 5_000_000n, snapshotHash, amountMinor: total };
    const assignment = await buildActionApproval({ ...approvalInput, phase: "ASSIGN_APPROVER" });
    await sendPreparedInstructions([assignment.instruction]);
    const treasury = getAssociatedTokenAddressSync(pk(setup.settlementMint), issuer.publicKey, false, TOKEN_2022_PROGRAM_ID);
    await send(createAssociatedTokenAccountInstruction(issuer.publicKey, treasury, issuer.publicKey, pk(setup.settlementMint), TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(pk(setup.settlementMint), treasury, issuer.publicKey, total, [], TOKEN_2022_PROGRAM_ID));
    const reserve = await buildActionApproval({ ...approvalInput, phase: "RESERVE" });
    await sendPreparedInstructions([reserve.instruction]);
    assert.equal((await getAccount(connection, pk(reserve.vaultAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, total);
    const approval = await buildActionApproval({ ...approvalInput, phase: "APPROVE" });
    await sendPreparedInstructions([approval.instruction], approver);
    const executionDeadline = Date.now() + 60_000;
    while (await clock() < executeAt) {
      if (Date.now() > executionDeadline) throw new Error("Disposable zero-coupon execute time was not reached");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const payments = await Promise.all(distribution.allocations.map((row, index) => buildCouponExecution({ ...identity,
      investorId: investorIds[index], settlementMint: setup.settlementMint, settlementWallet: row.walletAddress,
      idempotencyHash: String(index + 1).repeat(64) })));
    const final = await buildCouponFinalization({ ...identity, investorIds, receiptHash: "ab".repeat(32) });
    await assert.rejects(sendPreparedInstructions(final.instructions));
    await assert.rejects(sendPreparedInstructions(payments[2].instructions));
    assert.equal(await read(payments[2].entitlementReceiptAddress), null);
    assert.equal(await read(payments[2].recipientAddress), null);
    assert.equal((await chain()).processedEntitlements, 0);
    for (const index of [0, 1]) {
      await sendPreparedInstructions(payments[index].instructions);
      const receipt = decodeEntitlementReceipt((await read(payments[index].entitlementReceiptAddress)).data.toString("base64"));
      assert.equal(receipt.amountMinor, amounts[index]); assert.equal((await chain()).processedEntitlements, index + 1);
      assert.equal((await getAccount(connection, pk(payments[index].recipientAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, amounts[index]);
    }
    await sendPreparedInstructions(final.instructions);
    const receipt = decodeActionReceipt((await read(final.actionReceiptAddress)).data.toString("base64"));
    assert.equal(receipt.amountMinor, 3n); assert.equal(receipt.processedEntitlements, 2);
    assert.equal((await chain()).status, "FINALIZED");
    assert.equal((await getAccount(connection, pk(reserve.vaultAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, 0n);
    assert.equal((await getMint(connection, pk(setup.bondMint), "finalized", TOKEN_2022_PROGRAM_ID)).supply, 35n);
    const zero = decodeConfirmedEntitlement((await read(registrations[2].entitlementAddress)).data.toString("base64"));
    assert.equal(zero.status, "NOT_ELIGIBLE_ZERO_ROUNDING"); assert.equal(zero.executedAt, null);
    await assert.rejects(sendPreparedInstructions(final.instructions));
    console.log("PASS mixed coupon 1/2/0: three registered holders, reserve 3, two paid receipts, zero receiver rollback, processed 2, final receipt and no burn");
  }
}
