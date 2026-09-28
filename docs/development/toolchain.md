# Solana development toolchain

Status: installation pending
Last reviewed: 2026-09-28

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

The selected Anchor and Solana versions must be recorded in `Anchor.toml` only after a generated program successfully builds and its local tests pass together. AVM should manage the Anchor version and resolve the project-compatible Solana CLI. Using floating `latest` versions in CI is prohibited after this compatibility check.

## Repository gate

The current PowerShell diagnostics remain useful before WSL setup:

```powershell
npm run check:toolchain
npm run solana:smoke
```

They intentionally fail while the tools are unavailable on the current `PATH`. Once the Anchor workspace exists, CI must install the exact pinned versions and run Rustfmt, Clippy, build, and local-validator tests.

## Security boundaries

- Local validator and seed keypairs must be disposable and excluded from Git.
- Devnet keys must not be reused for mainnet or personal wallets.
- Installer output, logs, CI artifacts, and test evidence must never include seed phrases or private-key bytes.
- The application backend must not receive the administrator private key.
