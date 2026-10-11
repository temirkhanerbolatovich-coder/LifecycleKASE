import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** Real HTTP/PostgreSQL checks inside the registry runner's disposable database. */
export async function testRegistryProfiles({ database, request, administrator, auditor, issuer, publicAddress, governance }) {
  const post = (path, body, options = {}) => request(path, { cookie: administrator.cookie, method: "POST", body, ...options });
  const get = (path, options = {}) => request(path, { cookie: auditor.cookie, ...options });
  const ok = (response, status = 201) => {
    assert.equal(response.status, status, JSON.stringify(response.payload));
    return response.payload;
  };
  const denied = (response, code, status = 409) => {
    assert.equal(response.status, status, JSON.stringify(response.payload));
    assert.equal(response.payload.code, code);
  };
  const label = `Synthetic Profile ${randomUUID()}`;
  const investor = ok(await post("/investors", { displayName: label, type: "INDIVIDUAL", countryCode: "KZ", externalReference: label }));
  const path = `/investors/${investor.id}`;
  for (const endpoint of [path, `${path}/wallets`]) {
    assert.equal((await get(endpoint, { cookie: undefined })).status, 401);
    assert.equal((await get(endpoint, { cookie: issuer.cookie })).status, 403);
    const readable = await get(endpoint);
    ok(readable, 200);
    assert.equal(readable.headers.get("cache-control"), "no-store");
  }
  denied(await get(`/investors/${randomUUID()}`), "INVESTOR_NOT_FOUND", 404);
  denied(await get(`/investors/${randomUUID()}/wallets`), "INVESTOR_NOT_FOUND", 404);
  denied(await get("/investors/not-a-uuid"), "INVALID_REQUEST", 400);

  const walletRows = Array.from({ length: 25 }, () => ({ id: randomUUID(), address: publicAddress(), investorId: investor.id,
    network: "SOLANA_LOCALNET", status: "PENDING" }));
  await database.wallet.createMany({ data: walletRows });
  const detail = ok(await get(path), 200);
  assert.equal(detail._count.wallets, 25);
  assert.equal(detail.wallets.length, 20, "Detail must distinguish a bounded preview from the full count");
  const seen = [];
  let cursor = null;
  do {
    const page = ok(await get(`${path}/wallets?limit=7${cursor ? `&cursor=${cursor}` : ""}`), 200);
    assert.ok(page.items.length <= 7);
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen.map(row => row.id), walletRows.map(row => row.id).sort());
  assert.equal(new Set(seen.map(row => row.id)).size, 25);
  assert.ok(seen.every(row => row.registryVersion === 1 && row.verifiedAt === null && row.revokedAt === null));
  const foreignWallet = await database.wallet.findFirstOrThrow({ where: { investorId: governance.investorId } });
  for (const query of [`cursor=${foreignWallet.id}`, `cursor=${randomUUID()}`, "limit=0", "limit=101", "limit=1.5"]) {
    denied(await get(`${path}/wallets?${query}`), "INVALID_REQUEST", 400);
  }
  // Search must include a wallet outside the twenty-row preview and run before list pagination.
  const lastWallet = seen.at(-1);
  assert.ok(!detail.wallets.some(row => row.id === lastWallet.id));
  const walletSearch = ok(await get(`/investors?search=${encodeURIComponent(lastWallet.address)}`), 200);
  assert.deepEqual(walletSearch.items.map(row => row.id), [investor.id]);
  assert.deepEqual(ok(await get(`/investors?search=${investor.id}`), 200).items.map(row => row.id), [investor.id]);
  const searchLabel = `Search ${randomUUID()}`;
  const matched = [];
  for (let index = 0; index < 3; index++) matched.push(await database.investor.create({ data: {
    displayName: `${searchLabel} ${index}`, type: "INDIVIDUAL", countryCode: "KZ"
  } }));
  // JavaScript Date loses PostgreSQL's final three timestamp digits. Keep all rows at
  // the same precise timestamp so pagination must use the stored cursor and UUID tie-break.
  for (const row of matched) {
    await database.$executeRaw`UPDATE investors SET created_at = ${"2026-10-11T12:00:00.123456Z"}::timestamptz
      WHERE id = ${row.id}::uuid`;
    const precision = await database.$queryRaw`SELECT to_char(created_at AT TIME ZONE 'UTC', 'US') AS micros
      FROM investors WHERE id = ${row.id}::uuid`;
    assert.equal(precision[0].micros, "123456");
  }
  const first = ok(await get(`/investors?limit=2&search=${encodeURIComponent(searchLabel.toLowerCase())}`), 200);
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = ok(await get(`/investors?limit=2&search=${encodeURIComponent(searchLabel)}&cursor=${first.nextCursor}`), 200);
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(new Set([...first.items, ...second.items].map(row => row.id)), new Set(matched.map(row => row.id)));
  assert.deepEqual([...first.items, ...second.items].map(row => row.id), matched.map(row => row.id).sort());
  // The original cursor remains valid if a correction removes its record from the search.
  // Offset/skip pagination would drop the next matching row in this situation.
  await database.investor.update({ where: { id: first.nextCursor }, data: { displayName: "Synthetic corrected cursor" } });
  const afterCursorCorrection = ok(await get(`/investors?limit=2&search=${encodeURIComponent(searchLabel)}&cursor=${first.nextCursor}`), 200);
  assert.deepEqual(afterCursorCorrection.items.map(row => row.id), second.items.map(row => row.id));
  assert.equal(afterCursorCorrection.nextCursor, null);
  assert.equal(ok(await get(`/investors?search=${randomUUID()}`), 200).items.length, 0);
  for (const search of ["x".repeat(201), "synthetic\u0001input"]) {
    denied(await get(`/investors?search=${encodeURIComponent(search)}`), "INVALID_REQUEST", 400);
  }
  denied(await get(`/investors?cursor=${randomUUID()}`), "INVALID_REQUEST", 400);
  console.log("PASS authenticated investor details, all 25 wallets, scoped cursors and server search before pagination");

  const profilePath = `${path}/profile`;
  const body = { displayName: `${label} corrected`, type: "INSTITUTIONAL", countryCode: "GB", externalReference: null,
    expectedVersion: 1, reasonCode: "REGISTRY_CORRECTION" };
  assert.equal((await post(profilePath, body, { cookie: undefined })).status, 401);
  assert.equal((await post(profilePath, body, { cookie: auditor.cookie })).status, 403);
  assert.equal((await post(profilePath, body, { cookie: issuer.cookie })).status, 403);
  assert.equal((await post(profilePath, body, { requestOrigin: null })).status, 403);
  assert.equal((await post(profilePath, body, { requestOrigin: "https://untrusted.example" })).status, 403);
  for (const invalid of [
    { displayName: "" }, { displayName: "x".repeat(201) }, { displayName: "bad\nname" },
    { type: "CORPORATE" }, { countryCode: "KAZ" }, { countryCode: "ß" }, { countryCode: "ıı" },
    { externalReference: "" }, { externalReference: "x".repeat(101) },
    { externalReference: 123 }, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { reasonCode: "unreviewed" },
    { kycStatus: "VERIFIED" }, { status: "CLOSED" }, { wallets: [] }
  ]) denied(await post(profilePath, { ...body, ...invalid }), "INVALID_REQUEST", 400);
  for (const omitted of ["displayName", "type", "countryCode", "externalReference", "expectedVersion", "reasonCode"]) {
    const incomplete = { ...body };
    delete incomplete[omitted];
    denied(await post(profilePath, incomplete), "INVALID_REQUEST", 400);
  }
  const savedResponse = await post(profilePath, body);
  let saved = ok(savedResponse);
  assert.equal(saved.registryVersion, 2);
  assert.equal(saved.externalReference, null);
  assert.equal(saved.displayName, body.displayName);
  assert.equal(saved.type, body.type);
  assert.equal(saved.countryCode, body.countryCode);
  for (const key of ["id", "kycStatus", "eligibilityStatus", "eligibilityReasonCode", "eligibilityReviewedAt", "status"]) {
    assert.deepEqual(saved[key], investor[key]);
  }
  assert.deepEqual(saved.wallets, detail.wallets);
  const audit = await database.auditLog.findFirstOrThrow({ where: { entityId: investor.id, event: "INVESTOR_PROFILE_UPDATED" } });
  assert.equal(audit.actorId, administrator.userId);
  assert.equal(audit.correlationId, savedResponse.headers.get("x-correlation-id"));
  assert.equal(audit.metadataJson.reasonCode, body.reasonCode);
  assert.equal(audit.metadataJson.previousVersion, 1);
  assert.equal(audit.metadataJson.registryVersion, 2);
  assert.deepEqual(new Set(audit.metadataJson.changedFields), new Set(["displayName", "type", "countryCode", "externalReference"]));
  const auditText = JSON.stringify(audit.metadataJson);
  assert.ok(!auditText.includes(label) && !auditText.includes('"GB"'), "Audit stores field names, not profile contents");
  denied(await post(profilePath, body), "REGISTRY_CONFLICT");
  denied(await post(profilePath, { ...body, expectedVersion: 2 }), "REGISTRY_TRANSITION_INVALID");
  assert.equal((await database.investor.findUniqueOrThrow({ where: { id: investor.id } })).registryVersion, 2);
  const duplicate = await database.investor.create({ data: { displayName: "Synthetic Duplicate Reference",
    type: "INDIVIDUAL", countryCode: "KZ", externalReference: `${label} duplicate` } });
  denied(await post(profilePath, { ...body, externalReference: duplicate.externalReference, expectedVersion: 2 }), "REGISTRY_CONFLICT");
  assert.equal((await database.investor.findUniqueOrThrow({ where: { id: investor.id } })).registryVersion, 2);
  const raced = await Promise.all([1, 2].map(index => post(profilePath, { ...body, displayName: `${label} race ${index}`, expectedVersion: 2 })));
  assert.deepEqual(raced.map(row => row.status).sort(), [201, 409]);
  saved = raced.find(row => row.status === 201).payload;
  assert.equal(saved.registryVersion, 3);
  saved = ok(await post(profilePath, { ...body, expectedVersion: 3 }));
  assert.equal(saved.registryVersion, 4);
  denied(await post(profilePath, { ...body, displayName: `${label} stale`, expectedVersion: 2 }), "REGISTRY_CONFLICT");
  const suspended = await database.investor.create({ data: { displayName: "Synthetic Suspended Profile", type: "INDIVIDUAL",
    countryCode: "KZ", status: "SUSPENDED" } });
  assert.equal(ok(await post(`/investors/${suspended.id}/profile`, { ...body, expectedVersion: 1 })).status, "SUSPENDED");
  const closed = await database.investor.create({ data: { displayName: "Synthetic Closed Profile", type: "INDIVIDUAL",
    countryCode: "KZ", status: "CLOSED" } });
  denied(await post(`/investors/${closed.id}/profile`, body), "INVESTOR_INACTIVE");
  console.log("PASS reasoned profile edits preserve identity/security facts; stale, duplicate, no-op and racing writes fail safely");

  await database.$executeRawUnsafe(`CREATE FUNCTION registry_profile_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event = 'INVESTOR_PROFILE_UPDATED' THEN RAISE EXCEPTION 'synthetic profile audit failure'; END IF; RETURN NEW; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER registry_profile_test_audit_failure BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION registry_profile_test_audit_failure()`);
  try {
    const before = await database.investor.findUniqueOrThrow({ where: { id: investor.id } });
    const auditCount = await database.auditLog.count();
    assert.equal((await post(profilePath, { ...body, displayName: `${label} rollback`, expectedVersion: 4 })).status, 500);
    assert.deepEqual(await database.investor.findUniqueOrThrow({ where: { id: investor.id } }), before);
    assert.equal(await database.auditLog.count(), auditCount);
  } finally {
    await database.$executeRawUnsafe("DROP TRIGGER registry_profile_test_audit_failure ON audit_logs");
    await database.$executeRawUnsafe("DROP FUNCTION registry_profile_test_audit_failure()");
  }

  const historicInvestor = await database.investor.findUniqueOrThrow({ where: { id: governance.investorId } });
  const snapshotsBefore = await database.snapshotInvestor.findMany({ where: { investorId: historicInvestor.id },
    include: { snapshot: true, wallets: { include: { tokenAccounts: true } } } });
  const entitlementsBefore = await database.entitlement.findMany({ where: { investorId: historicInvestor.id }, orderBy: { id: "asc" } });
  const currentReceiverWallets = await database.wallet.findMany({ where: { investorId: historicInvestor.id }, orderBy: { id: "asc" } });
  const historicUpdated = ok(await post(`/investors/${historicInvestor.id}/profile`, { displayName: `${historicInvestor.displayName} corrected`,
    type: historicInvestor.type, countryCode: historicInvestor.countryCode, externalReference: historicInvestor.externalReference,
    expectedVersion: historicInvestor.registryVersion, reasonCode: "REGISTRY_CORRECTION" }));
  assert.equal(historicUpdated.registryVersion, historicInvestor.registryVersion + 1);
  assert.deepEqual(await database.snapshotInvestor.findMany({ where: { investorId: historicInvestor.id },
    include: { snapshot: true, wallets: { include: { tokenAccounts: true } } } }), snapshotsBefore);
  assert.deepEqual(await database.entitlement.findMany({ where: { investorId: historicInvestor.id }, orderBy: { id: "asc" } }), entitlementsBefore);
  assert.deepEqual(await database.wallet.findMany({ where: { investorId: historicInvestor.id }, orderBy: { id: "asc" } }), currentReceiverWallets);
  console.log("PASS profile audit failure rolls back state/version; finalized snapshot, approved obligations and wallet evidence remain immutable");
  return { investorId: investor.id, body: { ...body, displayName: `${label} capture blocked`, expectedVersion: 4 } };
}
