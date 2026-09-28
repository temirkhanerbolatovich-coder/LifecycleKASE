# Domain package

`@lifecycle-kase/domain` contains deterministic business rules shared by the API, web application, test fixtures, and the future generated Solana client.

It currently provides:

- checked `bigint` coupon, principal, and early-redemption calculations;
- deterministic investor payout eligibility with explicit rejection reasons;
- Cash/Asset Leg reconciliation for coupon and redemption;
- corporate-action state-transition validation;
- deterministic `snapshot-v2` investor-level canonical JSON and SHA-256 hashing, with `snapshot-v1` retained as a historical vector;
- validation compatible with Solana `u64` storage and `u128` intermediate arithmetic.

The package has no database, RPC, wallet, or system-clock dependency. Callers must pass all timestamps and balances explicitly.

```powershell
npm run typecheck --workspace @lifecycle-kase/domain
npm test --workspace @lifecycle-kase/domain
```

Amounts are always base-unit `bigint` values. Basis points and payment frequency are validated integer numbers. JSON-facing callers must serialize amounts as decimal strings rather than JavaScript numbers.
