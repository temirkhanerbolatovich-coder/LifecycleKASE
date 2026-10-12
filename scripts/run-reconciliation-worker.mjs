import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { HttpSolanaRpc } from "@lifecycle-kase/solana-client";
import { reconciliationErrorCode, reconciliationWorkerOptionsFromEnvironment, runReconciliationTick } from "../apps/api/dist/reconciliation-worker.js";

// Separate, explicit candidate process: never load .env, DATABASE_URL, wallet secrets or the retained owner environment.
const args = process.argv.slice(2);
if (args.some(value => value !== "--once") || args.length > 1) throw new Error("Usage: run-reconciliation-worker.mjs [--once]");
const options = reconciliationWorkerOptionsFromEnvironment();
if (!options.enabled) {
  console.log(JSON.stringify({ status: "DISABLED", confirmationSource: "SYSTEM_RECONCILIATION" }));
} else {
  const database = new PrismaClient({ datasources: { db: { url: options.databaseUrl } } });
  const rpc = new HttpSolanaRpc(options.rpcEndpoint, options.rpcTimeoutMs);
  const runnerId = randomUUID();
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  try {
    do {
      try {
        const result = await runReconciliationTick(database, rpc, options, runnerId);
        if (args.includes("--once") || result.status !== "IDLE") console.log(JSON.stringify(result));
      } catch (error) {
        const errorCode = reconciliationErrorCode(error);
        console.error(JSON.stringify({ status: "TICK_FAILED", errorCode }));
        if (["RECONCILIATION_CONFIGURATION_INVALID", "WRONG_SOLANA_NETWORK", "RECONCILIATION_INTERNAL_ERROR",
          "RECONCILIATION_DATABASE_ERROR", "RECONCILIATION_RPC_MUTATION_FORBIDDEN"].includes(errorCode) || args.includes("--once")) {
          process.exitCode = 1; break;
        }
      }
      if (args.includes("--once") || stop.signal.aborted) break;
      try { await setTimeout(options.pollMs, undefined, { signal: stop.signal }); }
      catch (error) { if (!stop.signal.aborted) throw error; }
    } while (!stop.signal.aborted);
  } finally {
    process.removeListener("SIGINT", shutdown); process.removeListener("SIGTERM", shutdown);
    await database.$disconnect();
  }
}
