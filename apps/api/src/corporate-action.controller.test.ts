import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { CorporateActionController } from "./corporate-action.controller.js";
import { AuthRateLimitError } from "./auth-rate-limit.js";

const request = { headers: { cookie: `lifecyclekase_session=${"x".repeat(43)}` } };
const id = "00000000-0000-4000-8000-000000000001";
const httpStatus = (status: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === status;

test("actions require authentication, keep auditors read-only and enforce Origin/rate limits for every mutation", async () => {
  const previous = { AUTH_ENABLED: process.env.AUTH_ENABLED, AUTH_ALLOWED_ORIGINS: process.env.AUTH_ALLOWED_ORIGINS };
  process.env.AUTH_ENABLED = "true"; process.env.AUTH_ALLOWED_ORIGINS = "http://localhost:3000";
  let role = "AUDITOR"; let limited = false;
  const database = { session: { findUnique: async () => ({ walletAddress: "11111111111111111111111111111111", revokedAt: null,
    expiresAt: new Date("2099-01-01"), user: { id, role } }) }, corporateAction: { findMany: async () => [] } };
  const headers = new Map<string, string>(); const response = { setHeader: (key: string, value: string) => headers.set(key, value) };
  const controller = new CorporateActionController(database as never, { consumeMutation() { if (limited) throw new AuthRateLimitError(9); } } as never);
  const writes = () => [
    controller.create({}, request, response, "http://localhost:3000"),
    controller.prepare(id, {}, request, response, "http://localhost:3000"),
    controller.submit(id, {}, request, response, "http://localhost:3000"),
    controller.confirm(id, {}, request, response, "http://localhost:3000"),
    controller.cancelDraft(id, {}, request, response, "http://localhost:3000"),
    controller.calculate(id, {}, request, response, "http://localhost:3000"),
    controller.review(id, {}, request, response, "http://localhost:3000"),
    ...["prepare", "submit", "confirm"].map(operation => controller.onchainCalculation(id, operation, {}, request, response, "http://localhost:3000")),
    ...["prepare", "submit", "confirm"].map(operation => controller.couponFunding(id, operation, {}, request, response, "http://localhost:3000"))
  ];
  try {
    await assert.rejects(controller.list({}, response), httpStatus(401));
    assert.deepEqual(await controller.list(request, response), { items: [], nextCursor: null });
    for (const write of writes()) await assert.rejects(write, httpStatus(403));
    role = "ISSUER_OPERATOR"; await assert.rejects(controller.list(request, response), httpStatus(403));
    role = "ADMINISTRATOR";
    await assert.rejects(controller.create({}, request, response, "https://untrusted.example"), httpStatus(403));
    await assert.rejects(controller.create({}, request, response), httpStatus(403));
    limited = true;
    for (const write of writes()) await assert.rejects(write, httpStatus(429));
    assert.equal(headers.get("Retry-After"), "9");
    process.env.AUTH_ENABLED = "false"; await assert.rejects(controller.list(request, response), httpStatus(503));
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
