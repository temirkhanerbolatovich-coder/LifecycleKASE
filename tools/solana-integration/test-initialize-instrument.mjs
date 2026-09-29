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
  getAssociatedTokenAddressSync,
  getMintLen,
} from "@solana/spl-token";

const { BN, Program } = anchor;

const rpcUrl = process.argv[2];
if (!rpcUrl || !/^http:\/\/(127\.0\.0\.1|localhost|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):\d+$/.test(rpcUrl)) {
  throw new Error("A loopback or private WSL HTTP validator URL is required as the first argument");
}

const idlPath = fileURLToPath(new URL("../../target/idl/lifecycle_kase.json", import.meta.url));
const idl = JSON.parse(await readFile(idlPath, "utf8"));
const programId = new PublicKey(idl.address);
const connection = new Connection(rpcUrl, "finalized");
const administrator = Keypair.generate();
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

async function send(...instructions) {
  return sendAndConfirmTransaction(
    connection,
    new Transaction().add(...instructions),
    [administrator],
    { commitment: "finalized" },
  );
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

async function initialize(bondMint, settlementMint, id = instrumentId, supply = 35) {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("instrument"), id], programId,
  );
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("instrument-authority"), address.toBuffer()], programId,
  );
  const instruction = await program.methods.initializeInstrument(terms(id, supply))
    .accountsStrict({
      administrator: administrator.publicKey,
      instrument: address,
      instrumentAuthority: authority,
      bondMint,
      settlementMint,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return send(instruction);
}

const airdrop = await connection.requestAirdrop(administrator.publicKey, 10_000_000_000);
await connection.confirmTransaction(airdrop, "finalized");

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
