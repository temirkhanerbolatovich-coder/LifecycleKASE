# Devnet snapshot acceptance

Status: checklist only; real-wallet acceptance has not been performed.

## Safe wallet setup

The operator creates a separate test wallet on their own computer. One supported route is the browser extension downloaded from [Phantom's official site](https://phantom.com/download), following its [wallet creation guide](https://help.phantom.com/articles/how-to-create-a-new-wallet-in-phantom-8071074929043). Enable Settings → Developer Settings → Testnet Mode → Solana Devnet using the [official testnet instructions](https://help.phantom.com/articles/5997313271699).

Keep the recovery phrase and private key outside chat, the repository, screenshots and server settings. Share only the public Solana address and the desired operator display name for reviewed provisioning. Use a browser with the extension installed; a separate embedded browser may not see that extension. The application checks the wallet's advertised Devnet/v0 features at runtime; installing a wallet is not acceptance evidence. No purchase or mainnet funding is required for this demo. Devnet tokens have no real value.

## Prerequisites — all must be satisfied

- [ ] Reviewed disposable environment and target database; no real investor data.
- [ ] Actual deployed web/API revision, liveness, database readiness and exact browser-origin/CORS configuration checked.
- [ ] Public operator address independently checked and provisioned through the [controlled runbook](../operations/operator-provisioning.md); no ad hoc role changes.
- [ ] Separate reviewed Devnet program deployment and its upgrade/issuer authorities established. The checked-in local program ID and local validator test are not a Devnet deployment.
- [ ] API configured with Devnet RPC and its verified genesis hash. A `ready` health response alone does not test RPC.
- [ ] Active instrument, Token-2022 mint and 35-token distribution (10/20/5), eligible synthetic investors and verified wallet mappings exist in both relevant chain/database projections. Current UI does not create these prerequisites.
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
