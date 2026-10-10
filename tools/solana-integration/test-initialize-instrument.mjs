import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { buildSnapshotRegistrationInstruction, buildInstrumentMintSetup, buildInstrumentDistribution,
  buildInstrumentInitialization, buildInstrumentActivation, serializeUnsignedInstructionsTransaction,
  verifySignedPreparedTransaction, verifyFinalizedTransaction, buildCorporateActionSchedule,
  buildCorporateActionCancellation, decodeConfirmedCorporateAction, decodeConfirmedSnapshotAccount,
  buildEntitlementRegistration, buildCalculationFinalization, buildCalculationReset } from "../../packages/solana-client/dist/index.js";
import anchor from "@anchor-lang/core";
import { testActionApproval } from "./test-action-approval.mjs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  ExtensionType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  getMint,
  getAccount,
  getPermanentDelegate,
} from "@solana/spl-token";

const { BN, Program } = anchor;

const rpcUrl = process.argv[2];
if (!rpcUrl || !/^http:\/\/(127\.0\.0\.1|localhost|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):\d+$/.test(rpcUrl)) {
  throw new Error("A loopback or private WSL HTTP validator URL is required as the first argument");
}
const administratorKeyPath = process.argv[3];
if (!administratorKeyPath) {
  throw new Error("A disposable local administrator keypair path is required");
}

const idlPath = process.argv[4]
  ?? fileURLToPath(new URL("../../target/idl/lifecycle_kase.json", import.meta.url));
const upgradeHookDirectory = process.argv[5] || null;
const idl = JSON.parse(await readFile(idlPath, "utf8"));
const programId = new PublicKey(idl.address);
const connection = new Connection(rpcUrl, "finalized");
const administrator = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(await readFile(administratorKeyPath, "utf8"))),
);
const outsider = Keypair.generate();
const calculationAuthority = Keypair.generate();
const upgradeableLoader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const [programData] = PublicKey.findProgramAddressSync(
  [programId.toBuffer()], upgradeableLoader,
);
const instrumentId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const [instrumentAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("instrument"), instrumentId],
  programId,
);
const [instrumentAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("instrument-authority"), instrumentAddress.toBuffer()],
  programId,
);
const program = new Program(idl, { connection });

async function waitForDisposableUpgrade() {
  if (!upgradeHookDirectory) return;
  const before = await connection.getAccountInfo(wireSnapshotActionAddress, "finalized");
  assert.ok(before, "The pre-upgrade Action PDA must exist");
  await writeFile(`${upgradeHookDirectory}/upgrade.request`, "upgrade retained program\n", { flag: "wx" });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      await access(`${upgradeHookDirectory}/upgrade.success`);
      const after = await connection.getAccountInfo(wireSnapshotActionAddress, "finalized");
      assert.ok(after, "The Action PDA must still exist after the upgrade");
      assert.deepEqual(after.data, before.data, "The upgrade must not mutate existing Action PDA bytes");
      assert.equal(after.owner.toBase58(), programId.toBase58());
      assert.deepEqual(
        Object.keys((await program.account.corporateAction.fetch(wireSnapshotActionAddress)).status),
        ["snapshotCreated"],
      );
      console.log("PASS retained-program upgrade preserves an existing SNAPSHOT_CREATED Action PDA byte-for-byte");
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    try {
      await access(`${upgradeHookDirectory}/upgrade.failed`);
      throw new Error("Disposable program upgrade failed; inspect the validator wrapper logs");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Disposable program upgrade did not finish within 180 seconds");
}

async function sendWith(signer, ...instructions) {
  return sendAndConfirmTransaction(
    connection,
    new Transaction().add(...instructions),
    [signer],
    { commitment: "finalized" },
  );
}

async function send(...instructions) {
  return sendWith(administrator, ...instructions);
}

async function createMint(decimals, permanentDelegate = null) {
  const mint = Keypair.generate();
  const space = permanentDelegate ? getMintLen([ExtensionType.PermanentDelegate]) : MINT_SIZE;
  const lamports = await connection.getMinimumBalanceForRentExemption(space);
  const instructions = [
    SystemProgram.createAccount({
      fromPubkey: administrator.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports,
      space,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ];
  if (permanentDelegate) {
    instructions.push(createInitializePermanentDelegateInstruction(
      mint.publicKey,
      permanentDelegate,
      TOKEN_2022_PROGRAM_ID,
    ));
  }
  instructions.push(createInitializeMintInstruction(
    mint.publicKey,
    decimals,
    administrator.publicKey,
    null,
    TOKEN_2022_PROGRAM_ID,
  ));
  await sendAndConfirmTransaction(connection, new Transaction().add(...instructions),
    [administrator, mint], { commitment: "finalized" });
  return mint.publicKey;
}

async function createBondMint(delegate, revokeMintAuthority) {
  const mint = await createMint(0, delegate);
  const tokenAccount = getAssociatedTokenAddressSync(
    mint, administrator.publicKey, false, TOKEN_2022_PROGRAM_ID,
  );
  const instructions = [
    createAssociatedTokenAccountInstruction(
      administrator.publicKey, tokenAccount, administrator.publicKey, mint,
      TOKEN_2022_PROGRAM_ID,
    ),
    createMintToInstruction(
      mint, tokenAccount, administrator.publicKey, 35, [], TOKEN_2022_PROGRAM_ID,
    ),
  ];
  if (revokeMintAuthority) {
    instructions.push(createSetAuthorityInstruction(
      mint, administrator.publicKey, AuthorityType.MintTokens, null, [],
      TOKEN_2022_PROGRAM_ID,
    ));
  }
  await send(...instructions);
  return mint;
}

function terms(id = instrumentId, supply = 35) {
  return {
    instrumentId: [...id],
    complianceAuthority: Keypair.generate().publicKey,
    corporateActionAuthority: calculationAuthority.publicKey,
    faceValueMinor: new BN(100_000),
    couponRateBps: 1_000,
    paymentsPerYear: 2,
    issueAt: new BN(1_700_000_000),
    maturityAt: new BN(1_800_000_000),
    totalSupply: new BN(supply),
  };
}

async function initialize(bondMint, settlementMint, id = instrumentId, supply = 35, signer = administrator) {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("instrument"), id], programId,
  );
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("instrument-authority"), address.toBuffer()], programId,
  );
  const instruction = await program.methods.initializeInstrument(terms(id, supply))
    .accountsStrict({
      administrator: signer.publicKey,
      program: programId,
      programData,
      instrument: address,
      instrumentAuthority: authority,
      bondMint,
      settlementMint,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return sendWith(signer, instruction);
}

async function createAction(id, actionType, recordAt, executeAt, percentage = null, price = null, signer = administrator) {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("action"), instrumentAddress.toBuffer(), id], programId,
  );
  const instruction = await program.methods.createCorporateAction({
    actionId: [...id],
    actionType,
    recordAt: new BN(recordAt),
    executeAt: new BN(executeAt),
    redemptionPercentageBps: percentage,
    redemptionPriceMinor: price === null ? null : new BN(price),
  }).accountsStrict({
    issuerAuthority: signer.publicKey,
    instrument: instrumentAddress,
    corporateAction: address,
    systemProgram: SystemProgram.programId,
  }).instruction();
  return sendWith(signer, instruction);
}

async function activate(holderAccounts, signer = administrator) {
  const instruction = await program.methods.activateInstrument()
    .accountsStrict({
      issuerAuthority: signer.publicKey,
      instrument: instrumentAddress,
      instrumentAuthority,
      bondMint,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    })
    .remainingAccounts(holderAccounts.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: false,
    })))
    .instruction();
  return sendWith(signer, instruction);
}

async function cancelAction(actionAddress, signer = administrator) {
  const instruction = await program.methods.cancelAction()
    .accountsStrict({
      issuerAuthority: signer.publicKey,
      instrument: instrumentAddress,
      corporateAction: actionAddress,
    })
    .instruction();
  return sendWith(signer, instruction);
}

async function registerSnapshot(actionAddress, slot, hash, supply = 35, signer = administrator) {
  const instruction = await program.methods.registerSnapshot({
    snapshotHash: [...hash],
    snapshotSlot: new BN(slot),
    investorCount: 3,
    walletCount: 3,
    totalBalance: new BN(35),
    mintSupply: new BN(supply),
  }).accountsStrict({
    issuerAuthority: signer.publicKey,
    instrument: instrumentAddress,
    corporateAction: actionAddress,
    instrumentAuthority,
    bondMint,
    token2022Program: TOKEN_2022_PROGRAM_ID,
  }).instruction();
  return sendWith(signer, instruction);
}

const airdrop = await connection.requestAirdrop(administrator.publicKey, 10_000_000_000);
await connection.confirmTransaction(airdrop, "finalized");
const outsiderAirdrop = await connection.requestAirdrop(outsider.publicKey, 1_000_000_000);
await connection.confirmTransaction(outsiderAirdrop, "finalized");

// Exercise the actual application serializer, not only Anchor/SPL-generated instructions.
async function sendPreparedInstructions(instructions, signer = administrator) {
  const latest = await connection.getLatestBlockhash("finalized");
  const unsigned = serializeUnsignedInstructionsTransaction({ instructions,
    feePayer: signer.publicKey.toBase58(), recentBlockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight });
  const transaction = VersionedTransaction.deserialize(Buffer.from(unsigned, "base64"));
  transaction.sign([signer]);
  const signed = transaction.serialize();
  const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: unsigned,
    signedTransactionBase64: Buffer.from(signed).toString("base64"), requiredSigner: signer.publicKey.toBase58() });
  assert.equal(await connection.sendRawTransaction(signed, { skipPreflight: false }), signature);
  const confirmation = await connection.confirmTransaction({ ...latest, signature }, "finalized");
  assert.equal(confirmation.value.err, null);
  const finalized = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  assert.ok(finalized);
  const finalizedWire = new VersionedTransaction(finalized.transaction.message, finalized.transaction.signatures.map(
    value => Uint8Array.from(anchor.utils.bytes.bs58.decode(value))));
  verifyFinalizedTransaction({ expectedUnsignedTransactionBase64: unsigned,
    finalizedTransactionBase64: Buffer.from(finalizedWire.serialize()).toString("base64"),
    requiredSigner: signer.publicKey.toBase58(), signature });
  return { signature, finalized };
}

const wireId = new Uint8Array(16).fill(211);
wireId[6] = 0x43; wireId[8] = 0x93; // A valid UUID-v4 for the optional real API/database acceptance.
const wireIssuer = administrator.publicKey.toBase58();
const wireSetup = await buildInstrumentMintSetup({ programId: programId.toBase58(), instrumentId: wireId,
  administrator: wireIssuer, totalSupply: 35n,
  bondRentLamports: BigInt(await connection.getMinimumBalanceForRentExemption(202)),
  settlementRentLamports: BigInt(await connection.getMinimumBalanceForRentExemption(82)) });
await sendPreparedInstructions(wireSetup.instructions);
const wireMint = await getMint(connection, new PublicKey(wireSetup.bondMint), "finalized", TOKEN_2022_PROGRAM_ID);
assert.equal(wireMint.supply, 35n);
assert.equal(wireMint.decimals, 0);
assert.equal(wireMint.mintAuthority, null);
assert.equal(wireMint.freezeAuthority, null);
assert.equal(getPermanentDelegate(wireMint).delegate.toBase58(), wireSetup.instrumentAuthority);
const wireSettlement = await getMint(connection, new PublicKey(wireSetup.settlementMint), "finalized", TOKEN_2022_PROGRAM_ID);
assert.equal(wireSettlement.decimals, 6);
assert.equal(wireSettlement.supply, 0n);
assert.equal(wireSettlement.mintAuthority.toBase58(), wireIssuer);
assert.equal(wireSettlement.freezeAuthority, null);
console.log("PASS prepared v0 MINT_SETUP finalizes with explicit compute budget, fixed supply and revoked authority");

const wireDistribution = await buildInstrumentDistribution({ administrator: wireIssuer, bondMint: wireSetup.bondMint,
  allocations: [10n, 20n, 5n].map(amount => ({ walletAddress: Keypair.generate().publicKey.toBase58(), amount })) });
await sendPreparedInstructions(wireDistribution.instructions);
for (const allocation of wireDistribution.allocations) {
  const account = await getAccount(connection, new PublicKey(allocation.tokenAccount), "finalized", TOKEN_2022_PROGRAM_ID);
  assert.equal(account.amount, allocation.amount);
  assert.equal(account.owner.toBase58(), allocation.walletAddress);
}
assert.equal((await getAccount(connection, new PublicKey(wireDistribution.treasuryTokenAccount), "finalized", TOKEN_2022_PROGRAM_ID)).amount, 0n);
console.log("PASS prepared v0 DISTRIBUTION finalizes exact 10/20/5 and empty treasury");

const wireInitialization = await buildInstrumentInitialization({ programId: programId.toBase58(), instrumentId: wireId,
  administrator: wireIssuer, bondMint: wireSetup.bondMint, settlementMint: wireSetup.settlementMint,
  complianceAuthority: wireIssuer, corporateActionAuthority: wireIssuer, faceValueMinor: 1_000_000_000n,
  couponRateBps: 1000, paymentsPerYear: 2, issueAt: 1_700_000_000n, maturityAt: 1_800_000_000n, totalSupply: 35n });
await sendPreparedInstructions([wireInitialization.instruction]);
const wireAddress = new PublicKey(wireInitialization.instrumentAddress);
assert.deepEqual(Object.keys((await program.account.instrument.fetch(wireAddress)).status), ["deploying"]);
console.log("PASS prepared v0 INITIALIZE finalizes the expected Deploying PDA");
const wireActivation = await buildInstrumentActivation({ programId: programId.toBase58(), instrumentId: wireId,
  issuerAuthority: wireIssuer, bondMint: wireSetup.bondMint,
  holderTokenAccounts: wireDistribution.allocations.map(allocation => allocation.tokenAccount) });
await sendPreparedInstructions([wireActivation.instruction]);
assert.deepEqual(Object.keys((await program.account.instrument.fetch(wireAddress)).status), ["active"]);
console.log("PASS prepared v0 ACTIVATE finalizes the expected Active PDA");

const wireNow = BigInt(Math.floor(Date.now() / 1000));
for (const [index, type] of ["COUPON_PAYMENT", "BOND_REDEMPTION", "EARLY_REDEMPTION"].entries()) {
  const action = await buildCorporateActionSchedule({ programId: programId.toBase58(), instrumentId: wireId,
    actionId: new Uint8Array(16).fill(212 + index), issuerAuthority: wireIssuer, type,
    recordAt: wireNow + 120n, executeAt: type === "BOND_REDEMPTION" ? 1_800_000_000n : wireNow + 240n,
    redemptionPercentageBps: type === "EARLY_REDEMPTION" ? 2000 : null,
    redemptionPriceMinor: type === "EARLY_REDEMPTION" ? 1_000_000_000n : null });
  await sendPreparedInstructions([action.instruction]);
  const data = await connection.getAccountInfo(new PublicKey(action.actionAddress), "finalized");
  const decoded = decodeConfirmedCorporateAction(data.data.toString("base64"));
  assert.equal(decoded.type, type); assert.equal(decoded.status, "SCHEDULED");
  assert.equal(decoded.recordAt, wireNow + 120n); assert.equal(decoded.instrumentAddress, wireInitialization.instrumentAddress);
  if (type === "EARLY_REDEMPTION") { assert.equal(decoded.redemptionPercentageBps, 2000); assert.equal(decoded.redemptionPriceMinor, 1_000_000_000n); }
  if (index === 0) {
    const cancellation = await buildCorporateActionCancellation({ programId: programId.toBase58(), instrumentId: wireId,
      actionId: new Uint8Array(16).fill(212), issuerAuthority: wireIssuer });
    await sendPreparedInstructions([cancellation.instruction]);
    const cancelled = decodeConfirmedCorporateAction((await connection.getAccountInfo(new PublicKey(action.actionAddress), "finalized")).data.toString("base64"));
    assert.equal(cancelled.status, "CANCELLED"); assert.ok(cancelled.completedAt !== null);
  }
}
console.log("PASS prepared v0 action schedule/cancel: all three types, exact terms and decoded PDA state");

const wireSnapshotId = new Uint8Array(16).fill(215);
const wireRecordAt = BigInt(Math.floor(Date.now() / 1000)) + 8n;
const wireSnapshotAction = await buildCorporateActionSchedule({ programId: programId.toBase58(), instrumentId: wireId,
  actionId: wireSnapshotId, issuerAuthority: wireIssuer, type: "COUPON_PAYMENT", recordAt: wireRecordAt,
  executeAt: wireRecordAt + 120n, redemptionPercentageBps: null, redemptionPriceMinor: null });
const wireSnapshotActionAddress = new PublicKey(wireSnapshotAction.actionAddress);
await sendPreparedInstructions([wireSnapshotAction.instruction]);
let wireSlot;
for (let attempt = 0; attempt < 30; attempt++) {
  wireSlot = await connection.getSlot("finalized");
  const time = await connection.getBlockTime(wireSlot);
  if (time !== null && BigInt(time) >= wireRecordAt) break;
  if (attempt === 29) throw new Error("Validator did not reach the snapshot record time");
  await new Promise(resolve => setTimeout(resolve, 500));
}
const wireSnapshot = await buildSnapshotRegistrationInstruction({ programId: programId.toBase58(), instrumentId: wireId,
  actionId: wireSnapshotId, issuerAuthority: wireIssuer, bondMint: wireSetup.bondMint, snapshotHash: "ef".repeat(32),
  snapshotSlot: BigInt(wireSlot), investorCount: 3, walletCount: 3, totalBalance: 35n, mintSupply: 35n });
await sendPreparedInstructions([wireSnapshot]);
const wireCommitment = decodeConfirmedSnapshotAccount((await connection.getAccountInfo(new PublicKey(wireSnapshot.actionAddress), "finalized")).data.toString("base64"));
assert.equal(wireCommitment.status, "SNAPSHOT_CREATED"); assert.equal(wireCommitment.snapshotHash, "ef".repeat(32));
assert.equal(wireCommitment.snapshotSlot, BigInt(wireSlot)); assert.equal(wireCommitment.totalBalance, 35n);
console.log("PASS prepared v0 snapshot finalizes an exact immutable commitment in the live record window");
if (process.env.APPROVAL_ACCEPTANCE_ONLY === "true") {
  if (!program.methods.assignApprover || !program.methods.fundActionReserve || !program.methods.releaseActionReserve || !program.methods.approveAction) {
    throw new Error("Approval-only acceptance requires all four candidate instructions; skipping is forbidden");
  }
  const investorIds = [1, 2, 3].map(value => new Uint8Array(16).fill(value));
  const identity = { programId: programId.toBase58(), instrumentId: wireId, actionId: wireSnapshotId, corporateActionAuthority: wireIssuer };
  for (const [index, row] of wireDistribution.allocations.entries()) {
    const registration = await buildEntitlementRegistration({ ...identity, investorId: investorIds[index], snapshotHash: "ef".repeat(32),
      settlementWallet: row.walletAddress, balanceAtSnapshot: row.amount, eligible: true, paymentAmountMinor: row.amount * 50_000_000n, tokensToRedeem: 0n });
    await sendPreparedInstructions([registration.instruction]);
  }
  const finalization = await buildCalculationFinalization({ ...identity, investorIds });
  await sendPreparedInstructions([finalization.instruction]);
  await testActionApproval({ connection, program, issuer: administrator, calculationAuthority: administrator.publicKey,
    instrumentId: wireId, actionId: wireSnapshotId, mintAddress: wireSetup.settlementMint, bondMint: wireSetup.bondMint,
    allocations: wireDistribution.allocations, investorIds, send, sendPreparedInstructions });
  console.log("PASS focused approval acceptance on disposable validator; earlier lifecycle negative groups are outside this mode");
  process.exit(0);
}

await waitForDisposableUpgrade();

if (process.env.ACTION_TEST_DATABASE_URL) {
  // Keep production RPC's loopback-only HTTP policy intact when WSL uses a private IP.
  const relay = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/") { response.writeHead(404).end(); return; }
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2_000_000) { response.writeHead(413).end(); return; }
      }
      const upstream = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body,
        redirect: "error", signal: AbortSignal.timeout(15_000) });
      response.writeHead(upstream.status, { "content-type": "application/json" }).end(await upstream.text());
    } catch { response.writeHead(503).end(); }
  });
  await new Promise(resolve => relay.listen(0, "127.0.0.1", resolve));
  const hex = Buffer.from(wireId).toString("hex");
  const fixture = { rpcUrl: `http://127.0.0.1:${relay.address().port}`, programId: programId.toBase58(),
    instrumentId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    bondMint: wireSetup.bondMint, settlementMint: wireSetup.settlementMint,
    allocations: wireDistribution.allocations.map(row => ({ walletAddress: row.walletAddress, amount: row.amount.toString() })),
    approvalAcceptance: process.env.APPROVAL_HTTP_ACCEPTANCE_ONLY === "true" };
  try {
    const acceptance = spawn(process.execPath, [fileURLToPath(new URL("../../scripts/test-corporate-actions.mjs", import.meta.url)), JSON.stringify(fixture), administratorKeyPath],
      { stdio: "inherit", env: process.env });
    const status = await new Promise((resolve, reject) => { acceptance.once("error", reject); acceptance.once("exit", resolve); });
    if (status !== 0) throw new Error("Action API/database/validator acceptance failed");
  } finally { relay.closeAllConnections(); await new Promise(resolve => relay.close(resolve)); }
  if (process.env.APPROVAL_HTTP_ACCEPTANCE_ONLY === "true") { console.log("PASS focused live approval API/database/validator acceptance"); process.exit(0); }
}

const bondMint = await createBondMint(instrumentAuthority, true);
const settlementMint = await createMint(6);

await initialize(bondMint, settlementMint);
const instrument = await program.account.instrument.fetch(instrumentAddress);
assert.equal(instrument.issuerAuthority.toBase58(), administrator.publicKey.toBase58());
assert.equal(instrument.bondMint.toBase58(), bondMint.toBase58());
assert.equal(instrument.settlementMint.toBase58(), settlementMint.toBase58());
assert.equal(instrument.totalSupply.toString(), "35");
assert.deepEqual(Object.keys(instrument.status), ["deploying"]);
console.log("PASS initialize_instrument creates the expected PDA for an irreversible Token-2022 mint");

const now = Math.floor(Date.now() / 1000);
const recordAt = now + 3_600;
const executeAt = now + 7_200;
const couponId = Uint8Array.from({ length: 16 }, (_, index) => index + 65);
const [couponAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("action"), instrumentAddress.toBuffer(), couponId], programId,
);
await createAction(couponId, { couponPayment: {} }, recordAt, executeAt);
const coupon = await program.account.corporateAction.fetch(couponAddress);
assert.equal(coupon.instrument.toBase58(), instrumentAddress.toBase58());
assert.deepEqual(Object.keys(coupon.actionType), ["couponPayment"]);
assert.deepEqual(Object.keys(coupon.status), ["scheduled"]);
assert.equal(coupon.snapshotSlot.toString(), "0");
assert.deepEqual([...coupon.snapshotHash], Array(32).fill(0));
console.log("PASS create_corporate_action schedules an authorized coupon without a snapshot");

const earlyId = Uint8Array.from({ length: 16 }, (_, index) => index + 113);
const [earlyAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("action"), instrumentAddress.toBuffer(), earlyId], programId,
);
await createAction(earlyId, { earlyRedemption: {} }, recordAt, executeAt, 2_000, 100_000);
const early = await program.account.corporateAction.fetch(earlyAddress);
assert.deepEqual(Object.keys(early.actionType), ["earlyRedemption"]);
assert.equal(early.redemptionPercentageBps, 2_000);
assert.equal(early.redemptionPriceMinor.toString(), "100000");

const maturityId = Uint8Array.from({ length: 16 }, (_, index) => index + 129);
const [maturityAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("action"), instrumentAddress.toBuffer(), maturityId], programId,
);
await createAction(maturityId, { bondRedemption: {} }, recordAt, 1_800_000_000);
const maturity = await program.account.corporateAction.fetch(maturityAddress);
assert.deepEqual(Object.keys(maturity.actionType), ["bondRedemption"]);
assert.deepEqual(Object.keys(maturity.status), ["scheduled"]);
console.log("PASS create_corporate_action schedules all three action types");

await assert.rejects(createAction(couponId, { couponPayment: {} }, recordAt, executeAt));
console.log("PASS create_corporate_action rejects a duplicate action ID");

const unauthorizedActionId = Uint8Array.from({ length: 16 }, (_, index) => index + 81);
const [unauthorizedActionAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("action"), instrumentAddress.toBuffer(), unauthorizedActionId], programId,
);
await assert.rejects(
  createAction(unauthorizedActionId, { couponPayment: {} }, recordAt, executeAt, null, null, outsider),
  (error) => /UnauthorizedIssuer|Only the instrument issuer authority/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
assert.equal(await connection.getAccountInfo(unauthorizedActionAddress), null);
console.log("PASS create_corporate_action rejects an unrelated signer");

const invalidActionId = Uint8Array.from({ length: 16 }, (_, index) => index + 97);
const [invalidActionAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("action"), instrumentAddress.toBuffer(), invalidActionId], programId,
);
await assert.rejects(
  createAction(invalidActionId, { earlyRedemption: {} }, recordAt, executeAt, 0, 100_000),
  (error) => /InvalidRedemptionParameters|Redemption parameters do not match/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
assert.equal(await connection.getAccountInfo(invalidActionAddress), null);
console.log("PASS create_corporate_action rejects invalid early-redemption terms");

await assert.rejects(
  cancelAction(couponAddress, outsider),
  (error) => /UnauthorizedIssuer|Only the instrument issuer authority/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
assert.deepEqual(Object.keys((await program.account.corporateAction.fetch(couponAddress)).status), ["scheduled"]);
console.log("PASS cancel_action rejects a non-issuer signer");

await cancelAction(couponAddress);
const cancelledCoupon = await program.account.corporateAction.fetch(couponAddress);
assert.deepEqual(Object.keys(cancelledCoupon.status), ["cancelled"]);
assert.ok(cancelledCoupon.completedAt.toNumber() >= now);
console.log("PASS cancel_action makes a scheduled action terminal");

await assert.rejects(
  cancelAction(couponAddress),
  (error) => /InvalidActionStatus|Corporate action must be scheduled to cancel/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS cancel_action rejects replay");

const administratorBondAccount = getAssociatedTokenAddressSync(
  bondMint, administrator.publicKey, false, TOKEN_2022_PROGRAM_ID,
);
const holders = [10, 20, 5].map((amount) => {
  const wallet = Keypair.generate().publicKey;
  return {
    amount,
    tokenAccount: getAssociatedTokenAddressSync(
      bondMint, wallet, false, TOKEN_2022_PROGRAM_ID,
    ),
    wallet,
  };
});
await send(...holders.flatMap(({ amount, tokenAccount, wallet }) => [
  createAssociatedTokenAccountInstruction(
    administrator.publicKey, tokenAccount, wallet, bondMint, TOKEN_2022_PROGRAM_ID,
  ),
  createTransferCheckedInstruction(
    administratorBondAccount, bondMint, tokenAccount, administrator.publicKey,
    amount, 0, [], TOKEN_2022_PROGRAM_ID,
  ),
]));
const holderAccounts = holders.map(({ tokenAccount }) => tokenAccount);

await assert.rejects(
  activate([]),
  (error) => /InvalidHolderCount|Activation requires 1 to 64/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS activate_instrument rejects an empty holder list");

await assert.rejects(
  activate([...holderAccounts, administratorBondAccount]),
  (error) => /InvalidHolderAccount|positive-balance Token-2022 account/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS activate_instrument rejects a zero-balance token account");

const settlementAccount = getAssociatedTokenAddressSync(
  settlementMint, administrator.publicKey, false, TOKEN_2022_PROGRAM_ID,
);
await send(
  createAssociatedTokenAccountInstruction(
    administrator.publicKey, settlementAccount, administrator.publicKey,
    settlementMint, TOKEN_2022_PROGRAM_ID,
  ),
  createMintToInstruction(
    settlementMint, settlementAccount, administrator.publicKey, 1, [], TOKEN_2022_PROGRAM_ID,
  ),
);
await assert.rejects(
  activate([...holderAccounts, settlementAccount]),
  (error) => /InvalidHolderAccount|positive-balance Token-2022 account/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS activate_instrument rejects a token account for another mint");

await assert.rejects(
  activate(holderAccounts.slice(0, 2)),
  (error) => /InvalidMintSupply|Bond mint supply does not match/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
assert.deepEqual(Object.keys((await program.account.instrument.fetch(instrumentAddress)).status), ["deploying"]);
console.log("PASS activate_instrument rejects incomplete holder balance reconciliation");

await assert.rejects(
  activate([holderAccounts[0], holderAccounts[0], ...holderAccounts.slice(1)]),
  (error) => /DuplicateHolderAccount|supplied more than once/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS activate_instrument rejects duplicate holder accounts");

await assert.rejects(
  activate(holderAccounts, outsider),
  (error) => /UnauthorizedIssuer|Only the instrument issuer authority/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS activate_instrument rejects a non-issuer signer");

await activate(holderAccounts);
assert.deepEqual(Object.keys((await program.account.instrument.fetch(instrumentAddress)).status), ["active"]);
console.log("PASS activate_instrument reconciles the canonical 10/20/5 distribution to supply 35");

await assert.rejects(
  activate(holderAccounts),
  (error) => /InvalidInstrumentStatus|Instrument status does not allow/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS activate_instrument rejects replay");

const snapshotActionId = Uint8Array.from({ length: 16 }, (_, index) => index + 145);
const [snapshotActionAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("action"), instrumentAddress.toBuffer(), snapshotActionId], programId,
);
const snapshotRecordAt = Math.floor(Date.now() / 1000) + 25;
await createAction(snapshotActionId, { couponPayment: {} }, snapshotRecordAt, snapshotRecordAt + 3_600);
const snapshotHash = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const preparationSlot = await connection.getSlot("finalized");
const preparedRegistration = await buildSnapshotRegistrationInstruction({
  programId: programId.toBase58(),
  instrumentId,
  actionId: snapshotActionId,
  issuerAuthority: administrator.publicKey.toBase58(),
  bondMint: bondMint.toBase58(),
  snapshotHash: Buffer.from(snapshotHash).toString("hex"),
  snapshotSlot: BigInt(preparationSlot),
  investorCount: 3,
  walletCount: 3,
  totalBalance: 35n,
  mintSupply: 35n,
});
assert.equal(preparedRegistration.instrumentAddress, instrumentAddress.toBase58());
assert.equal(preparedRegistration.actionAddress, snapshotActionAddress.toBase58());
const anchorRegistration = await program.methods.registerSnapshot({
  snapshotHash: [...snapshotHash],
  snapshotSlot: new BN(preparationSlot),
  investorCount: 3,
  walletCount: 3,
  totalBalance: new BN(35),
  mintSupply: new BN(35),
}).accountsStrict({
  issuerAuthority: administrator.publicKey,
  instrument: instrumentAddress,
  corporateAction: snapshotActionAddress,
  instrumentAuthority,
  bondMint,
  token2022Program: TOKEN_2022_PROGRAM_ID,
}).instruction();
assert.deepEqual(Buffer.from(preparedRegistration.data), anchorRegistration.data);
assert.deepEqual(preparedRegistration.accounts.map((account) => account.address),
  anchorRegistration.keys.map((account) => account.pubkey.toBase58()));
console.log("PASS internal snapshot registration plan matches Anchor encoding and PDAs");
await assert.rejects(
  registerSnapshot(snapshotActionAddress, await connection.getSlot("finalized"), snapshotHash),
  (error) => /SnapshotWindowMissed|outside the record-date window/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS register_snapshot rejects capture before record date");

const snapshotDeadline = Date.now() + 90_000;
let snapshotSlot;
while (snapshotSlot === undefined) {
  const finalizedSlot = await connection.getSlot("finalized");
  const blockTime = await connection.getBlockTime(finalizedSlot);
  if (blockTime !== null && blockTime >= snapshotRecordAt + 1) {
    snapshotSlot = finalizedSlot;
    break;
  }
  if (Date.now() >= snapshotDeadline) {
    throw new Error("Local validator did not reach the snapshot record date within 90 seconds");
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
await assert.rejects(
  registerSnapshot(snapshotActionAddress, snapshotSlot, snapshotHash, 35, outsider),
  (error) => /UnauthorizedIssuer|Only the instrument issuer authority/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
await assert.rejects(
  registerSnapshot(snapshotActionAddress, snapshotSlot, new Uint8Array(32)),
  (error) => /InvalidSnapshotHash|Snapshot hash must not be zero/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
await assert.rejects(
  registerSnapshot(snapshotActionAddress, snapshotSlot, snapshotHash, 34),
  (error) => /InvalidMintSupply|Bond mint supply does not match/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS register_snapshot rejects wrong signer, zero hash, and supply mismatch");

await registerSnapshot(snapshotActionAddress, snapshotSlot, snapshotHash);
const snapshottedAction = await program.account.corporateAction.fetch(snapshotActionAddress);
assert.deepEqual(Object.keys(snapshottedAction.status), ["snapshotCreated"]);
assert.deepEqual([...snapshottedAction.snapshotHash], [...snapshotHash]);
assert.equal(snapshottedAction.snapshotSlot.toString(), String(snapshotSlot));
assert.equal(snapshottedAction.investorCount, 3);
assert.equal(snapshottedAction.walletCount, 3);
assert.equal(snapshottedAction.totalBalance.toString(), "35");
console.log("PASS register_snapshot stores an immutable on-chain commitment");

await assert.rejects(
  registerSnapshot(snapshotActionAddress, snapshotSlot, new Uint8Array(32).fill(2)),
  (error) => /InvalidActionStatus|Corporate action must be scheduled/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
await assert.rejects(
  cancelAction(snapshotActionAddress),
  (error) => /InvalidActionStatus|Corporate action must be scheduled/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
console.log("PASS registered snapshot cannot be replaced or cancelled");

const outsiderId = Uint8Array.from({ length: 16 }, (_, index) => index + 49);
const [outsiderAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("instrument"), outsiderId], programId,
);
const [outsiderInstrumentAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("instrument-authority"), outsiderAddress.toBuffer()], programId,
);
const outsiderBondMint = await createBondMint(outsiderInstrumentAuthority, true);
await assert.rejects(
  initialize(outsiderBondMint, settlementMint, outsiderId, 35, outsider),
  (error) => /UnauthorizedAdministrator|Administrator must be the program upgrade authority/
    .test(`${error.message} ${JSON.stringify(error.transactionLogs ?? [])}`),
);
assert.equal(await connection.getAccountInfo(outsiderAddress), null);
console.log("PASS initialize_instrument rejects a signer who is not the upgrade authority");

const mismatchedId = Uint8Array.from({ length: 16 }, (_, index) => index + 17);
await assert.rejects(initialize(bondMint, settlementMint, mismatchedId, 34));
const [mismatchedAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("instrument"), mismatchedId], programId,
);
assert.equal(await connection.getAccountInfo(mismatchedAddress), null);
console.log("PASS initialize_instrument rejects a mint-supply mismatch without creating a PDA");

const unrevokedId = Uint8Array.from({ length: 16 }, (_, index) => index + 33);
const [unrevokedAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from("instrument"), unrevokedId], programId,
);
const [unrevokedAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("instrument-authority"), unrevokedAddress.toBuffer()], programId,
);
const unrevokedMint = await createBondMint(unrevokedAuthority, false);
await assert.rejects(initialize(unrevokedMint, settlementMint, unrevokedId));
assert.equal(await connection.getAccountInfo(unrevokedAddress), null);
console.log("PASS initialize_instrument rejects an active mint authority without creating a PDA");

if (program.methods.registerEntitlement && program.methods.finalizeCalculation && program.methods.resetCalculation) {
  const calculationIdentity = { programId: programId.toBase58(), instrumentId: wireId,
    actionId: wireSnapshotId, corporateActionAuthority: wireIssuer };
  const investorIds = [1, 2, 3].map(value => new Uint8Array(16).fill(value));
  const registrations = await Promise.all(wireDistribution.allocations.map((row, index) =>
    buildEntitlementRegistration({ ...calculationIdentity, investorId: investorIds[index], snapshotHash: "ef".repeat(32),
      settlementWallet: row.walletAddress, balanceAtSnapshot: row.amount, eligible: true,
      paymentAmountMinor: row.amount * 50_000_000n, tokensToRedeem: 0n })));
  const anchorEntitlement = await program.methods.registerEntitlement({ investorId: [...investorIds[0]],
    snapshotHash: Array(32).fill(239), settlementWallet: new PublicKey(wireDistribution.allocations[0].walletAddress),
    balanceAtSnapshot: new BN(10), eligible: true, paymentAmountMinor: new BN(500_000_000), tokensToRedeem: new BN(0)
  }).accountsStrict({ corporateActionAuthority: administrator.publicKey, instrument: wireAddress,
    corporateAction: new PublicKey(registrations[0].actionAddress), entitlement: new PublicKey(registrations[0].entitlementAddress),
    systemProgram: SystemProgram.programId }).instruction();
  assert.deepEqual(Buffer.from(registrations[0].instruction.data), anchorEntitlement.data);
  assert.deepEqual(registrations[0].instruction.accounts.map(a => [a.address, a.isSigner, a.isWritable]),
    anchorEntitlement.keys.map(a => [a.pubkey.toBase58(), a.isSigner, a.isWritable]));
  const rejectsProgram = pattern => error => pattern.test(`${error.message} ${JSON.stringify(error.logs ?? error.transactionLogs ?? [])}`);
  const badSigner = await buildEntitlementRegistration({ ...calculationIdentity, corporateActionAuthority: outsider.publicKey.toBase58(),
    investorId: investorIds[0], snapshotHash: "ef".repeat(32), settlementWallet: wireIssuer, balanceAtSnapshot: 10n,
    eligible: true, paymentAmountMinor: 500_000_000n, tokensToRedeem: 0n });
  await assert.rejects(sendPreparedInstructions([badSigner.instruction], outsider), rejectsProgram(/UnauthorizedCorporateActionAuthority/));
  const badHash = await buildEntitlementRegistration({ ...calculationIdentity,
    investorId: investorIds[0], snapshotHash: "aa".repeat(32), settlementWallet: wireIssuer, balanceAtSnapshot: 10n,
    eligible: true, paymentAmountMinor: 500_000_000n, tokensToRedeem: 0n });
  await assert.rejects(sendPreparedInstructions([badHash.instruction]), rejectsProgram(/InvalidSnapshotHash/));
  const badAmount = await buildEntitlementRegistration({ ...calculationIdentity,
    investorId: investorIds[0], snapshotHash: "ef".repeat(32), settlementWallet: wireIssuer, balanceAtSnapshot: 10n,
    eligible: true, paymentAmountMinor: 500_000_001n, tokensToRedeem: 0n });
  await assert.rejects(sendPreparedInstructions([badAmount.instruction]), rejectsProgram(/InvalidEntitlement/));
  assert.equal(await connection.getAccountInfo(new PublicKey(registrations[0].entitlementAddress)), null);
  console.log("PASS entitlement wire matches Anchor; wrong authority, hash and amount roll back without an account");
  const finalization = await buildCalculationFinalization({ ...calculationIdentity, investorIds });
  await assert.rejects(sendPreparedInstructions([finalization.instruction]), rejectsProgram(/InvalidActionStatus/));
  await sendPreparedInstructions([registrations[0].instruction]);
  await assert.rejects(sendPreparedInstructions([registrations[0].instruction]));
  const reset = await buildCalculationReset({ ...calculationIdentity, investorIds: investorIds.slice(0, 1) });
  const anchorReset = await program.methods.resetCalculation().accountsStrict({
    corporateActionAuthority: administrator.publicKey, instrument: wireAddress,
    corporateAction: new PublicKey(reset.actionAddress),
  }).remainingAccounts(reset.entitlementAddresses.map(address => ({ pubkey: new PublicKey(address), isSigner: false, isWritable: true }))).instruction();
  assert.deepEqual(Buffer.from(reset.instruction.data), anchorReset.data);
  assert.deepEqual(reset.instruction.accounts.map(a => [a.address, a.isSigner, a.isWritable]),
    anchorReset.keys.map(a => [a.pubkey.toBase58(), a.isSigner, a.isWritable]));
  await sendPreparedInstructions([reset.instruction]);
  assert.equal(await connection.getAccountInfo(new PublicKey(registrations[0].entitlementAddress)), null);
  const resetAction = await program.account.corporateAction.fetch(new PublicKey(reset.actionAddress));
  assert.deepEqual(Object.keys(resetAction.status), ["snapshotCreated"]);
  assert.equal(resetAction.registeredEntitlements, 0);
  assert.equal(resetAction.totalAmountMinor.toString(), "0");
  await assert.rejects(sendPreparedInstructions([reset.instruction]), rejectsProgram(/InvalidActionStatus/));
  await sendPreparedInstructions([registrations[0].instruction]);
  console.log("PASS partial calculation reset closes the complete supplied set and allows exact re-registration");
  await assert.rejects(sendPreparedInstructions([finalization.instruction]), rejectsProgram(/IncompleteCalculation/));
  for (const plan of registrations.slice(1)) await sendPreparedInstructions([plan.instruction]);
  const incompleteReset = await buildCalculationReset({ ...calculationIdentity, investorIds: investorIds.slice(0, 1) });
  await assert.rejects(sendPreparedInstructions([incompleteReset.instruction]), rejectsProgram(/IncompleteCalculation/));
  const registeredAction = await program.account.corporateAction.fetch(new PublicKey(finalization.actionAddress));
  assert.deepEqual(Object.keys(registeredAction.status), ["calculated"]);
  assert.equal(registeredAction.registeredEntitlements, 3);
  assert.equal(registeredAction.totalAmountMinor.toString(), "1750000000");
  for (const [index, plan] of registrations.entries()) {
    const row = await program.account.entitlement.fetch(new PublicKey(plan.entitlementAddress));
    assert.deepEqual([...row.investorId], [...investorIds[index]]);
    assert.deepEqual([...row.snapshotHash], Array(32).fill(239));
    assert.equal(row.settlementWallet.toBase58(), wireDistribution.allocations[index].walletAddress);
    assert.equal(row.paymentAmountMinor.toString(), ["500000000", "1000000000", "250000000"][index]);
    assert.deepEqual(Object.keys(row.status), ["ready"]);
    assert.equal(row.executedAt, null);
  }
  console.log("PASS immutable coupon entitlements 500/1000/250 total 1750; duplicate and incomplete registration/reset rejected");
  const duplicate = { ...finalization.instruction, accounts: [...finalization.instruction.accounts] };
  duplicate.accounts[5] = duplicate.accounts[3];
  await assert.rejects(sendPreparedInstructions([duplicate]), rejectsProgram(/InvalidEntitlement/));
  const foreign = { ...finalization.instruction, accounts: [...finalization.instruction.accounts] };
  foreign.accounts[5] = { address: instrumentAddress.toBase58(), isSigner: false, isWritable: false };
  await assert.rejects(sendPreparedInstructions([foreign]));
  const badFinalSigner = await buildCalculationFinalization({ ...calculationIdentity, corporateActionAuthority: outsider.publicKey.toBase58(), investorIds });
  await assert.rejects(sendPreparedInstructions([badFinalSigner.instruction], outsider), rejectsProgram(/UnauthorizedCorporateActionAuthority/));
  await sendPreparedInstructions([finalization.instruction]);
  const completedCalculation = decodeConfirmedCorporateAction((await connection.getAccountInfo(new PublicKey(finalization.actionAddress))).data.toString("base64"));
  assert.equal(completedCalculation.status, "UNDER_REVIEW");
  assert.equal(completedCalculation.totalAmountMinor, 1_750_000_000n);
  await assert.rejects(sendPreparedInstructions([finalization.instruction]), rejectsProgram(/InvalidActionStatus/));
  console.log("PASS full calculation finalizes UNDER_REVIEW; duplicate, foreign, wrong signer and replay rejected");
  if (program.methods.assignApprover && program.methods.fundActionReserve && program.methods.releaseActionReserve && program.methods.approveAction) {
    await testActionApproval({ connection, program, issuer: administrator, calculationAuthority: administrator.publicKey,
      instrumentId: wireId, actionId: wireSnapshotId, mintAddress: wireSetup.settlementMint, bondMint: wireSetup.bondMint,
      allocations: wireDistribution.allocations, investorIds, send, sendPreparedInstructions });
  } else console.log("SKIP approval acceptance: retained artifact does not expose approval instructions");

  // A distinct CA authority is mandatory even when the issuer owns the instrument.
  await send(SystemProgram.transfer({ fromPubkey: administrator.publicKey, toPubkey: calculationAuthority.publicKey, lamports: 100_000_000 }));
  const separateIdentity = { programId: programId.toBase58(), instrumentId, actionId: snapshotActionId,
    corporateActionAuthority: calculationAuthority.publicKey.toBase58() };
  const separateRows = await Promise.all(holders.map((holder, index) => buildEntitlementRegistration({ ...separateIdentity,
    investorId: investorIds[index], snapshotHash: Buffer.from(snapshotHash).toString("hex"), settlementWallet: holder.wallet.toBase58(),
    balanceAtSnapshot: BigInt(index === 2 ? 4 : holder.amount), eligible: true,
    paymentAmountMinor: BigInt(index === 2 ? 4 : holder.amount) * 5000n, tokensToRedeem: 0n })));
  const issuerPlan = await buildEntitlementRegistration({ ...separateIdentity, corporateActionAuthority: wireIssuer,
    investorId: investorIds[0], snapshotHash: Buffer.from(snapshotHash).toString("hex"), settlementWallet: wireIssuer,
    balanceAtSnapshot: 10n, eligible: true, paymentAmountMinor: 50_000n, tokensToRedeem: 0n });
  await assert.rejects(sendPreparedInstructions([issuerPlan.instruction]), rejectsProgram(/UnauthorizedCorporateActionAuthority/));
  for (const row of separateRows) await sendPreparedInstructions([row.instruction], calculationAuthority);
  const incompleteCoverage = await buildCalculationFinalization({ ...separateIdentity, investorIds });
  await assert.rejects(sendPreparedInstructions([incompleteCoverage.instruction], calculationAuthority), rejectsProgram(/IncompleteCalculation/));
  assert.deepEqual(Object.keys((await program.account.corporateAction.fetch(snapshotActionAddress)).status), ["calculated"]);
  console.log("PASS separate CA authority enforced; full count with balance 34/35 cannot finalize");
} else {
  console.log("SKIP entitlement candidate acceptance: retained artifact does not expose new instructions");
}
