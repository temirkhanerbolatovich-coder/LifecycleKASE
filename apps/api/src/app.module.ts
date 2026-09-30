import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthRateLimitService } from "./auth-rate-limit.js";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./prisma.service.js";
import { SnapshotController } from "./snapshot.controller.js";

@Module({
  controllers: [HealthController, AuthController, SnapshotController],
  providers: [PrismaService, AuthRateLimitService],
})
export class AppModule {}
