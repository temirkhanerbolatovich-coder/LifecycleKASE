# Anchor program: instrument and action scheduling

`initialize_instrument` creates the instrument PDA at `["instrument", instrument UUID bytes]` in `Deploying` status. The signer must be the current upgrade authority of this program (verified against its own ProgramData account) and becomes the instrument's issuer authority. The supplied bond and settlement mints must be distinct Token-2022 mints with 0 and 6 decimals respectively. The bond mint must have the requested nonzero supply, no mint or freeze authority, and the Instrument Authority PDA as its permanent delegate. Terms also validate the face value, coupon rate, payment frequency, dates, authorities, and UUID.

`create_corporate_action` creates `["action", instrument PDA, action UUID bytes]` in `Scheduled` status. Only the instrument's issuer authority may sign. It rejects a nil action ID, past or out-of-order dates, paused/redeemed instruments, and parameters that do not match coupon, maturity redemption, or early redemption. Coupon and early redemption must execute before or at maturity as applicable; maturity redemption must execute at or after maturity. Scheduling is allowed while the instrument is `Deploying` so preparation can precede activation; **no snapshot or payment can be executed by the current program**. Snapshot fields and counters begin at zero.

`activate_instrument` moves an instrument from `Deploying` to `Active` only when its issuer signs and 1–64 distinct, positive-balance Token-2022 holder accounts for the bond mint sum exactly to its supply at activation. It rechecks the mint configuration and permanent delegate. This is on-chain balance reconciliation, **not** KYC or verified investor-wallet mapping; the application must verify those separately and confirm the activation transaction at `finalized`. See [ADR-009](../../docs/decisions/ADR-009-instrument-activation.md).

`cancel_action` lets the issuer authority move only a `Scheduled` action to terminal `Cancelled`, recording the terminal timestamp. It checks the action's instrument relationship and PDA seeds. A database-only `Draft` is cancelled without an on-chain transaction. Actions after snapshot registration are not cancellable through this instruction.

`register_snapshot` lets the instrument issuer commit a nonzero snapshot hash, a past-or-current slot and investor/wallet/balance counts to a `Scheduled` action on an `Active` instrument. The on-chain Clock must be within 300 seconds after `record_at`, and total balance must equal the live Token-2022 bond mint supply. Registration changes the action to `SnapshotCreated`; the commitment cannot be replaced. This does **not** prove the hash preimage, verified investor mapping, RPC finality, or block time. See [ADR-010](../../docs/decisions/ADR-010-snapshot-registration.md).

These instructions do **not** issue or distribute tokens or verify investor identities. No entitlement, payment, burn, receipt, or Devnet deployment exists yet. The MVP binds administrator access to the program's upgrade authority; an immutable program or a different issuer wallet requires a separate governance design before deployment. See [ADR-008](../../docs/decisions/ADR-008-program-administrator.md).

## Local development

From Ubuntu WSL, in the repository root:

```bash
cargo fmt --all -- --check
cargo test -p lifecycle_kase --locked
cargo clippy -p lifecycle_kase --all-targets --locked -- -D warnings
anchor build
```

After `anchor build`, run `npm ci --prefix tools/solana-integration` and `npm run test:solana:integration` from PowerShell. This deploys to an isolated local validator with a disposable upgrade-authority key and tests instrument initialization, action scheduling/cancellation, activation with a 10/20/5 distribution, and snapshot commitment/replay rejection. The snapshot hash in this test is synthetic; canonical `snapshot-v2` content remains covered by separate domain tests. The test does not use or create a Devnet key. Its legacy Anchor client dependencies are isolated from the deployed application; see the [toolchain notes](../../docs/development/toolchain.md) for the current security limitation.

The checked-in program ID is a local development address. Its keypair is under ignored `target/deploy/`; no private key is committed. A fresh checkout can compile the program, but local deployment requires a disposable keypair. Run `mkdir -p target/deploy`, create it with `solana-keygen new --silent --no-bip39-passphrase --outfile target/deploy/lifecycle_kase-keypair.json`, then run `anchor keys sync` to align the source and `Anchor.toml` with that key. Never commit or publish the JSON keypair. Do not use this development key for Devnet or real assets.
