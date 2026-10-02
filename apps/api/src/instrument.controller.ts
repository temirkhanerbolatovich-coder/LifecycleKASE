import { Body, Controller, Get, Header, Headers, HttpException, Post, Query, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthFlowError, authOptionsFromEnvironment, readOperatorSession, requireAuthenticationEnabled,
  requireRequestOrigin, sessionTokenFromCookieHeader } from "./auth.js";
import { AuthRateLimitError, AuthRateLimitService, authenticationClientKey } from "./auth-rate-limit.js";
import { createInstrumentDraft, InstrumentRegistryError, listInstruments } from "./instrument-registry.js";
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
    if (error instanceof AuthFlowError || error instanceof InstrumentRegistryError) {
      if (error instanceof AuthRateLimitError) response.setHeader("Retry-After", String(error.retryAfterSeconds));
      throw new HttpException({ code: error.code, message: error.message }, error.status);
    }
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
}
