# Controlled registry and assigned redemption units

This protocol/client candidate implements enforceable movement and capture for a **new instrument v2 and new Token-2022 mint**. Instrument version is independent of exact-target action version. The retained owner mint and legacy actions remain unchanged. See [ADR-030](../decisions/ADR-030-controlled-registry-and-unit-reservations.md), [exact-target allocation](exact-target-redemption.md) and [BondFlow implementation plan](bondflow-implementation-plan.md).

## Authority and token policy

The new bond mint has exactly `PermanentDelegate` and `DefaultAccountState(Frozen)` extensions, zero decimals and a fixed supply. Its freeze authority and permanent delegate are the instrument authority PDA. The administrator's mint authority is revoked during atomic program bootstrap. Settlement remains a separate six-decimal Token-2022 KZT-Test mint without extensions or freeze authority.

Every holder token account starts Frozen. Supported accounts have ImmutableOwner, no delegate or close authority, and optional CPI Guard and MemoTransfer. The client collector retains actual bytes and both guards' states; the program captures token account identities, wallets and balances. Other extensions are rejected. Holders can enable these guards while frozen; the program uses its permanent delegate for CPI, and burn does not require an incoming memo, so enabling either guard does not strand reserved units.

Only `controlled_transfer` moves bonds. It requires both the current wallet owner and the instrument corporate-action authority. It validates the token account and Holding PDA, blocks during capture, and restricts amount to `balance - reservedTokens`. It thaws source/destination, transfers through the PDA and refreezes both in one instruction. Failed CPI rolls the whole instruction back. There is no standalone thaw, freeze-authority updater, arbitrary burn or reservation-release command.

This prototype's transfer policy is operator approval, not a KYC provider or an on-chain investor-role registry. The holder's signature expresses ownership authorization. The operator validates the intended recipient under its registry policy; a controlled Holding alone does not attest eligibility.

Incoming transfers to a destination with MemoTransfer enabled currently fail with Token-2022's memo requirement and roll back; the controlled instruction does not issue a memo CPI. Use a destination without that requirement or disable the destination's incoming memo flag explicitly through its owner. Outgoing free-unit transfers and assigned burns remain available. This is a supported safe failure, not a reason to relax memo protection.

## Lifecycle and instructions

| Instruction | Behavior |
| --- | --- |
| `initialize_controlled_instrument` | Verify upgrade-authority administrator, new mint terms and frozen empty treasury; thaw, mint fixed supply, freeze and revoke mint authority atomically; create Instrument v2 and policy |
| `register_controlled_holding` | Bind a supported frozen token account to instrument, mint and wallet; reserved count starts at zero |
| `activate_controlled_instrument` | Reconcile unique positive frozen token accounts and Holding PDAs to fixed mint supply |
| `controlled_transfer` | Move only free units with holder/operator signatures; refreeze source and destination |
| `begin_controlled_capture` | Start within record-date window, save actual Clock slot/time, lock movement; reject another unresolved capture/redemption |
| `record_controlled_snapshot` | Validate complete actual positive account coverage and actual supply; store immutable raw positions and the authority's canonical snapshot commitment |
| `register_controlled_redemption_sources` | Verify every entitlement source account, wallet and captured balance against immutable capture before creating shared source/progress accounts |
| `reserve_controlled_redemption` | After global calculation reaches UnderReview/Approved, bind entitlement/source commitment and reserve exactly its deterministic assigned units |
| `finish_controlled_capture` | For redemption verify complete source and entitlement reservation coverage, including zero-assignment markers, then unlock free transfers; coupon capture requires no unit reservations |
| `abort_controlled_capture` | Unlock and close only an uncommitted capture with no reservations; never release approved/processed units |
| `execute_controlled_redemption` | Verify active action/reservation and current supply; thaw positive assigned sources, run atomic cash/burn, refreeze and consume counters/receipt in the same transaction |
| `complete_controlled_redemption` | Clear the active redemption only after its action is Finalized |

Legacy activation, snapshot registration, source registration, cancellation and execution do not accept controlled instruments. Shared calculation/approval/receipt logic is reused; existing account layouts and v1 error numbers remain compatible. Controlled scheduled cancellation is currently unsupported. A failed or stalled committed capture needs continuation through the saved action; there is no administrative unlock shortcut.

## State and data

| PDA seed | Saved facts |
| --- | --- |
| `controlled-policy`, instrument | Instrument/mint binding, active capture and unfinished redemption |
| `controlled-holding`, instrument, token account | Immutable account/wallet binding and assigned reserved quantity |
| `controlled-capture`, action | Begin slot/time, snapshot hash, committed/finished state, actual raw positive account/wallet/balance list and reservation coverage |
| `unit-reservation`, entitlement | Action/entitlement/snapshot/source binding, per-source assigned burn quantities and consumption marker |

The capture's positive balances must sum exactly to mint supply. Direct transfer/burn and minting are unavailable while Frozen, and the policy blocks the sole controlled movement path. Therefore a complete fixed supply reconciles to the captured account list. Duplicate, omitted, foreign-mint, wrong Holding and altered source inputs fail validation.

The client collector requires `minimumContextSlot` from the finalized capture transaction. Each before/registry/after RPC read uses finalized commitment and `minContextSlot`, and every returned context must meet that lower bound. The caller must read back the expected policy and capture and verify the transfer lock. The collector itself is a read helper; it does not acquire that lock or reconstruct arbitrary historical balances.

Program raw positions contain public keys and quantities. Investor grouping and eligibility remain authority-attested off-chain inputs in the canonical snapshot hash. Captured slot/time reflect actual lock acquisition, separately from planned record-date. Hash equality does not independently prove off-chain identity or regulatory compliance.

## Reservation and settlement

For `10/20/5` and exact target 8, the final allocation is `2/5/1`. Only eight units become reserved; all 27 unassigned units remain transferable through the controlled path. One investor may own several token accounts; the shared deterministic source order identifies exactly which accounts hold its assigned units.

Zero-assignment sources keep their immutable commitment and Holding marker. Their current token account bytes are not needed for payment/burn. A holder can drain, close or recreate such an account without blocking settlement of its positive assigned sources. Positive reservations require frozen, correctly owned sources with sufficient balance and the matching reserved counters.

Atomic settlement retains existing full cash reserve, distinct approver, due execution date, exact entitlement amount, permanent-delegate burn, progress/supply checks and replay receipt. A failed payment, source validation, burn or refreeze creates no receipt and changes no cash, supply, reserved counters or frozen state. Consumed positive reservations clear only the assigned quantity. Unknown financial submission outcomes require confirmation of the original signature; they are not permission to rebuild or resend.

## Reproduction

The new client module exports mint/setup, lifecycle, movement, capture, reservation and execution builders plus identity-bound sidecar decoders. Build and type/test-check it using the existing workspace commands:

```bash
npm run check
npm run build
```

With Docker-independent non-root WSL Solana/Anchor tooling and the existing isolated integration dependencies:

```powershell
npm run test:controlled:integration
```

The wrapper builds a separate candidate, generates a temporary administrator and fresh validator ledger, and saves finalized public evidence under `generated/controlled-registry-*`. It stops only its own validator and removes its owned temporary signer/ledger. `-Profile localnet-candidate-... -RpcPort 19180` can reuse a reviewed candidate. Public keys/signatures and hashes may be retained; private keys never enter the evidence package.

Performed checks and remaining acceptance boundaries are in the [dated testing record](../testing/controlled-registry-2026-10-12.md). Unit/build success does not substitute for chain acceptance.

## Integration limits

The protocol acceptance above is the earlier checkpoint. The subsequent [application integration candidate](../testing/controlled-workflow-integration-2026-10-12.md) adds API/database/web issuance, capture and assigned-unit settlement. `CONTROLLED_REGISTRY_ENABLED=false` remains the default; new instrument v2 drafts require the explicitly enabled reviewed Localnet candidate. No retained-owner or hosted flag was enabled. [ADR-031](../decisions/ADR-031-controlled-workflow-integration.md) records exact-wire/original-signature recovery, raw capture provenance and atomic projection/audit.

Legacy issuance keeps `MINT_SETUP → DISTRIBUTION → INITIALIZE → ACTIVATE`; controlled issuance uses `MINT_SETUP → INITIALIZE → DISTRIBUTION → ACTIVATE`, with holding registration and authorized movement in distribution. Immutable token policy selects the contract for every saved attempt. Capture operations persist begin/record/reserve/finish progress and actual slot/time; snapshot reads require the finalized movement lock. Receipt projection distinguishes immutable sources from current closed/recreated zero-assignment accounts and post-burn account closure. Existing holder eligibility, issuer/session/Origin checks and independently derived browser wire verification continue to apply. Performed integrated runtime results are recorded separately from protocol acceptance.

Capture is atomic and capped at 64 positive token accounts in source, with token/Holding pairs increasing metas; actual packet/account limits are lower without address lookup tables. The earlier protocol fixture has four sources and three wallets, including a zero-assignment source; the integrated application fixture has three sources and three wallets. This is not measured fleet-scale or 10,000-holder support. Scalable capture, reservation reversal, durable workers, arbitrary historical record-date, Devnet rollout, real KZT/KYC and production governance remain separate work.

See [Solana default state](https://solana.com/docs/tokens/extensions/default-state), [PermanentDelegate](https://solana.com/docs/tokens/extensions/permanent-delegate) and the [official Token-2022 processor](https://github.com/solana-program/token-2022/blob/main/program/src/processor.rs) for token semantics. The actual installed version and candidate runtime, rather than a generic documentation example, define acceptance here.
