# ADR-025: Atomic redemption with immutable source accounts

Status: Accepted for the isolated Localnet candidate
Date: 2026-10-10

## Context

Redemption needs payment and retirement of corresponding bonds. Existing entitlements bind aggregate balances and receivers but not snapshot burn accounts. Holders can transfer after cutoff; retained account layouts must remain compatible.

## Options considered

Separate payment and burn risks payment without retirement. Burning arbitrary current accounts loses investor provenance. Replacing persisted layouts unnecessarily risks retained state. New sources/progress PDAs and atomic execution preserve both boundaries.

## Decision and reasoning

Append source registration to the same REGISTER transaction. Validate complete unique sources during calculation finalization. Execute approved payment and PermanentDelegate burns atomically. Track baseline supply/cumulative burns and create a separate receipt containing source hash, redeemed amount and pre/post supply. Reuse exact-wire recovery and serializable database projection. Existing layouts and coupon ABI remain unchanged.

## Consequences

Maximum eight positive sources per investor, further bounded by transaction size. Apply investor rounding first, then greedy ascending-base58 source allocation. Overlapping/stale supply actions fail closed. Maturity requires zero supply; full early redemption also retires the instrument.

The program trusts authority-registered snapshot/calculation. Source commitment does not independently prove historical ownership. Transferred-away or stale-supply cases need explicit resolution; holdings and signatures are never silently replaced.

## Risks and future work

External program review, public-network acceptance, Transfer Hook restrictions/escrow, larger-holder batching, rent cleanup and background reconciliation remain separate. Candidate default-off; isolated acceptance never authorizes owner upgrade/reset.
