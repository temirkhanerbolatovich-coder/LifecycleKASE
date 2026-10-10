import assert from "node:assert/strict";
import test from "node:test";
import { programUpgradeEnabled, protectedProgramAccounts, prepareProgramUpgrade,
  requireNoPendingSignedBusinessAttempts } from "./program-upgrade.js";
import { ProgramUpgradeMaintenanceGuard } from "./program-upgrade.guard.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const KEY = "11111111111111111111111111111111";
const GENESIS = "B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF";
test("upgrade capability defaults off and requires loopback Localnet with registration disabled", () => {
  assert.equal(programUpgradeEnabled({}), false);
  const env = { LOCALNET_PROGRAM_UPGRADE_ENABLED: "true", SOLANA_CLUSTER: "localnet", API_LISTEN_HOST: "127.0.0.1" };
  assert.equal(programUpgradeEnabled(env), true);
  for (const changed of [{ API_LISTEN_HOST: "0.0.0.0" }, { SOLANA_CLUSTER: "devnet" },
    { ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED: "true" }, { LOCALNET_PROGRAM_UPGRADE_ENABLED: "1" }]) {
    assert.throws(() => programUpgradeEnabled({ ...env, ...changed }), /Upgrade requires/);
  }
});
test("protected program accounts reject stale context, wrong ownership, duplicate keys and noncanonical bytes", async () => {
  const account = { pubkey: KEY, account: { owner: PROGRAM, executable: false, data: ["AQ==", "base64"], lamports: 100 } };
  const response = { context: { slot: 50 }, value: [account] };
  const rpc = { request: async () => response };
  const result = await protectedProgramAccounts(rpc, PROGRAM, 40);
  assert.equal(result.accounts.length, 1); assert.equal(result.accounts[0]!.bytes, 1);
  await assert.rejects(protectedProgramAccounts(rpc, PROGRAM, 51), /incomplete/);
  response.value.push(account); await assert.rejects(protectedProgramAccounts(rpc, PROGRAM), /Duplicate/); response.value.pop();
  account.account.owner = KEY; await assert.rejects(protectedProgramAccounts(rpc, PROGRAM), /metadata/); account.account.owner = PROGRAM;
  account.account.data[0] = "AQ"; await assert.rejects(protectedProgramAccounts(rpc, PROGRAM), /encoding/);
});
test("wrong upgrade authority is rejected before any database, RPC or artifact access", async () => {
  await assert.rejects(prepareProgramUpgrade(null as never, null as never, {}, { id: KEY, walletAddress: KEY, correlationId: KEY },
    { plan: { upgradeAuthority: PROGRAM } } as never), error => error instanceof TransactionWorkflowError && error.code === "WALLET_MISMATCH");
});
test("a same-network unavailable signature with an expired blockhash no longer blocks maintenance", async () => {
  const attempt = { status: "UNKNOWN_CONFIRMATION", signature: "A".repeat(88), recentBlockhash: KEY,
    lastErrorCode: "TRANSACTION_UNAVAILABLE", networkGenesisHash: GENESIS } as const;
  const rpc = (signatureStatus: unknown, blockhashValid: unknown, genesis = GENESIS) => ({ request: async (method: string) => {
    if (method === "getGenesisHash") return genesis;
    if (method === "getSignatureStatuses") return { value: [signatureStatus] };
    if (method === "isBlockhashValid") return { value: blockhashValid };
    throw new Error(`Unexpected RPC method ${method}`);
  } });
  await requireNoPendingSignedBusinessAttempts(rpc(null, false), [attempt], GENESIS);
  for (const changed of [
    { status: "SUBMITTED" }, { lastErrorCode: "TRANSACTION_NOT_FINALIZED" }, { networkGenesisHash: PROGRAM },
    { recentBlockhash: null }, { signature: null }
  ]) {
    await assert.rejects(requireNoPendingSignedBusinessAttempts(rpc(null, false), [{ ...attempt, ...changed }] as never, GENESIS),
      error => error instanceof TransactionWorkflowError && error.code === "UPGRADE_PENDING_BUSINESS_TRANSACTION");
  }
  for (const [signatureStatus, blockhashValid] of [[{ confirmationStatus: "finalized" }, false], [null, true]] as const) {
    await assert.rejects(requireNoPendingSignedBusinessAttempts(rpc(signatureStatus, blockhashValid), [attempt], GENESIS),
      error => error instanceof TransactionWorkflowError && error.code === "UPGRADE_PENDING_BUSINESS_TRANSACTION");
  }
  await assert.rejects(requireNoPendingSignedBusinessAttempts(rpc(null, false, PROGRAM), [attempt], GENESIS),
    error => error instanceof TransactionWorkflowError && error.code === "WRONG_SOLANA_NETWORK");
  await assert.rejects(requireNoPendingSignedBusinessAttempts(rpc(null, "false"), [attempt], GENESIS),
    error => error instanceof TransactionWorkflowError && error.code === "INVALID_RPC_RESPONSE");
  await assert.rejects(requireNoPendingSignedBusinessAttempts(rpc(null, false), Array(101).fill(attempt), GENESIS),
    error => error instanceof TransactionWorkflowError && error.code === "UPGRADE_PENDING_BUSINESS_TRANSACTION");
});
test("persistent maintenance blocks business HTTP mutations while keeping authentication, reads and recovery available", async () => {
  const guard = new ProgramUpgradeMaintenanceGuard({ programUpgrade: { findFirst: async () => ({ id: KEY }) } } as never);
  const context = (method: string, path: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method, path }) }) }) as never;
  for (const path of ["/api/v1/auth/verify", "/api/v1/auth/logout", "/api/v1/program-upgrade/prepare", "/api/v1/program-upgrade/confirm"]) {
    assert.equal(await guard.canActivate(context("POST", path)), true);
  }
  assert.equal(await guard.canActivate(context("GET", "/api/v1/instruments")), true);
  await assert.rejects(guard.canActivate(context("POST", "/api/v1/corporate-actions/x/entitlements/calculate")), /Business writes/);
  await assert.rejects(guard.canActivate(context("POST", "/api/v1/program-upgrade/arbitrary")), /Business writes/);
});
