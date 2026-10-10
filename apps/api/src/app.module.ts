import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ProgramUpgradeController } from "./program-upgrade.controller.js";
import { ProgramUpgradeMaintenanceGuard } from "./program-upgrade.guard.js";
import { AuthController } from "./auth.controller.js";
import { AuthRateLimitService } from "./auth-rate-limit.js";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./prisma.service.js";
import { SnapshotController } from "./snapshot.controller.js";
import { InvestorController } from "./investor.controller.js";
import { InstrumentController } from "./instrument.controller.js";
import { CorporateActionController } from "./corporate-action.controller.js";
import { EvidenceController } from "./evidence.controller.js";

@Module({
  controllers: [HealthController, AuthController, SnapshotController, InvestorController, InstrumentController, CorporateActionController, ProgramUpgradeController, EvidenceController],
  providers: [PrismaService, AuthRateLimitService, { provide: APP_GUARD, useClass: ProgramUpgradeMaintenanceGuard }],
})
export class AppModule {}
