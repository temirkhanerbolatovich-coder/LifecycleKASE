import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { decodePublicKey, encodePublicKey } from "./base58.js";
import { buildInstrumentMintSetup } from "./instrument-mint-setup.js";
import { TOKEN_2022_PROGRAM_ID } from "./holder-registry.js";
import { buildRedemptionExecution } from "./redemption-execution.js";
import { buildSnapshotRegistrationInstruction } from "./snapshot-registration.js";
import {
  CONTROLLED_BOND_MINT_SIZE, CONTROLLED_CAPTURE_BYTES, CONTROLLED_HOLDING_BYTES, CONTROLLED_POLICY_BYTES,
  CONTROLLED_UNIT_RESERVATION_BYTES, buildControlledCaptureAbort, buildControlledCaptureBegin, buildControlledCaptureFinish,
  buildControlledCaptureRecord, buildControlledHoldingRegistration, buildControlledInstrumentActivation,
  buildControlledInstrumentInitialization, buildControlledMintSetup, buildControlledRedemptionCompletion,
  buildControlledRedemptionExecution, buildControlledRedemptionSourceRegistration, buildControlledTransfer,
  buildControlledUnitReservation, collectControlledTokenPositions, decodeControlledCapture, decodeControlledHolding,
  decodeControlledPolicy, decodeControlledTokenPosition, decodeControlledUnitReservation, deriveControlledCaptureAddress,
  deriveControlledHoldingAddress, deriveControlledPolicyAddress, deriveControlledUnitReservationAddress,
  type ControlledAccountData,
} from "./controlled-registry.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const publicKey = (byte: number) => encodePublicKey(Buffer.alloc(32, byte));
const ADMIN = publicKey(1); const HOLDER = publicKey(2); const MINT = publicKey(3); const SETTLEMENT = publicKey(4);
const SOURCE = publicKey(5); const OTHER_SOURCE = publicKey(6); const DESTINATION = publicKey(7);
const instrumentId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const actionId = Uint8Array.from({ length: 16 }, (_, index) => index + 17);
const investorId = Uint8Array.from({ length: 16 }, (_, index) => index + 33);
const instrumentIdentity = { programId: PROGRAM, instrumentId };
const actionIdentity = { ...instrumentIdentity, actionId, corporateActionAuthority: ADMIN };
const snapshotHash = "12".repeat(32); const sourceHash = "34".repeat(32);
const mintInput = { ...instrumentIdentity, administrator: ADMIN, bondRentLamports: 2_000_000n, settlementRentLamports: 1_500_000n, totalSupply: 35n };
const sources = [ { address: OTHER_SOURCE, wallet: HOLDER, balanceAtSnapshot: 2n }, { address: SOURCE, wallet: HOLDER, balanceAtSnapshot: 8n } ];
const disc = (namespace: string, name: string) => createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
const instructionName = (data: Uint8Array, name: string) => assert.deepEqual(Buffer.from(data).subarray(0, 8), disc("global", name));
const u64 = (value: bigint) => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes; };
const u32 = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
const pk = (value: string) => Buffer.from(decodePublicKey(value));

function accountData(name: string, accountAddress: string, size: number, fields: readonly Uint8Array[]): ControlledAccountData {
  const encoded = Buffer.concat([disc("account", name), Buffer.from([1]), ...fields]);
  assert.equal(encoded.length <= size, true);
  return { address: accountAddress, owner: PROGRAM, executable: false, dataBase64: Buffer.concat([encoded, Buffer.alloc(size - encoded.length)]).toString("base64") };
}

function tokenAccount(tokenAddress = SOURCE, balance = 8n, state = 2): ControlledAccountData {
  const data = Buffer.alloc(170); pk(MINT).copy(data); pk(HOLDER).copy(data, 32);
  data.writeBigUInt64LE(balance, 64); data[108] = state; data[165] = 2; data.writeUInt16LE(7, 166);
  return { address: tokenAddress, owner: TOKEN_2022_PROGRAM_ID, executable: false, dataBase64: data.toString("base64") };
}

function withTokenExtension(input: ControlledAccountData, type: number, payload: Uint8Array): ControlledAccountData {
  const header = Buffer.alloc(4); header.writeUInt16LE(type); header.writeUInt16LE(payload.length, 2);
  return { ...input, dataBase64: Buffer.concat([Buffer.from(input.dataBase64, "base64"), header, payload]).toString("base64") };
}

test("controlled bootstrap creates a distinct 207-byte frozen supply-zero mint with single-byte freeze option", async () => {
  const plan = await buildControlledMintSetup(mintInput); const repeated = await buildControlledMintSetup(mintInput);
  const legacy = await buildInstrumentMintSetup(mintInput);
  assert.equal(CONTROLLED_BOND_MINT_SIZE, 207); assert.deepEqual(plan, repeated);
  assert.notEqual(plan.bondMint, legacy.bondMint); assert.notEqual(plan.settlementMint, legacy.settlementMint);
  assert.equal(plan.instructions.length, 7);
  assert.deepEqual(Buffer.from(plan.instructions[2]!.data), Buffer.from([28, 0, 2]));
  const initialize = Buffer.from(plan.instructions[3]!.data);
  assert.equal(initialize.length, 67); assert.equal(initialize[34], 1);
  assert.deepEqual(initialize.subarray(35), pk(plan.instrumentAuthority));
  assert.equal(Buffer.from(plan.instructions[5]!.data).length, 35);
  assert.equal(plan.instructions.filter(value => value.programId === TOKEN_2022_PROGRAM_ID && value.data[0] === 7).length, 0);
  const changedId = Uint8Array.from(instrumentId); changedId[15] = 99;
  const changed = await buildControlledMintSetup({ ...mintInput, instrumentId: changedId });
  assert.notEqual(changed.bondMint, plan.bondMint);
  assert.equal(Buffer.byteLength(plan.bondSeed) <= 32, true);
  assert.equal(plan.instructions.flatMap(value => value.accounts.filter(meta => meta.isSigner)).every(meta => meta.address === ADMIN), true);
});

test("controlled initializer uses program authority and writable policy, mint and treasury", async () => {
  const plan = await buildControlledInstrumentInitialization({ ...instrumentIdentity, administrator: ADMIN, bondMint: MINT,
    settlementMint: SETTLEMENT, complianceAuthority: publicKey(8), corporateActionAuthority: ADMIN, faceValueMinor: 100_000_000n,
    couponRateBps: 1000, paymentsPerYear: 2, issueAt: 100n, maturityAt: 200n, totalSupply: 35n });
  instructionName(plan.instruction.data, "initialize_controlled_instrument");
  assert.equal(plan.instruction.accounts.length, 11);
  for (const index of [0, 3, 5, 6, 8]) assert.equal(plan.instruction.accounts[index]!.isWritable, true);
  assert.equal(plan.instruction.accounts[5]!.address, plan.controlledPolicyAddress);
  assert.equal(plan.instruction.accounts[8]!.address, plan.treasuryTokenAccount);
});

test("controlled holding PDAs bind instrument and actual source accounts", async () => {
  const registration = await buildControlledHoldingRegistration({ ...instrumentIdentity, corporateActionAuthority: ADMIN, bondTokenAccount: SOURCE });
  instructionName(registration.instruction.data, "register_controlled_holding");
  assert.equal(registration.controlledHoldingAddress, await deriveControlledHoldingAddress(PROGRAM, registration.instrumentAddress, SOURCE));
  assert.notEqual(registration.controlledHoldingAddress, await deriveControlledHoldingAddress(PROGRAM, registration.instrumentAddress, OTHER_SOURCE));
  assert.equal(registration.controlledPolicyAddress, await deriveControlledPolicyAddress(PROGRAM, registration.instrumentAddress));
  const activation = await buildControlledInstrumentActivation({ ...instrumentIdentity, issuerAuthority: ADMIN, bondMint: MINT, holderTokenAccounts: [SOURCE, OTHER_SOURCE] });
  assert.deepEqual(activation.instruction.accounts.slice(6).map(meta => meta.address), [SOURCE, registration.controlledHoldingAddress, OTHER_SOURCE, activation.holdingAddresses[1]]);
});

test("controlled transfers require holder plus CA signatures and keep PDA authority unsigned", async () => {
  const plan = await buildControlledTransfer({ ...instrumentIdentity, corporateActionAuthority: ADMIN, holder: HOLDER, bondMint: MINT,
    sourceTokenAccount: SOURCE, destinationTokenAccount: DESTINATION, amount: 8n });
  instructionName(plan.instruction.data, "controlled_transfer");
  assert.deepEqual(plan.instruction.accounts.filter(meta => meta.isSigner).map(meta => meta.address), [ADMIN, HOLDER]);
  assert.equal(plan.instruction.accounts[4]!.address, plan.instrumentAuthority); assert.equal(plan.instruction.accounts[4]!.isSigner, false);
  assert.deepEqual(plan.instruction.accounts.filter(meta => meta.isWritable).map(meta => meta.address), [SOURCE, DESTINATION]);
  assert.equal(Buffer.from(plan.instruction.data).readBigUInt64LE(8), 8n);
});

test("capture record preserves the snapshot ABI and paired holding identities", async () => {
  const input = { ...actionIdentity, bondMint: MINT, snapshotHash, snapshotSlot: 77n, investorCount: 1, walletCount: 1,
    totalBalance: 10n, mintSupply: 10n, holderTokenAccounts: [SOURCE, OTHER_SOURCE] };
  const controlled = await buildControlledCaptureRecord(input);
  const legacy = await buildSnapshotRegistrationInstruction({ ...input, issuerAuthority: ADMIN });
  instructionName(controlled.instruction.data, "record_controlled_snapshot");
  assert.deepEqual(Buffer.from(controlled.instruction.data).subarray(8), Buffer.from(legacy.data).subarray(8));
  assert.deepEqual(controlled.instruction.accounts.slice(7).map(meta => meta.address), [SOURCE, controlled.holdingAddresses[0], OTHER_SOURCE, controlled.holdingAddresses[1]]);
  const begin = await buildControlledCaptureBegin(actionIdentity); const abort = await buildControlledCaptureAbort(actionIdentity);
  assert.equal(begin.controlledCaptureAddress, await deriveControlledCaptureAddress(PROGRAM, begin.actionAddress));
  instructionName(begin.instruction.data, "begin_controlled_capture"); instructionName(abort.instruction.data, "abort_controlled_capture");
  assert.equal(abort.instruction.accounts[0]!.isWritable, true);
});

test("source registration and reservations preserve canonical source order and source-specific holding pairs", async () => {
  const input = { ...actionIdentity, investorId, bondMint: MINT, tokenAccounts: sources, snapshotHash };
  const registration = await buildControlledRedemptionSourceRegistration(input); const reservation = await buildControlledUnitReservation(input);
  instructionName(registration.instruction.data, "register_controlled_redemption_sources");
  instructionName(reservation.instruction.data, "reserve_controlled_redemption");
  assert.equal(registration.instruction.accounts.at(-2)!.address, registration.controlledPolicyAddress);
  assert.equal(registration.instruction.accounts.at(-1)!.address, registration.controlledCaptureAddress);
  assert.equal(reservation.unitReservationAddress, await deriveControlledUnitReservationAddress(PROGRAM, reservation.entitlementAddress));
  assert.deepEqual(reservation.instruction.accounts.slice(12, 14).map(meta => meta.address), reservation.tokenAccounts.map(value => value.address));
  assert.deepEqual(reservation.instruction.accounts.slice(14).map(meta => meta.address), reservation.holdingAddresses);
  assert.equal(reservation.instruction.accounts.slice(14).every(meta => meta.isWritable), true);
  assert.equal(reservation.instruction.accounts.slice(12, 14).every(meta => !meta.isWritable), true);
});

test("controlled redemption extends immutable payment accounts with policy, writable reservation and Holdings", async () => {
  const input = { ...actionIdentity, investorId, bondMint: MINT, settlementMint: SETTLEMENT, settlementWallet: HOLDER,
    idempotencyHash: "56".repeat(32), tokenAccounts: sources };
  const controlled = await buildControlledRedemptionExecution(input); const legacy = await buildRedemptionExecution(input);
  instructionName(controlled.instruction.data, "execute_controlled_redemption");
  assert.deepEqual(controlled.instruction.accounts.slice(0, legacy.instruction.accounts.length), legacy.instruction.accounts);
  assert.deepEqual(Buffer.from(controlled.instruction.data).subarray(8), Buffer.from(legacy.instruction.data).subarray(8));
  assert.deepEqual(controlled.instruction.accounts.slice(-4).map(meta => [meta.address, meta.isWritable]), [
    [controlled.controlledPolicyAddress, false], [controlled.unitReservationAddress, true], ...controlled.holdingAddresses.map(value => [value, true]),
  ]);
  assert.equal(controlled.instructions[0]!.programId, legacy.instructions[0]!.programId);
});

test("capture finish supplies complete entitlement/reservation pairs while coupons supply none", async () => {
  const redemption = await buildControlledCaptureFinish({ ...actionIdentity, investorIds: [investorId] });
  assert.deepEqual(redemption.instruction.accounts.slice(5).map(meta => meta.address), [redemption.entitlementAddresses[0], redemption.unitReservationAddresses[0]]);
  const coupon = await buildControlledCaptureFinish(actionIdentity); assert.equal(coupon.instruction.accounts.length, 5);
  const completion = await buildControlledRedemptionCompletion(actionIdentity);
  instructionName(completion.instruction.data, "complete_controlled_redemption"); assert.equal(completion.instruction.accounts.length, 4);
});

test("builders reject duplicate sources, invalid amounts, null identities and overlapping transfers", async () => {
  await assert.rejects(buildControlledMintSetup({ ...mintInput, totalSupply: 0n }));
  await assert.rejects(buildControlledMintSetup({ ...mintInput, bondRentLamports: -1n }));
  await assert.rejects(buildControlledHoldingRegistration({ ...instrumentIdentity, corporateActionAuthority: ADMIN, bondTokenAccount: "11111111111111111111111111111111" }));
  await assert.rejects(buildControlledInstrumentActivation({ ...instrumentIdentity, issuerAuthority: ADMIN, bondMint: MINT, holderTokenAccounts: [SOURCE, SOURCE] }));
  for (const amount of [0n, -1n, 1n << 64n]) await assert.rejects(buildControlledTransfer({ ...instrumentIdentity, corporateActionAuthority: ADMIN,
    holder: HOLDER, bondMint: MINT, sourceTokenAccount: SOURCE, destinationTokenAccount: DESTINATION, amount }));
  await assert.rejects(buildControlledTransfer({ ...instrumentIdentity, corporateActionAuthority: ADMIN, holder: HOLDER, bondMint: MINT,
    sourceTokenAccount: SOURCE, destinationTokenAccount: SOURCE, amount: 1n }));
  await assert.rejects(buildControlledCaptureFinish({ ...actionIdentity, investorIds: [investorId, investorId] }));
  await assert.rejects(buildControlledUnitReservation({ ...actionIdentity, investorId, bondMint: MINT, snapshotHash, tokenAccounts: [sources[0]!, sources[0]!] }));
});

test("Token-2022 raw source decoder retains actual wallet, frozen state and owner-extension bytes", () => {
  const decoded = decodeControlledTokenPosition(tokenAccount(), MINT);
  assert.equal(decoded.walletAddress, HOLDER); assert.equal(decoded.mintAddress, MINT); assert.equal(decoded.balance, 8n);
  assert.equal(decoded.state, "FROZEN"); assert.equal(decoded.immutableOwner, true); assert.equal(decoded.tokenProgramOwner, TOKEN_2022_PROGRAM_ID);
  assert.deepEqual(decoded.extensions, [{ type: 7, dataHex: "" }]); assert.equal(decoded.delegate, null); assert.equal(decoded.closeAuthority, null);
  const actual = Buffer.from(tokenAccount().dataBase64, "base64"); actual.writeUInt32LE(1, 72); pk(ADMIN).copy(actual, 76); actual.writeBigUInt64LE(3n, 121);
  const delegated = decodeControlledTokenPosition({ ...tokenAccount(), dataBase64: actual.toString("base64") }, MINT);
  assert.equal(delegated.delegate, ADMIN); assert.equal(delegated.delegatedAmount, 3n);
});

test("raw source decoder rejects wrong Token-2022 owner, mint, malformed options and extensions", () => {
  const input = tokenAccount();
  assert.throws(() => decodeControlledTokenPosition({ ...input, owner: PROGRAM }, MINT));
  assert.throws(() => decodeControlledTokenPosition(input, SETTLEMENT));
  assert.throws(() => decodeControlledTokenPosition({ ...input, executable: true }, MINT));
  for (const edit of [(data: Buffer) => data.writeUInt32LE(2, 72), (data: Buffer) => { data[108] = 0; },
    (data: Buffer) => { data[165] = 1; }, (data: Buffer) => data.writeUInt16LE(2, 168)]) {
    const data = Buffer.from(input.dataBase64, "base64"); edit(data);
    assert.throws(() => decodeControlledTokenPosition({ ...input, dataBase64: data.toString("base64") }, MINT));
  }
});

test("controlled policy and Holding decoders enforce owner, version and all supplied identities", async () => {
  const registered = await buildControlledHoldingRegistration({ ...instrumentIdentity, corporateActionAuthority: ADMIN, bondTokenAccount: SOURCE });
  const expected = { programId: PROGRAM, accountAddress: registered.controlledHoldingAddress, instrumentAddress: registered.instrumentAddress,
    mintAddress: MINT, tokenAccount: SOURCE, walletAddress: HOLDER };
  const data = accountData("ControlledHolding", expected.accountAddress, CONTROLLED_HOLDING_BYTES,
    [pk(expected.instrumentAddress), pk(MINT), pk(SOURCE), pk(HOLDER), u64(2n), Buffer.from([254])]);
  assert.equal(decodeControlledHolding(data, expected).reservedTokens, 2n);
  assert.throws(() => decodeControlledHolding({ ...data, owner: TOKEN_2022_PROGRAM_ID }, expected));
  assert.throws(() => decodeControlledHolding(data, { ...expected, accountAddress: DESTINATION }));
  for (const field of ["instrumentAddress", "mintAddress", "tokenAccount", "walletAddress"] as const) assert.throws(() => decodeControlledHolding(data, { ...expected, [field]: DESTINATION }));
  const unsupported = Buffer.from(data.dataBase64, "base64"); unsupported[8] = 2;
  assert.throws(() => decodeControlledHolding({ ...data, dataBase64: unsupported.toString("base64") }, expected));
  const policyExpected = { ...expected, accountAddress: registered.controlledPolicyAddress };
  const policy = accountData("ControlledPolicy", policyExpected.accountAddress, CONTROLLED_POLICY_BYTES,
    [pk(expected.instrumentAddress), pk(MINT), Buffer.alloc(32), pk(DESTINATION), Buffer.from([255])]);
  assert.equal(decodeControlledPolicy(policy, policyExpected).activeRedemption, DESTINATION);
  assert.throws(() => decodeControlledPolicy(policy, { ...policyExpected, mintAddress: SETTLEMENT }));
});

test("capture decoder validates positive complete source positions and per-source reservation markers", async () => {
  const begin = await buildControlledCaptureBegin(actionIdentity);
  const expected = { programId: PROGRAM, accountAddress: begin.controlledCaptureAddress, instrumentAddress: begin.instrumentAddress, actionAddress: begin.actionAddress, snapshotHash };
  const fields = [pk(expected.instrumentAddress), pk(expected.actionAddress), u64(77n), u64(100n), Buffer.from(snapshotHash, "hex"), Buffer.from([1, 0]),
    u32(2), pk(SOURCE), pk(HOLDER), u64(8n), pk(OTHER_SOURCE), pk(HOLDER), u64(2n), u32(2), Buffer.from([1, 1]), u32(1), u64(2n), Buffer.from([254])];
  const data = accountData("ControlledCapture", expected.accountAddress, CONTROLLED_CAPTURE_BYTES, fields);
  const decoded = decodeControlledCapture(data, expected);
  assert.equal(decoded.startedSlot, 77n); assert.deepEqual(decoded.reservedSources, [1, 1]); assert.equal(decoded.reservedTokens, 2n);
  assert.deepEqual(decoded.holdings.map(value => value.balance), [8n, 2n]);
  assert.throws(() => decodeControlledCapture(data, { ...expected, actionAddress: DESTINATION }));
  assert.throws(() => decodeControlledCapture(data, { ...expected, snapshotHash: sourceHash }));
  const invalid = Buffer.from(data.dataBase64, "base64"); invalid[123] = 65;
  assert.throws(() => decodeControlledCapture({ ...data, dataBase64: invalid.toString("base64") }, expected));
});

test("unit reservation decoder preserves zero allocations and rejects changed commitments or corrupt vectors", async () => {
  const reservation = await buildControlledUnitReservation({ ...actionIdentity, investorId, bondMint: MINT, snapshotHash, tokenAccounts: sources });
  const expected = { programId: PROGRAM, accountAddress: reservation.unitReservationAddress, actionAddress: reservation.actionAddress,
    entitlementAddress: reservation.entitlementAddress, snapshotHash, sourceHash };
  const data = accountData("UnitReservation", expected.accountAddress, CONTROLLED_UNIT_RESERVATION_BYTES,
    [pk(expected.actionAddress), pk(expected.entitlementAddress), Buffer.from(snapshotHash, "hex"), Buffer.from(sourceHash, "hex"), u32(2), u64(2n), u64(0n), Buffer.from([0, 254])]);
  assert.deepEqual(decodeControlledUnitReservation(data, expected).allocations, [2n, 0n]);
  assert.equal(decodeControlledUnitReservation(data, expected).consumed, false);
  assert.throws(() => decodeControlledUnitReservation(data, { ...expected, sourceHash: "56".repeat(32) }));
  const invalid = Buffer.from(data.dataBase64, "base64"); invalid.writeUInt32LE(9, 137);
  assert.throws(() => decodeControlledUnitReservation({ ...data, dataBase64: invalid.toString("base64") }, expected));
});

function captureRpc(accounts: ControlledAccountData[], supply = 10n, slots = [70, 71, 72]) {
  let requestIndex = 0;
  return { request: async () => {
    const current = requestIndex++;
    if (current === 1) return { context: { slot: slots[current] }, value: accounts.map(value => ({ pubkey: value.address,
      account: { owner: value.owner, executable: value.executable, data: [value.dataBase64, "base64"] } })) };
    const mint = Buffer.alloc(CONTROLLED_BOND_MINT_SIZE); mint.writeBigUInt64LE(supply, 36); mint[45] = 1; mint[165] = 1;
    return { context: { slot: slots[current] }, value: { owner: TOKEN_2022_PROGRAM_ID, executable: false, data: [mint.toString("base64"), "base64"] } };
  } };
}

test("controlled capture collection retains zero balances and raw account metadata without omitting positive sources", async () => {
  const collected = await collectControlledTokenPositions(captureRpc([tokenAccount(SOURCE, 8n), tokenAccount(OTHER_SOURCE, 2n), tokenAccount(DESTINATION, 0n)]), MINT, 70);
  assert.equal(collected.positions.length, 3); assert.equal(collected.positivePositions.length, 2);
  assert.equal(collected.supply, 10n); assert.equal(collected.totalBalance, 10n); assert.equal(collected.slot, 71);
  assert.equal(collected.positivePositions.every(value => value.state === "FROZEN" && value.immutableOwner), true);
});

test("controlled capture fails on duplicates, missing supply, unfrozen sources and unordered finalized slots", async () => {
  await assert.rejects(collectControlledTokenPositions(captureRpc([tokenAccount(SOURCE, 8n), tokenAccount(SOURCE, 2n)]), MINT, 70), /duplicate/i);
  await assert.rejects(collectControlledTokenPositions(captureRpc([tokenAccount(SOURCE, 8n)]), MINT, 70), /mint supply/i);
  await assert.rejects(collectControlledTokenPositions(captureRpc([tokenAccount(SOURCE, 8n, 1), tokenAccount(OTHER_SOURCE, 2n)]), MINT, 70), /frozen/i);
  await assert.rejects(collectControlledTokenPositions(captureRpc([tokenAccount(SOURCE, 8n), tokenAccount(OTHER_SOURCE, 2n)], 10n, [72, 71, 73]), MINT, 70), /slots/i);
});

test("controlled capture reads require the finalized capture slot and apply it to every supported RPC request", async () => {
  const requests: { method: string; params: readonly unknown[] }[] = [];
  const backing = captureRpc([tokenAccount(SOURCE, 8n), tokenAccount(OTHER_SOURCE, 2n)]);
  await collectControlledTokenPositions({ request: async (method, params) => { requests.push({ method, params }); return backing.request(); } }, MINT, 70);
  assert.deepEqual(requests.map(value => value.method), ["getAccountInfo", "getProgramAccounts", "getAccountInfo"]);
  for (const request of requests) assert.equal((request.params[1] as { minContextSlot: number }).minContextSlot, 70);
  for (const minimum of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, undefined]) {
    await assert.rejects(collectControlledTokenPositions(backing, MINT, minimum as number), /minimum context slot/i);
  }
});

test("collector rejects stale contexts even when old balances and mint supply agree", async () => {
  const positions = [tokenAccount(SOURCE, 8n), tokenAccount(OTHER_SOURCE, 2n)];
  for (const slots of [[67, 68, 69], [69, 70, 71], [70, 69, 71], [70, 71, 69]]) {
    await assert.rejects(collectControlledTokenPositions(captureRpc(positions, 10n, slots), MINT, 70), /precede|slots/i);
  }
});

test("capture decoder accepts a finalized uncommitted capture before raw source collection", async () => {
  const begun = await buildControlledCaptureBegin(actionIdentity);
  const expected = { programId: PROGRAM, accountAddress: begun.controlledCaptureAddress, instrumentAddress: begun.instrumentAddress, actionAddress: begun.actionAddress };
  const data = accountData("ControlledCapture", expected.accountAddress, CONTROLLED_CAPTURE_BYTES,
    [pk(expected.instrumentAddress), pk(expected.actionAddress), u64(77n), u64(100n), Buffer.alloc(32), Buffer.from([0, 0]), u32(0), u32(0), u32(0), u64(0n), Buffer.from([254])]);
  const decoded = decodeControlledCapture(data, expected);
  assert.equal(decoded.startedSlot, 77n); assert.equal(decoded.committed, false); assert.deepEqual(decoded.holdings, []);
});

test("CPI Guard enabled or disabled remains capture compatible and actual guard metadata is retained", async () => {
  for (const enabled of [0, 1]) {
    const source = withTokenExtension(tokenAccount(SOURCE, 8n), 11, Buffer.from([enabled]));
    assert.equal(decodeControlledTokenPosition(source, MINT).cpiGuardEnabled, enabled === 1);
    const capture = await collectControlledTokenPositions(captureRpc([source, tokenAccount(OTHER_SOURCE, 2n)]), MINT, 70);
    const capturedSource = capture.positivePositions.find(value => value.address === SOURCE)!;
    assert.equal(capturedSource.cpiGuardEnabled, enabled === 1);
    assert.deepEqual(capturedSource.extensions, [{ type: 7, dataHex: "" }, { type: 11, dataHex: enabled === 1 ? "01" : "00" }]);
  }
  assert.equal(decodeControlledTokenPosition(tokenAccount(), MINT).cpiGuardEnabled, null);
});

test("capture accepts optional CPI Guard without opening unknown extension or malformed guard lanes", async () => {
  for (const payload of [Buffer.alloc(0), Buffer.from([2]), Buffer.from([1, 0])]) {
    const malformed = withTokenExtension(tokenAccount(), 11, payload);
    assert.throws(() => decodeControlledTokenPosition(malformed, MINT), /extension/i);
  }
  for (const type of [15, 27]) {
    const unsupported = withTokenExtension(tokenAccount(SOURCE, 8n), type, Buffer.from([0]));
    await assert.rejects(collectControlledTokenPositions(captureRpc([unsupported, tokenAccount(OTHER_SOURCE, 2n)]), MINT, 70), /only optional CPI Guard/i);
  }
});

test("MemoTransfer enabled or disabled does not exclude immutable captured rights and raw memo metadata is retained", async () => {
  for (const enabled of [0, 1]) {
    const source = withTokenExtension(tokenAccount(SOURCE, 8n), 8, Buffer.from([enabled]));
    assert.equal(decodeControlledTokenPosition(source, MINT).incomingMemoRequired, enabled === 1);
    const capture = await collectControlledTokenPositions(captureRpc([source, tokenAccount(OTHER_SOURCE, 2n)]), MINT, 70);
    assert.equal(capture.positivePositions.find(value => value.address === SOURCE)!.incomingMemoRequired, enabled === 1);
  }
  const both = withTokenExtension(withTokenExtension(tokenAccount(), 8, Buffer.from([1])), 11, Buffer.from([1]));
  const decoded = decodeControlledTokenPosition(both, MINT);
  assert.equal(decoded.incomingMemoRequired, true); assert.equal(decoded.cpiGuardEnabled, true);
  const bothCapture = await collectControlledTokenPositions(captureRpc([both, tokenAccount(OTHER_SOURCE, 2n)]), MINT, 70);
  assert.equal(bothCapture.positivePositions.find(value => value.address === SOURCE)!.incomingMemoRequired, true);
  assert.equal(decodeControlledTokenPosition(tokenAccount(), MINT).incomingMemoRequired, null);
});

test("MemoTransfer payloads and duplicate supported extensions cannot bypass raw metadata validation", () => {
  for (const payload of [Buffer.alloc(0), Buffer.from([2]), Buffer.from([1, 0])]) {
    assert.throws(() => decodeControlledTokenPosition(withTokenExtension(tokenAccount(), 8, payload), MINT), /extension/i);
  }
  for (const type of [8, 11]) {
    const duplicate = withTokenExtension(withTokenExtension(tokenAccount(), type, Buffer.from([0])), type, Buffer.from([1]));
    assert.throws(() => decodeControlledTokenPosition(duplicate, MINT), /extension/i);
  }
});
