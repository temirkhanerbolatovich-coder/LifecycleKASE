import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePublicKey, HttpSolanaRpc } from "../packages/solana-client/dist/index.js";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

/** Read-only predeployment checks. No signer, transaction or custody approval is accepted. */
export async function checkDevnetReadiness(plan, rpc) {
  if (!plan || plan.expectedGenesisHash !== DEVNET_GENESIS) {
    throw new Error("Plan must pin the supported Devnet genesis hash");
  }
  for (const field of ["programId", "feePayer", "upgradeAuthority"]) {
    try {
      decodePublicKey(plan[field]);
    } catch {
      throw new Error(`Invalid public address for ${field}`);
    }
  }
  if (new Set([plan.programId, plan.feePayer, plan.upgradeAuthority]).size !== 3) {
    throw new Error("Approved demo plan requires distinct program, fee-payer and authority identities");
  }
  const genesis = await rpc.request("getGenesisHash", []);
  if (genesis !== DEVNET_GENESIS) {
    throw new Error("RPC is not the expected Devnet network");
  }
  const balance = await rpc.request("getBalance", [plan.feePayer, { commitment: "finalized" }]);
  if (!balance || !Number.isSafeInteger(balance.value) || balance.value < 0 ||
      !Number.isSafeInteger(balance.context?.slot) || balance.context.slot < 0) {
    throw new Error("Invalid finalized balance response");
  }
  const account = await rpc.request("getAccountInfo", [plan.programId, {
    commitment: "finalized", encoding: "base64"
  }]);
  if (!account || !Object.hasOwn(account, "value") ||
      !Number.isSafeInteger(account.context?.slot) || account.context.slot < 0) {
    throw new Error("Invalid finalized program-account response");
  }
  if (account.value !== null) {
    throw new Error("Program address is already occupied; review it before any deployment");
  }
  return {
    network: "SOLANA_DEVNET", genesisHash: genesis,
    programId: plan.programId, feePayer: plan.feePayer, upgradeAuthority: plan.upgradeAuthority,
    feePayerLamports: balance.value, balanceSlot: balance.context.slot,
    programAccountSlot: account.context.slot, programAddressUnoccupied: true,
    fundingRequired: balance.value === 0,
    transactionSubmitted: false,
    deploymentAuthorized: false
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("This command accepts no key or transaction arguments");
    const plan = JSON.parse(await readFile(new URL("../docs/deployment/devnet-plan.json", import.meta.url), "utf8"));
    const report = await checkDevnetReadiness(plan, new HttpSolanaRpc(plan.rpcUrl));
    console.log(JSON.stringify(report, null, 2));
    if (report.fundingRequired) process.exitCode = 2;
  } catch (error) {
    console.error("Devnet preflight failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  }
}
