# Operator corporate-action master

The authenticated action detail provides six navigable steps for coupon, early-redemption and maturity-redemption actions. It reuses the existing reviewed financial controls and API contracts. Selecting a step or **Continue** changes the visible section and URL; it cannot prepare, sign, broadcast, confirm or pay.

| Step | Existing controls | Completion evidence |
| --- | --- | --- |
| 1. Terms and scheduling | Draft terms, schedule/cancel transaction review | Server scheduling state or finalized schedule transaction |
| 2. Holder snapshot | Snapshot and controlled capture BEGIN/FINISH/ABORT | Finalized stored snapshot |
| 3. Calculation and registration | Recipients, calculation, submit for review, entitlement registration, calculation FINALIZE and assigned-unit reservations | Finalized registration; controlled redemption additionally requires every reservation including zero allocations |
| 4. Readiness and funding | Test treasury funding, separate approver assignment and action reserve | Complete current action reserve and released controlled capture gate |
| 5. Separate approval | Assigned approver's reviewed approval transaction | Finalized approval transaction or independently checked approval state |
| 6. Execution and results | Existing individual payment/burn review, original-signature confirmation, final receipt and evidence JSON/CSV downloads | Finalized action and its matching coupon/redemption finalization transaction |

Each step displays `not_started`, `active`, `completed` or `blocked` and explains the concrete missing condition. Unknown or submitted signatures take priority over unsigned work. Application-level APPROVED, a wallet signature or HTTP success cannot complete a financial stage. Treasury funding alone cannot complete the action-reserve stage.

Controlled redemption captures holders before the calculation exists. After calculation registration, every assigned-unit reservation must be confirmed; the operator then returns to step 2 to finish capture and release free balances. Step 4 explicitly points to this operation rather than treating the finalized snapshot as proof that the transfer gate is open.

## State and navigation

`action-master-workflow.ts` projects existing server action and transaction state plus the current entitlement, capture, budget, approval and execution views. Action/version mismatches are ignored rather than used as fresh readiness evidence.

The same `CorporateActionDetail` remains mounted while returning to the registry or another workspace section. One `EntitlementPanel` is shared by steps 3–5; presentation subsections use `hidden`, preserving recipient choices, review notes, prepared transaction bytes and original signatures. The execution component is also retained. The master does not create a second financial widget or a second attempt.

Example link: `#actions?selected=<action-uuid>&step=approval`. Allowed step values are `terms`, `snapshot`, `calculation`, `readiness`, `approval`, `execution`. Invalid or unrelated selections cannot target an operation. Browser history restores the selected step/action. Sensitive values, wallet signatures and transaction bytes are kept out of step URLs.

Validation errors leave creation and review inputs in place. Returning for revision reopens calculation against the retained snapshot. Signing still requires each existing explicit review checkbox and signing control; Continue never supplies consent. If an approval recovery read disagrees with a locally signed attempt, the original attempt is retained and resubmission fails closed.

## Configuration and limits

The master respects the current controlled-registry, on-chain registration, exact-redemption, approval, coupon and redemption gates. It does not enable services or modify permissions. Auditor mode shows read-only stage evidence; the existing panels require the assigned administrator and wallet for mutations. Funding controls are initially mounted only once the capture prerequisites allow a budget read, and are retained afterward.

The master is an operator presentation, not an automatic financial runner or a proof of present chain settlement. It refreshes facts through the existing controls. The walletless `/qa` simulation retains its existing synthetic flow and does not manufacture master acceptance evidence. Full reload, logout and replacement of the operator session are outside in-memory form retention.

Step 6 exports use the authenticated same-origin evidence endpoint. Downloads are released only after the file and canonical payload hashes are verified. Exports of incomplete actions contain their actual saved state and do not imply final settlement.

## Verification

Run `npx tsc -p apps/web/tsconfig.test.json`, then `node --test apps/web/.test-dist/action-master-workflow.test.js apps/web/.test-dist/workspace-navigation.test.js apps/web/.test-dist/locale.test.js`. Run the normal web typecheck/build and operator proxy checks for integration. `scripts/test-operator-master-browser.mjs` runs the real components against explicitly synthetic responses in an isolated production app copy; it uses the existing configured Playwright/Chromium runtime and performs no real financial operation. See [master acceptance checklist](../testing/operator-action-master-2026-10-12.md) for browser checks, reproduction and recorded limitations.
