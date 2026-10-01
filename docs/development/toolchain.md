# Solana development toolchain

Status: local WSL toolchain and first Anchor build verified
Last reviewed: 2026-10-01

Observed in the current Ubuntu WSL environment on 2026-09-30: Rust 1.98.1, Anchor CLI 1.2.0, Solana CLI and validator 4.1.2, and SBF platform-tools v1.57. Rust unit tests, Clippy, and `anchor build` pass. The local-validator integration test deploys an upgradeable program with a disposable local administrator key and checks instrument creation, three action types, pre-snapshot cancellation, activation with canonical 10/20/5 balances, and snapshot commitment/replay guards. Anchor and Solana versions are pinned in `Anchor.toml`; the minimum supported host Rust version is in `Cargo.toml`.

The Ubuntu distribution still opens as `root` by default; this default was intentionally not changed. After explicit approval on 2026-10-01, a separate `lifecycle-dev` user was created with a locked password and only its own primary group (no sudo or Docker group). Its home has mode 0700. Version-specific binaries and the Rust toolchain were copied into user-owned directories, not linked to `/root`; no root wallet, Solana configuration, registry credentials or other private home contents were copied. The public crates.io registry cache/source/index was later reused for locked offline tests, without copying Cargo credentials. Root's installation remains unchanged. SHA-256 hashes of the copied Rustup, AVM, Anchor and Solana executables matched their installed sources; this verifies copying, not a fresh independent supply-chain audit.

This account reduces accidental privileged execution, not custody risk against the Windows owner or WSL root. Those administrators can still access its files. Review that trust boundary separately before storing any signer.

The new account has Rust/Cargo 1.98.1, Anchor CLI 1.2.0 and Solana CLI/validator 4.1.2. SBF platform-tools v1.57 were copied separately and checked with `cargo build-sbf --tools-version v1.57 --install-only`. The unqualified `cargo build-sbf --version` reports its default platform-tools v1.54; that output does not identify the explicitly selected v1.57 build tools. The local validator smoke test passed as `lifecycle-dev`. No persistent wallet or Devnet key was created; the validator used only a disposable temporary ledger, removed by the smoke test's cleanup.

Launch the reviewed user explicitly from PowerShell:

```powershell
wsl -d Ubuntu -u lifecycle-dev -- bash -l
```

The login shell reads the user-owned `.profile` containing Cargo/AVM/Solana PATH entries. Do not change WSL's default user or run Devnet operations through the existing root-based wrapper scripts implicitly. `npm run check:toolchain` still checks the distribution's default user; it is not evidence for the separate account. Verify that account explicitly:

```powershell
wsl -d Ubuntu -u lifecycle-dev -- bash -lc 'id; rustc --version; cargo --version; anchor --version; solana --version; solana-test-validator --version'
wsl -d Ubuntu -u lifecycle-dev -- bash -lc 'bash /mnt/c/Users/Админ/Documents/ChatGPT/LifecycleKASE/scripts/test-solana-validator.sh 18899 30'
```

This is a developer-machine checkpoint, not an automated installation runbook or Devnet deployment. Adapt the checkout path if it changes. Under `lifecycle-dev`, `cargo test --workspace --locked --offline` passed all 7 Rust unit tests and the empty doc-test suite on 2026-10-01. Full Anchor/SBF compilation and IDL generation subsequently passed under that account with `anchor build --tools-version v1.57` and explicit Linux-owned output directories. Review signer/upgrade-authority custody before the next Devnet step.

### Non-root build output — 2026-10-01

The initial build compiled Rust successfully but failed when LLVM tried to replace the existing root-owned `.so` on the Windows/DrvFS checkout (`Operation not permitted`). No source change or broad permission change was used to bypass this. A guarded temporary `/tmp/lifecycle-kase-non-root-build.*` directory held SBF and IDL outputs. `SBF_OUT_PATH` selected the SBF directory, and Anchor's `--idl`/`--idl-ts` selected the IDL outputs. Passing `--sbf-out-dir` as a forwarded Cargo argument failed because Anchor also forwarded it to the IDL test command; the environment variable avoids that conflict.

The existing compromised **localnet-only** program keypair was temporarily copied to the output directory solely to prevent build tooling from generating a new identity. Its bytes were compared locally without printing them; the original was unchanged. The temporary directory, including that copy, was removed on exit. No user wallet or Devnet key was created. The successful non-secret artifacts were copied to ignored `generated/non-root-build/`; old `target/deploy` artifacts were preserved. The IDL address matches `Anchor.toml`/`declare_id!` and contains the five expected instructions. These artifacts have not been deployed or integration-tested on Devnet.

Artifact evidence: `lifecycle_kase.so` is 290136 bytes, SHA-256 `cd502cfd217036548700c334b472b544ee7275ef1585870e4268bb34492e049b`. This is an observed build hash, not a reproducible/verifiable-build certification.

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

- On 2026-10-01, a failed PowerShell-to-WSL quoting diagnostic exposed the existing localnet program keypair in tool output. Treat that key as compromised and disposable/local-only. Do not reuse it for Devnet, mainnet, upgrade authority or a funded wallet. No key material is recorded here; the operator's Phantom key was not involved. Before Devnet, approve a fresh program identity and update/check all relevant program-ID projections. The existing localnet artifact is retained for compatibility, not trusted custody.
- Local validator and seed keypairs must be disposable and excluded from Git.
- Devnet keys must not be reused for mainnet or personal wallets.
- Installer output, logs, CI artifacts, and test evidence must never include seed phrases or private-key bytes.
- The application backend must not receive the administrator private key.
