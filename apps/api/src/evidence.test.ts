import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { EvidenceController } from "./evidence.controller.js";
import { listAuditEvidence, listTransactionEvidence, transactionEvidenceSelect } from "./evidence.js";

test("evidence pagination is bounded, deterministic and excludes signed/prepared payloads", async () => {
  const ids = [1, 2, 3].map(value => `00000000-0000-4000-8000-00000000000${value}`);
  let query: Record<string, unknown> = {};
  const db = { blockchainTransaction: { findMany: async (input: Record<string, unknown>) => { query = input; return ids.map(id => ({ id })); } } };
  const page = await listTransactionEvidence(db as never, { limit: "2", cursor: ids[0]!, actionId: ids[0]!, status: "FINALIZED" });
  assert.deepEqual(page, { items: [{ id: ids[0] }, { id: ids[1] }], nextCursor: ids[1] });
  assert.deepEqual(query["orderBy"], [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(query["skip"], 1); assert.equal(query["take"], 3);
  assert.deepEqual(query["select"], transactionEvidenceSelect);
  assert.equal("preparedPayload" in transactionEvidenceSelect, false);
  for (const invalid of [{ limit: "0" }, { limit: "101" }, { limit: "1e2" }, { cursor: "invalid" }, { actionId: "invalid" }, { status: "toString" }, { status: ["FINALIZED"] }]) {
    await assert.rejects(listTransactionEvidence(db as never, invalid as never), { code: "INVALID_REQUEST", status: 400 });
  }
  await assert.rejects(listAuditEvidence(db as never, { status: "FINALIZED" }), { code: "INVALID_REQUEST" });
});

test("journals require an active authenticated Administrator or Auditor and reject other roles", async () => {
  const previous = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = "true";
  let role = "AUDITOR"; let revokedAt: Date | null = null;
  const database = { session: { findUnique: async () => ({ walletAddress: "11111111111111111111111111111111", revokedAt,
    expiresAt: new Date("2099-01-01"), user: { id: "00000000-0000-4000-8000-000000000001", role } }) }, auditLog: { findMany: async () => [] } };
  const controller = new EvidenceController(database as never);
  const request = { headers: { cookie: `lifecyclekase_session=${"x".repeat(43)}` } };
  const status = (expected: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === expected;
  try {
    await assert.rejects(controller.audit({}, {}), status(401));
    for (const allowed of ["AUDITOR", "ADMINISTRATOR"]) { role = allowed; assert.deepEqual(await controller.audit(request, {}), { items: [], nextCursor: null }); }
    role = "ISSUER_OPERATOR"; await assert.rejects(controller.audit(request, {}), status(403));
    role = "ADMINISTRATOR"; revokedAt = new Date(); await assert.rejects(controller.audit(request, {}), status(401));
  } finally { if (previous === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = previous; }
});
