# LifecycleKASE — reviewer guide

LifecycleKASE is a corporate-action terminal for test tokenized bonds on Solana. It covers coupon payment, partial early redemption and redemption at maturity, with holder capture, exact calculation, separate approval, reserved funding, execution and canonical receipt reconciliation.

Current published implementation: [source `8ea7a42`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/8ea7a42cc13b27c40fc4b3d2c4562a249a4fc02f) and its successful [three-job CI run](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38149599630). The registry continuation adds reasoned eligibility review/suspension/restoration, temporary verified-wallet blocking, stale-version rejection and atomic audit. Local checks passed **378 Node tests** (API 155, web 95, domain 27, Solana client 54, root 47) and all **20 migrations** in isolated HTTP/PostgreSQL acceptance. See [registry evidence](../testing/registry-governance-2026-10-11.md). It does not complete the full role matrix, issuer isolation or investor editing/closure.

## Verified prototype result

The fresh **2026-10-11 disposable Localnet run** completed these actions through the HTTP API, PostgreSQL and a newly built Solana program:

| Action | Payment | Bond supply |
| --- | --- | --- |
| Coupon | 1,750 KZT-Test | 35 → 35 |
| 20% partial redemption | 7,000 KZT-Test; 7 bonds burned | 35 → 28 |
| Redemption at maturity, including final coupon | 29,400 KZT-Test; 28 bonds burned | 28 → 0 |

[Run evidence and canonical receipts](../testing/evidence/kase-three-actions-2026-10-11.json) preserve exact transaction signatures and receipt hashes. The test reconciles API/database projection with finalized chain state and checks failed burn rollback and recovery using the original signature. The temporary validator and database are stopped after the run; these signatures do not refer to a public Explorer network.

Additional live regressions verify a mixed coupon with amounts **1 / 2 / 0 smallest settlement units**: all three rows register, only two payments execute, and the zero row remains in the final receipt without a settlement. An all-zero coupon cannot finalize or reserve funds and its partial registration can be reset.

## Interface review

The current candidate has RU/EN display languages. Select **English** in the login or QA header. Language changes preserve form values and prepared operation state. A preference cookie supplies the same language after reload. Stable identifiers, signed bytes, UTC payloads, investor names and canonical JSON are not translated.

Open [public walletless QA](https://lifecyclekase-web.onrender.com/qa) and select **English**. `/qa` is a page-local **simulation** for reviewing usability. Its synthetic roles, balances, approvals, receipts and burns do not establish blockchain execution. Reload/reset restores the fixture. The protected [operator dashboard](https://lifecyclekase-web.onrender.com/dashboard) remains a registered-wallet interface.

Both existing Render services are Live at the current source above; API deployment logs confirm migration 20 and both new review/status routes. Fresh public HTTP checks passed, including 401 `SESSION_REQUIRED` for the new protected POST routes through API and proxy. Signed-out English QA passed all four simulated registry transitions and Auditor reason/version audit without browser errors/warnings. The [deployment record](../deployment/render-staging.md) holds revision and dated observations. CI passed both Rust profiles; no local Rust/SBF/fresh-validator or financial transaction was rerun for this registry phase. Original videos remain historical media.

## Reproduce locally

Requirements: Node.js 22+, installed npm dependencies, Docker Desktop for an isolated PostgreSQL container, and the documented WSL/Anchor/Solana toolchain for the disposable validator.

```powershell
npm ci
npm run check
npm run build
npm run test:web:proxy
npm run dev:web
# Open http://localhost:3000/qa and select English.

# Fresh candidate, disposable validator and isolated database:
npm run demo:verify
```

The demo wrapper creates unique candidate artifacts and temporary test resources. It preserves the owner's retained ledger, program and signing keys. Consult [technical acceptance](../testing/submission-readiness-2026-10-11.md) and [toolchain instructions](../development/toolchain.md) for scope and results.

## Submission material and honest limits

[English demo/pitch scripts](ENGLISH_DEMO_AND_PITCH_PLAN.md) include complete narration, timing and a recording checklist. Plain [demo narration](DEMO_NARRATION_EN.txt) and [pitch narration](PITCH_NARRATION_EN.txt) are ready for rehearsal or a teleprompter. [Founder profile](FOUNDER_PROFILE_EN.md) supplies the founder introduction. The original 2026-10-10 short recordings retain historical [media source `8c0f4f1`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/8c0f4f1d250c2e1acfb73c60f7e1143fba71e9b1); they have Russian UI and no speech. They are not a recording of the newer registry controls or a completed English narrated submission.

KZT-Test and investor eligibility are simulated. Effective ownership is the finalized capture slot/time, not reconstructed ownership at an earlier planned timestamp. Real KYC, custody, fiat settlement, public-network financial acceptance, exchange/CSD integration and customer adoption require separate work. LifecycleKASE is not affiliated with or approved by KASE. No owner program upgrade, live financial transaction or hackathon submission is performed by this package.
