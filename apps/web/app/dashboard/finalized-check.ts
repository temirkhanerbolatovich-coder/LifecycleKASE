import { OperatorApiError } from "./operator-api";
import { requireFinalizedResponse } from "./snapshot-workflow";

/** Retries only confirmation of the same signature; never prepares, signs or broadcasts. */
export async function waitForFinalizedCheck(check: () => Promise<Record<string, unknown>>, operationId: string, signature: string,
  waiting: () => void, options = { attempts: 16, pause: () => new Promise<void>(resolve => setTimeout(resolve, 3000)) }) {
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      const result = await check(); requireFinalizedResponse(result, operationId, signature); return result;
    } catch (error) {
      if (!(error instanceof OperatorApiError) || error.code !== "TRANSACTION_NOT_FINALIZED" || attempt === options.attempts - 1) throw error;
      waiting(); await options.pause();
    }
  }
  throw new Error("Не удалось завершить finalized-проверку.");
}
