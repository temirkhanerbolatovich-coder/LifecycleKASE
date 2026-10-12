import { randomUUID } from "node:crypto";
import { Controller, Get, Header, HttpException, Param, Query, Req, Res } from "@nestjs/common";
import { AuthFlowError, readOperatorSession, requireAuthenticationEnabled, sessionTokenFromCookieHeader } from "./auth.js";
import { PrismaService } from "./prisma.service.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";
import { actionEvidenceFile, getActionEvidenceExport } from "./action-evidence-export.js";

type Request = { headers?: { cookie?: string } };
type Response = { setHeader(name: string, value: string): void };

@Controller("corporate-actions")
export class ActionEvidenceExportController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":id/evidence-export")
  @Header("Cache-Control", "no-store")
  async download(@Param("id") actionId: string, @Query("format") format: unknown,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      requireAuthenticationEnabled();
      const session = await readOperatorSession(this.prisma, sessionTokenFromCookieHeader(request.headers?.cookie), new Date());
      if (!["ADMINISTRATOR", "AUDITOR"].includes(session.user.role)) {
        throw new AuthFlowError("ROLE_FORBIDDEN", "Evidence exports require an Administrator or Auditor", 403);
      }
      if (format !== "json" && format !== "csv") throw new TransactionWorkflowError("INVALID_REQUEST", "Evidence format must be json or csv", 400);
      const correlationId = randomUUID();
      const bundle = await getActionEvidenceExport(this.prisma, actionId), file = actionEvidenceFile(bundle, format);
      await this.prisma.auditLog.create({ data: { actorId: session.user.id, actorWallet: session.walletAddress, correlationId,
        event: "ACTION_EVIDENCE_EXPORTED", entityType: "CorporateAction", entityId: actionId, corporateActionId: actionId,
        metadataJson: { format, payloadSha256: file.payloadSha256, fileSha256: file.fileSha256,
          actionVersion: bundle.payload.action.version, evidenceComplete: bundle.payload.outcome.evidenceComplete } } });
      response.setHeader("X-Correlation-ID", correlationId);
      response.setHeader("Content-Type", file.mimeType);
      response.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Evidence-File-SHA256", file.fileSha256);
      response.setHeader("X-Evidence-Payload-SHA256", file.payloadSha256);
      return file.body;
    } catch (error) {
      if (error instanceof AuthFlowError || error instanceof TransactionWorkflowError) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  }
}
