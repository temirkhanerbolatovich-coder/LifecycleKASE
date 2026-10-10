import { createHash } from "node:crypto";
import { decodePublicKey } from "./base58.js";
import { buildProgramUpgrade, decodeUpgradeableBuffer, decodeUpgradeableProgram, decodeUpgradeableProgramData,
  deriveUpgradeableProgramData, PROGRAM_DATA_METADATA_BYTES, programUpgradeCapacity } from "./program-upgrade.js";
import { UPGRADEABLE_LOADER_PROGRAM_ID } from "./instrument-lifecycle.js";
import type { SolanaRpc } from "./rpc.js";

export type OwnerUpgradePlan = {
  cluster: "localnet"; rpcUrl: string; expectedGenesisHash: string; programId: string; programData: string;
  upgradeAuthority: string; retainedBytes: number; retainedSha256: string; candidateBytes: number;
  candidateSha256: string; feeReserveLamports: number;
};
function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid ${name}`);
  return value as number;
}
export function verifyUpgradeArtifact(bytes: Buffer, expectedBytes: number, expectedHash: string) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== integer(expectedBytes, "artifact length") ||
      !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      !/^[a-f0-9]{64}$/.test(expectedHash) || createHash("sha256").update(bytes).digest("hex") !== expectedHash) {
    throw new Error("Upgrade artifact differs from reviewed ELF/hash/length");
  }
}
export function upgradeRpcAccount(value: unknown, executable: boolean): Buffer {
  const row = value as { owner?: unknown; executable?: unknown; data?: unknown; lamports?: unknown } | null;
  if (!row || row.owner !== UPGRADEABLE_LOADER_PROGRAM_ID || row.executable !== executable ||
      !Array.isArray(row.data) || row.data.length !== 2 || row.data[1] !== "base64" || typeof row.data[0] !== "string") {
    throw new Error("Unexpected loader account owner/executable/data");
  }
  integer(row.lamports, "account lamports");
  const bytes = Buffer.from(row.data[0], "base64");
  if (bytes.toString("base64") !== row.data[0]) throw new Error("Noncanonical loader account encoding");
  return bytes;
}
function matches(bytes: Buffer, artifact: Buffer) {
  return bytes.length >= artifact.length && bytes.subarray(0, artifact.length).equals(artifact) &&
    bytes.subarray(artifact.length).every(byte => byte === 0);
}

/** Read-only evidence. A candidate state is accepted only during confirmation, never preparation. */
export async function checkOwnerUpgrade(plan: OwnerUpgradePlan, rpc: SolanaRpc, retained: Buffer, candidate: Buffer,
  bufferAddress?: string, minimumSlot = 0, allowCandidate = false) {
  if (!plan || plan.cluster !== "localnet") throw new Error("Upgrade is restricted to reviewed Localnet");
  const url = new URL(plan.rpcUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Upgrade RPC must be a plain loopback HTTP origin");
  for (const value of [plan.expectedGenesisHash, plan.programId, plan.programData, plan.upgradeAuthority]) decodePublicKey(value);
  if (await deriveUpgradeableProgramData(plan.programId) !== plan.programData) throw new Error("ProgramData is not canonical");
  verifyUpgradeArtifact(retained, plan.retainedBytes, plan.retainedSha256);
  verifyUpgradeArtifact(candidate, plan.candidateBytes, plan.candidateSha256);
  if (integer(plan.feeReserveLamports, "fee reserve") < 1) throw new Error("Positive fee reserve required");
  if (bufferAddress !== undefined) decodePublicKey(bufferAddress);
  if (await rpc.request("getGenesisHash", []) !== plan.expectedGenesisHash) throw new Error("Upgrade genesis mismatch");
  const addresses = [plan.programId, plan.programData, plan.upgradeAuthority, ...(bufferAddress ? [bufferAddress] : [])];
  const result = await rpc.request("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64", minContextSlot: minimumSlot }]) as {
    context?: { slot?: unknown }; value?: { lamports: number; owner: string; executable: boolean; data: unknown }[];
  };
  const slot = integer(result?.context?.slot, "finalized slot");
  if (slot < minimumSlot || !Array.isArray(result.value) || result.value.length !== addresses.length) throw new Error("Incomplete finalized account set");
  if (decodeUpgradeableProgram(upgradeRpcAccount(result.value[0], true)) !== plan.programData) throw new Error("Program pointer differs from reviewed ProgramData");
  const deployed = decodeUpgradeableProgramData(upgradeRpcAccount(result.value[1], false));
  if (deployed.authority !== plan.upgradeAuthority || deployed.deployedAtSlot >= BigInt(slot)) throw new Error("Upgrade authority/slot mismatch");
  const candidateDeployed = allowCandidate && matches(deployed.programBytes, candidate);
  if (!candidateDeployed && !matches(deployed.programBytes, retained)) throw new Error("Deployed program differs from reviewed retained bytes");
  const authority = result.value[2];
  if (!authority || authority.owner !== "11111111111111111111111111111111" || authority.executable !== false) throw new Error("Upgrade authority must be a funded system wallet");
  const authorityLamports = integer(authority.lamports, "authority balance");
  const { additionalBytes, finalProgramCapacity } = programUpgradeCapacity(deployed.programBytes.length, candidate.length);
  const rent = integer(await rpc.request("getMinimumBalanceForRentExemption", [PROGRAM_DATA_METADATA_BYTES + finalProgramCapacity,
    { commitment: "finalized" }]), "ProgramData rent");
  const extensionRentLamports = Math.max(0, rent - result.value[1]!.lamports);
  if (!allowCandidate && authorityLamports < extensionRentLamports + plan.feeReserveLamports) throw new Error("Upgrade authority cannot cover extension rent and fee reserve");
  let instructionPlan = null;
  if (bufferAddress) {
    if (candidateDeployed) {
      if (result.value[3] !== null) throw new Error("Upgrade buffer was not consumed");
    } else {
      const buffer = decodeUpgradeableBuffer(upgradeRpcAccount(result.value[3], false));
      if (buffer.authority !== plan.upgradeAuthority || buffer.programBytes.length !== candidate.length ||
          !matches(buffer.programBytes, candidate)) throw new Error("Buffer authority or bytes differ from reviewed candidate");
      instructionPlan = await buildProgramUpgrade({ phase: additionalBytes > 0 ? "EXTEND" : "UPGRADE", programId: plan.programId,
        bufferAddress, authority: plan.upgradeAuthority, currentProgramCapacity: deployed.programBytes.length, candidateBytes: candidate.length });
    }
  }
  if (await rpc.request("getGenesisHash", []) !== plan.expectedGenesisHash) throw new Error("Upgrade genesis changed during preflight");
  return { cluster: "localnet" as const, genesisHash: plan.expectedGenesisHash, finalizedSlot: slot, programId: plan.programId,
    programData: plan.programData, upgradeAuthority: plan.upgradeAuthority, feePayer: plan.upgradeAuthority,
    spillAddress: plan.upgradeAuthority, deployedAtSlot: deployed.deployedAtSlot.toString(), retainedSha256: plan.retainedSha256,
    candidateSha256: plan.candidateSha256, candidateBytes: candidate.length, currentProgramCapacity: deployed.programBytes.length,
    additionalBytes, extensionRentLamports, feeReserveLamports: plan.feeReserveLamports, authorityLamports,
    bufferAddress: bufferAddress ?? null, bufferVerified: Boolean(instructionPlan), stagingRequired: !instructionPlan && !candidateDeployed,
    candidateDeployed, nextPhase: instructionPlan?.phase ?? null,
    instructions: instructionPlan?.instructions.map(instruction => ({ ...instruction, data: Buffer.from(instruction.data).toString("hex") })) ?? [],
    transactionSubmitted: false, upgradeAuthorized: false };
}
