import { Injectable, HttpException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

/** Database triggers also enforce this boundary against in-flight and non-HTTP writes. */
@Injectable()
export class ProgramUpgradeMaintenanceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ method: string; path: string }>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method) ||
        /^\/api\/v1\/(auth\/(challenge|verify|logout)|program-upgrade\/(prepare|submit|confirm))\/?$/.test(request.path)) return true;
    if (await this.prisma.programUpgrade.findFirst({ where: { status: "ACTIVE" }, select: { id: true } })) {
      throw new HttpException({ code: "PROGRAM_UPGRADE_MAINTENANCE", message: "Business writes are locked until program upgrade acceptance" }, 409);
    }
    return true;
  }
}
