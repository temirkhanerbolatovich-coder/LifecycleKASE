# Domain contracts and test vectors

Status: Implemented foundation
Last updated: 2026-09-28

## Purpose

The domain package defines deterministic rules that must produce the same result in TypeScript, Rust, API responses, UI previews, and Anchor tests. It has no RPC, database, wallet, or system-clock dependency.

## Canonical financial vector

The demo bond uses:

| Field | Value |
|---|---:|
| Face value | `1_000_000_000` minor units = 1,000.00 KZT-Test |
| Coupon rate | `1000` bps annually |
| Payments per year | `2` |
| Investor balances | `10`, `20`, `5` |
| Coupon entitlements | `500_000_000`, `1_000_000_000`, `250_000_000` minor units |
| Total coupon | `1_750_000_000` minor units = 1,750.00 KZT-Test |

For early redemption of a 20-token balance at `2000` bps and a price of `1_000_000_000` minor units, the result is four redeemed tokens, `4_000_000_000` minor units paid, and 16 remaining tokens.

## Snapshot vectors

The snapshot fixture in `snapshot.test.ts` must serialize to SHA-256:

```text
6373c6313577781526756c0123d79b97508595367cd714ae8ebe9f3996cd3ad6
```

The fixed hash is a historical snapshot-v1 compatibility gate. New actions use snapshot-v2, which sorts investor IDs, wallets and token accounts and includes eligibility and wallet status. Changing either format requires a new schema version rather than silently updating its bytes.

The investor-level snapshot-v2 fixture in `snapshot-v2.test.ts` must hash to:

```text
397cc1e3aa8f500b68afdd4338628988bd5b8583ef96ac0ea5a341cd001222b8
```

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

The eligibility unit tests verify record-date exclusion, current compliance suspension, paused instruments, revoked wallets, and wallet ownership mismatch. This is a pure decision function; the future API must supply authenticated registry and on-chain instrument data and persist the decision in the audit trail.

The settlement-leg tests require a confirmed Cash Leg for coupon, mark coupon Asset Leg as not applicable, and require both confirmed legs with exact actual amounts for redemption. Chain observation and receipt verification are outside this pure function and must be performed by the future API.
