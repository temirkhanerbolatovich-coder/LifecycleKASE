# Localnet instrument acceptance

Status: four-phase live Phantom/Localnet happy-path issuance passed on 2026-10-02 for LKA26R1, with session recovery and exact chain/database reconciliation. Additional manual negative scenarios remain pending. This runbook does not claim complete corporate-action MVP, Devnet or mainnet readiness. Earlier sections retain the historical failed-attempt evidence.

## Acceptance boundary

The accepted flow must use a persistent local validator loaded with the repository program, a fresh migrated PostgreSQL database, the registered Phantom administrator as both transaction signer and program upgrade authority, and three distinct active verified eligible synthetic investors. Private keys and seed phrases must never be copied into the repository or chat.

The required sequence is `MINT_SETUP` -> `DISTRIBUTION 10/20/5` -> `INITIALIZE` -> `ACTIVATE`. A phase passes only after finalized transaction-message comparison and the phase-specific account/PDA reconciliation performed by the API.

## Isolated database

Use a dedicated database named `lifecycle_kase_acceptance_<run>` instead of the long-lived development database. This prevents a historical Devnet `KZT_TEST` fixture or an earlier ticker from changing the result. Apply all migrations, provision the Localnet administrator, then prepare synthetic investors:

```powershell
$env:DATABASE_URL = 'postgresql://lifecycle_kase:local_development_only@[::1]:55433/lifecycle_kase_acceptance_<run>?schema=public'
$env:SOLANA_CLUSTER = 'localnet'
$env:WALLET_NETWORK = 'SOLANA_LOCALNET'
$env:AUTH_DOMAIN = 'localhost:3000'
$env:AUTH_ALLOWED_ORIGINS = 'http://localhost:3000'
$env:ACCEPTANCE_ADMIN_WALLET = '<registered Phantom administrator public address>'
$env:ACCEPTANCE_RUN_ID = '<run>'
npm run prisma:migrate:deploy
npm run acceptance:prepare-investors
```

The helper accepts only an explicit loopback PostgreSQL URL whose database is `lifecycle_kase` or `lifecycle_kase_acceptance_*`. It generates three ephemeral Ed25519 keypairs, exercises the normal investor creation, wallet-ownership signature verification and eligibility services, prints only public identifiers, and does not persist the private keys.

## Current run evidence

- Run: `20261002A`
- Validator genesis hash: `B7rvYd7zwDaRXQArqjKxsBAu5P4k7Y2JJ2XeGVXCg5iQ`
- Program ID: `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo`
- Administrator: `5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM`
- Administrator Localnet balance prepared: `100 SOL` (test-only)
- Investor allocation targets: `10`, `20`, `5`; all three records are active, signature-verified, non-revoked and eligible in the isolated acceptance database.
- Anchor local-validator integration: passed before this live run, including initialization, activation, replay, authority, supply, eligibility and snapshot cases.
- First live `MINT_SETUP` submission returned signature `4oG85mZC91UBaniEgieHYfkYsnNgFC3QHjAfRrXTy8WWbMnDTJseMvXq8y76bcnYxLyzX2ub3J6SiqXQDLEYGrXp`, but the configured validator never observed it and its blockhash expired. The attempt is evidence for `UNKNOWN_CONFIRMATION`, not a successful phase. Do not reuse or present this signature as finalized.
- Recovery now marks an expired, history-absent `UNKNOWN_CONFIRMATION` as `FAILED / BLOCKHASH_EXPIRED_UNCONFIRMED` before preparing a fresh transaction. A signature still visible in RPC history remains resumable and is never silently replaced.
- Root cause of the first missing transaction: Phantom signed but did not route the operation to the configured local validator. The Localnet instrument UI now requests `solana:signTransaction`; the API verifies the exact prepared message and Ed25519 signature, then broadcasts the same bytes through the configured loopback RPC. Unit/fixture checks pass; the replacement live attempt is still pending.

Transaction signatures, mint, Instrument PDA, token balances, final `ACTIVE` status, reload recovery and negative-case results must be appended only after they are observed in the live flow.

## Continuation — 2026-10-02

The preserved database is `lifecycle_kase_acceptance_20261002`, reachable through loopback PostgreSQL port `55433`. The persistent validator currently has genesis `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF`; the earlier genesis above remains historical evidence. Read-back of ProgramData verified the registered Phantom administrator as upgrade authority. Its finalized balance is 100 test SOL. The existing draft UUID is `b3c3be66-f6e2-4996-aeaa-51be9cd5130b`; three active eligible investors remain available. API/web were started on loopback 4000/3000 with this explicit database/genesis/program/issuer configuration. No new operator privilege or private-key import was required.

Owner's retry exposed another signing issue: Phantom returned 827 bytes for the prepared 775-byte transaction. Submission stopped before broadcast. [Phantom automatically adds priority instructions when they are absent](https://docs.phantom.com/developer-powertools/solana-priority-fees). The serializer now includes explicit compute limit (default 400,000) and price (demo default 0) in the prepared message. The 52-byte increase is consistent with that pair; the returned wallet message was not independently captured/decoded. Exact message, signer and signature checks remain unchanged. Reload and obtain a fresh plan after an expired unsubmitted attempt; do not reuse an earlier unsigned format or accept wallet-modified bytes.

During code review, KZT-Test confirmation incorrectly required absent mint authority even though setup retains the issuer as authority for future synthetic funding. Confirmation now requires that exact issuer authority; bond authority still must be revoked and freeze authorities absent. The regression test also rejects absent or foreign KZT-Test authority before projection updates.

The isolated validator suite now additionally sends the actual application-serialized MINT_SETUP, DISTRIBUTION, INITIALIZE and ACTIVATE messages with a disposable signer; all four new phase groups passed. Mint supply/authorities, exact finalized bytes, 10/20/5 balances, treasury zero and PDA transitions are checked. This is not a claim that the preserved Phantom instrument is ACTIVE: the owner-controlled sequence and PostgreSQL projections must still be independently confirmed.

The stale production-proxy negative test and competing default faucet port were corrected; the proxy check passed and the original localnet integration suite passed while leaving the acceptance validator running. The proxy check was added to CI. Current wallet retry remains pending.

## Short-history incident and preserved recovery — 2026-10-02

The owner signed attempt `f7dbf1f4-f7b6-4847-a7ae-9f3c2a446476` for `LKA26`, signature `4vQCnqGphPnbecFHZk3mKtMxF9HpGGd7CSSWKBBZjKrfzg5SmTWaA9yan7H4DqZwPhboXsYLa6c4Y69CftkzenpQ`. Submission was requested at 13:46:58 UTC; the owner's first finalized check at 13:47:05 UTC was still pending. Later investigation found the signature absent from history and `getBlock(10350)` rejected as cleaned, with first available block 11008. The installed Agave 4.1.2 help reports a default retention of only 10,000 shreds. [Agave documents configurable history retention](https://docs.anza.xyz/cli/examples/test-validator). The early pending response alone did not indicate a failed transaction.

Finalized account read-back proves the following persisted effects, including after the validator restart:

| Account | Observed state |
| --- | --- |
| Bond `8vBiDirqZxX2tBjWmvGzqwR2xcMT1XBTzmFrHRY61oiX` | Token-2022, 202 bytes, supply 35, decimals 0, mint/freeze authority absent; permanent delegate `FNxR8MAb2JHVxPQ819ynrQbeyoUZHzCcm5RXmQmAjRfV` |
| KZT-Test `55kFAZHqRh5T4fXYoW7AuXnXVrrP8WfXUozGjygdR5Rf` | Token-2022, supply 0, decimals 6, issuer mint authority, no freeze authority |
| Treasury `DXaWjs7GqmBZrBFXRuUabo9u5oRnC2eruv8Njw1SFhMk` | Issuer-owned account for the bond mint, amount 35 |

The exact original finalized transaction bytes are no longer available. Account state plus the locally verified exact Ed25519 signature is insufficient for the existing confirmation contract; no `FINALIZED` or instrument mint projection was fabricated. The attempt remains `UNKNOWN_CONFIRMATION / TRANSACTION_UNAVAILABLE`. Confirmation now queries signature history and blockhash validity when finalized bytes are absent; the UI explains ambiguity and prohibits blind resubmission. Preparing a replacement attempt with a recorded unavailable-history error is blocked. Do not run MINT_SETUP again for these occupied addresses.

The validator was stopped and its stopped ledger copied to the sibling `ledger-stopped-backup-20261002` directory under `/home/lifecycle-dev/.local/share/lifecycle-kase/localnet-acceptance-20261002B/`. An earlier copy made while it was still running is not the stopped backup. Both remain local and contain disposable validator identity files; do not publish either. Restart used the existing ledger, no reset or new genesis, with:

```bash
solana-test-validator \
  --ledger /home/lifecycle-dev/.local/share/lifecycle-kase/localnet-acceptance-20261002B/ledger \
  --rpc-port 8899 --faucet-port 9900 --limit-ledger-size 10000000 --quiet
```

Genesis remained `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF`; all three accounts above remained present. The larger limit is finite and consumes more disk; it is a development acceptance setting, not an archival RPC guarantee. Keep the stopped backup and avoid reset flags when resuming. Deleted older blocks are not restored by increasing retention.

A new disposable-recipient airdrop probe finalized at slot 12245 and its successful exact transaction remained retrievable after 326 additional finalized slots. `getFirstAvailableBlock` still returned 11531. Probe signature: `Ange7zd2vLxo34AbEXKDPdNoqbBYV6Pm7fn25FD3Dt9Bit2CUSethVYXeMXhc2P7rPnds4yvdX2ZKCqenxjXNah`. The probe used only 0.001 local test SOL and no user's key; it verifies the changed retention behavior, not instrument acceptance.

A separately audited draft `LKA26R1`, UUID `c9a1648f-f896-4135-bb19-63bedff119f3`, was created through the normal draft service using the same terms and issuer, leaving the old draft/attempt/token accounts intact. Its independent deterministic addresses permit a fresh four-phase Phantom acceptance. It is still DRAFT and unsigned at creation. API tests pass 72/72, including pending/expired/history-unavailable distinctions and blocked replacement; web typechecking passed. The owner must sign the new draft; this document does not claim that recovery issuance is ACTIVE.

## Recovery draft: live MINT_SETUP passed

The owner signed the fresh LKA26R1 plan in Phantom. Attempt `9097577d-cc63-448c-ae13-2dca531accd5`, signature `aQHnhxLsnkD7gqY8hRK8zQypAzMo81xoyXc6uAcE543dXx1Bu8etwq874DD6gAG9j4HbrwrhTNAB8Yy6tyNpNvb`, finalized successfully at slot 12439. The original finalized bytes remained retrievable after the early pending response. The normal `confirmInstrumentMintSetup` service compared the exact prepared message/signer/signature and validated Token-2022 account ownership, supply, authority and treasury fields before an atomic projection/audit update.

- Bond mint: `QZYBisMjqfcWA2Vk4Ygvt8SZ4Vt9rTXfnmu6DkrKFh6`, supply 35, decimals 0, mint authority revoked, no freeze authority, expected permanent delegate.
- KZT-Test mint: `HgyDrHmGX6frycUDokctWddqEPTvQQoLsTMmnbVr7nrc`, supply 0, decimals 6, exact issuer mint authority, no freeze authority.
- Issuer treasury: `4SEZtwZyzizbCtcz5gjwVm8ASkmgGDQ5Y6SzJeHsr3aH`, amount 35.
- Attempt: `FINALIZED`, error cleared; instrument mint/program and KZT-Test projection written; `INSTRUMENT_MINT_SETUP_FINALIZED` audit observed at 14:05:57 UTC.
- Instrument remains `DRAFT`, version 1, circulating supply 0. Next required phase is owner-signed `DISTRIBUTION` for the three existing eligible investors (10/20/5), then INITIALIZE and ACTIVATE. Issuance acceptance is still incomplete.

Live repeated confirmation of this finalized attempt returned FINALIZED without another instrument version change. Preparing the old unavailable-history LKA26 attempt returned `TRANSACTION_HISTORY_UNAVAILABLE` and left its ambiguous status/signature intact.

Full `npm run check` passed after the diagnostics changes (including API 72 tests, client 26 tests, root 18 tests, remaining workspace tests/typechecks, Prisma/schema and documentation checks). No GitHub push or Render deployment was performed.

## Historical DISTRIBUTION session recovery gate — resolved below

Attempt `4792bfc2-e8b1-41f1-b838-1809d3d77793`, signature `4gS9kk2tUfYTeCz9BdcWp1wnuhZffPstbtJj9gihyyhE8XJo3928FV8TPjbpz2pFNP7788FNwqyJbnAWZNugXKxn`, finalized without an on-chain error at slot 15349. Read-only verification compared its exact finalized message with the stored prepared wire and checked the three persisted holder mint/owner/amount fields:

| Investor allocation | Token account | Finalized amount |
| --- | --- | --- |
| 10 | `GujirPt3Xmsu8KhZrJHXFBm72fGt1ExTEXKxsoXueWii` | 10 |
| 20 | `78QCHKvzHUcQbDFcw5cDDVpVD8biVsvTpdTYkGnRLcwo` | 20 |
| 5 | `Bk6zezGWPoXiv3d6emLKGGTqbMRfiRmT8jrUNwUGh5HP` | 5 |

Issuer treasury amount is 0. The browser's subsequent confirm was rejected with `SESSION_REQUIRED` after the operator cookie became unavailable/expired. This is an authentication recovery gate, not a failed distribution. The database attempt is still `UNKNOWN_CONFIRMATION / TRANSACTION_NOT_FINALIZED`, instrument DRAFT with circulating supply 0; no direct database projection update or synthetic authentication was used to bypass the rejected protected request.

The UI now localizes missing/expired-session errors and offers same-wallet message reauthentication while keeping child workflows mounted. Requests are not automatically retried. API prepare responses restore a pending signed attempt's original signature/status; after a full reload the browser disables another submission and allows only confirmation. Choose the original 10/20/5 investors and prepare DISTRIBUTION again to restore the same UUID, then confirm under a fresh legitimate session. A transaction signature is not a replacement for session authentication.

Focused validation: API 73/73, web 16/16, web typecheck, loopback API readiness/dashboard and diff checks passed. Tests cover both session errors, no automatic mutation replay, other-error isolation, restored signed attempts after blockhash expiry across all four phases and malformed resumed signatures. Live same-wallet reauthentication and the protected confirmation result remain owner-controlled and pending.

## Accepted live issuance checkpoint — 2026-10-02

The owner restored authentication with the same Phantom issuer and confirmed DISTRIBUTION through the protected API. The new legitimate session was created at 14:35:39 UTC, followed by the distribution projection/audit at 14:35:55 UTC. The original distribution UUID and signature were retained; no second distribution attempt was created. The owner then signed/confirmed INITIALIZE and ACTIVATE and supplied an ACTIVE dashboard screenshot. Independent read-only verification re-fetched all four successful finalized transactions, compared each complete wire message to its stored preparation, decoded the program-owned Instrument PDA and compared all immutable terms/authorities/mints/dates/supply with PostgreSQL.

| Phase | Attempt UUID | Finalized slot | Signature |
| --- | --- | --- | --- |
| MINT_SETUP | `9097577d-cc63-448c-ae13-2dca531accd5` | 12439 | `aQHnhxLsnkD7gqY8hRK8zQypAzMo81xoyXc6uAcE543dXx1Bu8etwq874DD6gAG9j4HbrwrhTNAB8Yy6tyNpNvb` |
| DISTRIBUTION | `4792bfc2-e8b1-41f1-b838-1809d3d77793` | 15349 | `4gS9kk2tUfYTeCz9BdcWp1wnuhZffPstbtJj9gihyyhE8XJo3928FV8TPjbpz2pFNP7788FNwqyJbnAWZNugXKxn` |
| INITIALIZE | `4354cc49-7635-4224-a33d-5e6dc5e4696b` | 17211 | `3AG3PNEmP7CX8Fb4W42hLGS1Y83rrAUWa4bb47N8fZcGavLeYxiXzeYZJp4wBudx1C87C6hcbbuAdsQ743CYwy9J` |
| ACTIVATE | `7cfb65bd-bbad-4a70-83de-68b996b9dbb7` | 17316 | `5rEnFKds7eqqG8TaHehrU8zXCepsPuHo1CiGu1dBrMLFCDeSLM3D3tU7uj7bXVTrwetD9VBLmWkfTzCLSB5TCrrk` |

Final instrument UUID `c9a1648f-f896-4135-bb19-63bedff119f3`, ticker LKA26R1, DB status ACTIVE, version 4, total/circulating supply 35/35. Instrument PDA `HP2ra68JTYBJNdms2vnLNhKGCRfr3ekeGiXwNjh8CycF` is owned by the configured program and decodes to ACTIVE, the same UUID, issuer/compliance/action authorities, bond/KZT-Test mints, nominal 1,000,000,000 minor units, coupon 1,000 bps, two payments/year, issue/maturity timestamps and total supply 35. Final Token-2022 holder balances are 10/20/5, issuer treasury 0. The database has exactly four successful phase attempts with cleared errors and corresponding finalization/initialization/activation audit events.

The old LKA26 draft and unavailable-history attempt remain preserved. The shared KZT-Test projection now belongs to the accepted LKA26R1 mint; do not attempt another setup for the historical LKA26. No keys or signature substitutes were imported; no expired-session bypass was used. Full `npm run check` passed with API 73, web 16, client 26 and root 18 tests plus the other workspace checks. Live snapshot/corporate-action execution is not yet accepted. Owner cancellation, wrong signer/network and other manual negative/reload cases beyond the observed session recovery remain separate gates. GitHub/Render were not updated with these local changes.
