# KASE prototype submission package

Read the [technical overview](TECHNICAL_OVERVIEW.md), [current compliance gates](../KASE_COMPLIANCE_CHECKLIST.md) and [three-action acceptance](../testing/kase-three-actions-2026-10-10.md).

## Recorded demonstration

The [44.64-second demo video](kase-three-actions.webm) tours the actual completed coupon, partial redemption and maturity action screens, downloads each verified receipt, shows planned/effective cutoff evidence and the redeemed instrument, then checks the mobile screen. It has no audio. Execution uses disposable automated test signers; the video shows the real read-only Auditor UI after those transactions, rather than a physical Phantom signing flow.

The [public run evidence](../testing/evidence/kase-three-actions-2026-10-10.json) includes all signatures and exact canonical receipts. Screenshots: [desktop maturity](bond_redemption.png), [mobile maturity](maturity-mobile.png). Video SHA-256: `b6652cf20dee44de9f48e875cb666e194e0a107e6465508582eece04e16e3d6d`.

## Reproduce the working prototype

On Windows with Docker Desktop, Node dependencies and the documented [non-root WSL Solana toolchain](../development/toolchain.md):

```powershell
npm ci
npm run demo:verify
```

The wrapper builds a new isolated candidate, starts its own loopback PostgreSQL, creates a fresh instrument/holders on a disposable validator and exercises authenticated HTTP workflows. It does not load the owner's `.env`, signer or ledger. It removes only its test container/database/ledger at completion and leaves public receipt evidence in ignored `generated/`.

Optional live UI recording uses an already installed Playwright module and Chromium:

```powershell
npm run demo:verify -- -Video -PlaywrightModule 'C:\path\to\playwright\index.mjs'
```

Use `-Profile localnet-candidate-your-reviewed-profile` to reuse an isolated artifact. The default run builds a new uniquely named artifact; it never replaces a retained deployment.

If the installed browser revision differs from Playwright's default, add `-ChromiumExecutable 'C:\path\to\chrome.exe'`. The wrapper checks browser launch and video encoding before the financial run. Capture retries affect only Auditor reads/downloads; they never execute the financial actions again.

## What the demonstration proves

1. Coupon: a pre-capture transfer produces immutable 9/21/5 entitlements. Returning it after capture cannot alter payments 450/1050/250 KZT-Test.
2. Partial 20% redemption: payments 2000/4000/1000 and burns 2/4/1; supply 35 → 28. Snapshot-source shortage rejects both API submission and direct program execution without payment/burn/receipt.
3. Maturity: remaining 8/16/4 bonds pay 8400/16800/4200, including final coupon; burns 28, supply 0, Instrument REDEEMED.
4. Each action has finalized individual payments, matching cash/asset facts and a canonical JSON hash committed to an ActionReceipt PDA. Replays cannot pay again; missing history/audit failure recovers using the original signature.

The optional recording tours the real Auditor UI after these actual transactions, downloads all three receipts and verifies their hashes, shows planned/effective cutoff evidence and checks a mobile viewport. Generated test keys sign the automated execution; the recording does not claim physical Phantom wallet acceptance.

## Boundaries and final submission gates

KZT-Test funding, eligibility and accelerated test timing are simulated inputs. Solana transfers, burns and receipts execute on an actual local validator. The cutoff is the effective finalized capture slot/time; earlier historical reconstruction is unsupported. See [implemented versus simulated](../IMPLEMENTED_VS_SIMULATED.md).

The owner confirmed official team registration in the main Colosseum hackathon on 2026-10-10; no independent organizer-site check was performed. Source, recorded video, technical overview and evidence are assembled here. Upload the selected package and submit through the organizer's process; submission itself has not been performed here. Public-network deployment and retained-owner installation are separate stages.
