# Controlled registry candidate evidence — 2026-10-12

Scope: a new instrument v2/mint on a fresh disposable Localnet validator, generated signers, KZT-Test and synthetic investor eligibility. A separate disposable HTTP/PostgreSQL/validator run checks legacy compatibility using the same candidate binary. See the [dated acceptance record](../../controlled-registry-2026-10-12.md) and [protocol boundaries](../../../features/controlled-registry.md).

- [Controlled runtime, finalized signatures, captures, reservations and on-chain receipts](runtime.json)
- [Controlled runtime SHA-256](runtime.sha256)
- [Controlled runtime log](runtime.txt)
- [Typechecks and 521 Node tests](check.txt)
- [Production build](build.txt)
- [28 Rust tests per host profile, strict Clippy, IDL and format](rust.txt)
- [Isolated SBF/IDL build](sbf-build.txt)
- [Legacy four-action HTTP/PostgreSQL/runtime](legacy-runtime.json)
- [Legacy runtime log](legacy-runtime.txt)
- [Offline legacy evidence consistency](legacy-verification.json)
- [Canonical legacy coupon receipt](1-legacy-coupon_payment.canonical.json)
- [Canonical legacy partial receipt](2-legacy-early_redemption.canonical.json)
- [Canonical legacy exact-target receipt](3-legacy-exact_early_redemption.canonical.json)
- [Canonical legacy maturity receipt](4-legacy-bond_redemption.canonical.json)
- [Source/SBF/IDL/client fingerprints and both run identities](source-fingerprints.json)
- [Root production dependency audit](dependency-audit.json)
- [Redacted publishable-source/evidence secret scan](secret-scan.txt)
- [Reviewed public token-address scanner findings](public-address-scan-review.json)
- [Narrow scanner-exception scope check](secret-exception-scope.txt)

The controlled run completed at **05:46:40 Asia/Qyzylorda** with 63 distinct finalized transactions and 35 expected preflight/simulation rejections. Genesis is `5MAbDmYLZL4eqG6UyH8fkgivEWFZCtv6EiyL1ZzCvok7`; runtime SHA-256 is `f049fab3b3fd39c163a58d7ec4cc6f03e93f942d447a86265be0132593851166`. The fixture uses four positive accounts and three holders, reserves `2/5/1` of supply 35, moves all 27 free units, pays 8000 KZT-Test and burns eight units. It checks direct token bypasses, capture coverage, unsafe aborts, reservation boundaries, changed holder guard settings, a closed/recreated zero-assignment source and replay. Negative checks compare unchanged finalized account hashes; they are not landed failed transactions.

Controlled coupon rights are calculated and remain immutable after transfers resume. Coupon payment and maturity on instrument v2, canonical application receipt projection and API/database/UI integration are outside this fixture. Its action receipt commitment is a synthetic fixture hash. The four canonical application receipts above belong to legacy instruments in the separate compatibility run.

The legacy run completed at **05:43:48 Asia/Qyzylorda**: coupon 1750, legacy partial 7000, exact partial 8000 and maturity 21000 KZT-Test; supply `35 → 35 → 28 → 20 → 0`, all 21 migrations applied. The retained owner environment, hosted services and public Devnet were not changed or accepted.

The secret scanner's only new exceptions are five verified public addresses AND this exact runtime path AND the `generic-api-key` rule. No file is skipped. A negative scope check confirms another address at that path and an allowed address elsewhere are still detected. The root production dependency audit reports zero vulnerabilities; the isolated legacy integration tooling graph is outside that audit.

Reproduce controlled execution with `npm run test:controlled:integration`. A reviewed candidate can be reused with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-controlled-registry.ps1 -Profile localnet-candidate-controlled-20261012-c -RpcPort 19180`. The wrapper generates its own temporary signer/ledger and cleans up only those resources.

After building the domain/client packages, run `npm run demo:evidence:verify -- docs/testing/evidence/controlled-registry-2026-10-12/legacy-runtime.json` to verify the saved four-action canonical hashes, identities, amounts, allocation and supply transitions. That command accepts the legacy fixture only. Neither offline consistency, fingerprints nor runtime file hashes independently establish authenticity. These disposable ledgers were removed; Localnet signatures have no public explorer evidence. No browser UI acceptance was performed for this protocol/client stage.
