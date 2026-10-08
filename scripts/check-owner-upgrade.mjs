import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProgramUpgrade, decodePublicKey, decodeUpgradeableBuffer, decodeUpgradeableProgram,
  decodeUpgradeableProgramData, deriveUpgradeableProgramData, HttpSolanaRpc,
  PROGRAM_DATA_METADATA_BYTES, programUpgradeCapacity, UPGRADEABLE_LOADER_PROGRAM_ID } from "../packages/solana-client/dist/index.js";

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
export function verifyUpgradeArtifact(bytes, expectedBytes, expectedHash) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== integer(expectedBytes, "artifact length") ||
      !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      !/^[a-f0-9]{64}$/.test(expectedHash) || hash(bytes) !== expectedHash) throw new Error("Upgrade artifact differs from reviewed ELF/hash/length");
}
function account(value, executable) {
  if (!value || value.owner !== UPGRADEABLE_LOADER_PROGRAM_ID || value.executable !== executable ||
      !Array.isArray(value.data) || value.data.length !== 2 || value.data[1] !== "base64" ||
      typeof value.data[0] !== "string") throw new Error("Unexpected loader account owner/executable/data");
  integer(value.lamports, "account lamports");
  const bytes = Buffer.from(value.data[0], "base64");
  if (bytes.toString("base64") !== value.data[0]) throw new Error("Noncanonical loader account encoding");
  return bytes;
}
function matchesPaddedArtifact(bytes, artifact) {
  return bytes.length >= artifact.length && bytes.subarray(0, artifact.length).equals(artifact) &&
    bytes.subarray(artifact.length).every(byte => byte === 0);
}

/** Read-only preflight. Never accepts a signer/key, sends a transaction or changes authority. */
export async function checkOwnerUpgrade(plan, rpc, retained, candidate, bufferAddress) {
  if (!plan || plan.cluster !== "localnet") throw new Error("Upgrade is restricted to reviewed Localnet");
  const url = new URL(plan.rpcUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Upgrade RPC must be a plain loopback HTTP origin");
  for (const value of [plan.expectedGenesisHash, plan.programId, plan.programData, plan.upgradeAuthority]) decodePublicKey(value);
  if (await deriveUpgradeableProgramData(plan.programId) !== plan.programData) throw new Error("ProgramData is not canonical");
  verifyUpgradeArtifact(retained, plan.retainedBytes, plan.retainedSha256);
  verifyUpgradeArtifact(candidate, plan.candidateBytes, plan.candidateSha256);
  integer(plan.feeReserveLamports, "fee reserve");
  if (plan.feeReserveLamports < 1) throw new Error("Positive fee reserve required");
  if (bufferAddress !== undefined) decodePublicKey(bufferAddress);
  if (await rpc.request("getGenesisHash", []) !== plan.expectedGenesisHash) throw new Error("Upgrade genesis mismatch");
  const addresses = [plan.programId, plan.programData, plan.upgradeAuthority, ...(bufferAddress ? [bufferAddress] : [])];
  const result = await rpc.request("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64" }]);
  const slot = integer(result?.context?.slot, "finalized slot");
  if (!Array.isArray(result.value) || result.value.length !== addresses.length) throw new Error("Incomplete finalized account set");
  const programDataPointer = decodeUpgradeableProgram(account(result.value[0], true));
  if (programDataPointer !== plan.programData) throw new Error("Program pointer differs from reviewed ProgramData");
  const deployed = decodeUpgradeableProgramData(account(result.value[1], false));
  if (deployed.authority !== plan.upgradeAuthority || deployed.deployedAtSlot >= BigInt(slot)) throw new Error("Upgrade authority/slot mismatch");
  if (!matchesPaddedArtifact(deployed.programBytes, retained)) throw new Error("Deployed program differs from reviewed retained bytes");
  const authority = result.value[2];
  if (!authority || authority.owner !== "11111111111111111111111111111111" || authority.executable !== false) throw new Error("Upgrade authority must be a funded system wallet");
  const authorityLamports = integer(authority.lamports, "authority balance");
  const { additionalBytes, finalProgramCapacity } = programUpgradeCapacity(deployed.programBytes.length, candidate.length);
  const finalDataBytes = PROGRAM_DATA_METADATA_BYTES + finalProgramCapacity;
  const minimumRent = integer(await rpc.request("getMinimumBalanceForRentExemption", [finalDataBytes, { commitment: "finalized" }]), "ProgramData rent");
  const extensionRentLamports = Math.max(0, minimumRent - result.value[1].lamports);
  if (authorityLamports < extensionRentLamports + plan.feeReserveLamports) throw new Error("Upgrade authority cannot cover extension rent and fee reserve");
  let instructionPlan = null;
  if (bufferAddress) {
    const buffer = decodeUpgradeableBuffer(account(result.value[3], false));
    if (buffer.authority !== plan.upgradeAuthority || !matchesPaddedArtifact(buffer.programBytes, candidate)) {
      throw new Error("Buffer authority or bytes differ from reviewed candidate");
    }
    instructionPlan = await buildProgramUpgrade({ phase: additionalBytes > 0 ? "EXTEND" : "UPGRADE", programId: plan.programId, bufferAddress,
      authority: plan.upgradeAuthority, currentProgramCapacity: deployed.programBytes.length, candidateBytes: candidate.length });
  }
  // Detect an RPC switch during the separate rent query; slots are not claimed atomic across requests.
  if (await rpc.request("getGenesisHash", []) !== plan.expectedGenesisHash) throw new Error("Upgrade genesis changed during preflight");
  return { cluster: "localnet", genesisHash: plan.expectedGenesisHash, finalizedSlot: slot, programId: plan.programId,
    programData: plan.programData, upgradeAuthority: plan.upgradeAuthority, feePayer: plan.upgradeAuthority,
    spillAddress: plan.upgradeAuthority, deployedAtSlot: deployed.deployedAtSlot.toString(),
    retainedSha256: plan.retainedSha256, candidateSha256: plan.candidateSha256, candidateBytes: candidate.length,
    currentProgramCapacity: deployed.programBytes.length, additionalBytes, extensionRentLamports,
    feeReserveLamports: plan.feeReserveLamports, authorityLamports, bufferAddress: bufferAddress ?? null,
    bufferVerified: Boolean(instructionPlan), stagingRequired: !instructionPlan, nextPhase: instructionPlan?.phase ?? null,
    instructions: instructionPlan?.instructions.map(instruction => ({ ...instruction, data: Buffer.from(instruction.data).toString("hex") })) ?? [],
    transactionSubmitted: false, upgradeAuthorized: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2 && !(process.argv.length === 4 && process.argv[2] === "--buffer")) throw new Error("Only optional --buffer PUBLIC_ADDRESS is accepted");
    const root = new URL("../", import.meta.url);
    const plan = JSON.parse(await readFile(new URL("docs/deployment/owner-localnet-upgrade-plan.json", root), "utf8"));
    const retained = await readFile(new URL(plan.retainedArtifact, root));
    const candidate = await readFile(new URL(plan.candidateArtifact, root));
    const report = await checkOwnerUpgrade(plan, new HttpSolanaRpc(plan.rpcUrl), retained, candidate, process.argv[3]);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error("Owner upgrade preflight failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  }
}
