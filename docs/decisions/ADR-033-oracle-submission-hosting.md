# ADR-033: Isolated Oracle VPS hosting for the submission demo

Status: Accepted for the authorized judge/demo deployment

Date: 2026-10-12

## Context

The user requested submission of the existing solution and a continuously active website without additional hosting costs. The existing free Render services sleep when idle, and their disposable PostgreSQL has free-plan lifetime limits. The owner's existing Oracle VPS is available, but has approximately 1GB RAM, a running TimScheduleBot and retained AssetGuard files/volumes that must remain stopped and intact.

## Options considered

1. Retain free Render with idle sleeping and cold starts.
2. Upgrade hosted services to a paid plan.
3. Deploy a separate project on the already available Oracle VPS with DuckDNS and HTTPS.

## Decision

Use the approved VPS, a separate `lifecyclekase.assetguard-temirkhan.duckdns.org` hostname and a dedicated LifecycleKASE Compose/systemd deployment. Prebuild JavaScript and Next.js locally in an isolated release directory; install Linux dependencies and generate Prisma on the VPS. Caddy terminates HTTPS, app services listen on loopback, and PostgreSQL uses a new volume/database with explicit migration before application startup. Enable domain-bound API authentication and keep financial/upgrade flags disabled.

## Reasoning

This uses available infrastructure without a new paid service, avoids idle-service sleeping, keeps builds away from the low-memory host and preserves existing source/application behavior. A separate database, paths, project name and systemd unit prevent lifecycle operations from restarting or migrating unrelated systems. No retained owner state or credentials are copied.

## Consequences and risks

The demo can restart after process exit or host boot and can serve judge media with HTTP ranges. It shares a small host and is not highly available. Host/network failure, DNS drift, ACME failure or memory pressure can interrupt access. Docker image tags require deployed digest records. No automatic database backup or restore acceptance is introduced, and no public-network financial workflow is claimed.

AssetGuard remains a separate stopped installation. Its name is reused only as the parent DuckDNS name and the existing VPS name; LifecycleKASE has its own directory, containers and database volume. LifecycleKASE's Caddy currently owns host ports 80/443. Running both websites together requires one shared reverse proxy with separate hostname routes before restarting AssetGuard; separate Compose projects cannot both bind those host ports.

Dependency installation is still an image build on the VPS. The installer now limits the legacy build container to 384MiB RAM, no additional swap and half a CPU. This bounds a failed build without allocating all host capacity. The legacy builder is selected explicitly because BuildKit does not enforce these legacy build flags. Moving complete image builds to another machine is the preferred future replacement; the bounds do not establish load or recovery acceptance.

## Future work

If the deployment becomes more than a judge demo, introduce monitored availability, reviewed DNS updating, backup/restore acceptance, capacity testing and a dedicated migration/rollback gate before valuable data is stored.

See the [deployment runbook](../deployment/oracle-duckdns.md).
