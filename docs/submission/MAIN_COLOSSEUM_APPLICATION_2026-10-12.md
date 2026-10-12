# Colosseum application snapshot — 2026-10-12

**Later completion, 2026-10-13:** the owner confirmed Colosseum and Superteam applications submitted. The [completion record](SUBMITTED_2026-10-13.md) supersedes the historical **Not submitted** state and older branch/media instructions below. This document preserves the inspected 2026-10-12 preparation fields.

Authenticated portal inspected on 2026-10-12, Asia/Qyzylorda. Existing project: [LifecycleKASE](https://colosseum.com/arena/projects/lifecyclekase); existing founder profile: [Temirkhan Erbolatovich](https://colosseum.com/arena/profiles/temirkhan4). The portal showed project details complete, team **1 of 1 complete**, media **2 fields need attention**, and **Not submitted yet**. Existing registration/profile creation is not final submission.

Deadline shown in the portal: **October 12, 2026, 11:59 PM PDT**, equivalent to **October 13, 2026, 11:59 Asia/Qyzylorda**. [Official rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf), retrieved 2026-10-12, agree. English materials are required. This record does not independently verify personal eligibility.

## Actual media fields

The authenticated form is stricter than the [public FAQ](https://colosseum.com/hackathon?year=fall2026): use its **pitch limit of 2 minutes**, rather than the FAQ's 2–3 minutes. Demo maximum: **3 minutes**; it must show the live product, not a slide deck or code walkthrough. Both fields explicitly accept **YouTube, Loom or Vimeo**. A directly hosted MP4 is a downloadable backup, not a verified accepted form value.

- Project logo/graphic: required; existing upload retained. JPEG, PNG, WebP or GIF; 20 MB before compression, 0.5 MB stored.
- GitHub: required, public repository URL. Use the repository root and pin the review branch/revision in the 500-character repository context.
- Demo: required; optional public-page display checkbox.
- Live product and access instructions: available optional fields.
- Pitch: required, public.
- X profile: optional; leave blank without an actual project account.
- Accelerator application: existing switch is off; no request to change it.

## Prepared product answers

### Brief description (500)

LifecycleKASE is a Solana prototype for servicing tokenized bonds after issuance: record-date holder capture, coupon payments, partial and maturity redemption, and verifiable receipts. Built for the Superteam Kazakhstan × KASE challenge; no KASE integration is claimed.

### What are you building, and who is it for? (1000)

We are building an operator terminal and Solana corporate-action engine for tokenized bonds. The first intended users are issuer operations teams and service providers that must determine who is entitled to a payment, approve the obligation, settle it and reconcile the result.

The prototype implements holder capture, integer entitlement calculation, separate approval, full reserve, coupon settlement, percentage and exact-target partial redemption, maturity payment-and-burn, and canonical receipts. It includes a verified-wallet registry, role and issuer checks, a six-step action workspace and JSON/CSV audit exports.

The public QA route lets judges inspect the interface without a wallet. Financial evidence comes from saved authenticated workflows on disposable Solana Localnet, not the public QA simulation.

### Why build this, and why now? (1000)

The KASE challenge gave us a concrete problem: demonstrate what happens after a bond is tokenized, including coupon, redemption and another corporate action. We focused on the operational gap between calculating an entitlement and proving that settlement completed.

Our insight from building the prototype is that record-date handling, approved reserves, token retirement and recovery of an unknown confirmation must agree across the interface, database and chain. A successful wallet signature alone is insufficient.

The next step is a bounded pilot with an issuer operations team. Demand, willingness to pay and production integrations still need validation; we do not claim customers or institutional adoption.

### Technologies and AI tools

Solana; Anchor/Rust; SPL Token-2022 bonds and test SPL settlement tokens; TypeScript; React/Next.js 16; Node.js/NestJS; PostgreSQL/Prisma; Wallet Standard/Phantom; Docker and automated GitHub Actions checks. Development assistance: OpenAI Codex. Public hosting: existing Oracle Cloud VPS, DuckDNS and Caddy HTTPS. Financial runs use isolated Localnet and generated test signers.

### How Solana is used (500)

Solana programs commit holder snapshots, bind integer entitlements, enforce separate approval and reserved funds, transfer test settlement tokens and atomically burn redeemed Token-2022 bonds. Finalized transactions and versioned receipt hashes are reconciled before database projection. Controlled bonds use frozen custody and per-source reservations. Four saved Localnet actions completed; public QA is a simulation. No Devnet/Mainnet deployment is claimed.

### Other notes for judges (500)

Source revision f51be252295af181ed931f00dba1ee89c35aedef; review codex/full-project-audit-20261010, not the older default branch. Dated Localnet evidence: coupon 1,750; percentage partial 7,000; exact-target partial 8,000; maturity 21,000 KZT-Test, supply 35→35→28→20→0. Public QA is synthetic. Real KYC, fiat, KASE/CSD integrations and public-network deployment remain open. Prior work and competition-period commits are visible in Git history; no traction is claimed.

## Submission state

The product answers above and the repository context were actually saved in the authenticated portal on 2026-10-12. Its final review still showed **Not submitted**, with only the two required accepted-host video answers missing. No video upload/publication or final submission occurred. The owner requested stopping and resuming later; [the saved checkpoint](CHECKPOINT_2026-10-12.md) is the continuation entry point. Side-track submission is separate; see [its draft](COLLOSSEUM_SUBMISSION.md).
