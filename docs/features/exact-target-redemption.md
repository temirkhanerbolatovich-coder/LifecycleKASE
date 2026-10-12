# Exact-target partial redemption

This isolated Localnet candidate implements the allocation and exact-quantity part of BondFlow section 8.3. Reservation of assigned token units remains a separate requirement. See [ADR-029](../decisions/ADR-029-exact-target-redemption.md), [redemption execution](redemption-execution-and-receipts.md) and [BondFlow plan](bondflow-implementation-plan.md).

## Calculation and ownership

For balance `b`, total snapshot balance `B` and target `T`, start with `floor(b*T/B)` and remainder `(b*T) mod B`. Award `T - sum(floors)` additional tokens to the greatest remainders. Equal remainders use ascending ASCII base58 addresses: each investor's smallest positive captured source owner. Payment-wallet changes cannot change allocation.

For `10/20/5` and target `8`, the result is `2/5/1`, leaving `8/15/4`. For `1/1/1` and target `1`, one holder receives one redemption and two retain zero-valued entitlement rows. Allocation is independent of input/account order and never exceeds a position. Money uses integer minimal KZT-Test units; amount equals allocated tokens times price.

The program accepts positive snapshot positions and a positive target. The standalone domain helper also supports zero/empty preview inputs. Percentage conversion uses `floor(totalBalance*percentageBps/10000)` once; v2 scheduling accepts an explicit target before capture.

## API and configuration

POST `/api/v1/corporate-actions` accepts for an exact early redemption:

```json
{
  "requestId": "00000000-0000-4000-8000-000000000001",
  "instrumentId": "00000000-0000-4000-8000-000000000002",
  "type": "EARLY_REDEMPTION",
  "intent": "Redeem exactly eight bonds",
  "recordAt": "2026-12-01T12:00:00Z",
  "executeAt": "2026-12-01T12:05:00Z",
  "redemptionAllocationPolicy": "exact-target-largest-remainder-v2",
  "redemptionTargetTokens": "8",
  "redemptionPercentageBps": null,
  "redemptionPriceKzt": "1000"
}
```

Dates must satisfy instrument terms and minimum lead time. Target is a canonical positive integer string. Target-times-price must fit signed 64-bit database integers. Calculation rejects a target greater than captured supply. Target and policy are immutable database fields; use a new action to change them. Bodies with percentage and no policy remain v1.

`EXACT_TARGET_REDEMPTION_ENABLED` defaults to `false`. Enabling requires `ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED=true`, `ACTION_APPROVAL_RESERVE_ENABLED=true` and `REDEMPTION_EXECUTION_ENABLED=true`; malformed configuration fails closed. Creation/scheduling is restricted to the reviewed Localnet candidate. Do not enable against the historical program. Read-back verifies target PDA, owner, action, version, quantity and finalized slot alongside action/entitlement versions.

GET entitlements provides `redemptionAllocationPolicy`, `redemptionTargetTokens`, `exactRedemptionSummary` and immutable row inputs. Summary includes target, allocated quantity, original total, remaining quantity and tie rule. Stored corruption, ambiguous policy, coverage gaps and chain version mismatches fail explicitly.

## Workflow and evidence

Draft → v2 schedule → finalized snapshot → calculate and submit complete investor rows → v2 registration/source commitment → global v2 finalization → full reserve and independent on-chain approval → atomic payment/burn for positive rows → finalized reconciliation → final receipt.

The browser checks selected policy/quantity against prepared metadata and actual v2 instruction bytes before signing. Unknown confirmation retains the original operation/signature. Reset clears a partial registration before finalization while keeping its target; there is no off-chain shortcut to approve v2.

Exact actions create `redemption-action-receipt-v2`, binding policy, target, total snapshot balance, tie rule and every row's tie address, quota remainder/denominator and remaining quantity to reconciled cash/burn evidence. Legacy actions keep `redemption-action-receipt-v1` and its canonical format.

## Validation and limitations

Run `npm run check`, `npm run build` and `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-kase-demo.ps1`. The harness creates its own candidate artifact, validator ledger, wallets and PostgreSQL database and stops its own runtime. A prebuilt candidate can be passed with `-Profile localnet-candidate-...`.

Acceptance retains coupon/percentage paths and adds exact redemption: `35 → 28 → 20 → 0` supply. It checks legacy instructions cannot register/finalize v2, and wrong `3/4/1` allocation with the same total as correct `2/5/1` cannot finalize. Target bytes survive reset/execution. See the dated [acceptance record](../testing/bondflow-exact-redemption-2026-10-12.md) for performed checks.

Verify a saved four-action JSON package with `npm run demo:evidence:verify -- <runtime.json>`. The [offline verifier](../../scripts/verify-kase-demo-evidence.mjs) checks canonical receipt hashes, identities, settlement signatures, cash/burn totals, supply transitions and exact allocation from captured source balances. It needs the built domain and Solana client packages (`npm run build --workspace @lifecycle-kase/domain` and `npm run build --workspace @lifecycle-kase/solana-client`). It does not connect to RPC or prove that the saved claims still match a live chain. Disposable signatures belong to that run's Localnet genesis and have no public explorer evidence.

The command accepts this fixed `kase-four-actions-demo-v2` fixture only, with a 4 MB input limit. It is not a general verifier for arbitrary instruments or receipts. Invalid JSON, altered hashes/settlements, mismatched identities, duplicate signatures and inconsistent exact allocation cause a nonzero exit with a field-specific error. A package whose entire contents have been fabricated consistently still needs independent finalized chain evidence; local hash consistency alone does not establish authenticity.

The [controlled registry](controlled-registry.md) protocol/client candidate adds assigned-unit reservation and enforceable movement for a new instrument/mint; integration into this existing API/UI remains open. Historical snapshots, larger-than-packet finalization, durable workers, Devnet execution, taxes and separate final-coupon period obligations remain open. QA is a walletless simulation and provides no settlement evidence.
