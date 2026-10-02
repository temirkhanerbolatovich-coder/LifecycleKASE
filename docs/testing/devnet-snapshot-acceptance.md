# Devnet snapshot acceptance

Status: staging login and session persistence after refresh reported working by the operator; independent authenticated checks and Devnet snapshot acceptance remain pending.

## Preparation checkpoint — 2026-10-01

- [x] Disposable staging selected and one reviewed operator provisioned through the controlled CLI.
- [x] Web/API revision `fd6cb81` verified Live; exact domain/origin and secure-cookie settings reviewed before explicitly enabling authentication. See the [deployment evidence](../deployment/render-staging.md).
- [x] Same-origin challenge and unauthenticated-denial boundaries checked; these are not signed-login evidence.
- [x] Windows/Ubuntu development tool versions rechecked with `npm run check:toolchain` on 2026-10-01.
- [x] User reported successful Phantom login with the expected profile and session persistence after page refresh on 2026-10-01. This is operator-reported evidence, not an independent authenticated API/database inspection.
- [ ] Verify logout and subsequent login, including denial of protected operations after logout. Never record cookie values.
- [x] Separate `lifecycle-dev` WSL account prepared on 2026-10-01 with user-owned pinned tools and a passing local-validator smoke test; no administrative groups. No persistent wallet keys were created during that account-setup step. Default WSL user remains `root`, so launch `-u lifecycle-dev` explicitly. See [toolchain instructions](../development/toolchain.md).
- [x] Full Anchor/SBF compilation and IDL generation passed as `lifecycle-dev` with Linux-owned temporary outputs on 2026-10-01; non-secret artifacts retained in ignored `generated/non-root-build/`. This is local build evidence, not a deployment.
- [ ] Establish the reviewed Devnet program, authorities, RPC configuration, mint/distribution, synthetic investor mappings and scheduled action listed below.
- [ ] Use a newly reviewed Devnet program identity, never the compromised disposable localnet keypair described in the [toolchain security note](../development/toolchain.md#security-boundaries).
- [x] Fresh Devnet-only candidate deployment wallet and separate program keypair generated after explicit approval; permissions and local signing checks passed. See [key custody limitations](../development/toolchain.md#devnet-key-preparation--2026-10-01).
- [ ] Owner confirms reviewed offline backup and deployment/upgrade-authority plan; new public program ID integrated and rebuilt. Generating keys does not close this gate or authorize a network deployment.
- [x] User approved CLI fee payer and Phantom upgrade authority/issuer; recorded in [ADR-013](../decisions/ADR-013-devnet-demo-authorities.md). Actual assignment and backup remain pending. Follow the [ordered delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md).

Do not submit a snapshot merely because the login panel is available. Preparation evidence does not close the remaining end-to-end prerequisites.

## Read-only network and authority review — 2026-10-01

Explicit public Devnet CLI checks returned genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, a finalized deployment-wallet balance of `0 SOL`, and `AccountNotFound` for the fresh candidate program identity. No funding, transaction, authority assignment, backup or deployment was performed. These observations are time-specific; re-check immediately before a transaction. They do not verify the API's configured RPC.

The current `initialize_instrument` implementation requires the signing administrator to equal the program's upgrade authority and stores that address as `instrument.issuer_authority`. Activation/action/snapshot instructions then require that issuer; the API additionally requires the session wallet to match the issuer. Consequently, appointing the CLI deployment wallet as upgrade authority would prevent the existing Phantom operator from managing instruments initialized by that wallet. Deployment fee payer, program keypair and upgrade authority are different concepts; possessing a new program keypair does not grant issuer access.

Before changing public program-ID projections or deploying, explicitly choose either (a) Phantom as upgrade authority/initial issuer, using the implemented wallet-signed initialization, or (b) a reviewed contract change separating bootstrap administrator from instrument issuer. Option (b) needs new authorization tests and is not implemented. Never import the Phantom seed into the CLI as a workaround. The UI now supports all four deployment phases plus snapshot registration, but none of the complete issuance sequence has live Devnet acceptance. Owner-controlled offline backup remains pending.

## Safe wallet setup

The operator creates a separate test wallet on their own computer. One supported route is the browser extension downloaded from [Phantom's official site](https://phantom.com/download), following its [wallet creation guide](https://help.phantom.com/articles/how-to-create-a-new-wallet-in-phantom-8071074929043). Enable Settings → Developer Settings → Testnet Mode → Solana Devnet using the [official testnet instructions](https://help.phantom.com/articles/5997313271699).

Keep the recovery phrase and private key outside chat, the repository, screenshots and server settings. Share only the public Solana address and the desired operator display name for reviewed provisioning. Use a browser with the extension installed; a separate embedded browser may not see that extension. The application checks the wallet's advertised Devnet/v0 features at runtime; installing a wallet is not acceptance evidence. No purchase or mainnet funding is required for this demo. Devnet tokens have no real value.

## Prerequisites — all must be satisfied

- [ ] Reviewed disposable environment and target database; no real investor data.
- [ ] Actual deployed web/API revision, liveness, database readiness and exact browser-origin/CORS configuration checked.
- [ ] Public operator address independently checked and provisioned through the [controlled runbook](../operations/operator-provisioning.md); no ad hoc role changes.
- [ ] Separate reviewed Devnet program deployment and its upgrade/issuer authorities established. The checked-in local program ID and local validator test are not a Devnet deployment.
- [ ] API configured with Devnet RPC and its verified genesis hash. A `ready` health response alone does not test RPC.
- [ ] Active instrument, Token-2022 mint and 35-token distribution (10/20/5), eligible synthetic investors and verified wallet mappings exist in both relevant chain/database projections. The UI/API can prepare and confirm all four phases, but this prerequisite remains open until the live wallet/validator sequence succeeds.
- [ ] Existing SCHEDULED action with a future record date and sufficient time to register within the bounded window. Never backdate a missed snapshot.
- [ ] Session operator is ADMINISTRATOR and the same address is the instrument's issuer signer/fee payer.
- [ ] Test SOL available for the wallet's Devnet transaction fee; private keys remain user-controlled.

Only after provisioning and environment review should operator authentication be deliberately enabled. Do not enable it just to make the panel visible.

## Acceptance flow and evidence

1. Sign the exact login challenge in the operator's wallet. Verify the expected profile and address; an unregistered wallet must not log in. Do not record cookie/session tokens.
2. At the permitted record window, enter the action UUID and prepare the plan. Record the non-secret attempt UUID, snapshot UUID/hash, program and Action PDA, genesis hash, planned record time and effective capture slot/time.
3. Review the plan and the wallet request. Confirm explicitly in the wallet; record the transaction signature. This must be snapshot registration only, not payment/burn. DEMO_CAPTURE_SLOT does not prove historical ownership at an earlier planned record date.
4. Invoke the separate API finalized check. If it reports TRANSACTION_NOT_FINALIZED, retry only confirmation later. Successful submission is not FINALIZED evidence.
5. Require the exact transaction message, issuer signer and successful on-chain result, matching program-owned Action PDA, database FINALIZED attempt/snapshot, SNAPSHOT_CREATED action and finalization audit event. Record how each was observed; do not infer database/audit state from a screenshot alone.
6. Repeat the same confirmation and establish idempotency. Exercise wrong wallet/network and malformed or mismatching confirmation inputs using isolated test attempts, without submitting unintended transactions.
7. Exercise recovery after reload using the same action UUID, attempt UUID and signature. If a wallet response is lost, first inspect wallet history; do not blindly send again. The UI intentionally disables another send after invoking the wallet and does not persist identifiers in browser storage.

Record failed or skipped checks separately, including their cause. This checklist does not certify production custody, KYC, financial execution, durable backups, or the full corporate-action MVP. Wallet setup alone closes none of the program/mint/registry/action gates.
