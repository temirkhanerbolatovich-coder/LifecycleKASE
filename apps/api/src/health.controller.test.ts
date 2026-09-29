import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import type { PrismaService } from "./prisma.service.js";

test("liveness does not query the database", () => {
  const controller = new HealthController({} as PrismaService);
  assert.deepEqual(controller.live(), { status: "live" });
});

test("readiness succeeds when PostgreSQL responds", async () => {
  const prisma = { $queryRaw: async () => [{ "?column?": 1 }] } as unknown as PrismaService;
  const controller = new HealthController(prisma);
  assert.deepEqual(await controller.ready(), { status: "ready" });
});

test("readiness returns a stable 503 without exposing database errors", async () => {
  const prisma = {
    $queryRaw: async () => { throw new Error("private database details"); },
  } as unknown as PrismaService;
  const controller = new HealthController(prisma);

  await assert.rejects(controller.ready(), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal(error.getStatus(), 503);
    assert.deepEqual(error.getResponse(), {
      status: "unavailable",
      code: "DATABASE_UNAVAILABLE",
    });
    return true;
  });
});
