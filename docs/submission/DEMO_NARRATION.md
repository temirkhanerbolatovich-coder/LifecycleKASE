# LifecycleKASE demo narration

The [captioned presentation](kase-three-actions-captioned.webm) plays the first 42 seconds of the [original 44.64-second Auditor recording](kase-three-actions.webm), ending on the redeemed instrument. The original also retains the mobile check. Captions and a permanent Localnet/test-signer disclosure occupy separate bands and do not cover the UI. There is no audio; the text below can also guide a voice-over.

## Timed script

| Time | Voice-over / caption |
| --- | --- |
| 00:00–00:04.5 | **LifecycleKASE services tokenized bonds after issuance: coupon, partial redemption and maturity.** |
| 00:04.5–00:10 | **Coupon: captured holdings 9 / 21 / 5; payments total 1,750 KZT-Test.** |
| 00:10–00:14.5 | **The effective cutoff is the finalized snapshot slot and time; later transfers cannot change entitlements.** |
| 00:14.5–00:20 | **Partial: 7,000 KZT-Test; burn 2 / 4 / 1; supply 35 → 28. Current supply is 0 after later maturity.** |
| 00:20–00:25 | **Each redemption payment and burn share one transaction; failure rolls both legs back.** |
| 00:25–00:34 | **Maturity: pay 29,400 KZT-Test including the final coupon and burn all remaining 28 bonds.** |
| 00:34–00:38 | **Three canonical JSON receipts are hash-committed to Solana ActionReceipt PDAs.** |
| 00:38–00:42 | **Supply reaches zero; the instrument is REDEEMED. KZT-Test funding and eligibility are simulated.** |

Times above are source-playback seconds. Browser recording adds a short loading/closing interval to the final file. The historical partial action displays the instrument's current supply after later maturity; its action-specific burn and 35 → 28 supply evidence are preserved in the canonical receipt.

## Optional opening and closing cards

Opening card:

```text
LifecycleKASE
Corporate actions for tokenized bonds on Solana
Disposable Localnet • test signers • judge-facing prototype
```

Closing card:

```text
Coupon: 1,750 paid
Early redemption: 7,000 paid • 7 burned
Maturity: 29,400 paid • 28 burned • supply 0
Canonical receipt hashes committed to Solana PDAs
```

## Recording notes

- Keep `KZT-Test` in the narration; do not call it real KZT, fiat or digital tenge.
- Say **effective finalized snapshot** when discussing the cutoff. Do not imply historical balance reconstruction at the planned timestamp.
- Describe this video as a result review. It does not show the Administrator prepare → review → wallet-sign → confirm sequence.
- Keep the Localnet/simulation disclosure visible or audible. Avoid public-network, production or KASE-integration claims.
- If the final presentation adds live execution, use a fresh disposable environment. Do not rerun an action against the saved evidence state.
