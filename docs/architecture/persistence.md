# Persistence architecture

Status: schema foundation with guarded snapshot and instrument deployment attempts
Last updated: 2026-10-02

## Responsibility

PostgreSQL stores application identity, authentication hashes, issuer and investor metadata, workflow projections, canonical snapshot payloads, entitlement calculations, transaction attempts, jobs, idempotency responses, and audit events.

It does not override Solana ownership, mint supply, program state, snapshot commitments, or execution receipts. Finalized chain data wins during reconciliation as defined by ADR-004.

## Consistency boundaries

- `CorporateAction`, `Entitlement`, and `Instrument` have integer versions for compare-and-set updates.
- Snapshot ownership is one-to-one with a corporate action.
- Snapshot investors are unique per snapshot and Investor ID; wallet rows retain provenance below each investor.
- Entitlements are unique per corporate action and Investor ID.
- Cash and Asset Legs are unique per settlement and leg type.
- Execution jobs are unique per action, entitlement, and job type; transaction attempts remain separate rows.
- Blockchain signatures are unique when present.
- Instrument deployment attempts retain the exact prepared transaction, required signer and network genesis hash.
- Idempotency keys are unique inside an operation scope.
- Authentication challenges and sessions store hashes, not raw nonces or bearer tokens.

## Immutability

The `MINT_SETUP` attempt is attached directly to an instrument. A database check requires its prepared wire transaction, signer and genesis hash. Finalized confirmation updates the attempt, bond/settlement mint projections and audit atomically; holder distribution and instrument status are deliberately unchanged.

A snapshot and all investor/wallet/token-account rows are first written atomically in `PENDING_REGISTRATION`. After finalized on-chain commitment verification, the snapshot moves to `FINALIZED`. PostgreSQL triggers then reject mutation or deletion of the snapshot and its child rows, and reject new child rows.

The capture write uses a serializable Prisma transaction. It rechecks the action and instrument versions, wallet ownership and status, and the record-date window, then increments the action version with compare-and-set and creates all snapshot rows. Each prepared wire transaction gets a separate `BlockchainTransaction` row with its blockhash expiry. The action remains `SCHEDULED` until confirmation verifies the exact finalized message and Action PDA; finalization then compare-and-sets the attempt, snapshot, and action plus its audit event in one transaction. A failed or unknown chain result never marks the snapshot finalized.

`canonical_json` is PostgreSQL `jsonb`: it preserves values, not original UTF-8 byte ordering. The SHA-256 is computed before storage from the domain's deterministic `snapshot-v2` serialization. A future canonical download/verification route must rebuild those bytes with the same versioned serializer and compare the stored hash; it must not hash an arbitrary `JSON.stringify` of the `jsonb` read result.

The migration also adds PostgreSQL check constraints for nonnegative amounts, valid date ranges, fixed demo constants, action-specific parameters, hash lengths, and counter ranges.

Audit events are append-only at the database boundary. A finalized Action Receipt cannot be updated or deleted. Approval actor/timestamp must be paired, approved execution states require both, and a confirmed settlement leg requires an actual amount and confirmation timestamp.

## Validation

```powershell
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
```

`npm run test:database` runs transactional PostgreSQL checks, including snapshot-v2 child-row immutability. The third migration replaces a pre-MVP schema and aborts when domain records exist. Existing live records require an explicit conversion migration; no data is silently discarded.

`npm run test:api:database` exercises the actual Prisma pending-snapshot write, nested rows, action version increment and duplicate rejection against local PostgreSQL, then removes only the records it created.
