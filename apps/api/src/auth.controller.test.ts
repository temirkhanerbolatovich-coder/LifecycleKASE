import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthRateLimitError, type AuthRateLimitService } from "./auth-rate-limit.js";
import type { PrismaService } from "./prisma.service.js";

test("wallet invalidation returns the existing session-recovery HTTP contract", async () => {
  const previous = process.env.AUTH_ENABLED;
  process.env.AUTH_ENABLED = "true";
  const user = { id: "00000000-0000-4000-8000-000000000001", role: "ADMINISTRATOR" };
  let walletStatus = "ACTIVE";
  const database = {
    session: { findUnique: async () => ({ id: "session", walletAddress: "11111111111111111111111111111111",
      expiresAt: new Date("2099-01-01"), revokedAt: null, user }) },
    wallet: { findUnique: async () => ({ userId: user.id, status: walletStatus,
      verifiedAt: new Date("2026-09-29"), revokedAt: null }) }
  } as unknown as PrismaService;
  const controller = new AuthController(database, {} as AuthRateLimitService);
  const request = { headers: { cookie: `lifecyclekase_session=${"x".repeat(43)}` } };
  try {
    assert.equal((await controller.session(request)).user.id, user.id);
    walletStatus = "BLOCKED";
    await assert.rejects(controller.session(request),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 401 &&
        (error.getResponse() as { code?: string }).code === "SESSION_INVALID");
  } finally {
    if (previous === undefined) delete process.env.AUTH_ENABLED;
    else process.env.AUTH_ENABLED = previous;
  }
});

test("authentication throttling returns 429 with Retry-After", async () => {
  const previous = process.env.AUTH_ENABLED;
  process.env.AUTH_ENABLED = "true";
  const headers = new Map<string, string>();
  const response = {
    cookie() {},
    clearCookie() {},
    setHeader(name: string, value: string) { headers.set(name, value); }
  };
  const rateLimit = {
    consumeChallenge() { throw new AuthRateLimitError(42); }
  } as unknown as AuthRateLimitService;
  const controller = new AuthController({} as PrismaService, rateLimit);
  try {
    await assert.rejects(
      controller.challenge(
        { walletAddress: "invalid" },
        "https://lifecyclekase.example",
        { ip: "203.0.113.7" },
        response
      ),
      (error: unknown) => error instanceof HttpException &&
        error.getStatus() === 429 &&
        (error.getResponse() as { code?: string }).code === "AUTH_RATE_LIMITED"
    );
    assert.equal(headers.get("Retry-After"), "42");
  } finally {
    if (previous === undefined) delete process.env.AUTH_ENABLED;
    else process.env.AUTH_ENABLED = previous;
  }
});
