# ADR-015: Phased wallet-signed instrument deployment

Status: Accepted for local MVP
Date: 2026-10-02

## Context

Instrument deployment includes irreversible mint-authority revocation, holder distribution, Instrument PDA initialization and activation. A browser wallet must review and sign these operations, while the API must not hold issuer keys or mark database state complete from a wallet submission response alone.

## Options considered

1. Let the API sign with the issuer private key: rejected because it breaks operator custody.
2. Return one large transaction for every deployment operation: rejected because it couples irreversible setup and holder allocation, weakens recovery and can exceed transaction limits.
3. Use explicit phases with a separate prepared attempt, wallet signature and finalized reconciliation for each phase.

## Decision

Deployment is phased. `MINT_SETUP` deterministically derives per-instrument bond and KZT-Test mint addresses from the issuer public key plus bounded seeds. It creates both Token-2022 mints, sets the Instrument Authority PDA as bond permanent delegate, creates the issuer treasury account, mints exactly 35 indivisible bonds and revokes bond mint authority. Freeze authority is never assigned.

The API persists the exact unsigned v0 transaction, required signer, genesis hash and blockhash expiry. Phantom is the only signer. `deploy/confirm` accepts a signature only after the RPC returns the exact prepared message at `finalized` and account reconciliation proves both mint configurations and treasury balance. Only then are mint projections saved. The instrument remains `DRAFT`; distribution, initialization and activation are later phases.

## Consequences

- Lost wallet responses can be recovered with the operation UUID and signature without blind resubmission.
- Deterministic addresses make preparation repeatable without generating or storing a mint private key.
- Revocation is intentionally irreversible. The UI requires a separate review checkbox.
- The shared KZT-Test asset means the current single-workspace demo supports one canonical mint setup; multi-issuer settlement-token reuse needs a later design.
- Successful `MINT_SETUP` is not issuance completion and must never display `ACTIVE`.

## Risks and future work

The 10/20/5 distribution now has a separate prepared transaction, immutable investor/wallet allocation and finalized treasury/holder reconciliation. Instrument PDA initialization and holder-backed activation remain to be implemented as later phases. Add real Phantom/validator acceptance including lost-response recovery. Before public Devnet use, re-check program deployment/upgrade authority, fees, wallet chain support and custody under ADR-013/014.
