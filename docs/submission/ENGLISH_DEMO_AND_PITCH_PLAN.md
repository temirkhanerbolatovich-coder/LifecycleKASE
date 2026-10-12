# English pitch and live interface demo — submission record

Prepared **2026-10-12**, Asia/Qyzylorda, against [source `f51be25`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/f51be252295af181ed931f00dba1ee89c35aedef). This pin identifies the recorded application; the later submission-package commit adds the videos and documentation. Financial evidence is the separately fingerprinted [completed controlled workflow](../testing/evidence/controlled-workflow-2026-10-12/README.md).

## Actual portal requirements

The authenticated [Colosseum media form](https://colosseum.com/arena/hackathon/project/editor?section=media&returnSection=overview), inspected on **2026-10-12**, requires a **pitch no longer than two minutes**, a **live-product demo no longer than three minutes**, and video links hosted on **YouTube, Loom or Vimeo**. The live form's two-minute pitch cap takes precedence over the public FAQ's two-to-three-minute guidance. A slide or code walkthrough alone does not satisfy the demo field.

A local MP4 or direct website `/media/` link is a review/backup asset, not an accepted-host submission link. Upload, signed-out playback and actual submission confirmation remain separate checks. This document does not establish personal/team eligibility, complete registration or final submission.

## Produced videos

| Artifact | Content | Measured duration |
| --- | --- | --- |
| [English pitch](lifecyclekase-pitch-en.mp4) | Product problem, operator hypothesis, workflow, four-action test results, founder, proposed pilot and limits | **115.091 seconds**; cap 120 seconds |
| [English live interface demo](lifecyclekase-demo-en.mp4) | Actual recorded interactions in the running application's English `/qa` mode: registries, coupon, partial redemption, maturity, simulated receipt download and read-only auditor history; brief separate Localnet evidence card | **164.904 seconds**; cap 180 seconds |
| [Pitch subtitles](lifecyclekase-pitch-en.srt) / [narration](lifecyclekase-pitch-en.txt) | Complete English text, also burned into the video | Timed from measured WAV segments |
| [Demo subtitles](lifecyclekase-demo-en.srt) / [narration](lifecyclekase-demo-en.txt) | Complete English text, also burned into the video | Timed from measured WAV segments |

Narration uses the installed **Microsoft Zira Desktop** English synthetic voice. It does not impersonate the founder. His background comes from the user-supplied [profile](FOUNDER_PROFILE_EN.md). No customer, revenue, partnership, market-size or production-settlement claim is introduced.

Exact final durations, hashes, dimensions, audio measurements and capture operations are retained in [video validation](video-validation-2026-10-12.json).

## Demo narrative and evidence boundaries

| Approximate time | Recorded behavior | Scope |
| --- | --- | --- |
| 00:00–00:33 | English QA overview and registries | Running production web build; walletless page-local simulation |
| 00:33–00:55 | Coupon: schedule, capture, calculate, submit, fund/reserve, distinct approver, three payments, finalize | Synthetic `10/20/5`; payments `500/1000/250`, total **1,750 KZT-Test** |
| 00:55–01:21 | 20% partial redemption through the same sequence | **7,000 KZT-Test**, **7** simulated burns, supply **35 → 28** |
| 01:21–01:44 | Maturity through the same sequence | **29,400 KZT-Test**, **28** simulated burns, supply **28 → 0** |
| 01:44–02:02 | Download simulated receipt; Auditor transaction/audit review | QA receipts contain no real chain evidence |
| 02:02–02:24 | Brief completed disposable Localnet result card | Separate four-action fixture includes an extra exact-target redemption |
| 02:24–02:45 | Reproduction and limits | Test assets; no new signing or public-network acceptance |

The **financial four-action run** differs from the three-action QA sequence. It completed authenticated HTTP issuance and controlled actions on a fresh disposable database/validator on **2026-10-12 13:55–14:19 Asia/Qyzylorda**:

| Action | KZT-Test | Burn | Supply |
| --- | --- | --- | --- |
| Coupon | 1,750 | 0 | 35 → 35 |
| Historical 20% partial | 7,000 | 7 | 35 → 28 |
| Exact target 8 | 8,000 | 8 | 28 → 20 |
| Maturity including final coupon | 21,000 | 20 | 20 → 0 |

The financial run's capture-boundary coupon positions were `9/21/5`, with `450/1050/250` payments. Its extra exact-target action explains why maturity pays **21,000** for **20** bonds, whereas QA maturity pays **29,400** for **28**. The narration explicitly distinguishes them. Original canonical bytes/hashes remain in the evidence package; video labels and translation never modify signed/canonical data.

Interface footage is actual automated interaction with the running application. It is a **live interface demonstration with simulated financial effects**. It does not show physical Phantom approval, a newly signed transaction, an authenticated owner session or continuously queryable disposable history. The acceptance ledger was stopped after its run. A reviewer requiring real wallet signing during recording must use the separate evidence/reproduction path; the video does not assert that additional acceptance.

## Reproduce the media

The [storyboard](video-storyboard-2026-10-12.json) contains the exact narrative and source/evidence pins. Intermediates stay in ignored `.local-submission-media-20261012/`; validated judged MP4/SRT/TXT and records are copied here.

Requirements: installed Windows English System.Speech voice, Pillow/Segoe fonts, installed Playwright and Chrome. Codex bundled Python includes Pillow. No project dependency, paid service, owner key or system service was added. Chrome H.264/AAC MediaRecorder creates the MP4; full FFmpeg installation is unnecessary.

```powershell
# Resolve these paths using the workspace-dependencies tool.
$pitchPython = '<bundled Python executable>'
$env:KASE_PLAYWRIGHT_MODULE = '<installed Playwright index.mjs>'
powershell -NoProfile -File scripts/synthesize-submission-narration.ps1 -Rate 1
& $pitchPython scripts/render-submission-videos.py

# Separate terminal, existing production build:
# node node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3033
node scripts/capture-submission-qa.mjs
node scripts/encode-submission-videos.mjs
node scripts/verify-submission-videos.mjs
```

Capture defaults to isolated `http://127.0.0.1:3033/qa`, uses its own Chrome profile and permits only `/qa`. All operations stay in page-local synthetic state. It records the three complete action sequences, separate approver switches and simulated receipt download. Encoding combines the actual footage with English speech/captions and a brief saved-proof card. No balances, signatures or outcomes are fabricated.

Validation checks helper syntax, original receipt hashes before rendering, caption fit, narration/timeline duration, MP4 audio/video decoding, 1920×1080 dimensions, duration caps, non-silent audio without clipping, and playback samples across the action/auditor/results/closing scenes. Sampled playback is not a frame-by-frame or human accessibility review.

## Delivery and remaining checks

Generation and validation are separate from upload. Preserve the original historical [WebM](kase-three-actions.webm) and [captioned copy](kase-three-actions-captioned.webm); Russian UI and older source remain historical media.

Use an accepted host, wait for processing, test both videos while signed out, and enter actual playable links. Recheck English content, current constraints, prior-work disclosure, member eligibility and exact source access. Save actual submission confirmation/project URL and separately verify the KASE side-track application.

Real KYC, custody, fiat settlement, public-network financial acceptance, exchange/CSD integration, native wallet/manual accessibility acceptance and measured demand remain separate milestones. **LifecycleKASE is not affiliated with or approved by KASE.**
