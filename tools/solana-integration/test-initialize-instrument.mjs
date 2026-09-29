import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import anchor from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
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

const idlPath = fileURLToPath(new URL("../../target/idl/lifecycle_kase.json", import.meta.url));
const idl = JSON.parse(await readFile(idlPath, "utf8"));
const programId = new PublicKey(idl.address);
const connection = new Connection(rpcUrl, "finalized");
const administrator = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(await readFile(administratorKeyPath, "utf8"))),
);
const outsider = Keypair.generate();
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
    corporateActionAuthority: Keypair.generate().publicKey,
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

const airdrop = await connection.requestAirdrop(administrator.publicKey, 10_000_000_000);
await connection.confirmTransaction(airdrop, "finalized");
const outsiderAirdrop = await connection.requestAirdrop(outsider.publicKey, 1_000_000_000);
await connection.confirmTransaction(outsiderAirdrop, "finalized");

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
