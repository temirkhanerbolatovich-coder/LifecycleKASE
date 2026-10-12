import { Prisma, type PrismaClient } from "@prisma/client";
import { actionInclude, serializeAction } from "./corporate-action-registry.js";
import { instrumentNetworkFromEnvironment } from "./instrument-registry.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";

const DAY = 86_400_000;
const TERMINAL = ["FINALIZED", "CANCELLED", "REJECTED"] as const;

export function overviewPeriod(query: { from?: unknown; to?: unknown }, now = new Date()) {
  const timestamp = (value: unknown, fallback: Date) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || value.length > 30 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) {
      throw new TransactionWorkflowError("INVALID_REQUEST", "Overview dates must be ISO UTC timestamps", 400);
    }
    const parsed = new Date(value);
    const normalized = value.includes(".") ? value : value.slice(0, -1) + ".000Z";
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
      throw new TransactionWorkflowError("INVALID_REQUEST", "Overview timestamp is invalid", 400);
    }
    return parsed;
  };
  const from = timestamp(query.from, new Date(now.getTime() - 7 * DAY));
  const to = timestamp(query.to, new Date((query.from === undefined ? now : from).getTime() + 7 * DAY));
  if (to <= from || to.getTime() - from.getTime() > 366 * DAY) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Overview period must be positive and at most 366 days", 400);
  }
  return { from, to };
}

function count(value: bigint | number) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new TransactionWorkflowError("OVERVIEW_RANGE", "Overview count exceeds its supported range", 409);
  return result;
}

type AssetTotals = { assetId: string; code: string; network: string; mintAddress: string | null; decimals: number; isSimulated: boolean;
  actionCount: bigint; calculatedActions: bigint; uncalculatedActions: bigint; payableMinor: string | null; paidMinor: string | null };

/** Full-database aggregates and a bounded priority queue share one repeatable-read snapshot. */
export async function getOperatorOverview(database: PrismaClient, query: { from?: unknown; to?: unknown },
  now = new Date(), network = instrumentNetworkFromEnvironment()) {
  const period = overviewPeriod(query, now);
  return database.$transaction(async tx => {
    const [activeInstruments, openActions, unknownOperations, assets, queueIds] = await Promise.all([
      tx.instrument.count({ where: { network, status: "ACTIVE" } }),
      tx.corporateAction.count({ where: { instrument: { network }, status: { notIn: [...TERMINAL] } } }),
      tx.blockchainTransaction.count({ where: { OR: [{ instrument: { network } }, { corporateAction: { instrument: { network } } }], status: "UNKNOWN_CONFIRMATION" } }),
      tx.$queryRaw<AssetTotals[]>(Prisma.sql`
        SELECT sa.id AS "assetId", sa.code, sa.network, sa.mint_address AS "mintAddress", sa.decimals,
          sa.is_simulated AS "isSimulated", COUNT(DISTINCT a.id) AS "actionCount",
          COUNT(DISTINCT a.id) FILTER (WHERE EXISTS (SELECT 1 FROM entitlements q WHERE q.corporate_action_id=a.id)) AS "calculatedActions",
          COUNT(DISTINCT a.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM entitlements q WHERE q.corporate_action_id=a.id)) AS "uncalculatedActions",
          CAST(SUM(e.amount_minor) FILTER (WHERE a.status NOT IN ('FINALIZED','CANCELLED','REJECTED') AND
            e.status IN ('CALCULATED','READY','PROCESSING','FAILED_RETRYABLE','FAILED_FINAL')) AS TEXT) AS "payableMinor",
          CAST(SUM(s.actual_amount_minor) FILTER (WHERE s.status='FINALIZED' AND s.reconciliation_status='MATCHED') AS TEXT) AS "paidMinor"
        FROM corporate_actions a JOIN instruments i ON i.id=a.instrument_id
        JOIN settlement_assets sa ON sa.id=i.settlement_asset_id
        LEFT JOIN entitlements e ON e.corporate_action_id=a.id LEFT JOIN settlements s ON s.entitlement_id=e.id
        WHERE i.network=${network} AND a.execute_at >= ${period.from} AND a.execute_at < ${period.to}
        GROUP BY sa.id, sa.code, sa.network, sa.mint_address, sa.decimals, sa.is_simulated ORDER BY sa.code, sa.id
      `),
      tx.$queryRaw<{ id: string; unknown: boolean }[]>(Prisma.sql`
        SELECT a.id, EXISTS (SELECT 1 FROM blockchain_transactions t WHERE t.corporate_action_id=a.id AND
          t.status='UNKNOWN_CONFIRMATION') AS unknown
        FROM corporate_actions a JOIN instruments i ON i.id=a.instrument_id
        WHERE i.network=${network} AND a.status NOT IN ('FINALIZED','CANCELLED','REJECTED')
        ORDER BY CASE WHEN EXISTS (SELECT 1 FROM blockchain_transactions t WHERE t.corporate_action_id=a.id AND
          t.status='UNKNOWN_CONFIRMATION') THEN 0 WHEN a.status IN ('FAILED_RETRYABLE','FAILED_FINAL','RECONCILING','SNAPSHOT_MISSED') THEN 1
          WHEN a.execute_at < ${now} THEN 2 ELSE 3 END, a.execute_at, a.id LIMIT 7
      `),
    ]);
    const actions = queueIds.length ? await tx.corporateAction.findMany({ where: { id: { in: queueIds.map(row => row.id) } }, include: actionInclude }) : [];
    return { schema: "operator-overview-v1", source: "POSTGRESQL_REPEATABLE_READ", asOf: now.toISOString(), network,
      period: { from: period.from.toISOString(), toExclusive: period.to.toISOString(), basis: "ACTION_EXECUTE_AT" },
      completeAggregates: true, activeInstruments: count(activeInstruments), openActions: count(openActions), unknownOperations: count(unknownOperations),
      financing: { source: "NOT_QUERIED", availableMinor: null, reservedMinor: null },
      assets: assets.map(row => ({ ...row, actionCount: count(row.actionCount), calculatedActions: count(row.calculatedActions),
        uncalculatedActions: count(row.uncalculatedActions), payableMinor: row.calculatedActions === 0n ? null : row.payableMinor ?? "0",
        paidMinor: row.calculatedActions === 0n ? null : row.paidMinor ?? "0" })),
      queue: { limit: 7, total: count(openActions), items: queueIds.map(row => {
        const action = actions.find(action => action.id === row.id);
        if (!action) throw new TransactionWorkflowError("OVERVIEW_INTEGRITY", "Overview queue and action facts differ", 409);
        return { ...serializeAction(action), hasUnknownConfirmation: row.unknown };
      }) },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
