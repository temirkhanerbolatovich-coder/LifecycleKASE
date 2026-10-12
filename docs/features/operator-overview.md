# Complete operator overview

Authenticated administrators and auditors read `GET /api/v1/operator-overview`. Counts and settlement-asset totals cover the configured network in PostgreSQL; they do not derive from the twenty actions already loaded by the browser. All queries and the seven-row priority queue share a repeatable-read snapshot.

`from` and `to` accept strict ISO UTC timestamps; the upper bound is exclusive. The default execution-date window spans seven days before and seven days after the request. An explicit interval must be positive and at most 366 days. Open-action and unknown-operation counts cover the network independently of that financial window. Old unknown signatures remain visible in the priority ordering even when they are outside an action's latest twenty transaction previews.

Amounts are integer minor-unit strings grouped by asset, with its own decimals and code. Outstanding amounts include calculated, ready, processing and failed entitlements of nonterminal actions. Paid totals include only finalized settlements with matched reconciliation. Actions without entitlements are counted as uncalculated; their amounts remain unknown. This endpoint does not query live treasury balances or reserves: those fields remain null and the operator inspects funding in the action detail.

The browser validates count consistency, network, queue and asset facts before display and formats amounts with integer arithmetic. It retains the last successful response with an error/staleness notice when refresh fails. Public QA continues to use explicitly synthetic page-local data.

See [dated PostgreSQL and performance acceptance](../testing/operator-continuation-2026-10-12.md). The benchmark is a local database measurement, not public-network execution or a production capacity guarantee.

To reproduce the database acceptance, build the API and compile web tests, then run `npm run test:overview:database` with an explicit `OVERVIEW_TEST_DATABASE_URL` pointing to a disposable loopback PostgreSQL host and base database `postgres` or `lifecycle_kase`. The script does not read `.env`; it creates and drops only its generated acceptance database. Never point this test at retained infrastructure.
