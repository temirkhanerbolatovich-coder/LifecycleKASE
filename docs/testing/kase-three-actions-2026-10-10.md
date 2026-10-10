# Three-action KASE acceptance — 2026-10-10

All three financial scenarios completed against the isolated redemption SBF candidate, a fresh PostgreSQL database and authenticated HTTP API. The final run also passed real-browser receipt downloads and desktop/mobile checks; its [44.64-second video](../submission/kase-three-actions.webm) and [public evidence JSON](evidence/kase-three-actions-2026-10-10.json) are included. This does not claim installation or acceptance on the retained owner ledger.

## Verified financial results

| Action | Captured holdings | Settlement in KZT-Test | Bonds burned | Supply after |
| --- | --- | --- | --- | --- |
| Coupon | 9 / 21 / 5 | 450 / 1050 / 250 = 1750 | 0 | 35 |
| Partial 20% | 10 / 20 / 5 | 2000 / 4000 / 1000 = 7000 | 2 / 4 / 1 = 7 | 28 |
| Maturity | 8 / 16 / 4 | 8400 / 16800 / 4200 = 29400 | 8 / 16 / 4 = 28 | 0 |

Maturity includes 28000 principal plus the 1400 final semiannual coupon. All nine payments and all three ActionReceipt finalizations are confirmed from exact finalized bytes, PDA contents and token history. Both required redemption cash/asset legs share one signature, are CONFIRMED and reconcile as MATCHED. Verified zero supply and action finalization retire the instrument.

First completed financial run:

| Action UUID | Receipt SHA-256 | Finalization signature |
| --- | --- | --- |
| d835d378-a0cd-4e93-a599-b174a76c3b9c | `299c6658b7545b3a452981a86e72fce498a21b6ba260859efdc745441673dc91` | `pidThMXS3oSB8WYfmi2i5BwMyt5CNB8he8QS9B6gAHjZeitZJ4CWAskCdBxdyqLUiTgEJ7GAVHCqmC13XXzGXCq` |
| af2827cf-58ec-4ec4-b9fc-9bbd5b3ff6b7 | `ea4937ad08c4fcd5796d580ce75513e09d74f3e7c1326f3793e0537f9090b412` | `4osgvUrpiXZQZdtij1yLYr2aRjRsKdcdWQCyPbMWfJfGSLXaqLYL36LyLSV9b6WZRqxWRzxQTJM2bdgtYQt4AwpH` |
| d787462f-c1ea-48aa-9343-b1ab1b0580c5 | `7346a7c94fabdc299bd0ce3514f8ca6287ee10043581b6d7920bbb776f68e914` | `kJAY8bpkHS3Bngqr9D3kdFjPbQBti5QrK2eYG9f8aVB2ccfdh8BmrSKz2ps846AQoXrGckw5DqDF8ekWhzn8Jai` |

That run passed all financial assertions; optional video initially failed because Playwright's default browser revision was absent. The wrapper now preflights the installed browser/video encoder and accepts an explicit executable. This environment failure did not invalidate or repeat a financial payment.

Final complete run (financial execution completed at 18:38:23 UTC; browser capture subsequently passed):

| Action | Action UUID | Receipt SHA-256 |
| --- | --- | --- |
| Coupon | `9b6ab18e-de94-4731-a198-d83a3c89c2ca` | `7913a0b6b07f6e601c2249669229a2e4f1881c7f5b2a95c1ee003db7896dc860` |
| Partial 20% | `5c1516d7-0ddf-42a0-b3c5-2f2b43fd1657` | `6cd5f726f674af2ff49602c9c7dea344f3083a5922a270eaf3b098a0e3d1215c` |
| Maturity | `ee9652b5-309d-404a-a61e-765d67792a9e` | `5a0e18d4d64863b8b252d043d69ca0e1661ebb56ef8bcc5d74cb69c359622ee3` |

The public evidence preserves genesis, mint, snapshot slots, all payment/finalization signatures and exact canonical receipt strings. The independently downloaded [coupon](evidence/coupon_payment-2026-10-10.json), [partial](evidence/early_redemption-2026-10-10.json) and [maturity](evidence/bond_redemption-2026-10-10.json) files match those strings byte-for-byte and match their committed SHA-256 hashes.

## Cutoff and negative evidence

One bond moved holder1 → holder2 before coupon capture and returned after capture. The immutable snapshot/entitlements remained 9/21/5; later action snapshots used current balances. The effective cutoff is actual finalized capture slot/block time. Planned `record_at` opens a window of at most 300 seconds; earlier historical ownership is not reconstructed.

- After preparation, all ten holder1 bonds were transferred away. The API rejected submission. Direct disposable-validator submission finalized with a program error; reserve, recipient and mint supply stayed unchanged, with no redemption receipt or settlement. The failed attempt was reconciled before a fresh payment.
- Changed signing bytes were rejected before broadcast. Repeat submits/new-key duplicate payments, incomplete finalization, Auditor mutations and foreign Origin writes were blocked.
- Missing RPC history preserved UNKNOWN_CONFIRMATION and the original signature/operation. A synthetic PostgreSQL audit-trigger failure rolled back entitlement, settlement, instrument supply and attempt projection. Confirming the same signature recovered the result; repeat confirmation added no audit/payment.
- PostgreSQL JSONB ordering exposed a reviewed-source comparison bug. Its fix ignores object-key order while strictly preserving account order, types and reviewed values. A regression test covers all changed fields.

## Validation

- `npm run check`: 320 passing tests — 126 API, 66 web, 27 domain, 54 client, 47 root; typechecks, Prisma schema and documentation validation pass.
- Rust: the same 18 unique host tests pass in each Localnet/Devnet profile, with Rustfmt and Clippy warnings denied.
- Production web/API builds and production proxy smoke tests pass, including all four redemption routes and Strict/HttpOnly cookie transport.
- The previous coupon integration suite passes on this redemption candidate: issuance, actions/snapshot, funding, separate approval/reserve/refund, 500/1000/250 payments, receipts, recovery and audit rollback.
- Root production npm dependency audit: zero advisories. The separately isolated legacy validator client retains its documented advisories.
- SBF candidate: 663968 bytes; SHA-256 `031b43f0b16de244aa4fc7ff194d7e48ddb8c83b2fa83a2bdaea6bd59212b062`. Existing persisted account layouts are preserved.
- Browser: real authenticated Auditor UI at 1440×900 and 390×844; all three canonical downloads verified, mobile document has no horizontal overflow and browser page-error list is empty. [Desktop](../submission/bond_redemption.png) and [mobile](../submission/maturity-mobile.png) screenshots are included. A capture retry corrected the helper's tab selection after workspace state preservation; it did not rerun financial transactions.
- Video: VP8/WebM, 1440×900 at 25 fps, 44.64 seconds, 4430037 bytes; SHA-256 `b6652cf20dee44de9f48e875cb666e194e0a107e6465508582eece04e16e3d6d`. It is a read-only tour after automated test-key execution, without audio or physical Phantom signing.
- Available primary Docker database before/after: instruments 1, actions 1, entitlements/receipts/settlements/attempts 0, audit 19. Only invocation-owned test containers/ledgers were removed. These counts do not establish fresh acceptance of the retained owner ledger.

## Reproduction and environment boundary

Source, tests, documentation and the public demo artifacts are delivered together through [PR #1](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/pull/1). Its Checks page reports CI for each published revision; the local validator/browser acceptance above is separate from those CI jobs.

```powershell
npm ci
npm run demo:verify
# Or reuse a reviewed isolated artifact:
npm run demo:verify -- -Profile localnet-candidate-redemption-20261010
```

See [submission instructions](../submission/README.md) for browser capture/prerequisites. The default runner builds a uniquely named candidate, starts its own loopback PostgreSQL, applies all 19 migrations to `actions_test_UUID` and uses generated disposable signers. It never loads the owner `.env`. Database/container/validator cleanup is scoped to this invocation.

The demo uses an accelerated 600-second maturity and `--ticks-per-slot 8`; ordinary regression timing is unchanged. These are test inputs. Eligibility/registry fixtures, generated signers and KZT-Test funding are synthetic; Solana instructions and reconciliation operate on actual chain/database state.

Local signatures refer to a disposable validator, not public Explorer. The test ledger is removed; saved evidence documents the completed run, and the command reproduces independently verifiable live results. The owner confirmed official main Colosseum registration on 2026-10-10; no independent organizer-site check was performed. Owner upgrade/Phantom acceptance, public network and organizer submission remain separate.
