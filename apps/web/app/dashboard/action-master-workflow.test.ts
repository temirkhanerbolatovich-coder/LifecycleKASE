import assert from "node:assert/strict";
import test from "node:test";
import { actionMaster, ACTION_MASTER_STEPS, masterStepForOperation, type ActionMasterFacts } from "./action-master-workflow";
import type { CorporateActionView } from "./action-workflow";
import type { EntitlementsView } from "./entitlement-workflow";
import type { ApprovalView } from "./action-approval-workflow";
import type { CouponBudget } from "./coupon-workflow";
import type { RedemptionExecutionView } from "./redemption-execution-workflow";
import { workspaceActionStepFromHash, workspaceSectionHash } from "./workspace-navigation";

const id = "00000000-0000-4000-8000-000000000001";
const transaction = (operationType: string, status = "FINALIZED", signature: string | null = "saved-signature") => ({
  id: operationType, operationType, status, signature, lastErrorCode: null, reason: null,
});
function fixture(status = "DRAFT", type = "COUPON_PAYMENT", controlled = false): CorporateActionView {
  return { id, version: 7, instrumentId: id, type, intent: "Synthetic operator test", sourceType: "MANUAL", sourceReference: null,
    sourceDocument: null, sourceTimestamp: null, recordAt: "2026-10-12T10:00:00Z", executeAt: "2026-10-12T11:00:00Z", status,
    reviewNote: null, redemptionPercentageBps: type === "EARLY_REDEMPTION" ? 2000 : null, redemptionPriceMinor: null,
    couponExecutionEnabled: true, redemptionExecutionEnabled: true, eligibleHolders: 2,
    instrument: { id, ticker: "TEST", name: "Synthetic bond", issuerAuthority: "issuer", corporateActionAuthority: "executor", network: "SOLANA_LOCALNET",
      tokenPolicy: controlled ? "CONTROLLED_FROZEN_V2" : "LEGACY_UNRESTRICTED_V1" },
    snapshot: status === "DRAFT" || status === "SCHEDULED" || status === "SNAPSHOT_MISSED" ? null : { id, status: "FINALIZED", snapshotHash: "ab".repeat(32),
      solanaSlot: "20", recordAt: "2026-10-12T10:00:00Z", blockTime: "2026-10-12T10:00:01Z", totalBalance: "10", investorCount: 2, walletCount: 2 },
    blockchainTransactions: [] };
}
function calculation(action: CorporateActionView, units = true): EntitlementsView {
  return { actionId: action.id, actionVersion: action.version, status: action.status, totalEntitlementMinor: "1000000", onchainRegistrationEnabled: true,
    onchainCalculationFinalized: true, items: [1, 2].map(index => ({ id: String(index), unitReservationConfirmed: units, currentEligibility: { eligible: true, reason: "" } })),
    investors: [{ investorId: id, receiverWallets: ["receiver"] }] } as EntitlementsView;
}
function reserve(action: CorporateActionView, exists = true): ApprovalView {
  return { actionId: action.id, actionVersion: action.version, reserveExists: exists, amountMinor: "1000000", reservedMinor: exists ? "1000000" : "0",
    approved: false, approver: "separate-approver", pending: null } as ApprovalView;
}
test("master has six stable TZ steps; an unsigned draft completes no on-chain work", () => {
  const master = actionMaster(fixture());
  assert.deepEqual(master.steps.map(step => step.id), ACTION_MASTER_STEPS);
  assert.deepEqual(master.steps.map(step => step.state), ["active", "not_started", "not_started", "not_started", "not_started", "not_started"]);
  assert.equal(master.recommended, "terms");
});
test("finalized snapshot opens calculation while database approval cannot fabricate registration, reserve or separate approval", () => {
  const action = fixture("APPROVED"); const master = actionMaster(action);
  assert.deepEqual(master.steps.map(step => step.state), ["completed", "completed", "active", "not_started", "not_started", "not_started"]);
  assert.equal(master.recommended, "calculation");
  action.blockchainTransactions.push(transaction("CALCULATION_FINALIZE", "SUBMITTED"));
  assert.equal(actionMaster(action).steps[2]!.state, "active");
});
test("controlled early and maturity redemption require every assigned-unit reservation before readiness", () => {
  for (const type of ["EARLY_REDEMPTION", "BOND_REDEMPTION"]) {
    const action = fixture("UNDER_REVIEW", type, true); const facts = { entitlements: calculation(action, false) };
    assert.equal(actionMaster(action, facts).recommended, "calculation");
    assert.match(actionMaster(action, facts).steps[2]!.detail, /нулевые назначения/);
    facts.entitlements.items[0]!.unitReservationConfirmed = true;
    assert.equal(actionMaster(action, facts).steps[2]!.state, "active");
    facts.entitlements.items[1]!.unitReservationConfirmed = true;
    const waiting = actionMaster(action, facts);
    assert.equal(waiting.steps[2]!.state, "completed"); assert.equal(waiting.steps[3]!.state, "blocked");
    assert.equal(waiting.recommended, "snapshot");
    action.blockchainTransactions.push(transaction("CONTROLLED_CAPTURE_FINISH"));
    assert.equal(actionMaster(action, facts).recommended, "readiness");
  }
});
test("treasury funding alone cannot complete readiness; a complete action reserve opens the separate approval step", () => {
  const action = fixture("UNDER_REVIEW"); const facts: ActionMasterFacts = { entitlements: calculation(action), approval: reserve(action, false),
    budget: { corporateActionId: id, actionVersion: action.version, budgetReady: true } as CouponBudget };
  action.blockchainTransactions.push(transaction("COUPON_FUNDING"));
  assert.equal(actionMaster(action, facts).recommended, "readiness");
  facts.approval = reserve(action);
  assert.equal(actionMaster(action, facts).steps[3]!.state, "completed");
  assert.equal(actionMaster(action, facts).recommended, "approval");
  assert.equal(actionMaster(action, facts).steps[4]!.state, "active");
});
test("eligibility, registration gate and zero rounded rights expose specific blockers", () => {
  const action = fixture("CALCULATED"); const facts = { entitlements: calculation(action) };
  facts.entitlements.onchainCalculationFinalized = false; facts.entitlements.onchainRegistrationEnabled = false;
  assert.equal(actionMaster(action, facts).steps[2]!.state, "blocked");
  assert.match(actionMaster(action, facts).steps[2]!.detail, /отключена/);
  facts.entitlements.onchainRegistrationEnabled = true; facts.entitlements.totalEntitlementMinor = "0";
  assert.match(actionMaster(action, facts).steps[2]!.detail, /до нуля/);
  facts.entitlements.totalEntitlementMinor = "1000000"; facts.entitlements.items[0]!.currentEligibility.eligible = false;
  assert.match(actionMaster(action, facts).steps[2]!.detail, /Допуск/);
});
test("return for revision does not retain completed calculation; notes and receiver objects are never mutated by master projection", () => {
  const action = fixture("RETURNED_FOR_REVISION"); action.reviewNote = "Explain receiver change";
  action.blockchainTransactions.push(transaction("CALCULATION_FINALIZE")); const facts = { entitlements: calculation(action) };
  const before = JSON.stringify({ action, facts }); const master = actionMaster(action, facts);
  assert.equal(master.steps[2]!.state, "active"); assert.match(master.steps[2]!.detail, /доработку/);
  assert.equal(JSON.stringify({ action, facts }), before);
});
test("unknown outcome prioritizes original signature above an unsigned later step and preserves recovery identity", () => {
  const action = fixture("UNDER_REVIEW"); const original = transaction("CONTROLLED_CAPTURE_FINISH", "UNKNOWN_CONFIRMATION", "original-signature");
  action.blockchainTransactions = [transaction("COUPON_FUNDING", "PREPARED", null), original];
  const master = actionMaster(action, { entitlements: calculation(action) });
  assert.equal(master.pending, original); assert.equal(master.pending.signature, "original-signature");
  assert.equal(master.recommended, "snapshot"); assert.match(master.steps[1]!.detail, /только проверку/);
});
test("coupon and both redemption types require their own final receipt proof after every payment", () => {
  for (const type of ["COUPON_PAYMENT", "EARLY_REDEMPTION", "BOND_REDEMPTION"]) {
    const action = fixture("SETTLED", type); action.blockchainTransactions = [transaction("ACTION_APPROVAL"), transaction("CALCULATION_FINALIZE")];
    const facts: ActionMasterFacts = { execution: { actionId: id, actionVersion: action.version, enabled: true, paid: 2, payable: 2 } as RedemptionExecutionView };
    let master = actionMaster(action, facts); assert.equal(master.steps[5]!.state, "active"); assert.match(master.steps[5]!.detail, /итоговое подтверждение/);
    action.status = "FINALIZED"; action.blockchainTransactions.push(transaction(type === "COUPON_PAYMENT" ? "REDEMPTION_FINALIZE" : "COUPON_FINALIZE"));
    assert.notEqual(actionMaster(action, facts).steps[5]!.state, "completed");
    action.blockchainTransactions.push(transaction(type === "COUPON_PAYMENT" ? "COUPON_FINALIZE" : "REDEMPTION_FINALIZE"));
    master = actionMaster(action, facts); assert.equal(master.steps[5]!.state, "completed"); assert.equal(master.recommended, "execution");
  }
});
test("configuration-disabled execution and an insufficient funding budget remain concrete blockers", () => {
  const action = fixture("APPROVED"); action.blockchainTransactions = [transaction("CALCULATION_FINALIZE"), transaction("ACTION_APPROVAL")];
  action.couponExecutionEnabled = false;
  assert.equal(actionMaster(action).steps[5]!.state, "blocked");
  const waiting = fixture("UNDER_REVIEW"); const facts = { entitlements: calculation(waiting),
    budget: { corporateActionId: id, actionVersion: waiting.version, budgetReady: false } as CouponBudget };
  assert.match(actionMaster(waiting, facts).steps[3]!.detail, /недостаточно/);
});
test("stale or unrelated read models cannot manufacture a completed reserve", () => {
  const action = fixture("UNDER_REVIEW"); const stale = reserve(action); stale.actionVersion--;
  assert.equal(actionMaster(action, { entitlements: calculation(action), approval: stale }).steps[3]!.state, "active");
  stale.actionVersion = action.version; stale.actionId = "another-action";
  assert.equal(actionMaster(action, { entitlements: calculation(action), approval: stale }).steps[3]!.state, "active");
});
test("cancelled and missed snapshot actions cannot proceed through Continue", () => {
  for (const status of ["CANCELLED", "REJECTED", "SNAPSHOT_MISSED"]) {
    const master = actionMaster({ ...fixture(status), snapshot: null });
    assert.equal(master.terminal, true); assert.equal(master.steps.some(step => step.state === "active"), false);
    assert.equal(master.steps.some(step => step.state === "blocked"), true);
  }
});
test("step deep links preserve selected action and reject other IDs, sections and unsupported steps", () => {
  for (const step of ACTION_MASTER_STEPS) {
    const hash = workspaceSectionHash("actions", id, step); assert.equal(workspaceActionStepFromHash(hash, id), step);
  }
  for (const hash of [`#actions?selected=${id}&step=sign`, `#investors?selected=${id}&step=approval`, "#actions?selected=bad&step=execution"])
    assert.equal(workspaceActionStepFromHash(hash, id), null);
  assert.equal(workspaceActionStepFromHash(workspaceSectionHash("actions", id, "execution"), "00000000-0000-4000-8000-000000000002"), null);
  assert.equal(workspaceSectionHash("actions", null, "execution"), "#actions");
});
test("all existing signed workflow phases map to one retained master step", () => {
  for (const [operation, expected] of [["ACTION_SCHEDULE", "terms"], ["SNAPSHOT_REGISTER", "snapshot"], ["CONTROLLED_CAPTURE_FINISH", "snapshot"],
    ["CALCULATION_FINALIZE", "calculation"], ["CONTROLLED_UNIT_RESERVATION", "calculation"], ["ACTION_RESERVE_RELEASE", "readiness"],
    ["ACTION_APPROVAL", "approval"], ["REDEMPTION_PAYMENT", "execution"], ["COUPON_FINALIZE", "execution"]]) assert.equal(masterStepForOperation(operation!), expected);
  assert.equal(actionMaster(fixture(), {}, "en").steps[0]!.label, "Terms and scheduling");
});
