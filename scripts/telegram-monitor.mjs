import { open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { MonitorError, monitorConfig, collectReport } from "./monitoring/checks.mjs";
import { emptyState, formatNotification, monitorCycle, discoverAdminChats, sendTelegram } from "./monitoring/notifications.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export async function loadState(path, identity) {
  let state;
  try { state = JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return emptyState(identity);
    throw new MonitorError("MONITOR_STATE_INVALID");
  }
  if (state?.version !== 1 || typeof state.identity !== "string") throw new MonitorError("MONITOR_STATE_INVALID");
  if (state.identity !== identity) return emptyState(identity);
  const timestamp = (value) => Number.isSafeInteger(value) && value >= 0;
  const problemKey = (value) => value === null || typeof value === "string";
  if (!(state.lastSummaryAt === null || timestamp(state.lastSummaryAt)) || !timestamp(state.retryAt) ||
      !state.checks || typeof state.checks !== "object" || Array.isArray(state.checks) ||
      Object.values(state.checks).some((check) => !check || !timestamp(check.consecutive) ||
        !problemKey(check.candidate) || !problemKey(check.notified)) ||
      (state.progress !== null && (!state.progress || typeof state.progress.genesis !== "string" ||
        !timestamp(state.progress.slot) || !timestamp(state.progress.progressedAt)))) {
    throw new MonitorError("MONITOR_STATE_INVALID");
  }
  return state;
}

export async function saveState(path, state) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    const handle = await open(temporary, "w", 0o600);
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
  } catch {
    await unlink(temporary).catch(() => {});
    throw new MonitorError("MONITOR_STATE_WRITE_FAILED");
  }
}

export async function acquireLock(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(String(process.pid)); } finally { await handle.close(); }
      return async () => { await unlink(path); };
    } catch (error) {
      if (error.code !== "EEXIST") throw new MonitorError("MONITOR_LOCK_FAILED");
    }
    let pid;
    try { pid = Number(await readFile(path, "utf8")); } catch { throw new MonitorError("MONITOR_LOCK_FAILED"); }
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new MonitorError("MONITOR_LOCK_INVALID");
    try { process.kill(pid, 0); throw new MonitorError("MONITOR_ALREADY_RUNNING"); } catch (error) {
      if (error.code !== "ESRCH") throw new MonitorError("MONITOR_ALREADY_RUNNING");
    }
    // Only recover a lock whose recorded process no longer exists. No process is stopped.
    try { await unlink(path); } catch { throw new MonitorError("MONITOR_LOCK_FAILED"); }
  }
  throw new MonitorError("MONITOR_LOCK_FAILED");
}

function loadEnvironment() {
  for (const file of [".local-telegram-monitor.env", ".env"]) {
    try { process.loadEnvFile(resolve(repositoryRoot, file)); } catch (error) {
      if (error.code !== "ENOENT") throw new MonitorError("MONITOR_ENV_FILE_INVALID");
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && !["--help", "--check", "--once", "--discover-chat"].includes(args[0]))) {
    throw new MonitorError("INVALID_MONITOR_ARGUMENTS");
  }
  const mode = args[0];
  if (mode === "--help") {
    console.log("LifecycleKASE Telegram monitor\n--check: read-only health report, no Telegram or state writes\n--discover-chat: list private /start chat IDs for explicit administrator selection\n--once: run one check and deliver due notifications\nNo flag: monitor continuously (default: 60s checks, hourly summary)\nSetup: docs/features/telegram-monitoring.md");
    return 0;
  }
  loadEnvironment();
  const config = monitorConfig(process.env, { requireTelegram: mode !== "--check", requireChat: !["--check", "--discover-chat"].includes(mode) });
  if (mode === "--discover-chat") {
    const chats = await discoverAdminChats(config);
    console.log(chats.length ? `Private /start chat IDs: ${chats.join(", ")}\nSet your own ID as TELEGRAM_ADMIN_CHAT_ID; no recipient is selected automatically.` : "No private /start messages found. Open the bot in Telegram and press Start, then retry.");
    return chats.length ? 0 : 2;
  }
  const statePath = resolve(repositoryRoot, config.stateFile);
  const release = mode === "--check" ? null : await acquireLock(`${statePath}.lock`);
  const stop = new AbortController();
  const onStop = () => stop.abort();
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);
  let prisma;
  try {
    if (config.databaseUrl) {
      const { PrismaClient } = await import("@prisma/client");
      const url = new URL(config.databaseUrl);
      url.searchParams.set("connection_limit", "1");
      url.searchParams.set("connect_timeout", String(Math.ceil(config.timeoutMs / 1000)));
      url.searchParams.set("pool_timeout", String(Math.ceil(config.timeoutMs / 1000)));
      prisma = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] });
    }
    const collect = (progress, now) => collectReport(config, progress, { prisma, now });
    if (mode === "--check") {
      const report = await collect(null, Date.now());
      console.log(formatNotification(config, { summary: true, changes: [] }, report));
      return report.checks.every((check) => check.status === "ok") ? 0 : 2;
    }
    let state = await loadState(statePath, config.identity);
    while (!stop.signal.aborted) {
      const startedAt = Date.now();
      const result = await monitorCycle(config, state, { collect, send: (text) => sendTelegram(config, text) });
      await saveState(statePath, result.state);
      state = result.state;
      console.log(JSON.stringify({ event: "telegram_monitor_cycle", checkedAt: new Date(result.report.checkedAt).toISOString(),
        problems: result.report.checks.filter((check) => check.status !== "ok").length,
        delivery: result.delivery, ...(result.errorCode ? { code: result.errorCode } : {}) }));
      if (mode === "--once") return result.delivery === "failed" || result.delivery === "backoff" ? 1 : 0;
      try { await delay(Math.max(1, config.pollMs - (Date.now() - startedAt)), undefined, { signal: stop.signal }); } catch (error) {
        if (error.name !== "AbortError") throw error;
      }
    }
    return 0;
  } finally {
    process.removeListener("SIGINT", onStop);
    process.removeListener("SIGTERM", onStop);
    try { if (prisma) await prisma.$disconnect(); } finally { if (release) await release(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); } catch (error) {
    console.error(JSON.stringify({ event: "telegram_monitor_stopped", code: error instanceof MonitorError ? error.code : "MONITOR_FAILED" }));
    process.exitCode = 1;
  }
}
