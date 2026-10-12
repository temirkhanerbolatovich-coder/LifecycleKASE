# Oracle VPS and DuckDNS submission hosting

The submission runtime uses the owner's existing Oracle VPS and a separate hostname, `lifecyclekase.assetguard-temirkhan.duckdns.org`. No new paid hosting resource is requested. Deployment uses a new LifecycleKASE PostgreSQL volume and a dedicated Compose project; the deliberately stopped AssetGuard installation, its volumes and the running TimScheduleBot remain separate.

## Current verified release — 2026-10-13 Asia/Qyzylorda

The site now runs **`c835394fb881fed7086cb59c8a3adcf86c857584`**, image **`sha256:f2002ab2011b85b9c7a432b4895ed76bd9cac17f19d32bc834e49bfcdc55232c`**, with [successful source CI](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38295107033). [The update record](../testing/evidence/oracle-submission-2026-10-12/update-2026-10-13.json), [HTTP/TLS/media checks](../testing/evidence/oracle-submission-2026-10-12/http-2026-10-13.json) and [English QA screenshot](../testing/evidence/oracle-submission-2026-10-12/qa-2026-10-13.png) identify the actual accepted runtime. Later documentation/evidence commits preserve the same application source.

API/web/PostgreSQL are healthy, public QA/dashboard/liveness return 200, all ten static assets return 200, protected session/investors/overview/evidence-export return 401 `SESSION_REQUIRED` with `no-store`, HTTP redirects with 308 and the certificate covers this hostname. Both [Benjamin pitch](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-pitch-en-benjamin.mp4) and [Benjamin demo](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-demo-en-benjamin.mp4) are complete with matching remote hashes and external Range 206; SRT/TXT return 200. Accepted YouTube/Loom/Vimeo publication remains separate.

The owner approved a normal whole-VPS recovery reboot after HTTPS/SSH execution stopped responding during the first image build. Website/bot startup was observed; both units are enabled/active, all four containers use `unless-stopped`, none has an OOM flag and 502MiB RAM was available. `/opt/assetguard` and its PostgreSQL/model/Vision volumes were present, its containers stopped and all five timers disabled. Incident root cause and full fault/load acceptance remain open.

The final [source-pinned refresh helper](../testing/evidence/oracle-submission-2026-10-12/refresh-c835394.sh) reused the immutable reviewed Linux dependency image after comparing all 31 dependency/schema/migration inputs. It copied fresh compiled output with memory/CPU bounds, retained root-only configuration/database, confirmed 23 migrations and ran no new migrations. A protected database/configuration backup and rollback image/release were retained; archive listing passed, restore was not tested. The full dependency installer was not retried. Prefer building complete images away from this shared host for future releases.

## Historical checkpoint — 2026-10-12, 20:42 Asia/Qyzylorda

The site is deployed and running at [public QA](https://lifecyclekase.assetguard-temirkhan.duckdns.org/qa) and [operator dashboard](https://lifecyclekase.assetguard-temirkhan.duckdns.org/dashboard), with application source **`f51be252295af181ed931f00dba1ee89c35aedef`**. The [dated deployment record](../testing/evidence/oracle-submission-2026-10-12/deployment.json) identifies the actual image, initial artifact, new database and remaining work.

All **23 migrations** applied only to the newly created database. After an OpenSSL compatibility layer and Linux Prisma regeneration, API/web/PostgreSQL were healthy, loopback API readiness and web liveness returned **200**, public HTTPS liveness returned **200**, and the dedicated systemd unit was enabled and active. API/web had `OOMKilled=false`; all runtime services use `unless-stopped`. TimScheduleBot remained active, with **474MB available RAM** at the final observation. The new image is `sha256:57c7b1f5d9d3d82b382c8f5cc2177fec1ffe0be32558d9af9bc81b3bfee9742d`. The initial image already passed readiness but emitted Prisma's OpenSSL detection warning; the compatibility layer changes runtime dependencies, not application JavaScript.

Public QA/dashboard and all nine referenced JavaScript assets returned **200**. The browser reached the English hydrated QA workspace after an initial transient loading state. Protected investors/overview returned **401 SESSION_REQUIRED**, `no-store`. Complete hosted browser scenarios, real wallets and financial transactions were not reaccepted. Some local HTTP/SSH probes encountered transient connection timeouts/resets; these observations are not an uptime or performance guarantee.

The [English pitch MP4](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-pitch-en.mp4) is published, **9,456,881 bytes**, with a remote SHA-256 matching the local file. Caddy's hostname-verified HTTPS range check on the VPS returned **206**, `video/mp4`, `bytes 0-63/9456881`. Full external playback was not repeated. The demo upload was interrupted after **5,210,112 of 30,894,496 bytes** and remains an unpublished partial file in `/tmp`; subtitle/transcript uploads did not complete.

At the user's request work was stopped after this checkpoint. Task SSH/upload helpers ended; the autonomous website and Telegram bot remain running. Resume with the complete demo transfer/hash/range checks and final submission steps. No reboot, unrelated service restart, retained volume deletion or new paid resource was performed. Competition submission and YouTube upload remain separate pending actions.

## Runtime and boundaries

- Caddy serves public HTTPS on ports 80/443, proxies the web application and serves approved `/media/*` files from `/opt/lifecyclekase/submission` with normal byte-range support.
- Next.js listens only on `127.0.0.1:3000`; its fixed same-origin operator proxy targets the API at `127.0.0.1:4000`.
- The API listens only on `127.0.0.1:4000`, has domain-bound authentication enabled, requires operator sessions and uses secure Strict HttpOnly cookies. The new database contains no copied owner users, wallets or financial data. Public `/qa` remains page-local synthetic state.
- New PostgreSQL is published only on `127.0.0.1:65432`, stores data in the project-scoped `lifecyclekase_lifecyclekase_postgres` volume and has reduced buffers/connections for the 1GB host.
- Financial execution, on-chain entitlement registration and owner-program upgrade flags remain disabled. No Solana program or validator is deployed. Historical disposable financial evidence remains separate from hosted acceptance.
- `restart: unless-stopped` restarts crashed containers. The dedicated `lifecyclekase.service` starts this project after Docker on boot. This avoids free web-service idle sleeping; it is not a guarantee against VPS, network, DNS or application outages.

Configuration is in [Compose](../../deploy/oracle/compose.yaml), [Caddy](../../deploy/oracle/Caddyfile), [the runtime Dockerfile](../../deploy/oracle/Dockerfile) and [the systemd unit](../../deploy/oracle/lifecyclekase.service). [ADR-033](../decisions/ADR-033-oracle-submission-hosting.md) records the deployment decision.

The VPS and parent DuckDNS name are shared with the retained AssetGuard installation, but directories, application containers and database volumes are separate. AssetGuard was already stopped when this project was installed. LifecycleKASE's Caddy currently uses host ports 80/443. To serve both applications together, configure one shared reverse proxy for the two hostnames before restarting AssetGuard; starting its independent Caddy would conflict with those ports.

## Prepare the checked source

Use Node 22 or newer, installed dependencies and a source revision with passing CI. Build and check the application first. The packager refuses modified tracked runtime source and writes only a new ignored release directory; it preserves the running owner's `apps/web/.next`.

```powershell
npm run check
node scripts/deploy-oracle-package.mjs .local-oracle-release-unique
```

[The packager](../../scripts/deploy-oracle-package.mjs) builds an isolated Next application with the fixed loopback API upstream, includes compiled domain/client/API output, package manifests, Prisma migrations and deployment configuration, and records the Git SHA and archive SHA-256. It excludes environment files, keys, database state, cache and test output. If runtime code changed, commit and revalidate it before packaging; a source fingerprint is not a financial acceptance claim.

The VPS installs Linux dependencies and generates its Linux Prisma client; it does not compile Next.js. The image retains the pinned Prisma CLI for an explicit migration job. Node/PostgreSQL/Caddy image digests should be recorded at deployment, because upstream tags can move.

The shared 1GB VPS still needs free capacity during dependency installation. The installer explicitly uses the legacy Docker builder with a 384MiB memory limit, no additional swap and a half-CPU limit. BuildKit ignores these legacy build-resource flags. A resource-limited build may fail before switching the current release; inspect that failure rather than removing the limits. Prefer building the complete Linux image elsewhere for future releases.

## Install on the approved host

Copy the archive and [installer](../../scripts/deploy-oracle-install.sh) with the owner's existing SSH key and strict host-key checking. The installer accepts the archive path, archive SHA-256, 40-character Git source SHA and approved DuckDNS hostname. Run it with `sudo` only on the approved VPS.

```bash
sudo bash /tmp/lifecyclekase-install.sh /tmp/lifecyclekase-release.tar.gz ARCHIVE_SHA256 SOURCE_SHA lifecyclekase.assetguard-temirkhan.duckdns.org
```

The installer verifies the digest and source manifest, creates `/opt/lifecyclekase/releases/SOURCE_SHA`, builds the precompiled runtime image, and generates a random password stored only under `/opt/lifecyclekase/config` with root-only permissions. It validates Compose/Caddy, starts only the new PostgreSQL, runs the explicit migration job against that new database, switches `/opt/lifecyclekase/current` and enables the dedicated service. Migrations are never in the API start command. Existing release directories are preserved and automatic overwrite is refused.

Do not print `runtime.env`, `compose.env`, the database password or DuckDNS tokens. Do not copy the workstation `.env`, owner database, ledger, wallet material or a stopped project's configuration into the image. Do not use a global `docker compose down`, volume deletion, VPS reboot or another project's restart during deployment. UFW already allows website ports 80/443 on the inspected host; this deployment does not require broad firewall changes.

The parent DuckDNS name currently points to the owner's public IPv4 address, and the separate LifecycleKASE hostname resolves through its wildcard DNS. The existing AssetGuard DuckDNS updater remains stopped. If the public IP changes, the owner must deliberately arrange an updater or update the parent DNS; this deployment does not reactivate AssetGuard automation.

## Verify before sharing

Check the exact runtime manifest/image tag and then:

1. Public HTTPS `/qa` and `/dashboard` return 200; `/qa` visibly identifies simulation and has working English/Russian flows.
2. HTTPS `/health/live` and loopback API `/api/v1/health/ready` return expected `live`/`ready` JSON.
3. Same-origin `/api/v1/operator-overview`, `/api/v1/investors` and action evidence-export return 401 `SESSION_REQUIRED` with `no-store` without a session.
4. HTTP redirects to HTTPS, the certificate covers the selected hostname, and API/PostgreSQL ports are not public.
5. `docker compose ps`, container health/restart configuration, `systemctl is-enabled lifecyclekase.service` and `systemctl is-active timschedulebot.service` are checked. Observe host memory and confirm no OOM events or unrelated restarts.
6. After approved video/package upload, `/media/FILE` downloads without a session and MP4 `Range` requests return 206. A missing media file is not a completed upload.

Publish exact dates, source SHA, URL and observations. A fresh reboot, failover, backup restore, authenticated owner wallet flow and financial settlement are not established by these checks.

## Operations and limitations

```bash
cd /opt/lifecyclekase/current/deploy/oracle
sudo docker compose ps
sudo docker compose logs --tail=100 api web caddy
sudo systemctl status lifecyclekase.service --no-pager
```

Inspect errors without dumping environment variables. Caddy certificate acquisition can fail if DNS or public ports do not reach this host. A migration failure stops installation before switching the public runtime; diagnose it against the new database rather than retrying blindly. Memory caps bound each service but do not promise sufficient capacity under load; this single 1GB host is a judge/demo deployment with an existing Telegram bot, not a production trading platform.

This new demonstration database has no implemented automatic backup or tested restore runbook. Do not put real investor or financial information in it. Future releases need a reviewed migration and rollback plan, especially if the database gains valuable data. Stopping this project preserves its volumes; it must not remove another project's retained assets.
