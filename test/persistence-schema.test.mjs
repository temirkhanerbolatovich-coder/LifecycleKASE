import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const schemaPath = path.join(process.cwd(), "prisma/schema.prisma");

test("persistence schema contains every required table boundary", async () => {
  const schema = await readFile(schemaPath, "utf8");
  const requiredModels = [
    "User",
    "AuthChallenge",
    "Session",
    "Issuer",
    "Investor",
    "Wallet",
    "Instrument",
    "CorporateAction",
    "Snapshot",
    "SnapshotTokenAccount",
    "SnapshotHolder",
    "Entitlement",
    "Settlement",
    "BlockchainTransaction",
    "ExecutionJob",
    "IdempotencyRecord",
    "AuditLog"
  ];

  for (const model of requiredModels) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
});

test("schema enforces core uniqueness and optimistic-version fields", async () => {
  const schema = await readFile(schemaPath, "utf8");

  assert.match(schema, /@@unique\(\[snapshotId, walletAddress\]\)/);
  assert.match(schema, /@@unique\(\[corporateActionId, holderWallet\]\)/);
  assert.match(schema, /@@unique\(\[scope, idempotencyKey\]\)/);
  assert.match(schema, /corporateActionId\s+String\s+@unique/);
  assert.match(schema, /signature\s+String\?\s+@unique/);

  const versionFields = schema.match(/version\s+Int\s+@default\(0\)/g) ?? [];
  assert.equal(versionFields.length, 3);
});

test("schema stores hashes instead of raw authentication secrets", async () => {
  const schema = await readFile(schemaPath, "utf8");

  assert.match(schema, /nonceHash\s+Bytes\s+@unique/);
  assert.match(schema, /tokenHash\s+Bytes\s+@unique/);
  assert.doesNotMatch(schema, /privateKey|mnemonic|rawNonce|sessionToken/i);
});
