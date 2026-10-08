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

The API persists the exact unsigned v0 transaction, required signer, genesis hash and blockhash expiry. Phantom is the only signer. On Devnet the wallet may use `solana:signAndSendTransaction`. For Localnet, where Phantom does not expose an arbitrary local RPC transport, it uses `solana:signTransaction`; `deploy/submit` then cryptographically verifies the Ed25519 signature, exact stored message and sole required signer before broadcasting those same bytes through the configured loopback RPC. The API never receives a private key and rejects this trusted-broadcast route outside Localnet.

All prepared v0 messages now explicitly include compute limit and unit price before persistence (400,000 CU and zero priority price by default for the demo). Otherwise Phantom can insert priority instructions during signing and invalidate the exact-message contract. The server never approves a modified message after signing. Limits/prices are validated serializer options; public-network inclusion/fee estimation needs its own later policy. KZT-Test keeps the exact issuer mint authority for future synthetic funding; only bond mint authority is revoked, and both freeze authorities remain absent.

`deploy/confirm` accepts a signature only after the RPC returns the exact prepared message at `finalized` and phase-specific account reconciliation succeeds. `DISTRIBUTION` proves treasury/holder balances, `INITIALIZE` proves every immutable Instrument PDA field and `Deploying` status, and `ACTIVATE` repeats current registry eligibility and holder-balance coverage before proving the PDA is `Active`. Database status changes only after the corresponding finalized read-back.

## Consequences

- Lost wallet responses can be recovered with the operation UUID and signature without blind resubmission.
- Localnet browser signing no longer depends on Phantom routing the transaction to the local validator. The server can submit only an exact, valid wallet-signed prepared transaction.
- Deterministic addresses make preparation repeatable without generating or storing a mint private key.
- Revocation is intentionally irreversible. The UI requires a separate review checkbox.
- The shared KZT-Test asset means the current single-workspace demo supports one canonical mint setup; multi-issuer settlement-token reuse needs a later design.
- Successful `MINT_SETUP` or `DISTRIBUTION` is not issuance completion and must never display `ACTIVE`; `INITIALIZE` maps only to `DEPLOYING`.

## Risks and future work

All four phases now have separate prepared transactions, Localnet trusted broadcast and finalized reconciliation. The four-phase live Phantom/Localnet happy path and signed DISTRIBUTION session recovery passed for LKA26R1. Complete additional manual cancellation, wrong signer/network and lost-response/reload scenarios beyond that observed recovery. Before public Devnet use, re-check program deployment/upgrade authority, fees, wallet chain support and custody under ADR-013/014. The current upgrade-authority-as-administrator design remains an MVP constraint under ADR-008.
