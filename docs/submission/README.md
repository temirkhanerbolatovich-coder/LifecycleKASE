# LifecycleKASE submission package

Prepared for review: **2026-10-12**. Implementation source: [`f51be25`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/f51be252295af181ed931f00dba1ee89c35aedef). Dated runtime/media evidence retains its own fingerprints. This package maps the official KASE contest brief separately from the broader BondFlow product specification.

Start with:

For current application state, read the [submission completion record](SUBMITTED_2026-10-13.md): the owner confirmed **both Colosseum and Superteam applications submitted on 2026-10-13**. The [YouTube pitch](https://youtu.be/1aAaaKw2n_Q) was opened and played; the separate accepted-host demo URL was not supplied here. `master` and the website/media update are published. The [GitHub/hosting follow-up](PUBLICATION_2026-10-12.md) and [earlier stop checkpoint](CHECKPOINT_2026-10-12.md) retain their historical evidence.

1. [English reviewer guide](JUDGE_README.md): result, access, reproduction and limits.
2. [KASE requirements matrix](KASE_REQUIREMENTS_MATRIX.md): criterion-by-criterion evidence.
3. [Technical overview](TECHNICAL_OVERVIEW.md): capture, calculation, approval, payment/burn and verification.
4. [Submission checklist](SUBMISSION_CHECKLIST_2026-10-12.md): remaining inputs and publication/submission gates.
5. [Main Colosseum application snapshot](MAIN_COLOSSEUM_APPLICATION_2026-10-12.md): actual account fields, stricter media limits and inspected submission state.
6. [Superteam form draft](COLLOSSEUM_SUBMISSION.md): exact nine-field side-track draft.
7. [English pitch/demo plan](ENGLISH_DEMO_AND_PITCH_PLAN.md): main hackathon video deliverables.

## Deadline and application format

Public organizer rules were rechecked **2026-10-12**. The [Crypto World's Fair rules, section 5](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) close submissions **2026-10-12 23:59 Pacific**, equivalent to **2026-10-13 11:59 Asia/Qyzylorda**, `2026-10-13T06:59:00Z`. [Section 12](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) requires English content; the [official FAQ](https://colosseum.com/hackathon?year=fall2026) specifies a **2–3 minute pitch/presentation** and a **separate demo of at most 3 minutes**. The authenticated application was inspected on **2026-10-12** and imposes a stricter **pitch of up to 2 minutes (120 seconds)**, with a **separate demo up to 3 minutes**. Both fields accept **YouTube, Loom or Vimeo links**. The demo must show the live product, rather than a slide deck or code walk-through. Use those actual field limits for the final files; the FAQ's general 2–3 minute guidance is not the controlling upload limit.

The [Superteam KASE listing](https://superteam.fun/earn/listing/superteam-kazakhstan-x-kase-side-track-corporate-actions-on-blockchain/) is a separate application. Its required source/video/technical-description fields and three scenario brief are mapped below. The authenticated portal inspection on 2026-10-12 recorded an existing [project](https://colosseum.com/arena/projects/lifecyclekase) and [founder profile](https://colosseum.com/arena/profiles/temirkhan4), completed details/team and **Not submitted** with blank video fields. That is historical preparation state, superseded by the owner's 2026-10-13 confirmation that both applications were submitted. Organizer receipts are not independently archived here.

## Financial proof

The [controlled application package](../testing/evidence/controlled-workflow-2026-10-12/README.md) preserves four original canonical receipts, original signatures, raw captured account bytes, assigned-unit reservations, runtime/log and source/SBF/IDL fingerprints. Its accepted HTTP/PostgreSQL/Localnet run ended **2026-10-12 14:19:06 Asia/Qyzylorda**:

| Action | Payment, KZT-Test | Bonds burned | Supply |
| --- | ---: | ---: | --- |
| Coupon | 1,750 | 0 | 35 → 35 |
| Percentage partial, 20% | 7,000 | 7 | 35 → 28 |
| Exact-target partial, 8 | 8,000 | 8 | 28 → 20 |
| Maturity, with final coupon | 21,000 | 20 | 20 → 0 |

The exact target allocates 2/5/1 from 8/16/4. All four receipts finalized and database/chain evidence reconciled. Original-signature recovery after finalized burn/source closure and unchanged historical redemption receipts at current supply zero passed. The [acceptance record](../testing/controlled-workflow-integration-2026-10-12.md) gives precise boundaries.

The later [operator continuation](../testing/operator-continuation-2026-10-12.md) records 684 Node tests, build/proxy, 23-migration database acceptance, six-step master, JSON/CSV export, complete database overview and a default-off observation worker. Fresh worker chain recovery and authenticated export download against new settlement remain open; their source implementation is not another financial runtime.

## Website

The public reviewer URL is [English-capable walletless QA](https://lifecyclekase.assetguard-temirkhan.duckdns.org/qa), on the existing Oracle VPS with DuckDNS/Caddy HTTPS. Runtime source is **`c835394`**, verified **2026-10-13 Asia/Qyzylorda**: QA/English hydration, API readiness and all ten static assets passed; the isolated database retains **23 migrations**, unsigned protected routes return **401 SESSION_REQUIRED** with `no-store`, and media/HTTPS checks passed. Financial/controlled/upgrade/worker flags remain disabled. Website/bot startup was observed after the approved VPS reboot; AssetGuard remains stopped with its files/volumes retained. The [Oracle runbook](../deployment/oracle-duckdns.md) and [update record](../testing/evidence/oracle-submission-2026-10-12/update-2026-10-13.json) establish interface/access boundaries, not hosted financial execution or guaranteed uptime.

The [operator dashboard](https://lifecyclekase.assetguard-temirkhan.duckdns.org/dashboard) requires a registered wallet. The new hosting database contains no copied owner/financial records. Earlier [Render staging](../deployment/render-staging.md) remains historical evidence.

A successful web/health response does not establish hosted signing, financial execution or access to the owner's loopback validator. Recorded disposable Localnet packages remain the financial evidence. Docker restart policies and the dedicated systemd unit avoid free Render idle sleeping; VPS, network, DNS and application availability still have their ordinary operational limits.

## Media

Current English media is retained locally: [pitch](lifecyclekase-pitch-en-benjamin.mp4) **115.104 seconds** and [live interface demo](lifecyclekase-demo-en-benjamin.mp4) **164.964 seconds**, within the authenticated form's 120/180-second caps. Both use explicit English **Runway Benjamin synthetic narration** and burned subtitles. The demo records actual clicks in the running `/qa` interface; its payments/burns are page-local simulation. A separate evidence segment identifies saved controlled Localnet results; no new financial transaction was recorded. [Validation](benjamin-video-validation-2026-10-12.json) preserves measured metadata, hashes and narration timing; the original capture record remains linked from the video plan. The [YouTube pitch](https://youtu.be/1aAaaKw2n_Q) plays at 1:55 with Unlisted visibility. Both applications are owner-confirmed submitted; the separate accepted-host demo URL and organizer receipts are not archived here. See [completion](SUBMITTED_2026-10-13.md). Preserve raw financial evidence and the distinction between QA simulation and recorded Localnet execution.

The original [Zira pitch](lifecyclekase-pitch-en.mp4), [Zira demo](lifecyclekase-demo-en.mp4) and [original capture/validation](video-validation-2026-10-12.json) are preserved. The user selected Benjamin and uploaded the pitch to YouTube.

Direct backup copies are available: [Benjamin pitch MP4](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-pitch-en-benjamin.mp4), [pitch SRT](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-pitch-en-benjamin.srt), [pitch transcript](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-pitch-en-benjamin.txt), [Benjamin demo MP4](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-demo-en-benjamin.mp4), [demo SRT](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-demo-en-benjamin.srt) and [demo transcript](https://lifecyclekase.assetguard-temirkhan.duckdns.org/media/lifecyclekase-demo-en-benjamin.txt). All six remote hashes matched; external MP4 ranges returned 206 and SRT/TXT returned 200. These backups do not replace the organizer's YouTube/Loom/Vimeo fields.

Historical media from [source `8c0f4f1`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/8c0f4f1d250c2e1acfb73c60f7e1143fba71e9b1) remains available:

| File | Recorded scope | Duration / format | SHA-256 |
| --- | --- | --- | --- |
| [Captioned presentation](kase-three-actions-captioned.webm) | Silent English captions over earlier Russian Auditor results | 43.28 s, VP8 WebM, 1440 × 1080 | `63bf4e3506ba4e981464aa4f7cfbcbc3a9bc38ebf1498c88a73d45354d3e4d4d` |
| [Original recording](kase-three-actions.webm) | Unchanged earlier results/mobile/download review | 44.64 s, VP8 WebM, 1440 × 900 | `b6652cf20dee44de9f48e875cb666e194e0a107e6465508582eece04e16e3d6d` |

Those clips show the earlier coupon 1,750 → partial 7,000/burn 7 → maturity 29,400/burn 28 fixture. That fixture has no intervening exact-target action. It differs from today's four-action maturity 21,000/burn 20. Do not combine their values or imply they show the newest UI/protocol.

Current Benjamin files and SHA-256:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| [Pitch MP4](lifecyclekase-pitch-en-benjamin.mp4) | 9,636,953 | `4bf339eca3a79089d5726da9944fc1e2e73518592e858e51d1d0f8bb287e8771` |
| [Demo MP4](lifecyclekase-demo-en-benjamin.mp4) | 31,204,749 | `2ad90c3577af82d223038c37e9158428ed960775cad87342c82d92a63b627e48` |

## Reproduce

With Node.js 22+, Docker Desktop and the [documented WSL toolchain](../development/toolchain.md):

```powershell
npm ci
npm run build:web
npm run check
npm run test:controlled:workflow
```

Check saved evidence offline:

```powershell
npm run controlled:evidence:verify -- docs/testing/evidence/controlled-workflow-2026-10-12/runtime.json
```

The wrapper creates and removes invocation-owned disposable resources. It does not use the retained owner ledger/signers/`.env`. The separate legacy/exact harness remains `npm run demo:verify`; consult its [dated exact-target acceptance](../testing/bondflow-exact-redemption-2026-10-12.md).

## Claim boundary

Implemented on a disposable Solana Localnet: Token-2022 issuance, verified-wallet registry, controlled raw capture, integer entitlement calculation, separate approval and reserve, coupon payment, atomic assigned-unit redemption, original-signature recovery, reconciliation and receipt hash/PDA commitment.

Simulated: KZT-Test funding, registry eligibility, generated signers, accelerated maturity and public QA. Public Devnet/Mainnet, owner rollout of the newer candidate, real KYC/fiat/KASE/CSD, full roles/issuer isolation, general controlled transfers, multi-instrument settlement-mint reuse, period-specific coupon uniqueness and production operations are not claimed. [Current implementation status](../IMPLEMENTED_VS_SIMULATED.md) and [BondFlow plan](../features/bondflow-implementation-plan.md) contain the remaining product requirements.

The owner completed the final submissions, consistent with the side-track listing's stored `HUMAN_ONLY` access marker. Keep final field values, exact published commit, media URLs and organizer confirmation when available; the completion record distinguishes the owner's report from independently captured organizer evidence.
