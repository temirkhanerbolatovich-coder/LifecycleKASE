# Anchor program: first instrument instruction

The program currently implements only `initialize_instrument`. It creates the instrument PDA at `["instrument", instrument UUID bytes]` in `Deploying` status. The signer becomes its issuer authority. The supplied bond and settlement mints must be distinct Token-2022 mints with 0 and 6 decimals respectively. The bond mint must have the requested nonzero supply, no mint or freeze authority, and the Instrument Authority PDA as its permanent delegate. Terms also validate the face value, coupon rate, payment frequency, dates, authorities, and UUID.

This instruction does **not** issue or distribute tokens, reconcile holder balances, or make an instrument `Active`. No action, snapshot, entitlement, payment, burn, receipt, or Devnet deployment exists yet. It has no global administrator registry, so any signer with a correctly configured mint could register an unused UUID. Do not deploy to Devnet as an authorized issuer workflow until that authority boundary is added.

## Local development

From Ubuntu WSL, in the repository root:

```bash
cargo fmt --all -- --check
cargo test -p lifecycle_kase --locked
cargo clippy -p lifecycle_kase --all-targets --locked -- -D warnings
anchor build
```

After `anchor build`, run `npm ci --prefix tools/solana-integration` and `npm run test:solana:integration` from PowerShell. This tests the instruction against an isolated local validator and real Token-2022 mint accounts, including supply and mint-authority rejection. The test does not use or create a Devnet key. Its legacy Anchor client dependencies are isolated from the deployed application; see the [toolchain notes](../../docs/development/toolchain.md) for the current security limitation.

The checked-in program ID is a local development address. Its keypair is under ignored `target/deploy/`; no private key is committed. A fresh checkout can compile the program, but local deployment requires a disposable keypair. Run `mkdir -p target/deploy`, create it with `solana-keygen new --silent --no-bip39-passphrase --outfile target/deploy/lifecycle_kase-keypair.json`, then run `anchor keys sync` to align the source and `Anchor.toml` with that key. Never commit or publish the JSON keypair. Do not use this development key for Devnet or real assets.
