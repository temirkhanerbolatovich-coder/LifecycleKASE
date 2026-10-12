# KASE side-track requirements matrix

Reviewed for submission: **2026-10-12**. Official brief: [Superteam Kazakhstan × KASE — Corporate Actions on Blockchain](https://superteam.fun/earn/listing/superteam-kazakhstan-x-kase-side-track-corporate-actions-on-blockchain/). Main event: [Crypto World's Fair](https://colosseum.com/worldsfair).

The [main rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) close at **2026-10-13 11:59 Asia/Qyzylorda (UTC+5)**, `2026-10-13T06:59:00Z`. The stored side-track listing has the same deadline. Main English-content and separate pitch/demo format are documented in the [package](README.md). The authenticated form inspected 2026-10-12 imposes **pitch ≤2 minutes**, **live-product demo ≤3 minutes**, with **YouTube/Loom/Vimeo links**; these stricter field limits control preparation. Listing counts/open state can change; neither establishes submission.

Implementation source is [`f51be25`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/f51be252295af181ed931f00dba1ee89c35aedef). The accepted financial run preserves its exact executed fingerprints; subsequent worker/export checks have a separate scope. The broader [BondFlow product specification](../requirements/KASE_BondFlow_TZ.md) includes requirements beyond this official contest brief; its [implementation plan](../features/bondflow-implementation-plan.md) is not a claim that every product requirement is complete.

## Official requirement coverage

| Official requirement | Status | Evidence | Boundary |
| --- | --- | --- | --- |
| Identify holders → calculate → execute/initiate → record on-chain | Implemented; accepted on disposable Localnet | Controlled v2 capture, four entitlement/settlement flows and finalized canonical receipt/PDA commitments; [runtime](../testing/controlled-workflow-integration-2026-10-12.md) | KZT-Test/eligibility/signers/time are synthetic; no public/owner/production acceptance implied |
| Core on-chain components on Solana | Implemented | Anchor/Token-2022 program; Instrument/Action/snapshot/entitlement/receipt and controlled capture/reservation PDAs | Localnet ledger/signatures are saved evidence, not public Explorer links |
| Test tokenized financial instrument | Implemented and issued | Fixed 35 zero-decimal test bonds, v2 default-frozen policy and PDA authorities; authenticated four-phase issuance | Legacy mints retain their original policy; multi-instrument settlement-mint reuse is open |
| Holder registry | Implemented with simulated eligibility | Verified multiple-wallet mapping; complete positive-supply capture; profile/eligibility review, wallet block/unblock, versions/atomic audit, search/detail/full wallet pages | Real KYC/CSD, investor lifecycle closure and issuer tenant isolation remain open |
| Record-date mechanism | Implemented with explicit actual cutoff | V2 finalized lock blocks movement while complete raw holder evidence/snapshot is captured; later movement preserves immutable capture/entitlements | Planned record time opens capture; effective finalized slot/time establishes rights. No arbitrary historical reconstruction; legacy unrestricted transfer policy differs |
| Entitlement calculation | Implemented | Checked integer coupon/maturity/percentage partial/exact-target formulas and TS/Rust parity; exact target 8 from 8/16/4 allocates 2/5/1 | Fixed payments-per-year convention; taxes and period-specific final-coupon obligations incomplete |
| Coupon payment | Implemented and executed | 1,750 KZT-Test paid; supply 35 → 35; canonical controlled coupon receipt | Test settlement asset, no fiat claim |
| Redemption at maturity | Implemented and executed | After both partial actions: 21,000 KZT-Test = 20,000 principal + 1,000 final coupon; 20 burned; supply 20 → 0; instrument REDEEMED | Original three-action media instead has 29,400/28 burned; do not mix fixtures. Separate period-level final-coupon uniqueness remains open |
| At least one additional action | Implemented and executed: two partial policies | 20%: 7,000 KZT-Test, 7 burned, supply 35 → 28; exact 8: 8,000, 8 burned, supply 28 → 20 | Only assigned v2 units reserved; transaction packet/account limits and general secondary transfer UI remain |
| Verifiable on-chain outcome | Implemented | Four canonical receipts with exact UTF-8 SHA-256/ActionReceipt PDA and finalized signatures; matched cash/burn legs/supply | Offline verifier checks saved consistency; it does not authenticate provenance or query a live chain |
| Working prototype | Implemented and reproducible | `npm run test:controlled:workflow`; [four-action evidence](../testing/evidence/controlled-workflow-2026-10-12/README.md) | Requires Docker and documented WSL/Solana toolchain; preserves owner environment |
| Demo video | Current local English files ready, within form caps | [Pitch](lifecyclekase-pitch-en.mp4) 115.091s; [live QA demo](lifecyclekase-demo-en.mp4) 164.904s; [validation](video-validation-2026-10-12.json) | Synthetic English narration; actual QA clicks with simulated finance, separate saved Localnet evidence. YouTube/Loom/Vimeo upload remains |
| Source repository | Exact implementation revision identified | [Source f51be25](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/f51be252295af181ed931f00dba1ee89c35aedef); final publication/checks tracked in [checklist](SUBMISSION_CHECKLIST_2026-10-12.md) | Use final exact published commit after documentation/media updates; do not substitute an older default branch |
| Website, optional field | New Oracle/DuckDNS startup/access checks passed 2026-10-12 | [QA](https://lifecyclekase.assetguard-temirkhan.duckdns.org/qa) 200/hydrated English; source f51be25, API ready 200, 23 migrations, protected 401/no-store; [hosting](../deployment/oracle-duckdns.md) | QA synthetic; registered-wallet dashboard, financial flags disabled. Docker/systemd avoids idle sleep; health is not financial/chain acceptance or guaranteed uptime |
| Short technical overview | Available and current | [Technical overview](TECHNICAL_OVERVIEW.md) | Explicit prototype/financial/network limits |
| Main registration and submission | Registration/details/team observed; authenticated final state **Not submitted**, video links blank | [Current checklist](SUBMISSION_CHECKLIST_2026-10-12.md) | Record actual organizer confirmation/project URLs before setting side-track answer to Yes |

## Judging evidence

Weights below are retained from the inspected KASE listing, not self-assigned scores.

| Criterion | Weight | Evidence a judge can inspect | Limit |
| --- | ---: | --- | --- |
| Technical execution | 30% | Source check checkpoint: 684 Node tests, types, Prisma, build/proxy; 23-migration disposable DB worker/overview checks. Four-action financial runtime has separate 22-migration source/binary fingerprints | Fresh new-worker chain recovery and authenticated export downloads remain open; no current CI result is invented |
| Corporate-action logic | 25% | Three required action classes plus exact-target partial, locked complete capture, integer formulas, reserve/approval, atomic burn and hash-committed receipts | Actual finalized cutoff; no arbitrary past ownership or period-level coupon guarantee |
| Product and UX | 20% | RU/EN six-step terminal, state-preserving signing/recovery, registry, journals and export; synthetic production browser evidence | Human Phantom sequence, native accessibility/mobile keyboard and five-user study are separate |
| Real-world applicability | 15% | Issuer/approver/operator/auditor concerns, complete provenance and append-only audit around settlement | No actual demand/customer traction, real KYC/fiat/KASE/CSD, custody or production readiness claimed |
| Innovation | 10% | Exact-target allocation, controlled assigned-unit reservations, atomic payment/burn and byte-hashed canonical receipt with original-signature recovery | Limited to implemented prototype design; no novelty/patent or adoption claim |

## Evidence index

- [Controlled four-action runtime, fingerprints and original canonical receipts](../testing/evidence/controlled-workflow-2026-10-12/README.md)
- [Financial acceptance and exact limitations](../testing/controlled-workflow-integration-2026-10-12.md)
- [Controlled protocol acceptance and bypass rejections](../testing/controlled-registry-2026-10-12.md)
- [Exact-target formula/parity/legacy preservation](../testing/bondflow-exact-redemption-2026-10-12.md)
- [Operator master/export/overview/worker checkpoint](../testing/operator-continuation-2026-10-12.md)
- [Governed registry/profile acceptance](../testing/registry-profiles-2026-10-11.md)
- [Implemented/simulated/remaining scope](../IMPLEMENTED_VS_SIMULATED.md)
- [Publication, video and actual submission checklist](SUBMISSION_CHECKLIST_2026-10-12.md)

This matrix is the current contest view. Dated audits, deployment observations and original clips retain their checkpoint meaning; they are not official organizer acceptance.