# Disposable Render staging

Status: disposable demo staging updated and health-verified on 2026-10-02. Earlier operator login was owner-accepted; authenticated browser flows were not repeated after this deployment. The historical entries below remain as an evidence trail.

## Repository synchronization — 2026-10-02

GitHub `master` commit `6dd98fe170967e349bc675a651a476275c1829f8` passed both `repository-checks` and `program-checks` in [CI run 36966669189](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/36966669189). Render does not auto-deploy these Blueprint-managed services, so API and web were updated manually from that exact commit after CI succeeded.

API deployment `dep-davjk5lg1s2s73apa8u0` became Live in 1m08s. Its build log explicitly reported all fourteen migrations successfully applied, including `20261002170000_unique_active_instrument_deployment`, and then mapped the Investor and Instrument routes. Web deployment `dep-davjl4id0e5s7388mi9g` became Live in 1m40s; its install reported zero vulnerabilities and its Next.js production build completed successfully.

Post-deploy public checks returned HTTP 200 with the expected JSON for web liveness, API liveness and PostgreSQL readiness. `/dashboard` returned HTTP 200. Unauthenticated `GET /api/v1/instruments` returned HTTP 401 `SESSION_REQUIRED`, proving the new protected route is present without bypassing authentication. These checks prove deployed revision, process/database reachability and route protection; they do not prove Solana RPC configuration, a live wallet-signed `MINT_SETUP`, snapshot finalization, data durability or production readiness. A later documentation-only commit is not a different deployed application revision.

The `lifecyclekase-staging` Blueprint in the separate `LifecycleKASE` Hobby workspace deployed commit `626cc326800e0c84eff1796088a735cdee6e14e3` from `master`. Its initial sync created the free `lifecyclekase-staging-db`, `lifecyclekase-api`, and `lifecyclekase-web` resources without changing the separate VKO workspace.

The last deployment whose revision was explicitly verified ran commit `635312c0334d33dad59e16e1518a284309d05977`. Both services were manually deployed from the existing master branch on 2026-09-30: web deployment `dep-daul7ql9fdbs739dc910` succeeded in 1m10s, and API deployment `dep-daul838u01pc7385pv6g` succeeded in 1m15s. The API includes the exact dashboard CORS origin, bounded single-instance auth/mutation limits and one trusted Render proxy hop while keeping operator authentication disabled. No pending migrations were reported in the API deployment log.

The Devnet snapshot wallet UI was subsequently published in commit `dba8da2` on 2026-09-30. Local validation passed 85 tests, type/schema/docs checks, the production web build, and production HTTP smoke checks. The post-push public dashboard and API readiness requests each exceeded a 30-second timeout. This neither establishes the deployed revision nor diagnoses an outage; Render deployment status and new-version health still need verification. Authentication was not enabled, and no real wallet/Devnet acceptance was performed.

Follow-up verification resolved the deployment uncertainty: Render still showed the older `1984dc8` revision until the two manual deployments above. Afterwards, both API health routes and web liveness returned HTTP 200 with the expected live/ready JSON. Dashboard returned HTTP 200 and visibly included the new snapshot-registration overview, API/PostgreSQL ready, and Solana Devnet not checked. The challenge route returned HTTP 503 AUTH_NOT_CONFIGURED with the exact allowed dashboard origin. This verifies the deployed UI/API version and disabled-auth boundary, not an authenticated snapshot transaction. The operator does not yet have a wallet; use the [Devnet acceptance checklist](../testing/devnet-snapshot-acceptance.md) before provisioning or enabling login. Documentation-only commits after this verified revision are not evidence of a newer deployed revision.

- Dashboard: <https://lifecyclekase-web.onrender.com/dashboard>
- Web liveness: <https://lifecyclekase-web.onrender.com/health/live>
- API liveness: <https://lifecyclekase-api.onrender.com/api/v1/health/live>
- API readiness: <https://lifecyclekase-api.onrender.com/api/v1/health/ready>
- [Blueprint sync](https://dashboard.render.com/blueprint/exs-datqao8u01pc73a5afl0/sync/exe-datqaogu01pc73a5ag0g)

At verification, both services were Live. The three health requests returned HTTP 200 with `live`/`ready` JSON; `/dashboard` returned HTTP 200 and visibly showed web available, API/PostgreSQL ready, Solana Devnet unconnected, and the Wallet Standard login surface. A challenge request from the exact dashboard origin returned the expected HTTP 503 `AUTH_NOT_CONFIGURED` response together with `Access-Control-Allow-Origin: https://lifecyclekase-web.onrender.com` and credentials support. This verifies service wiring and the disabled-authentication boundary, not an authenticated operator session or the corporate-action MVP.

The root [`render.yaml`](../../render.yaml) defines two free Node web services and one free PostgreSQL 17 database in Frankfurt. It is for the **disposable demo environment only**. It does not deploy the Solana program, create tokens, enable operator authentication or execute payments.

## First operator provisioning — 2026-09-30

After explicit approval of the administrator-role grant, the existing controlled CLI was appended once to the API build command. Deployment `dep-daulg50u01pc7386nhi0` at source revision `8f34218` succeeded in 1m22s. Its build log reported `created: true` with the reviewed public wallet, ADMINISTRATOR role and SOLANA_DEVNET network. The CLI returns after its serializable user/wallet/audit transaction commits; no independent database read or real-wallet login was performed. Operator identifiers are intentionally not published in this repository.

The original build command was restored and verified by reading the saved setting; the bootstrap command is not in the Blueprint or API start command. Restoration triggered deployment `dep-daulhn0jo6nc73dlm0og`, which succeeded in 1m20s at source revision `8f34218`. Public API readiness returned HTTP 200 with `ready`; challenge returned the expected HTTP 503 AUTH_NOT_CONFIGURED. Authentication remains disabled; enabling it and proving wallet possession are separate reviewed steps. See the [Free-environment provisioning procedure](../operations/operator-provisioning.md).

## Operator login activation — 2026-10-01

After explicit approval, only the API `AUTH_ENABLED` setting was changed to `true`; the reviewed domain, exact allowed web origin and secure-cookie setting were retained. Both services deployed source revision `fd6cb8155da4d30bf2802b5b83e53796da4188c3`: API `dep-daulq9c1nsns73eq10fg` was Live in 1m09s; web `dep-daulqhou01pc7387r3b0` was Live in 1m12s. The normal API build command remained in place and reported no pending migrations.

The browser now uses fixed same-origin operator rewrites, preserving HttpOnly/Secure/SameSite=Strict cookies without weakening their policy. See [ADR-012](../decisions/ADR-012-same-origin-operator-api.md). Local validation passed 87 tests, schema/type/docs checks, a production web build and a synthetic production proxy smoke test. The synthetic fixture proves transport, not possession of the real operator wallet.

Live requests through the **web origin** verified: registered-wallet challenge HTTP 201 with the expected domain/origin; unregistered wallet HTTP 403 `UNAUTHORIZED_WALLET`; untrusted origin HTTP 403 `ORIGIN_NOT_ALLOWED`; session and snapshot prepare without a cookie HTTP 401 `SESSION_REQUIRED`. Challenge/session responses carried `Cache-Control: no-store`. API readiness returned HTTP 200, and the dashboard rendered API/PostgreSQL ready and the Phantom login button. Challenge nonces/messages and operator identifiers were not published.

Real-wallet signature verification, session persistence after refresh, logout and authenticated Devnet snapshot acceptance remain pending. The user must sign the login message in their own wallet; no transaction, payment or seed phrase is required for login.

The Blueprint intentionally still defaults to `AUTH_ENABLED=false` for new disposable environments. The current enabled state is a reviewed live-service override: a future Blueprint sync can restore `false`. Re-check the setting after any sync; do not assume source defaults describe the live service. `NEXT_PUBLIC_API_URL` is a legacy public setting, unused by the operator browser flow; `API_SERVER_URL` is the fixed server-side upstream and requires a web rebuild when changed.

## Before creating the Blueprint

1. Review the current [Render free-plan limits](https://render.com/docs/free) and workspace billing settings. Free PostgreSQL expires after 30 days, has no backups, and must contain no real investor or financial data.
2. Commit and push the reviewed application and Blueprint changes to the intended repository branch. The current local working tree alone cannot be deployed from GitHub.
3. In your own Render account, create a Blueprint from that branch and review the three proposed resources before approving creation. Do not attach an existing production database to this Blueprint.

As observed on 2026-09-29, the original Render workspace already has a Free PostgreSQL database for the separate VKO project. Render permits only one Free PostgreSQL database per workspace. The deployment therefore uses a separate Hobby workspace. Do not delete, repurpose, or upgrade the VKO database as part of this deployment.

The API build command installs dependencies, generates Prisma Client, builds the API and then runs `prisma migrate deploy`. Free web services have no pre-deploy command; this explicit build step is only acceptable for a disposable demo. Never put migrations in the start command. If a migration fails, stop and diagnose it rather than retrying against valuable data.

The database `ipAllowList: []` blocks external connections. The API gets its connection string from Render's database reference, not from a committed secret. The web service gets the API's public HTTPS URL from a service reference. Free Render web services cannot receive private network traffic from another free web service, so the web server calls the API through its public URL.

## Verify after deployment

- API `GET /api/v1/health/live` responds with `{ "status": "live" }`.
- API `GET /api/v1/health/ready` responds with `{ "status": "ready" }`; after a database failure it responds with HTTP 503 and `DATABASE_UNAVAILABLE`.
- Web `GET /health/live` responds with `{ "status": "live" }`.
- Web `/dashboard` renders and displays the API/PostgreSQL status, while Solana remains explicitly unconnected.
- Protected domain routes, such as `/api/v1/investors` and `/api/v1/instruments`, return 401 without an active operator session. A 404 is expected only for routes the current application does not implement.
- Record the actual public URLs and deployed Git commit only after these checks pass. A local build is not deployment evidence.

The free API may sleep after inactivity. During wake-up, the dashboard may temporarily show `Недоступно`; refresh after the API has warmed. The dashboard validates the JSON status and will not treat a Render loading page as readiness.

The Blueprint preconfigures the exact dashboard origin, secure-cookie setting and single-instance authentication rate limits for the wallet-login flow, but keeps `AUTH_ENABLED=false`. Do not enable authentication until an operator user and active verified wallet have been provisioned through the [controlled runbook](../operations/operator-provisioning.md). The browser-facing `NEXT_PUBLIC_API_URL` contains only the public API origin; it is not a secret.

For a persistent pilot, replace this temporary setup with paid/managed resources, backups, a dedicated migration gate, and a security review. See [ADR-007](../decisions/ADR-007-disposable-render-staging.md).
