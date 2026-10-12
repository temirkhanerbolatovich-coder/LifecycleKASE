# Operator master checks — 2026-10-12

## Automated projection and navigation checks

Focused master/navigation/locale checks passed **23/23** during implementation, after the returned-for-revision scheduling regression was fixed. The TypeScript test compilation passed. These are behavior checks of the projection, URL parsing and message catalogs; they do not claim wallet, database or live financial execution.

Covered cases:

- Six stable TZ steps; unsigned draft and database-only approval cannot manufacture financial completion.
- Coupon, early redemption and maturity require their own matching finalized receipts.
- Controlled redemption needs every assigned-unit reservation and a separate capture FINISH before funding readiness.
- Treasury funding alone does not satisfy the action reserve; separate approval remains independent.
- Specific blockers for missing verified recipients, current eligibility, zero rounding, disabled registration/execution and insufficient budget.
- Returned-for-revision state reopens calculation without mutating notes or recipients.
- Unknown original signatures take priority over unsigned operations and retain the original attempt identity.
- Stale action/version views cannot report current reserve readiness.
- Step bookmarks reject invalid values and unrelated actions/sections; Russian and English catalogs remain aligned.

Commands:

```powershell
npx tsc -p apps/web/tsconfig.test.json
node --test apps/web/.test-dist/action-master-workflow.test.js apps/web/.test-dist/workspace-navigation.test.js apps/web/.test-dist/locale.test.js
git diff --check -- apps/web
```

## Automated browser fixture acceptance

`scripts/test-operator-master-browser.mjs` builds an isolated copy of the real operator components and supplies explicit synthetic request responses. It uses the existing installed Playwright/Chromium runtime through `KASE_PLAYWRIGHT_MODULE` and optional `KASE_CHROMIUM_EXECUTABLE`; it installs no dependency. The API and Solana client distributions must already be built.

The browser matrix passed at **1440 × 900** and **390 × 844** in both Russian and English. It checked note/recipient retention across steps, workspace sections, registry return and history Back/Forward; rejected calculation input retention; original-signature recovery with resubmission unavailable; the assigned-unit reservation → capture FINISH → funding-readiness transition; read-only coupon/early/maturity views; verified JSON/CSV download hooks; six-step keyboard order and Enter navigation; reduced-motion styling; and absence of horizontal page overflow. The desktop matrix additionally checked **200% CSS zoom**, which is an approximation and does not certify native browser zoom.

The final already-running browser process completed with exit code 0 after the user requested a stop. Its explicit Continue-button checks issued only read requests. The measured language-selector contrast was **15.25:1** at both sizes. The run produced 15 screenshots, four synthetic downloaded evidence files and its browser/build reports. No further test process, independent review or economics-v3 implementation was started after the stop request.

Screenshots were inspected. The CSS-zoom preview exposed narrow fixed-width master columns; the grid now adapts to available container width. Execution progress headers now use the bilingual master catalog instead of partially translating a dynamic financial sentence. The header language selector uses the light header palette so text is readable; its text/background contrast is checked against a 4.5:1 minimum.

Evidence is in [browser-evidence.json](evidence/action-master-2026-10-12/browser-evidence.json), with source fingerprints read from the copied build inputs, and explicitly states synthetic responses, no authentication/real wallet/DB/RPC access, and zero actual financial sends. Valid unsigned transaction bytes exercise the existing review/recovery validators; the explicit FINISH confirmation is a local response fixture. JSON/CSV attachment responses are intercepted, and all unexpected real API requests fail the test.

Reproduce from the repository root after setting the existing browser-runtime paths:

```powershell
node scripts/test-operator-master-browser.mjs
```

The default output is `docs/testing/evidence/action-master-2026-10-12`; `MASTER_BROWSER_EVIDENCE_DIR` can select a dedicated output directory. Temporary app copies stay ignored for failure diagnosis; successful runs remove only their own stale failure artifacts from the evidence directory.

## Remaining browser and integration acceptance

The coordinated owner-independent production build/proxy check is recorded by the parent task. The synthetic browser fixture does not certify actual authenticated runtime, Phantom interaction, native browser zoom, native screen-reader behavior or a real multi-user study.

For acceptance beyond the synthetic fixture, repeat these cases against disposable authenticated fixtures:

1. Open draft, scheduled, calculated, returned, under-review, approved, partially settled and finalized actions for all three types. Confirm six labels and specific current/blocker details.
2. Click Continue and arbitrary step buttons while monitoring requests. Navigation may read state; it must issue no financial POST, wallet prompt, signature or payment.
3. Enter recipients/review notes, navigate through steps 3–5, back to the list, another workspace section, and back. Confirm the same mounted forms retain values.
4. Restore a PREPARED and UNKNOWN_CONFIRMATION attempt. Navigate steps and browser Back/Forward; confirm its exact UUID, wire, original signature and send-disabled state survive.
5. Submit invalid creation/calculation/approval input. Confirm the server rejects it while values and explanatory errors remain visible.
6. For governed redemption, confirm unit reservations in step 3, return to capture FINISH in step 2, then inspect step-4 funding/reserve. Confirm free-unit release is never inferred from snapshot completion alone.
7. Inspect step 5 as issuer, assigned approver and auditor. Only the existing assigned approver controls can approve, with an explicit review and click.
8. Open `#actions?selected=<uuid>&step=approval`; use Back/Forward and the registry return. Confirm selection, focus and original financial state are retained.
9. At 360 px, 768 px and desktop widths in both languages, verify the step grid, text wrapping and keyboard focus. Confirm hidden subsections cannot receive focus.
10. In step 6 verify canonical receipt and JSON/CSV evidence downloads. Confirm partial evidence does not display a completed financial result.

These checks operate on disposable fixtures. They require no owner-validator upgrade, owner wallet movement, production deployment or modification of protected owner state.
