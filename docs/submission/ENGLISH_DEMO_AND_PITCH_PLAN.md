# English demo and pitch plan — Crypto World's Fair

Prepared: **2026-10-11**, Asia/Qyzylorda. This is a recording plan and English script; no new narrated recording, upload or submission was performed. The initial plan inspected the working tree based on `eb7a6025cadb45229949a7107f7e0a72c07e1058`. Current published [source `8ea7a42`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/8ea7a42cc13b27c40fc4b3d2c4562a249a4fc02f) includes RU/EN/QA and the governed registry continuation; all three [CI jobs](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38149599630) passed. Both existing Render services are Live on this source, with migration 20 applied. The [deployment record](../deployment/render-staging.md) holds revision and public-check observations. Preserve the original recordings/canonical receipts and their historical media source `8c0f4f1`.

Registry continuation: reasoned eligibility review/suspension/restoration and temporary verified-wallet block/unblock passed **378 Node tests** and isolated HTTP/PostgreSQL acceptance with **20 migrations**. Versions and atomic audit protect transitions; current eligibility is checked without rewriting captured snapshots. See [acceptance](../testing/registry-governance-2026-10-11.md). This is partial MVP progress; issuer isolation, the full role matrix and investor editing/closure remain open. No new financial/validator run or recording was performed for this phase.

## Target and verified rules

The user identified [Arena hackathon](https://colosseum.com/arena/hackathon). Its authenticated page was not read by the public web reader; the current official public campaign is [Crypto World's Fair](https://colosseum.com/worldsfair), rather than the 2025 Cypherpunk or earlier announced 2026 fall schedule.

The following requirements were checked on **2026-10-11**:

- [Current event rules, sections 5 and 6](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf): build window **2026-09-14 06:00 PT → 2026-10-12 23:59 PT**. With PDT UTC−7 this is **2026-09-14 18:00 → 2026-10-13 11:59 Asia/Qyzylorda**, close `2026-10-13T06:59:00Z`. Each member registers; the team leader submits before closing. Rules can be changed by the organizer, so recheck the portal immediately before submission.
- [Rules, sections 3, 7 and 12](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf): personal eligibility, one team/product, content rights and **English content** must be checked. Registration is not proof of complete eligibility or project submission. No age/residence/funding conclusion about this team is asserted here.
- [Current official FAQ](https://colosseum.com/hackathon?year=fall2026): prepare a **2–3 minute presentation/pitch** and a **separate demo of at most 3 minutes**. GitHub is requested; public source is encouraged and private access is permitted for reviewers. Disclose prior development; only competition-period work is judged. Team/background/location, product description/logo, tools, distribution and demand-validation context belong in the package.

The [Superteam Kazakhstan × KASE side track](https://superteam.fun/earn/listing/superteam-kazakhstan-x-kase-side-track-corporate-actions-on-blockchain/) is a separate application. Its inspected local [form draft](COLLOSSEUM_SUBMISSION.md) records a pitch/deck/video link and an owner-only submission. Recheck its live form separately; do not replace main-Colosseum requirements with this nine-field side-track draft.

**Not verified:** current authenticated form field limits, accepted video hosts/file extensions, file-size caps, required public/unlisted visibility, subtitle-upload support, final account submission state and whether English captions alone make Russian UI acceptable under the English-content rule. No MP4 codec, 1080p setting or recording tool below is an official mandate.

## Current evidence and the gaps

| Asset | What it establishes | What it does not establish |
| --- | --- | --- |
| Existing [43.28 s captioned demo](kase-three-actions-captioned.webm) and [44.64 s original](kase-three-actions.webm) | Read-only review of a completed disposable Localnet run; coupon, partial redemption, maturity and receipts | Spoken pitch, founder/business story, live physical Phantom signing or all-English visible UI |
| [Canonical receipts and run record](../testing/evidence/kase-three-actions-2026-10-10.json) | Recorded on-chain test payments/burns/final receipts; exact evidence can be checked | Public Devnet/Mainnet Explorer, retained-owner rollout or continuously queryable disposable ledger |
| [Public dashboard](https://lifecyclekase-web.onrender.com/dashboard) | Hosted application staging; recorded availability details are in [deployment record](../deployment/render-staging.md) | Cloud access to owner's loopback validator, anonymous financial access or new settlement acceptance |
| Published `/qa` [sandbox](../features/qa-sandbox.md) | Walletless page-local synthetic UX exercise in RU/EN | Solana execution, real wallet auth, database persistence or real money |
| [Pinned submission package](README.md) | Current source `8ea7a42` with three CI jobs passed and both Render services Live; historical media `8c0f4f1`; separate registry/financial evidence | Deployment observations do not establish authenticated financial execution or actual project submission |

The saved Localnet numbers are **1,750 KZT-Test coupon**, **7,000 KZT-Test partial redemption with 7 burned**, then **29,400 KZT-Test maturity including final coupon with 28 burned and supply 0**. After later maturity, a historical partial card can show current supply 0; use its action receipt to demonstrate the earlier 35 → 28 change. Never narrate current supply as if it were the historical partial result.

Initial audit observation, **2026-10-11, before publication**: the public `/qa` route returned **404** after Render woke up; `/dashboard` displayed wallet login with an initial session/API connection warning. The subsequent release closed the public QA gate: HTTP **200**, signed-out English selection, all three roles and a full synthetic coupon simulation passed. Use the QA disclosure for interface demonstrations and the separate recorded Localnet evidence for financial results.

The present package has technical demonstration material and the founder-supplied introduction. A main-hackathon application still needs accurate team/prior-work entries, two finished English videos and reviewable links. The business story is explicitly a hypothesis awaiting operator validation. This plan does not declare the application eligible or ready to send.

## Recording choices

Recommended deliverables are **two separate English videos**: a **2:40 pitch** and a **2:50 demo**, leaving headroom below the three-minute boundary. Times below are rehearsal targets, not claims about files already produced. Record the pitch as face-camera plus 5–6 simple cards; record the demo as an English UI/result review with narration. Clear audio and legible proof matter more than animations.

Clean reading copies: [demo narration — 300 words](DEMO_NARRATION_EN.txt), [pitch narration — 299 words](PITCH_NARRATION_EN.txt). They contain the spoken text only. Read through once and measure your actual pace before recording; the proposed times are not measured video durations.

Before recording, choose one explicitly labelled evidence mode:

1. **Completed Localnet result review** — simplest reliable path. Use the real recorded run/receipts and an English presentation of their exact results. State that execution was completed before recording. Do not invent an interactive signing scene or silently replace financial evidence with QA.
2. **Fresh disposable Localnet execution** — stronger operator demonstration if there is time. Rehearse with `npm run demo:verify` in its isolated environment. Actual manual wallet use additionally requires a disposable compatible wallet/session/roles and accepted program configuration; the automated wrapper does not prove physical Phantom signing. No owner ledger reset or owner transaction is needed for filming.
3. **QA usability tour** — optional short insert only, labelled **QA simulation; no blockchain execution**. It can show navigation/accessibility but must not be the financial proof segment. Keep it visibly distinct from the Localnet segment.

Implementation and publication update, 2026-10-11: the released application has a tested RU/EN interface; choose English before recording. See [candidate acceptance](../testing/submission-readiness-2026-10-11.md), [public deployment](../deployment/render-staging.md) and remaining KK work in the [localization plan](../features/localization-plan.md). Preserve raw receipts and old Russian recordings as dated evidence.

## Demo: 2:50 storyboard and complete narration

Use a steady pace of approximately 105–135 words/minute, with the faster passages rehearsed or shortened if needed. Pause after each visible figure. The demo narration has 300 words; rehearse with the actual screens and measure the final rendered duration. Read `KZT-Test` as **“K Z T test”**, not “tenge.” Display a persistent lower band: **Disposable Solana Localnet · KZT-Test and eligibility simulated**.

| Time | Screen / proof | English narration |
| --- | --- | --- |
| 00:00–00:15 | Product title; clear Localnet disclosure | “This is LifecycleKASE, a corporate-action terminal for tokenized bonds. In this demo, we review a completed run on a disposable Solana local network. It is a prototype, not a production financial service.” |
| 00:15–00:35 | Instrument: 35 zero-decimal bonds, issuer and separate approver | “The test instrument starts with thirty-five bonds held by three investors. The workflow separates issuer preparation from approval. Each financial operation uses a saved transaction, an explicit signer, and finalized confirmation.” |
| 00:35–01:00 | Coupon snapshot, entitlement table, planned versus effective times | “For the coupon, the finalized holder snapshot is nine, twenty-one, and five bonds. Entitlements are four hundred fifty, one thousand fifty, and two hundred fifty K Z T test: seventeen hundred fifty in total. The effective ownership cutoff is the finalized capture slot and time. We do not reconstruct balances at an earlier planned timestamp.” |
| 01:00–01:20 | Coupon payment rows/reserve, finalized receipt | “The full amount is reserved before execution. Confirmed transfers and a final receipt establish the coupon result. The bond supply stays at thirty-five. This is an on-chain test-token transfer, not a real fiat payment.” |
| 01:20–01:45 | Partial action receipt, cash/asset legs with same signature | “Next, twenty percent partial redemption pays seven thousand K Z T test and burns seven bonds. The historical supply changes from thirty-five to twenty-eight. Payment and burn share one transaction. If an on-chain leg fails, both legs roll back.” |
| 01:45–02:10 | Maturity amounts, burn, instrument REDEEMED | “At maturity, the remaining twenty-eight bonds receive twenty-nine thousand four hundred K Z T test, including the final coupon. All remaining bonds are burned. Supply reaches zero and the instrument becomes redeemed.” |
| 02:10–02:35 | Exact canonical receipt, hash and ActionReceipt PDA; recovery explanation | “Each action produces a versioned canonical JSON receipt. Its exact SHA two fifty-six hash is committed to a Solana receipt account. Cash, token effects, and finalized signatures are reconciled before database projection. An unknown confirmation requires checking the original signature, not submitting a replacement payment.” |
| 02:35–02:50 | Closing proof/limits card; repository link | “Funding and eligibility are simulated. Public-network deployment, real K Y C, fiat settlement, and exchange integration remain future work. The repository contains the saved evidence and instructions to reproduce this local run.” |

For an optional real-signing segment, replace—not add to—the 00:15–00:35 scene with one rehearsed prepare → review → wallet-sign → confirm action. Keep the title card explicit about which operation was signed in this recording. Do not narrate an old screenshot as a new signature.

## Pitch: 2:40 storyboard and complete narration

Audience: Colosseum judges evaluating a new product/business, not only the KASE side-track's technical acceptance. The commercial and customer statements below are hypotheses and proposed next steps. The founder supplied the introduction below on 2026-10-11; there are no invented users, partnerships or market-size numbers.

| Time | Card | English narration |
| --- | --- | --- |
| 00:00–00:20 | “A bond's lifecycle does not end at issuance” | “Tokenizing a bond is only the beginning. The issuer still needs to identify holders, calculate what they are owed, approve the budget, pay them, and prove what happened. LifecycleKASE brings that post-issuance workflow into one operator terminal.” |
| 00:20–00:40 | “Our first user: the corporate-action operator” | “Our starting hypothesis is a narrow one: operators servicing test tokenized bonds need a consistent path from holder records to a verifiable action result. We focus on coupon payments, partial early redemption, and redemption at maturity.” |
| 00:40–01:05 | “Prepare → capture → calculate → approve → execute → reconcile” | “The prototype combines a web terminal, a wallet-authenticated API, PostgreSQL, and a Solana program. A finalized snapshot fixes entitlements. A separate approver and full reserve precede execution. For redemption, payment and token burn happen atomically. The final receipt hash is committed on-chain.” |
| 01:05–01:25 | Three saved result figures | “Our completed local test pays seventeen hundred fifty K Z T test in coupon, redeems twenty percent for seven thousand, then settles maturity for twenty-nine thousand four hundred. The remaining token supply reaches zero. These are reproducible technical results, not customer traction or real fiat settlement.” |
| 01:25–01:45 | Temirkhan Erbolatovich — Full-stack Developer | “I am Temirkhan Erbolatovich, a full-stack developer with two years of project-based freelance experience. I also worked as a C-sharp developer at NIS and completed an internship at KazDream Holding.” |
| 01:45–02:10 | “Validate the operator problem before expanding” | “We have not yet established customer adoption or willingness to pay. Next, we plan to observe corporate-action operators using the prototype and compare reconciliation time, errors, and evidence completeness with their current process. A paid operator pilot and a service fee are business hypotheses to test, not revenue we have earned.” |
| 02:10–02:40 | “From verified prototype to a bounded pilot” | “Our next technical milestone is a reproducible public-network test, followed by a bounded operator pilot. Real K Y C, custody, fiat settlement, and exchange integrations require separate work. LifecycleKASE is not affiliated with or approved by KASE. We are looking for operator feedback and pilot partners to test whether this workflow solves a problem worth paying for.” |

The spoken script has no founder placeholder. The [founder profile](FOUNDER_PROFILE_EN.md) contains the fuller user-supplied background. Confirm actual team membership, location and competition-period contributions in the application; no solo-team structure is inferred. If actual user interviews or pilot commitments exist, replace the adoption sentence with an exact supported statement, naming sample/time/behavior without exposing personal information. No evidence found in this package is not proof that no such evidence exists elsewhere.

## Practical recording and delivery

1. **Freeze the source/evidence choice.** Record the actual commit and whether uncommitted QA/localization changes are included. Check default branch versus candidate/PR, pinned source URLs and prior-work dates; Git dates alone do not prove authorship. Preserve original `.webm` files and canonical JSON bytes.
2. **Prepare the browser.** Use an isolated browser profile, close unrelated tabs/notifications, choose 1440×900 or 1920×1080 capture, enlarge readable text and place captions away from amounts/buttons. Clear test data only through the disposable environment or QA reset. Never show `.env`, private keys, PATs, wallet recovery phrases or real investor data.
3. **Record with existing free tools.** Use an already installed screen recorder (for example OBS if present) or the existing browser-recording wrapper. A separate microphone narration can be recorded in short sections; an already installed editor may combine them. No installation, paid transcription or external upload is required by this plan. Inspect waveform/playback rather than assuming a connected microphone worked.
4. **Use English captions/subtitles.** Correct automatic words for issuer, entitlements, redemption, finalized, KZT-Test and Solana. Keep the disclosure visible or audible. Supply captions in the video if the eventual host/portal cannot display a sidecar subtitle file. No music is necessary.
5. **Rehearse once, then record.** Aim for clear speech, avoid waiting through a long validator setup, and use a plainly labelled cut if an operation completes between scenes. Do not edit balances/signatures/statuses to fabricate success. Use evidence cards for measured test results, not simulated typing of transactions.
6. **Inspect the rendered outputs.** Pitch should land between two and three minutes; demo at most three minutes including title/closing cards. Check first/middle/last scenes, audio/caption alignment, browser legibility and historical-versus-current supply. Proposed 1080p/MP4 H.264 with AAC is a broadly usable export option only if the chosen recorder/host supports it; it is not a verified portal constraint. Existing WebM is the preserved source.
7. **Prepare links, then publish only when authorized.** Inspect the actual portal to choose an accepted host. If it accepts a public or unlisted streaming link, YouTube/Loom are possible options subject to their current access/plan limits; limits were not checked here. Do not use a private, expiring, download-only or sign-in-gated link as if judges can play it. A GitHub `.webm` blob is an evidence file, not proven submission-player support. Check both videos in a signed-out browser and wait for processing to finish.
8. **Final owner action.** Review personal eligibility, team entries, English materials, prior-work disclosure, source/media access, all placeholders and the portal's current deadline. Save the actual submission confirmation/project URL; update the side-track Yes/No only after main submission. No submit/publish action is performed by this document.

If the new interactive video fails, the fallback is an honest narrated review of existing Localnet results and receipt proof. If only QA is available, publish it only as a UX simulation and name the missing financial recording; do not silently upgrade its claim. If English display translation is incomplete, use English proof views or clarify the rule before final submission.

## Prioritized work before recording/submission

| Priority | Owner/action | Acceptance |
| --- | --- | --- |
| P0 | Owner: check current logged-in Arena form and personal/team eligibility | Exact fields/hosts/limits and deadline read; registration distinct from submission |
| Implemented and published | Development: RU/EN recording path | All workspace sections checked in English; form/error state preserved and exact signed/canonical evidence unchanged. The public QA path is available at the accepted application revision; KK remains separate. |
| P0 | Founder name/background supplied; owner still checks team contribution and prior-work history | Spoken introduction filled; actual team/application fields remain accurate |
| P0 | Recording: 2:40 pitch plus ≤3:00 demo | English speech, readable evidence, full duration measured, disclosure intact |
| Published source; final link check remains | Repository/media: use source `8ea7a42`, retain historical media `8c0f4f1` and verify reviewer access | Three CI jobs passed; signed-out source/video access, narrated videos and actual submission remain separate checks |
| Deployed source; final recording rehearsal remains | Deployment: confirm the dated public checks in the deployment record, then rehearse English `/qa` with simulation/reset disclosures | Both services are Live on the new source; QA is synthetic, and authenticated registry/financial workflows require separate evidence |
| P1 | Demand evidence: invite reachable operators for a narrow usability/problem test | Proposed test: 3–5 relevant operators attempt one coupon workflow; report sample/tasks/completion/errors/time and contrary findings. This is a plan, not traction |
| P1 after recording | KK review/full RU-KK-EN rollout and public-network acceptance | Separate milestones; neither is silently declared completed by a video |

Suggested bounded pilot test: observe at least three relevant operators, with synthetic data, independently find the next step, identify the effective cutoff, distinguish prepared from finalized, and download/check a receipt. Proceed to a larger pilot only if at least four of five participants (or all three in the smaller sample) finish the critical task without facilitator correction and nobody mistakes QA/KZT-Test for real settlement. If recruiting or completing the tasks fails, record the result and revise the target/workflow; do not invent users to strengthen the pitch. This threshold is a proposed product test, not a Colosseum requirement.

## Claim guardrail and likely judge questions

| Question / unsafe shortcut | Supported answer |
| --- | --- |
| “Is this integrated with KASE?” | “No. It is a prototype motivated by the corporate-actions task; exchange/CSD integration is future work.” |
| “Do you move real KZT?” | “No. KZT-Test is a simulated settlement asset. Localnet Token-2022 transfers/burns are real test-chain instructions.” |
| “Does record date reconstruct historical ownership?” | “No. Planned time opens the capture window; finalized capture slot/time is the effective cutoff.” |
| “Why use Solana?” | “The program enforces the action/vault/receipt state and atomic test-token payment plus bond burn; a saved receipt hash makes the exact final evidence checkable.” |
| “Are you already on Devnet?” | “The inspected financial evidence is disposable Localnet. A public-network milestone requires its own verified transactions and deployment record.” |
| “Can judges sign on the Render app?” | “The public web service is staging and protected by registered-wallet login; it does not establish access to the owner's local validator. QA is synthetic.” |
| “How many customers and revenue?” | “This package does not establish adoption or revenue. A narrow operator validation/pilot is the next proposed test.” |
| “Is a database error safe to retry?” | “An unknown signed outcome is checked using the original signature. Reconciliation/recovery must not turn into a replacement payment.” |

## Sources checked and limits

Checked on **2026-10-11**: current [campaign](https://colosseum.com/worldsfair), [event PDF](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf), [FAQ](https://colosseum.com/hackathon?year=fall2026), [official recording guidance](https://blog.colosseum.com/perfecting-your-hackathon-submission/) (historical Breakout guidance, used for narrative only), the [KASE listing](https://superteam.fun/earn/listing/superteam-kazakhstan-x-kase-side-track-corporate-actions-on-blockchain/), current source/UI/submission/QA/deployment documents and saved receipts. Exact PT→Asia/Qyzylorda timestamps were checked with the local Node Intl timezone conversion.

Existing ProofPilot Colosseum read access passed a fresh documented status check (HTTP 200); one small archive read also succeeded. Retrieved archive hits were unrelated historical material and were not used as event-rule or competitor evidence. No local solana.new source pack was found. No PAT or private project payload was sent to research tools. No current pricing/limits of external recording hosts, authenticated final form, market sizing, customer interviews or legal/commercial eligibility audit was performed; these remain explicitly outside this recording-plan evidence.
