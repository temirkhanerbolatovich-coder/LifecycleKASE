# Superteam KASE submission draft

Prepared: **2026-10-11**. Official form source: [Superteam Kazakhstan × KASE — Corporate Actions on Blockchain](https://superteam.fun/earn/listing/superteam-kazakhstan-x-kase-side-track-corporate-actions-on-blockchain/).

Deadline: `2026-10-13T06:59:00.000Z` — **2026-10-13 11:59 Asia/Qyzylorda (UTC+5)**. At preparation time the listing was open and displayed seven submissions. The form is marked `HUMAN_ONLY`; an owner must log in, review these values and submit them. No submission was made while preparing this document.

## Official form fields

| # | Official field | Required | Prepared value |
| ---: | --- | :---: | --- |
| 1 | Project Name | Yes | `LifecycleKASE` |
| 2 | Project Description | Yes | Use the text below. |
| 3 | Project Github Link | Yes | `https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/8ea7a42cc13b27c40fc4b3d2c4562a249a4fc02f` — current published source; all three [CI jobs](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38149599630) passed. |
| 4 | Project Website | No | `https://lifecyclekase-web.onrender.com/qa` — disclosed walletless UX simulation. The protected `/dashboard` requires a registered wallet. Both Render services are Live on the current source, with migration 20 applied; the [deployment record](../deployment/render-staging.md) holds revision and public-check evidence. Financial proof remains the isolated Localnet recording and receipts. |
| 5 | Project X Link | No | Leave blank unless the owner supplies the project's official X post/profile. |
| 6 | Link to your pitch deck or Loom/video presentation | Yes | `https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/blob/8c0f4f1d250c2e1acfb73c60f7e1143fba71e9b1/docs/submission/kase-three-actions-captioned.webm` |
| 7 | Did you submit this project to official Crypto World's Fair Hackathon on Colosseum? Yes/No | Yes | `No` — owner confirmed on 2026-10-11 that registration/stages are complete but project submission has not occurred. Change to `Yes` only after actual Colosseum submission. |
| 8 | Link to Colosseum project | No | **OWNER INPUT REQUIRED if available; otherwise leave blank.** |
| 9 | Link to project's Colosseum profile | No | **OWNER INPUT REQUIRED if available; otherwise leave blank.** |

Do not paste `OWNER INPUT REQUIRED` into the live form. Recheck field 7 immediately before submission and add fields 8–9 only when the public URLs are known.

## Project Description

```text
LifecycleKASE is an operator terminal and Solana program that services tokenized bonds after issuance. It captures a finalized holder snapshot, calculates integer entitlements, requires separate approval and a fully funded action vault, then executes coupon payments or atomic payment-and-burn redemptions and commits a versioned final receipt hash on-chain.

The demonstrated 35-bond lifecycle pays 1,750 KZT-Test in coupon, redeems 20% for 7,000 and burns 7 bonds, then pays 29,400 at maturity including the final coupon, burns the remaining 28 and marks the instrument REDEEMED. Exact transaction bytes, cash and asset legs, supply deltas and canonical receipt hashes are reconciled before PostgreSQL projection. Replay and tampering are rejected; an on-chain leg failure rolls back payment and burn, while projection failure preserves the original signature for confirmation-only recovery.

Implemented: Token-2022 instrument, verified-wallet registry with reasoned eligibility review and temporary wallet blocking, finalized capture, all three calculations, separate approver and reserve, coupon transfers, atomic redemptions, receipts and responsive Administrator/Auditor UI. Version checks and atomic audit protect registry corrections; the full role matrix, issuer isolation and investor closure remain open. Simulated inputs: KZT-Test funding, registry eligibility, generated test signers and accelerated Localnet timing. The current demo runs on an isolated Solana Localnet; public-network deployment and real KYC, fiat, KASE and CSD integrations are future work. The planned record time opens the capture window; the effective holder cutoff is the finalized capture slot and block time.
```

## Owner review before submission

- Complete the main Colosseum project submission, then update field 7 from `No` to `Yes` and record its public URL. Until then retain the owner-confirmed `No`.
- Add the public Colosseum project/profile URLs when they exist and open them in a signed-out browser.
- Open the pinned GitHub commit and video links in a signed-out browser. Do not replace the commit URL with the older default branch.
- Open the public website and confirm its deployed revision in the [deployment record](../deployment/render-staging.md). Walletless QA is a synthetic usability review; the protected dashboard does not establish access to the owner's loopback validator.
- The prepared video link uses the English-captioned presentation; retain the raw evidence video in the repository. If an external video host is used, replace field 6 with its verified public URL.
- Check that no placeholder text remains, then submit manually through the official form before the UTC deadline.

## Claim boundary for the form

Use **implemented on isolated Solana Localnet** for the three action flows. Use **simulated** for KZT-Test funding, registry eligibility, disposable signers and accelerated time. Do not describe the prototype as public Devnet/Mainnet, KASE-integrated, production-ready or backed by real fiat/KYC.

The [requirements matrix](KASE_REQUIREMENTS_MATRIX.md), [technical overview](TECHNICAL_OVERVIEW.md), [financial acceptance](../testing/kase-three-actions-2026-10-10.md) and [registry acceptance](../testing/registry-governance-2026-10-11.md) provide the evidence behind the description. The video link retains historical revision `8c0f4f1`; it is not a recording of the newer registry controls.
