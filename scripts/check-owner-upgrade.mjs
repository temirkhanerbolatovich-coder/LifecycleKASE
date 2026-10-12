import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOwnerUpgrade, HttpSolanaRpc } from "../packages/solana-client/dist/index.js";
export { checkOwnerUpgrade, verifyUpgradeArtifact } from "../packages/solana-client/dist/index.js";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2 && !(process.argv.length === 4 && process.argv[2] === "--buffer")) throw new Error("Only optional --buffer PUBLIC_ADDRESS is accepted");
    const root = new URL("../", import.meta.url);
    const plan = JSON.parse(await readFile(new URL("docs/deployment/owner-localnet-upgrade-plan.json", root), "utf8"));
    const retained = await readFile(new URL(plan.retainedArtifact, root));
    const candidate = await readFile(new URL(plan.candidateArtifact, root));
    console.log(JSON.stringify(await checkOwnerUpgrade(plan, new HttpSolanaRpc(plan.rpcUrl), retained, candidate, process.argv[3]), null, 2));
  } catch (error) {
    console.error("Owner upgrade preflight failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  }
}
