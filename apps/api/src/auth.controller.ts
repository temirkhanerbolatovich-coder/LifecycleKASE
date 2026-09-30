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
import { PrismaService } from "./prisma.service.js";

type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
};
type CookieRequest = { headers?: { cookie?: string } };

function throwHttp(error: unknown): never {
  if (error instanceof AuthFlowError) {
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
  constructor(private readonly prisma: PrismaService) {}

  @Post("challenge")
  async challenge(@Body() body: { walletAddress?: unknown }, @Headers("origin") origin?: string) {
    try {
      requireAuthenticationEnabled();
      return await createOperatorChallenge(
        this.prisma,
        { walletAddress: body?.walletAddress, origin, now: new Date() },
        authOptionsFromEnvironment()
      );
    } catch (error) {
      throwHttp(error);
    }
  }

  @Post("verify")
  async verify(
    @Body() body: { challengeId?: unknown; nonce?: unknown; signature?: unknown },
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse
  ) {
    try {
      requireAuthenticationEnabled();
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
      throwHttp(error);
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
