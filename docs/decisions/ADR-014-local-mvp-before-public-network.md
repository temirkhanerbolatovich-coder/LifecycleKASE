# ADR-014: Local MVP acceptance before public-network deployment

Status: Accepted
Date: 2026-10-01

## Context

The owner approved local development and acceptance first, deferring public-network work until MVP approval. Faucet authentication and funding restrictions are not reasons to purchase mainnet SOL or weaken security. Existing requirements describe Devnet acceptance; that remains a later gate, not evidence already obtained.

## Options considered

1. Stop implementation until faucet access: unnecessary for registry, calculations and local-validator workflows.
2. Buy mainnet SOL to satisfy a faucet: outside the disposable test scope.
3. Complete a local MVP with PostgreSQL and a real local Solana validator, then separately approve public Devnet: chosen.

## Decision

The active MVP delivery gate is localhost web/API, local PostgreSQL and a disposable Solana validator with synthetic investors and KZT-Test. Use actual local transactions and finalized checks for chain-dependent acceptance, not fixture-only UI status. Public Devnet funding/deployment is deferred until owner approval and renewed preflight/transaction authorization. Mainnet, legal issuance, real funds and production custody remain excluded and require independent post-MVP gates.

## Reasoning

Local networks remove faucet dependency without changing contract authorization, eligibility, snapshot integrity or atomic payment/burn requirements. Local success must never be labelled public Devnet or production success.

## Consequences

The public staging site remains a separately deployed prior revision. Local changes need not be pushed into an auto-deploy pipeline while this gate is active. The reviewed snapshot adapter accepts only Localnet or Devnet, requires the database wallet-network label to match the configured cluster, and derives the Wallet Standard chain from the validated server plan. This enables the browser boundary but does not itself prove a live local snapshot transaction. The existing local validator harness already tests contract instructions.

## Risks

Local validators do not reproduce all public-network congestion, RPC failure, wallet/provider or governance conditions. Wallet Standard defines `solana:localnet`, but an installed wallet must advertise and actually support it; the UI fails closed otherwise. The local single-workspace registry now uses a deliberately broad capture-window lock for eligibility, wallet attachment, activation and revocation. Multi-issuer scale still requires issuer-scoped locking or append-only effective-time history before these become public operations.

## Future work

Finish Investor Registry, local network configuration/signing, instrument setup, actions, calculations/approval, coupon/redemption and reconciliation acceptance. After owner approval, restore the separate public Devnet deployment checklist; do not treat approval as authority for mainnet or real assets.
