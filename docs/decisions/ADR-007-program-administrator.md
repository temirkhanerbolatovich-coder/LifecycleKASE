# ADR-007: Program upgrade authority as MVP administrator

Status: Accepted for local MVP
Date: 2026-09-29

## Context

`initialize_instrument` previously accepted any signer with a valid Token-2022 mint. UI authentication and a backend wallet allowlist cannot protect a direct on-chain call. The MVP needs an on-chain administrator trust anchor without publishing a private key or permitting first-caller takeover.

## Options considered

1. Allow any signer and rely on backend authorization: direct program calls bypass it.
2. Initialize a registry with the first caller: initialization can be front-run.
3. Hardcode an administrator public key: rotation requires a program upgrade and environment-specific code.
4. Require the signer to match this program's current upgrade authority.

## Decision

For the MVP, `initialize_instrument` receives the executable program account and its ProgramData account. It verifies their relationship and requires the administrator signer to equal the ProgramData upgrade authority. The same signer becomes the instrument issuer authority. The local integration test deploys an upgradeable program with a disposable administrator keypair.

## Reasoning

The upgrade authority already controls program code, so it is an existing high-trust on-chain identity. This closes unauthorized instrument registration without creating a second bootstrap process or committing a privileged address.

## Consequences and risks

- The administrator wallet also controls program upgrades; compromise affects both powers.
- If upgrade authority is revoked, new instruments cannot be initialized under this design.
- Rotating the program upgrade authority immediately changes who may initialize instruments, but does not change issuer authority on existing instruments.
- A future deployment that needs separate issuer operations, multisig governance, or an immutable program must replace this gate with an explicitly bootstrapped delegation design and tests before going live.

## Future work

Design governance and administrator delegation/rotation before Devnet issuance or production custody. Verify the deployed program's ProgramData and authority during deployment review.
