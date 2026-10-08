import { createHash } from "node:crypto";

export class MonitorError extends Error {
  constructor(code, retryAfterSeconds = 0) {
    super(code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function integer(env, key, fallback, min, max) {
  const text = env[key]?.trim();
  const value = text ? Number(text) : fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new MonitorError(`INVALID_${key}`);
  }
  return value;
}

function httpUrl(value, key, originOnly = false) {
  let url;
  try { url = new URL(value); } catch { throw new MonitorError(`INVALID_${key}`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash ||
      (originOnly && (url.pathname !== "/" || url.search))) {
    throw new MonitorError(`INVALID_${key}`);
  }
  return url.href;
}

function publicKey(value, key) {
  if (!value?.trim()) return null;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim())) {
    throw new MonitorError(`INVALID_${key}`);
  }
  return value.trim();
}

export function monitorConfig(env, { requireTelegram = true, requireChat = requireTelegram } = {}) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID?.trim() ?? "";
  if (requireTelegram && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new MonitorError("INVALID_TELEGRAM_BOT_TOKEN");
  }
  if (requireChat && !/^-?[1-9]\d{0,19}$/.test(chatId)) {
    throw new MonitorError("INVALID_TELEGRAM_ADMIN_CHAT_ID");
  }
  const name = env.MONITOR_NAME?.trim() || "LifecycleKASE";
  const environment = env.MONITOR_ENVIRONMENT?.trim() || "staging + owner Localnet";
  if ([name, environment].some((value) => value.length > 100 || /[\r\n\x00-\x1f]/.test(value))) {
    throw new MonitorError("INVALID_MONITOR_LABEL");
  }
  const timeZone = env.MONITOR_TIMEZONE?.trim() || "UTC";
  try { new Intl.DateTimeFormat("ru", { timeZone }); } catch {
    throw new MonitorError("INVALID_MONITOR_TIMEZONE");
  }
  const localnetEnabled = env.MONITOR_LOCALNET_ENABLED?.trim() ?? "true";
  if (!["true", "false"].includes(localnetEnabled)) throw new MonitorError("INVALID_MONITOR_LOCALNET_ENABLED");
  const rpcUrl = localnetEnabled === "true"
    ? httpUrl(env.MONITOR_LOCALNET_RPC_URL || env.SOLANA_RPC_URL || "http://127.0.0.1:8899", "MONITOR_LOCALNET_RPC_URL")
    : null;
  const databaseUrl = env.MONITOR_DATABASE_URL?.trim() || null;
  if (databaseUrl) {
    let url;
    try { url = new URL(databaseUrl); } catch { throw new MonitorError("INVALID_MONITOR_DATABASE_URL"); }
    if (! ["postgresql:", "postgres:"].includes(url.protocol) ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new MonitorError("MONITOR_DATABASE_MUST_BE_LOCAL");
    }
  }
  const config = {
    token, chatId, name, environment, timeZone,
    apiUrl: httpUrl(env.MONITOR_API_URL, "MONITOR_API_URL", true),
    webUrl: httpUrl(env.MONITOR_WEB_URL, "MONITOR_WEB_URL", true),
    rpcUrl, databaseUrl,
    expectedGenesis: publicKey(env.MONITOR_EXPECTED_GENESIS_HASH || env.SOLANA_GENESIS_HASH, "MONITOR_EXPECTED_GENESIS_HASH"),
    programId: publicKey(env.MONITOR_PROGRAM_ID || env.PROGRAM_ID, "MONITOR_PROGRAM_ID"),
    pollMs: integer(env, "MONITOR_POLL_SECONDS", 60, 10, 3600) * 1000,
    summaryMs: integer(env, "MONITOR_SUMMARY_SECONDS", 3600, 60, 86400) * 1000,
    timeoutMs: integer(env, "MONITOR_TIMEOUT_SECONDS", 30, 1, 120) * 1000,
    failureThreshold: integer(env, "MONITOR_FAILURE_THRESHOLD", 2, 1, 10),
    stalledSlotMs: integer(env, "MONITOR_STALLED_SLOT_SECONDS", 180, 30, 3600) * 1000,
    pendingTransactionMs: integer(env, "MONITOR_PENDING_TRANSACTION_SECONDS", 600, 60, 86400) * 1000,
    stateFile: env.MONITOR_STATE_FILE?.trim() || ".local-telegram-monitor-state.json",
  };
  // Persist only a fingerprint, never credentials or RPC query strings.
  config.identity = createHash("sha256").update(JSON.stringify([
    token, chatId, name, environment, config.apiUrl, config.webUrl, rpcUrl,
    databaseUrl, config.expectedGenesis, config.programId,
  ])).digest("hex");
  return config;
}

export async function fetchJson(url, options = {}, fetchImpl = fetch, timeoutMs = 30000) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    const data = await response.json();
    return { response, data };
  } catch {
    // Native fetch errors can include credentials from URLs and response bodies.
    throw new MonitorError("REQUEST_FAILED");
  }
}

async function httpCheck(config, id, label, path, expectedStatus, fetchImpl) {
  try {
    const { response, data } = await fetchJson(new URL(path, id === "web" ? config.webUrl : config.apiUrl), {}, fetchImpl, config.timeoutMs);
    if (id === "ready" && data?.code === "DATABASE_UNAVAILABLE") {
      return { id, label, status: "error", code: "DATABASE_UNAVAILABLE", detail: "API сообщил о недоступности PostgreSQL" };
    }
    if (!response.ok || data?.status !== expectedStatus) {
      return { id, label, status: "error", code: "INVALID_HEALTH", detail: `Проверка не прошла (HTTP ${response.status})` };
    }
    return { id, label, status: "ok", code: "OK", detail: "Доступен" };
  } catch {
    return { id, label, status: "error", code: "UNREACHABLE", detail: "Нет корректного ответа в пределах таймаута" };
  }
}

async function rpc(config, method, params, fetchImpl) {
  const { response, data } = await fetchJson(config.rpcUrl, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
  }, fetchImpl, config.timeoutMs);
  if (!response.ok || data?.jsonrpc !== "2.0" || data.id !== method || data.error || !Object.hasOwn(data, "result")) {
    throw new MonitorError("INVALID_RPC_RESPONSE");
  }
  return data.result;
}

export async function localnetCheck(config, previous, now, fetchImpl = fetch) {
  const base = { id: "localnet", label: "Solana Localnet" };
  try {
    const [health, genesis, slot] = await Promise.all([
      rpc(config, "getHealth", [], fetchImpl), rpc(config, "getGenesisHash", [], fetchImpl),
      rpc(config, "getSlot", [{ commitment: "finalized" }], fetchImpl),
    ]);
    if (health !== "ok" || typeof genesis !== "string" || !Number.isSafeInteger(slot) || slot < 0) {
      throw new MonitorError("INVALID_RPC_RESPONSE");
    }
    if (config.expectedGenesis && genesis !== config.expectedGenesis) {
      return { check: { ...base, status: "error", code: "GENESIS_MISMATCH", detail: "Genesis не совпадает с закреплённым owner ledger" }, progress: null };
    }
    if (previous && previous.genesis === genesis && slot < previous.slot) {
      return { check: { ...base, status: "error", code: "SLOT_REGRESSION", detail: "Finalized slot уменьшился; требуется проверка ledger/RPC" }, progress: previous };
    }
    const progressed = !previous || previous.genesis !== genesis || slot !== previous.slot;
    const progress = { genesis, slot, progressedAt: progressed ? now : previous.progressedAt };
    if (now - progress.progressedAt >= config.stalledSlotMs) {
      return { check: { ...base, status: "error", code: "SLOT_STALLED", detail: `Finalized slot ${slot} не продвигается` }, progress };
    }
    if (!config.expectedGenesis) {
      return { check: { ...base, status: "warning", code: "GENESIS_UNPINNED", detail: `RPC отвечает, slot ${slot}; genesis не закреплён` }, progress };
    }
    if (!config.programId) {
      return { check: { ...base, status: "warning", code: "PROGRAM_UNCONFIGURED", detail: `Сеть проверена, slot ${slot}; Program ID не настроен` }, progress };
    }
    const account = await rpc(config, "getAccountInfo", [config.programId, { commitment: "finalized", encoding: "base64" }], fetchImpl);
    if (!account?.value?.executable || !Number.isSafeInteger(account.context?.slot) || account.context.slot < slot) {
      return { check: { ...base, status: "error", code: "PROGRAM_UNAVAILABLE", detail: "Нет подтверждённого executable аккаунта программы" }, progress };
    }
    return { check: { ...base, status: "ok", code: "OK", detail: `Сеть и executable программа доступны, finalized slot ${slot}` }, progress };
  } catch {
    return { check: { ...base, status: "error", code: "RPC_UNAVAILABLE", detail: "Localnet RPC не отвечает корректно" }, progress: previous ?? null };
  }
}

export async function databaseSnapshot(prisma, now, config) {
  // A read-only transaction keeps these aggregate facts consistent without domain writes.
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SET TRANSACTION READ ONLY`;
    await db.$queryRaw`SELECT set_config('statement_timeout', ${String(config.timeoutMs)}, true)`;
    const cutoff = new Date(now - config.pendingTransactionMs);
    const [instruments, actions, transactions, failedActions, failedInstruments, unknownTransactions,
      staleTransactions, failedJobs, mismatches] = await Promise.all([
      db.instrument.groupBy({ by: ["status"], _count: { _all: true } }),
      db.corporateAction.groupBy({ by: ["status"], _count: { _all: true } }),
      db.blockchainTransaction.groupBy({ by: ["status"], _count: { _all: true } }),
      db.corporateAction.count({ where: { status: { in: ["FAILED_RETRYABLE", "FAILED_FINAL", "SNAPSHOT_MISSED"] } } }),
      db.instrument.count({ where: { status: "FAILED" } }),
      db.blockchainTransaction.count({ where: { status: "UNKNOWN_CONFIRMATION" } }),
      db.blockchainTransaction.count({ where: { status: "SUBMITTED", OR: [{ submittedAt: { lt: cutoff } }, { submittedAt: null, createdAt: { lt: cutoff } }] } }),
      db.executionJob.count({ where: { status: "FAILED_FINAL", corporateAction: { status: { notIn: ["CANCELLED", "FINALIZED", "REJECTED"] } } } }),
      db.settlement.count({ where: { reconciliationStatus: "MISMATCH" } }),
    ]);
    return { instruments, actions, transactions, failedActions, failedInstruments, unknownTransactions, staleTransactions, failedJobs, mismatches };
  }, { isolationLevel: "RepeatableRead", maxWait: config.timeoutMs, timeout: config.timeoutMs });
}

export async function collectReport(config, previousProgress = null, { fetchImpl = fetch, prisma = null, now = Date.now() } = {}) {
  const tasks = [
    httpCheck(config, "live", "Опубликованный API", "/api/v1/health/live", "live", fetchImpl),
    httpCheck(config, "ready", "Готовность API / PostgreSQL (staging)", "/api/v1/health/ready", "ready", fetchImpl),
    httpCheck(config, "web", "Опубликованный web", "/health/live", "live", fetchImpl),
  ];
  const [httpChecks, localnet, localDatabase] = await Promise.all([
    Promise.all(tasks),
    config.rpcUrl ? localnetCheck(config, previousProgress, now, fetchImpl) : null,
    prisma ? databaseSnapshot(prisma, now, config).then((stats) => ({ stats })).catch(() => ({ failed: true })) : null,
  ]);
  const checks = [...httpChecks];
  if (localnet) checks.push(localnet.check);
  if (config.rpcUrl && !localDatabase) {
    checks.push({ id: "owner-db", label: "База и операции owner Localnet", status: "warning", code: "NOT_CONFIGURED", detail: "Нет MONITOR_DATABASE_URL; операции не проверены" });
  } else if (localDatabase?.failed) {
    checks.push({ id: "owner-db", label: "База owner Localnet", status: "error", code: "DATABASE_UNAVAILABLE", detail: "Не удалось прочитать агрегаты PostgreSQL" });
  } else if (localDatabase?.stats) {
    checks.push({ id: "owner-db", label: "База owner Localnet", status: "ok", code: "OK", detail: "Доступна; выполнены только read-only запросы" });
    const definitions = [
      ["failedActions", "Действия с ошибкой"], ["failedInstruments", "Инструменты с ошибкой"],
      ["unknownTransactions", "Транзакции с неизвестным подтверждением"],
      ["staleTransactions", "Задержанные SUBMITTED транзакции"], ["failedJobs", "Задачи с окончательной ошибкой"],
      ["mismatches", "Расхождения сверки расчётов"],
    ];
    for (const [id, label] of definitions) {
      const count = localDatabase.stats[id];
      checks.push({ id, label, status: count > 0 ? "error" : "ok", code: count > 0 ? "ATTENTION_REQUIRED" : "OK", detail: `Количество: ${count}`, count });
    }
  }
  return { checkedAt: now, checks, progress: localnet?.progress ?? null, stats: localDatabase?.stats ?? null };
}
