# Superteam KASE submission draft

Updated **2026-10-12**. This is the separate Superteam side-track form, not the authenticated main-Colosseum application. Official [KASE listing](https://superteam.fun/earn/listing/superteam-kazakhstan-x-kase-side-track-corporate-actions-on-blockchain/).

Deadline in the inspected listing: `2026-10-13T06:59:00Z` — **2026-10-13 11:59 Asia/Qyzylorda (UTC+5)**. The stored access marker is `HUMAN_ONLY`: the owner must review and make the final side-track submit. Preparation does not submit the project.

## Official form fields

| # | Official field | Required | Prepared value |
| ---: | --- | :---: | --- |
| 1 | Project Name | Yes | `LifecycleKASE` |
| 2 | Project Description | Yes | Text below |
| 3 | Project Github Link | Yes | `https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/f51be252295af181ed931f00dba1ee89c35aedef` — implementation snapshot. Replace with the final exact published package commit after documentation/media publication |
| 4 | Project Website | No | `https://lifecyclekase.assetguard-temirkhan.duckdns.org/qa` — verified public English-capable walletless simulation on Oracle/DuckDNS; see [hosting](../deployment/oracle-duckdns.md) |
| 5 | Project X Link | No | Leave blank unless the owner supplies an official public project post/profile |
| 6 | Link to your pitch deck or Loom/video presentation | Yes | [Local English pitch](lifecyclekase-pitch-en-benjamin.mp4), 115.104s, is ready. Accepted-host upload is not complete: enter its actual YouTube/Loom/Vimeo URL after upload/playback verification. See [video record](ENGLISH_DEMO_AND_PITCH_PLAN.md) |
| 7 | Did you submit this project to official Crypto World's Fair Hackathon on Colosseum? Yes/No | Yes | `No` until actual main-project submission is confirmed; owner previously confirmed registration/stages only |
| 8 | Link to Colosseum project | No | `https://colosseum.com/arena/projects/lifecyclekase` — existing project observed in authenticated account; final submission/access status must be checked |
| 9 | Link to project's Colosseum profile | No | `https://colosseum.com/arena/profiles/temirkhan4` — existing founder profile observed in authenticated account; verify reviewer access |

Do not paste instruction text into the live form. Recheck field 7 and the final source/website/video URLs immediately before submitting.

## Project Description

```text
LifecycleKASE is an operator terminal and Solana program for servicing test tokenized bonds after issuance. It captures complete finalized holder evidence, calculates integer entitlements, requires separate approval and a fully funded action vault, then executes coupon payments or atomic payment-and-burn redemptions and commits the canonical final receipt hash on-chain.

Our accepted disposable Localnet lifecycle issued 35 bonds, paid 1,750 KZT-Test coupon, redeemed 20% for 7,000 and burned 7 bonds, redeemed an exact additional 8 units for 8,000, then paid 21,000 at maturity including the final coupon and burned the remaining 20. Supply reconciled 35 to 35 to 28 to 20 to 0. Exact-target largest-remainder allocation assigned 2/5/1 from captured balances 8/16/4. Four canonical receipts preserve signatures, raw capture sources and cash/burn reconciliation.

New controlled instrument v2 uses a default-frozen Token-2022 mint, authorized transfer/capture and reservation of only assigned redemption units. Exact prepared bytes, replay guards, atomic cash/burn execution and original-signature recovery protect the workflow. Recovery passed after a finalized burn and source-account closure; earlier receipts remained unchanged after maturity. The operator UI supports RU/EN, six action steps, governed multi-wallet registry, transaction/audit views and JSON/CSV evidence export.

KZT-Test funding, eligibility, disposable signers and accelerated time are simulated inputs; Solana transfers and burns execute on a real isolated local validator. The effective ownership cutoff is the actual finalized capture slot/time, not reconstructed historical ownership. Public QA is a page-local usability simulation. Public Devnet/Mainnet, retained-owner rollout of the newer candidate, real KYC/fiat/KASE/CSD, full issuer isolation, period-level coupon uniqueness and production operations remain future work. The newer reconciliation worker and export have source/database/helper acceptance; fresh worker chain recovery and authenticated export downloads against fresh settlement remain open.
```

## Main Colosseum copy

Short description:

```text
A Solana corporate-action terminal for test tokenized bonds: locked holder capture, exact entitlements, separate approval and reserve, atomic coupon/redemption settlement, original-signature recovery and hash-committed evidence.
```

Progress during the competition should be described from the actual source history: verified-wallet registry and issuance, exact transaction/recovery guards, all three corporate-action classes, canonical receipts, controlled capture/unit reservations, exact-target redemption and operator evidence workflows. Disclose prior development truthfully. Do not invent team eligibility, funding, customer interviews, demand validation, traction or adoption.

The [main rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) require English content. The [general FAQ](https://colosseum.com/hackathon?year=fall2026) says 2–3 minute pitch, but the actual authenticated form inspected on 2026-10-12 requires **pitch up to 2 minutes** and **separate live-product demo up to 3 minutes**, both hosted on **YouTube, Loom or Vimeo**. Use the stricter form maximum for pitch, and show the live product in the demo. The portal's observed state was **Not submitted**, with video links blank and details/team complete. Team identity/background/location, prior work, terms and current field limits must be reviewed in that account.

## Final review

- Publish the final reviewed source/doc/media package and open its exact commit in a signed-out browser.
- Open both finished English videos; confirm content, duration and public reviewer access. Current media status belongs in the [video plan](ENGLISH_DEMO_AND_PITCH_PLAN.md).
- Confirm the stable website and current deployed revision/availability from the [current hosting record](../deployment/oracle-duckdns.md). Website health does not prove hosted financial execution.
- Complete main Colosseum submission, retain organizer confirmation and actual project/profile URLs, then update side-track field 7 to `Yes`.
- Submit the side track through its owner-facing official form; retain final values and confirmation before the UTC deadline.

The original [captioned demo](kase-three-actions-captioned.webm) retains media source `8c0f4f1` and the earlier three-action fixture. It is not the current English narrated pitch, controlled v2 recording or main submission proof. Supporting claims are mapped by the [requirements matrix](KASE_REQUIREMENTS_MATRIX.md), [technical overview](TECHNICAL_OVERVIEW.md) and [current checklist](SUBMISSION_CHECKLIST_2026-10-12.md).