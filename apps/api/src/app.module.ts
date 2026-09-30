import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./prisma.service.js";
import { SnapshotController } from "./snapshot.controller.js";

@Module({
  controllers: [HealthController, AuthController, SnapshotController],
  providers: [PrismaService],
})
export class AppModule {}
