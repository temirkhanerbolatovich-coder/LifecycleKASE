# LifecycleKASE — reviewer guide

LifecycleKASE services test tokenized bonds after issuance. The operator captures holders, calculates entitlements, obtains separate approval and a full action reserve, executes coupon or redemption, reconciles finalized evidence and commits the final receipt hash on Solana. The prototype is not affiliated with or approved by KASE.

Implementation snapshot: **2026-10-12**, [source `f51be25`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/f51be252295af181ed931f00dba1ee89c35aedef). The current source contains controlled instrument v2, exact-target redemption, a six-step action master, JSON/CSV evidence export, full-database overview and a default-off confirmation worker. [Current scope](../IMPLEMENTED_VS_SIMULATED.md) identifies what is accepted and what remains. Hosted source is `f51be25` on the owner's Oracle VPS; public QA/English hydration, API readiness and protected-route denials passed on 2026-10-12 with 23 migrations in a new isolated database. Financial capabilities remain disabled. See [current hosting](../deployment/oracle-duckdns.md); older Render observations remain historical.

## Verified financial result

The accepted **2026-10-12 disposable Localnet run** completed controlled issuance and four financial actions through authenticated HTTP, PostgreSQL and the reviewed Anchor/Token-2022 binary:

| Action | Payment, KZT-Test | Bonds burned | Supply |
| --- | ---: | ---: | --- |
| Coupon | 1,750 | 0 | 35 → 35 |
| 20% partial redemption | 7,000 | 7 | 35 → 28 |
| Exact-target partial, 8 units | 8,000 | 8 | 28 → 20 |
| Maturity, principal plus final coupon | 21,000 | 20 | 20 → 0 |

The exact partial allocates **2/5/1** from captured balances **8/16/4**, avoiding the seven-unit result from independent floor rounding. Maturity pays 20,000 principal plus 1,000 final coupon. The instrument becomes `REDEEMED` only after matched cash/burn evidence and zero supply.

[Runtime, raw capture evidence, reservations and four canonical receipts](../testing/evidence/controlled-workflow-2026-10-12/README.md) preserve exact signatures and SHA-256 commitments. The accepted runtime verified wire/role/Origin rejection, replay protection, atomic audit rollback, original-signature recovery after a finalized burn and closed source account, and unchanged historical partial receipts after maturity. Its validator/database were disposable; these are not public Explorer signatures. [Acceptance and fingerprints](../testing/controlled-workflow-integration-2026-10-12.md) identify the precise executed source/binary. Offline checks establish saved consistency and do not re-query a live chain.

## Interface review

Open [public walletless QA](https://lifecyclekase.assetguard-temirkhan.duckdns.org/qa) and select **English**. This is a page-local **simulation** for usability review: roles, balances, approvals, receipts and burns are synthetic. Reload/reset restores the fixture. The [operator dashboard](https://lifecyclekase.assetguard-temirkhan.duckdns.org/dashboard) requires a registered wallet.

The RU/EN workspace preserves forms, reviewed transaction plans and original signatures across navigation/language changes. Its six action steps make terms, capture, calculation, readiness, approval and execution visible. Administrator mutations and Auditor read-only views include registry profiles, transaction/audit journals and evidence access.

The latest operator continuation records **684 Node tests**, typechecks, Prisma, production build/proxy and real disposable PostgreSQL acceptance with **23 migrations**. Worker leases/fencing/rollback and complete 10,000-action/10,000-investor querying passed. Browser fixture checks use an isolated production copy with synthetic responses. The newly added worker's fresh chain recovery and export download against fresh settlement remain open; the previous financial run does not accept those additions. See [operator checkpoint](../testing/operator-continuation-2026-10-12.md).

## Reproduce and verify

Requirements: Node.js 22+, lockfile dependencies; Docker Desktop and the documented [non-root WSL Solana/Anchor toolchain](../development/toolchain.md) for financial reproduction.

```powershell
npm ci
npm run build:web
npm run check
npm run build
npm run test:web:proxy
npm run dev:web
# Open http://localhost:3000/qa and select English.
```

In a separate disposable runtime:

```powershell
npm run test:controlled:workflow
```

Verify the saved original financial package without RPC/database access:

```powershell
npm run controlled:evidence:verify -- docs/testing/evidence/controlled-workflow-2026-10-12/runtime.json
```

The harness creates invocation-owned validator/database/signers and preserves the retained owner environment. The [testing strategy](../testing/testing-strategy.md) describes evidence levels.

## Submission media and boundaries

Current English media is ready locally: [pitch](lifecyclekase-pitch-en-benjamin.mp4) **115.104 seconds** and [live interface demo](lifecyclekase-demo-en-benjamin.mp4) **164.964 seconds**, within the authenticated form's 120/180-second caps. Both use explicit English **Runway Benjamin synthetic narration** and burned subtitles. The demo records actual clicks in the running `/qa` interface; its payments/burns are page-local simulation. A separate evidence segment identifies saved controlled Localnet results; no new financial transaction was recorded. [Validation](benjamin-video-validation-2026-10-12.json) preserves measured metadata, hashes and narration timing; the original capture record remains linked from the video plan. **YouTube/Loom/Vimeo upload has not occurred**, so accepted-host links and final main/side-track submission remain outstanding. The original [43.28-second captioned clip](kase-three-actions-captioned.webm) and [44.64-second recording](kase-three-actions.webm) remain historical media from source `8c0f4f1`; they show Russian UI, no speech and the earlier three-action result review. They do not record controlled v2, the new operator master or current four-action execution.

KZT-Test, eligibility, generated signers and accelerated timing are synthetic. New default-frozen v2 holdings are locked during raw capture; only assigned redemption units are reserved. Legacy mints retain their earlier unrestricted policy. The effective cutoff is the actual finalized capture slot/time, with no reconstruction at an arbitrary past date.

Real KYC, custody, fiat, KASE/CSD integration, public-network financial acceptance, retained-owner rollout of the newer candidate, full issuer isolation, period-level coupon uniqueness and full manual accessibility/usability remain separate work. No traction, production readiness or official event acceptance is claimed. The [current checklist](SUBMISSION_CHECKLIST_2026-10-12.md) records remaining application gates.