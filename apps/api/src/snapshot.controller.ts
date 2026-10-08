import { Body, Controller, Header, Headers, HttpException, Param, Post, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { HttpSolanaRpc, SolanaRpcError } from "@lifecycle-kase/solana-client";

import {
  AuthFlowError,
  authOptionsFromEnvironment,
  readOperatorSession,
  requireAuthenticationEnabled,
  requireRequestOrigin,
  sessionTokenFromCookieHeader
} from "./auth.js";
import { AuthRateLimitError, AuthRateLimitService, authenticationClientKey } from "./auth-rate-limit.js";
import { PrismaService } from "./prisma.service.js";
import { SnapshotPreparationError } from "./snapshot-candidate.js";
import { confirmSnapshotRegistration } from "./snapshot-confirmation.js";
import { prepareSnapshotRegistrationForAction, snapshotHttpOptionsFromEnvironment } from "./snapshot-http.js";
import { submitSnapshotRegistration } from "./snapshot-submission.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";
import { instrumentDeploymentOptions } from "./instrument-deployment.js";

type HttpRequest = {
  headers?: { cookie?: string };
  ip?: string;
  socket?: { remoteAddress?: string };
};
type HttpResponse = { setHeader(name: string, value: string): void };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(error: unknown, response?: HttpResponse): never {
  if (error instanceof TransactionWorkflowError) throw new HttpException({ code: error.code, message: error.message }, error.status);
  if (error instanceof AuthFlowError) {
    if (error instanceof AuthRateLimitError && response) {
      response.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof SnapshotPreparationError) {
    const status = error.code === "ACTION_NOT_FOUND" || error.code === "SNAPSHOT_NOT_FOUND" ||
      error.code === "REGISTRATION_NOT_FOUND"
      ? 404
      : error.code === "SNAPSHOT_CONFIGURATION_INVALID" ? 503
        : error.code.includes("RPC") || error.code.includes("BLOCK_TIME") ? 503
          : error.code === "INVALID_REQUEST" ? 400 : 409;
    throw new HttpException({ code: error.code, message: error.message }, status);
  }
  if (error instanceof SolanaRpcError) {
    throw new HttpException({ code: error.code, message: "Solana RPC operation failed" }, 503);
  }
  throw error;
}

@Controller("corporate-actions")
export class SnapshotController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: AuthRateLimitService
  ) {}

  @Post(":id/snapshot/prepare")
  @Header("Cache-Control", "no-store")
  async prepare(
    @Param("id") actionId: string,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
    @Headers("origin") origin?: string,
    @Headers("x-correlation-id") requestedCorrelationId?: string
  ) {
    const correlationId = requestedCorrelationId && UUID_PATTERN.test(requestedCorrelationId)
      ? requestedCorrelationId : randomUUID();
    response.setHeader("X-Correlation-ID", correlationId);
    try {
      requireAuthenticationEnabled();
      const authOptions = authOptionsFromEnvironment();
      requireRequestOrigin(origin, authOptions);
      this.rateLimit.consumeMutation(authenticationClientKey(request));
      const session = await readOperatorSession(
        this.prisma,
        sessionTokenFromCookieHeader(request.headers?.cookie),
        new Date()
      );
      if (session.user.role !== "ADMINISTRATOR") {
        throw new AuthFlowError("ROLE_FORBIDDEN", "Administrator role is required", 403);
      }
      const options = snapshotHttpOptionsFromEnvironment();
      const rpc = new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs);
      return await prepareSnapshotRegistrationForAction(
        this.prisma,
        rpc,
        actionId,
        { id: session.user.id, walletAddress: session.walletAddress, correlationId },
        { ...options, now: new Date() }
      );
    } catch (error) {
      httpError(error, response);
    }
  }

  @Post(":id/snapshot/confirm")
  @Header("Cache-Control", "no-store")
  async confirm(
    @Param("id") actionId: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
    @Headers("origin") origin?: string,
    @Headers("x-correlation-id") requestedCorrelationId?: string
  ) {
    const correlationId = requestedCorrelationId && UUID_PATTERN.test(requestedCorrelationId)
      ? requestedCorrelationId : randomUUID();
    response.setHeader("X-Correlation-ID", correlationId);
    try {
      requireAuthenticationEnabled();
      const authOptions = authOptionsFromEnvironment();
      requireRequestOrigin(origin, authOptions);
      this.rateLimit.consumeMutation(authenticationClientKey(request));
      const session = await readOperatorSession(
        this.prisma,
        sessionTokenFromCookieHeader(request.headers?.cookie),
        new Date()
      );
      if (session.user.role !== "ADMINISTRATOR") {
        throw new AuthFlowError("ROLE_FORBIDDEN", "Administrator role is required", 403);
      }
      const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
      const operationId = payload["operationId"];
      const signature = payload["signature"];
      if (!UUID_PATTERN.test(actionId) || typeof operationId !== "string" || !UUID_PATTERN.test(operationId) ||
          typeof signature !== "string" || signature.length < 64 || signature.length > 88 ||
          !/^[1-9A-HJ-NP-Za-km-z]+$/.test(signature)) {
        throw new SnapshotPreparationError("INVALID_REQUEST", "Action, operation, or signature is invalid");
      }
      const options = snapshotHttpOptionsFromEnvironment();
      const rpc = new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs);
      return await confirmSnapshotRegistration(
        this.prisma,
        rpc,
        actionId,
        operationId,
        signature,
        { id: session.user.id, walletAddress: session.walletAddress, correlationId },
        options.expectedGenesisHash,
        new Date()
      );
    } catch (error) {
      httpError(error, response);
    }
  }

  @Post(":id/snapshot/submit")
  @Header("Cache-Control", "no-store")
  async submit(@Param("id") actionId: string, @Body() body: unknown, @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse, @Headers("origin") origin?: string) {
    try {
      requireAuthenticationEnabled();
      requireRequestOrigin(origin, authOptionsFromEnvironment());
      this.rateLimit.consumeMutation(authenticationClientKey(request));
      const session = await readOperatorSession(this.prisma, sessionTokenFromCookieHeader(request.headers?.cookie), new Date());
      if (session.user.role !== "ADMINISTRATOR") throw new AuthFlowError("ROLE_FORBIDDEN", "Administrator role is required", 403);
      const options = instrumentDeploymentOptions(); const correlationId = randomUUID();
      response.setHeader("X-Correlation-ID", correlationId);
      return await submitSnapshotRegistration(this.prisma, new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs), actionId, body,
        { id: session.user.id, walletAddress: session.walletAddress, correlationId }, options);
    } catch (error) { httpError(error, response); }
  }
}
