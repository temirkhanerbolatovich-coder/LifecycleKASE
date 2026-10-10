import { Controller, Get, Header, HttpException, Param, Query, Req } from "@nestjs/common";
import { AuthFlowError, readOperatorSession, requireAuthenticationEnabled, sessionTokenFromCookieHeader } from "./auth.js";
import { PrismaService } from "./prisma.service.js";
import { listAuditEvidence, listTransactionEvidence, transactionEvidenceSelect, type EvidenceQuery } from "./evidence.js";
import { TransactionWorkflowError, WORKFLOW_UUID } from "./transaction-workflow.js";
type Request = { headers?: { cookie?: string } };
@Controller()
export class EvidenceController {
  constructor(private readonly prisma: PrismaService) {}
  private async read<T>(request: Request, work: () => Promise<T>) {
    try {
      requireAuthenticationEnabled();
      const session = await readOperatorSession(this.prisma, sessionTokenFromCookieHeader(request.headers?.cookie), new Date());
      if (!["ADMINISTRATOR", "AUDITOR"].includes(session.user.role)) throw new AuthFlowError("ROLE_FORBIDDEN", "Evidence requires an Administrator or Auditor", 403);
      return await work();
    } catch (error) {
      if (error instanceof AuthFlowError || error instanceof TransactionWorkflowError) throw new HttpException({ code: error.code, message: error.message }, error.status);
      throw error;
    }
  }
  @Get("transactions")
  @Header("Cache-Control", "no-store")
  transactions(@Req() request: Request, @Query() query: EvidenceQuery) { return this.read(request, () => listTransactionEvidence(this.prisma, query)); }
  @Get("transactions/:signature")
  @Header("Cache-Control", "no-store")
  transaction(@Req() request: Request, @Param("signature") signature: string) {
    return this.read(request, async () => {
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new TransactionWorkflowError("INVALID_REQUEST", "Signature is invalid", 400);
      const record = await this.prisma.blockchainTransaction.findUnique({ where: { signature }, select: transactionEvidenceSelect });
      if (!record) throw new TransactionWorkflowError("TRANSACTION_NOT_FOUND", "Transaction was not found", 404);
      return record;
    });
  }
  @Get("audit")
  @Header("Cache-Control", "no-store")
  audit(@Req() request: Request, @Query() query: EvidenceQuery) { return this.read(request, () => listAuditEvidence(this.prisma, query)); }
  @Get("corporate-actions/:id/audit")
  @Header("Cache-Control", "no-store")
  actionAudit(@Req() request: Request, @Param("id") id: string, @Query() query: EvidenceQuery) {
    return this.read(request, async () => {
      if (!WORKFLOW_UUID.test(id) || !await this.prisma.corporateAction.findUnique({ where: { id }, select: { id: true } })) throw new TransactionWorkflowError("ACTION_NOT_FOUND", "Action was not found", 404);
      return listAuditEvidence(this.prisma, { ...query, actionId: id });
    });
  }
}
