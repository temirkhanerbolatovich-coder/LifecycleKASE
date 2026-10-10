# Coupon execution acceptance — October 10, 2026

## Boundary and artifact

Financial acceptance uses disposable validators, temporary signing keys and generated PostgreSQL databases. Scripts do not import `.env`, sign through the owner's Phantom, or reset the retained environment. Cleanup targets only generated `actions_test_<32 hex>` databases and the harness's temporary files.

Candidate: `generated/localnet-candidate-coupon-v2-20261010/lifecycle_kase.so`, program `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo`, 526624 bytes, SHA-256 `ccc5ebe7841a43fc22f8c687557264f22025a35840ebf1aae10b820df3d84295`.

The preceding v1 build emitted an SBF stack-frame overflow despite exit zero. It was rejected for acceptance. Boxing the large execution accounts removed that diagnostic in v2; only v2 was deployed to disposable validators.

## Direct validator acceptance

The opt-in coupon run on port 18948 passed the approved reserve flow and actual finalized 500/1000/250 recipient amounts, receipt identities and processed counters 1/2/3. SDK bytes/account roles matched Anchor. Wrong receiver and incomplete finalization rolled back without creating receipts. Same-key and different-key replay rejected without changing balances. Final ActionReceipt hash/count/total matched, vault became zero and bond supply stayed unchanged. Final receipt replay rejected.

The early-date negative branch is conditional on the disposable clock; this record does not claim an unconditional premature-runtime rejection.

| KZT-Test | Disposable finalized payment signature |
| --- | --- |
| 500 | `5S9jFeJabmUrUPgGijL8z7TbJ2wwgWp2QpEYwGfv35V9s3bgob3b5LvyXXbG1biuVe9YNFvFkQrmEsumL78baE7s` |
| 1000 | `mHGNrxRJ4YkU9CrrjKjbhisjcj5Egrp1cwj7HbtSJVS9zvZGCx64wsHrq6KYGdmMoyRWpeLY4mubqRiYFPD4aQz` |
| 250 | `5Tw1YzLqTp2TDrFcXSqoG6QdytggGF75Q24ii7JahzQPw199bNrUMwd2AEW7f6FQx2A4WCBmCjD6VVdZgVKhqZWw` |

ActionReceipt PDA: `AhhqPw69aoh1AJkrLNqfAtgzqV5qEt4URa1BxhmeuVEZ`. These are Localnet records, with no public Explorer proof.

## HTTP/PostgreSQL verification

The real-validator harness composes issuance, scheduling/snapshot, funding, calculation registration, separate approver/reserve, payments and final receipt with an isolated database. Iteration found and corrected three projection issues: consistent settlement creation/finalization timestamps, actual amount null for a NOT_APPLICABLE Asset Leg, and use of the existing action schema rather than an invented completion field. The action's processed count now advances atomically with each confirmed entitlement; completion time is recorded by ActionReceipt and audit.

The port 18958 rerun passed on 2026-10-10: action `0ab493fd-b903-40b4-85de-57cf6bd41327`, genesis `2qmzoD1w9pCxZWSq2Vs5KVVUcBk4Gizq2fY83doUcJbS`, canonical receipt SHA-256 `d33a90aaae58f4eaa0a794f49bfe71c9a623f45ad8c8e0b38931dd54bd2363c9`, finalized receipt signature `5zzMYBEZGZMnSLy4AhYJ6TvwMxHaLzka9FERxsEduCMhEpczrcb1uPLLkm5JvQcHRREWzwv8oxpNBFzqWGV21Mwn`. The harness asserted exact 500/1000/250 token deltas, roles/Origin/current-receiver checks, saved-key restore/conflict, changed-wire rejection, no rebroadcast, missing-history recovery, audit rollback, two persisted legs MATCHED, processed count three, tamper rejection and canonical hash/PDA/FINALIZED state. Journals passed authentication/no-store/paging/signature checks. Only the generated test database was removed. Negative checks inject audit failures deliberately; their error logs are expected assertions, not silent failures.

The final port 18960 rerun also passed after exact browser wire binding was added. Every PAY plan and the FINALIZE plan returned by the live API were accepted by the actual browser parser before fixture signing. Action `f0606975-826c-4ad1-b755-5efc17dbfa72`, genesis `8U6nqZjPvqApbQk2eMySbhwkNRY5ZWrUu7ydzT2AyHKa`, canonical receipt SHA-256 `68cca3254652914a6c47344dba83dbde4498b4abdcadabdeb75cc424f451f40c`, final receipt signature `5FZA1JqPA4TZjhgG9oBEBHNLzZpQFrY5Z7wTaX1cEXmNYXj1xezt4jX1pgGibfsa1fsuMqgymc9B6yf19cR7qJcK`. All coupon assertions, maintenance/read boundaries and generated-database-only cleanup passed. The preceding port 18959 run stopped at an approval confirmation when finalized transaction bytes were temporarily unavailable; the test now retries that same signature within its deadline without preparing or broadcasting again. The runtime/API remained fail-closed.

The coupon opt-in shell harness compiles browser test output before validator startup; ordinary approval runs do not depend on pre-existing web test artifacts. Bash syntax, the Windows Node compiler invocation from WSL and Node harness syntax were verified.

```powershell
$env:APPROVAL_HTTP_ACCEPTANCE_ONLY='true'
$env:COUPON_ACCEPTANCE='true'
$env:ACTION_TEST_DATABASE_URL='postgresql://lifecycle_kase:local_development_only@127.0.0.1:55433/lifecycle_kase?schema=public'
$env:WSLENV=($env:WSLENV+':APPROVAL_HTTP_ACCEPTANCE_ONLY:COUPON_ACCEPTANCE:ACTION_TEST_DATABASE_URL').Trim(':')
wsl -d Ubuntu -u lifecycle-dev -- bash -lc 'bash scripts/test-initialize-instrument.sh 18960 localnet-candidate-coupon-v2-20261010'
```

## Source and browser scope

Both Rust profiles passed 12 unit tests and all-target Clippy with warnings denied. Repository checks cover API role/paging/receipt-integrity guards, client layouts/PDA identity and UI plan binding/stages/attention/recovery. `npm run check` passed 294 tests: API 117, web 54, domain 27, Solana client 49 and root 47; type/schema checks passed. Both coupon phases verify exact production instruction bytes, account order/privileges, ATA receiver and idempotency commitment before a wallet request; altered or hidden instructions fail closed. The production proxy suite passed all 51 allowlisted routes.

The available in-app browser is the acceptance target. Live localhost:3000 shows the rebuilt login shell; its session requires a wallet signature. Protected screens are tested in an isolated production build of the actual components with synthetic Auditor data and all writes disabled. UI fixtures provide presentation evidence; actual validator/PostgreSQL checks provide payment proof. Direct Chrome control, native zoom, screen readers and owner Phantom execution are not claimed.

Presentation passed at 390, 768 and 1440 px, including current-step visibility, all seven desktop sections, preserved selection, folded prior stages, signed confirmation-only restore and Auditor write restrictions. [Desktop](screenshots/coupon-workspace-desktop-2026-10-10.jpg) and [mobile](screenshots/coupon-workspace-mobile-2026-10-10.jpg) screenshots use explicitly labeled synthetic data. The final receipt control completed its UI callback; the browser download-event tool timed out and native file saving is unverified. See the [UI acceptance chronology](operator-workspace-ui-2026-10-10.md#subsequent-coupon-and-journal-modernization).

## Owner read-back

Read-only check at `2026-10-10T09:18:16.341Z`, minimum finalized slot 169394: original genesis `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF`, program SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d`, deployed slot 106314, capacity 344640. Action `464a832a-2c55-4e22-bb7a-6be93b429c78` remains UNDER_REVIEW version 6, chain CALCULATED, registered 3, total 1750000000, processed 0. Policy/reserve/vault absent; settlement supply/treasury zero. Held FINALIZE remains UNKNOWN_CONFIRMATION with the original signature; funding PREPARED/unsigned, approval attempts zero. Candidate owner installation/acceptance is a separate gate.

Final read-only repeat at `2026-10-10T10:06:15.056Z`, minimum finalized slot 176217, confirms those same hashes, state, counters, empty custody/supply and retained attempts. The rebuilt owner API keeps `ACTION_APPROVAL_RESERVE_ENABLED=false` and `COUPON_EXECUTION_ENABLED=false`. Local web/API were restarted with the existing database/genesis: dashboard and API readiness return 200; journals return 401 without a session. No owner signature or ledger mutation was requested.

Post-acceptance read-only repeat at `2026-10-10T10:18:14.694Z`, minimum finalized slot 177929, again confirms every retained-owner assertion above. The temporary UI server was stopped and the browser viewport override reset; the open deliverable is the actual localhost:3000 application. Its authenticated signing flow was not invoked.

See [feature](../features/coupon-execution-and-receipts.md), [ADR-024](../decisions/ADR-024-atomic-coupon-receipts.md) and [delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md).
