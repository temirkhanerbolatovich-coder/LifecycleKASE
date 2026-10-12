import { Controller, Get, Header, HttpException, Query, Req } from "@nestjs/common";
import { AuthFlowError, readOperatorSession, requireAuthenticationEnabled, sessionTokenFromCookieHeader } from "./auth.js";
import { getOperatorOverview } from "./operator-overview.js";
import { PrismaService } from "./prisma.service.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";

@Controller("operator-overview")
export class OperatorOverviewController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  async get(@Req() request: { headers?: { cookie?: string } }, @Query("from") from?: string, @Query("to") to?: string) {
    try {
      requireAuthenticationEnabled();
      const session = await readOperatorSession(this.prisma, sessionTokenFromCookieHeader(request.headers?.cookie), new Date());
      if (!["ADMINISTRATOR", "AUDITOR"].includes(session.user.role)) throw new AuthFlowError("ROLE_FORBIDDEN", "Overview requires an Administrator or Auditor", 403);
      return await getOperatorOverview(this.prisma, { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) });
    } catch (error) {
      if (error instanceof AuthFlowError || error instanceof TransactionWorkflowError) throw new HttpException({ code: error.code, message: error.message }, error.status);
      throw error;
    }
  }
}
