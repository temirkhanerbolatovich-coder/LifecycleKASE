import { fetchJson, MonitorError } from "./checks.mjs";

export function emptyState(identity) {
  return { version: 1, identity, lastSummaryAt: null, checks: {}, progress: null, retryAt: 0 };
}

export function notificationPlan(config, state, report) {
  const next = structuredClone(state);
  const changes = [];
  next.progress = report.progress;
  for (const check of report.checks) {
    const key = check.status === "ok" ? null : `${check.status}:${check.code}`;
    const old = state.checks[check.id] ?? { candidate: null, consecutive: 0, notified: null };
    const current = { candidate: key, consecutive: key && key === old.candidate ? Math.min(old.consecutive + 1, config.failureThreshold) : key ? 1 : 0, notified: old.notified };
    next.checks[check.id] = current;
    if (key && current.consecutive >= config.failureThreshold && old.notified !== key) {
      changes.push({ kind: "problem", check, key });
    } else if (!key && old.notified) {
      changes.push({ kind: "recovery", check, key: null });
    }
  }
  const summary = state.lastSummaryAt === null || report.checkedAt - state.lastSummaryAt >= config.summaryMs;
  return { next, changes, summary, shouldSend: summary || changes.length > 0 };
}

export function acknowledgeNotification(plan, now) {
  for (const change of plan.changes) plan.next.checks[change.check.id].notified = change.key;
  if (plan.summary) plan.next.lastSummaryAt = now;
  plan.next.retryAt = 0;
  return plan.next;
}

function groupedCounts(rows) {
  return rows.map((row) => `${row.status}: ${row._count._all}`).join(", ") || "нет записей";
}

export function formatNotification(config, plan, report) {
  const stamp = new Intl.DateTimeFormat("ru", { timeZone: config.timeZone, dateStyle: "short", timeStyle: "medium" }).format(report.checkedAt);
  const lines = [
    `${config.name} — ${plan.summary ? "сводка состояния" : "изменение состояния"}`,
    `Окружение: ${config.environment}`,
    `Проверено: ${stamp} (${config.timeZone})`,
  ];
  for (const change of plan.changes) {
    lines.push(`${change.kind === "recovery" ? "✅ Восстановлено" : "🚨 Проблема"}: ${change.check.label} — ${change.check.detail}`);
  }
  if (plan.summary) {
    lines.push("", report.checks.every((check) => check.status === "ok") ? "Технические проверки: ОК" : "Технические проверки: требуется внимание");
    for (const check of report.checks) {
      lines.push(`${check.status === "ok" ? "🟢" : check.status === "warning" ? "🟡" : "🔴"} ${check.label}: ${check.detail}`);
    }
    if (report.stats) {
      lines.push("", "Операции owner Localnet (данные PostgreSQL):",
        `Инструменты — ${groupedCounts(report.stats.instruments)}`,
        `Корпоративные действия — ${groupedCounts(report.stats.actions)}`,
        `Транзакции — ${groupedCounts(report.stats.transactions)}`,
        "PREPARED / UNDER_REVIEW — ожидаемые этапы, не подтверждение выплаты.");
    }
    lines.push("", "Staging и owner Localnet — отдельные окружения. Health не подтверждает исполнение выплат или готовность к production.");
  }
  return lines.join("\n");
}

export async function sendTelegram(config, text, { fetchImpl = fetch } = {}) {
  if ([...text].length > 4096) throw new MonitorError("TELEGRAM_MESSAGE_TOO_LONG");
  const { response, data } = await fetchJson(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: config.chatId, text, link_preview_options: { is_disabled: true } }),
  }, fetchImpl, config.timeoutMs);
  if (response.status === 429 || data?.error_code === 429) {
    const delay = data?.parameters?.retry_after;
    throw new MonitorError("TELEGRAM_RATE_LIMITED", Number.isSafeInteger(delay) && delay > 0 ? Math.min(delay, 86400) : 60);
  }
  if (!response.ok || data?.ok !== true || String(data.result?.chat?.id) !== config.chatId || !Number.isSafeInteger(data.result?.message_id)) {
    throw new MonitorError("TELEGRAM_DELIVERY_FAILED");
  }
  return data.result.message_id;
}

export async function discoverAdminChats(config, { fetchImpl = fetch } = {}) {
  const { response, data } = await fetchJson(`https://api.telegram.org/bot${config.token}/getUpdates`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ timeout: 0, limit: 100 }),
  }, fetchImpl, config.timeoutMs);
  if (!response.ok || data?.ok !== true || !Array.isArray(data.result)) {
    throw new MonitorError("TELEGRAM_CHAT_DISCOVERY_FAILED");
  }
  const chats = new Set();
  for (const update of data.result) {
    const message = update.message;
    if (message?.chat?.type === "private" && Number.isSafeInteger(message.chat.id) &&
        message.chat.id > 0 && message.from?.id === message.chat.id &&
        typeof message.text === "string" && /^\/start(?:@\w+)?(?:\s|$)/.test(message.text)) {
      chats.add(String(message.chat.id));
    }
  }
  return [...chats];
}

export async function monitorCycle(config, state, { collect, send, now = Date.now() }) {
  const report = await collect(state.progress, now);
  const plan = notificationPlan(config, state, report);
  if (plan.shouldSend && now >= state.retryAt) {
    try {
      await send(formatNotification(config, plan, report));
      return { state: acknowledgeNotification(plan, now), report, delivery: "sent" };
    } catch (error) {
      const delay = error instanceof MonitorError && error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : config.pollMs;
      plan.next.retryAt = now + delay;
      return { state: plan.next, report, delivery: "failed", errorCode: error instanceof MonitorError ? error.code : "TELEGRAM_DELIVERY_FAILED" };
    }
  }
  return { state: plan.next, report, delivery: plan.shouldSend ? "backoff" : "unchanged" };
}
