# Domain contracts and test vectors

Status: Implemented foundation
Last updated: 2026-09-28

## Purpose

The domain package defines deterministic rules that must produce the same result in TypeScript, Rust, API responses, UI previews, and Anchor tests. It has no RPC, database, wallet, or system-clock dependency.

## Canonical financial vector

The demo bond uses:

| Field | Value |
|---|---:|
| Face value | `1000` minor units |
| Coupon rate | `500` bps |
| Payments per year | `1` |
| Holder balances | `10`, `20`, `5` |
| Coupon entitlements | `500`, `1000`, `250` |
| Total coupon | `1750` minor units |

For early redemption of a 20-token balance at `2000` bps and a price of `1000` minor units, the result is four redeemed tokens, `4000` minor units paid, and 16 remaining tokens.

## Snapshot-v1 vector

The snapshot fixture in `snapshot.test.ts` must serialize to SHA-256:

```text
6373c6313577781526756c0123d79b97508595367cd714ae8ebe9f3996cd3ad6
```

The fixed hash is a compatibility gate. Changing key order, timestamp normalization, holder ordering, token-account ordering, or decimal-string encoding requires an explicit snapshot schema version change rather than silently updating the expected hash.

## Numeric compatibility

- Inputs representing on-chain amounts must fit unsigned 64-bit storage.
- Multiplication must fit an unsigned 128-bit intermediate value.
- Final stored amounts must fit unsigned 64-bit storage.
- Division uses floor semantics.
- A zero early-redemption result is valid calculation output and is mapped by orchestration to `NOT_ELIGIBLE_ZERO_ROUNDING`.

## Commands

```powershell
npm run typecheck --workspace @lifecycle-kase/domain
npm test --workspace @lifecycle-kase/domain
```

The future Rust implementation must reproduce these vectors before its instructions are connected to the API.
