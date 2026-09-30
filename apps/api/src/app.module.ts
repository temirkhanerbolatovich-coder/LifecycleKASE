import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [HealthController, AuthController],
  providers: [PrismaService],
})
export class AppModule {}
