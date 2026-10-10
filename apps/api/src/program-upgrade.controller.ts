import { Body, Controller, Get, Header, Headers, HttpException, Param, Post, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { HttpSolanaRpc, SolanaRpcError } from "@lifecycle-kase/solana-client";
import { AuthFlowError, authOptionsFromEnvironment, readOperatorSession, requireAuthenticationEnabled,
  requireRequestOrigin, sessionTokenFromCookieHeader } from "./auth.js";
import { AuthRateLimitError, AuthRateLimitService, authenticationClientKey } from "./auth-rate-limit.js";
import { PrismaService } from "./prisma.service.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";
import { confirmProgramUpgrade, getProgramUpgrade, loadProgramUpgradeOptions, prepareProgramUpgrade,
  programUpgradeEnabled, submitProgramUpgrade } from "./program-upgrade.js";

type Request = { headers?: { cookie?: string }; ip?: string; socket?: { remoteAddress?: string } };
type Response = { setHeader(name: string, value: string): void };
@Controller("program-upgrade")
export class ProgramUpgradeController {
  constructor(private readonly prisma: PrismaService, private readonly rateLimit: AuthRateLimitService) {}
  private async actor(request: Request, response: Response, mutation: boolean, origin?: string) {
    requireAuthenticationEnabled();
    if (mutation) { requireRequestOrigin(origin, authOptionsFromEnvironment()); this.rateLimit.consumeMutation(authenticationClientKey(request)); }
    const session = await readOperatorSession(this.prisma, sessionTokenFromCookieHeader(request.headers?.cookie), new Date());
    if (!(mutation ? ["ADMINISTRATOR"] : ["ADMINISTRATOR", "AUDITOR"]).includes(session.user.role)) {
      throw new AuthFlowError("ROLE_FORBIDDEN", "Program maintenance is unavailable for this role", 403);
    }
    const correlationId = randomUUID(); response.setHeader("X-Correlation-ID", correlationId);
    return { id: session.user.id, walletAddress: session.walletAddress, correlationId };
  }
  private httpError(error: unknown, response: Response): never {
    if (error instanceof AuthRateLimitError) response.setHeader("Retry-After", String(error.retryAfterSeconds));
    if (error instanceof AuthFlowError || error instanceof TransactionWorkflowError) throw new HttpException({ code: error.code, message: error.message }, error.status);
    if (error instanceof SolanaRpcError) throw new HttpException({ code: error.code, message: "Upgrade RPC check failed" }, 503);
    // Artifact filesystem paths and raw dependency errors do not belong in HTTP responses.
    throw new HttpException({ code: "UPGRADE_UNAVAILABLE", message: "Program maintenance could not be completed" }, 503);
  }
  @Get()
  @Header("Cache-Control", "no-store")
  async status(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      await this.actor(request, response, false);
      if (!programUpgradeEnabled()) return { enabled: false };
      const options = await loadProgramUpgradeOptions();
      return await getProgramUpgrade(this.prisma, new HttpSolanaRpc(options.plan.rpcUrl), options);
    } catch (error) { this.httpError(error, response); }
  }
  @Post(":operation")
  @Header("Cache-Control", "no-store")
  async operation(@Param("operation") operation: string, @Body() body: unknown, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try {
      const actor = await this.actor(request, response, true, origin);
      if (!["prepare", "submit", "confirm"].includes(operation)) throw new TransactionWorkflowError("INVALID_REQUEST", "Upgrade operation is unsupported", 400);
      const options = await loadProgramUpgradeOptions(); const rpc = new HttpSolanaRpc(options.plan.rpcUrl);
      const execute = operation === "prepare" ? prepareProgramUpgrade : operation === "submit" ? submitProgramUpgrade : confirmProgramUpgrade;
      return await execute(this.prisma, rpc, body, actor, options);
    } catch (error) { this.httpError(error, response); }
  }
}
