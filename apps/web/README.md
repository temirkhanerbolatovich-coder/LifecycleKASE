# Web boundary

The Next.js application contains a Russian status dashboard at `/dashboard`, an operator wallet-login panel, and a liveness route at `/health/live`. The home route redirects to the dashboard. It uses the existing mark at `public/brand/lifecyclekase-mark.png`.

The dashboard fetches `GET /api/v1/health/ready` on the server through `API_INTERNAL_URL` (default `http://127.0.0.1:4000`). A failed or timed-out request is shown as unavailable; the page remains renderable. The readiness signal covers the API and PostgreSQL only, not Solana or a working financial flow. No private URL or database credential is sent to the browser.

The client-side login panel discovers compatible wallets through Wallet Standard. It requires `standard:connect` and `solana:signMessage`, requests the backend's one-time domain-bound challenge, verifies that the wallet signed the exact bytes, and exchanges the signature for an HttpOnly session cookie. The browser never receives a private key or seed phrase. The UI reports disabled authentication, an unauthorized operator wallet, origin mismatch, and an expired challenge without logging signature material. Configure `NEXT_PUBLIC_API_URL` with the public browser-reachable API origin; its default is `http://127.0.0.1:4000`.

For the disposable Render staging Blueprint, `API_SERVER_URL` overrides that local setting with the API's public HTTPS URL. Free Render web services cannot receive private-network traffic from each other. The dashboard requires the expected JSON response, not just HTTP 200, because a sleeping free API may initially return a platform loading page.

Run `npm run dev:web` at the repository root. For production-style local testing, run `npm run build --workspace @lifecycle-kase/web` and `npm run start:web`. A real login additionally requires `AUTH_ENABLED=true`, exact API CORS/origin configuration, and a pre-provisioned active operator wallet. Snapshot signing/submission, broader administrator/auditor workflows, and any investor cabinet are pending. Do not treat the roadmap cards as live actions.
