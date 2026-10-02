# Instrument database drafts

Status: implemented and locally HTTP/PostgreSQL-tested on 2026-10-02.

## Purpose

`GET /api/v1/instruments` and `POST /api/v1/instruments` provide the first application-side instrument setup slice. An Administrator creates a database `DRAFT`; an Administrator or Auditor can list drafts. This is orchestration metadata only and must not be presented as a Solana issuance.

## Creation flow

The request supplies the demo issuer name, instrument name/ticker, whole KZT-Test face value, coupon bps, payment frequency, issue date and maturity date. The authenticated operator wallet is used server-side for issuer, compliance and corporate-action authority; authority fields cannot be injected by the client.

The API fixes the MVP invariants:

- bond asset type, `KZT_TEST`, six settlement decimals;
- configured `SOLANA_LOCALNET` or `SOLANA_DEVNET`, with cluster/network agreement;
- 35 total indivisible bond tokens and zero circulating tokens while the record is `DRAFT`;
- simulated KZT-Test disclaimer and matching network;
- no program ID or bond mint address before deployment;
- atomic `INSTRUMENT_DRAFT_CREATED` actor/correlation audit.

Issuer legal names are unique in the current single demo workspace so retries cannot create parallel issuer identities with the same name. Ticker remains unique per issuer. Duplicate or incompatible KZT-Test configuration fails with a conflict instead of silently changing existing records.

## Security and roles

Reads require Administrator or Auditor. Creation requires Administrator, the exact allowed browser Origin, a valid session and the shared mutation rate limit. The backend never accepts or stores a private key. Mainnet and arbitrary networks remain rejected by PostgreSQL and application configuration.

## Testing

`npm test --workspace @lifecycle-kase/api` checks validation, fixed terms, authority binding, bigint serialization, network configuration and role boundaries. `npm run test:registry:database` uses a generated isolated local database and real HTTP sessions to verify creation, duplicate rejection, list visibility and immutable audit. `npm run test:database` checks Localnet/Devnet database guards and rejects mainnet.

## Known limitations

This slice does not create Token-2022 mints, distribute 10/20/5 balances, revoke mint authority, prepare wallet transactions, initialize/activate the Instrument PDA or reconcile chain state. Those operations belong to `deploy/prepare`, wallet signing and `deploy/confirm`. Until finalized reconciliation succeeds, the instrument remains `DRAFT` with `circulatingSupply = 0`.
