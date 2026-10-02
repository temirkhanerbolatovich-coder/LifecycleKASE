import { Body, Controller, Get, Header, Headers, HttpException, Param, Post, Query, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { HttpSolanaRpc, SolanaRpcError } from "@lifecycle-kase/solana-client";
import { AuthFlowError, authOptionsFromEnvironment, readOperatorSession, requireAuthenticationEnabled,
  requireRequestOrigin, sessionTokenFromCookieHeader } from "./auth.js";
import { AuthRateLimitError, AuthRateLimitService, authenticationClientKey } from "./auth-rate-limit.js";
import { createInstrumentDraft, InstrumentRegistryError, listInstruments } from "./instrument-registry.js";
import { confirmInstrumentDistribution, confirmInstrumentMintSetup, InstrumentDeploymentError, instrumentDeploymentOptions,
  prepareInstrumentDistribution, prepareInstrumentMintSetup } from "./instrument-deployment.js";
import { PrismaService } from "./prisma.service.js";

type Request = { headers?: { cookie?: string }; ip?: string; socket?: { remoteAddress?: string } };
type Response = { setHeader(name: string, value: string): void };

@Controller("instruments")
export class InstrumentController {
  constructor(private readonly prisma: PrismaService, private readonly rateLimit: AuthRateLimitService) {}

  private async actor(request: Request, response: Response, mutation: boolean, origin?: string) {
    requireAuthenticationEnabled();
    if (mutation) {
      requireRequestOrigin(origin, authOptionsFromEnvironment());
      this.rateLimit.consumeMutation(authenticationClientKey(request));
    }
    const session = await readOperatorSession(this.prisma, sessionTokenFromCookieHeader(request.headers?.cookie), new Date());
    const allowed = mutation ? ["ADMINISTRATOR"] : ["ADMINISTRATOR", "AUDITOR"];
    if (!allowed.includes(session.user.role)) throw new AuthFlowError("ROLE_FORBIDDEN", "Instrument access is not allowed for this role", 403);
    const correlationId = randomUUID();
    response.setHeader("X-Correlation-ID", correlationId);
    return { id: session.user.id, walletAddress: session.walletAddress, correlationId };
  }

  private httpError(error: unknown, response: Response): never {
    if (error instanceof AuthFlowError || error instanceof InstrumentRegistryError || error instanceof InstrumentDeploymentError) {
      if (error instanceof AuthRateLimitError) response.setHeader("Retry-After", String(error.retryAfterSeconds));
      throw new HttpException({ code: error.code, message: error.message }, error.status);
    }
    if (error instanceof SolanaRpcError) throw new HttpException({ code: error.code, message: "Solana RPC operation failed" }, 503);
    throw error;
  }

  @Get()
  @Header("Cache-Control", "no-store")
  async list(@Req() request: Request, @Res({ passthrough: true }) response: Response,
    @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    try {
      await this.actor(request, response, false);
      return await listInstruments(this.prisma, limit, cursor);
    } catch (error) { this.httpError(error, response); }
  }

  @Post()
  @Header("Cache-Control", "no-store")
  async create(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response,
    @Headers("origin") origin?: string) {
    try {
      const actor = await this.actor(request, response, true, origin);
      return await createInstrumentDraft(this.prisma, body, actor);
    } catch (error) { this.httpError(error, response); }
  }

  @Post(":id/deploy/prepare")
  @Header("Cache-Control", "no-store")
  async prepareDeployment(@Param("id") instrumentId: string, @Body() body: unknown, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try {
      const actor = await this.actor(request, response, true, origin);
      const payload = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const phase = payload["phase"];
      const options = instrumentDeploymentOptions();
      const rpc = new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs);
      if (phase === "MINT_SETUP" && Object.keys(payload).length === 1) {
        return await prepareInstrumentMintSetup(this.prisma, rpc, instrumentId, actor, options);
      }
      if (phase === "DISTRIBUTION" && Object.keys(payload).every(key => ["phase", "allocations"].includes(key))) {
        return await prepareInstrumentDistribution(this.prisma, rpc, instrumentId, actor, options,
          { allocations: payload["allocations"] });
      }
      throw new InstrumentDeploymentError("INVALID_REQUEST", "A supported deployment phase is required", 400);
    } catch (error) { this.httpError(error, response); }
  }

  @Post(":id/deploy/confirm")
  @Header("Cache-Control", "no-store")
  async confirmDeployment(@Param("id") instrumentId: string, @Body() body: unknown, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try {
      const actor = await this.actor(request, response, true, origin);
      const payload = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const operationId = payload["operationId"];
      const signature = payload["signature"];
      const phase = payload["phase"];
      if (typeof operationId !== "string" || typeof signature !== "string" ||
          (phase !== "MINT_SETUP" && phase !== "DISTRIBUTION") ||
          Object.keys(payload).some(key => !["phase", "operationId", "signature"].includes(key))) {
        throw new InstrumentDeploymentError("INVALID_REQUEST", "Phase, operation, and signature are required", 400);
      }
      const options = instrumentDeploymentOptions();
      const rpc = new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs);
      return phase === "MINT_SETUP"
        ? await confirmInstrumentMintSetup(this.prisma, rpc, instrumentId, operationId, signature, actor, options)
        : await confirmInstrumentDistribution(this.prisma, rpc, instrumentId, operationId, signature, actor, options);
    } catch (error) { this.httpError(error, response); }
  }
}
