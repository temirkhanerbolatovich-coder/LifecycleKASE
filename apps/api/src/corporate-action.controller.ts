import { Body, Controller, Get, Header, Headers, HttpException, Param, Post, Query, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { HttpSolanaRpc, SolanaRpcError } from "@lifecycle-kase/solana-client";
import { AuthFlowError, authOptionsFromEnvironment, readOperatorSession, requireAuthenticationEnabled,
  requireRequestOrigin, sessionTokenFromCookieHeader } from "./auth.js";
import { AuthRateLimitError, AuthRateLimitService, authenticationClientKey } from "./auth-rate-limit.js";
import { createCorporateActionDraft, getCorporateAction, listCorporateActions } from "./corporate-action-registry.js";
import { cancelCorporateActionDraft, confirmCorporateActionOperation, prepareCorporateActionOperation,
  submitCorporateActionOperation } from "./corporate-action-operations.js";
import { InstrumentDeploymentError, instrumentDeploymentOptions } from "./instrument-deployment.js";
import { InstrumentRegistryError } from "./instrument-registry.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";
import { SnapshotPreparationError } from "./snapshot-candidate.js";
import { PrismaService } from "./prisma.service.js";
import { calculateEntitlements, getEntitlements, reviewEntitlements } from "./entitlements.js";
import { confirmCouponFunding, couponNetworkReserve, getCouponBudget, prepareCouponFunding, submitCouponFunding } from "./coupon-funding.js";
import { confirmOnchainCalculation, onchainCalculationEnabled, prepareOnchainCalculation,
  submitOnchainCalculation } from "./onchain-entitlements.js";

type Request = { headers?: { cookie?: string }; ip?: string; socket?: { remoteAddress?: string } };
type Response = { setHeader(name: string, value: string): void };

@Controller("corporate-actions")
export class CorporateActionController {
  constructor(private readonly prisma: PrismaService, private readonly rateLimit: AuthRateLimitService) {}
  private async actor(request: Request, response: Response, mutation: boolean, origin?: string) {
    requireAuthenticationEnabled();
    if (mutation) {
      requireRequestOrigin(origin, authOptionsFromEnvironment());
      this.rateLimit.consumeMutation(authenticationClientKey(request));
    }
    const session = await readOperatorSession(this.prisma, sessionTokenFromCookieHeader(request.headers?.cookie), new Date());
    if (!(mutation ? ["ADMINISTRATOR"] : ["ADMINISTRATOR", "AUDITOR"]).includes(session.user.role)) {
      throw new AuthFlowError("ROLE_FORBIDDEN", "Corporate action access is not allowed for this role", 403);
    }
    const correlationId = randomUUID(); response.setHeader("X-Correlation-ID", correlationId);
    return { id: session.user.id, walletAddress: session.walletAddress, correlationId };
  }
  private httpError(error: unknown, response: Response): never {
    if (error instanceof AuthFlowError || error instanceof TransactionWorkflowError || error instanceof InstrumentDeploymentError || error instanceof InstrumentRegistryError) {
      if (error instanceof AuthRateLimitError) response.setHeader("Retry-After", String(error.retryAfterSeconds));
      throw new HttpException({ code: error.code, message: error.message }, error.status);
    }
    if (error instanceof SnapshotPreparationError) throw new HttpException({ code: error.code, message: error.message }, 400);
    if (error instanceof SolanaRpcError) throw new HttpException({ code: error.code, message: "Solana RPC operation failed" }, 503);
    throw error;
  }
  @Get()
  @Header("Cache-Control", "no-store")
  async list(@Req() request: Request, @Res({ passthrough: true }) response: Response,
    @Query("instrumentId") instrumentId?: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    try { await this.actor(request, response, false); return await listCorporateActions(this.prisma, { instrumentId, limit, cursor }); }
    catch (error) { this.httpError(error, response); }
  }
  @Get(":id")
  @Header("Cache-Control", "no-store")
  async detail(@Param("id") actionId: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try { await this.actor(request, response, false); return await getCorporateAction(this.prisma, actionId); }
    catch (error) { this.httpError(error, response); }
  }
  @Post()
  @Header("Cache-Control", "no-store")
  async create(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try { return await createCorporateActionDraft(this.prisma, body, await this.actor(request, response, true, origin)); }
    catch (error) { this.httpError(error, response); }
  }
  @Post(":id/prepare")
  @Header("Cache-Control", "no-store")
  async prepare(@Param("id") actionId: string, @Body() body: unknown, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try {
      const actor = await this.actor(request, response, true, origin); const options = instrumentDeploymentOptions();
      return await prepareCorporateActionOperation(this.prisma, new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs), actionId, body, actor, options);
    } catch (error) { this.httpError(error, response); }
  }
  @Post(":id/submit")
  @Header("Cache-Control", "no-store")
  async submit(@Param("id") actionId: string, @Body() body: unknown, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try {
      const actor = await this.actor(request, response, true, origin); const options = instrumentDeploymentOptions();
      return await submitCorporateActionOperation(this.prisma, new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs), actionId, body, actor, options);
    } catch (error) { this.httpError(error, response); }
  }
  @Post(":id/confirm")
  @Header("Cache-Control", "no-store")
  async confirm(@Param("id") actionId: string, @Body() body: unknown, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try {
      const actor = await this.actor(request, response, true, origin); const options = instrumentDeploymentOptions();
      return await confirmCorporateActionOperation(this.prisma, new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs), actionId, body, actor, options);
    } catch (error) { this.httpError(error, response); }
  }
  @Post(":id/cancel")
  @Header("Cache-Control", "no-store")
  async cancelDraft(@Param("id") actionId: string, @Body() body: unknown, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try { return await cancelCorporateActionDraft(this.prisma, actionId, body, await this.actor(request, response, true, origin)); }
    catch (error) { this.httpError(error, response); }
  }
  @Get(":id/entitlements")
  @Header("Cache-Control", "no-store")
  async entitlements(@Param("id") actionId: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      await this.actor(request, response, false); const result = await getEntitlements(this.prisma, actionId);
      const enabled = onchainCalculationEnabled();
      const finalized = enabled && Boolean(await this.prisma.blockchainTransaction.findFirst({ where: {
        corporateActionId: actionId, operationType: "CALCULATION_FINALIZE", status: "FINALIZED"
      }, select: { id: true } }));
      return { ...result, onchainRegistrationEnabled: enabled, onchainCalculationFinalized: finalized };
    }
    catch (error) { this.httpError(error, response); }
  }
  @Post(":id/entitlements/calculate")
  @Header("Cache-Control", "no-store")
  async calculate(@Param("id") actionId: string, @Body() body: unknown, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try { return await calculateEntitlements(this.prisma, actionId, body, await this.actor(request, response, true, origin)); }
    catch (error) { this.httpError(error, response); }
  }
  @Post(":id/entitlements/review")
  @Header("Cache-Control", "no-store")
  async review(@Param("id") actionId: string, @Body() body: unknown, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try { return await reviewEntitlements(this.prisma, actionId, body, await this.actor(request, response, true, origin), new Date(), onchainCalculationEnabled()); }
    catch (error) { this.httpError(error, response); }
  }
  @Post(":id/entitlements/onchain/:operation")
  @Header("Cache-Control", "no-store")
  async onchainCalculation(@Param("id") actionId: string, @Param("operation") operation: string, @Body() body: unknown,
    @Req() request: Request, @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try {
      const actor = await this.actor(request, response, true, origin);
      if (!["prepare", "submit", "confirm"].includes(operation)) throw new TransactionWorkflowError("INVALID_REQUEST", "On-chain calculation operation is unsupported", 400);
      const options = { ...instrumentDeploymentOptions(), enabled: onchainCalculationEnabled() };
      const rpc = new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs);
      const execute = operation === "prepare" ? prepareOnchainCalculation : operation === "submit" ? submitOnchainCalculation : confirmOnchainCalculation;
      return await execute(this.prisma, rpc, actionId, body, actor, options);
    } catch (error) { this.httpError(error, response); }
  }
  @Get(":id/coupon/budget")
  @Header("Cache-Control", "no-store")
  async couponBudget(@Param("id") actionId: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      await this.actor(request, response, false); const options = { ...instrumentDeploymentOptions(), networkReserveLamports: couponNetworkReserve() };
      return await getCouponBudget(this.prisma, new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs), actionId, options);
    } catch (error) { this.httpError(error, response); }
  }
  @Post(":id/coupon/funding/:operation")
  @Header("Cache-Control", "no-store")
  async couponFunding(@Param("id") actionId: string, @Param("operation") operation: string, @Body() body: unknown,
    @Req() request: Request, @Res({ passthrough: true }) response: Response, @Headers("origin") origin?: string) {
    try {
      const actor = await this.actor(request, response, true, origin);
      if (!["prepare", "submit", "confirm"].includes(operation)) throw new TransactionWorkflowError("INVALID_REQUEST", "Funding operation is unsupported", 400);
      const options = { ...instrumentDeploymentOptions(), networkReserveLamports: couponNetworkReserve() };
      const rpc = new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs);
      const execute = operation === "prepare" ? prepareCouponFunding : operation === "submit" ? submitCouponFunding : confirmCouponFunding;
      return await execute(this.prisma, rpc, actionId, body, actor, options);
    } catch (error) { this.httpError(error, response); }
  }
}
