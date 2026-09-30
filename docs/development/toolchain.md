# Solana development toolchain

Status: local WSL toolchain and first Anchor build verified
Last reviewed: 2026-09-29

Observed in the current Ubuntu WSL environment on 2026-09-30: Rust 1.98.1, Anchor CLI 1.2.0, Solana CLI and validator 4.1.2, and SBF platform-tools v1.57. Rust unit tests, Clippy, and `anchor build` pass. The local-validator integration test deploys an upgradeable program with a disposable local administrator key and checks instrument creation, three action types, pre-snapshot cancellation, activation with canonical 10/20/5 balances, and snapshot commitment/replay guards. Anchor and Solana versions are pinned in `Anchor.toml`; the minimum supported host Rust version is in `Cargo.toml`.

The current Ubuntu distribution opens as `root`, so the binaries above live under `/root`. Before creating any Devnet signer or deployment key, switch development to a non-root WSL user and install or expose the toolchain there. No Devnet key has been created by this setup step.

## Supported environment

The supported Windows development path is WSL 2 with Ubuntu. Node-only repository checks may run in PowerShell, but Anchor builds and local-validator tests must run inside WSL because the official Solana and Anchor installation guidance requires WSL on Windows.

Do not install the blockchain toolchain globally from an unreviewed third-party script. Follow the official guides and inspect installer commands before execution:

- [Solana local installation](https://solana.com/docs/intro/installation)
- [Anchor installation](https://www.anchor-lang.com/docs/installation)
- [Anchor Version Manager](https://www.anchor-lang.com/docs/references/avm)

## Installation gate

Installation is an explicit developer-machine action and is not performed by repository scripts. After installing inside WSL, capture:

```bash
rustc --version
cargo --version
solana --version
solana-test-validator --version
anchor --version
```

Then run:

```bash
solana-test-validator --version
```

The selected Anchor and Solana versions are recorded in `Anchor.toml` after the first program build and Rust tests. AVM manages the Anchor version and resolves the project-compatible Solana CLI. CI must not use floating `latest` versions.

## Repository gate

The PowerShell diagnostic checks Node/npm/Docker on Windows and Rust/Solana/Anchor inside the `Ubuntu` WSL distribution (override with `-WslDistribution` when calling the script directly):

```powershell
npm run check:toolchain
npm run solana:smoke
```

`solana:smoke` starts a disposable validator inside Ubuntu and checks its RPC health, then removes its temporary ledger. Both diagnostics fail while the blockchain tools are unavailable in WSL. Once the Anchor workspace exists, CI must install the exact pinned versions and run Rustfmt, Clippy, build, and local-validator tests.

For the on-chain instructions, run `anchor build` from Ubuntu WSL, `npm ci --prefix tools/solana-integration` from PowerShell, and then `npm run test:solana:integration` from PowerShell. The latter builds the production Solana client, starts a disposable validator in WSL, deploys the freshly built program as upgradeable with a temporary local keypair, invokes it with a Windows Node test client, verifies the instrument and action PDAs, transfers canonical 10/20/5 bond balances, checks activation and a synthetic snapshot commitment, compares the Kit-based instruction plan byte-for-byte with Anchor encoding, and stops the validator. The temporary keypair and ledger are removed when the script exits; it never targets Devnet. The TypeScript Anchor test client currently requires legacy `@solana/web3.js` v1, so its dependencies are isolated in `tools/solana-integration` and are **not installed by the root package or Render build**. The production client uses pinned `@solana/kit` only for deterministic PDA derivation. The isolated test package has known `npm audit` advisories (including high severity); use it only with a trusted local validator, never with remote or untrusted RPC input. Replace the legacy test client with a maintained Kit-based or Rust test harness before it becomes part of a production-oriented pipeline. This test does not prove investor identity, canonical hash preimage, a finalized application confirmation flow, or corporate-action execution.

## Security boundaries

- Local validator and seed keypairs must be disposable and excluded from Git.
- Devnet keys must not be reused for mainnet or personal wallets.
- Installer output, logs, CI artifacts, and test evidence must never include seed phrases or private-key bytes.
- The application backend must not receive the administrator private key.
