import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createServer } from "node:http";
import { MonitorError, monitorConfig, collectReport, localnetCheck, databaseSnapshot } from "../scripts/monitoring/checks.mjs";
import { emptyState, notificationPlan, formatNotification, monitorCycle, sendTelegram, discoverAdminChats } from "../scripts/monitoring/notifications.mjs";
import { loadState, saveState, acquireLock } from "../scripts/telegram-monitor.mjs";

const genesis = "B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF";
const program = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const env = {
  TELEGRAM_BOT_TOKEN: "123456789:synthetic_token_for_offline_tests",
  TELEGRAM_ADMIN_CHAT_ID: "1234567",
  MONITOR_API_URL: "https://api.example.test", MONITOR_WEB_URL: "https://web.example.test",
  MONITOR_EXPECTED_GENESIS_HASH: genesis, MONITOR_PROGRAM_ID: program,
};
const config = monitorConfig(env);
const epoch = 1700000000000;
const report = (now, status = "ok", code = "OK") => ({ checkedAt: now, progress: null, stats: null,
  checks: [{ id: "live", label: "API", status, code, detail: "Проверка" }] });
const healthFetch = async (url) => new Response(JSON.stringify({ status: url.pathname.endsWith("ready") ? "ready" : "live" }));

async function removeTestDirectory(directory) {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^lifecycle-telegram-(test|lock)-/);
  await rm(target, { recursive: true, force: true });
}

function rpcFetch({ slot = 100, network = genesis, account = { executable: true }, malformed = false } = {}) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    const results = { getHealth: "ok", getGenesisHash: network, getSlot: slot, getAccountInfo: { context: { slot }, value: account } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: malformed ? "wrong" : request.id, result: results[request.method] }));
  };
}

test("configuration bounds timing, fixes numeric recipients, and does not disclose invalid secrets", () => {
  assert.equal(config.summaryMs, 3600000);
  assert.equal(config.pollMs, 60000);
  for (const override of [
    { TELEGRAM_BOT_TOKEN: "private-invalid-token" }, { TELEGRAM_ADMIN_CHAT_ID: "@public_channel" },
    { MONITOR_POLL_SECONDS: "0" }, { MONITOR_TIMEOUT_SECONDS: "Infinity" },
    { MONITOR_FAILURE_THRESHOLD: "1.5" }, { MONITOR_API_URL: "https://user:secret@example.test" },
    { MONITOR_API_URL: "https://api.example.test/api/v1" }, { MONITOR_NAME: "name\ninjected line" },
    { MONITOR_DATABASE_URL: "postgresql://user:secret@remote.example.test/database" },
  ]) {
    assert.throws(() => monitorConfig({ ...env, ...override }), (error) => {
      assert.ok(error instanceof MonitorError);
      assert.doesNotMatch(error.message, /private-invalid-token|secret|public_channel/);
      return true;
    });
  }
  assert.doesNotThrow(() => monitorConfig({ ...env, TELEGRAM_BOT_TOKEN: "", TELEGRAM_ADMIN_CHAT_ID: "" }, { requireTelegram: false }));
  assert.doesNotThrow(() => monitorConfig({ ...env, TELEGRAM_ADMIN_CHAT_ID: "" }, { requireChat: false }));
});

test("report checks real HTTP health contracts and does not claim unconfigured owner operations are healthy", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: request.url.endsWith("ready") ? "ready" : "live" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const localConfig = monitorConfig({ ...env, MONITOR_API_URL: origin, MONITOR_WEB_URL: origin });
    const result = await collectReport(localConfig, null, { fetchImpl: (url, options) =>
      options?.method === "POST" ? rpcFetch()(url, options) : fetch(url, options), now: epoch });
    assert.equal(result.checks.slice(0, 4).every((check) => check.status === "ok"), true);
    assert.equal(result.checks.find((check) => check.id === "owner-db").code, "NOT_CONFIGURED");
    assert.equal(result.stats, null);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("API/database failures remain separate and never reveal returned internal details", async () => {
  const result = await collectReport({ ...config, rpcUrl: null }, null, { now: epoch,
    fetchImpl: async (url) => url.pathname.endsWith("ready")
      ? new Response(JSON.stringify({ code: "DATABASE_UNAVAILABLE", password: "database-secret" }), { status: 503 })
      : healthFetch(url),
  });
  assert.equal(result.checks.find((check) => check.id === "live").status, "ok");
  assert.equal(result.checks.find((check) => check.id === "ready").code, "DATABASE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /database-secret/);
});

test("a 200 response with the wrong contract is not healthy", async () => {
  const result = await collectReport({ ...config, rpcUrl: null }, null, { fetchImpl: async () => new Response('{"status":"unexpected"}') });
  assert.equal(result.checks.every((check) => check.status === "error"), true);
});

test("RPC identity mismatch blocks a healthy Localnet report", async () => {
  const result = await localnetCheck(config, null, epoch, rpcFetch({ network: "another-network" }));
  assert.equal(result.check.code, "GENESIS_MISMATCH");
});

test("unconfigured genesis and missing program are explicit warnings", async () => {
  assert.equal((await localnetCheck({ ...config, expectedGenesis: null }, null, epoch, rpcFetch())).check.code, "GENESIS_UNPINNED");
  assert.equal((await localnetCheck({ ...config, programId: null }, null, epoch, rpcFetch())).check.code, "PROGRAM_UNCONFIGURED");
  assert.equal((await localnetCheck(config, null, epoch, rpcFetch({ account: null }))).check.code, "PROGRAM_UNAVAILABLE");
  assert.equal((await localnetCheck(config, null, epoch, rpcFetch({ malformed: true }))).check.code, "RPC_UNAVAILABLE");
});

test("stalled finalized slots alert and progress clears the problem", async () => {
  const initial = await localnetCheck(config, null, epoch, rpcFetch());
  const stalled = await localnetCheck(config, initial.progress, epoch + config.stalledSlotMs, rpcFetch());
  assert.equal(stalled.check.code, "SLOT_STALLED");
  const resumed = await localnetCheck(config, stalled.progress, epoch + config.stalledSlotMs + 1, rpcFetch({ slot: 101 }));
  assert.equal(resumed.check.status, "ok");
});

test("slot regression stays unhealthy until the original finalized slot is restored", async () => {
  const original = { genesis, slot: 100, progressedAt: epoch };
  const first = await localnetCheck(config, original, epoch + 1, rpcFetch({ slot: 90 }));
  const repeated = await localnetCheck(config, first.progress, epoch + 2, rpcFetch({ slot: 91 }));
  assert.equal(first.check.code, "SLOT_REGRESSION");
  assert.equal(repeated.check.code, "SLOT_REGRESSION");
  assert.equal(repeated.progress.slot, 100);
});

test("operation snapshot counts unresolved problems while keeping PREPARED and review as expected states", async () => {
  const queries = [];
  const count = (name) => async (query) => { queries.push({ name, query }); return name === "transactions" ? 2 : 0; };
  const groups = (status) => async () => [{ status, _count: { _all: 1 } }];
  const db = {
    $executeRaw: async () => {}, $queryRaw: async () => {},
    instrument: { groupBy: groups("ACTIVE"), count: count("instruments") },
    corporateAction: { groupBy: groups("UNDER_REVIEW"), count: count("actions") },
    blockchainTransaction: { groupBy: groups("PREPARED"), count: count("transactions") },
    executionJob: { count: count("jobs") }, settlement: { count: count("settlements") },
  };
  const prisma = { $transaction: async (work) => work(db) };
  const stats = await databaseSnapshot(prisma, epoch, config);
  assert.equal(stats.unknownTransactions, 2);
  assert.equal(stats.staleTransactions, 2);
  assert.deepEqual(stats.actions, [{ status: "UNDER_REVIEW", _count: { _all: 1 } }]);
  assert.equal(queries.some(({ query }) => query.where.status === "PREPARED"), false);
  const collected = await collectReport({ ...config, rpcUrl: null }, null, { fetchImpl: healthFetch, prisma, now: epoch });
  assert.equal(collected.checks.find((check) => check.id === "unknownTransactions").status, "error");
  assert.equal(collected.checks.find((check) => check.id === "failedActions").status, "ok");
  const notification = formatNotification(config, { summary: true, changes: [] }, collected);
  assert.match(notification, /PREPARED \/ UNDER_REVIEW — ожидаемые этапы/);
});

test("database query failure does not turn into a clean financial status", async () => {
  const result = await collectReport({ ...config, rpcUrl: null }, null, {
    fetchImpl: healthFetch, prisma: { $transaction: async () => { throw new Error("password=secret"); } },
  });
  assert.equal(result.stats, null);
  assert.equal(result.checks.find((check) => check.id === "owner-db").status, "error");
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test("confirmed incidents send once, unchanged incidents are suppressed, and recovery sends once", async () => {
  let state = { ...emptyState(config.identity), lastSummaryAt: epoch };
  const sent = [];
  const cycle = async (now, status, code) => {
    const result = await monitorCycle(config, state, { now, collect: async () => report(now, status, code), send: async (text) => sent.push(text) });
    state = result.state;
    return result;
  };
  assert.equal((await cycle(epoch + 1, "error", "DOWN")).delivery, "unchanged");
  assert.equal((await cycle(epoch + 2, "error", "DOWN")).delivery, "sent");
  assert.equal((await cycle(epoch + 3, "error", "DOWN")).delivery, "unchanged");
  assert.equal((await cycle(epoch + 4, "ok", "OK")).delivery, "sent");
  assert.equal((await cycle(epoch + 5, "ok", "OK")).delivery, "unchanged");
  assert.equal(sent.length, 2);
  assert.match(sent[0], /Проблема/);
  assert.match(sent[1], /Восстановлено/);
});

test("one transient error does not send a problem or false recovery", async () => {
  const state = { ...emptyState(config.identity), lastSummaryAt: epoch };
  const first = notificationPlan(config, state, report(epoch + 1, "error", "DOWN"));
  const second = notificationPlan(config, first.next, report(epoch + 2));
  assert.equal(first.shouldSend, false);
  assert.equal(second.shouldSend, false);
});

test("summary is due at startup and again after one hour", () => {
  assert.equal(notificationPlan(config, emptyState(config.identity), report(epoch)).summary, true);
  const state = { ...emptyState(config.identity), lastSummaryAt: epoch };
  assert.equal(notificationPlan(config, state, report(epoch + 3599999)).summary, false);
  assert.equal(notificationPlan(config, state, report(epoch + 3600000)).summary, true);
});

test("Telegram failure preserves pending alerts and enforces the returned rate-limit delay", async () => {
  const state = { ...emptyState(config.identity), lastSummaryAt: epoch,
    checks: { live: { candidate: "error:DOWN", consecutive: 1, notified: null } } };
  const failed = await monitorCycle(config, state, { now: epoch + 1, collect: async () => report(epoch + 1, "error", "DOWN"),
    send: async () => { throw new MonitorError("TELEGRAM_RATE_LIMITED", 120); } });
  assert.equal(failed.state.checks.live.notified, null);
  assert.equal(failed.state.lastSummaryAt, epoch);
  let attempts = 0;
  const next = await monitorCycle(config, failed.state, { now: epoch + 60001,
    collect: async () => report(epoch + 60001, "error", "DOWN"), send: async () => { attempts++; } });
  assert.equal(next.delivery, "backoff");
  assert.equal(attempts, 0);
  const retry = await monitorCycle(config, next.state, { now: epoch + 120001,
    collect: async () => report(epoch + 120001, "error", "DOWN"), send: async () => { attempts++; } });
  assert.equal(retry.delivery, "sent");
  assert.equal(retry.state.checks.live.notified, "error:DOWN");
  assert.equal(attempts, 1);
});

test("sender targets only the configured administrator and verifies Telegram acknowledgement", async () => {
  const result = await sendTelegram(config, "Synthetic offline report", { fetchImpl: async (url, options) => {
    assert.equal(url, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`);
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), { chat_id: env.TELEGRAM_ADMIN_CHAT_ID, text: "Synthetic offline report", link_preview_options: { is_disabled: true } });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42, chat: { id: 1234567 } } }));
  } });
  assert.equal(result, 42);
  await assert.rejects(sendTelegram(config, "text", { fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: { message_id: 42, chat: { id: 7654321 } } })) }), /TELEGRAM_DELIVERY_FAILED/);
});

test("Telegram error descriptions and native fetch exceptions do not leak the token", async () => {
  for (const fetchImpl of [
    async () => { throw new Error(`failed: https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`); },
    async () => new Response(JSON.stringify({ ok: false, description: env.TELEGRAM_BOT_TOKEN }), { status: 401 }),
  ]) {
    await assert.rejects(sendTelegram(config, "text", { fetchImpl }), (error) => {
      assert.doesNotMatch(error.message, /synthetic_token|api.telegram.org/);
      return true;
    });
  }
});

test("sender exposes only a bounded retry delay for 429", async () => {
  await assert.rejects(sendTelegram(config, "text", { fetchImpl: async () => new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 90 } }), { status: 429 }) }), (error) => {
    assert.equal(error.code, "TELEGRAM_RATE_LIMITED");
    assert.equal(error.retryAfterSeconds, 90);
    return true;
  });
});

test("combined summary and incident messages fit Telegram limits with every workflow status", () => {
  const labels = ["Опубликованный API", "Готовность API / PostgreSQL (staging)", "Опубликованный web", "Solana Localnet", "База owner Localnet",
    "Действия с ошибкой", "Инструменты с ошибкой", "Транзакции с неизвестным подтверждением", "Задержанные SUBMITTED транзакции", "Задачи с окончательной ошибкой", "Расхождения сверки расчётов"];
  const checks = labels.map((label, index) => ({ id: String(index), label, status: "error", code: "ERROR", detail: "Нет корректного ответа в пределах таймаута" }));
  const statuses = ["DRAFT", "SCHEDULED", "SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW", "RETURNED_FOR_REVISION", "APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "RECONCILING", "FINALIZED", "REJECTED", "FAILED_RETRYABLE", "FAILED_FINAL", "SNAPSHOT_MISSED", "CANCELLED"];
  const rows = statuses.map((status) => ({ status, _count: { _all: 2147483647 } }));
  const text = formatNotification({ ...config, name: "N".repeat(100), environment: "E".repeat(100) },
    { summary: true, changes: checks.map((check) => ({ kind: "problem", check })) },
    { checkedAt: epoch, checks, stats: { actions: rows, instruments: rows.slice(0, 7), transactions: rows.slice(0, 6) } });
  assert.ok([...text].length <= 4096);
});

test("chat discovery lists only private start messages and never chooses an administrator", async () => {
  const chats = await discoverAdminChats(config, { fetchImpl: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { timeout: 0, limit: 100 });
    return new Response(JSON.stringify({ ok: true, result: [
      { message: { chat: { type: "private", id: 1234567 }, from: { id: 1234567 }, text: "/start" } },
      { message: { chat: { type: "private", id: 1234567 }, from: { id: 1234567 }, text: "/start again" } },
      { message: { chat: { type: "group", id: -1234567 }, text: "/start" } },
      { message: { chat: { type: "private", id: 7654321 }, from: { id: 7654321 }, text: "private content" } },
    ] }));
  } });
  assert.deepEqual(chats, ["1234567"]);
});

test("persisted acknowledgement suppresses duplicate sends after restart; target changes reset state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-telegram-test-"));
  const path = join(directory, "state.json");
  try {
    const state = { ...emptyState(config.identity), lastSummaryAt: epoch,
      checks: { live: { candidate: "error:DOWN", consecutive: 2, notified: "error:DOWN" } } };
    await saveState(path, state);
    const restored = await loadState(path, config.identity);
    assert.equal(notificationPlan(config, restored, report(epoch + 1, "error", "DOWN")).shouldSend, false);
    assert.deepEqual(await loadState(path, "different-target"), emptyState("different-target"));
    assert.doesNotMatch(await readFile(path, "utf8"), /synthetic_token|api.example.test/);
    await writeFile(path, "{corrupt");
    await assert.rejects(loadState(path, config.identity), /MONITOR_STATE_INVALID/);
    await writeFile(path, JSON.stringify({ ...state, retryAt: -1 }));
    await assert.rejects(loadState(path, config.identity), /MONITOR_STATE_INVALID/);
    await writeFile(path, JSON.stringify({ ...state, checks: { live: { candidate: false, consecutive: 2, notified: null } } }));
    await assert.rejects(loadState(path, config.identity), /MONITOR_STATE_INVALID/);
  } finally { await removeTestDirectory(directory); }
});

test("single-instance lock refuses a second active watchdog and allows an orderly restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-telegram-lock-"));
  const path = join(directory, "state.lock");
  try {
    const release = await acquireLock(path);
    await assert.rejects(acquireLock(path), /MONITOR_ALREADY_RUNNING/);
    await release();
    const second = await acquireLock(path);
    await second();
  } finally { await removeTestDirectory(directory); }
});
