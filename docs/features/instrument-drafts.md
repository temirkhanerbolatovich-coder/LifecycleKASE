# Instrument database drafts

Status: database drafts plus wallet-signed `MINT_SETUP` and `DISTRIBUTION` prepare/confirm boundaries implemented on 2026-10-02; live wallet/validator acceptance pending.

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

`deploy/confirm` verifies the exact prepared message at `finalized`, then independently reconciles Token-2022 ownership, decimals, supply, revoked authorities, permanent delegate and treasury balance before atomically saving mint projections and audit evidence. The instrument intentionally stays `DRAFT` with `circulatingSupply = 0`.

The separate `DISTRIBUTION` request requires an explicit mapping of the fixed amounts 10, 20 and 5 to three different Investor Registry records. Every selected wallet must be active, signature-verified, not revoked, on the configured network, and owned by an active `ELIGIBLE` investor. The API stores that immutable allocation beside the exact unsigned transaction. Confirmation verifies the exact finalized message, an empty issuer treasury and the three expected Token-2022 account owners/mints/balances before changing `circulatingSupply` from 0 to 35. The instrument still remains `DRAFT`.

Both boundaries are fixture-tested, but no live Phantom/validator deployment transaction has been accepted yet. Instrument PDA initialization and holder-backed activation remain separate, unimplemented application phases. The registry currently needs three suitable investor wallets before distribution can be prepared; synthetic local-demo eligibility is not real KYC. A registry change after preparation does not alter the already prepared transaction; the later activation phase must re-check that every distributed holder mapping remains eligible before it can present the instrument as active. The shared KZT-Test record currently permits only one canonical mint setup.
