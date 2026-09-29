# ADR-009: On-chain balance reconciliation for instrument activation

Status: Accepted for local MVP
Date: 2026-09-29

## Context

Instrument initialization verifies mint configuration and total supply, but it does not prove that issued bonds reached holder token accounts. The program needs a meaningful `Deploying` to `Active` transition before snapshot registration. Investor identity and KYC live in PostgreSQL, not in Token-2022 accounts.

## Options considered

1. Let the issuer flip the status without checking balances.
2. Hardcode the three demo recipients and their 10/20/5 balances.
3. Check a bounded list of unique, positive-balance Token-2022 accounts against the mint supply, with the issuer attesting the off-chain identity mapping.
4. Put the full Investor Registry and KYC state on-chain.

## Decision

`activate_instrument` requires the instrument issuer signature, an unchanged fixed-supply bond mint and its permanent delegate, and 1–64 distinct Token-2022 holder accounts for that mint. Every supplied account must have a positive clear balance, and their checked sum must equal the mint supply. Only `Deploying` may transition to `Active`.

The issuer must first reconcile those token account addresses to verified investor wallets in the application. The program proves balance coverage, not investor identity, eligibility, or finalized transaction status. The application must confirm the activation transaction at `finalized` and reconcile the resulting PDA before presenting it as complete.

## Reasoning

If distinct positive-balance accounts sum to the mint supply at activation, no positive bond balance can be omitted from that moment's on-chain allocation. Issuance is capped because mint authority is revoked; later redemption can still reduce supply by burning bonds. This is a compact on-chain gate that works for the demo without hardcoding investor addresses or exposing private identity data.

## Consequences

- The activation transaction must include every positive-balance bond token account; a larger registry needs batching or a different proof design.
- The bounded O(n²) duplicate check is acceptable for at most 64 accounts and avoids a new dependency.
- The issuer remains responsible for verified wallet mapping; an invalid mapping can still lead to an `Active` instrument and must be caught by the application and later snapshot gate.
- Activation does not distribute tokens, create investor records, or verify a finalized RPC response inside the program.

## Risks

- Direct on-chain callers can bypass application-side identity checks if they control the issuer key.
- Token-account ownership or balances may change after activation; snapshots must independently reconcile at record date.
- Extension types that hide balances are not supported by this clear-balance model and require a separate design before use.

## Future work

Enforce investor-wallet eligibility in the authenticated API flow, verify finalized activation evidence, and design a scalable holder proof before exceeding 64 token accounts.
