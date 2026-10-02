import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type { AuthRateLimitService } from "./auth-rate-limit.js";
import { InstrumentController } from "./instrument.controller.js";
import type { PrismaService } from "./prisma.service.js";

const request = { headers: { cookie: `lifecyclekase_session=${"x".repeat(43)}` } };
const response = { setHeader() {} };
const status = (expected: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === expected;

test("instrument registry requires a session and keeps auditors read-only", async () => {
  const previous = { AUTH_ENABLED: process.env.AUTH_ENABLED, AUTH_ALLOWED_ORIGINS: process.env.AUTH_ALLOWED_ORIGINS };
  process.env.AUTH_ENABLED = "true";
  process.env.AUTH_ALLOWED_ORIGINS = "http://localhost:3000";
  let role = "AUDITOR";
  const database = {
    session: { findUnique: async () => ({ walletAddress: "11111111111111111111111111111111", revokedAt: null,
      expiresAt: new Date("2099-01-01"), user: { id: "00000000-0000-4000-8000-000000000001", role } }) },
    instrument: { findMany: async () => [] }
  } as unknown as PrismaService;
  const controller = new InstrumentController(database, { consumeMutation() {} } as unknown as AuthRateLimitService);
  try {
    await assert.rejects(controller.list({}, response), status(401));
    assert.deepEqual(await controller.list(request, response), { items: [], nextCursor: null });
    await assert.rejects(controller.create({}, request, response, "http://localhost:3000"), status(403));
    role = "ISSUER_OPERATOR";
    await assert.rejects(controller.list(request, response), status(403));
    role = "ADMINISTRATOR";
    await assert.rejects(controller.create({}, request, response, "https://untrusted.example"), status(403));
    await assert.rejects(controller.create({}, request, response), status(403));
    process.env.AUTH_ENABLED = "false";
    await assert.rejects(controller.list(request, response), status(503));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
