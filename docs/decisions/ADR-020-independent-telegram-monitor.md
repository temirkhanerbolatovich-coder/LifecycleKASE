# ADR-020: Independent outbound Telegram watchdog

Status: Accepted for local implementation
Date: 2026-10-08

## Context

The administrator needs problem/recovery notifications and an hourly system summary covering published LifecycleKASE and the retained owner Localnet. An API-hosted notifier cannot observe an API process outage, and Render cannot reach the owner's loopback validator. Staging readiness does not describe owner financial execution.

## Options considered

- Embed a NestJS scheduler in the API: reuses the process but loses outage coverage when it stops.
- Add a separate C# bot service: introduces another runtime and deployment for an existing Node/TypeScript project.
- Use a small separate Node watchdog with the standard Telegram HTTP API: fits the installed runtime and can observe public endpoints and owner-local dependencies.

## Decision and reasoning

Use a separate Node process with native fetch, the existing Prisma client for optional read-only owner aggregates, one configured numeric administrator destination, and no continuous Telegram inbound transport. It checks health and Localnet identity/progress, sends initial/hourly reports, and groups problem/recovery changes. The only inbound lookup is explicit setup-time chat discovery.

Persist acknowledged notifications, hourly timing, rate-limit delay, and finalized-slot progress in an ignored atomic JSON file. Use a PID lock for one process per state file. Localnet identity is pinned, owner database access is loopback and read-only, and report evidence separates staging health, database projections, and actual financial finality.

## Consequences and risks

- No new npm dependency, API endpoint, public aggregate disclosure, domain migration, or financial write is required.
- The watchdog can detect API downtime while its own host remains running. It does not detect the failure of its own host without an independent supervisor.
- A later deployment must choose an always-on host and process supervisor; a free sleeping Render web service is not such evidence.
- Retries retain pending alerts, but ambiguous Telegram acceptance/crash recovery can duplicate a message. Exactly-once delivery is not provided.
- Stored failure indicators are useful operational evidence, not complete exception telemetry or proof of production/payment readiness.

## Future work

After live administrator acceptance, choose the intended supervised deployment and, if required, independent heartbeat coverage and HTTP error-rate/latency instrumentation. Keep remote staging and owner Localnet configurations distinct.
