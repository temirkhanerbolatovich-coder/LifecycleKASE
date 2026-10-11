# LifecycleKASE — reviewer guide

LifecycleKASE is a corporate-action terminal for test tokenized bonds on Solana. It covers coupon payment, partial early redemption and redemption at maturity, with holder capture, exact calculation, separate approval, reserved funding, execution and canonical receipt reconciliation.

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

`/qa` is a walletless, page-local **simulation** for reviewing usability. Its synthetic roles, balances, approvals, receipts and burns do not establish blockchain execution. Reload/reset restores the fixture. The protected `/dashboard` remains a registered-wallet operator interface. Public staging is a separate deployment checkpoint; a local candidate is not automatically available there.

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

[English demo/pitch scripts](ENGLISH_DEMO_AND_PITCH_PLAN.md) include complete narration, timing and a recording checklist. Plain [demo narration](DEMO_NARRATION_EN.txt) and [pitch narration](PITCH_NARRATION_EN.txt) are ready for rehearsal or a teleprompter. [Founder profile](FOUNDER_PROFILE_EN.md) supplies the founder introduction. The original 2026-10-10 short recordings are retained as historical evidence; they have Russian UI and no speech. They are not a completed English narrated submission.

KZT-Test and investor eligibility are simulated. Effective ownership is the finalized capture slot/time, not reconstructed ownership at an earlier planned timestamp. Real KYC, custody, fiat settlement, public-network financial acceptance, exchange/CSD integration and customer adoption require separate work. LifecycleKASE is not affiliated with or approved by KASE. No owner program upgrade, live financial transaction or hackathon submission is performed by this package.
