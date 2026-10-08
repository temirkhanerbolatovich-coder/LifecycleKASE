# Instrument database drafts

Status: database drafts plus wallet-signed `MINT_SETUP`, `DISTRIBUTION`, `INITIALIZE` and `ACTIVATE` prepare/confirm boundaries implemented; the complete live Phantom/Localnet happy-path issuance passed for LKA26R1 on 2026-10-02. Remaining manual negative cases and corporate-action acceptance are separate gates.

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

`POST /api/v1/instruments/:id/deploy/prepare` now prepares an exact unsigned `MINT_SETUP` transaction after validating network genesis, signer, draft state, rent and unoccupied deterministic addresses. It creates bond and KZT-Test Token-2022 mints, sets the Instrument Authority PDA as permanent delegate, creates the issuer treasury, mints 35 bonds and revokes bond mint authority. Phantom remains the only signer.

For Localnet, `POST /api/v1/instruments/:id/deploy/submit` accepts the wallet-signed wire bytes, requires the exact prepared message and signer, verifies the Ed25519 signature, checks the configured genesis hash, and only then broadcasts through the trusted loopback RPC. It is disabled for Devnet. A transport error is stored as `UNKNOWN_CONFIRMATION`; it is not treated as failure or finalization. Devnet continues to use wallet submission.

`deploy/confirm` verifies the exact prepared message at `finalized`, then independently reconciles Token-2022 ownership, decimals, supply, revoked authorities, permanent delegate and treasury balance before atomically saving mint projections and audit evidence. The instrument intentionally stays `DRAFT` with `circulatingSupply = 0`.

The separate `DISTRIBUTION` request requires an explicit mapping of the fixed amounts 10, 20 and 5 to three different Investor Registry records. Every selected wallet must be active, signature-verified, not revoked, on the configured network, and owned by an active `ELIGIBLE` investor. The API stores that immutable allocation beside the exact unsigned transaction. Confirmation verifies the exact finalized message, an empty issuer treasury and the three expected Token-2022 account owners/mints/balances before changing `circulatingSupply` from 0 to 35. The instrument still remains `DRAFT`.

`INITIALIZE` is available only after finalized distribution. It encodes the database terms into the existing Anchor `initialize_instrument` instruction, stores the exact transaction, and on confirmation requires the finalized message plus a program-owned Instrument PDA whose IDs, authorities, mints, dates, coupon terms, supply and `Deploying` status exactly match the database. Only then does the database status change to `DEPLOYING`.

`ACTIVATE` reloads the finalized distribution mapping and requires every wallet/investor to remain active, verified, non-revoked, eligible and on the configured network. It independently checks the three holder accounts and exact 10/20/5 balances before preparation. Confirmation repeats the eligibility check, verifies the exact finalized message, rechecks holder balances at or after the transaction slot, and requires the Instrument PDA to be `Active` before atomically changing the database status to `ACTIVE`.

All four boundaries and the exact Localnet signed-transaction submission boundary are fixture-tested and passed live for LKA26R1: matching finalized messages, ACTIVE Instrument PDA/database, 35/35 supply, treasury 0 and holder balances 10/20/5. Same-wallet session recovery retained the original signed distribution; see [evidence and remaining gates](../testing/localnet-instrument-acceptance.md). Synthetic local-demo eligibility is not real KYC. A registry change after preparation does not alter the already prepared transaction and blocks activation confirmation when eligibility has changed. The shared KZT-Test record currently permits only one canonical mint setup. Initialization also inherits [ADR-008](../decisions/ADR-008-program-administrator.md): the Phantom issuer must be the deployed program's upgrade authority under the current MVP program design.
