# Controlled instrument application evidence — 2026-10-12

Scope: controlled instrument v2 issuance and four financial actions through authenticated HTTP, disposable PostgreSQL, a fresh Localnet validator, generated signers and independent browser transaction/receipt validators. KZT-Test and investor eligibility are synthetic. The [dated acceptance record](../../controlled-workflow-integration-2026-10-12.md) and [ADR-031](../../../decisions/ADR-031-controlled-workflow-integration.md) describe the application scope; [earlier protocol evidence](../controlled-registry-2026-10-12/README.md) remains separate.

- [Runtime, original signatures, raw captures and reservations](runtime.json)
- [Runtime SHA-256](runtime.sha256) and [runtime log](runtime.txt)
- [Canonical controlled coupon receipt](1-COUPON_PAYMENT.canonical.json)
- [Canonical controlled percentage partial receipt](2-EARLY_REDEMPTION.canonical.json)
- [Canonical controlled exact-target partial receipt](3-EXACT_EARLY_REDEMPTION.canonical.json)
- [Canonical controlled maturity receipt](4-BOND_REDEMPTION.canonical.json)
- [Offline consistency result](verification.json)
- [Final workspace check and 640 Node tests](check.txt)
- [Production build](build.txt) and [isolated production proxy check](proxy.txt)
- [Synthetic desktop/mobile UI assertions](visual/visual-evidence.json) and [visual check log](visual.txt)
- [Desktop capture review](visual/capture-desktop-ru.png), [mobile capture review](visual/capture-mobile-ru.png)
- [Desktop recovery](visual/recovery-desktop-en.png), [mobile recovery](visual/recovery-mobile-en.png)
- [Desktop issuance review](visual/issuance-desktop-en.png), [mobile issuance review](visual/issuance-mobile-en.png)
- [Desktop finish review](visual/finish-desktop-en.png), [mobile finish review](visual/finish-mobile-en.png)
- [Desktop zero-supply mint review](visual/mint-review-desktop-en.png), [mobile zero-supply mint review](visual/mint-review-mobile-en.png)
- [Source, executed helper, SBF and IDL fingerprints](source-fingerprints.json)
- [Original runtime packaging fingerprint record](runtime-source-fingerprints.json)
- [Post-runtime receipt validator checks: 3 originals accepted, 21 corruptions rejected](post-runtime-receipt-validation.json)
- [Resumed Rust profiles, formatting and strict Clippy](rust.txt)
- [Root production dependency audit](dependency-audit.json)
- [Redacted publishable-source/evidence secret scan](secret-scan.txt)

Integrated runtime acceptance completed on **2026-10-12 at 14:19:06 Asia/Qyzylorda**. The fresh validator and PostgreSQL applied all **22 migrations**. Controlled issuance and all four actions finalized: coupon **1,750 KZT-Test**, percentage partial **7,000**, exact-target partial **8,000** and maturity **21,000**, supply **35 → 35 → 28 → 20 → 0**. All four original canonical receipts are retained above.

The runtime verifies original-signature recovery after a finalized maturity burn's empty source was closed, then downloads both historical partial-redemption receipts at supply zero with unchanged canonical bytes and independent browser verification. All **29 executed source/helper fingerprints**, candidate SBF/IDL and previously accepted program/client source hashes matched disk when the recovered runtime was packaged. Subsequent browser receipt-verifier hardening and revalidation of saved receipts have separate source/check evidence and do not establish another financial runtime. The runtime used normal **64 ticks per slot**, a **1,200-second** future maturity and a **90-second** confirmation deadline. The separate legacy zero/mixed coupon prelude was excluded and retains its earlier acceptance; preliminary interrupted runs remain partial history.

Reproduce with Docker and the documented non-root WSL Solana/Anchor toolchain:

```powershell
npm run test:controlled:workflow
```

The default builds a fresh candidate. Explicit reuse of the fingerprinted candidate in this package uses:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-controlled-workflow.ps1 -Profile localnet-candidate-controlled-20261012-c -RpcPort 19240 -DatabasePort 65485
```

After `npm run check` builds the client and test helpers, verify saved evidence with:

```powershell
npm run controlled:evidence:verify -- docs/testing/evidence/controlled-workflow-2026-10-12/runtime.json
```

Offline verification checks the fixed four-action fixture's original canonical hashes, raw frozen capture bytes, source ownership, reservation allocations, PDA identities and financial/supply transitions. It does not query RPC/PostgreSQL, authenticate evidence, compare recorded source hashes to disk or prove the runtime's HTTP/SQL assertions. Separate local fingerprint checks compare executed files to current disk. The verifier's fixed fixture requires positive per-source burns; untouched zero-assignment sources are covered by the earlier protocol fixture and application tests.

Final workspace checks passed **640 tests** (210 API / 165 web / 43 domain / 82 client / 140 root), production build/proxy, zero-vulnerability root production audit and both **28-test Rust host profiles**, formatting and Clippy. Subsequent browser hardening binds burn-source history, receipt PDA and the complete supply chain. The original runtime remains byte-for-byte unchanged; **28 of 29** executed files still match, with the compiled receipt validator explicitly fingerprinted and validated offline against all three saved redemption receipts. These post-runtime checks are not a second financial execution.

The binary and IDL match the previously accepted controlled protocol candidate; Rust source is unchanged in this integration. Browser helpers independently review actual plans and canonical receipts; desktop/mobile screenshots use synthetic fixture state and do not establish actual Phantom signing, native assistive technology, keyboard or five-user usability. General secondary holder/operator dual-signature transfer UI, scalable capture, committed cancellation/reversal, durable workers, multi-instrument settlement-mint issuance and public Devnet remain open. The retained owner environment and hosted services were not changed.
