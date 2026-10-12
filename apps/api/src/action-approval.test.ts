import assert from "node:assert/strict";
import test from "node:test";
import { TOKEN_2022_PROGRAM_ID } from "@lifecycle-kase/solana-client";
import { actionApprovalEnabled, reserveTokenDelta } from "./action-approval.js";
test("approval is opt-in and requires on-chain registration", () => {
  assert.equal(actionApprovalEnabled({}), false);
  assert.equal(actionApprovalEnabled({ ACTION_APPROVAL_RESERVE_ENABLED: "true", ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED: "true" }), true);
  for (const value of ["yes", "TRUE", "0", "true"]) assert.throws(() => actionApprovalEnabled({ ACTION_APPROVAL_RESERVE_ENABLED: value }));
});
test("reserve history proves exact Token-2022 identities through creation and closure", () => {
  const row = { accountIndex: 3, mint: "mint", owner: "reserve", programId: TOKEN_2022_PROGRAM_ID, uiTokenAmount: { decimals: 6, amount: "1750000000" } };
  assert.deepEqual(reserveTokenDelta({ preTokenBalances: [], postTokenBalances: [row] }, 3, "mint", "reserve"), { before: 0n, after: 1_750_000_000n });
  assert.deepEqual(reserveTokenDelta({ preTokenBalances: [row], postTokenBalances: [] }, 3, "mint", "reserve"), { before: 1_750_000_000n, after: 0n });
  for (const change of [{ mint: "other" }, { owner: "other" }, { programId: "other" }, { uiTokenAmount: { decimals: 9, amount: "1750000000" } },
    { uiTokenAmount: { decimals: 6, amount: "1.75" } }]) assert.throws(() => reserveTokenDelta({ preTokenBalances: [], postTokenBalances: [{ ...row, ...change }] }, 3, "mint", "reserve"));
  assert.throws(() => reserveTokenDelta({ preTokenBalances: [], postTokenBalances: [row, row] }, 3, "mint", "reserve"));
  assert.throws(() => reserveTokenDelta({}, 3, "mint", "reserve"));
});
