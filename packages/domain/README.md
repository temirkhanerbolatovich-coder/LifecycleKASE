# Domain package

`@lifecycle-kase/domain` contains deterministic business rules shared by the API, web application, test fixtures, and the future generated Solana client.

It currently provides:

- checked `bigint` coupon, principal, and early-redemption calculations;
- corporate-action state-transition validation;
- deterministic `snapshot-v1` canonical JSON and SHA-256 hashing;
- validation compatible with Solana `u64` storage and `u128` intermediate arithmetic.

The package has no database, RPC, wallet, or system-clock dependency. Callers must pass all timestamps and balances explicitly.

```powershell
npm run typecheck --workspace @lifecycle-kase/domain
npm test --workspace @lifecycle-kase/domain
```

Amounts are always base-unit `bigint` values. Basis points and payment frequency are validated integer numbers. JSON-facing callers must serialize amounts as decimal strings rather than JavaScript numbers.
