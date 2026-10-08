# Investor entitlements and review

Implemented locally on 2026-10-02. This application slice calculates and approves obligations; it does not fund, transfer, burn, create execution receipts or change the program's review status. See [ADR-017](../decisions/ADR-017-stored-entitlements-and-demo-approval.md).

## Flow

1. Complete separate finalized snapshot confirmation. A signed transaction alone leaves the database pending. The dashboard's confirmation button retries only TRANSACTION_NOT_FINALIZED, at most 16 checks spaced three seconds apart; session/history/message/rate/transport failures stop immediately. The same operation UUID/signature is retained; no new transaction is sent.
2. Open the action's **Начисления и согласование** panel. Administrator must use the instrument issuer wallet. Auditor can read receiver choices, calculations and audit but cannot calculate or decide.
3. Select one verified active settlement wallet per investor. The server chooses it automatically only when exactly one valid choice exists. This wallet may differ from the captured token wallet, but must belong to the same Investor ID and network. Redemption still requires later current bond-source/burn checks.
4. Calculate and store integer results. All snapshot wallets/accounts are aggregated per investor. Canonical coupon balances 10/20/5 produce 500/1000/250 KZT-Test, total 1750. Maturity includes principal plus final coupon; early redemption floors token count and preserves the remainder.
5. Submit CALCULATED to UNDER_REVIEW with a comment. Review source/intent, planned/effective snapshot point/hash, eligibility, receivers, formulas, amounts and expected payment/burn effects.
6. Explicitly approve, reject or return for revision with a comment. Approval verifies every stored calculation again, sets author/time and positive rows READY. Zero-rounding rows stay NOT_ELIGIBLE_ZERO_ROUNDING. Rejection is terminal. Revision uses the same immutable snapshot and entitlement IDs and appends another complete calculation audit.

Calculation preserves blocked eligibility facts rather than silently omitting a holder. Approval fails if any receiver/investor is currently ineligible, totals/coverage differ, inputs have changed, or no positive obligation remains. A corrected ownership/record date needs a new action. Registry correction/suspension and cancellation of a returned action are not part of this slice.

## API and security

| Route under `/api/v1/corporate-actions/:id` | Body / response |
| --- | --- |
| GET `/entitlements` | Current action version/status, approval metadata, integer-string results, current eligibility and receiver choices |
| POST `/entitlements/calculate` | `{version, receivers?: {investorUuid: walletAddress}}` |
| POST `/entitlements/review` | `{version, decision: SUBMIT or APPROVE or RETURN or REJECT, note}` |

Authentication, Administrator writes/Auditor reads, Origin, no-store and existing mutation rate limits apply. Mutations require the issuer session wallet, exact current action version and a finalized REGISTER_SNAPSHOT database operation. They reconstruct canonical snapshot-v2 bytes from immutable relational rows and compare hash/payload/counts/times/supply. Serializable transactions save results, action state and actor/correlation audit atomically. Unknown fields, arbitrary caller amounts/formulas, unsupported decisions and stale versions are rejected. A lost response is recovered by reading/refreshing; stale retries cannot duplicate entitlements or approvals.

`integer-entitlements-v1` and `eligibility-v1-local-demo-explicit` are stored with inputs. Money uses bigint calculations, integer basis points, checked u128/u64 domain arithmetic and the stricter PostgreSQL signed-bigint range. Browser formatting preserves six decimal minor units without Number conversion. Snapshot and action terms are not edited by review.

Strict KYC eligibility remains the default. Localnet synthetic holders with NOT_STARTED KYC may use an explicitly reviewed DEMO_CRITERIA_MET decision; the result is labelled LOCAL_DEMO_ELIGIBLE. This neither modifies KYC nor permits public Devnet, expired/rejected/pending KYC or an unreviewed holder. Current recipient ownership/network/status/verification/revocation and investor status/eligibility are checked at approval and by `requireApprovedEntitlements` before future execution.

APPROVED is an application state. The retained program's Action PDA remains SNAPSHOT_CREATED and no payout/receipt instruction is added. Future settlement must use the execution gate and enforce reviewed authorization/replay/current-source conditions on-chain. Same-Administrator author/approver is permitted for the demo by ADR-006; separate maker/checker remains future work.

## Verification

- `npm run check`: schema/type/documentation/workspace tests; domain and Rust read the same `test/fixtures/financial-parity.tsv` for canonical, remainder, zero and overflow vectors.
- WSL lifecycle-dev: both locked/offline Rust profiles, format and Clippy checks. The math module adds no instruction and requires no live program upgrade.
- `npm run test:actions:database`: uniquely generated disposable DB, real HTTP authentication and calculation/review workflows for coupon/maturity/early types. Explicit synthetic finalized snapshot fixtures test application logic, not chain proof. Includes multi-wallet/token-account investor aggregation, version concurrency, Origin/roles, revision, amount tampering, revoked receiver, audit rollback and execution gate.
- Combined validator harness additionally calculates/reviews a snapshot genuinely collected/registered/confirmed through HTTP/PostgreSQL on the disposable validator. The persistent owner ledger/database remain untouched by the harness.
- `npm run test:web:proxy`: production build and fixed allowlist transport, including the three entitlement routes (30 total, including the later funding slice).

Persistent owner snapshot and approval evidence belongs in [the live runbook](../testing/localnet-action-acceptance.md). Isolated tests and application APPROVED do not prove an executed payment or public deployment.

## Controlled Localnet confirmation recovery

An OS operator explicitly authorized to administer the local demo may run `npm run localnet:confirm-snapshot -- <action UUID> <signed operation UUID>`. Set `LOCALNET_CONFIRM_DATABASE_URL` to the explicit loopback development/acceptance database, `LOCALNET_OPERATOR_WALLET` to the original issuer Administrator, and the existing `SOLANA_CLUSTER`, `SOLANA_GENESIS_HASH`, `SOLANA_RPC_URL`, `WALLET_NETWORK` settings. The tool does not load `.env` or extract a browser cookie/session/private key.

It requires an already signed persisted REGISTER_SNAPSHOT attempt, pinned genesis/issuer, original authenticated preparation audit, current Administrator role and active verified operator wallet. The existing backend checks the exact finalized message and full snapshot commitment before writing only the projection/audit. This is trusted local OS/database recovery, not an HTTP role/session bypass or a public-network service. No attempt is prepared, signed or broadcast. Audit identifies the original preparing actor and explicitly records CONTROLLED_LOCALNET_CLI as confirmation source. Regular HTTP confirmation records HTTP.

Appending `prepare-review` to that same command uses the existing calculation/review service to store amounts and submit them UNDER_REVIEW. It requires exactly one valid receiver per investor; ambiguous choices still require the authenticated dashboard. Repeating preparation reads the same stored result. The tool cannot APPROVE, REJECT or RETURN an action, change terms/holdings, sign or pay. Calculation/submission audit records operationSource CONTROLLED_LOCALNET_CLI; HTTP mutations record HTTP. This supports the owner's authorized technical preparation while leaving the actual business decision explicit.
