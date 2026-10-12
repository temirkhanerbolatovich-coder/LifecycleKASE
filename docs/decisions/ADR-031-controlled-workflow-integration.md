# ADR-031: Versioned controlled issuance and capture workflow

Status: Implemented and accepted on disposable Localnet through API/PostgreSQL and independent browser validators. Date: 2026-10-12.

## Context

[ADR-030](ADR-030-controlled-registry-and-unit-reservations.md) supplies enforceable token movement, raw capture and assigned-unit reservations for a new instrument v2. The existing application orchestrates legacy instruments with exact prepared wires, original signatures, atomic database projection/audit and independent browser review. Reordering old saved operations or selecting a contract from mutable environment configuration would corrupt recovery.

## Decision

Migration 22 adds immutable `Instrument.tokenPolicy`, defaulting existing instruments to `LEGACY_UNRESTRICTED_V1`. Explicit new drafts can select `CONTROLLED_FROZEN_V2` only with the default-off `CONTROLLED_REGISTRY_ENABLED` capability on the reviewed Localnet candidate. Token policy, rather than the unrelated optimistic database `version` or redemption action version, selects builders and validators.

Legacy issuance keeps `MINT_SETUP → DISTRIBUTION → INITIALIZE → ACTIVATE`. Controlled issuance uses the same persisted operation names with `MINT_SETUP → INITIALIZE → DISTRIBUTION → ACTIVATE`. Bootstrap creates an empty Frozen treasury, initialization atomically mints/refreezes/revokes, and distribution registers holdings and uses program-authorized transfers. Each confirmation checks exact finalized bytes plus instrument, mint, policy and holdings before changing projections.

Controlled capture adds saved `BEGIN`, `FINISH` and safe `ABORT` operations. Begin locks movement before scanning. Snapshot preparation verifies the finalized policy/capture, reads all raw Token-2022 positions at or after the lock's slot, and verifies the original lock again after scanning. Canonical snapshot-v2 keeps its existing format and records the actual lock slot/time. A separate immutable `Snapshot.captureEvidence` preserves raw bytes, extension flags, read slot, policy/capture addresses and the exact registry JSON/hash. Keeping the original serialized registry alongside JSONB avoids relying on JSONB object-key order.

`controlledCaptureLocked` and active BEGIN attempts keep off-chain registry edits blocked until finalized finish/abort, including recovery after the initial 300-second window. A missed-window check cannot discard an existing on-chain lock. Snapshot registration compares complete actual source ownership and balances to canonical investor sources.

Redemption calculation registers captured sources, finalizes the global allocation, reserves every entitlement through `RESERVE_UNITS`, then finishes capture. Zero assignments retain coverage markers. Full cash reserve/approval/payment requires finished capture and verified reservations. Finalization atomically writes the existing chain receipt and clears the active redemption gate. Controlled receipts use new schema versions; legacy canonical receipt bytes remain unchanged.

Submitted controlled attempts are confirmation-only. Unknown outcomes retain the original wire and signature. Neither flag changes nor off-chain review can discard assigned units. Browser review independently derives PDAs and expected instruction bytes from separately loaded instrument/action/entitlement facts before requesting a wallet signature.

## Consequences and limits

No owner mint migration or production flag enablement is needed. This is an application integration candidate for new instruments. Token enforcement depends on the previously accepted candidate program; this iteration does not alter its binary.

Pre-payment positive sources must remain correctly Frozen and cover assigned burns. Zero-assignment source bytes are irrelevant once their immutable commitment and zero counters are verified. After a finalized burn, an empty source may close before API confirmation; reconciliation uses the original transaction token history, receipt and consumed reservation/Holding counters rather than requiring the closed account to reappear.

The execution read model restores a signed pending payment from its exact saved wire and immutable row/source bindings, without claiming that original reviewed balances are current balances. Historical receipt supply is derived from that action's immutable captured supply minus its redeemed units, so later redemptions cannot invalidate an earlier document.

General secondary holder/operator transfers need a separate dual-signature application workflow; this stage uses the controlled path during issuance. Scheduled controlled cancellation and committed-capture reversal remain unsupported. A stalled capture must continue its saved phases. Transaction/account limits still bound atomic capture and finish; no 10,000-holder scalability claim is made.

## Validation

Focused workflow/security tests, **640 Node tests**, full workspace checks, production build and production proxy checks passed. A fresh disposable HTTP/PostgreSQL/validator scenario completed controlled issuance, coupon, percentage partial, exact partial and maturity at **2026-10-12 14:19:06 Asia/Qyzylorda**, supply `35 → 35 → 28 → 20 → 0`. The normal 64-tick validator used a genuinely later maturity date. The separate legacy zero/mixed coupon prelude was excluded from this application run and retains its earlier acceptance.

The run verified original-signature reconciliation after a finalized burn's source was closed, transactional projection/audit rollback, immutable raw capture evidence and historical redemption receipt downloads after supply reached zero. Four canonical receipts, runtime/log and source/artifact hashes are saved in the [integration evidence package](../testing/evidence/controlled-workflow-2026-10-12/README.md). All 29 executed source/helper fingerprints and the SBF/IDL matched disk when the recovered runtime was packaged; the previously accepted program/client sources also matched their protocol checkpoint. Subsequent browser receipt-verifier hardening and saved-receipt revalidation are separate from that financial runtime. The offline verifier checks saved consistency without querying RPC or authenticating provenance. Performed results and remaining manual/owner/hosted/Devnet boundaries belong in the [dated integration record](../testing/controlled-workflow-integration-2026-10-12.md).
