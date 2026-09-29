# Web boundary

The Next.js application currently contains a read-only Russian status dashboard at `/dashboard` and a liveness route at `/health/live`. The home route redirects to the dashboard. It uses the existing mark at `public/brand/lifecyclekase-mark.png`.

The dashboard fetches `GET /api/v1/health/ready` on the server through `API_INTERNAL_URL` (default `http://127.0.0.1:4000`). A failed or timed-out request is shown as unavailable; the page remains renderable. The readiness signal covers the API and PostgreSQL only, not Solana or a working financial flow. No private URL or database credential is sent to the browser.

For the disposable Render staging Blueprint, `API_SERVER_URL` overrides that local setting with the API's public HTTPS URL. Free Render web services cannot receive private-network traffic from each other. The dashboard requires the expected JSON response, not just HTTP 200, because a sleeping free API may initially return a platform loading page.

Run `npm run dev:web` at the repository root. For production-style local testing, run `npm run build --workspace @lifecycle-kase/web` and `npm run start:web`. Administrator and auditor workflows, authentication, wallet connection, and any investor cabinet are pending. Do not treat the roadmap cards as live actions.
