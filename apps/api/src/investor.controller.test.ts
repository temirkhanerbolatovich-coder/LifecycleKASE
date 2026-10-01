import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { InvestorController } from "./investor.controller.js";
import { AuthRateLimitError, type AuthRateLimitService } from "./auth-rate-limit.js";
import type { PrismaService } from "./prisma.service.js";

const request = { headers: { cookie: `lifecyclekase_session=${"x".repeat(43)}` } };
const response = { setHeader() {} };
const investorId = "00000000-0000-4000-8000-000000000002";
const status = (expected: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === expected;
test("registry requires a session, keeps auditors read-only and checks mutation origins/rate limits", async () => {
  const previous = { AUTH_ENABLED: process.env.AUTH_ENABLED, AUTH_ALLOWED_ORIGINS: process.env.AUTH_ALLOWED_ORIGINS };
  process.env.AUTH_ENABLED = "true";
  process.env.AUTH_ALLOWED_ORIGINS = "http://localhost:3000";
  let role = "AUDITOR";
  let reads = 0;
  const database = {
    session: { findUnique: async () => ({ walletAddress: "11111111111111111111111111111111", revokedAt: null,
      expiresAt: new Date("2099-01-01"), user: { id: "00000000-0000-4000-8000-000000000001", role } }) },
    investor: { findMany: async () => { reads++; return []; } }
  } as unknown as PrismaService;
  const controller = new InvestorController(database, { consumeMutation() {} } as unknown as AuthRateLimitService);
  try {
    await assert.rejects(controller.list({}, response), status(401));
    assert.deepEqual(await controller.list(request, response), { items: [], nextCursor: null });
    assert.equal(reads, 1);
    await assert.rejects(controller.create({}, request, response, "http://localhost:3000"), status(403));
    await assert.rejects(controller.attach("invalid", {}, request, response, "http://localhost:3000"), status(403));
    await assert.rejects(controller.eligibility(investorId, {
      decision: "ELIGIBLE", reasonCode: "DEMO_CRITERIA_MET"
    }, request, response, "http://localhost:3000"), status(403));
    role = "ISSUER_OPERATOR";
    await assert.rejects(controller.list(request, response), status(403));
    assert.equal(reads, 1);
    role = "ADMINISTRATOR";
    await assert.rejects(controller.create({}, request, response, "https://untrusted.example"), status(403));
    await assert.rejects(controller.create({}, request, response), status(403));
    await assert.rejects(controller.create({ eligibilityStatus: "ELIGIBLE" }, request, response, "http://localhost:3000"), status(400));
    await assert.rejects(controller.eligibility(investorId, {
      decision: "ELIGIBLE", reasonCode: "DEMO_CRITERIA_NOT_MET"
    }, request, response, "http://localhost:3000"), status(400));
    const headers = new Map<string, string>();
    const limited = new InvestorController(database, { consumeMutation() { throw new AuthRateLimitError(9); } } as unknown as AuthRateLimitService);
    await assert.rejects(limited.create({}, request, { setHeader(name, value) { headers.set(name, value); } }, "http://localhost:3000"), status(429));
    assert.equal(headers.get("Retry-After"), "9");
    process.env.AUTH_ENABLED = "false";
    await assert.rejects(controller.list(request, response), status(503));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
