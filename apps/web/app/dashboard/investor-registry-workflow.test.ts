import assert from "node:assert/strict";
import test from "node:test";
import {
  canChangeWalletStatus, canReviewEligibility, eligibilityReviewCommand, hasActiveVerifiedWallet,
  remainingRegistryRefreshLocks, saveRegistryChange, walletStatusCommand,
  type RegistryInvestorFacts, type RegistryRefreshLock
} from "./investor-registry-workflow";
import { createTranslator, translateStoredMessage } from "./locale";

function investor(): RegistryInvestorFacts {
  return {
    id: "30000000-0000-4000-8000-000000000001", status: "ACTIVE", eligibilityStatus: "ELIGIBLE", registryVersion: 3,
    wallets: [{ id: "40000000-0000-4000-8000-000000000001", status: "ACTIVE", registryVersion: 2,
      verifiedAt: "2026-10-11T00:00:00Z", revokedAt: null }]
  };
}
const admin = "ADMINISTRATOR";

test("eligibility review sends the loaded version and fixed reason without changing original facts", () => {
  const record = investor();
  const original = structuredClone(record);
  const command = eligibilityReviewCommand(record, admin, "SUSPENDED", "PERIODIC_REVIEW")!;
  assert.equal(command.path, `/api/v1/investors/${record.id}/eligibility/review`);
  assert.deepEqual(command.body, { decision: "SUSPENDED", expectedVersion: 3, reasonCode: "PERIODIC_REVIEW" });
  assert.deepEqual(record, original);
  for (const status of ["ELIGIBLE", "NOT_ELIGIBLE", "SUSPENDED"]) {
    record.eligibilityStatus = status;
    assert.ok(canReviewEligibility(record, admin));
    assert.equal(eligibilityReviewCommand(record, admin, status, "OWNER_REQUEST"), null);
  }
});

test("new eligibility review is unavailable to auditor, inactive or pending investor, invalid version or reason", () => {
  const record = investor();
  assert.equal(eligibilityReviewCommand(record, "AUDITOR", "SUSPENDED", "PERIODIC_REVIEW"), null);
  for (const status of ["PENDING_REVIEW", "UNKNOWN"]) {
    assert.equal(canReviewEligibility({ ...record, eligibilityStatus: status }, admin), false);
  }
  assert.equal(canReviewEligibility({ ...record, status: "INACTIVE" }, admin), false);
  for (const version of [0, -1, 1.5, NaN, 2_147_483_647, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(canReviewEligibility({ ...record, registryVersion: version }, admin), false);
  }
  for (const reason of ["", "DEMO_CRITERIA_MET", "custom reason", "WALLET_REPLACEMENT"]) {
    assert.equal(eligibilityReviewCommand(record, admin, "SUSPENDED", reason), null);
  }
  assert.equal(eligibilityReviewCommand(record, admin, "ACTIVE", "OWNER_REQUEST"), null);
});

test("restoring eligibility requires an active verified non-revoked wallet", () => {
  const record = investor();
  record.eligibilityStatus = "SUSPENDED";
  assert.ok(eligibilityReviewCommand(record, admin, "ELIGIBLE", "REGISTRY_CORRECTION"));
  for (const wallet of [
    { ...record.wallets[0]!, status: "BLOCKED" },
    { ...record.wallets[0]!, status: "PENDING" },
    { ...record.wallets[0]!, verifiedAt: null },
    { ...record.wallets[0]!, revokedAt: "2026-10-11T01:00:00Z" }
  ]) {
    const unverified = { ...record, wallets: [wallet] };
    assert.equal(hasActiveVerifiedWallet(unverified), false);
    assert.equal(eligibilityReviewCommand(unverified, admin, "ELIGIBLE", "OWNER_REQUEST"), null);
    assert.ok(eligibilityReviewCommand(unverified, admin, "NOT_ELIGIBLE", "OWNER_REQUEST"));
  }
});

test("wallet status command only toggles verified ACTIVE and BLOCKED with its own loaded version", () => {
  const record = investor();
  const wallet = record.wallets[0]!;
  assert.deepEqual(walletStatusCommand(record, wallet, admin, "SECURITY_CONCERN"), {
    path: `/api/v1/investors/${record.id}/wallets/${wallet.id}/status`,
    body: { status: "BLOCKED", expectedVersion: 2, reasonCode: "SECURITY_CONCERN" }
  });
  wallet.status = "BLOCKED";
  assert.deepEqual(walletStatusCommand(record, wallet, admin, "REGISTRY_CORRECTION")!.body,
    { status: "ACTIVE", expectedVersion: 2, reasonCode: "REGISTRY_CORRECTION" });
  assert.equal(record.eligibilityStatus, "ELIGIBLE");
});

test("pending, revoked, unverified or foreign wallet and non-administrator cannot be toggled", () => {
  const record = investor();
  const wallet = record.wallets[0]!;
  assert.equal(canChangeWalletStatus(record, wallet, "AUDITOR"), false);
  assert.equal(canChangeWalletStatus({ ...record, status: "INACTIVE" }, wallet, admin), false);
  for (const invalid of [
    { ...wallet, status: "PENDING" }, { ...wallet, status: "REVOKED" },
    { ...wallet, verifiedAt: null }, { ...wallet, revokedAt: "2026-10-11T01:00:00Z" },
    { ...wallet, registryVersion: 0 }, { ...wallet, id: "different-wallet" }
  ]) assert.equal(walletStatusCommand(record, invalid, admin, "OWNER_REQUEST"), null);
  assert.equal(walletStatusCommand(record, wallet, admin, ""), null);
});

test("a saved write locks before refresh and a failed refresh never repeats the write", async () => {
  const record = investor();
  const command = eligibilityReviewCommand(record, admin, "SUSPENDED", "PERIODIC_REVIEW")!;
  const events: string[] = [];
  let posts = 0;
  const result = await saveRegistryChange(async (path, init) => {
    posts++; events.push("post");
    assert.equal(path, command.path); assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), command.body);
    return { registryVersion: 4 };
  }, command, () => { events.push("saved"); }, async () => { events.push("read"); throw new Error("API offline"); });
  assert.deepEqual(result, { refreshed: false });
  assert.equal(posts, 1);
  assert.deepEqual(events, ["post", "saved", "read"]);
});

test("write rejection does not clear choices, lock a successful write or reload automatically", async () => {
  const record = investor();
  const choice = { decision: "SUSPENDED", reason: "PERIODIC_REVIEW" };
  const command = eligibilityReviewCommand(record, admin, choice.decision, choice.reason)!;
  let saved = false; let refresh = false;
  await assert.rejects(saveRegistryChange(async () => { throw new Error("REGISTRY_CONFLICT"); }, command,
    () => { saved = true; choice.reason = ""; }, async () => { refresh = true; }), /REGISTRY_CONFLICT/);
  assert.deepEqual(choice, { decision: "SUSPENDED", reason: "PERIODIC_REVIEW" });
  assert.equal(saved, false); assert.equal(refresh, false);
});

test("a confirmed write followed by a fresh read reports success once", async () => {
  const record = investor();
  const command = walletStatusCommand(record, record.wallets[0]!, admin, "OWNER_REQUEST")!;
  let posts = 0; let saved = 0; let reads = 0;
  assert.deepEqual(await saveRegistryChange(async () => { posts++; return {}; }, command,
    () => { saved++; }, async () => { reads++; return { registryVersion: 3 }; }), { refreshed: true });
  assert.equal(posts, 1); assert.equal(saved, 1); assert.equal(reads, 1);
});

test("post-save lock persists for missing or stale records and only clears on a newer record read", () => {
  const record = investor();
  const locks: RegistryRefreshLock[] = [
    { kind: "investor", id: record.id, version: 3 }, { kind: "wallet", id: record.wallets[0]!.id, version: 2 }
  ];
  assert.deepEqual(remainingRegistryRefreshLocks(locks, []), locks);
  assert.deepEqual(remainingRegistryRefreshLocks(locks, [record]), locks);
  record.registryVersion = 4;
  assert.deepEqual(remainingRegistryRefreshLocks(locks, [record]), [locks[1]]);
  record.wallets[0]!.registryVersion = 3;
  assert.deepEqual(remainingRegistryRefreshLocks(locks, [record]), []);
});

test("RU/EN review confirmations and stored recovery notices retain exact names, reasons and versions", () => {
  const values = { name: "Investor Δ / Тест", decision: "SUSPENDED", reason: "PERIODIC_REVIEW", version: 42 };
  for (const locale of ["ru", "en"] as const) {
    const confirmation = createTranslator(locale)("registry.investor.reviewConfirm", values);
    for (const value of Object.values(values)) assert.ok(confirmation.includes(String(value)));
  }
  const ru = createTranslator("ru")("registry.investor.walletStatusRefreshFailed");
  assert.equal(translateStoredMessage(ru, "en"), createTranslator("en")("registry.investor.walletStatusRefreshFailed"));
});
