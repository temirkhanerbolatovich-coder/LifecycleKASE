# LifecycleKASE — technical overview

LifecycleKASE services test tokenized bonds after issuance: holders → locked finalized capture → integer entitlements → separate approval/full reserve → Solana payment or redemption → reconciliation → verifiable receipt. It is a prototype and is not affiliated with or approved by KASE.

Reviewed **2026-10-12**, implementation [source `f51be25`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/f51be252295af181ed931f00dba1ee89c35aedef). Runtime acceptance is fingerprinted separately from later operator additions.

## Components and authority

Next.js operator terminal and fixed same-origin API proxy; NestJS wallet-authenticated API; PostgreSQL/Prisma projection for investors, immutable captures/calculations, attempts, legs and append-only audit; shared TypeScript domain/client packages; Anchor program with Token-2022.

Login uses a one-time domain/Origin-bound wallet message. Administrator mutations and issuer/approver authority are checked server-side and on-chain. A financial plan persists exact bytes, signer and expiry; the external wallet signs. Localnet API verifies the saved message/signature, records the original signature before broadcast, and confirms finalized transaction/account proof before serializable projection/audit. Auditor reads cannot sign/write. Full role/issuer tenant isolation is separate.

## Token policy and record date

A test issuance creates 35 zero-decimal bonds with initial balances 10/20/5 and a synthetic six-decimal KZT-Test settlement asset. The instrument PDA is PermanentDelegate.

Legacy mints retain revoked mint/freeze authority and unrestricted token transfers. New controlled instrument v2 uses a default-frozen mint, instrument PDA freeze authority, immutable holder accounts and authorized atomic thaw → transfer → refreeze. Direct transfer/burn/approve bypass is rejected. It cannot retrofit these extensions to a legacy mint.

A planned `record_at` opens the capture window. V2 begin-capture locks movement; collection records complete finalized raw token-account bytes, wallets, investor mappings, amounts and supply; canonical snapshot and raw provenance are immutable. The effective cutoff is the actual finalized lock/capture slot/time. Historical balances at an arbitrary earlier date are not reconstructed. Investor grouping/eligibility remains a trusted registry input, not real KYC.

Redemption reserves only assigned units, leaving free holdings movable under the controlled protocol. General holder/operator dual-signature transfer UI and scalable capture remain open.

## Calculation and settlement

Financial arithmetic uses checked integer minor units with TypeScript/Rust parity. Coupon uses face value × annual basis points ÷ payments per year, floored per investor; theoretical total/residual and unimplemented withholding are disclosed. Percentage partial floors each investor's assigned units. Exact-target v2 distributes a fixed integer total by largest remainder with a stable snapshot-owner-address tie. Maturity combines remaining principal and final coupon; period-specific separate coupon uniqueness is unfinished.

Action calculation/inputs are immutable for execution. Separate approval requires a fully funded action-specific PDA vault. Coupon transfers the exact entitlement and creates replay-protected receipt state. Redemption atomically transfers KZT-Test and burns assigned bonds from committed sources, with supply progression and on-chain receipt. Failed burn rolls back payment. Confirmation checks exact finalized wire, token/cash history, receipt identity and supply before projecting both legs as matched. Zero final supply retires the instrument.

Canonical versioned JSON contains capture/input/approval/entitlement/signature/burn/reconciliation evidence. Exact UTF-8 SHA-256 is committed in an ActionReceipt PDA. Canonical hashes prove byte integrity; a snapshot hash alone is not settlement proof.

## Accepted demonstration and newer source

The [controlled HTTP/PostgreSQL/Localnet runtime](../testing/controlled-workflow-integration-2026-10-12.md) completed at **2026-10-12 14:19:06 Asia/Qyzylorda** with all 22 migrations:

| Scenario | KZT-Test | Burn | Supply |
| --- | ---: | ---: | --- |
| Coupon | 1,750 | 0 | 35 → 35 |
| 20% partial | 7,000 | 7 | 35 → 28 |
| Exact partial 8, allocation 2/5/1 | 8,000 | 8 | 28 → 20 |
| Maturity: 20,000 principal + 1,000 final coupon | 21,000 | 20 | 20 → 0 |

All four original receipts/signatures/raw captures and fingerprints are in the [evidence package](../testing/evidence/controlled-workflow-2026-10-12/README.md). Original-signature recovery after burn/source closure and historical receipt verification at later supply zero passed. The disposable ledger is removed; signatures are not public Explorer transactions. Reproduce with `npm run test:controlled:workflow`; verify saved consistency with `npm run controlled:evidence:verify -- docs/testing/evidence/controlled-workflow-2026-10-12/runtime.json`.

Later source adds a six-step action master, consistent JSON/CSV stored evidence export with browser hashes, complete database overview and a default-off original-signature observation worker. [Operator acceptance](../testing/operator-continuation-2026-10-12.md) records 684 tests, build/proxy, 23-migration PostgreSQL leases/rollback and 10,000-record synthetic queries. Worker fresh chain recovery and authenticated export download against fresh settlement were not rerun. Export reports `liveRpcRevalidated=false`; the worker cannot sign/broadcast.

## Boundaries

KZT-Test, eligibility, disposable test signers and accelerated maturity are synthetic. Public QA is a page-local simulation. Current [Oracle/DuckDNS QA](https://lifecyclekase.assetguard-temirkhan.duckdns.org/qa) returned 200 with hydrated English UI on 2026-10-13 Asia/Qyzylorda; package c835394, 23 retained migrations, API ready 200 and protected denials 401/no-store. HTTPS and direct Benjamin media passed; website/bot startup was observed after the approved reboot and retained AssetGuard remained stopped. Financial flags remain off. [Hosting observations](../deployment/oracle-duckdns.md) establish interface/access boundaries, not hosted financial execution or guaranteed uptime. Default-off capabilities require reviewed Localnet configuration.

Real money/KYC/custody/KASE/CSD, public-network financial acceptance, retained-owner rollout of the newer candidate, multi-instrument settlement-mint reuse, period-bound coupons, full roles/issuer isolation, scalable capture and full manual accessibility/usability remain open. Current source status and application gates are in [implemented versus simulated](../IMPLEMENTED_VS_SIMULATED.md) and the [submission checklist](SUBMISSION_CHECKLIST_2026-10-12.md).
