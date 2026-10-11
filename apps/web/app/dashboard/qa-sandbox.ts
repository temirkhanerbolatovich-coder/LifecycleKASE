import { calculateCouponBreakdown, calculateEarlyRedemption, calculatePrincipal } from "@lifecycle-kase/domain/financial";
import type { CorporateActionView } from "./action-workflow";
import type { EntitlementsView } from "./entitlement-workflow";
import { OperatorApiError } from "./operator-api";
import { encodeBase58, isActionId } from "./snapshot-workflow";
import { REGISTRY_REVIEW_REASONS } from "./investor-registry-workflow";

export type QaActor = "ISSUER" | "APPROVER" | "AUDITOR";
export type QaActionStep = "SCHEDULE" | "SNAPSHOT" | "CALCULATE" | "SUBMIT" | "APPROVE" | "RETURN" | "REJECT" |
  "FUND" | "RESERVE" | "PAY" | "FINALIZE" | "CANCEL" | "MISS_WINDOW";

const syntheticAddress = (number: number) => encodeBase58(Uint8Array.from({ length: 32 }, (_, index) => (number + index) % 256));
export const QA_ISSUER = syntheticAddress(70);
export const QA_APPROVER = syntheticAddress(110);
export const QA_FRESH_INSTRUMENT_ID = "10000000-0000-4000-8000-000000000001";
export const QA_ACTION_IDS = {
  coupon: "20000000-0000-4000-8000-000000000001",
  partial: "20000000-0000-4000-8000-000000000002",
  maturity: "20000000-0000-4000-8000-000000000003"
};
const historicalInstrumentId = "10000000-0000-4000-8000-000000000002";
const MINOR = 1_000_000n;
const MAX_DB = (1n << 63n) - 1n;
const copy = <T>(value: T): T => structuredClone(value);
const asRecord = (value: object): Record<string, unknown> => value as unknown as Record<string, unknown>;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

type QaWallet = { id: string; address: string; status: string; registryVersion: number; network: string; verifiedAt: string | null;
  revokedAt: string | null; revocationReasonCode: string | null };
type QaInvestor = { id: string; displayName: string; externalReference: string | null; countryCode: string; type: string;
  status: string; registryVersion: number; kycStatus: string; eligibilityStatus: string; eligibilityReasonCode: string | null;
  eligibilityReviewedAt: string | null; _count: { wallets: number }; wallets: QaWallet[] };
type QaInstrument = { id: string; name: string; ticker: string; network: string; status: string;
  issuerAuthority: string; corporateActionAuthority: string; faceValueMinor: string; couponRateBps: number;
  paymentsPerYear: number; issueAt: string; maturityAt: string; totalSupply: string; circulatingSupply: string;
  programId: string | null; mintAddress: string | null; issuer: { legalName: string };
  settlementAsset: { code: string; name: string; mintAddress: string | null; disclaimer: string };
  treasuryBalanceMinor: string; balances: Record<string, string> };
type QaAction = CorporateActionView & { holderBalances: Record<string, string>; entitlements: EntitlementsView["items"];
  reservedMinor: string; totalAmountMinor: string; receipt: Record<string, unknown> | null; draftInput: Record<string, unknown> | null };
type QaLog = { id: string; createdAt: string; corporateActionId: string | null; instrumentId: string | null;
  entityType: string; entityId: string; event: string; actorWallet: string; metadataJson: Record<string, unknown> };
type QaTransaction = { id: string; createdAt: string; corporateActionId: string; instrumentId: string;
  operationType: string; status: string; signature: null; lastErrorCode: null; requiredSigner: string; simulation: true };
type QaChallenge = { challengeId: string; investorId: string; walletId: string; walletAddress: string; nonce: string; message: string };
type State = { actor: QaActor; instruments: QaInstrument[]; investors: QaInvestor[]; actions: QaAction[];
  audit: QaLog[]; transactions: QaTransaction[]; challenges: QaChallenge[]; receivedCashMinor: Record<string, string> };

function fail(code: string, message: string, status = 409): never { throw new OperatorApiError(code, status, message); }
function text(value: unknown, name: string, maximum: number, minimum = 1): string {
  if (typeof value !== "string" || value.trim().length < minimum || value.trim().length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("INVALID_REQUEST", `${name}: укажите от ${minimum} до ${maximum} символов.`, 400);
  }
  return value.trim();
}
function countryCode(value: unknown): string {
  const raw = text(value, "Страна", 2, 2);
  if (!/^[A-Za-z]{2}$/.test(raw)) fail("INVALID_REQUEST", "Некорректная страна инвестора.", 400);
  return raw.toUpperCase();
}
function input(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    fail("INVALID_REQUEST", "Нужен JSON с разрешёнными полями.", 400);
  }
  return body as Record<string, unknown>;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.000)?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) {
    fail("INVALID_REQUEST", "Укажите точное время UTC с целыми секундами.", 400);
  }
  return new Date(value).toISOString();
}
function minor(value: unknown, wholeOnly = false): string {
  if (typeof value !== "string" || !(wholeOnly ? /^[1-9][0-9]{0,12}$/ : /^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/).test(value)) {
    fail("INVALID_REQUEST", "Укажите положительную сумму KZT-Test, максимум 6 знаков после точки.", 400);
  }
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole!) * MINOR + BigInt(fraction.padEnd(6, "0"));
  if (result <= 0n || result > MAX_DB) fail("INVALID_REQUEST", "Сумма вне допустимого диапазона.", 400);
  return result.toString();
}
function publicKey(value: unknown): string {
  const result = text(value, "Адрес", 44, 32);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of result) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) fail("INVALID_REQUEST", "Адрес должен быть Solana public key.", 400);
    number = number * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(32);
  for (let index = 31; index >= 0; index--) { bytes[index] = Number(number & 255n); number >>= 8n; }
  if (number !== 0n || encodeBase58(bytes) !== result) fail("INVALID_REQUEST", "Адрес должен содержать ровно 32 байта.", 400);
  return result;
}
function issuer(state: State) {
  if (state.actor !== "ISSUER") fail("QA_ROLE_REQUIRED", "Это действие доступно эмитенту QA.", 403);
}
function registryReviewInput(body: unknown, field: "decision" | "status") {
  const value = input(body, [field, "expectedVersion", "reasonCode"]);
  const version = value["expectedVersion"];
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || version >= 2_147_483_647 ||
      !["REGISTRY_CORRECTION", "PERIODIC_REVIEW", "SECURITY_CONCERN", "OWNER_REQUEST"].includes(String(value["reasonCode"]))) {
    fail("INVALID_REQUEST", "Registry review requires a valid version and fixed reason code.", 400);
  }
  return { target: value[field], expectedVersion: version, reasonCode: String(value["reasonCode"]) };
}
function approver(state: State) {
  if (state.actor !== "APPROVER") fail("QA_ROLE_REQUIRED", "Решение принимает отдельный согласующий QA.", 403);
}
const actorAddress = (state: State) => state.actor === "APPROVER" ? QA_APPROVER : QA_ISSUER;
function instrument(state: State, instrumentId: string) {
  const row = state.instruments.find(value => value.id === instrumentId);
  if (!row) fail("INSTRUMENT_NOT_FOUND", "Инструмент не найден.", 404);
  return row;
}
function action(state: State, actionId: string) {
  const row = state.actions.find(value => value.id === actionId);
  if (!row) fail("ACTION_NOT_FOUND", "Действие не найдено.", 404);
  return row;
}
function investor(state: State, investorId: string) {
  const row = state.investors.find(value => value.id === investorId);
  if (!row) fail("INVESTOR_NOT_FOUND", "Инвестор не найден.", 404);
  return row;
}
function investorView(row: QaInvestor): QaInvestor {
  return { ...row, wallets: [...row.wallets].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 20) };
}
function audit(state: State, event: string, entityType: string, entityId: string, metadataJson: Record<string, unknown> = {}, actionId: string | null = null) {
  const row = actionId ? action(state, actionId) : null;
  state.audit.push({ id: id(), createdAt: now(), corporateActionId: actionId, instrumentId: row?.instrumentId ?? (entityType === "Instrument" ? entityId : null),
    entityType, entityId, event, actorWallet: actorAddress(state), metadataJson: { simulation: true, onChain: false, ...metadataJson } });
}
function transaction(state: State, row: QaAction, operationType: string) {
  // No invented chain signature: a QA result is a local simulation, never Solana evidence.
  state.transactions.push({ id: id(), createdAt: now(), corporateActionId: row.id, instrumentId: row.instrumentId,
    operationType, status: "QA_SIMULATED", signature: null, lastErrorCode: null, requiredSigner: actorAddress(state), simulation: true });
}
function eligible(state: State, investorId: string, address?: string) {
  const row = investor(state, investorId);
  return row.status === "ACTIVE" && row.eligibilityStatus === "ELIGIBLE" && row.wallets.some(wallet => wallet.status === "ACTIVE" &&
    wallet.verifiedAt !== null && wallet.revokedAt === null && (!address || wallet.address === address));
}
function requireEligible(state: State, row: QaAction) {
  if (row.entitlements.some(item => item.amountMinor !== "0" && !eligible(state, item.investorId, item.settlementWalletAddress))) {
    fail("ELIGIBILITY_BLOCKED", "Инвестор или выбранный кошелёк больше не допущен. Исполнение заблокировано.");
  }
}
function view(state: State, row: QaAction): Record<string, unknown> {
  const current = instrument(state, row.instrumentId);
  const { holderBalances: _holders, entitlements: _entitlements, reservedMinor: _reserved, totalAmountMinor: _total, receipt: _receipt, draftInput: _draft, ...base } = row;
  return asRecord({ ...base, instrument: { ...base.instrument, status: current.status },
    events: state.audit.filter(event => event.corporateActionId === row.id).map(event => ({ id: event.id, event: event.event,
      actorWallet: event.actorWallet, createdAt: event.createdAt })),
    qa: { simulation: true, reservedMinor: row.reservedMinor, treasuryBalanceMinor: current.treasuryBalanceMinor,
      totalAmountMinor: row.totalAmountMinor, paid: row.entitlements.filter(item => ["PAID", "REDEEMED"].includes(item.status)).length,
      payable: row.entitlements.filter(item => item.amountMinor !== "0").length, receipt: row.receipt } });
}
function entitlements(state: State, row: QaAction): Record<string, unknown> {
  const result: EntitlementsView = { actionId: row.id, actionVersion: row.version, actionType: row.type, status: row.status,
    approvedById: ["APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "FINALIZED"].includes(row.status) ? "qa-approver" : null,
    approvedAt: null, reviewNote: row.reviewNote, totalEntitlementMinor: row.totalAmountMinor,
    eligibleHolders: row.entitlements.filter(item => item.amountMinor !== "0").length,
    onchainRegistrationEnabled: false, onchainCalculationFinalized: false, actionApprovalEnabled: false, onchainPending: null,
    items: row.entitlements.map(item => ({ ...item, currentEligibility: { eligible: eligible(state, item.investorId, item.settlementWalletAddress),
      reason: eligible(state, item.investorId, item.settlementWalletAddress) ? "QA: допуск подтверждён" : "QA: допуск или кошелёк отозван" } })),
    investors: Object.entries(row.holderBalances).map(([investorId, balance]) => { const current = investor(state, investorId); return {
      investorId, displayName: current.displayName, balance, snapshotEligibility: "ELIGIBLE",
      receiverWallets: current.wallets.filter(wallet => wallet.status === "ACTIVE" && wallet.verifiedAt !== null && wallet.revokedAt === null).map(wallet => wallet.address)
    }; }) };
  return asRecord(result);
}
function calculate(state: State, row: QaAction) {
  const current = instrument(state, row.instrumentId);
  const items: EntitlementsView["items"] = Object.entries(row.holderBalances).map(([investorId, balance]) => {
    const holder = investor(state, investorId);
    const receiver = holder.wallets.find(wallet => wallet.status === "ACTIVE" && wallet.verifiedAt !== null && wallet.revokedAt === null);
    if (!receiver || !eligible(state, investorId)) fail("ELIGIBILITY_BLOCKED", "Для расчёта требуется активный подтверждённый кошелёк и допуск.");
    const coupon = calculateCouponBreakdown({ balance: BigInt(balance), faceValueMinor: BigInt(current.faceValueMinor),
      couponRateBps: current.couponRateBps, paymentsPerYear: current.paymentsPerYear });
    const early = row.type === "EARLY_REDEMPTION" ? calculateEarlyRedemption({ balance: BigInt(balance),
      percentageBps: row.redemptionPercentageBps!, redemptionPriceMinor: BigInt(row.redemptionPriceMinor!) }) : null;
    const amount = early?.amountMinor ?? (row.type === "BOND_REDEMPTION" ? calculatePrincipal({ balance: BigInt(balance), faceValueMinor: BigInt(current.faceValueMinor) }) + coupon.amountMinor : coupon.amountMinor);
    if (amount > MAX_DB) fail("CALCULATION_RANGE", "Расчёт превышает допустимый диапазон.");
    return { id: id(), investorId, onchainPda: null, settlementWalletAddress: receiver.address, balanceAtRecordDate: balance,
      amountMinor: amount.toString(), tokensToRedeem: (early?.redeemedTokens ?? (row.type === "BOND_REDEMPTION" ? BigInt(balance) : 0n)).toString(),
      status: amount === 0n ? "NOT_ELIGIBLE_ZERO_ROUNDING" : "CALCULATED", eligibilityReason: "QA_LOCAL_ELIGIBLE", formulaVersion: "integer-entitlements-v1",
      calculationInputs: { snapshotHash: row.snapshot!.snapshotHash, balance, faceValueMinor: current.faceValueMinor,
        couponRateBps: current.couponRateBps, paymentsPerYear: current.paymentsPerYear, redemptionPercentageBps: row.redemptionPercentageBps,
        redemptionPriceMinor: row.redemptionPriceMinor, roundingRemainder: (early ? BigInt(balance) * BigInt(row.redemptionPercentageBps!) % 10000n : coupon.remainder).toString(),
        denominator: early ? "10000" : coupon.denominator.toString() }, currentEligibility: { eligible: true, reason: "QA_LOCAL_ELIGIBLE" } };
  });
  const total = items.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
  if (total < 0n || total > MAX_DB) fail("CALCULATION_RANGE", "Итог расчёта выходит за допустимый диапазон.");
  row.entitlements = items; row.totalAmountMinor = total.toString();
}

function advance(state: State, actionId: string, step: QaActionStep, note?: string): Record<string, unknown> {
  const row = action(state, actionId); const current = instrument(state, row.instrumentId);
  const review = ["APPROVE", "RETURN", "REJECT"].includes(step);
  if (review) approver(state); else issuer(state);
  const requireStatus = (...statuses: string[]) => { if (!statuses.includes(row.status)) fail("QA_STEP_NOT_ALLOWED", `Шаг ${step} недоступен для ${row.status}.`); };
  switch (step) {
    case "SCHEDULE":
      requireStatus("DRAFT"); if (current.status !== "ACTIVE") fail("INSTRUMENT_NOT_ACTIVE", "Нужен активный QA-инструмент.");
      row.status = "SCHEDULED"; transaction(state, row, "ACTION_SCHEDULE"); break;
    case "SNAPSHOT": {
      requireStatus("SCHEDULED");
      // QA controls advance simulated time explicitly; they do not assert a real record-date capture.
      if (state.actions.some(other => other.id !== row.id && other.instrumentId === row.instrumentId &&
          ["SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW", "APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "RETURNED_FOR_REVISION"].includes(other.status))) {
        fail("ACTION_CONFLICT", "Завершите другое действие этого инструмента перед новым snapshot.");
      }
      if (current.status !== "ACTIVE" || BigInt(current.circulatingSupply) === 0n) fail("INSTRUMENT_NOT_ACTIVE", "У инструмента нет активных токенов.");
      row.holderBalances = Object.fromEntries(Object.entries(current.balances).filter(([investorId, balance]) => BigInt(balance) > 0n && eligible(state, investorId)));
      const total = Object.values(row.holderBalances).reduce((sum, balance) => sum + BigInt(balance), 0n);
      if (total !== BigInt(current.circulatingSupply)) fail("ELIGIBILITY_BLOCKED", "Не все держатели supply допущены. Проверьте реестр.");
      row.snapshot = { id: id(), status: "FINALIZED", snapshotHash: "ab".repeat(32), solanaSlot: String(1000 + state.transactions.length),
        recordAt: row.recordAt, blockTime: row.recordAt, totalBalance: total.toString(), investorCount: Object.keys(row.holderBalances).length,
        walletCount: Object.keys(row.holderBalances).length };
      row.status = "SNAPSHOT_CREATED"; transaction(state, row, "SNAPSHOT_REGISTER"); break;
    }
    case "CALCULATE":
      requireStatus("SNAPSHOT_CREATED", "RETURNED_FOR_REVISION"); calculate(state, row); row.status = "CALCULATED"; break;
    case "SUBMIT":
      requireStatus("CALCULATED"); requireEligible(state, row);
      if (BigInt(row.totalAmountMinor) === 0n) fail("CALCULATION_INCOMPLETE", "Все начисления округлились до нуля. Согласование и резерв недоступны. Расчёт сохранён; проверьте условия и округление.");
      row.status = "UNDER_REVIEW"; break;
    case "FUND": {
      requireStatus("UNDER_REVIEW");
      const deficit = BigInt(row.totalAmountMinor) - BigInt(row.reservedMinor) - BigInt(current.treasuryBalanceMinor);
      if (deficit <= 0n) fail("QA_ALREADY_FUNDED", "Бюджет уже достаточен; повторное пополнение не требуется.");
      current.treasuryBalanceMinor = (BigInt(current.treasuryBalanceMinor) + deficit).toString(); transaction(state, row, "COUPON_FUNDING"); break;
    }
    case "RESERVE":
      requireStatus("UNDER_REVIEW"); requireEligible(state, row);
      if (row.reservedMinor !== "0") fail("QA_ALREADY_RESERVED", "Резерв уже создан.");
      if (BigInt(current.treasuryBalanceMinor) < BigInt(row.totalAmountMinor)) fail("COUPON_RESERVE_REQUIRED", "Сначала пополните бюджет.");
      current.treasuryBalanceMinor = (BigInt(current.treasuryBalanceMinor) - BigInt(row.totalAmountMinor)).toString();
      row.reservedMinor = row.totalAmountMinor; transaction(state, row, "ACTION_RESERVE"); break;
    case "APPROVE":
      requireStatus("UNDER_REVIEW"); requireEligible(state, row);
      if (row.reservedMinor !== row.totalAmountMinor) fail("COUPON_RESERVE_REQUIRED", "Для согласования нужен полный резерв.");
      row.reviewNote = text(note ?? "QA: a separate approver reviewed the calculation", "Комментарий", 1000, 3);
      row.status = "APPROVED"; row.entitlements.forEach(item => { if (item.amountMinor !== "0") item.status = "READY"; }); transaction(state, row, "ACTION_APPROVAL"); break;
    case "RETURN":
    case "REJECT":
      requireStatus("UNDER_REVIEW"); row.reviewNote = text(note, "Причина", 1000, 3);
      current.treasuryBalanceMinor = (BigInt(current.treasuryBalanceMinor) + BigInt(row.reservedMinor)).toString(); row.reservedMinor = "0";
      row.status = step === "RETURN" ? "RETURNED_FOR_REVISION" : "REJECTED"; break;
    case "PAY": {
      requireStatus("APPROVED", "EXECUTING", "PARTIALLY_SETTLED"); requireEligible(state, row);
      const next = row.entitlements.find(item => item.status === "READY" && item.amountMinor !== "0");
      if (!next) fail("ENTITLEMENT_ALREADY_EXECUTED", "Все начисления уже исполнены. Повторная выплата запрещена.");
      if (BigInt(row.reservedMinor) < BigInt(next.amountMinor)) fail("COUPON_RESERVE_REQUIRED", "В резерве недостаточно средств.");
      const burn = BigInt(next.tokensToRedeem); const balance = BigInt(current.balances[next.investorId] ?? "0");
      if (burn > balance || burn > BigInt(current.circulatingSupply)) fail("REDEMPTION_BALANCE_CHANGED", "Остатки изменились; выплата и сжигание заблокированы вместе.");
      row.reservedMinor = (BigInt(row.reservedMinor) - BigInt(next.amountMinor)).toString();
      state.receivedCashMinor[next.settlementWalletAddress] = (BigInt(state.receivedCashMinor[next.settlementWalletAddress] ?? "0") + BigInt(next.amountMinor)).toString();
      current.balances[next.investorId] = (balance - burn).toString(); current.circulatingSupply = (BigInt(current.circulatingSupply) - burn).toString();
      next.status = row.type === "COUPON_PAYMENT" ? "PAID" : "REDEEMED";
      row.status = row.entitlements.some(item => item.status === "READY") ? "PARTIALLY_SETTLED" : "SETTLED";
      transaction(state, row, row.type === "COUPON_PAYMENT" ? "COUPON_PAYMENT" : row.type); break;
    }
    case "FINALIZE":
      requireStatus("SETTLED");
      if (row.reservedMinor !== "0" || row.entitlements.some(item => item.amountMinor !== "0" && !["PAID", "REDEEMED"].includes(item.status))) {
        fail("QA_SETTLEMENT_INCOMPLETE", "Проверьте все выплаты и остаток резерва.");
      }
      if (row.type === "BOND_REDEMPTION" && current.circulatingSupply !== "0") fail("REDEMPTION_SUPPLY_CHANGED", "Для полного погашения supply должен стать нулевым.");
      row.status = "FINALIZED"; if (row.type === "BOND_REDEMPTION") current.status = "REDEEMED";
      row.receipt = { mode: "UI_SIMULATION", simulation: true, onChain: false, no_chain_transaction: true,
        disclaimer: "QA sandbox: synthetic results, no Solana transaction or financial settlement.",
        actionId: row.id, actionType: row.type, amountMinor: row.totalAmountMinor, tokensRedeemed: row.entitlements.reduce((sum, item) => sum + BigInt(item.tokensToRedeem), 0n).toString(),
        finalSupply: current.circulatingSupply, items: copy(row.entitlements), createdAt: now() };
      transaction(state, row, row.type === "COUPON_PAYMENT" ? "COUPON_FINALIZE" : "REDEMPTION_FINALIZE"); break;
    case "CANCEL":
      requireStatus("DRAFT", "SCHEDULED"); row.reviewNote = text(note, "Причина отмены", 1000, 3); row.status = "CANCELLED"; break;
    case "MISS_WINDOW": requireStatus("SCHEDULED"); row.status = "SNAPSHOT_MISSED"; break;
    default: fail("QA_STEP_NOT_ALLOWED", "Неизвестный шаг QA.", 400);
  }
  row.version++; audit(state, `QA_${step}`, "CorporateAction", row.id, { status: row.status }, row.id);
  return view(state, row);
}

function newAction(current: QaInstrument, actionId: string, type: string, recordAt: string, executeAt: string): QaAction {
  return { id: actionId, version: 0, instrumentId: current.id, type, intent: `QA: ${type} — synthetic scenario`, sourceType: "MANUAL",
    sourceReference: "QA-FIXTURE", sourceDocument: null, sourceTimestamp: null, recordAt, executeAt, status: "DRAFT", reviewNote: null,
    couponExecutionEnabled: false, redemptionExecutionEnabled: false, redemptionPercentageBps: type === "EARLY_REDEMPTION" ? 2000 : null,
    redemptionPriceMinor: type === "EARLY_REDEMPTION" ? "1000000000" : null,
    instrument: { id: current.id, ticker: current.ticker, name: current.name, issuerAuthority: QA_ISSUER,
      corporateActionAuthority: QA_ISSUER, network: "SOLANA_LOCALNET" }, snapshot: null, blockchainTransactions: [], events: [],
    holderBalances: {}, entitlements: [], reservedMinor: "0", totalAmountMinor: "0", receipt: null, draftInput: null };
}
function seed(): State {
  const state: State = { actor: "ISSUER", investors: [], instruments: [], actions: [], audit: [], transactions: [], challenges: [], receivedCashMinor: {} };
  for (const [index, balance] of ["10", "20", "5"].entries()) {
    state.investors.push({ id: `30000000-0000-4000-8000-00000000000${index + 1}`, displayName: `QA Investor ${index + 1} · ${balance} bond`,
      externalReference: `QA-${index + 1}`, countryCode: "KZ", type: index === 1 ? "INSTITUTIONAL" : "INDIVIDUAL", status: "ACTIVE", registryVersion: 1,
      kycStatus: "NOT_STARTED", eligibilityStatus: "ELIGIBLE", eligibilityReasonCode: "DEMO_CRITERIA_MET", eligibilityReviewedAt: now(), _count: { wallets: 1 },
      wallets: [{ id: `40000000-0000-4000-8000-00000000000${index + 1}`, address: syntheticAddress(index + 20), status: "ACTIVE", registryVersion: 1, network: "SOLANA_LOCALNET",
        verifiedAt: now(), revokedAt: null, revocationReasonCode: null }] });
  }
  const baseTime = Math.floor(Date.now() / 1000) * 1000;
  const maturityAt = new Date(baseTime + 365 * 86400000).toISOString();
  const fresh: QaInstrument = { id: QA_FRESH_INSTRUMENT_ID, name: "QA Bond · new lifecycle", ticker: "QA-BOND", network: "SOLANA_LOCALNET", status: "ACTIVE",
    issuerAuthority: QA_ISSUER, corporateActionAuthority: QA_ISSUER, faceValueMinor: "1000000000", couponRateBps: 1000, paymentsPerYear: 2,
    issueAt: new Date(baseTime - 86400000).toISOString(), maturityAt, totalSupply: "35", circulatingSupply: "35", programId: syntheticAddress(150), mintAddress: syntheticAddress(180),
    issuer: { legalName: "QA Synthetic Issuer" }, settlementAsset: { code: "KZT_TEST", name: "KZT-Test", mintAddress: syntheticAddress(190), disclaimer: "QA: synthetic data, not money." },
    treasuryBalanceMinor: "0", balances: Object.fromEntries(state.investors.map((row, index) => [row.id, ["10", "20", "5"][index]!])) };
  state.instruments.push(fresh, { ...copy(fresh), id: historicalInstrumentId, ticker: "QA-HISTORY", name: "QA Bond · completed lifecycle" });
  const record = new Date(baseTime + 300000).toISOString(); const execute = new Date(baseTime + 900000).toISOString();
  for (const [key, type] of [["coupon", "COUPON_PAYMENT"], ["partial", "EARLY_REDEMPTION"], ["maturity", "BOND_REDEMPTION"]] as const) {
    state.actions.push(newAction(fresh, QA_ACTION_IDS[key], type, record, key === "maturity" ? maturityAt : execute));
    const historical = newAction(state.instruments[1]!, `20000000-0000-4000-8000-00000000001${state.actions.length}`, type, record, key === "maturity" ? maturityAt : execute);
    state.actions.push(historical);
    for (const step of ["SCHEDULE", "SNAPSHOT", "CALCULATE", "SUBMIT", "FUND", "RESERVE", "APPROVE", "PAY", "PAY", "PAY", "FINALIZE"] as QaActionStep[]) {
      state.actor = step === "APPROVE" ? "APPROVER" : "ISSUER"; advance(state, historical.id, step);
    }
  }
  state.actor = "ISSUER"; return state;
}

/** An isolated mutable QA model. Nothing here authenticates, calls an API/RPC, or signs a real transaction. */
export function createQaSandbox() {
  let state = seed();
  function mutate(task: (draft: State) => Record<string, unknown>): Promise<Record<string, unknown>> {
    try { const draft = copy(state); const result = task(draft); state = draft; return Promise.resolve(copy(result)); }
    catch (error) { return Promise.reject(error); }
  }
  function page(rows: { id: string }[], query: URLSearchParams, cursorRegistry?: { id: string }[]) {
    if ([...query.keys()].some(key => !["limit", "cursor", "instrumentId"].includes(key)) || [...query.keys()].some(key => query.getAll(key).length > 1)) fail("INVALID_REQUEST", "Неизвестные параметры запроса.", 400);
    const limit = query.get("limit") ?? "20"; const cursor = query.get("cursor");
    if (!/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100 || cursor !== null && !isActionId(cursor)) fail("INVALID_REQUEST", "Некорректная пагинация.", 400);
    if (cursor && cursorRegistry) {
      const anchor = cursorRegistry.findIndex(row => row.id.toLowerCase() === cursor.toLowerCase());
      if (anchor < 0) fail("INVALID_REQUEST", "Курсор не найден.", 400);
      const followingIds = new Set(cursorRegistry.slice(anchor + 1).map(row => row.id));
      rows = rows.filter(row => followingIds.has(row.id));
    }
    const start = cursor && !cursorRegistry ? rows.findIndex(row => row.id === cursor) + 1 : 0;
    if (cursor && !cursorRegistry && start === 0) fail("INVALID_REQUEST", "Курсор не найден.", 400);
    const items = rows.slice(start, start + Number(limit));
    return { items, nextCursor: start + Number(limit) < rows.length ? items.at(-1)!.id : null };
  }
  function read(path: string, query: URLSearchParams): Record<string, unknown> {
    if (path === "/api/v1/corporate-actions") {
      const instrumentId = query.get("instrumentId");
      if (instrumentId && !isActionId(instrumentId)) fail("INVALID_REQUEST", "Некорректный UUID инструмента.", 400);
      return page(state.actions.filter(row => !instrumentId || row.instrumentId === instrumentId).map(row => ({ ...view(state, row), id: row.id })), query);
    }
    if (query.has("instrumentId")) fail("INVALID_REQUEST", "Фильтр instrumentId доступен только реестру действий.", 400);
    if (path === "/api/v1/instruments") return page(state.instruments, query);
    if (path === "/api/v1/investors") {
      const search = query.get("search")?.trim() ?? "";
      if (query.getAll("search").length > 1 || search.length > 200 || /[\u0000-\u001f\u007f]/.test(query.get("search") ?? "")) fail("INVALID_REQUEST", "Некорректный поиск инвесторов.", 400);
      const pagination = new URLSearchParams(query); pagination.delete("search");
      const needle = search.toLowerCase();
      return page(state.investors.filter(row => !search || row.displayName.toLowerCase().includes(needle) ||
        (row.externalReference ?? "").toLowerCase().includes(needle) || row.id.toLowerCase() === needle ||
        row.wallets.some(wallet => wallet.address.includes(search))).map(investorView), pagination, state.investors);
    }
    const investorMatch = /^\/api\/v1\/investors\/([0-9a-f-]+)(\/wallets)?$/i.exec(path);
    if (investorMatch) {
      if (!isActionId(investorMatch[1]!)) fail("INVALID_REQUEST", "Некорректный UUID инвестора.", 400);
      const holder = investor(state, investorMatch[1]!);
      if (investorMatch[2]) return page([...holder.wallets].sort((a, b) => a.id.localeCompare(b.id)), query);
      if (query.size) fail("INVALID_REQUEST", "Этот запрос не принимает параметры.", 400);
      return asRecord(investorView(holder));
    }
    if (path === "/api/v1/audit") return page([...state.audit].reverse(), query);
    if (path === "/api/v1/transactions") return page([...state.transactions].reverse(), query);
    if (query.size !== 0) fail("INVALID_REQUEST", "Этот запрос не принимает параметры.", 400);
    if (path === "/api/v1/program-upgrade") return { enabled: false, simulation: true };
    const match = /^\/api\/v1\/corporate-actions\/([0-9a-f-]+)(\/entitlements)?$/i.exec(path);
    if (match) { const row = action(state, match[1]!); return match[2] ? entitlements(state, row) : view(state, row); }
    fail("QA_ROUTE_UNAVAILABLE", "Этот маршрут недоступен в QA. Реальный вход, подпись кошелька и Solana RPC проверяются отдельно.", 404);
  }
  function write(draft: State, path: string, body: unknown): Record<string, unknown> {
    issuer(draft);
    if (path === "/api/v1/instruments") {
      const value = input(body, ["issuerLegalName", "name", "ticker", "faceValueKzt", "couponRateBps", "paymentsPerYear", "issueAt", "maturityAt"]);
      const ticker = text(value["ticker"], "Тикер", 20, 2).toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9.-]{1,19}$/.test(ticker)) fail("INVALID_REQUEST", "Недопустимый тикер.", 400);
      if (draft.instruments.some(row => row.ticker === ticker)) fail("INSTRUMENT_CONFLICT", "Тикер уже зарегистрирован.");
      const couponRateBps = value["couponRateBps"]; const paymentsPerYear = value["paymentsPerYear"];
      if (!Number.isSafeInteger(couponRateBps) || Number(couponRateBps) < 0 || Number(couponRateBps) > 100000 || ![1, 2, 4].includes(Number(paymentsPerYear)) || typeof paymentsPerYear !== "number") fail("INVALID_REQUEST", "Некорректная ставка или частота купона.", 400);
      const issueAt = date(value["issueAt"]); const maturityAt = date(value["maturityAt"]);
      if (issueAt >= maturityAt) fail("INVALID_REQUEST", "Погашение должно быть позже выпуска.", 400);
      const row: QaInstrument = { id: id(), name: text(value["name"], "Название", 250, 2), ticker, network: "SOLANA_LOCALNET", status: "DRAFT",
        issuerAuthority: QA_ISSUER, corporateActionAuthority: QA_ISSUER, faceValueMinor: minor(value["faceValueKzt"], true), couponRateBps: Number(couponRateBps), paymentsPerYear,
        issueAt, maturityAt, totalSupply: "35", circulatingSupply: "0", programId: null, mintAddress: null, treasuryBalanceMinor: "0", balances: {},
        issuer: { legalName: text(value["issuerLegalName"], "Эмитент", 250, 2) }, settlementAsset: { code: "KZT_TEST", name: "KZT-Test", mintAddress: null, disclaimer: "QA: synthetic asset, not money." } };
      draft.instruments.push(row); audit(draft, "INSTRUMENT_DRAFT_CREATED", "Instrument", row.id); return asRecord(row);
    }
    if (path === "/api/v1/investors") {
      const value = input(body, ["displayName", "type", "countryCode", "externalReference"]);
      const country = countryCode(value["countryCode"]);
      if (typeof value["type"] !== "string" || !["INDIVIDUAL", "INSTITUTIONAL"].includes(value["type"])) fail("INVALID_REQUEST", "Некорректная страна или тип инвестора.", 400);
      const externalReference = text(value["externalReference"], "Код", 100);
      if (draft.investors.some(row => row.externalReference === externalReference)) fail("REGISTRY_CONFLICT", "Код инвестора уже существует.");
      const row: QaInvestor = { id: id(), displayName: text(value["displayName"], "Имя", 200), externalReference, countryCode: country, type: String(value["type"]), status: "ACTIVE", registryVersion: 1,
        kycStatus: "NOT_STARTED", eligibilityStatus: "PENDING_REVIEW", eligibilityReasonCode: null, eligibilityReviewedAt: null, _count: { wallets: 0 }, wallets: [] };
      draft.investors.push(row); audit(draft, "INVESTOR_CREATED", "Investor", row.id); return asRecord(row);
    }
    if (path === "/api/v1/corporate-actions") {
      const value = input(body, ["requestId", "instrumentId", "type", "intent", "sourceType", "sourceReference", "sourceDocument", "sourceTimestamp", "recordAt", "executeAt", "redemptionPercentageBps", "redemptionPriceKzt"]);
      if (typeof value["requestId"] !== "string" || !isActionId(value["requestId"]) || typeof value["instrumentId"] !== "string" || !isActionId(value["instrumentId"])) fail("INVALID_REQUEST", "Нужны UUID действия и инструмента.", 400);
      const current = instrument(draft, value["instrumentId"]); const existing = draft.actions.find(row => row.id === value["requestId"]);
      if (existing) {
        const saved = existing.draftInput;
        if (!saved || Object.keys(saved).length !== Object.keys(value).length || Object.entries(value).some(([key, item]) => saved[key] !== item)) {
          fail("ACTION_CONFLICT", "Этот UUID относится к другому черновику.");
        }
        return view(draft, existing);
      }
      if (current.status !== "ACTIVE") fail("INSTRUMENT_NOT_ACTIVE", "Для создания действия нужен активный инструмент.");
      const type = String(value["type"]); if (!["COUPON_PAYMENT", "EARLY_REDEMPTION", "BOND_REDEMPTION"].includes(type)) fail("INVALID_REQUEST", "Неподдерживаемый тип действия.", 400);
      const recordAt = date(value["recordAt"]); const executeAt = date(value["executeAt"]);
      if (Date.parse(recordAt) < Date.now() + 60000) fail("ACTION_RECORD_TOO_SOON", "Фиксация должна быть минимум через минуту.", 400);
      if (recordAt < current.issueAt || recordAt > executeAt || type === "COUPON_PAYMENT" && executeAt > current.maturityAt || type === "EARLY_REDEMPTION" && executeAt >= current.maturityAt || type === "BOND_REDEMPTION" && executeAt < current.maturityAt) fail("INVALID_ACTION_DATES", "Даты не соответствуют условиям инструмента.", 400);
      const row = newAction(current, value["requestId"], type, recordAt, executeAt); row.intent = text(value["intent"], "Цель", 500, 3);
      row.sourceType = String(value["sourceType"] ?? "MANUAL"); if (!["MANUAL", "ISSUER_INSTRUCTION", "EXCHANGE_EVENT", "EXTERNAL_API", "SYSTEM"].includes(row.sourceType)) fail("INVALID_REQUEST", "Неизвестный источник.", 400);
      row.sourceReference = value["sourceReference"] == null || value["sourceReference"] === "" ? null : text(value["sourceReference"], "Источник", 250, 3);
      row.sourceDocument = value["sourceDocument"] == null || value["sourceDocument"] === "" ? null : text(value["sourceDocument"], "Документ", 500, 3);
      row.sourceTimestamp = value["sourceTimestamp"] == null ? null : date(value["sourceTimestamp"]);
      if (type === "EARLY_REDEMPTION") { const percentage = value["redemptionPercentageBps"]; if (!Number.isSafeInteger(percentage) || Number(percentage) < 1 || Number(percentage) > 10000) fail("INVALID_REQUEST", "Доля должна быть от 1 до 10000 bps.", 400);
        row.redemptionPercentageBps = Number(percentage); row.redemptionPriceMinor = minor(value["redemptionPriceKzt"]); }
      else if (value["redemptionPercentageBps"] != null || value["redemptionPriceKzt"] != null) fail("INVALID_REQUEST", "Досрочные параметры разрешены только для EARLY_REDEMPTION.", 400);
      row.draftInput = copy(value); draft.actions.push(row); audit(draft, "CORPORATE_ACTION_DRAFT_CREATED", "CorporateAction", row.id, {}, row.id); return view(draft, row);
    }
    const profileMatch = /^\/api\/v1\/investors\/([0-9a-f-]+)\/profile$/i.exec(path);
    if (profileMatch) {
      if (!isActionId(profileMatch[1]!)) fail("INVALID_REQUEST", "Некорректный UUID инвестора.", 400);
      const fields = ["displayName", "type", "countryCode", "externalReference", "expectedVersion", "reasonCode"];
      const value = input(body, fields);
      if (fields.some(field => !(field in value)) || typeof value["expectedVersion"] !== "number" ||
          !Number.isSafeInteger(value["expectedVersion"]) || Number(value["expectedVersion"]) < 1 || Number(value["expectedVersion"]) >= 2_147_483_647 ||
          !(REGISTRY_REVIEW_REASONS as readonly unknown[]).includes(value["reasonCode"])) fail("INVALID_REQUEST", "Укажите все поля, текущую версию и причину изменения.", 400);
      if (typeof value["type"] !== "string") fail("INVALID_REQUEST", "Некорректный тип инвестора.", 400);
      const profile = { displayName: text(value["displayName"], "Имя", 200), type: value["type"],
        countryCode: countryCode(value["countryCode"]),
        externalReference: value["externalReference"] === null ? null : text(value["externalReference"], "Код", 100) };
      if (!["INDIVIDUAL", "INSTITUTIONAL"].includes(profile.type) || !/^[A-Z]{2}$/.test(profile.countryCode)) fail("INVALID_REQUEST", "Некорректная страна или тип инвестора.", 400);
      const holder = investor(draft, profileMatch[1]!);
      if (!["ACTIVE", "SUSPENDED"].includes(holder.status)) fail("INVESTOR_INACTIVE", "Профиль закрытого инвестора недоступен.");
      if (holder.registryVersion !== value["expectedVersion"]) fail("REGISTRY_CONFLICT", "Concurrent change; refresh before retrying.");
      if (Object.entries(profile).every(([key, result]) => holder[key as keyof typeof profile] === result)) fail("REGISTRY_TRANSITION_INVALID", "Profile is already current.");
      if (profile.externalReference !== null && draft.investors.some(row => row.id !== holder.id && row.externalReference === profile.externalReference)) fail("REGISTRY_CONFLICT", "Код инвестора уже существует.");
      const changedFields = Object.entries(profile).filter(([key, result]) => holder[key as keyof typeof profile] !== result).map(([key]) => key);
      Object.assign(holder, profile); holder.registryVersion++;
      audit(draft, "INVESTOR_PROFILE_UPDATED", "Investor", holder.id, { changedFields,
        previousVersion: value["expectedVersion"], registryVersion: holder.registryVersion, reasonCode: value["reasonCode"], source: "qa-simulation" });
      return asRecord(investorView(holder));
    }
    const reviewMatch = /^\/api\/v1\/investors\/([0-9a-f-]+)\/eligibility\/review$/i.exec(path);
    if (reviewMatch) {
      const holder = investor(draft, reviewMatch[1]!);
      const { target, expectedVersion, reasonCode } = registryReviewInput(body, "decision");
      if (!["ELIGIBLE", "NOT_ELIGIBLE", "SUSPENDED"].includes(String(target))) fail("INVALID_REQUEST", "Eligibility review decision is invalid.", 400);
      if (holder.status !== "ACTIVE") fail("INVESTOR_INACTIVE", "Investor is not active.");
      if (holder.registryVersion !== expectedVersion) fail("REGISTRY_CONFLICT", "Concurrent change; refresh before retrying.");
      if (holder.eligibilityStatus === "PENDING_REVIEW" || holder.eligibilityStatus === target) fail("REGISTRY_TRANSITION_INVALID", "Use initial review for pending eligibility; repeated decisions are not allowed.");
      if (target === "ELIGIBLE" && !holder.wallets.some(wallet => wallet.status === "ACTIVE" && wallet.verifiedAt !== null && wallet.revokedAt === null)) {
        fail("VERIFIED_WALLET_REQUIRED", "An active verified wallet is required for eligibility.");
      }
      const previousEligibilityStatus = holder.eligibilityStatus;
      holder.eligibilityStatus = String(target); holder.eligibilityReviewedAt = now(); holder.registryVersion++;
      holder.eligibilityReasonCode = target === "ELIGIBLE" ? "DEMO_CRITERIA_MET" : target === "NOT_ELIGIBLE" ? "DEMO_CRITERIA_NOT_MET" : "DEMO_ELIGIBILITY_SUSPENDED";
      audit(draft, "INVESTOR_ELIGIBILITY_REVIEWED", "Investor", holder.id, { previousEligibilityStatus,
        eligibilityStatus: target, previousVersion: expectedVersion, registryVersion: holder.registryVersion, reasonCode, source: "qa-simulation" });
      return asRecord(holder);
    }
    const match = /^\/api\/v1\/investors\/([0-9a-f-]+)\/(wallets|eligibility)(?:\/([0-9a-f-]+)\/(revoke|status|verification\/(?:challenge|verify)))?$/i.exec(path);
    if (match) {
      const holder = investor(draft, match[1]!);
      if (match[2] === "eligibility" && !match[3]) {
        const value = input(body, ["decision", "reasonCode"]); const decision = value["decision"];
        if (holder.eligibilityStatus !== "PENDING_REVIEW") fail("ELIGIBILITY_ALREADY_DECIDED", "Допуск уже рассмотрен.");
        if (!["ELIGIBLE", "NOT_ELIGIBLE"].includes(String(decision)) || value["reasonCode"] !== (decision === "ELIGIBLE" ? "DEMO_CRITERIA_MET" : "DEMO_CRITERIA_NOT_MET")) fail("INVALID_REQUEST", "Некорректное решение по допуску.", 400);
        if (decision === "ELIGIBLE" && !holder.wallets.some(wallet => wallet.status === "ACTIVE")) fail("VERIFIED_WALLET_REQUIRED", "Сначала подтвердите кошелёк QA.");
        holder.eligibilityStatus = String(decision); holder.eligibilityReasonCode = String(value["reasonCode"]); holder.eligibilityReviewedAt = now(); holder.registryVersion++;
        audit(draft, "INVESTOR_ELIGIBILITY_DECIDED", "Investor", holder.id); return asRecord(holder);
      }
      if (!match[3]) {
        const value = input(body, ["address"]); const address = publicKey(value["address"]);
        if (draft.investors.some(row => row.wallets.some(wallet => wallet.address === address))) fail("REGISTRY_CONFLICT", "Адрес уже принадлежит инвестору.");
        const wallet: QaWallet = { id: id(), address, status: "PENDING", registryVersion: 1, network: "SOLANA_LOCALNET", verifiedAt: null, revokedAt: null, revocationReasonCode: null };
        holder.wallets.push(wallet); holder._count.wallets++; audit(draft, "INVESTOR_WALLET_ATTACHED", "Investor", holder.id); return asRecord(wallet);
      }
      const wallet = holder.wallets.find(row => row.id === match[3]); if (!wallet) fail("WALLET_NOT_FOUND", "Кошелёк не найден.", 404);
      if (match[4] === "status") {
        const { target, expectedVersion, reasonCode } = registryReviewInput(body, "status");
        if (target !== "ACTIVE" && target !== "BLOCKED") fail("INVALID_REQUEST", "Wallet status must be ACTIVE or BLOCKED.", 400);
        if (holder.status !== "ACTIVE") fail("INVESTOR_INACTIVE", "Investor is not active.");
        if (wallet.registryVersion !== expectedVersion) fail("REGISTRY_CONFLICT", "Concurrent change; refresh before retrying.");
        if (!["ACTIVE", "BLOCKED"].includes(wallet.status) || wallet.verifiedAt === null || wallet.revokedAt !== null) fail("WALLET_STATUS_TRANSITION_INVALID", "Only verified active or blocked wallets can change temporary status.");
        if (wallet.status === target) fail("REGISTRY_TRANSITION_INVALID", "Wallet already has this status.");
        const previousStatus = wallet.status;
        wallet.status = target; wallet.registryVersion++;
        audit(draft, "INVESTOR_WALLET_STATUS_CHANGED", "Wallet", wallet.id, { investorId: holder.id, previousStatus, status: target,
          previousVersion: expectedVersion, registryVersion: wallet.registryVersion, reasonCode, network: wallet.network });
        return asRecord(wallet);
      }
      if (match[4] === "revoke") {
        const value = input(body, ["reasonCode"]);
        if (!["OWNER_REQUEST", "SECURITY_CONCERN", "WALLET_REPLACEMENT", "REGISTRY_CORRECTION"].includes(String(value["reasonCode"]))) fail("INVALID_REQUEST", "Выберите причину отзыва.", 400);
        if (wallet.status === "REVOKED") fail("WALLET_ALREADY_REVOKED", "Кошелёк уже отозван.");
        wallet.status = "REVOKED"; wallet.revokedAt = now(); wallet.revocationReasonCode = String(value["reasonCode"]); wallet.registryVersion++; audit(draft, "INVESTOR_WALLET_REVOKED", "Investor", holder.id); return asRecord(wallet);
      }
      if (wallet.status !== "PENDING") fail("QA_WALLET_STATE", "QA-подтверждение доступно только PENDING-кошельку.");
      if (match[4] === "verification/challenge") {
        input(body, []); const challenge: QaChallenge = { challengeId: id(), investorId: holder.id, walletId: wallet.id, walletAddress: wallet.address,
          nonce: id(), message: "QA synthetic ownership confirmation. No wallet signature, no real proof of ownership." };
        draft.challenges = draft.challenges.filter(row => row.walletId !== wallet.id); draft.challenges.push(challenge); return asRecord(challenge);
      }
      const value = input(body, ["challengeId", "nonce", "signature"]);
      const challenge = draft.challenges.find(row => row.walletId === wallet.id && row.challengeId === value["challengeId"] && row.nonce === value["nonce"]);
      if (!challenge || value["signature"] !== "QA_SIMULATED_PROOF") fail("INVALID_CHALLENGE", "Неверное или уже использованное QA-подтверждение.", 400);
      draft.challenges = draft.challenges.filter(row => row.challengeId !== challenge.challengeId);
      wallet.status = "ACTIVE"; wallet.verifiedAt = now(); wallet.registryVersion++; audit(draft, "QA_WALLET_CONFIRMED", "Investor", holder.id); return asRecord(wallet);
    }
    fail("QA_ROUTE_UNAVAILABLE", "Этот маршрут недоступен в QA. Реальные транзакции и кошелёк проверяются отдельно.", 404);
  }
  return {
    async request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (!path.startsWith("/api/v1/") || path.includes("#") || path.includes("\\")) fail("QA_ROUTE_UNAVAILABLE", "Разрешены только локальные маршруты QA.", 404);
      const url = new URL(path, "https://qa.invalid");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return copy(read(url.pathname, url.searchParams));
      if (method !== "POST" || url.searchParams.size !== 0 || typeof init?.body !== "string" || init.body.length > 20000) fail("INVALID_REQUEST", "Неподдерживаемый запрос QA.", 400);
      let body: unknown; try { body = JSON.parse(init.body); } catch { fail("INVALID_REQUEST", "Некорректный JSON.", 400); }
      return mutate(draft => write(draft, url.pathname, body));
    },
    setActor(actor: QaActor) {
      if (!["ISSUER", "APPROVER", "AUDITOR"].includes(actor)) fail("INVALID_REQUEST", "Неизвестная роль QA.", 400);
      state.actor = actor;
    },
    advanceAction(actionId: string, step: QaActionStep, note?: string) { return mutate(draft => advance(draft, actionId, step, note)); },
    actionReceipt(actionId: string): Record<string, unknown> {
      const row = action(state, actionId);
      if (row.status !== "FINALIZED" || !row.receipt) fail("QA_RECEIPT_UNAVAILABLE", "Сначала завершите все QA-выплаты и итоговый шаг.");
      return copy(row.receipt);
    },
    activateInstrument(instrumentId: string) {
      return mutate(draft => { issuer(draft); const row = instrument(draft, instrumentId);
        if (row.status !== "DRAFT") fail("INSTRUMENT_CONFLICT", "Этот инструмент уже активирован.");
        const holders = draft.investors.filter(holder => eligible(draft, holder.id)).slice(0, 3);
        if (holders.length !== 3) fail("ELIGIBILITY_BLOCKED", "Для QA-распределения нужны три допущенных инвестора.");
        row.status = "ACTIVE"; row.circulatingSupply = "35"; row.programId = syntheticAddress(150); row.mintAddress = syntheticAddress(180);
        row.balances = Object.fromEntries(holders.map((holder, index) => [holder.id, ["10", "20", "5"][index]!]));
        audit(draft, "QA_INSTRUMENT_ACTIVATED", "Instrument", row.id, { allocation: "10/20/5" }); return asRecord(row);
      });
    },
    reset() { state = seed(); },
    exportState() { return copy({ mode: "QA_SANDBOX", simulation: true, onChain: false, ...state }); }
  };
}
