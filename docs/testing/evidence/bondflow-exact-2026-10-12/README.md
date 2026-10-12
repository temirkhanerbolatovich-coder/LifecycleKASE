# Exact-target candidate evidence — 2026-10-12

Scope: generated disposable Localnet wallets/validator/database, KZT-Test and synthetic eligibility. No retained owner or hosted deployment acceptance. [Dated record](../../bondflow-exact-redemption-2026-10-12.md).

- [Fresh typechecks and 498 tests](check.txt)
- [Fresh production build](build.txt)
- [Fresh Rust Localnet/Devnet host tests, both Clippy profiles, IDL and format](rust.txt)
- [Complete disposable four-action runtime](runtime.json)
- [Full finalized runtime log](runtime.txt)
- [Canonical coupon receipt](1-coupon_payment.canonical.json)
- [Canonical legacy partial receipt](2-early_redemption.canonical.json)
- [Canonical exact partial receipt](3-exact_early_redemption.canonical.json)
- [Canonical maturity receipt](4-bond_redemption.canonical.json)
- [Offline consistency verification](verification.json)
- [Source, SBF and IDL fingerprints](source-fingerprints.json)
- [Root production dependency audit](dependency-audit.json)
- [Redacted changed-source/evidence secret scan](secret-scan.txt)
- [Russian desktop QA](qa-desktop-ru.png)
- [English mobile QA](qa-mobile-en.png)
- [English finalized mobile QA](qa-finalized-mobile-en.png)

The resumed run completed at **04:39:13 Asia/Qyzylorda, 2026-10-12**, after applying all 21 migrations to a fresh disposable database. Coupon 1750 KZT-Test, legacy partial 7000, exact partial 8000 and maturity 21000 finalized; supply `35 → 35 → 28 → 20 → 0`. Exact allocation is `2/5/1` from `8/16/4`.

Run `npm run demo:evidence:verify -- docs/testing/evidence/bondflow-exact-2026-10-12/runtime.json` after building the domain/client packages. This verifies saved hashes, identities, settlement/source consistency and allocation offline. It does not re-query the removed validator or establish authenticity by itself. Localnet signatures have no public explorer evidence. QA screenshots are simulation only and were captured during the preceding continuation; actual browser download remains unverified.
