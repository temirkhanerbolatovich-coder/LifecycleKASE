import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import * as client from "../packages/solana-client/dist/index.js";

// Reuse the isolated integration dependencies; they never enter the deployed application.
const requireIntegration = createRequire(new URL("../tools/solana-integration/package.json", import.meta.url));
const { Program } = requireIntegration("@anchor-lang/core");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  ComputeBudgetProgram } = requireIntegration("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, AuthorityType, ExtensionType,
  AccountState, createAssociatedTokenAccountIdempotentInstruction, createBurnCheckedInstruction,
  createTransferCheckedInstruction, createThawAccountInstruction, createSetAuthorityInstruction,
  createApproveInstruction, createCloseAccountInstruction, createInitializeImmutableOwnerInstruction,
  createInitializeAccount3Instruction, createMintToCheckedInstruction, getAccountLen, getAssociatedTokenAddressSync,
  createReallocateInstruction, createEnableCpiGuardInstruction, getCpiGuard,
  createEnableRequiredMemoTransfersInstruction, getMemoTransfer,
  getAccount, getMint, getDefaultAccountState, getPermanentDelegate } = requireIntegration("@solana/spl-token");

const [rpcUrl, administratorKeyPath, idlPath, programPath, evidenceDirectory] = process.argv.slice(2);
if (!rpcUrl || !/^http:\/\/(127\.0\.0\.1|localhost|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):\d+$/.test(rpcUrl)) {
  throw new Error("A loopback or private WSL HTTP validator URL is required");
}
if (!administratorKeyPath || !idlPath || !programPath || !evidenceDirectory) {
  throw new Error("Disposable administrator, candidate IDL/program, and evidence directory arguments are required");
}
// Direct CLI calls enforce the same disposable boundary as the wrapper, before reading any key.
const temporaryAdministrator = /^(?:\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+\\tmp\\|\/tmp\/)lifecycle-kase-controlled\.[A-Za-z0-9]{8}[\\/]admin\.json$/i;
assert.match(administratorKeyPath, temporaryAdministrator, "Only this test's WSL temporary administrator path is accepted");
assert.match(await realpath(administratorKeyPath), temporaryAdministrator, "Administrator must resolve to an owned test temporary path");
const repoRoot = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const generatedRoot = resolve(repoRoot, "generated");
function generatedRelative(path) {
  const result = relative(generatedRoot, path);
  assert.ok(result && !result.startsWith(`..${sep}`) && result !== ".." && !isAbsolute(result), "Artifacts must stay inside workspace generated");
  return result.replaceAll("\\", "/");
}
const actualIdlPath = await realpath(idlPath);
const actualProgramPath = await realpath(programPath);
const actualEvidenceDirectory = await realpath(evidenceDirectory);
const idlRelative = generatedRelative(actualIdlPath);
assert.match(idlRelative, /^localnet-candidate(?:-[a-z0-9-]+)?\/lifecycle_kase\.json$/);
assert.equal(generatedRelative(actualProgramPath), idlRelative.replace(/\.json$/, ".so"));
assert.match(generatedRelative(actualEvidenceDirectory), /^controlled-registry-\d{8}-\d{6}-lifecycle-kase-controlled\.[A-Za-z0-9]{8}$/);
const pk = value => new PublicKey(value);
const b58 = value => value.toBase58();
const sha256 = value => createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const idl = JSON.parse(await readFile(idlPath, "utf8"));
assert.equal(idl.address, "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", "Only the isolated Localnet program identity is accepted");
const programId = pk(idl.address);
const connection = new Connection(rpcUrl, "finalized");
const program = new Program(idl, { connection });
const administrator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(administratorKeyPath, "utf8"))));
const approver = Keypair.generate();
const outsider = Keypair.generate();
const holders = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
const uuidBytes = () => Buffer.from(randomUUID().replaceAll("-", ""), "hex");
const instrumentId = uuidBytes();
const investorIds = [uuidBytes(), uuidBytes(), uuidBytes()];
const identity = { programId: b58(programId), instrumentId, administrator: b58(administrator.publicKey),
  issuerAuthority: b58(administrator.publicKey), corporateActionAuthority: b58(administrator.publicKey) };
const evidence = {
  schema: "LifecycleKASE:ControlledRegistryAcceptance:v1", startedAt: new Date().toISOString(),
  scope: "disposable Localnet protocol and client; no API, database, Devnet or retained-owner acceptance",
  artifacts: { idlSha256: sha256(await readFile(idlPath)), programSha256: sha256(await readFile(programPath)),
    harnessSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    controlledClientSha256: sha256(await readFile(new URL("../packages/solana-client/dist/controlled-registry.js", import.meta.url))) },
  identities: { programId: b58(programId), administrator: b58(administrator.publicKey), approver: b58(approver.publicKey),
    holderWallets: holders.map(value => b58(value.publicKey)), instrumentId: instrumentId.toString("hex") },
  submittedTransactions: [], finalizedTransactions: [], rejectedTransactions: [], checkpoints: [], passed: [], status: "RUNNING",
};
let fixture;

function instruction(plan) {
  if (plan instanceof TransactionInstruction) return plan;
  return new TransactionInstruction({ programId: pk(plan.programId),
    keys: plan.accounts.map(account => ({ pubkey: pk(account.address), isSigner: account.isSigner, isWritable: account.isWritable })),
    data: Buffer.from(plan.data) });
}

async function send(label, instructions, signers = [administrator]) {
  const wire = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }), ...instructions.map(instruction));
  const uniqueSigners = [...new Map(signers.map(signer => [b58(signer.publicKey), signer])).values()];
  const latest = await connection.getLatestBlockhash("finalized");
  wire.feePayer = uniqueSigners[0].publicKey;
  wire.recentBlockhash = latest.blockhash;
  wire.sign(...uniqueSigners);
  // Submit once. A confirmation error keeps its original signature; financial instructions are never rebuilt/resubmitted here.
  const signature = await connection.sendRawTransaction(wire.serialize(), { preflightCommitment: "finalized", maxRetries: 0 });
  const submitted = { label, signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, status: "SUBMITTED" };
  evidence.submittedTransactions.push(submitted);
  const confirmed = await connection.confirmTransaction({ signature, ...latest }, "finalized");
  assert.equal(confirmed.value.err, null, `${label}: finality must confirm success for ${signature}`);
  let transaction;
  for (let attempt = 0; attempt < 5; attempt++) {
    transaction = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
    if (transaction) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(transaction, `${label}: finalized transaction must be readable`);
  assert.equal(transaction.meta?.err, null, `${label}: finalized transaction must succeed`);
  submitted.status = "FINALIZED";
  evidence.finalizedTransactions.push({ label, signature, slot: transaction.slot, blockTime: transaction.blockTime,
    logSha256: sha256(JSON.stringify(transaction.meta?.logMessages ?? [])) });
  return signature;
}

async function read(address) {
  const account = await connection.getAccountInfo(pk(address), "finalized");
  assert.ok(account, `Expected finalized account ${address}`);
  return account;
}

async function accountDigest(address) {
  const account = await connection.getAccountInfo(pk(address), "finalized");
  return account ? { address, owner: b58(account.owner), lamports: account.lamports, sha256: sha256(account.data) } : { address, absent: true };
}

async function unchangedOnFailure(label, callback, addresses, expectedPattern) {
  const before = await Promise.all(addresses.map(accountDigest));
  let failure;
  try { await callback(); } catch (error) { failure = error; }
  assert.ok(failure, `${label}: transaction must reject`);
  const logs = failure.logs ?? [];
  const details = `${failure.message}\n${logs.join("\n")}`;
  if (expectedPattern) assert.match(details, expectedPattern, `${label}: expected rejection reason`);
  assert.deepEqual(await Promise.all(addresses.map(accountDigest)), before, `${label}: account bytes must roll back`);
  evidence.rejectedTransactions.push({ label, reason: String(failure.message).slice(0, 1000), logSha256: sha256(JSON.stringify(logs)),
    unchangedAccountHashes: before });
}

function pass(label) {
  evidence.passed.push(label);
  console.log(`PASS ${label}`);
}

async function chainTime() {
  const slot = await connection.getSlot("finalized");
  const time = await connection.getBlockTime(slot);
  assert.ok(time, "Finalized validator block time must be available");
  return BigInt(time);
}

async function waitUntil(timestamp) {
  const deadline = Date.now() + 45_000;
  while (await chainTime() < timestamp) {
    if (Date.now() > deadline) throw new Error("Disposable validator did not reach the scheduled record date");
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

async function actionState(actionAddress) {
  return client.decodeConfirmedCorporateAction((await read(actionAddress)).data.toString("base64"));
}

async function holdingState(tokenAccount) {
  const address = await client.deriveControlledHoldingAddress(identity.programId, fixture.instrumentAddress, tokenAccount);
  return client.decodeControlledHolding(await controlledInput(address), { programId: identity.programId, accountAddress: address,
    instrumentAddress: fixture.instrumentAddress, mintAddress: fixture.bondMint, tokenAccount, walletAddress: fixture.ownerByAccount.get(tokenAccount) });
}

async function controlledInput(address) {
  const account = await read(address);
  return { address, owner: b58(account.owner), executable: account.executable, dataBase64: account.data.toString("base64") };
}

async function captureState(action) {
  const decoded = client.decodeControlledCapture(await controlledInput(action.controlledCaptureAddress), { programId: identity.programId,
    accountAddress: action.controlledCaptureAddress, instrumentAddress: fixture.instrumentAddress, actionAddress: action.actionAddress,
    ...(action.snapshotHash ? { snapshotHash: action.snapshotHash } : {}) });
  const anchorAccount = await program.account.controlledCapture.fetch(pk(action.controlledCaptureAddress), "finalized");
  assert.equal(decoded.startedSlot, BigInt(anchorAccount.startedSlot.toString()));
  assert.equal(decoded.committed, anchorAccount.committed);
  assert.equal(decoded.finished, anchorAccount.finished);
  return decoded;
}

async function policyState() {
  return client.decodeControlledPolicy(await controlledInput(fixture.controlledPolicyAddress), { programId: identity.programId,
    accountAddress: fixture.controlledPolicyAddress, instrumentAddress: fixture.instrumentAddress, mintAddress: fixture.bondMint });
}

async function tokenState(address) {
  try {
    const token = await getAccount(connection, pk(address), "finalized", TOKEN_2022_PROGRAM_ID);
    return { address, wallet: b58(token.owner), amount: token.amount, frozen: token.isFrozen,
      delegate: token.delegate ? b58(token.delegate) : null, closeAuthority: token.closeAuthority ? b58(token.closeAuthority) : null };
  } catch (error) {
    if (await connection.getAccountInfo(pk(address), "finalized") === null) return { address, absent: true };
    throw error;
  }
}

async function checkpoint(label, extra = {}) {
  const mint = await getMint(connection, pk(fixture.bondMint), "finalized", TOKEN_2022_PROGRAM_ID);
  const accounts = await Promise.all(fixture.tokenAccounts.map(tokenState));
  for (const account of accounts) if (!account.absent) assert.equal(account.frozen, true, `${label}: every bond account must be frozen`);
  const entry = { label, slot: await connection.getSlot("finalized"), mintSupply: mint.supply, accounts, ...extra };
  evidence.checkpoints.push(entry);
  return entry;
}

async function transfer(label, source, destination, owner, amount) {
  const plan = await client.buildControlledTransfer({ ...identity, bondMint: fixture.bondMint,
    holder: b58(owner.publicKey), sourceTokenAccount: source, destinationTokenAccount: destination, amount });
  await send(label, [plan.instruction], [administrator, owner]);
  return plan;
}

async function createFixture() {
  const setup = await client.buildControlledMintSetup({ ...identity,
    bondRentLamports: BigInt(await connection.getMinimumBalanceForRentExemption(client.CONTROLLED_BOND_MINT_SIZE)),
    settlementRentLamports: BigInt(await connection.getMinimumBalanceForRentExemption(client.SETTLEMENT_MINT_SIZE)), totalSupply: 35n });
  await send("controlled mint setup", setup.instructions);
  const now = await chainTime();
  const initialized = await client.buildControlledInstrumentInitialization({ ...identity, ...setup,
    complianceAuthority: b58(administrator.publicKey), faceValueMinor: 1_000_000_000n,
    couponRateBps: 1000, paymentsPerYear: 2, issueAt: now - 60n, maturityAt: now + 86_400n, totalSupply: 35n });
  await send("initialize controlled version 2 instrument", [initialized.instruction]);
  fixture = { ...setup, ...initialized, tokenAccounts: [setup.treasuryTokenAccount], holderAccounts: [],
    ownerByAccount: new Map([[setup.treasuryTokenAccount, b58(administrator.publicKey)]]) };
  const treasuryRegistration = await client.buildControlledHoldingRegistration({ ...identity, bondTokenAccount: setup.treasuryTokenAccount });
  await send("register frozen treasury holding", [treasuryRegistration.instruction]);
  const mint = await getMint(connection, pk(setup.bondMint), "finalized", TOKEN_2022_PROGRAM_ID);
  assert.equal(mint.supply, 35n);
  assert.equal(mint.decimals, 0);
  assert.equal(mint.mintAuthority, null);
  assert.equal(b58(mint.freezeAuthority), setup.instrumentAuthority);
  assert.equal(getDefaultAccountState(mint).state, AccountState.Frozen);
  assert.equal(b58(getPermanentDelegate(mint).delegate), setup.instrumentAuthority);
  assert.equal(client.decodeConfirmedInstrumentAccount((await read(setup.instrumentAddress)).data.toString("base64")).version, 2);
  for (const [index, holder] of holders.entries()) {
    const tokenAccount = b58(getAssociatedTokenAddressSync(pk(setup.bondMint), holder.publicKey, false, TOKEN_2022_PROGRAM_ID));
    await send(`create frozen holder ${index + 1}`, [createAssociatedTokenAccountIdempotentInstruction(
      administrator.publicKey, pk(tokenAccount), holder.publicKey, pk(setup.bondMint), TOKEN_2022_PROGRAM_ID)]);
    const registration = await client.buildControlledHoldingRegistration({ ...identity, bondTokenAccount: tokenAccount });
    await send(`register holder ${index + 1}`, [registration.instruction]);
    fixture.tokenAccounts.push(tokenAccount);
    fixture.holderAccounts.push(tokenAccount);
    fixture.ownerByAccount.set(tokenAccount, b58(holder.publicKey));
    await transfer(`controlled distribution ${[10n, 20n, 5n][index]}`, setup.treasuryTokenAccount,
      tokenAccount, administrator, [10n, 20n, 5n][index]);
  }
  const activation = await client.buildControlledInstrumentActivation({ ...identity, bondMint: setup.bondMint,
    holderTokenAccounts: fixture.holderAccounts });
  await send("activate complete frozen registry", [activation.instruction]);
  assert.equal(client.decodeConfirmedInstrumentAccount((await read(setup.instrumentAddress)).data.toString("base64")).status, "ACTIVE");
  Object.assign(evidence.identities, { instrumentAddress: fixture.instrumentAddress, instrumentAuthority: fixture.instrumentAuthority,
    bondMint: fixture.bondMint, settlementMint: fixture.settlementMint, controlledPolicyAddress: fixture.controlledPolicyAddress,
    treasuryTokenAccount: fixture.treasuryTokenAccount, investorIds: investorIds.map(value => value.toString("hex")) });
  await checkpoint("35 bonds distributed to three holders", { expectedBalances: [10n, 20n, 5n] });
  pass("version 2 default-frozen mint, program bootstrap, controlled 10/20/5 distribution and activation");
}

try {
  const genesisHash = await connection.getGenesisHash();
  assert.equal(b58(pk(genesisHash)), genesisHash, "Disposable validator genesis hash must be a canonical 32-byte base58 value");
  evidence.identities.genesisHash = genesisHash;
  console.log(`Disposable validator genesis: ${genesisHash}`);
  // All keypairs except the temporary administrator remain in process memory.
  for (const signer of [administrator, approver, outsider, ...holders]) {
    const signature = await connection.requestAirdrop(signer.publicKey, 3_000_000_000);
    await connection.confirmTransaction(signature, "finalized");
  }
  await createFixture();
  await runAcceptance();
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAIL";
  evidence.failure = { message: String(error.message), stack: String(error.stack) };
  throw error;
} finally {
  evidence.completedAt = new Date().toISOString();
  const payload = json(evidence) + "\n";
  const evidencePath = resolve(evidenceDirectory, "controlled-registry-evidence.json");
  const evidenceHash = sha256(payload);
  await writeFile(evidencePath, payload, { flag: "wx" });
  await writeFile(resolve(evidenceDirectory, "controlled-registry-evidence.sha256"), `${evidenceHash}  controlled-registry-evidence.json\n`, { flag: "wx" });
  console.log(`Controlled-registry evidence: ${evidencePath}`);
  console.log(`Controlled-registry evidence SHA-256: ${evidenceHash}`);
}

async function runAcceptance() {
  await testFrozenLanes();
  const coupon = await captureCoupon();
  await testCouponRightsAfterResume(coupon);
  const sources = await prepareMultipleSources();
  await testReservedRedemption(sources);
}

async function protectedAddresses(action) {
  return [fixture.instrumentAddress, fixture.controlledPolicyAddress, fixture.bondMint,
    ...(action ? [action.actionAddress, action.controlledCaptureAddress] : []), ...fixture.tokenAccounts,
    ...await Promise.all(fixture.tokenAccounts.map(value => client.deriveControlledHoldingAddress(identity.programId, fixture.instrumentAddress, value)))];
}

async function testFrozenLanes() {
  const [source, destination] = fixture.holderAccounts;
  const protectedState = await protectedAddresses();
  const rawCases = [
    ["direct Token-2022 transfer", createTransferCheckedInstruction(pk(source), pk(fixture.bondMint), pk(destination), holders[0].publicKey, 1n, 0, [], TOKEN_2022_PROGRAM_ID)],
    ["direct holder burn", createBurnCheckedInstruction(pk(source), pk(fixture.bondMint), holders[0].publicKey, 1n, 0, [], TOKEN_2022_PROGRAM_ID)],
    ["holder thaw bypass", createThawAccountInstruction(pk(source), pk(fixture.bondMint), holders[0].publicKey, [], TOKEN_2022_PROGRAM_ID)],
    ["holder delegation bypass", createApproveInstruction(pk(source), outsider.publicKey, holders[0].publicKey, 1n, [], TOKEN_2022_PROGRAM_ID)],
    ["holder authority replacement", createSetAuthorityInstruction(pk(source), holders[0].publicKey, AuthorityType.AccountOwner, outsider.publicKey, [], TOKEN_2022_PROGRAM_ID)],
  ];
  for (const [label, raw] of rawCases) {
    await unchangedOnFailure(label, () => send(label, [raw], [holders[0]]), protectedState, /frozen|authority|owner|custom program error/i);
  }
  await unchangedOnFailure("issuer freeze authority replacement", () => send("issuer freeze authority replacement", [
    createSetAuthorityInstruction(pk(fixture.bondMint), administrator.publicKey, AuthorityType.FreezeAccount, administrator.publicKey, [], TOKEN_2022_PROGRAM_ID),
  ]), protectedState, /authority|owner|custom program error/i);
  const wrongOwner = await client.buildControlledTransfer({ ...identity, holder: b58(outsider.publicKey), bondMint: fixture.bondMint,
    sourceTokenAccount: source, destinationTokenAccount: destination, amount: 1n });
  await unchangedOnFailure("controlled transfer wrong holder", () => send("wrong holder", [wrongOwner.instruction], [administrator, outsider]), protectedState, /holding|owner|custom program error/i);
  const wrongAuthority = await client.buildControlledTransfer({ ...identity, corporateActionAuthority: b58(outsider.publicKey),
    holder: b58(holders[0].publicKey), bondMint: fixture.bondMint, sourceTokenAccount: source, destinationTokenAccount: destination, amount: 1n });
  await unchangedOnFailure("controlled transfer wrong CA authority", () => send("wrong CA authority", [wrongAuthority.instruction], [outsider, holders[0]]), protectedState, /authority|custom program error/i);
  await checkpoint("unauthorized lanes reject without balance or freeze changes");
  pass("direct transfer, burn, thaw, delegate and authority bypasses reject; wrong controlled signers roll back");
}

async function schedule(type, targetTokens) {
  const now = await chainTime();
  const actionId = uuidBytes();
  const plan = await client.buildCorporateActionSchedule({ ...identity, actionId, type, recordAt: now + 3n, executeAt: now + 3n,
    redemptionPercentageBps: null, redemptionPriceMinor: targetTokens ? 1_000_000_000n : null,
    ...(targetTokens ? { allocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: targetTokens } : {}) });
  await send(`schedule ${type}${targetTokens ? ` ${targetTokens} bonds` : ""}`, [plan.instruction]);
  const begin = await client.buildControlledCaptureBegin({ ...identity, actionId });
  return { ...plan, ...begin, actionId, recordAt: now + 3n, executeAt: now + 3n };
}

async function recordPlan(action, tokenAccounts) {
  const rows = await Promise.all(tokenAccounts.map(tokenState));
  const snapshotHash = sha256(json({ actionAddress: action.actionAddress, rows }));
  const plan = await client.buildControlledCaptureRecord({ ...identity, actionId: action.actionId, bondMint: fixture.bondMint,
    snapshotHash, snapshotSlot: (await captureState(action)).startedSlot, investorCount: 3, walletCount: 3,
    totalBalance: 35n, mintSupply: 35n, holderTokenAccounts: tokenAccounts });
  return { ...plan, snapshotHash, rows };
}

async function captureCoupon() {
  const action = await schedule("COUPON_PAYMENT");
  await waitUntil(action.recordAt);
  await send("begin abortable capture", [action.instruction]);
  const abort = await client.buildControlledCaptureAbort({ ...identity, actionId: action.actionId });
  await send("abort uncommitted capture", [abort.instruction]);
  assert.equal(await connection.getAccountInfo(pk(action.controlledCaptureAddress), "finalized"), null);
  await send("begin coupon capture", [action.instruction]);
  await collectRawRegistry(action);
  const controlledTransfer = await client.buildControlledTransfer({ ...identity, holder: b58(holders[0].publicKey), bondMint: fixture.bondMint,
    sourceTokenAccount: fixture.holderAccounts[0], destinationTokenAccount: fixture.holderAccounts[1], amount: 1n });
  const protectedState = await protectedAddresses(action);
  await unchangedOnFailure("transfer blocked throughout capture", () => send("transfer during capture", [controlledTransfer.instruction], [administrator, holders[0]]), protectedState, /capture|custom program error/i);
  const prematureFinish = await client.buildControlledCaptureFinish({ ...identity, actionId: action.actionId });
  await unchangedOnFailure("capture finish before commitment", () => send("finish before commitment", [prematureFinish.instruction]), protectedState, /capture|status|custom program error/i);
  const complete = await recordPlan(action, fixture.holderAccounts);
  const legacy = await client.buildSnapshotRegistrationInstruction({ ...identity, issuerAuthority: identity.issuerAuthority,
    actionId: action.actionId, bondMint: fixture.bondMint, snapshotHash: complete.snapshotHash,
    snapshotSlot: BigInt(await connection.getSlot("finalized")), investorCount: 3, walletCount: 3, totalBalance: 35n, mintSupply: 35n });
  await unchangedOnFailure("legacy snapshot bypass rejects controlled mint", () => send("legacy snapshot bypass", [legacy]), protectedState, /freeze|mint|custom program error/i);
  const omitted = await recordPlan(action, fixture.holderAccounts.slice(0, 2));
  await unchangedOnFailure("capture omission cannot commit", () => send("omitted capture source", [omitted.instruction]), protectedState, /supply|capture|custom program error/i);
  const wrongHolding = { ...complete.instruction, accounts: complete.instruction.accounts.map((value, index) => index === 8
    ? { ...value, address: fixture.controlledPolicyAddress } : value) };
  await unchangedOnFailure("capture wrong holding PDA", () => send("wrong capture holding", [wrongHolding]), protectedState, /holding|constraint|custom program error/i);
  await send("commit complete coupon capture", [complete.instruction]);
  action.snapshotHash = complete.snapshotHash;
  evidence.checkpoints.push({ label: "coupon immutable captured registry", actionAddress: action.actionAddress,
    controlledCaptureAddress: action.controlledCaptureAddress, snapshotHash: complete.snapshotHash, rows: complete.rows });
  const committedState = await protectedAddresses(action);
  await unchangedOnFailure("committed capture cannot abort", () => send("unsafe committed abort", [abort.instruction]), committedState, /capture|status|custom program error/i);
  await send("finish coupon capture and resume", [prematureFinish.instruction]);
  assert.equal((await actionState(action.actionAddress)).status, "SNAPSHOT_CREATED");
  pass("capture blocks transfers, rejects omissions and wrong PDAs, permits safe pre-commit abort and rejects post-commit abort");
  return action;
}

async function testCouponRightsAfterResume(action) {
  const entitlements = [];
  for (const [index, balance] of [10n, 20n, 5n].entries()) {
    const plan = await client.buildEntitlementRegistration({ ...identity, actionId: action.actionId, investorId: investorIds[index],
      snapshotHash: action.snapshotHash, settlementWallet: b58(holders[index].publicKey), balanceAtSnapshot: balance,
      eligible: true, paymentAmountMinor: balance * 50_000_000n, tokensToRedeem: 0n });
    await send(`register coupon entitlement ${index + 1}`, [plan.instruction]);
    entitlements.push(plan.entitlementAddress);
  }
  const final = await client.buildCalculationFinalization({ ...identity, actionId: action.actionId, investorIds });
  await send("finalize coupon snapshot calculation", [final.instruction]);
  const bytesBefore = await Promise.all(entitlements.map(accountDigest));
  await transfer("post-capture holder transfer", fixture.holderAccounts[0], fixture.holderAccounts[1], holders[0], 1n);
  assert.deepEqual(await Promise.all(entitlements.map(accountDigest)), bytesBefore);
  assert.equal(client.decodeConfirmedEntitlement((await read(entitlements[0])).data.toString("base64")).paymentAmountMinor, 500_000_000n);
  await transfer("restore fixture after coupon-right check", fixture.holderAccounts[1], fixture.holderAccounts[0], holders[1], 1n);
  await checkpoint("coupon rights unchanged after resumed transfers", { entitlementHashes: bytesBefore });
  pass("coupon rights remain 500/1000/250 KZT-Test after transfers resume");
}

async function prepareMultipleSources() {
  // Both additional source addresses have disposable in-memory signers, so closing/recreating the zero-assignment source is reproducible.
  const extraSources = [Keypair.generate(), Keypair.generate()].sort((left, right) => b58(left.publicKey) < b58(right.publicKey) ? -1 : 1);
  const size = getAccountLen([ExtensionType.ImmutableOwner]);
  const sorted = [];
  for (const [index, extra] of extraSources.entries()) {
    await send("create additional frozen token account for one holder", [SystemProgram.createAccount({ fromPubkey: administrator.publicKey,
      newAccountPubkey: extra.publicKey, lamports: await connection.getMinimumBalanceForRentExemption(size), space: size, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeImmutableOwnerInstruction(extra.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeAccount3Instruction(extra.publicKey, pk(fixture.bondMint), holders[0].publicKey, TOKEN_2022_PROGRAM_ID)], [administrator, extra]);
    const extraAddress = b58(extra.publicKey);
    const registration = await client.buildControlledHoldingRegistration({ ...identity, bondTokenAccount: extraAddress });
    await send("register additional controlled holding", [registration.instruction]);
    fixture.tokenAccounts.push(extraAddress);
    fixture.ownerByAccount.set(extraAddress, b58(holders[0].publicKey));
    sorted.push(extraAddress);
    await transfer(`split first holder into canonical source ${index + 1}`, fixture.holderAccounts[0], extraAddress, holders[0], index === 0 ? 8n : 2n);
  }
  fixture.extraSourceKeypair = extraSources[1];
  const sources = [[...sorted], [fixture.holderAccounts[1]], [fixture.holderAccounts[2]]];
  const tokenAccounts = await Promise.all(sources.map(async addresses => Promise.all(addresses.map(async address => {
    const state = await tokenState(address);
    return { address, wallet: state.wallet, balanceAtSnapshot: state.amount };
  }))));
  assert.deepEqual(tokenAccounts[0].map(value => value.balanceAtSnapshot), [8n, 2n]);
  fixture.positiveCaptureAccounts = sources.flat();
  await enableHolderAccountGuards("holder enables CPI guard and required memos before capture", sorted[0], holders[0]);
  fixture.guardedBeforeCaptureAddress = sorted[0];
  await checkpoint("four sources reconcile to three holders and supply 35");
  return tokenAccounts;
}

async function collectRawRegistry(action) {
  let requestId = 0;
  const rpc = { request: async (method, params) => {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }), signal: AbortSignal.timeout(10_000) });
    assert.equal(response.ok, true, "Disposable RPC response must succeed");
    const payload = await response.json();
    if (payload.error) throw new Error(`Disposable RPC ${method} failed: ${JSON.stringify(payload.error)}`);
    return payload.result;
  } };
  const captureStartedSlot = (await captureState(action)).startedSlot;
  const registry = await client.collectControlledTokenPositions(rpc, fixture.bondMint, Number(captureStartedSlot));
  assert.ok(BigInt(registry.slot) >= captureStartedSlot, "Finalized raw registry must be captured after the transfer lock began");
  assert.equal(registry.supply, 35n);
  assert.deepEqual(registry.positivePositions.map(value => value.address).sort(), fixture.positiveCaptureAccounts?.slice().sort() ?? fixture.holderAccounts.slice().sort());
  for (const position of registry.positions) assert.equal(position.state, "FROZEN");
  if (fixture.guardedBeforeCaptureAddress) {
    const guarded = registry.positivePositions.find(position => position.address === fixture.guardedBeforeCaptureAddress);
    assert.ok(guarded, "Guarded positive position must be present in the finalized raw capture");
    assert.equal(guarded.extensions.find(extension => extension.type === ExtensionType.CpiGuard)?.dataHex, "01");
    assert.equal(guarded.extensions.find(extension => extension.type === ExtensionType.MemoTransfer)?.dataHex, "01");
  }
  evidence.checkpoints.push({ label: "finalized complete raw token registry while capture gate held", actionAddress: action.actionAddress,
    captureStartedSlot, registry, rawRegistrySha256: sha256(json(registry)) });
  return registry;
}

async function reservationState(action, reservation) {
  return client.decodeControlledUnitReservation(await controlledInput(reservation.unitReservationAddress), { programId: identity.programId,
    accountAddress: reservation.unitReservationAddress, actionAddress: action.actionAddress, entitlementAddress: reservation.entitlementAddress,
    snapshotHash: action.snapshotHash, sourceHash: reservation.sourceHash });
}

async function testReservedRedemption(sources) {
  const action = await schedule("EARLY_REDEMPTION", 8n);
  // A second scheduled redemption is harmless; starting its capture while the first is unfinished must reject.
  const second = await schedule("EARLY_REDEMPTION", 1n);
  await waitUntil(second.recordAt > action.recordAt ? second.recordAt : action.recordAt);
  await send("begin exact-target redemption capture", [action.instruction]);
  await collectRawRegistry(action);
  await unchangedOnFailure("second capture blocked while capture active", () => send("second capture while active", [second.instruction]),
    [...await protectedAddresses(action), second.actionAddress, second.controlledCaptureAddress], /lock|capture|custom program error/i);
  const snapshot = await recordPlan(action, fixture.positiveCaptureAccounts);
  await send("commit complete four-account redemption registry", [snapshot.instruction]);
  action.snapshotHash = snapshot.snapshotHash;
  const units = [2n, 5n, 1n];
  const balances = [10n, 20n, 5n];
  const registrations = [];
  const reservations = [];
  for (const [index, investorId] of investorIds.entries()) {
    const entitlement = await client.buildEntitlementRegistration({ ...identity, actionId: action.actionId, investorId,
      allocationPolicy: "exact-target-largest-remainder-v2", snapshotHash: action.snapshotHash, settlementWallet: b58(holders[index].publicKey),
      balanceAtSnapshot: balances[index], eligible: true, paymentAmountMinor: units[index] * 1_000_000_000n, tokensToRedeem: units[index] });
    const source = await client.buildControlledRedemptionSourceRegistration({ ...identity, actionId: action.actionId, investorId,
      bondMint: fixture.bondMint, tokenAccounts: sources[index], snapshotHash: action.snapshotHash });
    await send(`register exact entitlement and immutable sources ${index + 1}`, [entitlement.instruction, source.instruction]);
    registrations.push(source);
    reservations.push(await client.buildControlledUnitReservation({ ...identity, actionId: action.actionId, investorId,
      bondMint: fixture.bondMint, tokenAccounts: sources[index], snapshotHash: action.snapshotHash }));
  }
  const firstReservation = reservations[0];
  await unchangedOnFailure("unit reservation before complete calculation", () => send("reserve before final calculation", [firstReservation.instruction]),
    [...await protectedAddresses(action), firstReservation.unitReservationAddress], /status|reservation|custom program error/i);
  const finish = await client.buildControlledCaptureFinish({ ...identity, actionId: action.actionId, investorIds });
  await unchangedOnFailure("incomplete redemption capture cannot finish", () => send("finish without reservations", [finish.instruction]),
    [...await protectedAddresses(action), ...reservations.map(value => value.unitReservationAddress)], /capture|complete|custom program error/i);
  const calculation = await client.buildCalculationFinalization({ ...identity, actionId: action.actionId, investorIds,
    allocationPolicy: "exact-target-largest-remainder-v2", redemption: true });
  await send("validate exact target global 2/5/1 allocation", [calculation.instruction]);
  assert.equal((await actionState(action.actionAddress)).status, "UNDER_REVIEW");
  const badReservation = { ...firstReservation.instruction, accounts: firstReservation.instruction.accounts.map((value, index) =>
    index === 12 + firstReservation.tokenAccounts.length ? { ...value, address: fixture.controlledPolicyAddress } : value) };
  await unchangedOnFailure("unit reservation wrong holding PDA", () => send("reserve wrong holding", [badReservation]),
    [...await protectedAddresses(action), firstReservation.unitReservationAddress], /holding|policy|reservation|custom program error/i);
  for (const [index, reservation] of reservations.entries()) {
    await send(`reserve assigned units ${units[index]}`, [reservation.instruction]);
    const reserved = await reservationState(action, reservation);
    assert.deepEqual(reserved.allocations, index === 0 ? [2n, 0n] : [units[index]]);
    assert.equal(reserved.consumed, false);
    assert.equal(client.decodeRedemptionSources((await read(reservation.sourceAddress)).data.toString("base64")).sourceHash, reservation.sourceHash);
  }
  await unchangedOnFailure("duplicate unit reservation rejects", () => send("duplicate reservation", [firstReservation.instruction]),
    [...await protectedAddresses(action), firstReservation.unitReservationAddress], /already in use|initialized|custom program error/i);
  const incompleteFinish = await client.buildControlledCaptureFinish({ ...identity, actionId: action.actionId, investorIds: investorIds.slice(0, 2) });
  await unchangedOnFailure("capture finish requires every investor reservation", () => send("finish omitted reservation", [incompleteFinish.instruction]),
    [...await protectedAddresses(action), ...reservations.map(value => value.unitReservationAddress)], /capture|complete|custom program error/i);
  const unsafeAbort = await client.buildControlledCaptureAbort({ ...identity, actionId: action.actionId });
  await unchangedOnFailure("assigned reservations cannot be aborted", () => send("abort reserved capture", [unsafeAbort.instruction]),
    [...await protectedAddresses(action), ...reservations.map(value => value.unitReservationAddress)], /capture|complete|custom program error/i);
  const captured = await captureState(action);
  assert.equal(captured.reservedTokens, 8n);
  assert.equal(captured.reservedEntitlements, 3);
  assert.ok(captured.reservedSources.every(value => value === 1));
  evidence.checkpoints.push({ label: "exact reserved source assignments", actionAddress: action.actionAddress,
    capture: captured, reservations: await Promise.all(reservations.map(value => reservationState(action, value))) });
  await send("finish fully reserved capture and resume unreserved units", [finish.instruction]);
  await unchangedOnFailure("second redemption blocked until first finalizes", () => send("second unfinished redemption", [second.instruction]),
    [...await protectedAddresses(action), second.actionAddress, second.controlledCaptureAddress], /lock|capture|custom program error/i);
  const completion = await client.buildControlledRedemptionCompletion({ ...identity, actionId: action.actionId });
  await unchangedOnFailure("redemption completion before final receipt rejects", () => send("complete before finalized", [completion.instruction]),
    await protectedAddresses(action), /lock|finalized|custom program error/i);
  await moveAllUnreservedUnits(action, sources, reservations);
  await testMutableSourceLiveness(action, sources);
  await fundApproveAndExecute(action, sources, reservations, units);
  pass("CPI guard and memo settings before and after reservation preserve outgoing transfers and redemption; recreated zero-assignment source cannot block settlement");
  await send("release unfinished-redemption lock after finalization", [completion.instruction]);
  const policy = await policyState();
  assert.equal(policy.activeRedemption, b58(SystemProgram.programId));
  assert.equal(policy.captureAction, b58(SystemProgram.programId));
  await send("next redemption capture allowed after finalization", [second.instruction]);
  const abortSecond = await client.buildControlledCaptureAbort({ ...identity, actionId: second.actionId });
  await send("safely abort next uncommitted capture", [abortSecond.instruction]);
  await checkpoint("finalized supply 27 and no active capture or redemption lock", { policy: await policyState() });
  pass("exact target 8 reserves 2/5/1, unreserved units move, cash and burn settle atomically, receipts finalize supply 27");
}

async function moveAllUnreservedUnits(action, sources, reservations) {
  const primary = sources[0][0].address;
  const secondary = sources[0][1].address;
  const memoRequiredDestination = await client.buildControlledTransfer({ ...identity, holder: b58(holders[1].publicKey), bondMint: fixture.bondMint,
    sourceTokenAccount: sources[1][0].address, destinationTokenAccount: primary, amount: 1n });
  await unchangedOnFailure("incoming transfer to memo-required holder fails and rolls back", () => send("incoming without required memo", [memoRequiredDestination.instruction], [administrator, holders[1]]),
    [...await protectedAddresses(action), ...reservations.map(value => value.unitReservationAddress)], /memo|custom program error/i);
  const invalid = await client.buildControlledTransfer({ ...identity, holder: b58(holders[0].publicKey), bondMint: fixture.bondMint,
    sourceTokenAccount: primary, destinationTokenAccount: fixture.treasuryTokenAccount, amount: 7n });
  await unchangedOnFailure("reserved-unit transfer boundary rejects seven of eight", () => send("move reserved units", [invalid.instruction], [administrator, holders[0]]),
    [...await protectedAddresses(action), ...reservations.map(value => value.unitReservationAddress)], /reserved|custom program error/i);
  for (const [index, entries] of sources.entries()) {
    const allocated = (await reservationState(action, reservations[index])).allocations;
    for (const [sourceIndex, source] of entries.entries()) {
      const holding = await holdingState(source.address);
      assert.equal(holding.reservedTokens, allocated[sourceIndex]);
      const available = source.balanceAtSnapshot - allocated[sourceIndex];
      if (available > 0n) await transfer(`move ${available} unreserved units from original source`, source.address,
        fixture.treasuryTokenAccount, holders[index], available);
      assert.equal((await tokenState(source.address)).amount, allocated[sourceIndex]);
      assert.equal((await holdingState(source.address)).reservedTokens, allocated[sourceIndex]);
    }
  }
  assert.equal((await tokenState(fixture.treasuryTokenAccount)).amount, 27n);
  await send("close drained zero-assignment snapshot source", [createCloseAccountInstruction(pk(secondary), holders[0].publicKey,
    holders[0].publicKey, [], TOKEN_2022_PROGRAM_ID)], [holders[0]]);
  assert.equal(await connection.getAccountInfo(pk(secondary), "finalized"), null);
  assert.equal((await holdingState(secondary)).reservedTokens, 0n);
  await checkpoint("27 unreserved units moved; original zero-assignment source closed", { reservedOriginalSources: [primary, fixture.holderAccounts[1], fixture.holderAccounts[2]] });
  pass("reserved boundary rejects and rolls back; all 27 unreserved units move; zero-assignment original source closes safely");
}

async function fundApproveAndExecute(action, sources, reservations, units) {
  const approvalInput = { ...identity, actionId: action.actionId, issuer: identity.issuerAuthority,
    approver: b58(approver.publicKey), settlementMint: fixture.settlementMint, networkReserveLamports: 50_000_000n,
    snapshotHash: action.snapshotHash, amountMinor: 8_000_000_000n };
  const assign = await client.buildActionApproval({ ...approvalInput, phase: "ASSIGN_APPROVER" });
  await send("assign distinct approver", [assign.instruction]);
  const cashTreasury = b58(getAssociatedTokenAddressSync(pk(fixture.settlementMint), administrator.publicKey, false, TOKEN_2022_PROGRAM_ID));
  await send("create empty cash treasury", [createAssociatedTokenAccountIdempotentInstruction(administrator.publicKey, pk(cashTreasury),
    administrator.publicKey, pk(fixture.settlementMint), TOKEN_2022_PROGRAM_ID)]);
  const reserve = await client.buildActionApproval({ ...approvalInput, phase: "RESERVE" });
  await unchangedOnFailure("insufficient cash cannot reserve or mutate assigned units", () => send("cash-short reserve", [reserve.instruction]),
    [...await protectedAddresses(action), ...reservations.map(value => value.unitReservationAddress), reserve.reserveAddress, reserve.vaultAddress, cashTreasury], /insufficient|custom program error/i);
  assert.equal(await connection.getAccountInfo(pk(reserve.reserveAddress), "finalized"), null);
  assert.equal(await connection.getAccountInfo(pk(reserve.vaultAddress), "finalized"), null);
  await send("fund exact simulated cash requirement", [createMintToCheckedInstruction(pk(fixture.settlementMint), pk(cashTreasury),
    administrator.publicKey, 8_000_000_000n, 6, [], TOKEN_2022_PROGRAM_ID)]);
  await send("reserve full immutable cash requirement", [reserve.instruction]);
  assert.equal((await getAccount(connection, pk(reserve.vaultAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, 8_000_000_000n);
  const approve = await client.buildActionApproval({ ...approvalInput, phase: "APPROVE" });
  const wrongApprover = { ...approve.instruction, accounts: approve.instruction.accounts.map((value, index) => index === 0
    ? { ...value, address: b58(outsider.publicKey) } : value) };
  await unchangedOnFailure("unassigned approver rejects full cash reserve", () => send("wrong reserve approver", [wrongApprover], [outsider]),
    [...await protectedAddresses(action), reserve.reserveAddress, reserve.vaultAddress], /approver|authority|custom program error/i);
  await send("distinct approver approves full cash reserve", [approve.instruction], [approver]);
  assert.equal((await actionState(action.actionAddress)).status, "APPROVED");
  const final = await client.buildRedemptionFinalization({ ...identity, actionId: action.actionId, bondMint: fixture.bondMint,
    investorIds, receiptHash: sha256(json({ action: action.actionAddress, target: 8, snapshotHash: action.snapshotHash })) });
  await unchangedOnFailure("incomplete redemption cannot finalize", () => send("finalize before execution", [final.instruction]),
    [...await protectedAddresses(action), final.actionReceiptAddress], /redemption|complete|custom program error/i);
  const receiptHashes = [];
  for (const [index, investorId] of investorIds.entries()) {
    const plan = await client.buildControlledRedemptionExecution({ ...identity, actionId: action.actionId, investorId,
      bondMint: fixture.bondMint, settlementMint: fixture.settlementMint, settlementWallet: b58(holders[index].publicKey),
      idempotencyHash: sha256(`controlled acceptance ${action.actionAddress} ${index}`), tokenAccounts: sources[index] });
    if (index === 0) {
      const wrongRecipient = { ...plan.instruction, accounts: plan.instruction.accounts.map((value, accountIndex) => accountIndex === 10
        ? { ...value, address: cashTreasury } : value) };
      await unchangedOnFailure("wrong redemption recipient rejects before settlement with protected state unchanged", () => send("wrong atomic recipient", [plan.instructions[0], wrongRecipient]),
        [...await protectedAddresses(action), reserve.vaultAddress, cashTreasury, plan.redemptionReceiptAddress, plan.recipientAddress, plan.unitReservationAddress], /constraint|owner|custom program error/i);
    }
    const supplyBefore = (await getMint(connection, pk(fixture.bondMint), "finalized", TOKEN_2022_PROGRAM_ID)).supply;
    const signature = await send(`atomic controlled payment and burn ${units[index]}`, plan.instructions);
    const receipt = client.decodeRedemptionReceipt((await read(plan.redemptionReceiptAddress)).data.toString("base64"));
    assert.equal(receipt.tokensRedeemed, units[index]);
    assert.equal(receipt.amountMinor, units[index] * 1_000_000_000n);
    assert.equal(receipt.mintSupplyBefore, supplyBefore);
    assert.equal(receipt.mintSupplyAfter, supplyBefore - units[index]);
    assert.equal((await getAccount(connection, pk(plan.recipientAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, units[index] * 1_000_000_000n);
    assert.equal((await reservationState(action, reservations[index])).consumed, true);
    for (const source of sources[index]) assert.equal((await holdingState(source.address)).reservedTokens, 0n);
    const completedAddresses = [...await protectedAddresses(action), reserve.vaultAddress, plan.redemptionReceiptAddress, plan.recipientAddress, plan.unitReservationAddress];
    await unchangedOnFailure("same-key redemption replay rejects", () => send("replay atomic payment", plan.instructions), completedAddresses, /already in use|initialized|custom program error/i);
    const differentKey = await client.buildControlledRedemptionExecution({ ...identity, actionId: action.actionId, investorId,
      bondMint: fixture.bondMint, settlementMint: fixture.settlementMint, settlementWallet: b58(holders[index].publicKey),
      idempotencyHash: sha256(`controlled acceptance replay ${action.actionAddress} ${index}`), tokenAccounts: sources[index] });
    await unchangedOnFailure("different-key redemption replay rejects", () => send("replay with changed key", differentKey.instructions), completedAddresses, /already in use|initialized|custom program error/i);
    const digest = await accountDigest(plan.redemptionReceiptAddress);
    receiptHashes.push({ ...digest, signature, receipt });
    await checkpoint(`atomic redemption ${index + 1} finalized`, { receipt, signature });
  }
  assert.equal((await getMint(connection, pk(fixture.bondMint), "finalized", TOKEN_2022_PROGRAM_ID)).supply, 27n);
  assert.equal((await getAccount(connection, pk(reserve.vaultAddress), "finalized", TOKEN_2022_PROGRAM_ID)).amount, 0n);
  await send("finalize redemption receipt and supply reconciliation", [final.instruction]);
  assert.equal((await actionState(action.actionAddress)).status, "FINALIZED");
  const receipt = client.decodeActionReceipt((await read(final.actionReceiptAddress)).data.toString("base64"));
  assert.equal(receipt.amountMinor, 8_000_000_000n);
  assert.equal(receipt.processedEntitlements, 3);
  evidence.checkpoints.push({ label: "immutable finalized redemption receipts", actionAddress: action.actionAddress,
    actionReceipt: { ...await accountDigest(final.actionReceiptAddress), receipt }, entitlementReceipts: receiptHashes });
  pass("cash-short funding and wrong recipient roll back; distinct approval, exact finalized deltas and both replay forms verified");
}

async function testMutableSourceLiveness(action, sources) {
  const guardedSource = sources[1][0].address;
  await enableHolderAccountGuards("holder enables CPI guard and required memos after unit reservation", guardedSource, holders[1]);
  const guarded = await getAccount(connection, pk(guardedSource), "finalized", TOKEN_2022_PROGRAM_ID);
  assert.equal(guarded.isFrozen, true);
  assert.equal(guarded.amount, 5n);
  assert.equal(getCpiGuard(guarded).lockCpi, true);
  assert.equal((await holdingState(guardedSource)).reservedTokens, 5n);
  const recreatedSource = sources[0][1].address;
  assert.equal(b58(fixture.extraSourceKeypair.publicKey), recreatedSource);
  const size = getAccountLen([ExtensionType.ImmutableOwner]);
  await send("recreate closed zero-assignment source with different owner", [
    SystemProgram.createAccount({ fromPubkey: administrator.publicKey, newAccountPubkey: fixture.extraSourceKeypair.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(size), space: size, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeImmutableOwnerInstruction(fixture.extraSourceKeypair.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeAccount3Instruction(fixture.extraSourceKeypair.publicKey, pk(fixture.bondMint), outsider.publicKey, TOKEN_2022_PROGRAM_ID),
  ], [administrator, fixture.extraSourceKeypair]);
  const recreated = await tokenState(recreatedSource);
  assert.equal(recreated.amount, 0n);
  assert.equal(recreated.wallet, b58(outsider.publicKey));
  assert.equal(recreated.frozen, true);
  assert.equal((await holdingState(recreatedSource)).reservedTokens, 0n);
  assert.equal(getMemoTransfer(guarded).requireIncomingTransferMemos, true);
  await checkpoint("reserved source has CPI guard and memo settings; zero-assignment source was recreated with a different owner", {
    guardedSource, cpiGuardEnabled: true, requiredIncomingMemos: true, recreatedSource, expectedUnchangedReservedUnits: 8n });
}

async function enableHolderAccountGuards(label, address, holder) {
  const before = await tokenState(address);
  await send(label, [
    createReallocateInstruction(pk(address), administrator.publicKey, [ExtensionType.ImmutableOwner, ExtensionType.CpiGuard, ExtensionType.MemoTransfer],
      holder.publicKey, [], TOKEN_2022_PROGRAM_ID),
    createEnableCpiGuardInstruction(pk(address), holder.publicKey, [], TOKEN_2022_PROGRAM_ID),
    createEnableRequiredMemoTransfersInstruction(pk(address), holder.publicKey, [], TOKEN_2022_PROGRAM_ID),
  ], [administrator, holder]);
  const after = await getAccount(connection, pk(address), "finalized", TOKEN_2022_PROGRAM_ID);
  assert.equal(after.amount, before.amount);
  assert.equal(after.isFrozen, true);
  assert.equal(getCpiGuard(after).lockCpi, true);
  assert.equal(getMemoTransfer(after).requireIncomingTransferMemos, true);
}
