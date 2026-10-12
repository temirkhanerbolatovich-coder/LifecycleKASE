# Submission checklist — 2026-10-12

Goal: submit the existing LifecycleKASE prototype with accurate documentation, reviewer access, finished English pitch/demo and actual organizer confirmation. Implementation snapshot: [`f51be25`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/f51be252295af181ed931f00dba1ee89c35aedef). The final documentation/media package will have its own exact published commit.

Deadline: **2026-10-13 11:59 Asia/Qyzylorda**, `2026-10-13T06:59:00Z`, from [Crypto World's Fair rules, section 5](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf), rechecked 2026-10-12. [Section 12](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) requires English content. [Official FAQ](https://colosseum.com/hackathon?year=fall2026) generally says 2–3 minute pitch, but the authenticated main form inspected 2026-10-12 sets **pitch up to 2 minutes (120 seconds)** and **separate live-product demo up to 3 minutes**, with **YouTube, Loom or Vimeo** links. Use the stricter actual form limit; a slide deck/code walk-through does not satisfy its live-demo instruction. [KASE side-track listing](https://superteam.fun/earn/listing/superteam-kazakhstan-x-kase-side-track-corporate-actions-on-blockchain/) is a separate owner-facing application.

## Current evidence

| Item | Status and evidence | Closure condition |
| --- | --- | --- |
| Required instrument/registry/calculation/three action classes/on-chain record | Accepted disposable Localnet; [four controlled actions](../testing/controlled-workflow-integration-2026-10-12.md) and [four canonical receipts](../testing/evidence/controlled-workflow-2026-10-12/README.md) | Explain test inputs and actual finalized cutoff; keep exact evidence fingerprints |
| Source/operator improvements | Implemented; recorded [684-test checkpoint](../testing/operator-continuation-2026-10-12.md), build/proxy and 23-migration DB acceptance | Record final package validation/CI/publication separately; do not claim fresh worker/export chain acceptance |
| Current documentation | [Judge guide](JUDGE_README.md), [matrix](KASE_REQUIREMENTS_MATRIX.md), [overview](TECHNICAL_OVERVIEW.md), [status](../IMPLEMENTED_VS_SIMULATED.md), [form draft](COLLOSSEUM_SUBMISSION.md) refreshed for current source | Validate local links/fences, consistency, final exact source/media/website URLs |
| Public website | [Oracle/DuckDNS QA](https://lifecyclekase.assetguard-temirkhan.duckdns.org/qa) public 200 with hydrated English UI; source f51be25, API ready 200, isolated DB 23 migrations, protected routes 401/no-store. Docker/systemd active; financial flags disabled | Final operating-process/bot/memory observations in [Oracle runbook](../deployment/oracle-duckdns.md). Health proves interface/access boundaries, not on-chain financial execution or guaranteed uptime |
| Current English pitch + separate demo | [Pitch](lifecyclekase-pitch-en.mp4) 115.091s; [live QA demo](lifecyclekase-demo-en.mp4) 164.904s, synthetic English voice/subtitles; [validation](video-validation-2026-10-12.json). Actual running QA clicks, simulated finance; separate saved Localnet evidence | Upload to YouTube/Loom/Vimeo, verify signed-out playback, enter both actual accepted-host URLs. No upload yet |
| Main registration/details/team | Owner registration plus authenticated existing [project](https://colosseum.com/arena/projects/lifecyclekase)/[profile](https://colosseum.com/arena/profiles/temirkhan4); details Complete and team 1/1 Complete | Does not establish personal eligibility or project submission; verify signed-out reviewer access |
| Main project submission | Authenticated portal inspected 2026-10-12: **Not submitted**, video fields blank | Prepared product answers/repository context are saved; final review still identifies two missing videos. Fill accepted-host pitch/demo links, final submit, preserve organizer confirmation |
| KASE side-track submission | Form draft prepared; stored access marker HUMAN_ONLY | Owner final submit with exact source/website/pitch links and main answer updated only after actual submission |

## Exact financial presentation

Current controlled four-action fixture: coupon **1,750**; 20% partial **7,000 / burn 7**; exact 8 **8,000 / burn 8**, allocation **2/5/1**; maturity **21,000 / burn 20**, including **1,000 final coupon**. Supply **35 → 35 → 28 → 20 → 0**.

Historical three-action media has coupon **1,750**, partial **7,000 / burn 7**, maturity **29,400 / burn 28** and supply **35 → 35 → 28 → 0**. These are different fixtures. Current media must use the evidence package it actually presents.

## Scope that must remain explicit

The official contest prototype flow has accepted disposable Localnet evidence. The larger [BondFlow specification](../features/bondflow-implementation-plan.md) remains partial: public Devnet financial acceptance, period-bound coupon/principal obligations, full issuer isolation, general controlled transfers, scalable capture, multi-instrument settlement-mint reuse, native accessibility and five-user usability are open. New worker chain recovery and fresh authenticated exports are unaccepted beyond their recorded source/database/helper checks.

Simulated inputs are KZT-Test, eligibility, generated signers, accelerated time and public QA. No real fiat/KYC/legal ownership/custody/KASE/CSD/production/adoption claim is permitted. Final submission cannot manufacture missing evidence or rewrite prior records.

## Checks performed for this documentation refresh

`npm run validate` passed scaffold plus local Markdown links/fences (128 files at that check). `git diff --check` passed. `npm run controlled:evidence:verify -- docs/testing/evidence/controlled-workflow-2026-10-12/runtime.json` reran successfully for all four original receipt hashes, raw captures, reservations and supply transitions. Both historical video SHA-256 hashes were independently rechecked and match the media index. These checks do not rerun financial instructions or query RPC/PostgreSQL. The final package's broader checks/publication belong in its release record.

The [main application snapshot](MAIN_COLOSSEUM_APPLICATION_2026-10-12.md) records actual authenticated field limits and prepared answers. New hosting details are in the [Oracle/DuckDNS runbook](../deployment/oracle-duckdns.md); public QA/English hydration and API/access checks passed on 2026-10-12. Root's final operational record preserves the remaining process observations.

## Stop and resume boundary

At the owner's request, finish active processes and continue the remaining submission work later. The website runs under Docker/systemd independently of this chat. Current English MP4/SRT/TXT files and the validation record are saved. No accepted-host upload or final main/side-track submission has occurred. Resume from the existing project/media fields and these artifacts; no new feature/contract work is needed before completing upload/submission.

## Final order

1. Finish final local checks and secret/local-artifact review; publish the exact reviewed source/docs/media package.
2. Record website process/startup/availability evidence and the stable public reviewer URL.
3. Open both finished English video URLs and verify content, duration and access.
4. Complete main Colosseum application with truthful team/prior-work information; retain actual confirmation and public URLs.
5. Submit the owner-facing KASE form; retain confirmation. Update this checklist from preparation to submitted only with that evidence.

No organizer acceptance, new hosted financial execution or guaranteed permanent uptime is declared by this document.