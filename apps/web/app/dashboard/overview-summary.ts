import type { CorporateActionView } from "./action-workflow";
import { LOCALE_FORMATS, type Locale } from "./locale";
export type OverviewSummary = {
  schema: "operator-overview-v1"; source: "POSTGRESQL_REPEATABLE_READ"; asOf: string; network: string;
  period: { from: string; toExclusive: string; basis: "ACTION_EXECUTE_AT" }; completeAggregates: true;
  activeInstruments: number; openActions: number; unknownOperations: number;
  financing: { source: "NOT_QUERIED"; availableMinor: null; reservedMinor: null };
  assets: { assetId: string; code: string; network: string; mintAddress: string | null; decimals: number; isSimulated: boolean;
    actionCount: number; calculatedActions: number; uncalculatedActions: number; payableMinor: string | null; paidMinor: string | null }[];
  queue: { limit: number; total: number; items: (CorporateActionView & { hasUnknownConfirmation: boolean })[] };
};
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const amount = (value: unknown) => value === null || typeof value === "string" && /^(0|[1-9][0-9]{0,89})$/.test(value);
const actionStatuses = new Set(["DRAFT", "SCHEDULED", "SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW", "RETURNED_FOR_REVISION", "APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "RECONCILING", "FAILED_RETRYABLE", "FAILED_FINAL", "SNAPSHOT_MISSED"]);
function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

/** Refuses partial-page metrics, mixed asset metadata and contradictory queue counts. */
export function validatedOverviewSummary(value: Record<string, unknown>): OverviewSummary {
  const invalid = () => new Error("OVERVIEW_RESPONSE_INVALID");
  const period = record(value["period"]), queue = record(value["queue"]), financing = record(value["financing"]);
  if (value["schema"] !== "operator-overview-v1" || value["source"] !== "POSTGRESQL_REPEATABLE_READ" || value["completeAggregates"] !== true ||
      !date(value["asOf"]) || !["SOLANA_LOCALNET", "SOLANA_DEVNET"].includes(String(value["network"])) ||
      !["activeInstruments", "openActions", "unknownOperations"].every(field => count(value[field])) ||
      !period || period["basis"] !== "ACTION_EXECUTE_AT" || !date(period["from"]) || !date(period["toExclusive"]) ||
      Date.parse(String(period["toExclusive"])) <= Date.parse(String(period["from"])) ||
      !financing || financing["source"] !== "NOT_QUERIED" || financing["availableMinor"] !== null || financing["reservedMinor"] !== null ||
      !queue || queue["limit"] !== 7 || queue["total"] !== value["openActions"] || !Array.isArray(queue["items"]) || queue["items"].length > 7 ||
      queue["items"].length !== Math.min(7, Number(queue["total"])) || !Array.isArray(value["assets"]) || value["assets"].length > 1000) throw invalid();
  const ids = new Set();
  let visibleUnknownActions = 0;
  for (const item of queue["items"]) {
    const row = record(item), instrument = record(row?.["instrument"]);
    if (!row || !uuid(row["id"]) || ids.has(row["id"]) || typeof row["hasUnknownConfirmation"] !== "boolean" ||
        !count(row["version"]) || !uuid(row["instrumentId"]) || !actionStatuses.has(String(row["status"])) ||
        !["COUPON_PAYMENT", "EARLY_REDEMPTION", "BOND_REDEMPTION"].includes(String(row["type"])) || !Array.isArray(row["blockchainTransactions"]) ||
        !date(row["recordAt"]) || !date(row["executeAt"]) || !instrument || typeof instrument["ticker"] !== "string" ||
        typeof instrument["issuerAuthority"] !== "string" || instrument["network"] !== value["network"] || instrument["id"] !== row["instrumentId"]) throw invalid();
    for (const value of row["blockchainTransactions"]) {
      const transaction = record(value);
      if (!transaction || !uuid(transaction["id"]) || typeof transaction["operationType"] !== "string" ||
          !["PREPARED", "SUBMITTED", "FINALIZED", "UNKNOWN_CONFIRMATION", "FAILED"].includes(String(transaction["status"])) ||
          !(transaction["signature"] === null || typeof transaction["signature"] === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(transaction["signature"]))) throw invalid();
      if (transaction["status"] === "UNKNOWN_CONFIRMATION" && !row["hasUnknownConfirmation"]) throw invalid();
    }
    if (row["hasUnknownConfirmation"]) visibleUnknownActions++;
    ids.add(row["id"]);
  }
  if (visibleUnknownActions > Number(value["unknownOperations"])) throw invalid();
  const assetIds = new Set();
  for (const item of value["assets"]) {
    const row = record(item);
    if (!row || !uuid(row["assetId"]) || assetIds.has(row["assetId"]) || typeof row["code"] !== "string" || row["code"].length > 30 ||
        row["network"] !== value["network"] || typeof row["isSimulated"] !== "boolean" ||
        !count(row["decimals"]) || Number(row["decimals"]) > 18 ||
        !["actionCount", "calculatedActions", "uncalculatedActions"].every(field => count(row[field])) ||
        Number(row["calculatedActions"]) + Number(row["uncalculatedActions"]) !== row["actionCount"] ||
        !amount(row["payableMinor"]) || !amount(row["paidMinor"]) ||
        (row["calculatedActions"] === 0 ? row["payableMinor"] !== null || row["paidMinor"] !== null : row["payableMinor"] === null || row["paidMinor"] === null) ||
        !(row["mintAddress"] === null || typeof row["mintAddress"] === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row["mintAddress"]))) throw invalid();
    assetIds.add(row["assetId"]);
  }
  return value as unknown as OverviewSummary;
}

/** Asset decimals and labels remain separate; no amount is converted to a floating point number. */
export function formatOverviewAmount(value: string, decimals: number, code: string, locale: Locale): string {
  if (!amount(value) || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("OVERVIEW_RESPONSE_INVALID");
  const units = BigInt(value), scale = 10n ** BigInt(decimals);
  const formatter = new Intl.NumberFormat(LOCALE_FORMATS[locale], { maximumFractionDigits: 0 });
  const whole = formatter.format(units / scale);
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "").padEnd(Math.min(2, decimals), "0");
  const separator = new Intl.NumberFormat(LOCALE_FORMATS[locale]).formatToParts(1.1).find(part => part.type === "decimal")!.value;
  return `${whole}${decimals === 0 ? "" : separator + fraction} ${code === "KZT_TEST" ? "KZT-Test" : code}`;
}
