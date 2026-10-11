# Security model and remaining controls

The [October 10 audit](../PROJECT_AUDIT_2026-10-10.md) records zero advisories in the root deployed npm graph and 12 (5 high, 7 moderate) in the isolated legacy integration harness. Fresh dependency, full-history and publishable-content secret scans are separate dated checks. Evidence access is currently Administrator/Auditor-wide; issuer-scoped multi-tenant authorization remains unfinished. The MVP uses Administrator/Auditor permissions; specialized role workflows remain deferred rather than being implied by these registry routes.

Reviewed: 2026-10-11. This is the current source implementation boundary, not an external security audit, hosted-deployment confirmation or production authorization. Use only synthetic data and Localnet/Devnet test assets. Mainnet, real cash, legal issuance and real KYC are outside the accepted pilot scope.

Update — 2026-10-11: the shared operator-session gate now revalidates the current wallet on every protected read or mutation. An unexpired cookie does not retain access after that wallet becomes blocked, pending, revoked, unverified, deleted or assigned to another user. The earlier stale-wallet finding remains dated in the [technical audit](../testing/technical-audit-2026-10-11.md).

## Assets and trust boundaries

| Boundary | Protection currently implemented | Remaining limit |
| --- | --- | --- |
| Browser → web/API | Fixed server-origin rewrite allowlist; server-side validation of session, role, Origin and operation terms | Browser input is untrusted; manual negative/Auditor acceptance is incomplete |
| Wallet → API | Domain/purpose/nonce-bound login; exact prepared transaction, signer and Ed25519 validation | Only the owner can authorize Phantom signing; API never receives the private key |
| API → RPC | Explicit cluster/genesis binding, finalized wire comparison and program/token account checks | RPC availability/pruned history can block proof; health is not settlement evidence |
| API → PostgreSQL | Serializable workflow guards, versions, uniqueness constraints and atomic actor audit | Database projects chain facts; it cannot replace absent finalized chain evidence |
| Candidate → owner program | Isolated artifacts, hashes, disposable old→new upgrade and PDA compatibility checks | Owner approval-candidate installation, separate authority assignment and settlement acceptance remain pending |
| Watchdog → Telegram | Independent process, bounded reads, ignored configuration/delivery state | Bot credentials grant notification access; process supervision is not installed |

## Authentication and authorization

Operator login signs a purpose-specific message containing domain, Origin, public wallet, challenge ID, random nonce and expiry. The challenge is consumed once after Ed25519 verification. PostgreSQL retains hashes rather than raw nonce/session secrets. Sessions have expiry/revocation; cookies are HttpOnly, SameSite=Strict and Secure in production. Login and protected mutation requests use bounded per-client limits. Configure trusted proxy hops explicitly so forwarded addresses do not bypass those limits.

`readOperatorSession` also requires the session address to belong to the same current User, with an ACTIVE, verified wallet and no revocation timestamp. This check performs a fresh wallet lookup instead of caching authorization until cookie expiry. Failure uses the existing `401 SESSION_INVALID` contract, so the browser enters its ordinary authentication-recovery flow without automatically replaying a signed submission. Session expiry, explicit session revocation and role checks still apply. Regressions cover active access, wallet lifecycle/ownership changes, expired and revoked sessions, and the HTTP recovery contract. This is request-time validation; it does not add operator lifecycle administration or freeze already-authorized on-chain transactions.

Administrator mutations and Auditor reads are separate. Financial workflows additionally bind the session wallet to the instrument issuer and saved attempt. Investor ownership proof does not grant operator authority or eligibility. Provisioning is a controlled local operation using a public address; see [operator provisioning](../operations/operator-provisioning.md). Authentication is disabled unless explicitly enabled and configured; disabled protected routes fail closed.

Current rate limits are process-local and reset on restart. They do not provide a shared multi-instance abuse budget. Separate approver authority and action reserves are implemented in an isolated opt-in candidate; owner acceptance, policy rotation and a complete transfer/compliance policy remain unfinished.

## Investor registry governance

Authenticated Administrator/Auditor reads include server-filtered investor search, independent profile detail and bounded investor-wallet pages. Search text has a 200-character/control-character limit; wallet addresses remain case-sensitive. Cursor validation excludes other investors' wallets and operator mappings. All responses remain `no-store`; registry access is still workspace-wide, so these routes do not establish issuer isolation.

Administrator profile correction requires the complete display name/type/country/reference set, an exact allowed Origin, the current `expectedVersion` and a fixed reason. Unknown fields, stale/no-op writes, duplicate references and closed profiles fail safely. The capture lock and Serializable update/audit are atomic; the audit stores changed field names and versions rather than previous/new profile values. Stable Investor ID, lifecycle/KYC/eligibility, wallet mappings/proof and historical obligations are preserved. Existing migration 20 versions these profile facts; no migration, wallet authority or program permission is added. See [profile continuation](../testing/registry-profiles-2026-10-11.md).

Administrator-only eligibility review and temporary verified-wallet block/unblock require an exact allowed Origin, an active session, a fixed reason code and the affected record's `expectedVersion`. Auditor has read access. `PENDING_REVIEW` uses the separate initial-decision route; pending/revoked/operator-bound wallets cannot be temporarily unblocked, and wallet ownership cannot be reassigned. State change, previous/new version and actor/reason/correlation audit commit together or roll back. These are explicit local-demo decisions; they do not implement real KYC, investor lifecycle administration or issuer-scoped multi-tenant authority.

Migration `20261011130000_registry_review_versions` advances positive investor/wallet versions on effective changes, including controlled direct SQL writes. API compare-and-set guards reject stale forms, and snapshot persistence rechecks transient captured identity/status/network/verification/revocation/lifecycle/eligibility facts plus both versions. This detects a block/unblock or suspend/restore round trip even when the final value matches an old read. Version-only rewrites are rejected; the trigger does not authorize direct database access or create its missing actor audit. See [ADR-028](../decisions/ADR-028-registry-review-versioning.md).

Registry fact mutations are blocked during any inclusive scheduled snapshot window in this single workspace. Captured canonical-v2 JSON and relational snapshot facts are immutable; the transient freshness metadata is not part of their hash or receipt/PDA encoding. New unsigned execution checks current selected-receiver eligibility. Finalized proof and previously signed attempts preserve their original evidence for confirmation/recovery; blocking a wallet cannot cancel an already signed chain transaction. Restoring eligibility cannot rewrite an earlier ineligible record point. Issuer-scoped locking/access and historical effective-time reconstruction remain open; Administrator/Auditor-wide evidence access must not be described as tenant isolation. See the [registry contract](../features/investor-registry.md).

## Transaction integrity and recovery

- Verify network/genesis, signer, phase, exact prepared message and its validity before signing/broadcast. Changed Phantom bytes are rejected rather than silently accepted.
- Store submitted signature/audit before Localnet broadcast. Preserve ambiguous attempts for same-signature confirmation; do not treat a timeout as safe to resend.
- Require finalized transaction bytes and workflow-specific account invariants before projecting success. An RPC status string or signature alone is insufficient.
- Recheck active verified/eligible receiver mappings and stored snapshot/calculation integrity at implemented gates. Application review/funding does not authorize missing on-chain execution.
- Keep historical/missing evidence as an explicit limitation. Never fabricate finalized proof from the current balance or database status.

The bond mint has revoked mint/freeze authorities and a program PDA permanent delegate. It cannot regain the revoked freeze authority. The isolated redemption candidate atomically couples payment with burns from immutable snapshot source accounts, validates supply progression and creates a per-entitlement receipt. Insufficient sources roll back the transaction; the API never substitutes a different holder account. Snapshot authority remains trusted, ordinary transfers remain unrestricted, and historical ownership reconstruction is unsupported. See [redemption trust boundary](../features/redemption-execution-and-receipts.md), [ADR-025](../decisions/ADR-025-atomic-redemption.md) and [token authority decision](../decisions/ADR-001-token-authority.md).

## Secrets and environment

Do not store private keys, mnemonic words, passwords, authentication cookies, PATs or Telegram tokens in source, logs, screenshots, CI artifacts or public evidence. `.env`, `.local-*`, generated artifacts and ledgers are Git-ignored; ignoring a path does not encrypt it. `NEXT_PUBLIC_*` variables must contain only public browser configuration. Restrict local RPC/database interfaces to loopback and keep test credentials isolated from hosted environments.

The historical localnet program key was exposed by a diagnostic on 2026-10-01 and remains disposable/local-only. Do not reuse it for any funded/public-network authority. Phantom was not involved. Fresh Devnet identities and backup handling are documented in the [toolchain](../development/toolchain.md) and [backup procedure](../deployment/devnet-key-backup.md). Never export the Phantom key to automate an upgrade.

CI uses checksum-pinned Gitleaks 8.30.1 to scan complete checked-out Git history with 100% redaction and inline allow comments disabled. Default rules remain enabled. The only project exceptions are exact public Solana addresses in named deterministic test files under the generic-key rule. Do not ignore whole test directories, commits or credential classes. See [scanner configuration](../../.gitleaks.toml) and the [upstream CLI documentation](https://github.com/gitleaks/gitleaks/tree/v8.30.1).

Scanning reduces accidental exposure; it cannot prove absence of every secret, detect all binary wallet formats or inspect ignored local files. A detected real credential must be revoked/rotated through its provider before it is considered contained; removing the current file does not remove history. Do not paste the credential into an issue or chat.

## Threats and verification

| Threat | Current mitigation/evidence | Open work |
| --- | --- | --- |
| Login replay or wrong Origin | One-time hashed challenge, exact message/Origin, auth unit and HTTP/database tests | Browser/session-recovery variants |
| Auditor or non-issuer mutation | Server role, phase signer and session checks; isolated separate on-chain approver and rejection tests | Owner acceptance and governance recovery |
| Changed transaction or wrong network | Exact signed bytes, signer/genesis checks and regression tests | Owner negative/manual variants |
| Double send or lost response | Persisted attempts, active-attempt uniqueness, confirmation-only recovery | Durable execution jobs and reindex |
| Tampered snapshot/calculation/audit | Canonical hash rebuild, immutability, source commitments, versions and rollback tests | Owner coupon/redemption acceptance; runtime proof is scoped to the isolated candidate |
| Stale registry form or capture after a status round trip | API expected-version guards, monotonic DB triggers, exact transient snapshot facts and atomic reason/actor audit | Issuer-scoped locks/access and effective-time history; ordinary wallet transfers remain outside this API |
| Unfunded/double-allocated payout | Per-action vault custody, full-budget preflight, per-entitlement replay rejection and atomic coupon/redemption receipts | Owner reserve/payout acceptance and independent external review |
| Dependency/supply-chain defect | Lockfiles, production dependency audit, checksum-pinned scanner | 12 legacy test-harness advisories; full SBF/runtime CI and external review |

Render is disposable staging with no durable financial-data guarantee. Durable storage/backups/restore, operational access control, metrics, shared abuse limits, custody/governance design and external Anchor review are prerequisites to a production decision. Follow the [testing strategy](../testing/testing-strategy.md) and [delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md); do not mark those gates complete from this document alone.

## Action approval and reserve boundary

The isolated [action approval/reserve candidate](../features/action-approval-and-reserve.md) enforces issuer/approver separation and actual per-action Token-2022 custody. It rejects mutable/fee-bearing settlement mint extensions, foreign reserves, incomplete funds and approval replay; issuer cannot directly transfer/close the PDA-owned vault or release it after approval. HTTP also checks active verified Administrator mapping, exact wire, current eligibility before new approval and finalized token deltas. Refunding an unapproved reserve and projecting finalized evidence use the committed calculation so later suspension/revocation/pause does not trap cleanup. SOL rent/fee/buffer checks are not SOL escrow and must be repeated at future execution. Immutable policy rotation and post-approval recovery require later reviewed instructions. Owner rollout and external program review remain open; upgrade authority can still change program behavior.

## Coupon execution and evidence

The [coupon capability](../features/coupon-execution-and-receipts.md) defaults off and requires a reviewed Localnet program/genesis, finalized approval/reserve and assigned Administrator CA signer. Current receiver eligibility gates unsigned payment; later revocation cannot erase committed finalized proof. Atomic receipt PDA creation prevents repeat payment even with a different idempotency key. Exact signed bytes, receipt identities, counters and Token-2022 transaction deltas precede database legs/status/audit. An audit failure rolls that projection back; recovery checks the same signature without another broadcast.

Only reconciled finalized payments can create the canonical action document. Stored JSON values and hash must match despite jsonb key ordering; tampering blocks unsigned submission/finalization. On-chain ActionReceipt proof precedes application FINALIZED. Authenticated Administrator/Auditor receipt access is audited. Safe paginated journals disclose no prepared wire/payload and use no-store caching. Direct wallet/CLI writers and upgrade authority remain outside this API's control; public/owner acceptance and external review are separate gates.

## Program upgrade maintenance boundary

The restricted Localnet upgrade capability defaults off and requires a loopback listener, pinned manifest/artifacts and disabled entitlement registration. Every phase is rebuilt and checked against its exact signed message before broadcast. Durable ACTIVE maintenance plus PostgreSQL write triggers freeze business mutations across phases and restarts; only exact finalized candidate/authority/buffer/PDA acceptance and atomic audit release it. Recorded signatures remain confirmation-only. Authentication/read access survives; arbitrary transaction plans, key export, authority transfer and automatic unlock are unavailable.

This lock cannot exclude direct wallet/CLI activity or another database. Those writers must be frozen separately. Missing/pruned transaction proof, changed identities/accounts or audit failure retain maintenance. The pinned registration upgrade has historical owner Phantom acceptance; any newer coupon candidate upgrade and owner funding remain separate gates. See the [feature and recovery limits](../features/program-upgrade-maintenance.md) and [ADR-022](../decisions/ADR-022-durable-program-upgrade-maintenance.md).
