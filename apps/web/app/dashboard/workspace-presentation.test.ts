import assert from "node:assert/strict";
import test from "node:test";
import type { CorporateActionView } from "./action-workflow.js";
import { actionPresentation, attentionActions, filterRegistry, formatWorkspaceDate } from "./workspace-presentation.js";

test("display dates identify missing and invalid values and respect the operator time zone", () => {
  assert.equal(formatWorkspaceDate(null, "Asia/Qyzylorda"), "Не указано");
  assert.equal(formatWorkspaceDate("invalid", "Asia/Qyzylorda"), "Дата неизвестна");
  const utc = "2026-10-10T22:15:00.000Z";
  assert.match(formatWorkspaceDate(utc, "Asia/Qyzylorda"), /11\.10\.2026.*03:15/);
  assert.equal(formatWorkspaceDate(utc, "UTC", true), "10.10.2026");
});

function action(status: string, transactions: CorporateActionView["blockchainTransactions"] = []): CorporateActionView {
  return {
    id: "00000000-0000-4000-8000-000000000001", version: 1, instrumentId: "instrument",
    type: "COUPON_PAYMENT", intent: "Coupon", sourceType: "MANUAL", sourceReference: null,
    sourceDocument: null, sourceTimestamp: null, recordAt: "2026-10-10T12:00:00Z",
    executeAt: "2026-10-10T13:00:00Z", status, reviewNote: null,
    redemptionPercentageBps: null, redemptionPriceMinor: null,
    instrument: { id: "instrument", name: "Bond", ticker: "DEMO", issuerAuthority: "issuer", corporateActionAuthority: "operator", network: "SOLANA_LOCALNET" },
    snapshot: null, blockchainTransactions: transactions
  };
}
function transaction(operationType: string, status: string, signature: string | null = null) {
  return { id: "attempt", operationType, status, signature, lastErrorCode: null, reason: null };
}

test("registry search combines loaded data, status and numeric sorting without mutating the source", () => {
  const rows = [{ name: "Облигация 10", status: "ACTIVE" }, { name: "Облигация 2", status: "ACTIVE" }, { name: "Облигация 1", status: "DRAFT" }];
  const original = [...rows];
  const result = filterRegistry(rows, { query: "  ОБЛИГАЦИЯ ", status: "ACTIVE", sort: "asc" }, row => row.name, row => row.status);
  assert.deepEqual(result.map(row => row.name), ["Облигация 2", "Облигация 10"]);
  assert.deepEqual(rows, original);
  assert.deepEqual(filterRegistry(rows, { query: "missing", status: "", sort: "desc" }, row => row.name, row => row.status), []);
});

test("unknown confirmation preserves the original attempt and directs the operator to check its signature", () => {
  const tx = transaction("CALCULATION_FINALIZE", "UNKNOWN_CONFIRMATION", "original-signature");
  const view = actionPresentation(action("UNDER_REVIEW", [tx]), true);
  assert.equal(view.pending, tx);
  assert.equal(view.next, "Проверить существующую подпись");
  assert.match(view.explanation, /не разрешает повторную отправку/);
  assert.equal(view.steps.find(step => step.label === "Регистрация")?.state, "current");
});

test("application approval does not manufacture on-chain registration or approval proof", () => {
  const view = actionPresentation(action("APPROVED"), false);
  assert.equal(view.steps.find(step => step.label === "Согласование")?.state, "blocked");
  assert.match(view.steps.find(step => step.label === "Согласование")!.detail, /proof отсутствует/);
  assert.match(view.explanation, /Режим чтения/);
  assert.equal(view.steps.at(-1)?.state, "unavailable");
});

test("a cancelled draft is blocked without claiming scheduling was completed", () => {
  const view = actionPresentation(action("CANCELLED"), true);
  assert.equal(view.steps[0]?.state, "blocked");
  assert.equal(view.steps.some(step => step.state === "current"), false);
  assert.equal(view.terminal, true);
});

test("only finalized operation proofs complete registration and chain approval stages", () => {
  const view = actionPresentation(action("APPROVED", [transaction("CALCULATION_FINALIZE", "FINALIZED"), transaction("ACTION_APPROVAL", "FINALIZED")]), true);
  assert.equal(view.steps.find(step => step.label === "Регистрация")?.state, "done");
  assert.equal(view.steps.find(step => step.label === "Согласование")?.state, "done");
});

test("attention prioritizes unknown signatures and excludes completed history without mutating the registry", () => {
  const scheduled = action("SCHEDULED"); const unknown = action("UNDER_REVIEW", [transaction("CALCULATION_FINALIZE", "UNKNOWN_CONFIRMATION", "original")]);
  const records = [scheduled, action("FINALIZED"), unknown, action("CANCELLED")];
  assert.deepEqual(attentionActions(records), [unknown, scheduled]); assert.equal(records[0], scheduled);
  const view = actionPresentation(action("UNDER_REVIEW", [transaction("COUPON_FUNDING", "PREPARED"), unknown.blockchainTransactions[0]!]), true);
  assert.equal(view.pending?.operationType, "CALCULATION_FINALIZE");
});
test("partial coupon proof stays in execution; a finalized receipt completes the workflow", () => {
  const partial = { ...action("PARTIALLY_SETTLED", [transaction("CALCULATION_FINALIZE", "FINALIZED"), transaction("ACTION_APPROVAL", "FINALIZED"), transaction("COUPON_PAYMENT", "FINALIZED")]),
    eligibleHolders: 3, couponExecutionEnabled: true };
  assert.equal(actionPresentation(partial, true).steps.find(step => step.label === "Исполнение")?.state, "current");
  assert.equal(actionPresentation(partial, true).steps.at(-1)?.state, "unavailable");
  const complete = { ...partial, status: "FINALIZED", blockchainTransactions: [...partial.blockchainTransactions, transaction("COUPON_FINALIZE", "FINALIZED")] };
  assert.equal(actionPresentation(complete, true).steps.at(-1)?.state, "done");
  assert.equal(actionPresentation(complete, true).next, "Скачать итоговый документ");
});
