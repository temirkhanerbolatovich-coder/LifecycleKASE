import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { ProgramUpgradeController } from "./program-upgrade.controller.js";
import { AuthRateLimitError } from "./auth-rate-limit.js";
const request = { headers: { cookie: `lifecyclekase_session=${"x".repeat(43)}` } };
const status = (expected: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === expected;
test("upgrade routes require a session, Administrator mutations, exact Origin and rate limits; disabled reads expose no artifacts", async () => {
  const previous = { AUTH_ENABLED: process.env.AUTH_ENABLED, AUTH_ALLOWED_ORIGINS: process.env.AUTH_ALLOWED_ORIGINS,
    LOCALNET_PROGRAM_UPGRADE_ENABLED: process.env.LOCALNET_PROGRAM_UPGRADE_ENABLED };
  process.env.AUTH_ENABLED = "true"; process.env.AUTH_ALLOWED_ORIGINS = "http://localhost:3000"; process.env.LOCALNET_PROGRAM_UPGRADE_ENABLED = "false";
  let role = "AUDITOR"; let limited = false;
  const database = { session: { findUnique: async () => ({ walletAddress: "11111111111111111111111111111111", revokedAt: null,
    expiresAt: new Date("2099-01-01"), user: { id: "00000000-0000-4000-8000-000000000001", role } }) } };
  const headers = new Map<string, string>(); const response = { setHeader: (key: string, value: string) => headers.set(key, value) };
  const controller = new ProgramUpgradeController(database as never, { consumeMutation() { if (limited) throw new AuthRateLimitError(7); } } as never);
  try {
    await assert.rejects(controller.status({}, response), status(401));
    assert.deepEqual(await controller.status(request, response), { enabled: false });
    for (const operation of ["prepare", "submit", "confirm"]) {
      await assert.rejects(controller.operation(operation, {}, request, response, "http://localhost:3000"), status(403));
    }
    role = "ISSUER_OPERATOR"; await assert.rejects(controller.status(request, response), status(403));
    role = "ADMINISTRATOR";
    await assert.rejects(controller.operation("prepare", {}, request, response), status(403));
    await assert.rejects(controller.operation("prepare", {}, request, response, "https://untrusted.example"), status(403));
    await assert.rejects(controller.operation("prepare", {}, request, response, "http://localhost:3000"), status(503));
    limited = true;
    await assert.rejects(controller.operation("confirm", {}, request, response, "http://localhost:3000"), status(429));
    assert.equal(headers.get("Retry-After"), "7");
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
