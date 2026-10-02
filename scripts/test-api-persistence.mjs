import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import { encodePublicKey } from "@lifecycle-kase/solana-client";
import { persistSnapshotCandidate } from "../apps/api/dist/index.js";

// No .env loading: never silently test against a staging/production database.
const localUrl = new URL(process.env.API_TEST_DATABASE_URL ?? process.env.DATABASE_URL ??
  "postgresql://lifecycle_kase:local_development_only@[::1]:55432/lifecycle_kase?schema=public");
if (localUrl.protocol !== "postgresql:" || !["localhost", "127.0.0.1", "[::1]"].includes(localUrl.hostname) ||
    localUrl.pathname !== "/lifecycle_kase" || !/^[0-9]{2,5}$/.test(localUrl.port)) {
  throw new Error("API persistence tests require the local lifecycle_kase database on an explicit loopback port");
}
const testDatabaseName = `api_test_${randomUUID().replaceAll("-", "")}`;
if (!/^api_test_[0-9a-f]{32}$/.test(testDatabaseName)) throw new Error("Invalid test database name");
const testUrl = new URL(localUrl);
testUrl.pathname = `/${testDatabaseName}`;
const administratorDatabase = new PrismaClient({ datasources: { db: { url: localUrl.toString() } } });
const database = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
const ids = {
  user: randomUUID(),
  issuer: randomUUID(),
  investor: randomUUID(),
  wallet: randomUUID(),
  instrument: randomUUID(),
  action: randomUUID()
};
const address = () => encodePublicKey(randomBytes(32));
const walletAddress = address();
const mintAddress = address();
const tokenAccountAddress = address();
const genesisHash = address();
let assetId;
let createdDatabase = false;

try {
  await administratorDatabase.$executeRawUnsafe(`CREATE DATABASE "${testDatabaseName}"`);
  createdDatabase = true;
  const migration = spawnSync(process.execPath,
    [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "inherit" });
  if (migration.error || migration.status !== 0) throw new Error("Isolated API persistence database migration failed");
  const existingAsset = await database.settlementAsset.findUnique({ where: { code: "KZT_TEST" } });
  if (existingAsset) {
    assetId = existingAsset.id;
  } else {
    const asset = await database.settlementAsset.create({
      data: {
        code: "KZT_TEST",
        name: "KZT-Test",
        disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan."
      }
    });
    assetId = asset.id;
  }
  await database.user.create({ data: { id: ids.user, role: "ADMINISTRATOR" } });
  await database.issuer.create({ data: { id: ids.issuer, legalName: "Snapshot integration test" } });
  await database.investor.create({
    data: {
      id: ids.investor,
      displayName: "Snapshot test investor",
      type: "INDIVIDUAL",
      countryCode: "KZ",
      eligibilityStatus: "ELIGIBLE",
      eligibilityReasonCode: "LEGACY_STATUS_IMPORT",
      eligibilityReviewedAt: new Date(Date.now() - 86_400_000)
    }
  });
  await database.wallet.create({
    data: {
      id: ids.wallet,
      address: walletAddress,
      investorId: ids.investor,
      status: "ACTIVE",
      verifiedAt: new Date(Date.now() - 86_400_000)
    }
  });
  const now = new Date();
  const recordAt = new Date(now.getTime() - 120_000);
  const blockTime = new Date(now.getTime() - 60_000);
  await database.instrument.create({
    data: {
      id: ids.instrument,
      issuerId: ids.issuer,
      settlementAssetId: assetId,
      name: "Snapshot test bond",
      ticker: "T" + ids.instrument.slice(0, 12),
      issuerAuthority: address(),
      complianceAuthority: address(),
      corporateActionAuthority: address(),
      faceValueMinor: 1_000_000_000n,
      couponRateBps: 1000,
      paymentsPerYear: 2,
      issueAt: new Date(now.getTime() - 365 * 86_400_000),
      maturityAt: new Date(now.getTime() + 365 * 86_400_000),
      totalSupply: 10n,
      circulatingSupply: 10n,
      mintAddress,
      status: "ACTIVE"
    }
  });
  await database.corporateAction.create({
    data: {
      id: ids.action,
      instrumentId: ids.instrument,
      type: "COUPON_PAYMENT",
      intent: "Verify snapshot persistence against PostgreSQL",
      createdById: ids.user,
      recordAt,
      executeAt: new Date(now.getTime() + 86_400_000),
      status: "SCHEDULED"
    }
  });
  const commitment = createSnapshotV2Commitment({
    actionId: ids.action,
    instrumentId: ids.instrument,
    cluster: "devnet",
    networkGenesisHash: genesisHash,
    mintAddress,
    recordAt: recordAt.toISOString(),
    solanaSlot: 101n,
    blockTime: blockTime.toISOString(),
    createdAt: now.toISOString(),
    mintSupply: 10n,
    investors: [{
      investorId: ids.investor,
      eligibilityStatus: "ELIGIBLE",
      wallets: [{
        walletId: ids.wallet,
        walletAddress,
        walletStatus: "ACTIVE",
        tokenAccounts: [{ address: tokenAccountAddress, balance: 10n }]
      }]
    }]
  });
  const candidate = { ...commitment, captureSlot: 101, actionVersion: 0, instrumentVersion: 0 };
  const result = await persistSnapshotCandidate(database, candidate, {
    now: new Date(),
    graceSeconds: 300,
    walletNetwork: "SOLANA_DEVNET",
    audit: { actorId: ids.user, actorWallet: walletAddress, correlationId: randomUUID() }
  });
  const stored = await database.snapshot.findUnique({
    where: { id: result.snapshotId },
    include: { investors: { include: { wallets: { include: { tokenAccounts: true } } } } }
  });
  assert.equal(stored?.status, "PENDING_REGISTRATION");
  assert.equal(Buffer.from(stored?.snapshotHash ?? []).toString("hex"), candidate.sha256);
  assert.equal(stored?.investors[0]?.wallets[0]?.tokenAccounts[0]?.balance, 10n);
  const actionAfter = await database.corporateAction.findUniqueOrThrow({ where: { id: ids.action } });
  assert.equal(actionAfter.status, "SCHEDULED");
  assert.equal(actionAfter.version, 1);
  await assert.rejects(persistSnapshotCandidate(database, candidate, {
    now: new Date(),
    graceSeconds: 300,
    walletNetwork: "SOLANA_DEVNET",
    audit: { actorId: ids.user, actorWallet: walletAddress, correlationId: randomUUID() }
  }));
  console.log("PASS Prisma snapshot persistence, nested rows, compare-and-set and duplicate rejection");
} finally {
  try {
    await database.$disconnect();
  } finally {
    try {
      if (createdDatabase) await administratorDatabase.$executeRawUnsafe(`DROP DATABASE "${testDatabaseName}"`);
    } finally {
      await administratorDatabase.$disconnect();
    }
  }
}
