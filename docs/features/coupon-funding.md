# Localnet coupon treasury funding

Implemented locally on 2026-10-03. This step checks the complete stored coupon obligation and funds the issuer treasury with simulated KZT-Test. It does not approve an action, register on-chain entitlements, pay investors, burn bonds or create execution receipts. On-chain coupon execution remains the next step.

## Flow

1. Start with the existing ACTIVE instrument, FINALIZED registered snapshot and stored coupon calculations UNDER_REVIEW or application APPROVED. Calculations, canonical snapshot integrity and current investor/receiver eligibility must still match.
2. Read the budget. At one finalized getMultipleAccounts context, the API validates the instrument's exact KZT-Test mint, issuer authority/precision, treasury ATA and issuer SOL. The retained Instrument PDA must match its ACTIVE database terms. Unknown mint/treasury extensions, delegation, freezing, foreign ownership and public-network funding are rejected.
3. Prepare exactly the positive deficit between the full coupon total and current treasury. The transaction uses idempotent Token-2022 ATA creation plus MintToChecked with six decimals. The issuer remains mint authority under the accepted issuance design. No private key enters the API.
4. Review Localnet/genesis, signer, mint, treasury and amount, then sign through Phantom. API transport verifies the exact message and Ed25519 signature before loopback broadcast with preflight. Funding is an explicit simulated issuance, not a transfer from a bank or an investor payment.
5. Confirm separately at finalized. The backend compares exact transaction bytes and the treasury's exact pre/post token delta (account index, mint, owner, token program and integer precision), then reads current mint/treasury state at or after that slot. Transaction and actor audit commit atomically. The action review state and entitlements are not marked paid/approved.

The dashboard reads stored attempts on mount so a controlled preparation is already reviewable. Immediately before the wallet prompt it refreshes only an unsigned attempt: a new blockhash is permitted after finalized expiry, while an altered amount requires review again. Signed attempts are retained for confirmation even after expiry/history problems. A lost signing/transport response disables another wallet invocation; no automatic mint resend occurs. Confirmation retries only TRANSACTION_NOT_FINALIZED, bounded by the existing 16-check policy.

## Budget and recovery

COUPON_NETWORK_RESERVE_LAMPORTS defaults to 50000000 (0.05 local SOL), minimum 5000000. The funding check adds actual ATA rent when absent and getFeeForMessage for the prepared message shape. The reserve is an explicit policy buffer, not an estimate/proof of all future execution fees and not escrow. Treasury may change after preflight; later on-chain approval/execution must repeat the full budget check and calculate its own rent/fee requirements. Application APPROVED from the previous slice alone cannot execute a payout.

Preparation serializably checks the current action version and calculations, saves exact wire/pins and audit, and permits only one unresolved COUPON_FUNDING attempt per issuer. That conservative limit also protects actions/instruments sharing the same issuer/mint treasury. Existing signed attempts must be confirmed before another prompt. A funded action resumes its finalized attempt instead of minting again. A future deficit may be funded only by another explicit reviewed preparation; this is not automatic treasury replenishment or a reservation across actions.

Confirmation uses the transaction's token delta rather than assuming no other treasury activity since preparation. Its audit also records the current observed balance/slot, which may already differ because of later transfers. Missing/pruned transaction history does not finalize a funding attempt or permit replacement of its signature.

## API

Under `/api/v1/corporate-actions/:id/coupon`:

| Route | Body / purpose |
| --- | --- |
| GET `/budget` | Whole coupon, finalized treasury/deficit/SOL/reserve, mint/ATA/genesis, current action version and saved funding attempt; Administrator/Auditor |
| POST `/funding/prepare` | `{version}`; no caller amount, mint or recipient |
| POST `/funding/submit` | `{operationId, signedTransactionBase64}`; Localnet exact signed-byte broadcast |
| POST `/funding/confirm` | `{operationId, signature}`; exact finalized transaction and mint delta |

Mutations require the issuer Administrator session, Origin and rate limits; reads are no-store. Apply migration `20261003001000_coupon_funding_operations`. No schema fields, dependency or live program upgrade is added. See [ADR-018](../decisions/ADR-018-localnet-coupon-funding.md).

Authorized Localnet OS preparation may append `prepare-funding` to `npm run localnet:confirm-snapshot -- <action UUID> <original signed snapshot operation UUID>`. Existing loopback/issuer/network/role/current-wallet/original authenticated preparation guards apply. It stores an unsigned funding plan with operationSource CONTROLLED_LOCALNET_CLI; signing, broadcast, approval and payment remain outside that command. It does not load browser cookies or keys.

Appending `confirm-funding` instead finds the latest already signed COUPON_FUNDING attempt with the same issuer/genesis and original preparation audit. It runs the same exact finalized-message/token-delta verifier and records CONTROLLED_LOCALNET_CLI in the confirmation audit. Without a recorded signature it refuses; it never prepares, signs, broadcasts or approves. This lets the authorized OS operator finish confirmation after the owner signs through Phantom.

## Verification and limits

The dashboard's 2026-10-07 recovery fix reads a fresh budget/version and calls server preparation before validating a newly returned unsigned plan. An expired stale plan is no longer a client-side dead end. The server still refuses replacement of an unresolved signed attempt or an unsigned blockhash that remains valid. Changes to amount, version, signer, genesis, snapshot, mint or treasury clear the owner's review; a blockhash-only refresh does not. Local signed state is retained after a lost submission response. Reloading FINALIZED funding recovers its existing signature and cannot issue another mint. See [the stage report](../testing/delivery-stage-2026-10-07.md).

Unit/boundary checks cover exact instruction encoding, amount bounds, token layouts/authorities, transaction delta mismatches, configuration, caller-amount rejection, public-network denial and UI plan mismatch/recovery. Production proxy checks the four fixed new routes. The combined disposable-validator HTTP/PostgreSQL harness additionally checks a real 1750 treasury mint/delta, role/Origin controls, concurrency, prepare/confirm audit rollback, signed-attempt resume and repeated-confirm/prepare without another mint. It does not touch the persistent owner's ledger.

Persistent owner signing and funding acceptance are recorded separately in [the live runbook](../testing/localnet-action-acceptance.md). User decisions, public Devnet, on-chain registration/approval, coupon execution, redemption and receipts/reconciliation remain separate gates. References: [Solana minting](https://solana.com/docs/tokens/basics/mint-tokens), [getTransaction](https://solana.com/docs/rpc/http/gettransaction).
