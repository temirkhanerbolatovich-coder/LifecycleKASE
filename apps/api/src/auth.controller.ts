import { Body, Controller, Get, Headers, HttpException, Post, Req, Res } from "@nestjs/common";

import {
  AUTH_COOKIE_NAME,
  AuthFlowError,
  authOptionsFromEnvironment,
  createOperatorChallenge,
  readOperatorSession,
  requireAuthenticationEnabled,
  sessionTokenFromCookieHeader,
  revokeOperatorSession,
  verifyOperatorChallenge
} from "./auth.js";
import { AuthRateLimitError, AuthRateLimitService, authenticationClientKey } from "./auth-rate-limit.js";
import { PrismaService } from "./prisma.service.js";

type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
  setHeader(name: string, value: string): void;
};
type CookieRequest = {
  headers?: { cookie?: string };
  ip?: string;
  socket?: { remoteAddress?: string };
};

function throwHttp(error: unknown, response?: CookieResponse): never {
  if (error instanceof AuthFlowError) {
    if (error instanceof AuthRateLimitError && response) {
      response.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  throw error;
}

function cookieOptions(maxAge?: number): Record<string, unknown> {
  return {
    httpOnly: true,
    secure: process.env.AUTH_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1",
    ...(maxAge === undefined ? {} : { maxAge })
  };
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: AuthRateLimitService
  ) {}

  @Post("challenge")
  async challenge(
    @Body() body: { walletAddress?: unknown },
    @Headers("origin") origin: string | undefined,
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: CookieResponse
  ) {
    try {
      requireAuthenticationEnabled();
      this.rateLimit.consumeChallenge(authenticationClientKey(request));
      return await createOperatorChallenge(
        this.prisma,
        { walletAddress: body?.walletAddress, origin, now: new Date() },
        authOptionsFromEnvironment()
      );
    } catch (error) {
      throwHttp(error, response);
    }
  }

  @Post("verify")
  async verify(
    @Body() body: { challengeId?: unknown; nonce?: unknown; signature?: unknown },
    @Headers("origin") origin: string | undefined,
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: CookieResponse
  ) {
    try {
      requireAuthenticationEnabled();
      this.rateLimit.consumeVerification(authenticationClientKey(request));
      const options = authOptionsFromEnvironment();
      const result = await verifyOperatorChallenge(this.prisma, {
        challengeId: body?.challengeId,
        nonce: body?.nonce,
        signature: body?.signature,
        origin,
        now: new Date()
      }, options);
      response.cookie(AUTH_COOKIE_NAME, result.sessionToken, cookieOptions(options.sessionTtlSeconds * 1000));
      return { sessionId: result.sessionId, expiresAt: result.expiresAt, user: result.user };
    } catch (error) {
      throwHttp(error, response);
    }
  }

  @Get("session")
  async session(@Req() request: CookieRequest) {
    try {
      requireAuthenticationEnabled();
      return await readOperatorSession(
        this.prisma, sessionTokenFromCookieHeader(request.headers?.cookie), new Date()
      );
    } catch (error) {
      throwHttp(error);
    }
  }

  @Post("logout")
  async logout(@Req() request: CookieRequest, @Res({ passthrough: true }) response: CookieResponse) {
    try {
      requireAuthenticationEnabled();
      await revokeOperatorSession(
        this.prisma, sessionTokenFromCookieHeader(request.headers?.cookie), new Date()
      );
      response.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
      return { status: "logged_out" as const };
    } catch (error) {
      throwHttp(error);
    }
  }
}
