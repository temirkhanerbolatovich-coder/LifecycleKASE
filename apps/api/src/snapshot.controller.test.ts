import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "@nestjs/common";

import { AuthRateLimitError, type AuthRateLimitService } from "./auth-rate-limit.js";
import type { PrismaService } from "./prisma.service.js";
import { SnapshotController } from "./snapshot.controller.js";

test("protected snapshot mutations return the rate-limit contract", async () => {
  const previous = {
    enabled: process.env.AUTH_ENABLED,
    domain: process.env.AUTH_DOMAIN,
    origins: process.env.AUTH_ALLOWED_ORIGINS
  };
  process.env.AUTH_ENABLED = "true";
  process.env.AUTH_DOMAIN = "lifecyclekase.example";
  process.env.AUTH_ALLOWED_ORIGINS = "https://lifecyclekase.example";
  const headers = new Map<string, string>();
  const rateLimit = {
    consumeMutation() { throw new AuthRateLimitError(17); }
  } as unknown as AuthRateLimitService;
  const controller = new SnapshotController({} as PrismaService, rateLimit);
  try {
    await assert.rejects(
      controller.prepare(
        "00000000-0000-4000-8000-000000000001",
        { ip: "203.0.113.7" },
        { setHeader(name: string, value: string) { headers.set(name, value); } },
        "https://lifecyclekase.example"
      ),
      (error: unknown) => error instanceof HttpException &&
        error.getStatus() === 429 &&
        (error.getResponse() as { code?: string }).code === "AUTH_RATE_LIMITED"
    );
    assert.equal(headers.get("Retry-After"), "17");
    assert.match(headers.get("X-Correlation-ID") ?? "", /^[0-9a-f-]{36}$/);
  } finally {
    if (previous.enabled === undefined) delete process.env.AUTH_ENABLED;
    else process.env.AUTH_ENABLED = previous.enabled;
    if (previous.domain === undefined) delete process.env.AUTH_DOMAIN;
    else process.env.AUTH_DOMAIN = previous.domain;
    if (previous.origins === undefined) delete process.env.AUTH_ALLOWED_ORIGINS;
    else process.env.AUTH_ALLOWED_ORIGINS = previous.origins;
  }
});
