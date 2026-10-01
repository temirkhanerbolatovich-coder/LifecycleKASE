# ADR-013: Phantom authority and separate Devnet deployment payer

Status: Accepted for disposable Devnet demo; not deployed
Date: 2026-10-01

## Context

The user approved a separate CLI payer and the existing Phantom operator as upgrade authority/issuer. `initialize_instrument` currently requires the program upgrade authority to sign and stores that signer as issuer. Assigning the CLI payer as upgrade authority would therefore prevent the Phantom session from managing those instruments. The earlier localnet program keypair is compromised and must never be used for Devnet.

## Options considered

1. Keep CLI payer as upgrade authority/issuer and move operator signing to the CLI: conflicts with the user-owned Phantom workflow.
2. Assign Phantom upgrade authority/issuer and retain a separate CLI payer: preserves current contract checks.
3. Separate bootstrap administrator, issuer and upgrade governance in the program: useful later, but requires a reviewed contract design and authorization tests.

## Decision

Use the approved public identities in the [Devnet plan](../deployment/devnet-plan.json). The CLI wallet pays deployment costs; the fresh program keypair establishes program identity; Phantom controls upgrades and signs instrument initialization as issuer. The plan does not assign powers on-chain. No Phantom seed/private key is imported into CLI, API, repository or Render. Instrument initialization must be implemented as an explicit wallet-reviewed signature, not a server signature.

## Reasoning and consequences

This keeps the MVP contract's on-chain authorization intact. Phantom compromise affects both upgrades and instrument issuance; these are high-trust privileges, not merely UI login. Upgrade-authority rotation changes who can initialize future instruments but does not rotate existing instrument issuers. The CLI keys are unencrypted owner-controlled files and require a reviewed offline backup. No production custody claim is made.

## Risks and future work

Build implementation preserves the default localnet identity and uses a distinct `devnet` Cargo feature/Anchor mapping, rather than globally replacing the local address or copying the real Devnet keypair into the checkout. This keeps local fixtures compatible and prevents a build command from becoming a custody operation. The [isolated build](../deployment/devnet-build.md) binds source/configuration/IDL to a reviewed artifact hash; actual loader and authority checks remain deployment-time work.

Review backup and test funding, integrate/rebuild the public program identity, obtain separate deployment authorization, verify finalized ProgramData/authority, and implement wallet-signed initialization. Before production, design delegation, rotation and multisig governance with external security review. Do not weaken checks or import Phantom secrets to bypass an unavailable signing flow.
