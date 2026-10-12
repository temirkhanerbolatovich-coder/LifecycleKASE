import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { getOperatorOverview } from "../apps/api/dist/operator-overview.js";
import { listInvestors } from "../apps/api/dist/investor-registry.js";
import { validatedOverviewSummary } from "../apps/web/.test-dist/overview-summary.js";

// Only this newly created database is seeded or dropped. No RPC, retained database or wallet is used.
const base = new URL(process.env.OVERVIEW_TEST_DATABASE_URL ?? "");
if (base.protocol !== "postgresql:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    !base.port || !["/postgres", "/lifecycle_kase"].includes(base.pathname)) throw new Error("Explicit loopback test PostgreSQL base is required");
const name = "lifecycle_kase_acceptance_ov_" + randomUUID().replaceAll("-", "");
assert.match(name, /^lifecycle_kase_acceptance_ov_[a-f0-9]{32}$/);
const target = new URL(base); target.pathname = "/" + name;
const host = new PrismaClient({ datasources: { db: { url: base.toString() } } });
const database = new PrismaClient({ datasources: { db: { url: target.toString() } } });
const publicAddress = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const now = new Date("2026-10-12T12:00:00.000Z");
const evidence = { schema: "operator-overview-database-acceptance-v1", scope: "DISPOSABLE_POSTGRESQL_SYNTHETIC_RECORDS",
  chainExecution: false, investors: 10000, actions: 10000, assertions: [], timingsMs: {} };
const timed = async (label, callback) => {
  const start = performance.now(); const result = await callback();
  evidence.timingsMs[label] = Math.round((performance.now() - start) * 100) / 100; return result;
};
let created = false;
try {
  await host.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
  const migration = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: target.toString() }, stdio: "inherit" });
  if (migration.error || migration.status !== 0) throw new Error("Disposable overview migration failed");
  const user = await database.user.create({ data: { displayName: "Synthetic overview operator", role: "ADMINISTRATOR" } });
  const issuer = await database.issuer.create({ data: { legalName: "Synthetic overview fixture" } });
  const asset = await database.settlementAsset.create({ data: { code: "KZT_TEST", name: "Synthetic asset", network: "SOLANA_LOCALNET",
    disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan." } });
  const instrumentFor = async network => {
    return database.instrument.create({ data: { issuerId: issuer.id, settlementAssetId: asset.id, name: "Synthetic overview fixture",
      ticker: network === "SOLANA_LOCALNET" ? "OVTEST" : "FOREIGN", network, programId: publicAddress, issuerAuthority: publicAddress,
      complianceAuthority: publicAddress, corporateActionAuthority: publicAddress, faceValueMinor: 1000n, couponRateBps: 1000, paymentsPerYear: 2,
      issueAt: new Date("2026-01-01T00:00:00.000Z"), maturityAt: new Date("2027-01-01T00:00:00.000Z"), totalSupply: 35n,
      circulatingSupply: 35n } });
  };
  const local = await instrumentFor("SOLANA_LOCALNET"), foreign = await instrumentFor("SOLANA_DEVNET");
  const actionRows = Array.from({ length: 10000 }, (_, index) => ({ id: randomUUID(), instrumentId: local.id, createdById: user.id,
    type: "COUPON_PAYMENT", intent: "Synthetic database benchmark", recordAt: new Date(now.getTime() + index * 1000),
    executeAt: new Date(now.getTime() + index * 1000 + 1000) }));
  for (let offset = 0; offset < actionRows.length; offset += 500) await database.corporateAction.createMany({ data: actionRows.slice(offset, offset + 500) });
  const foreignAction = await database.corporateAction.create({ data: { ...actionRows[0], id: randomUUID(), instrumentId: foreign.id } });
  const priority = actionRows.at(-1);
  await database.blockchainTransaction.createMany({ data: Array.from({ length: 23 }, (_, index) => ({ instrumentId: local.id,
    corporateActionId: priority.id, operationType: "OVERVIEW_SYNTHETIC_FIXTURE", status: index === 0 ? "UNKNOWN_CONFIRMATION" : "PREPARED",
    signature: index === 0 ? "a".repeat(88) : null, createdAt: new Date(now.getTime() + index * 1000) })) });
  await database.blockchainTransaction.create({ data: { instrumentId: foreign.id, corporateActionId: foreignAction.id,
    operationType: "OVERVIEW_SYNTHETIC_FIXTURE", status: "UNKNOWN_CONFIRMATION", signature: "b".repeat(88) } });
  const summary = await timed("overview10000Actions", () => getOperatorOverview(database, {}, now, "SOLANA_LOCALNET"));
  const validated = validatedOverviewSummary(JSON.parse(JSON.stringify(summary)));
  assert.equal(validated.openActions, 10000); assert.equal(validated.queue.total, 10000); assert.equal(validated.queue.items.length, 7);
  assert.equal(validated.activeInstruments, 0); assert.equal(validated.unknownOperations, 1);
  assert.equal(validated.queue.items[0].id, priority.id); assert.equal(validated.queue.items[0].hasUnknownConfirmation, true);
  assert.equal(validated.queue.items[0].blockchainTransactions.length, 20);
  assert.equal(validated.queue.items[0].blockchainTransactions.some(row => row.status === "UNKNOWN_CONFIRMATION"), false);
  assert.equal(validated.assets.length, 1); assert.equal(validated.assets[0].actionCount, 10000);
  assert.equal(validated.assets[0].uncalculatedActions, 10000); assert.equal(validated.assets[0].payableMinor, null);
  assert.equal(validated.assets[0].paidMinor, null); assert.equal(validated.financing.availableMinor, null);
  evidence.assertions.push("complete 10000-action counts independently of seven visible rows", "foreign network excluded",
    "old unknown operation remains highest priority outside latest twenty transactions", "uncalculated and unqueried amounts remain null");
  for (let offset = 0; offset < 10000; offset += 500) await database.investor.createMany({ data: Array.from({ length: 500 }, (_, index) => ({
    externalReference: `BENCH_${String(offset + index).padStart(5, "0")}`, displayName: `Synthetic investor ${String(offset + index).padStart(5, "0")}`,
    type: "INDIVIDUAL", countryCode: "KZ" })) });
  const first = await timed("registryFirst100", () => listInvestors(database, "100", undefined));
  const second = await timed("registryNext100", () => listInvestors(database, "100", first.nextCursor));
  const searched = await timed("registryServerSearch", () => listInvestors(database, "100", undefined, "BENCH_09999"));
  assert.equal(first.items.length, 100); assert.equal(second.items.length, 100); assert.ok(first.nextCursor); assert.ok(second.nextCursor);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 200);
  assert.equal(searched.items.length, 1); assert.equal(searched.items[0].externalReference, "BENCH_09999");
  evidence.assertions.push("10000-investor bounded cursor pages have no duplicates", "server search finds a record outside loaded pages");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await database.$disconnect();
  if (created) await host.$executeRawUnsafe(`DROP DATABASE "${name}"`);
  await host.$disconnect();
}
