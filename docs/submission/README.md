# LifecycleKASE submission package

This directory is the current judge-facing package for the KASE corporate-actions side track.

Published source update — **2026-10-11**: use [current source `8ea7a42`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/8ea7a42cc13b27c40fc4b3d2c4562a249a4fc02f), its successful [three-job CI run](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38149599630), [English reviewer guide](JUDGE_README.md) and [governed registry acceptance](../testing/registry-governance-2026-10-11.md). Eligibility review/suspension/restoration and verified-wallet block/unblock have version checks and atomic audit. Local checks passed **378 Node tests** and **20 migrations** in isolated PostgreSQL. Both existing Render services are Live on this source, and API deployment logs confirm migration 20. This is a partial MVP continuation; full roles, issuer isolation and investor editing/closure remain open. See [deployment evidence](../deployment/render-staging.md) for revision and public-check observations.

The earlier defect fixes, RU/EN UI and [fresh three-action financial evidence](../testing/evidence/kase-three-actions-2026-10-11.json) remain documented in [implementation acceptance](../testing/submission-readiness-2026-10-11.md). The [founder profile](FOUNDER_PROFILE_EN.md) and historical media below support recording preparation. No new validator or video run was performed for the registry phase. New narrated videos and final submission remain outstanding.

Main Colosseum preparation — **2026-10-11**: use the [English demo/pitch plan and complete narration](ENGLISH_DEMO_AND_PITCH_PLAN.md) for Crypto World's Fair. It verifies the current English-content rule, a 2–3-minute pitch, separate demo at most 3 minutes and deadline **2026-10-13 11:59 Asia/Qyzylorda**. These are plans, not completed new videos. The existing captioned RU-interface clip below is preserved evidence; English-screen acceptance comes from fresh local/public browser checks. The [initial full audit](../PROJECT_AUDIT_2026-10-11.md) recorded two code defects and public `/qa` 404; [candidate acceptance](../testing/submission-readiness-2026-10-11.md) records their closure and [deployment](../deployment/render-staging.md). No project submission occurred.

Start with:

1. [Current KASE requirements matrix](KASE_REQUIREMENTS_MATRIX.md) — implemented, simulated and limited behavior mapped to the official brief.
2. [Superteam submission draft](COLLOSSEUM_SUBMISSION.md) — the nine official form fields, ready-to-paste text and the remaining owner inputs.
3. [Technical overview](TECHNICAL_OVERVIEW.md) — architecture, cutoff logic, calculations, settlement and Solana components.
4. [Demo narration](DEMO_NARRATION.md) — the timed English captions and presentation boundary.

The original recordings and their financial evidence retain historical source [`8c0f4f1d250c2e1acfb73c60f7e1143fba71e9b1`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/8c0f4f1d250c2e1acfb73c60f7e1143fba71e9b1). They do not show newer QA/English/registry controls or prove a completed submission. Use the current source above for implementation review and preserve this older pin for media provenance. Use an exact commit link to avoid ambiguity with the repository default branch.

## Public application

[Public walletless QA](https://lifecyclekase-web.onrender.com/qa) and the [protected operator dashboard](https://lifecyclekase-web.onrender.com/dashboard) run on the existing Render services at the current source above. The [deployment record](../deployment/render-staging.md) identifies revision, migrations, public health/protected-route checks and signed-out English coupon/role acceptance, each with its observation time. QA is a per-page simulation; operator login requires a registered wallet. Render cannot reach the owner's loopback validator, and public availability does not prove authenticated signing or financial execution. Recorded isolated Localnet runs remain the financial evidence.

## Recorded demonstration

Use the [43.28-second captioned presentation](kase-three-actions-captioned.webm) for judging: it reviews actual completed coupon, partial-redemption and maturity screens, then ends on the redeemed instrument. English captions and the permanent Localnet/test-signer disclosure sit outside the UI. It is silent and shows read-only Auditor results after execution by disposable automated test signers; it does not show physical Phantom signing.

The unchanged [44.64-second original recording](kase-three-actions.webm) also retains the mobile check and receipt downloads. The captioned copy replays its first 42 seconds with a short recording startup/closing interval; no financial action was rerun. Historical partial-redemption supply was 35 → 28; the UI's current instrument supply is already 0 after the later maturity action.

The [run evidence](../testing/evidence/kase-three-actions-2026-10-10.json) preserves the Localnet genesis, transaction signatures and exact canonical receipts. The independently downloaded [coupon](../testing/evidence/coupon_payment-2026-10-10.json), [partial-redemption](../testing/evidence/early_redemption-2026-10-10.json) and [maturity](../testing/evidence/bond_redemption-2026-10-10.json) receipts match their on-chain committed SHA-256 hashes. Screenshots: [desktop maturity](bond_redemption.png) and [mobile maturity](maturity-mobile.png).

| Video | Format | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Captioned presentation | VP8 WebM, 1440 × 1080, 25 fps, 43.28 s, no audio | 4255264 | `63bf4e3506ba4e981464aa4f7cfbcbc3a9bc38ebf1498c88a73d45354d3e4d4d` |
| Original recording | VP8 WebM, 1440 × 900, 44.64 s, no audio | 4430037 | `b6652cf20dee44de9f48e875cb666e194e0a107e6465508582eece04e16e3d6d` |

## Verified scenario results

| Action | Captured holdings | Settlement in KZT-Test | Token result |
| --- | --- | --- | --- |
| Coupon | 9 / 21 / 5 | 450 / 1050 / 250 = **1750** | Supply remains 35 |
| Early redemption, 20% | 10 / 20 / 5 | 2000 / 4000 / 1000 = **7000** | Burn 2 / 4 / 1; supply 35 → 28 |
| Maturity | 8 / 16 / 4 | 8400 / 16800 / 4200 = **29400** | Burn all 28; supply 28 → 0; instrument `REDEEMED` |

Maturity includes 28000 principal plus the 1400 final semiannual coupon. Detailed assertions, negative cases and validation are in the [three-action acceptance record](../testing/kase-three-actions-2026-10-10.md).

## Reproduce the prototype

On Windows with Docker Desktop, Node dependencies and the documented [non-root WSL Solana toolchain](../development/toolchain.md):

```powershell
npm ci
npm run demo:verify
```

The wrapper builds a unique isolated candidate, starts a loopback PostgreSQL database, creates a fresh instrument and holders on a disposable validator, and exercises authenticated HTTP workflows. It does not load the owner's `.env`, signer or ledger. It removes only its invocation-owned container, database and ledger after the run.

Optional browser recording uses an already installed Playwright module and Chromium:

```powershell
npm run demo:verify -- -Video -PlaywrightModule 'C:\path\to\playwright\index.mjs'
```

Add `-ChromiumExecutable 'C:\path\to\chrome.exe'` when Playwright's default browser revision is unavailable. Browser capture retries read the completed results and never execute a financial action again.

To recreate only the presentation from the original recording, with no API, database or validator access:

```powershell
$env:KASE_PLAYWRIGHT_MODULE = 'C:\path\to\playwright\index.mjs'
$env:KASE_CHROMIUM_EXECUTABLE = 'C:\path\to\chrome.exe' # optional
node scripts/caption-kase-demo.mjs
```

The script requires this original 1440 × 900, 44.64-second source timeline. Browser encoding may change the output duration/bytes/hash on another run; compare the published file to the exact hash above. Playwright is used from an existing installation, with no new project dependency.

## Evidence boundary

Implemented on an isolated Solana Localnet: Token-2022 instrument, verified-wallet registry, finalized holder capture, integer entitlement calculation, separate approval and full reserve, coupon transfers, atomic redemption payment plus burn, reconciliation, canonical receipts and ActionReceipt PDA hash commitments.

Simulated inputs: KZT-Test funding, registry eligibility, generated test signers, accelerated maturity and validator timing. The effective ownership cutoff is the finalized capture slot/time; the prototype does not reconstruct ownership at an earlier planned date. Localnet signatures are not public Explorer links because the disposable ledger was removed. Public-network deployment, retained-owner acceptance, real KYC/fiat and KASE/CSD integration remain outside the submitted proof.

The owner confirmed team registration on 2026-10-10 and clarified on 2026-10-11 that registration/stages are complete but the project has not yet been submitted to the main hackathon. The current answer to the side-track's project-submission question is therefore `No`. After submitting on Colosseum, update it to `Yes` and add the actual public project/profile URLs.

The [official side-track listing](https://superteam.fun/earn/listing/superteam-kazakhstan-x-kase-side-track-corporate-actions-on-blockchain/) marks final submission as `HUMAN_ONLY`. The prepared form therefore stops before login or submission. Historical engineering checkpoints remain available in the [full compliance checklist](../KASE_COMPLIANCE_CHECKLIST.md), but the current matrix above is the submission status source.
