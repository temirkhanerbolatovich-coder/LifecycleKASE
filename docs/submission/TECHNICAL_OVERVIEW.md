# LifecycleKASE — technical overview

LifecycleKASE services a test tokenized bond after issuance: holders → finalized snapshot → integer entitlements → separate approval and reserve → Solana settlement/redemption → reconciliation and verifiable receipt. This is a prototype; it is not affiliated with or approved by KASE.

## Architecture

Next.js operator terminal and same-origin API proxy; NestJS wallet-authenticated API; PostgreSQL/Prisma for investors, immutable snapshots, attempts, cash/asset legs and append-only audit; TypeScript domain/client packages; Anchor program on Solana with Token-2022.

Operators authenticate by a one-time signed wallet message. Financial instructions require an explicit signature over the exact saved transaction. The API checks message bytes/signer/signature and broadcasts once on Localnet. A separate instrument approver reserves the whole action amount and approves before payment. Auditors can inspect without signing or writing.

## Instrument and holder registry

A fixed 35-bond test mint has zero decimals, revoked mint/freeze authority and an instrument PDA as PermanentDelegate. Initial holders own 10/20/5. One investor may map to multiple verified wallets; holder scanning enumerates all positive Token-2022 accounts and requires complete supply coverage. Eligibility is synthetic demo data, not real KYC.

## Record date

The configured record_at opens a bounded capture window. The effective ownership cutoff is the actual finalized snapshot slot/block time. Before-cutoff transfers change captured holdings; later transfers cannot change its immutable rows/hash or entitlements. Planned and effective timestamps appear separately. This prototype does not reconstruct historical balances at an earlier planned date and does not restrict ordinary transfers with a Transfer Hook.

## Entitlements

Use integer minor units and shared TypeScript/Rust parity vectors. Coupon = balance × face value × coupon basis points ÷10000 ÷payments per year, rounded down. Partial redemption first floors investor balance ×redemption basis points ÷10000, then multiplies redeemed tokens by price. Maturity pays remaining principal plus the final coupon.

For face value 1000, annual coupon 10%, semiannual payment:50 per bond. Demonstration coupon pays 1750 total; partial 20% redeems 7 and pays 7000; maturity redeems 28 and pays 29400 including final coupon.

## Settlement and Solana records

Authority-registered snapshot and entitlements are finalized before approval. The action-specific PDA vault holds the full KZT-Test reserve. Coupon transfers create immutable per-entitlement receipts. Redemption additionally registers immutable source accounts/wallets/balances and a supply progress PDA; payment and PermanentDelegate burns occur atomically. Wrong/insufficient sources and stale supply roll back the entire transaction.

Finalized signature, exact wire, receipt, cash/token history and supply deltas precede a serializable database projection. Both cash and asset legs share the same redemption signature. Failed audit projection can recover by checking the same signature; signed pending attempts are never automatically replaced or rebroadcast.

A canonical versioned JSON ActionReceipt contains inputs, planned/effective cutoff, approval, entitlements, signatures, source/burn proof and reconciliation. Its exact UTF-8 SHA-256 is committed to an ActionReceipt PDA. Checking snapshot commitment alone is not evidence of settlement.

## Implemented versus simulated

Implemented candidate: issuance, verified-wallet registry, snapshot, three calculations, separate approval/custody, coupon execution, atomic partial/maturity payment+burn, reconciliation, canonical receipts and operator views. KZT-Test funding, investor eligibility and accelerated test maturity are simulated domain inputs; Solana instructions themselves execute on a real isolated local validator.

Current validation/evidence and environment limits: [three-action acceptance](../testing/kase-three-actions-2026-10-10.md), [captioned Auditor demo](kase-three-actions-captioned.webm), [original recording](kase-three-actions.webm) and [saved signatures/canonical receipts](../testing/evidence/kase-three-actions-2026-10-10.json). Run `npm run demo:verify` with Docker and the documented non-root WSL toolchain; it creates and removes only its disposable ledger/database. This is reproducible Localnet evidence, not a public Explorer deployment or installation on the retained owner program.

The owner confirmed main Colosseum registration on 2026-10-10 and on 2026-10-11 clarified that registration/stages are complete but project submission has not yet occurred. These are user-provided confirmations, not independent organizer-site checks. The source/video/overview package is assembled; main and side-track submissions remain. Public-network rollout, owner wallet acceptance, production operations, legal ownership, real fiat/KYC and KASE/CSD integrations are separate.
