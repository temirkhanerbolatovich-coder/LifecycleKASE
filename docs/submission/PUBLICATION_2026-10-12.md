# GitHub and hosting publication follow-up — 2026-10-12

This follow-up supersedes the unpushed-source and unmerged-master items in the [earlier stop checkpoint](CHECKPOINT_2026-10-12.md). It does not constitute competition submission.

## GitHub publication

The documentation and Benjamin judge media were pushed as `87ad59e646a84867424cf4b916f3ddbea1fa2ea5`. The owner then explicitly authorized merging [PR #1](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/pull/1) after checks. It merged into `master` as `6b05441a3cc3d99833931df99401133fa967366f`.

- Fresh local validation passed **684 tests**, types, Prisma and 132 Markdown files. API/domain/client and isolated production Next builds passed; the existing owner's web build was preserved.
- Production dependency audit reported **0 vulnerabilities**. Gitleaks 8.30.1 scanned all **91 commits** with no leaks. Tracked publication paths excluded ignored credentials, signed Runway asset URLs, local recordings and deployment logs. `git diff --check` passed.
- All three [PR CI jobs](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38292139987) and all three [merged-master CI jobs](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38293065001) passed.

## Hosting update in progress

The existing free DuckDNS hostname is `lifecyclekase.assetguard-temirkhan.duckdns.org`, on the same approved Oracle VPS as the retained AssetGuard installation. This is a separate subdomain, directory, Compose project and database, rather than a newly purchased domain or a replacement VM. Oracle still shows the original `assetguard-prod` instance, launched 2026-09-24, with its original IP and 1GB shape.

Before updating, the current release was `f51be252295af181ed931f00dba1ee89c35aedef`; containers were healthy, the website's systemd unit enabled/active and TimScheduleBot active. A protected backup of the LifecycleKASE database/configuration was created at `/opt/lifecyclekase/backups/pre-87ad59e-20261012T183548Z`; archive listing passed and the database reported 23 completed migrations. This is a backup creation check, not restore acceptance.

The checked `87ad59e` prebuilt release archive was uploaded with SHA-256 `72f80d320aa0ef7b94efa4354630399bf93b91be04d34f047cb1067ff633a7d8`. The VPS dependency-image build has not completed; its last observed step is `npm ci`, before environment rewriting, migrations or switching `current`. HTTPS probes and SSH diagnostic execution subsequently timed out. A completed new deployment or current healthy uptime is **not yet confirmed**. The source application/dependencies/migrations are unchanged from `f51be25`, apart from README files.

Both complete Benjamin MP4s and their SRT/TXT files were copied to `/opt/lifecyclekase/submission`; all six remote SHA-256 checks matched the local originals. Pitch: **9,636,953 bytes**, SHA-256 `4bf339eca3a79089d5726da9944fc1e2e73518592e858e51d1d0f8bb287e8771`. Demo: **31,204,749 bytes**, SHA-256 `2ad90c3577af82d223038c37e9158428ed960775cad87342c82d92a63b627e48`. Fresh public playback/range checks remain pending recovery. YouTube upload belongs to the owner and is still pending.

The installer now bounds future legacy image builds to 384MiB RAM, no additional swap and half a CPU. Shell syntax, local legacy Docker flag support and document links were checked; the bounded build has not yet been accepted on the VPS. The cause of the current loss of responsiveness is not established. The [runbook](../deployment/oracle-duckdns.md) and [ADR-033](../decisions/ADR-033-oracle-submission-hosting.md) explain the resource limits and shared-port constraint when AssetGuard is restarted in the future.

## Remaining work

Restore reliable server access, finish or safely replace the interrupted release build, verify the exact public runtime and media, and confirm TimScheduleBot plus the retained stopped AssetGuard state. Final main/side-track submission and accepted-host video links remain open. No owner financial state or flags were changed; no AssetGuard data/volume deletion was issued. The owner explicitly approved a whole-VPS recovery reboot, including the temporary TimScheduleBot interruption; the normal Oracle reboot was dispatched with force mode disabled. Recovery is not yet confirmed.
