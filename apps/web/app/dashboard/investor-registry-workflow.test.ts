import assert from "node:assert/strict";
import test from "node:test";
import {
  canChangeWalletStatus, canReviewEligibility, eligibilityReviewCommand, hasActiveVerifiedWallet,
  remainingRegistryRefreshLocks, saveRegistryChange, walletStatusCommand,
  type RegistryInvestorFacts, type RegistryRefreshLock
} from "./investor-registry-workflow";
import {
  canEditInvestorProfile, createRegistryRequestScope, investorProfileCommand, investorRegistryPath, investorWalletsPath,
  mergeRegistryRows, readInvestorRegistryDetail, type RegistryProfileDraft
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

function profileInvestor() {
  return { ...investor(), displayName: "Test investor", type: "INDIVIDUAL", countryCode: "KZ", externalReference: "DEMO-A" };
}
function profileDraft(): RegistryProfileDraft {
  return { displayName: "  Revised investor  ", type: "INSTITUTIONAL", countryCode: " us ", externalReference: " ", reason: "REGISTRY_CORRECTION", expectedVersion: 3 };
}
test("profile correction normalizes fields, explicitly clears a reference and binds the original draft version", () => {
  const record = profileInvestor(); const before = structuredClone(record);
  assert.deepEqual(investorProfileCommand(record, admin, profileDraft()), {
    path: `/api/v1/investors/${record.id}/profile`,
    body: { displayName: "Revised investor", type: "INSTITUTIONAL", countryCode: "US", externalReference: null, expectedVersion: 3, reasonCode: "REGISTRY_CORRECTION" }
  });
  assert.deepEqual(record, before);
  assert.ok(canEditInvestorProfile({ ...record, status: "SUSPENDED" }, admin));
  assert.equal(investorProfileCommand({ ...record, registryVersion: 4 }, admin, profileDraft()), null, "A refresh cannot silently rebase a stale draft onto a new version");
  assert.equal(profileDraft().expectedVersion, 3);
});
test("profile editing rejects auditor, closed investor, no-op and invalid fields, reason or version", () => {
  const record = profileInvestor();
  assert.equal(investorProfileCommand(record, "AUDITOR", profileDraft()), null);
  assert.equal(investorProfileCommand({ ...record, status: "CLOSED" }, admin, profileDraft()), null);
  assert.equal(investorProfileCommand(record, admin, { ...record, reason: "OWNER_REQUEST", expectedVersion: 3 }), null);
  for (const patch of [ { displayName: " " }, { displayName: "x".repeat(201) }, { displayName: "name\nvalue" },
    { type: "UNKNOWN" }, { countryCode: "123" }, { countryCode: "КЗ" }, { countryCode: "ß" }, { countryCode: "ıı" }, { externalReference: "x".repeat(101) },
    { reason: "OTHER" }, { expectedVersion: 0 } ]) {
    assert.equal(investorProfileCommand(record, admin, { ...profileDraft(), ...patch }), null);
  }
});
test("server registry search encodes full query and resets pagination when no cursor is supplied", () => {
  const cursor = investor().id;
  assert.equal(investorRegistryPath("  wallet + Ω  ", cursor), `/api/v1/investors?limit=20&search=wallet+%2B+%CE%A9&cursor=${cursor}`);
  assert.equal(investorRegistryPath("next"), "/api/v1/investors?limit=20&search=next");
  assert.equal(investorRegistryPath(" "), "/api/v1/investors?limit=20");
  assert.equal(investorWalletsPath(cursor, "wallet cursor"), `/api/v1/investors/${cursor}/wallets?limit=20&cursor=wallet+cursor`);
  assert.deepEqual(mergeRegistryRows([{ id: "a", version: 1 }], [{ id: "a", version: 2 }, { id: "b", version: 1 }]),
    [{ id: "a", version: 2 }, { id: "b", version: 1 }]);
});
test("latest registry read cancels old requests and prevents late rows, cursors or loading updates", async () => {
  const scope = createRegistryRequestScope(); const old = scope.begin();
  let finishOld!: () => void; let committed = "";
  const late = new Promise<void>(resolve => { finishOld = resolve; }).then(() => { if (old.current()) committed = "stale"; });
  const latest = scope.begin(); assert.equal(old.signal.aborted, true); assert.equal(old.current(), false);
  if (latest.current()) committed = "latest";
  finishOld(); await late; assert.equal(committed, "latest");
  scope.cancel(); assert.equal(latest.signal.aborted, true); assert.equal(latest.current(), false);
});
test("saved-record background refresh preserves a different selected-record request", async () => {
  const selectedRequests = createRegistryRequestScope(); const savedRecordRequests = createRegistryRequestScope();
  const selectedRead = selectedRequests.begin(); const savedRead = savedRecordRequests.begin();
  const a = { ...investor(), _count: { wallets: 1 } }; const b = { ...a, id: "30000000-0000-4000-8000-000000000002" };
  let resolveSelected!: (value: Record<string, unknown>) => void;
  const selected = readInvestorRegistryDetail(() => new Promise(resolve => { resolveSelected = resolve; }), b.id, 0, selectedRead.signal);
  await readInvestorRegistryDetail(async () => a, a.id, 0, savedRead.signal);
  assert.equal(selectedRead.signal.aborted, false); assert.equal(selectedRead.current(), true);
  resolveSelected(b); assert.equal((await selected).record.id, b.id);
});
test("detail refresh reads UUID outside the list and reloads previously opened wallet pages to release saved locks", async () => {
  const base = { ...investor(), _count: { wallets: 23 }, registryVersion: 4 };
  const wallets = Array.from({ length: 23 }, (_, index) => ({ ...base.wallets[0]!, id: `wallet-${index}`, registryVersion: index === 22 ? 3 : 2 }));
  const calls: string[] = [];
  const result = await readInvestorRegistryDetail(async path => {
    calls.push(path);
    return calls.length === 1 ? { ...base, wallets: wallets.slice(0, 20) } : { items: wallets.slice(20), nextCursor: null };
  }, base.id, 23, new AbortController().signal);
  assert.deepEqual(calls, [`/api/v1/investors/${base.id}`, investorWalletsPath(base.id, "wallet-19")]);
  assert.equal(result.record.wallets.length, 23); assert.equal(result.nextCursor, null);
  assert.deepEqual(remainingRegistryRefreshLocks([{ kind: "wallet", id: "wallet-22", version: 2 }], [result.record]), []);
  const preview = await readInvestorRegistryDetail(async () => ({ ...base, wallets: wallets.slice(0, 20) }), base.id, 0, new AbortController().signal);
  assert.equal(preview.record.wallets.length, 20); assert.equal(preview.nextCursor, "wallet-19");
  const canonicalId = "30000000-0000-4000-8000-abcdefabcdef";
  const upperCaseSelection = await readInvestorRegistryDetail(async path => {
    assert.equal(path, `/api/v1/investors/${canonicalId}`);
    return { ...base, id: canonicalId, wallets: wallets.slice(0, 20) };
  }, canonicalId.toUpperCase(), 0, new AbortController().signal);
  assert.equal(upperCaseSelection.record.id, canonicalId);
});
test("profile write followed by failed detail read locks once and preserves the successful-write recovery path", async () => {
  const record = profileInvestor(); const command = investorProfileCommand(record, admin, profileDraft())!;
  let posts = 0; let locked = false;
  const result = await saveRegistryChange(async () => { posts++; return { ...record, registryVersion: 4 }; }, command,
    () => { locked = true; }, async () => readInvestorRegistryDetail(async () => { throw new Error("read unavailable"); }, record.id, 0, new AbortController().signal));
  assert.deepEqual(result, { refreshed: false }); assert.equal(posts, 1); assert.equal(locked, true);
  for (const locale of ["ru", "en"] as const) {
    const message = createTranslator(locale)("registry.investor.profileConfirm", { name: "Investor Ω", displayName: "Updated Δ", type: "INDIVIDUAL", country: "US", reference: "DEMO-7", reason: "OWNER_REQUEST", version: 3 });
    for (const value of ["Investor Ω", "Updated Δ", "INDIVIDUAL", "US", "DEMO-7", "OWNER_REQUEST", "3"]) assert.ok(message.includes(value));
  }
});
