# Web boundary

The Next.js application contains a Russian status dashboard at `/dashboard`, operator wallet login, an administrator snapshot registration panel, and a liveness route at `/health/live`. The home route redirects to the dashboard. It uses the existing mark at `public/brand/lifecyclekase-mark.png`.

The dashboard fetches `GET /api/v1/health/ready` on the server through `API_INTERNAL_URL` (default `http://127.0.0.1:4000`). A failed or timed-out request is shown as unavailable; the page remains renderable. The readiness signal covers the API and PostgreSQL only, not Solana or a working financial flow. No private URL or database credential is sent to the browser.

The client-side login panel discovers compatible wallets through Wallet Standard. It requires `standard:connect` and `solana:signMessage`, requests the backend's one-time domain-bound challenge, verifies that the wallet signed the exact bytes, and exchanges the signature for an HttpOnly session cookie. The browser never receives a private key or seed phrase. The UI reports disabled authentication, an unauthorized operator wallet, origin mismatch, and an expired challenge without logging signature material. Configure `NEXT_PUBLIC_API_URL` with the public browser-reachable API origin; its default is `http://127.0.0.1:4000`.

For the disposable Render staging Blueprint, `API_SERVER_URL` overrides that local setting with the API's public HTTPS URL. Free Render web services cannot receive private-network traffic from each other. The dashboard requires the expected JSON response, not just HTTP 200, because a sleeping free API may initially return a platform loading page.

Run `npm run dev:web` at the repository root. For production-style local testing, run `npm run build --workspace @lifecycle-kase/web` and `npm run start:web`. A real login additionally requires `AUTH_ENABLED=true`, exact API CORS/origin configuration, and a pre-provisioned active operator wallet. Broader administrator/auditor workflows and any investor cabinet are pending. Do not treat the roadmap cards as live actions.

## Snapshot registration

After an ADMINISTRATOR login, enter the UUID of an existing SCHEDULED corporate action. The API must be configured for Devnet with its expected genesis hash, and the instrument, program, mint and investor wallet mappings must already exist. The UI does not create those records. The session wallet must also be the instrument's issuer authority.

1. Prepare or refresh an unsigned plan. The API captures/resumes the immutable snapshot, writes a new attempt, and returns its persisted cluster. The browser accepts only Devnet, the expected action and signer, and canonical unsigned v0 framing; it also checks the transaction's fee payer. It does not independently decode/attest every instruction or prove RPC correctness.
2. Review the genesis hash, signer, program, Action PDA, snapshot hash, planned date, actual finalized capture slot/time and block-height limit. Acknowledge the review, then explicitly sign/send through `solana:signAndSendTransaction`. The wallet and account must advertise Devnet and v0 support. Preflight is enabled; no private key is sent to the server.
3. Save the action UUID, attempt UUID and signature. Click the separate finalized check. Only an API FINALIZED response matching that attempt and signature is presented as success. The API verifies the exact prepared message, signer and resulting Action PDA. A wallet submission result alone is not confirmation.

There is no automatic resend or confirmation polling. After invoking the wallet, another send is disabled for this mounted panel even if the wallet rejects or its response is lost: the application cannot safely distinguish rejection from a successful send with a lost response. Check wallet history and use the confirmation/recovery inputs, including after a page reload. State is not stored in browser storage; retain the identifiers yourself. Refreshing the page does not prove that a previous send failed. Re-prepare only after establishing that no transaction was submitted, and within the record-date window. Expired blockhash or missed record-date windows must not be bypassed. Localnet remains available through API/tools, not this wallet UI.

DEMO_CAPTURE_SLOT refers to ownership at the effective capture slot, not historical ownership at the earlier planned record date. Registration spends test SOL, not a coupon/payment/burn. Public staging authentication remains disabled; no real operator-wallet or Devnet end-to-end acceptance has been performed.

Run `npm run test --workspace @lifecycle-kase/web` for boundary/encoding/finalization checks. `npm test` also checks compatibility with the actual backend transaction serializer. These tests do not replace wallet-extension and live Devnet acceptance.

Follow the [Devnet acceptance checklist](../../docs/testing/devnet-snapshot-acceptance.md) for user-controlled wallet setup, prerequisite gates and required evidence.
