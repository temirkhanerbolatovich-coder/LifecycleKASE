# Action approval and reserve acceptance — 2026-10-09

Scope: separate approver and per-action custody for the local coupon slice. Candidate implementation is isolated from the retained owner program/ledger/database. No owner upgrade, assignment, treasury funding, reserve, approval, payout or burn is authorized/performed by this acceptance.

Final source and owner-boundary refresh: 2026-10-10.

## Candidate

- Profile: `generated/localnet-candidate-approval-v2-20261009`.
- Program identity: existing Localnet ID `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo` on a **separate disposable validator**.
- SBF SHA-256: `95675491ca7beb54b7d53746b434c53a772abf12148dfe9b0439596ee0e8f3db`; size 466120 bytes.
- Existing Instrument/Action layouts are preserved, statuses appended; new policy 82 bytes, reserve 187 bytes, bare vault 165 bytes. The accepted owner manifest still pins the earlier entitlement candidate; this approval binary is not installed there.

## Validation

| Layer | Result / proof boundary |
| --- | --- |
| Source check | Complete `npm run check` passed 273 tests: API 112, web 41, domain 27, client 46, root 47; Prisma, TypeScript and documentation checks passed |
| Rust | Localnet/Devnet host suites each passed 12 tests; both Clippy profiles passed with warnings denied; isolated Anchor/SBF/IDL candidate build passed |
| Real HTTP/PostgreSQL, synthetic RPC | Generated action DB, all 19 migrations; actual auth/Origin/roles, distinct verified approver, exact wire and token-history identity/delta checks, rent/fees/SOL preflight, unsigned expiry, signed uncertainty/no resend, concurrency and audit rollback/idempotency passed |
| Cleanup/regression | Investor suspension prevents new approval; revoked approver after preparation prevents first assignment/approval submission without broadcast or recorded signature. Unapproved refund remains possible after receiver suspension, approver/mint-authority revocation and pause; pause blocks a new reserve. Legacy review cannot bypass persisted policy when flag is disabled; a second action still calculates/submits after assignment |
| Production web/proxy | Isolated app copy builds, routes forward through the fixed upstream preserving Origin/cookie/body, and unknown routes remain isolated; owner `.next`/running localhost:3000 remain in use |
| Browser | Production fixture renders the actual approval panel: issuer RESERVE review, separate approver APPROVE review with future rent/base fees, Auditor read-only controls; no wallet connected, no signature/send, no console errors |
| Real validator | Focused custody/negative suite and live HTTP/database acceptance passed on separate disposable validators. Exact reserve/refund/refill, wrong authorities/hash/amount/foreign PDA, direct withdrawal/close, funded reset, insufficient SOL, double allocation and approval replay/post-approval refund rejection were checked |

The fixture browser screenshot is a local ignored artifact `.local-action-approval-browser-20261009.png`, not evidence of an owner or real-chain approval.

## Finalized disposable HTTP/database/chain evidence

The live API flow creates a real immutable 10/20/5 snapshot, mints the exact simulated coupon budget, confirms all three canonical entitlement registrations and FINALIZE, assigns a separate approver, reserves/refunds/reserves 1750 KZT-Test, and confirms APPROVE through the same HTTP service. Finalized token history and PDA state reconcile with atomic application APPROVED/READY, actor/time/version and five phase audits; repeated confirmation adds no audit. The generated database is removed after acceptance.

- Validator genesis: `CqNZS62L4yBVSKwVk1g5vHGQmLJkRejJHMMKf12NTU78`.
- Action: `2e67d79e-989b-4675-9d18-d59f51c1326b`.
- Snapshot: `f5d449d30bf16b2e86875f06032afc815e3554b38e1211a35b27d171adccbc60`; effective finalized slot 894, total bond balance 35.
- Issuer: `8nM7VUy7ofEyxNG2dNyJm3vY6SUzC71BbgURYyBS7fkC`; approver: `5LbiaMMAMUPx3VjiyAjpyjrmePGvYJadwP8WBhMwgHFK`.
- Policy signature: `53TyCSa6nZx2zyXF5qETF1EuV1uyXfD1oCa9YR6H8B1drvkDuwZDus1SGHsJbjgLrcZ8QBK8BLbfLDYrWk19LQ5d`.
- Final reserve signature: `2J6tP3wFJzRRioKPMJ4W4JB42TzdnWLpS6VR7jC9Jsc3E7P9YiyWjri2pwFicLxeJ9S1fuxaiEYD1i85KjEiXaC3`.
- Approval signature: `629hTP12CrAyG69Nete2ermYanwaRDgEZGYS5SjYxuvyPJPWiTujVxUsvN6KpdorQBaQFz7MGWF3ih4wobctqiL`.
- Reserve: `4A9kJL43nNvkkcfJstCLMJiTRUS7Zgzmk5VUo5XC3Ft1`; vault: `6e6D8noiynPHW25Rrv3kY8r8Ho5kkfuRadG1ahxWyy3C`.
- Final reserve balance: 1750000000 minor units; chain status APPROVED; treasury balance zero. No investor payment or burn.

The later source review adds strict action metadata matching, instrument-version validation, bounded token proof amounts and the approver/pause checks above. Those refinements passed the real HTTP/PostgreSQL suite with controlled RPC fixtures; the recorded full real-chain flow predates those final refinements. No second live-chain run or owner acceptance is implied.

## Reproduction

Standard source/Rust commands are in the [testing strategy](testing-strategy.md). Build a new reviewed candidate into an unused output directory with `CANDIDATE_OUTPUT_NAME=localnet-candidate-approval-<unique-suffix> bash scripts/build-localnet-candidate.sh` under the non-root WSL developer. The script refuses to overwrite existing artifacts.

For focused real custody/negative tests, set `$env:APPROVAL_ACCEPTANCE_ONLY='true'` and run `scripts/test-initialize-instrument.ps1 -WslUser lifecycle-dev -Profile localnet-candidate-approval-v2-20261009`. All four approval instructions are required; missing instructions fail this mode.

For real HTTP/PostgreSQL/chain acceptance, first clear/disable `APPROVAL_ACCEPTANCE_ONLY`, set `$env:APPROVAL_HTTP_ACCEPTANCE_ONLY='true'` and `ACTION_TEST_DATABASE_URL` to the explicitly configured loopback base `/lifecycle_kase` database (not the retained acceptance DB), then run the same harness with a free RPC port. It builds the API/client, provisions only temporary in-memory operators, uses a fresh validator, creates/migrates/drops only a generated `actions_test_*` DB and requires exact finalized phase/account/token-history evidence. Clear the test flags after use. All signed keys/funds are disposable test fixtures.

## Owner boundary and remaining gate

The original owner coupon is still UNDER_REVIEW version 6; its three canonical registrations total 1750 KZT-Test. FINALIZE `436213b5-cd0c-44f9-8fb3-9547ec91b496` remains UNKNOWN_CONFIRMATION for checking under the owner's instruction. No closure/replacement/reset is part of this feature. Original snapshot, ACTIVE 35/35, accepted program hash and unsigned funding are preserved. [Owner evidence](owner-entitlements-2026-10-09.md) remains authoritative.

Read-only refresh on 2026-10-10 at 06:18:22 UTC used minimum finalized slot 143737: retained ProgramData deployed slot 106314, capacity 344640 bytes and SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d`; owner action CALCULATED, registered=3, total=1750000000, processed=0. Approval policy/reserve/vault are absent and no new approval attempt exists in the owner DB. Settlement supply/treasury remain zero, funding PREPARED with no signature, and the held FINALIZE retains its original signature/status. This verifies preservation rather than resolution of that attempt.

Owner FINALIZE resolution, governed installation of the reviewed new candidate, separate-approver provisioning/assignment, funding and Phantom acceptance remain distinct gates. The next engineering slice is atomic coupon payout from the action vault plus an execution receipt and reconciliation. Approval alone is not payment or complete MVP readiness.
