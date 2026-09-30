import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthRateLimitError, type AuthRateLimitService } from "./auth-rate-limit.js";
import type { PrismaService } from "./prisma.service.js";

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
