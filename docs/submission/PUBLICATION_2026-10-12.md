# GitHub and hosting publication follow-up — 2026-10-12

This follow-up supersedes the unpushed-source and unmerged-master items in the [earlier stop checkpoint](CHECKPOINT_2026-10-12.md). It does not constitute competition submission.

## GitHub publication

The documentation and Benjamin judge media were pushed as `87ad59e646a84867424cf4b916f3ddbea1fa2ea5`. The owner then explicitly authorized merging [PR #1](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/pull/1) after checks. It merged into `master` as `6b05441a3cc3d99833931df99401133fa967366f`.

- Fresh local validation passed **684 tests**, types, Prisma and 132 Markdown files. API/domain/client and isolated production Next builds passed; the existing owner's web build was preserved.
- Production dependency audit reported **0 vulnerabilities**. Gitleaks 8.30.1 scanned all **91 commits** with no leaks. Tracked publication paths excluded ignored credentials, signed Runway asset URLs, local recordings and deployment logs. `git diff --check` passed.
- All three [PR CI jobs](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38292139987) and all three [merged-master CI jobs](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38293065001) passed.

## Verified hosting update — 2026-10-13 Asia/Qyzylorda

The current runtime is **`c835394fb881fed7086cb59c8a3adcf86c857584`**, image **`sha256:f2002ab2011b85b9c7a432b4895ed76bd9cac17f19d32bc834e49bfcdc55232c`**. Its [exact-source master CI](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38295107033) passed. [The deployment update record](../testing/evidence/oracle-submission-2026-10-12/update-2026-10-13.json) and [fresh HTTP/TLS/media observations](../testing/evidence/oracle-submission-2026-10-12/http-2026-10-13.json) supersede the initial attempt below. Subsequent publication edits are documentation/evidence only.

API/web/PostgreSQL are healthy; public QA/dashboard/liveness return 200, all ten static assets return 200 and all four protected probes return 401 `SESSION_REQUIRED` with `no-store`. English QA hydration, action-details access and return to Overview were observed. HTTP redirects with 308 and the TLS certificate covers the exact hostname. Both Benjamin MP4s return external ranges with 206; all four subtitles/transcripts return 200. [Pitch backup](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-pitch-en-benjamin.mp4) and [demo backup](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-demo-en-benjamin.mp4) have the hashes recorded below.

The approved normal whole-VPS reboot restored access and demonstrated website/bot startup. Both units are enabled/active, all runtime containers retain `unless-stopped`, no runtime OOM flags were set and 502MiB RAM was available. `/opt/assetguard` and its PostgreSQL/model/Vision volumes were present; its containers remain stopped and all five timers disabled. The incident cause is not established.

The new image reused the immutable reviewed Linux dependency base after all **31** lockfile, package, schema and migration inputs matched. Fresh precompiled output and its new release manifest were copied with bounded resources; old compiled outputs were removed only inside the candidate image. Existing root-only configuration/database were preserved, 23 migrations confirmed and no new migrations ran. [The pinned activation helper](../testing/evidence/oracle-submission-2026-10-12/refresh-c835394.sh) preserves checks/rollback and refuses to overwrite an existing release. The initial dependency build below was not resumed.

### Initial attempt and recovery chronology

The existing free DuckDNS hostname is `lifecyclekase.assetguard-temirkhan.duckdns.org`, on the same approved Oracle VPS as the retained AssetGuard installation. This is a separate subdomain, directory, Compose project and database, rather than a newly purchased domain or a replacement VM. Oracle still shows the original `assetguard-prod` instance, launched 2026-09-24, with its original IP and 1GB shape.

Before updating, the current release was `f51be252295af181ed931f00dba1ee89c35aedef`; containers were healthy, the website's systemd unit enabled/active and TimScheduleBot active. A protected backup of the LifecycleKASE database/configuration was created at `/opt/lifecyclekase/backups/pre-87ad59e-20261012T183548Z`; archive listing passed and the database reported 23 completed migrations. This is a backup creation check, not restore acceptance.

The checked `87ad59e` archive was uploaded with SHA-256 `72f80d320aa0ef7b94efa4354630399bf93b91be04d34f047cb1067ff633a7d8`. Its dependency-image build did not finish; the last observed step was `npm ci`, before environment rewriting, migrations or switching `current`. HTTPS probes and SSH diagnostic execution timed out. This attempt did not establish a completed deployment. Application/dependencies/migrations are unchanged from `f51be25`, apart from README files.

Both complete Benjamin MP4s and their SRT/TXT files were copied to `/opt/lifecyclekase/submission`; all six remote SHA-256 checks matched the local originals. Pitch: **9,636,953 bytes**, SHA-256 `4bf339eca3a79089d5726da9944fc1e2e73518592e858e51d1d0f8bb287e8771`. Demo: **31,204,749 bytes**, SHA-256 `2ad90c3577af82d223038c37e9158428ed960775cad87342c82d92a63b627e48`. External range/access checks passed after recovery; complete external playback was not repeated. YouTube upload belongs to the owner and is still pending.

The installer now bounds future legacy image builds to 384MiB RAM, no additional swap and half a CPU. Shell syntax, Docker flag support and document links were checked; the bounded copy build passed on the VPS, while full dependency installation was not repeated. The [runbook](../deployment/oracle-duckdns.md) and [ADR-033](../decisions/ADR-033-oracle-submission-hosting.md) explain resource limits and the shared-port constraint when AssetGuard resumes.

## Remaining work

The website update, direct media copies and retained-project checks are complete. Accepted-host video publication and final main/side-track submission remain open. No owner financial state or flags were changed and no AssetGuard data/volume deletion was issued. Incident root cause, complete external video playback, load/fault acceptance and backup restore remain unverified. Future full image builds should run away from this shared 1GB host.
