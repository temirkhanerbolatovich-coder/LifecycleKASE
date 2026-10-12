import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { allocateEarlyRedemption, createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import { encodePublicKey } from "@lifecycle-kase/solana-client";
import { actionEvidenceCsv, actionEvidenceFile, buildActionEvidenceExport, canonicalEvidenceJson, evidenceCsvCell,
  getActionEvidenceExport, type ActionEvidenceRecord } from "./action-evidence-export.js";
import { ActionEvidenceExportController } from "./action-evidence-export.controller.js";
import { couponReceiptDraft } from "./coupon-receipt.js";
import { entitlementAmounts } from "./entitlements.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const key = (value: number) => encodePublicKey(new Uint8Array(32).fill(value));
const at = new Date("2026-10-12T10:00:00.000Z");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture(type = "COUPON_PAYMENT", exact = false) {
  const investors = [3n, 7n].map((balance, index) => ({ id: id(10 + index), snapshotId: id(3), investorId: id(20 + index),
    eligibilityStatus: "ELIGIBLE", balance,
    investor: { id: id(20 + index), displayName: "PRIVATE NAME MUST NOT EXPORT", email: "private@example.test",
      status: "ACTIVE", kycStatus: "VERIFIED", eligibilityStatus: "ELIGIBLE", eligibilityReasonCode: null, eligibilityReviewedAt: at,
      wallets: [{ id: id(30 + index), investorId: id(20 + index), address: key(10 + index), network: "SOLANA_LOCALNET", status: "ACTIVE", verifiedAt: at, revokedAt: null }] },
    wallets: [{ id: id(40 + index), walletId: id(30 + index), snapshotInvestorId: id(10 + index), walletAddress: key(10 + index),
      walletStatus: "ACTIVE", balance, tokenAccounts: [{ id: id(50 + index), snapshotWalletId: id(40 + index), address: key(20 + index), balance }] }] }));
  const commitment = createSnapshotV2Commitment({ actionId: id(1), instrumentId: id(2), cluster: "localnet", networkGenesisHash: key(3), mintAddress: key(4),
    recordAt: at.toISOString(), blockTime: at.toISOString(), createdAt: at.toISOString(), solanaSlot: 100n, mintSupply: 10n,
    investors: investors as never });
  const allocation = exact ? allocateEarlyRedemption({ targetTokens: 3n, rows: investors.map(row => ({ investorId: row.investorId,
    balance: row.balance, tieAddress: row.wallets[0]!.walletAddress })) }) : null;
  const entitlements = investors.map((investor, index) => {
    const allocated = allocation?.rows.find(row => row.investorId === investor.investorId);
    const amounts = allocated ? { amountMinor: allocated.redeemedTokens * 100n, tokensToRedeem: allocated.redeemedTokens,
      roundingRemainder: allocated.quotaRemainder.toString(), denominator: allocation!.denominator.toString() } :
      entitlementAmounts(type as never, investor.balance, { faceValueMinor: 100n, couponRateBps: 2500, paymentsPerYear: 1 }, type === "EARLY_REDEMPTION" ? 2000 : null, type === "EARLY_REDEMPTION" ? 100n : null);
    return { id: id(60 + index), corporateActionId: id(1), snapshotInvestorId: investor.id, investorId: investor.investorId,
      settlementWalletAddress: investor.wallets[0]!.walletAddress, balanceAtRecordDate: investor.balance,
      amountMinor: amounts.amountMinor, tokensToRedeem: amounts.tokensToRedeem, status: amounts.amountMinor === 0n ? "NOT_ELIGIBLE_ZERO_ROUNDING" : "CALCULATED",
      executionAttempts: 0, onchainPda: null as string | null, settlementSignature: null as string | null, burnSignature: null as string | null,
      lastErrorCode: null, formulaVersion: exact ? allocation!.policy : "integer-entitlements-v1", eligibilityReason: "ELIGIBLE", version: 1,
      createdAt: at, updatedAt: at,
      calculationInputs: { actionType: type, snapshotId: id(3), snapshotHash: commitment.sha256, effectiveSlot: "100", effectiveBlockTime: at.toISOString(),
        balance: investor.balance.toString(), faceValueMinor: "100", couponRateBps: 2500, paymentsPerYear: 1,
        redemptionPercentageBps: type === "EARLY_REDEMPTION" && !exact ? 2000 : null, redemptionPriceMinor: type === "EARLY_REDEMPTION" ? "100" : null,
        ...(allocated ? { allocationPolicy: allocation!.policy, targetTokens: allocation!.targetTokens.toString(), totalBalance: allocation!.totalBalance.toString(),
          tieAddress: allocated.tieAddress, remainingTokens: allocated.remainingTokens.toString() } : {}),
        roundingRemainder: amounts.roundingRemainder, denominator: amounts.denominator,
        eligibilityRuleVersion: "eligibility-v1-local-demo-explicit", eligible: true, eligibilityReason: "ELIGIBLE" },
      settlement: null as ActionEvidenceRecord["entitlements"][number]["settlement"] };
  });
  const transaction = { id: id(70), instrumentId: id(2), corporateActionId: id(1), entitlementId: null as string | null,
    operationType: "REGISTER_SNAPSHOT", signature: "1".repeat(64), status: "FINALIZED", requiredSigner: key(1), networkGenesisHash: key(3),
    lastErrorCode: null, createdAt: at, submittedAt: at, finalizedAt: at, preparedPayload: { secret: "PREPARED SECRET MUST NOT EXPORT" } as Record<string, unknown>, preparedTransactionBase64: "SIGNED WIRE MUST NOT EXPORT" };
  return { id: id(1), instrumentId: id(2), type, intent: "Synthetic evidence export", sourceType: "MANUAL", sourceReference: "Synthetic unit test",
    sourceDocument: "No production document", sourceTimestamp: at, createdById: id(90), approvedById: id(91), approvedAt: at, reviewNote: "Synthetic approval",
    recordAt: at, executeAt: new Date(at.getTime() + 60_000), redemptionPercentageBps: type === "EARLY_REDEMPTION" && !exact ? 2000 : null,
    redemptionPriceMinor: type === "EARLY_REDEMPTION" ? 100n : null, redemptionTargetTokens: exact ? 3n : null,
    redemptionAllocationPolicy: allocation?.policy ?? "integer-entitlements-v1", controlledCaptureLocked: false, status: "CALCULATED",
    eligibleHolders: entitlements.filter(row => row.amountMinor > 0n).length, totalEntitlementMinor: entitlements.reduce((total, row) => total + row.amountMinor, 0n),
    processedEntitlements: 0, failedEntitlements: 0, settlementType: "ON_CHAIN", version: 1, createdAt: at, updatedAt: at,
    instrument: { id: id(2), ticker: "SYNTH", name: "Synthetic instrument", network: "SOLANA_LOCALNET", programId: key(2), mintAddress: key(4),
      tokenPolicy: "LEGACY_UNRESTRICTED_V1", issuerAuthority: key(1), corporateActionAuthority: key(1), faceValueMinor: 100n, couponRateBps: 2500, paymentsPerYear: 1,
      currency: "KZT_TEST", settlementDecimals: 6, issueAt: new Date(at.getTime() - 86400000), maturityAt: new Date(at.getTime() + 86400000),
      status: "ACTIVE", totalSupply: 10n, circulatingSupply: 10n,
      settlementAsset: { code: "KZT_TEST", mintAddress: key(5), decimals: 6, isSimulated: true, disclaimer: "Synthetic test asset; not fiat." } },
    snapshot: { id: id(3), schemaVersion: "snapshot-v2", instrumentId: id(2), corporateActionId: id(1), recordAt: at, networkGenesisHash: key(3),
      solanaSlot: 100n, blockTime: at, canonicalJson: commitment.snapshot, captureEvidence: null, snapshotHash: Buffer.from(commitment.sha256, "hex"),
      investorCount: 2, walletCount: 2, totalBalance: 10n, mintSupply: 10n, status: "FINALIZED", createdAt: at, investors },
    entitlements, blockchainTransactions: [transaction], actionReceipt: null as ActionEvidenceRecord["actionReceipt"] };
}
function build(action: ReturnType<typeof fixture>, draft?: Awaited<ReturnType<typeof couponReceiptDraft>>) { return buildActionEvidenceExport(action as never, draft); }
function settle(action: ReturnType<typeof fixture>, index: number) {
  const row = action.entitlements[index]!;
  const redemption = action.type !== "COUPON_PAYMENT";
  const transaction = { ...action.blockchainTransactions[0]!, id: id(100 + index), entitlementId: row.id,
    operationType: redemption ? "REDEMPTION_PAYMENT" : "COUPON_PAYMENT", signature: String(index + 2).repeat(64),
    preparedPayload: { entitlementReceiptAddress: key(30 + index), redemptionReceiptAddress: key(30 + index), executedAt: "1791799320", finalizedSlot: 110 } };
  action.blockchainTransactions.push(transaction);
  row.status = redemption ? "REDEEMED" : "PAID"; row.settlementSignature = transaction.signature; row.burnSignature = redemption ? transaction.signature : null;
  row.settlement = { id: id(110 + index), entitlementId: row.id, amountMinor: row.amountMinor, actualAmountMinor: row.amountMinor,
    status: "FINALIZED", reconciliationStatus: "MATCHED", finalizedAt: at, reconciledAt: at, createdAt: at, updatedAt: at,
    legs: [{ id: id(120 + index), settlementId: id(110 + index), type: "CASH", required: true, status: "CONFIRMED",
      expectedAmountMinor: row.amountMinor, actualAmountMinor: row.amountMinor, blockchainTransactionId: transaction.id, blockchainTransaction: transaction,
      confirmedAt: at, createdAt: at, updatedAt: at },
    { id: id(130 + index), settlementId: id(110 + index), type: "ASSET", required: redemption, status: redemption ? "CONFIRMED" : "NOT_APPLICABLE",
      expectedAmountMinor: row.tokensToRedeem, actualAmountMinor: redemption ? row.tokensToRedeem : null,
      blockchainTransactionId: redemption ? transaction.id : null, blockchainTransaction: redemption ? transaction : null,
      confirmedAt: redemption ? at : null, createdAt: at, updatedAt: at }] } as never;
  action.processedEntitlements += 1; action.status = "PARTIALLY_SETTLED";
}
function databaseFixture(action: ReturnType<typeof fixture>) {
  let isolationLevel: unknown;
  const database = { corporateAction: { findUnique: async (query: { include?: { blockchainTransactions?: { where?: { operationType?: string } } } }) =>
    query.include?.blockchainTransactions?.where?.operationType === "REGISTER_SNAPSHOT" ? { ...action, blockchainTransactions: action.blockchainTransactions.filter(value => value.operationType === "REGISTER_SNAPSHOT") } : action },
    blockchainTransaction: { findFirst: async (query: { where: { operationType: string } }) => action.blockchainTransactions.find(value => value.operationType === query.where.operationType) ?? null },
    settlement: { findUnique: async (query: { where: { entitlementId: string } }) => action.entitlements.find(value => value.id === query.where.entitlementId)?.settlement ?? null },
    $transaction: async (task: (tx: unknown) => Promise<unknown>, options: { isolationLevel: unknown }) => { isolationLevel = options.isolationLevel; return task(database); } };
  return { database, isolationLevel: () => isolationLevel };
}

test("evidence exports preserve snapshot bytes, captured terms, deterministic hashes and explicit partial status without PII/wires", () => {
  const action = fixture(); action.instrument.faceValueMinor = 999n;
  (action.entitlements[0]!.calculationInputs as Record<string, unknown>)["secret"] = "CALCULATION SECRET MUST NOT EXPORT";
  const result = build(action);
  assert.equal(result.payload.snapshot?.sha256, sha256(result.payload.snapshot!.canonicalJson));
  assert.equal(result.payload.calculation.capturedTerms?.["faceValueMinor"], "100");
  assert.equal(result.payload.instrumentRecord.faceValueMinor, "999");
  assert.equal(result.payload.calculation.totalObligationMinor, "250");
  assert.equal(result.payload.settlement.confirmedAmountMinor, "0");
  assert.equal(result.payload.outcome.evidenceComplete, false);
  assert.equal(result.payload.settlementMode.assetIsSimulated, true);
  assert.deepEqual(build(action), result);
  assert.equal(result.payloadSha256, sha256(canonicalEvidenceJson(result.payload)));
  for (const sensitive of ["PRIVATE NAME", "private@example", "PREPARED SECRET", "SIGNED WIRE", "CALCULATION SECRET"]) assert.equal(result.canonicalJson.includes(sensitive), false);
  const reversed = Object.fromEntries(Object.entries(action.snapshot.canonicalJson).reverse());
  action.snapshot.canonicalJson = reversed as never;
  assert.equal(build(action).canonicalJson, result.canonicalJson);
});

test("uncalculated actions do not turn missing obligations into a zero complete total", () => {
  const action = fixture(); action.entitlements = []; action.totalEntitlementMinor = 0n; action.eligibleHolders = 0; action.status = "SCHEDULED";
  const result = build(action);
  assert.equal(result.payload.calculation.totalObligationMinor, null);
  assert.equal(result.payload.calculation.verified, false);
  assert.ok(result.payload.outcome.unresolved.some(item => item.code === "CALCULATION_NOT_AVAILABLE"));
});

test("partial settlement requires finalized matching legs and keeps original unknown signatures visible", () => {
  const action = fixture(); settle(action, 0);
  action.blockchainTransactions.push({ ...action.blockchainTransactions[0]!, id: id(140), operationType: "COUPON_PAYMENT", entitlementId: action.entitlements[1]!.id,
    status: "UNKNOWN_CONFIRMATION", signature: "9".repeat(64) });
  let result = build(action);
  assert.equal(result.payload.settlement.confirmedAmountMinor, "75");
  assert.equal(result.payload.settlement.confirmedRows, 1);
  assert.ok(result.payload.outcome.unresolved.some(item => item.code === "ORIGINAL_SIGNATURE_CONFIRMATION_UNKNOWN" && item.operationId === id(140)));
  assert.equal(result.payload.transactions.find(operation => operation.id === id(140))?.signature, "9".repeat(64));
  action.entitlements[0]!.settlement!.legs[0]!.actualAmountMinor = 74n;
  result = build(action);
  assert.equal(result.payload.settlement.confirmedAmountMinor, "0");
  assert.ok(result.payload.outcome.unresolved.some(item => item.code === "SETTLEMENT_MISMATCH"));
});

test("redemption exports reproduce percentage floors, exact-target allocation and maturity obligations", () => {
  for (const action of [fixture("EARLY_REDEMPTION"), fixture("EARLY_REDEMPTION", true), fixture("BOND_REDEMPTION")]) {
    const result = build(action);
    assert.equal(result.payload.calculation.totalTokensToRedeem, action.type === "BOND_REDEMPTION" ? "10" : action.redemptionTargetTokens ? "3" : "1");
    assert.equal(result.payload.calculation.totalObligationMinor, action.type === "BOND_REDEMPTION" ? "1250" : action.redemptionTargetTokens ? "300" : "100");
  }
  const action = fixture("EARLY_REDEMPTION", true);
  action.entitlements[0]!.calculationInputs.tieAddress = key(99);
  assert.throws(() => build(action), { code: "EVIDENCE_INTEGRITY" });
});

test("evidence refuses corrupt snapshot, saved obligations, rounding and missing/corrupt immutable receipts", () => {
  for (const corrupt of [
    (action: ReturnType<typeof fixture>) => { action.snapshot.snapshotHash.fill(0); },
    (action: ReturnType<typeof fixture>) => { action.snapshot.investors[0]!.wallets[0]!.tokenAccounts[0]!.balance += 1n; },
    (action: ReturnType<typeof fixture>) => { action.entitlements[0]!.amountMinor += 1n; },
    (action: ReturnType<typeof fixture>) => { action.entitlements[0]!.calculationInputs.roundingRemainder = "1"; },
    (action: ReturnType<typeof fixture>) => { action.totalEntitlementMinor += 1n; },
    (action: ReturnType<typeof fixture>) => { action.entitlements.pop(); }
  ]) { const action = fixture(); corrupt(action); assert.throws(() => build(action)); }
  const action = fixture(); action.actionReceipt = { payloadHash: Buffer.alloc(32), payloadJson: {}, status: "FINALIZED" } as never;
  assert.throws(() => build(action), { code: "EVIDENCE_INTEGRITY" });
  const missing = fixture(); missing.status = "FINALIZED";
  assert.equal(build(missing).payload.outcome.evidenceComplete, false);
});

test("completed JSON/CSV export validates the original receipt in a repeatable read without replacing its bytes", async () => {
  const action = fixture(); settle(action, 0); settle(action, 1); action.status = "SETTLED";
  action.blockchainTransactions.push({ ...action.blockchainTransactions[0]!, id: id(150), operationType: "ACTION_APPROVAL", signature: "7".repeat(64) });
  const fixtureDb = databaseFixture(action);
  const draft = await couponReceiptDraft(fixtureDb.database as never, action.id);
  action.actionReceipt = { id: id(160), corporateActionId: action.id, status: "FINALIZED", payloadJson: JSON.parse(draft.json),
    payloadHash: Buffer.from(draft.hash, "hex"), onchainPda: key(50), finalizedAt: at, createdAt: at };
  action.blockchainTransactions.push({ ...action.blockchainTransactions[0]!, id: id(170), operationType: "COUPON_FINALIZE", signature: "8".repeat(64) });
  action.status = "FINALIZED";
  const result = await getActionEvidenceExport(fixtureDb.database as never, action.id);
  assert.equal(fixtureDb.isolationLevel(), "RepeatableRead");
  assert.equal(result.payload.receipt?.canonicalJson, draft.json);
  assert.equal(result.payload.receipt?.sha256, draft.hash);
  assert.equal(result.payload.outcome.evidenceComplete, true);
  assert.equal(result.payload.settlement.confirmedAmountMinor, "250");
  assert.equal(actionEvidenceFile(result, "json").fileSha256, sha256(result.canonicalJson));
  assert.equal(actionEvidenceFile(result, "csv").payloadSha256, result.payloadSha256);
  action.actionReceipt.payloadHash[0] = action.actionReceipt.payloadHash[0]! ^ 1;
  await assert.rejects(getActionEvidenceExport(fixtureDb.database as never, action.id), { code: "RECEIPT_INTEGRITY" });
});

test("CSV protects spreadsheet formulas, preserves quotes/newlines and includes every evidence section", () => {
  for (const value of ["=SUM(A1:A2)", "+cmd", "-cmd", "@SUM(A1)", "  =formula", "\tplain", "\r=1", "\n=1", "\uFEFF=1"]) {
    assert.equal(evidenceCsvCell(value).escaped, true);
    assert.ok(evidenceCsvCell(value).encoded.startsWith('"\''));
  }
  assert.deepEqual(evidenceCsvCell('a,"b"\r\nc'), { encoded: '"a,""b""\r\nc"', escaped: false });
  const action = fixture(); action.sourceReference = '=HYPERLINK("https://example.test")';
  const csv = actionEvidenceCsv(build(action));
  assert.ok(csv.includes('"/action/source/reference","string","\'=HYPERLINK(""https://example.test"")","true"'));
  for (const pointer of ["/snapshot/canonicalJson", "/calculation/rows/0/calculationInputs", "/settlement/rows", "/transactions", "/receipt", "/outcome/unresolved", "/settlementMode"]) assert.ok(csv.includes(`"${pointer}"`));
  assert.equal(csv, actionEvidenceCsv(build(action)));
});

test("export controller requires active Administrator/Auditor, rejects invalid input before reading evidence and audits downloads", async () => {
  const previous = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = "true";
  let role = "AUDITOR", revokedAt: Date | null = null, reads = 0;
  const action = fixture(), fixtureDb = databaseFixture(action), events: unknown[] = [], headers = new Map<string, string>();
  const database = { ...fixtureDb.database,
    $transaction: async (task: (tx: unknown) => Promise<unknown>, options: { isolationLevel: unknown }) => { reads += 1; return fixtureDb.database.$transaction(task, options); },
    wallet: { findUnique: async () => ({ userId: id(90), status: "ACTIVE", verifiedAt: at, revokedAt: null }) },
    session: { findUnique: async () => ({ walletAddress: key(1), revokedAt, expiresAt: new Date("2099-01-01"), user: { id: id(90), role } }) },
    auditLog: { create: async (event: unknown) => { events.push(event); } } };
  const controller = new ActionEvidenceExportController(database as never);
  const request = { headers: { cookie: `lifecyclekase_session=${"x".repeat(43)}` } }, response = { setHeader: (name: string, value: string) => { headers.set(name, value); } };
  const status = (expected: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === expected;
  try {
    await assert.rejects(controller.download(action.id, "json", {}, response), status(401));
    role = "ISSUER_OPERATOR"; await assert.rejects(controller.download(action.id, "json", request, response), status(403));
    role = "AUDITOR"; await assert.rejects(controller.download(action.id, ["json"], request, response), status(400));
    assert.equal(reads, 0);
    for (const allowed of ["AUDITOR", "ADMINISTRATOR"]) {
      role = allowed; const body = await controller.download(action.id, "json", request, response);
      assert.equal(headers.get("X-Evidence-File-SHA256"), sha256(body));
      assert.equal(headers.get("Content-Disposition"), `attachment; filename="action-evidence-${action.id}.json"`);
    }
    assert.equal(events.length, 2);
    revokedAt = at; await assert.rejects(controller.download(action.id, "json", request, response), status(401));
    await assert.rejects(getActionEvidenceExport(database as never, "invalid"), { code: "INVALID_REQUEST" });
  } finally { if (previous === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = previous; }
});
