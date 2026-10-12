import assert from "node:assert/strict";
import test from "node:test";
import { actionTimeUtc, earlyRedemptionDraftTerms, preparedActionPlan, snapshotWindowMessage, type CorporateActionView } from "./action-workflow.js";

const KEY = "11111111111111111111111111111111";
const ACTION = "00000000-0000-4000-8000-000000000001";
const OPERATION = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const wire = new Uint8Array(200); wire[0] = 1; wire[65] = 128; wire[66] = 1; wire[69] = 2;
  const action = { id: ACTION, type: "COUPON_PAYMENT", recordAt: "2026-10-02T10:00:00.000Z", executeAt: "2026-10-02T11:00:00.000Z",
    redemptionPercentageBps: null, redemptionPriceMinor: null, instrument: { issuerAuthority: KEY, network: "SOLANA_LOCALNET" } } as CorporateActionView;
  const payload = { corporateActionId: ACTION, operationId: OPERATION, phase: "SCHEDULE", cluster: "localnet", requiredSigner: KEY,
    programId: KEY, instrumentAddress: KEY, actionAddress: KEY, networkGenesisHash: KEY, lastValidBlockHeight: 200,
    type: action.type, recordAt: action.recordAt, executeAt: action.executeAt, redemptionPercentageBps: null, redemptionPriceMinor: null,
    serializedTransactionBase64: Buffer.from(wire).toString("base64"), transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", reason: null };
  return { action, payload };
}
test("action review binds the complete terms, network and only fee payer to the selected action", () => {
  const f = fixture(); assert.equal(preparedActionPlan(f.payload, f.action, KEY).operationId, OPERATION);
  for (const change of [{ corporateActionId: OPERATION }, { operationId: "invalid" }, { phase: "OTHER" }, { cluster: "mainnet" },
    { cluster: "devnet" }, { requiredSigner: "other" }, { recordAt: "2026-10-02T10:00:01.000Z" },
    { executeAt: "2026-10-02T11:00:01.000Z" }, { type: "EARLY_REDEMPTION" }, { redemptionPercentageBps: 2000 },
    { redemptionPriceMinor: "1" }, { actionAddress: "invalid" }, { lastValidBlockHeight: -1 }, { phase: "CANCEL", reason: null }]) {
    assert.throws(() => preparedActionPlan({ ...f.payload, ...change }, f.action, KEY));
  }
  assert.equal(preparedActionPlan({ ...f.payload, phase: "CANCEL", reason: "Owner requested cancellation" }, f.action, KEY).phase, "CANCEL");
});
test("action date input is explicitly converted from local time to exact UTC seconds", () => {
  const value = "2026-10-02T17:35";
  assert.equal(actionTimeUtc(value), new Date(value).toISOString());
  assert.throws(() => actionTimeUtc("invalid")); assert.throws(() => actionTimeUtc("2026-10-02T17:35Z"));
});

test("exact-target action plans require explicit matching policy, target and target PDA while legacy omission remains valid", () => {
  const f = fixture();
  const action: CorporateActionView = { ...f.action, type: "EARLY_REDEMPTION", redemptionPriceMinor: "1000000000",
    redemptionAllocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: "7" };
  const payload = { ...f.payload, type: action.type, redemptionPriceMinor: action.redemptionPriceMinor,
    redemptionAllocationPolicy: action.redemptionAllocationPolicy, redemptionTargetTokens: "7", targetAddress: KEY };
  assert.equal(preparedActionPlan(payload, action, KEY).redemptionTargetTokens, "7");
  for (const change of [{ redemptionAllocationPolicy: undefined }, { redemptionAllocationPolicy: "integer-entitlements-v1" },
    { redemptionTargetTokens: undefined }, { redemptionTargetTokens: "8" }, { redemptionTargetTokens: 7 }, { targetAddress: undefined }]) {
    assert.throws(() => preparedActionPlan({ ...payload, ...change }, action, KEY));
  }
  const cancel = { ...payload, phase: "CANCEL", reason: "Owner requested cancellation", targetAddress: undefined };
  assert.equal(preparedActionPlan(cancel, action, KEY).phase, "CANCEL");
  assert.throws(() => preparedActionPlan({ ...cancel, redemptionTargetTokens: "8" }, action, KEY));
  assert.throws(() => preparedActionPlan(payload, f.action, KEY));
  assert.throws(() => preparedActionPlan({ ...f.payload, redemptionTargetTokens: "7" }, f.action, KEY));
});

test("early-redemption drafts preserve integer targets beyond Number precision and keep percentage mode independent", () => {
  assert.deepEqual(earlyRedemptionDraftTerms("exact-target-largest-remainder-v2", { targetTokens: "9007199254740993", percentageBps: "2000", priceKzt: "1000" }), {
    redemptionAllocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: "9007199254740993", redemptionPercentageBps: null, redemptionPriceKzt: "1000"
  });
  assert.deepEqual(earlyRedemptionDraftTerms("integer-entitlements-v1", { targetTokens: "7", percentageBps: "2000", priceKzt: "0.000001" }), {
    redemptionAllocationPolicy: "integer-entitlements-v1", redemptionTargetTokens: null, redemptionPercentageBps: 2000, redemptionPriceKzt: "0.000001"
  });
  for (const targetTokens of ["0", "-1", "01", "1.5", "1e3", "9223372036854775808", 7]) {
    assert.throws(() => earlyRedemptionDraftTerms("exact-target-largest-remainder-v2", { targetTokens, percentageBps: null, priceKzt: "1000" }));
  }
  for (const priceKzt of ["0", "-1", "1e3", "1.0000001", "9223372036854.775808"]) {
    assert.throws(() => earlyRedemptionDraftTerms("exact-target-largest-remainder-v2", { targetTokens: "7", percentageBps: null, priceKzt }));
  }
});
test("snapshot window distinguishes waiting, recovery and application-only expiry", () => {
  const payload = { actionId: ACTION, status: "SCHEDULED", version: 3, onChainTransition: false };
  assert.match(snapshotWindowMessage({ ...payload, window: "NOT_STARTED" }, ACTION), /ещё не открылось/);
  assert.match(snapshotWindowMessage({ ...payload, window: "OPEN" }, ACTION), /Окно открыто/);
  assert.match(snapshotWindowMessage({ ...payload, window: "AWAITING_CHAIN_WINDOW_END" }, ACTION), /ещё не подтвердило/);
  assert.match(snapshotWindowMessage({ ...payload, window: "RECOVERY_REQUIRED" }, ACTION), /пропуска не установлен/);
  assert.match(snapshotWindowMessage({ ...payload, status: "SNAPSHOT_MISSED", window: "MISSED" }, ACTION), /Solana остаётся SCHEDULED/);
  for (const changes of [{ actionId: OPERATION }, { onChainTransition: true }, { version: "3" },
    { window: "MISSED" }, { status: "FINALIZED", window: "MISSED" }, { window: "UNKNOWN" }]) {
    assert.throws(() => snapshotWindowMessage({ ...payload, window: "OPEN", ...changes }, ACTION));
  }
});
