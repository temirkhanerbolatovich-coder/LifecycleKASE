# ADR-001: Token authority and fixed-supply enforcement

Status: Accepted
Date: 2026-09-28

## Context

The MVP bond has a fixed supply of 35 indivisible units. Normal holder transfers must remain possible, while early and maturity redemption must be able to burn tokens without collecting a separate holder signature. The API must not custody an administrator private key.

## Options considered

1. Keep mint and freeze authority in an administrator wallet.
2. Transfer mint authority to the program and retain the ability to issue later.
3. Revoke mint and freeze authority after issuance and configure the Instrument Authority PDA as Token-2022 permanent delegate.
4. Require every holder to sign each redemption.

## Decision

Use a Token-2022 mint with `decimals = 0`. Before instrument initialization, issue exactly 35 tokens and distribute them in the demo allocation of 10, 20, and 5. Then revoke mint authority and ensure freeze authority is absent.

Configure the Instrument Authority PDA as the mint's permanent delegate. `initialize_instrument` must verify the mint address, decimals, total supply, absent mint and freeze authorities, and expected permanent delegate before the instrument can become active.

An external administrator wallet signs lifecycle instructions. The backend prepares and verifies transactions but never stores or uses the administrator private key.

## Reasoning

Revoking mint authority makes the fixed supply enforceable rather than a policy promise. The program-controlled permanent delegate supports atomic redemption without asynchronous holder participation. Keeping the human wallet outside the backend reduces custody and secret-management risk.

## Consequences

- Additional issuance is impossible for this instrument.
- Redemption can burn holder tokens only through validated program instructions.
- Loss or compromise of the administrator wallet requires a separately designed governance or recovery mechanism.
- Token-2022 wallet and infrastructure compatibility must be tested explicitly.

## Risks

- Incorrect permanent-delegate configuration could grant unintended burn power.
- A program vulnerability could affect all token accounts for the mint.
- Some wallet or indexer tooling may not fully represent Token-2022 extensions.

## Future work

- Define multisignature or governance-based administrator rotation.
- Obtain independent smart-contract and Token-2022 extension review before production.
- Define a separate issuance model if later instruments require reopenable supply.
