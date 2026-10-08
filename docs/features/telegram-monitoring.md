# Administrator Telegram monitoring

Implemented locally: 2026-10-08. This is an outbound watchdog for Render staging and the retained owner Localnet, with an initial report, hourly summaries, confirmed-problem alerts, and recovery messages. It runs outside the API so it can detect API outages. See [ADR-020](../decisions/ADR-020-independent-telegram-monitor.md).

## Observed acceptance, 2026-10-08

The owner created `@LifeCycleKASEbot`, stored its token in the ignored local settings, and pressed Start. The single private `/start` destination was configured for this administrator. Telegram accepted the initial summary at 15:51 Asia/Qyzylorda and the owner confirmed receipt. The separate hidden Node process started at 15:52, accepted its first cycle, and Telegram accepted the confirmed owner-RPC/database problem notification. A subsequent unchanged cycle did not resend it. Runtime PID/log names are point-in-time operational evidence, not deployment guarantees.

At that check, published API liveness, database readiness and web liveness passed. Owner Localnet RPC did not respond, Docker Desktop's engine was unavailable, and owner PostgreSQL could not be queried. The local database URL was reused from the retained owner's startup configuration without printing credentials. No ledger reset, validator startup, migration, or financial operation was performed. Positive live owner database aggregate/program-health checks therefore remain unverified. Recovery, rate-limit failure and deduplication were tested offline. The first hour has not elapsed; hourly scheduling is covered by clock-controlled tests.

Validation: `npm run check` passed scaffold/documentation links, Prisma schema, workspace type checks, and all 227 tests present at that run, including the first 20 Telegram tests. The final Telegram suite contains 21 passing tests after adding the message-limit case; documentation links and scoped whitespace checks also passed. No real PostgreSQL success integration or live chain recovery was claimed while those dependencies were offline.

## What is checked

| Check | Evidence and failure behavior |
| --- | --- |
| Published API | `/api/v1/health/live` must return HTTP success and `status: live` |
| Published API/PostgreSQL readiness | `/api/v1/health/ready` must return `status: ready`; `DATABASE_UNAVAILABLE` is reported separately from an unreachable endpoint |
| Published web | `/health/live` must return `status: live`; this does not exercise the browser's wallet flow or every dashboard route |
| Owner Solana Localnet | `getHealth`, pinned `getGenesisHash`, finalized `getSlot`, and executable `MONITOR_PROGRAM_ID` account; stalled or regressed slots, wrong genesis, missing program, and RPC errors are problems |
| Optional owner PostgreSQL | Read-only repeatable-read aggregates for instruments, actions, and transactions; no credentials, investor data, wallet addresses, transaction bytes, or audit payloads are sent |
| Operation problems | Failed actions/instruments, unresolved `UNKNOWN_CONFIRMATION`, `SUBMITTED` attempts older than the threshold, final execution-job failures on open actions, settlement reconciliation mismatches |

`PREPARED` and `UNDER_REVIEW` are expected workflow states. The monitor does not mistake them for an outage, funding completion, approval, or a payout. The owner database aggregates and public readiness describe different environments. A Localnet health check does not verify every holder balance or prove finalized domain settlement. Program availability checks the executable account, not its binary hash or authority.

When the optional owner database is absent, the report explicitly says operations are unverified. A database query failure remains a problem; old successful statistics are not presented as current. Persisted failed domain statuses remain visible until the underlying workflow resolves them, including historically preserved failures.

## Create and connect the bot

1. Open [BotFather](https://t.me/BotFather), send `/newbot`, and choose a name and a unique username ending in `bot`.
2. Open a private chat with the new bot and press Start.
3. Put the token in the ignored `.local-telegram-monitor.env` at the repository root. Never paste it in chat, commit it, or put it in a `NEXT_PUBLIC_*` variable. `.env.example` documents all settings; process environment variables override local files, and the monitor file is loaded before the common `.env`.
4. From the repository root run `npm run monitor:telegram -- --discover-chat`. It makes a single `getUpdates` request, lists only numeric private-chat IDs associated with `/start`, prints no private text, does not acknowledge an offset or alter a webhook, and does not choose a recipient. Set **your own** ID in `TELEGRAM_ADMIN_CHAT_ID`. If multiple IDs appear, confirm which belongs to you. An existing webhook or another poller can prevent discovery; inspect it rather than deleting it automatically.
5. Set the public API/web origins, Localnet RPC URL, expected retained-ledger genesis, and Program ID. The prepared local file pins the public addresses and the genesis/program from the retained owner's existing startup configuration; availability must still be verified live.
6. Optionally set `MONITOR_DATABASE_URL` to the owner loopback PostgreSQL URL. Prefer a dedicated SELECT-only account permitted to read the monitored tables. The monitor rejects a non-loopback database to avoid sending another environment's domain aggregates under the owner label. It does not provision users or change grants automatically.

Live delivery requires a valid bot token, the administrator's explicit numeric destination, and prior interaction with the bot. Commands such as `/status` and `/problems` are not implemented; the normal monitor never polls Telegram. `--discover-chat` is a setup-only lookup.

## Configuration

| Variable | Default / meaning |
| --- | --- |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` | Required for sending; destination must be a numeric private/group chat ID |
| `MONITOR_API_URL`, `MONITOR_WEB_URL` | Required HTTP(S) origins, without credentials, paths, or query strings; choose the actual environment |
| `MONITOR_NAME`, `MONITOR_ENVIRONMENT` | `LifecycleKASE`, `staging + owner Localnet`; report labels, maximum 100 characters |
| `MONITOR_TIMEZONE` | `UTC`; prepared local settings use `Asia/Qyzylorda` |
| `MONITOR_LOCALNET_ENABLED` | `true`; set `false` for a cloud-only watchdog |
| `MONITOR_LOCALNET_RPC_URL` | Existing `SOLANA_RPC_URL`, otherwise `http://127.0.0.1:8899` |
| `MONITOR_EXPECTED_GENESIS_HASH`, `MONITOR_PROGRAM_ID` | Fall back to `SOLANA_GENESIS_HASH` / `PROGRAM_ID`; absent pins are warnings, not a healthy verified owner network |
| `MONITOR_DATABASE_URL` | Optional loopback PostgreSQL URL; never inferred from a public API's readiness |
| `MONITOR_POLL_SECONDS` | `60`, range 10–3600; sequential cycles, with request time counted toward the interval |
| `MONITOR_SUMMARY_SECONDS` | `3600`, range 60–86400; initial report and then hourly, with up to one polling cycle of scheduling delay |
| `MONITOR_TIMEOUT_SECONDS` | `30`, range 1–120; HTTP/RPC deadline and bounded PostgreSQL statement/transaction/connect settings |
| `MONITOR_FAILURE_THRESHOLD` | `2`, range 1–10; consecutive samples of the same problem before an alert. Set 1 for the first failed sample. Recovery of an alerted problem is reported after a successful sample |
| `MONITOR_STALLED_SLOT_SECONDS` | `180`, range 30–3600; finalized slot must keep progressing |
| `MONITOR_PENDING_TRANSACTION_SECONDS` | `600`, range 60–86400; age threshold for persisted SUBMITTED transactions |
| `MONITOR_STATE_FILE` | `.local-telegram-monitor-state.json`, resolved against the repository root; its parent directory must exist |

The initial/hourly summary includes current warnings even before a consecutive-failure threshold is reached. An unchanged confirmed problem sends one alert until recovery or a different problem code appears. Increasing counts within the same problem category are included in the hourly summary rather than generating an alert for each record.

## Run and verify

```powershell
# Read-only: no Telegram sends, state/lock writes, or domain changes.
npm run monitor:telegram -- --check

# One cycle. Sends only a due report/alert, with saved delivery state.
npm run monitor:telegram -- --once

# Continuous separate process, Ctrl+C for an orderly stop.
npm run monitor:telegram

# Offline behavior/security tests.
npm run test:telegram
npm run check
```

`--check` needs no Telegram credentials: the underlying Node process exits 0 when all configured checks pass, 2 on a problem/warning, and 1 on configuration or execution failure. npm may map either nonzero status to a generic exit 1. A single check cannot establish stalled-slot duration. `--once` exits 1 on failed/deferred delivery, otherwise 0. The continuous process keeps checking during Telegram failures and saves bounded retry timing; logs contain stable error codes, counts, and timestamps, not tokens, target URLs, private message text, or raw exception bodies. Telegram's accepted `message_id` for the configured chat proves API acceptance; administrator receipt is a separate live acceptance check.

The ignored JSON state persists hourly timing, observed slot progress, and acknowledged incidents using atomic replacement. A fingerprint resets it when bot/recipient/monitored environment changes. Malformed state stops the monitor so it cannot silently flood the chat. A PID lock prevents two processes sharing that state; a lock is reclaimed only when its recorded process no longer exists. Keep one monitor per bot/environment; different state paths are separate instances.

## Deployment and limitations

Run the combined watchdog on the owner's always-on machine or a host that can reach its Localnet and loopback database. A Render worker cannot see a validator on the owner's PC at `127.0.0.1`. For independent cloud outage coverage, a separate cloud-only instance may use `MONITOR_LOCALNET_ENABLED=false` and its own state file and environment label. Do not add background monitoring to Render's free sleeping web service and assume continuous coverage.

The current local monitor was started as a hidden Node process with ignored stdout/stderr logs. There is no installed Windows service, scheduled task, remote worker, or published Render change yet. The ordinary command runs while its Node process and host remain alive. If that host is off, this watchdog cannot send an alert about its own outage; an independent supervisor/heartbeat is a later deployment choice. This feature does not collect arbitrary API exception logs, HTTP error-rate/p95 metrics, backup freshness, or financial reconciliation beyond stored failure indicators.

Failed Telegram sends do not acknowledge incidents or advance summary delivery time; 429 delay is respected across restart. A timeout after Telegram accepts a message, or a crash before state persistence, can cause a duplicate on retry. Exactly-once Telegram delivery is not claimed. The monitor never signs, submits, repairs, approves, pays, resets a ledger, or changes application domain records.
