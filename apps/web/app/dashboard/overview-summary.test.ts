import assert from "node:assert/strict";
import test from "node:test";
import { formatOverviewAmount, validatedOverviewSummary } from "./overview-summary";

const fixture = () => ({ schema: "operator-overview-v1", source: "POSTGRESQL_REPEATABLE_READ", asOf: "2026-10-12T10:00:00.000Z",
  network: "SOLANA_LOCALNET", completeAggregates: true, activeInstruments: 2, openActions: 10000, unknownOperations: 20,
  period: { from: "2026-10-12T10:00:00.000Z", toExclusive: "2026-10-19T10:00:00.000Z", basis: "ACTION_EXECUTE_AT" },
  financing: { source: "NOT_QUERIED", availableMinor: null, reservedMinor: null }, queue: { limit: 7, total: 10000, items: Array.from({ length: 7 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, version: 0, instrumentId: "22222222-2222-4222-8222-222222222222", type: "COUPON_PAYMENT", status: "DRAFT",
    hasUnknownConfirmation: false, recordAt: "2026-10-12T10:00:00.000Z", executeAt: "2026-10-12T10:00:00.000Z", blockchainTransactions: [] as unknown[],
    instrument: { id: "22222222-2222-4222-8222-222222222222", ticker: "TEST", issuerAuthority: "11111111111111111111111111111111", network: "SOLANA_LOCALNET" } })) },
  assets: [{ assetId: "11111111-1111-4111-8111-111111111111", code: "KZT_TEST", network: "SOLANA_LOCALNET", mintAddress: null,
    decimals: 6, isSimulated: true, actionCount: 30, calculatedActions: 20, uncalculatedActions: 10, payableMinor: "9007199254740993000000", paidMinor: "0" }] });

test("overview retains full server totals independent of its bounded queue", () => {
  const result = validatedOverviewSummary(fixture());
  assert.equal(result.openActions, 10000); assert.equal(result.queue.items.length, 7);
  assert.equal(result.assets[0]!.payableMinor, "9007199254740993000000");
  assert.equal(result.financing.availableMinor, null);
});
test("uncalculated actions remain unknown instead of becoming zero monetary obligations", () => {
  const value = fixture(); Object.assign(value.assets[0]!, { calculatedActions: 0, uncalculatedActions: 30, payableMinor: null, paidMinor: null });
  assert.equal(validatedOverviewSummary(value).assets[0]!.payableMinor, null);
  Object.assign(value.assets[0]!, { payableMinor: "0" }); assert.throws(() => validatedOverviewSummary(value));
});
test("overview rejects partial aggregates, inconsistent asset/queue facts and invented funding balances", () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => { value.completeAggregates = false; },
    (value: ReturnType<typeof fixture>) => { value.queue.total = 9; },
    (value: ReturnType<typeof fixture>) => { value.assets[0]!.network = "SOLANA_DEVNET"; },
    (value: ReturnType<typeof fixture>) => { value.assets[0]!.calculatedActions = 19; },
    (value: ReturnType<typeof fixture>) => { value.assets[0]!.payableMinor = "1e21"; },
    (value: ReturnType<typeof fixture>) => { value.activeInstruments = Number.MAX_SAFE_INTEGER + 1; },
    (value: ReturnType<typeof fixture>) => { value.queue.items = []; },
    (value: ReturnType<typeof fixture>) => { value.queue.items[0]!.instrument.network = "SOLANA_DEVNET"; },
    (value: ReturnType<typeof fixture>) => { value.queue.items[0]!.blockchainTransactions = [null]; },
    (value: ReturnType<typeof fixture>) => { value.queue.items[0]!.hasUnknownConfirmation = true; value.unknownOperations = 0; },
  ]) { const value = fixture(); mutate(value); assert.throws(() => validatedOverviewSummary(value)); }
  assert.throws(() => validatedOverviewSummary({ ...fixture(), financing: { source: "NOT_QUERIED", availableMinor: "0", reservedMinor: null } }));
});
test("asset decimals and money above safe floating point remain exact in RU and EN", () => {
  assert.equal(formatOverviewAmount("9007199254740993123456", 6, "KZT_TEST", "en"), "9,007,199,254,740,993.123456 KZT-Test");
  assert.equal(formatOverviewAmount("123456789", 8, "TEST_USD", "en"), "1.23456789 TEST_USD");
  assert.equal(formatOverviewAmount("35", 0, "TEST_BOND", "en"), "35 TEST_BOND");
  assert.match(formatOverviewAmount("1750000000", 6, "KZT_TEST", "ru"), /1\s750,00 KZT-Test/);
  for (const value of ["-1", "1.1", "1e6", "01"]) assert.throws(() => formatOverviewAmount(value, 6, "KZT_TEST", "en"));
  assert.throws(() => formatOverviewAmount("1", 19, "TEST", "en"));
});
